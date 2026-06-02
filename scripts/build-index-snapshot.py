#!/usr/bin/env python3
"""
MEME GP - Daily Grid Index Snapshot
====================================

Computes the daily Grid Index value (equal-weight basket of 15 grid teams)
and the Meme Market benchmark (CoinGecko Meme category total MCAP).

Appends one snapshot per day to data/index-snapshots.json. Runs daily at
00:00 UTC via GitHub Actions cron.

Index methodology:
  - Baseline = 2 June 2026 (Day 0, value = 100 for both grid and meme market)
  - Each team contributes 1/15 of the index (equal weight)
  - Grid value  = avg(today_mcap_i / baseline_mcap_i) * 100 for i in 15 teams
  - Meme market = (today_meme_category_mcap / baseline_meme_category_mcap) * 100
  - Alpha       = grid_index - meme_market

First-run behavior:
  - Reads latest entry from data/history.json (must contain all 15 teams)
  - Writes a new index-snapshots.json with that day as baseline (value 100)
  - The 'baseline' top-level object captures raw MCAP values for future days

Subsequent-run behavior:
  - Reads baseline from index-snapshots.json
  - Reads today's MCAPs from history.json
  - Computes new values relative to baseline
  - Appends new snapshot

Run manually:
  python scripts/build-index-snapshot.py
"""

import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path


# ============================================================
# Config
# ============================================================
COINGECKO_CATEGORIES_URL = "https://api.coingecko.com/api/v3/coins/categories"
# CoinGecko category lookup — try ID first, fall back to fuzzy name match.
# As of 2026 the slug may be "meme-token" or just "meme" — we handle both.
MEME_CATEGORY_IDS = ["meme-token", "meme"]
MEME_CATEGORY_NAME_KEYWORDS = ["meme"]  # case-insensitive substring match
USER_AGENT = "memegrandprix-index-snapshot/1.0"
TIMEOUT_SECONDS = 20


# ============================================================
# Helpers
# ============================================================
def http_get_json(url):
    hdrs = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    req = urllib.request.Request(url, headers=hdrs)
    with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
        if resp.status != 200:
            raise RuntimeError(f"HTTP {resp.status}")
        return json.loads(resp.read().decode("utf-8"))


def fetch_meme_market_mcap():
    """
    Fetch total market cap of the CoinGecko 'Meme' category.
    Tries known category IDs first, falls back to name fuzzy match.
    """
    data = http_get_json(COINGECKO_CATEGORIES_URL)
    if not isinstance(data, list):
        raise RuntimeError("CoinGecko categories response not a list")

    # 1. Try known IDs first
    for cat in data:
        if cat.get("id") in MEME_CATEGORY_IDS:
            mcap = cat.get("market_cap")
            if mcap and mcap > 0:
                print(f"  matched CoinGecko category by id: '{cat.get('id')}' / '{cat.get('name')}'")
                return float(mcap)

    # 2. Fall back to name keyword match (e.g., "Meme", "Meme Coins", "Memecoins")
    for cat in data:
        name = (cat.get("name") or "").lower()
        if any(kw in name for kw in MEME_CATEGORY_NAME_KEYWORDS):
            # Filter out unrelated categories that happen to contain "meme"
            # (none known today but defensive). Prefer entries whose name starts with "meme".
            if name.startswith("meme"):
                mcap = cat.get("market_cap")
                if mcap and mcap > 0:
                    print(f"  matched CoinGecko category by name: '{cat.get('id')}' / '{cat.get('name')}'")
                    return float(mcap)

    # 3. Could not find — log what's available for debugging
    available = sorted([(c.get("id"), c.get("name")) for c in data if c.get("name")])
    meme_like = [(i, n) for i, n in available if n and "meme" in n.lower()]
    raise RuntimeError(
        f"Could not find Meme category in CoinGecko. "
        f"Meme-like categories: {meme_like}. "
        f"Total categories: {len(available)}"
    )


def load_json(path, default):
    if not path.exists():
        return default
    try:
        with path.open() as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        print(f"WARN failed to read {path}: {e}", file=sys.stderr)
        return default


def save_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    with tmp.open("w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    tmp.replace(path)


def get_team_mcap(team_entry):
    """Extract mcap from a history.json team entry, return None if missing."""
    if not team_entry or team_entry.get("error"):
        return None
    mcap = team_entry.get("mcap")
    if mcap is None or mcap <= 0:
        return None
    return float(mcap)


# ============================================================
# Main
# ============================================================
def main():
    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    timestamp = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    repo_root = Path(__file__).resolve().parent.parent
    history_path = repo_root / "data" / "history.json"
    index_path = repo_root / "data" / "index-snapshots.json"

    print(f"MEME GP index snapshot - {timestamp}")
    print(f"  history file: {history_path}")
    print(f"  index file:   {index_path}")
    print()

    # ---- Load history.json (source of truth for team MCAPs) ----
    history = load_json(history_path, None)
    if not history or not history.get("snapshots"):
        print("ERROR: history.json missing or empty", file=sys.stderr)
        sys.exit(1)

    snapshots = history["snapshots"]
    latest_history = snapshots[-1]
    latest_date = latest_history.get("date")
    teams_today = latest_history.get("teams", {})

    if not latest_date:
        print("ERROR: latest history snapshot missing date", file=sys.stderr)
        sys.exit(1)

    if not teams_today:
        print("ERROR: latest history snapshot has no team data", file=sys.stderr)
        sys.exit(1)

    # IMPORTANT: snapshot date = source data date, NOT today's calendar date
    # This keeps the index dates aligned with the actual measurement dates,
    # regardless of when this script happens to run.
    snapshot_date = latest_date

    print(f"  using history snapshot dated: {latest_date}")
    print(f"  writing index snapshot dated: {snapshot_date}")
    print(f"  teams in that snapshot: {len(teams_today)}")

    # ---- Build today's per-team MCAP map ----
    today_mcaps = {}
    for ticker, entry in teams_today.items():
        mcap = get_team_mcap(entry)
        if mcap is not None:
            today_mcaps[ticker] = mcap

    if len(today_mcaps) == 0:
        print("ERROR: no valid team MCAPs in today's snapshot", file=sys.stderr)
        sys.exit(1)

    print(f"  teams with valid MCAP today: {len(today_mcaps)}")

    # ---- Fetch CoinGecko Meme category ----
    try:
        meme_mcap_today = fetch_meme_market_mcap()
        print(f"  meme market mcap (CoinGecko): ${meme_mcap_today:,.0f}")
    except Exception as e:
        print(f"ERROR: CoinGecko fetch failed: {e}", file=sys.stderr)
        sys.exit(1)

    # ---- Load existing index data ----
    index_data = load_json(index_path, {"baseline": None, "snapshots": []})

    # ---- First-run: establish baseline ----
    if not index_data.get("baseline") or not index_data["baseline"].get("date"):
        print("\n>>> FIRST RUN: establishing baseline <<<")
        baseline = {
            "date": snapshot_date,
            "established_at": timestamp,
            "team_mcaps_usd": today_mcaps,
            "meme_market_mcap_usd": meme_mcap_today,
            "teams_in_basket": sorted(today_mcaps.keys()),
            "methodology_notes": (
                "Equal-weight basket of MEME GP Season 2 teams. "
                "Each team's MCAP on this baseline date = 100. "
                "Subsequent days computed as: avg(today_mcap_i / baseline_mcap_i) * 100. "
                "Meme market benchmark = CoinGecko 'Meme' category total MCAP, normalized to 100 on baseline date."
            ),
        }
        baseline_snapshot = {
            "date": snapshot_date,
            "captured_at": timestamp,
            "is_preseason": False,
            "grid_index": 100.0,
            "meme_market": 100.0,
            "alpha": 0.0,
            "grid_total_mcap_usd": sum(today_mcaps.values()),
            "meme_market_mcap_usd": meme_mcap_today,
            "teams_count": len(today_mcaps),
        }
        index_data = {
            "baseline": baseline,
            "snapshots": [baseline_snapshot],
        }
        save_json(index_path, index_data)
        print(f"  baseline established for {snapshot_date}")
        print(f"  grid teams in basket: {len(today_mcaps)}")
        print(f"  total grid mcap: ${sum(today_mcaps.values()):,.0f}")
        print(f"  meme market mcap: ${meme_mcap_today:,.0f}")
        print(f"  grid_index=100.0  meme_market=100.0  alpha=0.0")
        return

    # ---- Subsequent run: compute today's values vs baseline ----
    baseline = index_data["baseline"]
    baseline_team_mcaps = baseline["team_mcaps_usd"]
    baseline_meme_mcap = baseline["meme_market_mcap_usd"]

    # Compute grid_index: equal-weight average of % change from baseline
    # For each baseline team, get today's mcap (skip if missing today)
    pct_changes = []
    missing_today = []
    for ticker, baseline_mcap in baseline_team_mcaps.items():
        if ticker in today_mcaps and baseline_mcap > 0:
            ratio = today_mcaps[ticker] / baseline_mcap
            pct_changes.append(ratio)
        else:
            missing_today.append(ticker)

    if not pct_changes:
        print("ERROR: no baseline teams have data today", file=sys.stderr)
        sys.exit(1)

    if missing_today:
        print(f"  WARN: {len(missing_today)} baseline teams missing today: {missing_today}")

    grid_index = (sum(pct_changes) / len(pct_changes)) * 100.0
    meme_market = (meme_mcap_today / baseline_meme_mcap) * 100.0
    alpha = grid_index - meme_market

    new_snapshot = {
        "date": snapshot_date,
        "captured_at": timestamp,
        "is_preseason": False,
        "grid_index": round(grid_index, 2),
        "meme_market": round(meme_market, 2),
        "alpha": round(alpha, 2),
        "grid_total_mcap_usd": sum(today_mcaps.get(t, 0) for t in baseline_team_mcaps),
        "meme_market_mcap_usd": meme_mcap_today,
        "teams_count": len(pct_changes),
    }

    # Idempotent: replace today's snapshot if it already exists
    snaps = index_data["snapshots"]
    existing_idx = next((i for i, s in enumerate(snaps) if s.get("date") == snapshot_date), None)
    if existing_idx is not None:
        print(f"  overwriting existing snapshot for {snapshot_date}")
        snaps[existing_idx] = new_snapshot
    else:
        print(f"  appending new snapshot for {snapshot_date}")
        snaps.append(new_snapshot)

    save_json(index_path, index_data)
    print()
    print(f"  grid_index:   {grid_index:.2f}  ({'+' if grid_index >= 100 else ''}{grid_index-100:.2f} from baseline)")
    print(f"  meme_market:  {meme_market:.2f}  ({'+' if meme_market >= 100 else ''}{meme_market-100:.2f} from baseline)")
    print(f"  alpha:        {alpha:+.2f}")
    print(f"  total snapshots: {len(snaps)}")


if __name__ == "__main__":
    main()
