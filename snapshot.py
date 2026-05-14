#!/usr/bin/env python3
"""
MEME GP — Daily DexScreener Snapshot
=====================================

Pulls live on-chain data from DexScreener for the 9 grid teams and appends
one row to data/history.json. Designed to run daily at 09:00 SAST via
GitHub Actions cron.

Failure mode:
  - If a team fetch fails, its entry contains an "error" field
  - The snapshot row is still written with whatever data is available
  - Better to have partial data than missing days

Run manually:
  python scripts/snapshot.py
"""

import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path


# ============================================================
# TEAMS CONFIG — single source of truth for the 9 grid teams
# ============================================================
TEAMS = [
    {"ticker": "TURBO",      "chain": "ETH", "contract": "0xa35923162c49cf95e6bf26623385eb431ad920d3"},
    {"ticker": "MASK",       "chain": "SOL", "contract": "6MQpbiTC2YcogidTmKqMLK82qvE9z5QEm7EP3AEDpump"},
    {"ticker": "NEURO",      "chain": "CRO", "contract": "0xCFE223d06b86568C24ffd17E8ac748DbAC096b3b"},
    {"ticker": "SUS",        "chain": "SOL", "contract": "GpXv1GNGMzrKXCNnYFbZk5TaZXUdKJNu5cmtiUyBdoge"},
    {"ticker": "LOL",        "chain": "SOL", "contract": "53Xy4g1RJnGR6saaJRDNoo1rYTGZ3W5U321EDdSa5BGD"},
    {"ticker": "SHIH",       "chain": "BNB", "contract": "0xfCa5208e4074e06596CC28B47214A109E4c14444"},
    {"ticker": "VIBECOIN",   "chain": "SOL", "contract": "AZbem4s8iLJE5eniDZJ7c8q1ahbfMwWgCA8TxVW2tDUB"},
    {"ticker": "MARS",       "chain": "SOL", "contract": "EWAyfPVbo1LxrywXzkBRkqvG6d8KkrcdBvmASxcZdoge"},
    {"ticker": "420BLAZEIT", "chain": "SOL", "contract": "Amyv5r77rhmDGMnsAHMxghMrJVGYitQDmkKt7wjdoge"},
]

# Map our chain shorthand to DexScreener's chain identifier
DX_CHAIN = {
    "ETH": "ethereum",
    "SOL": "solana",
    "BNB": "bsc",
    "CRO": "cronos",
}

DEXSCREENER_API = "https://api.dexscreener.com/latest/dex/tokens/{contract}"
USER_AGENT = "memegrandprix-snapshot/1.0"
TIMEOUT_SECONDS = 15


# ============================================================
# FETCH ONE TEAM
# ============================================================
def fetch_team(team):
    """Fetch a single team's data from DexScreener. Returns a dict with
    either the stats or an "error" field."""
    contract = team["contract"]
    expected_chain = DX_CHAIN.get(team["chain"])
    url = DEXSCREENER_API.format(contract=contract)

    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
            if resp.status != 200:
                return {"error": f"HTTP {resp.status}"}
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.URLError as e:
        return {"error": f"network: {e.reason}"}
    except json.JSONDecodeError:
        return {"error": "json decode failed"}
    except Exception as e:
        return {"error": f"unexpected: {e}"}

    pairs = data.get("pairs") or []
    if not pairs:
        return {"error": "no pairs found"}

    # Prefer pairs on the expected chain
    on_chain = [p for p in pairs if p.get("chainId") == expected_chain]
    pool = on_chain if on_chain else pairs

    # Pick the pair with the highest liquidity
    pool.sort(key=lambda p: (p.get("liquidity") or {}).get("usd") or 0, reverse=True)
    top = pool[0]

    return {
        "mcap":       top.get("marketCap"),
        "fdv":        top.get("fdv"),
        "price":      float(top["priceUsd"]) if top.get("priceUsd") else None,
        "vol_24h":    (top.get("volume") or {}).get("h24") or 0,
        "liq":        (top.get("liquidity") or {}).get("usd") or 0,
        "change_24h": (top.get("priceChange") or {}).get("h24") or 0,
    }


# ============================================================
# LOAD / SAVE history.json
# ============================================================
def load_history(path):
    """Load existing history.json or return empty structure."""
    if not path.exists():
        return {"snapshots": []}
    try:
        with path.open() as f:
            data = json.load(f)
        # Sanity: must have 'snapshots' key as a list
        if not isinstance(data, dict) or not isinstance(data.get("snapshots"), list):
            print(f"⚠ {path} exists but is malformed — starting fresh", file=sys.stderr)
            return {"snapshots": []}
        return data
    except (json.JSONDecodeError, OSError) as e:
        print(f"⚠ failed to read {path}: {e} — starting fresh", file=sys.stderr)
        return {"snapshots": []}


def save_history(path, history):
    """Write history.json back. Atomic via tmp + rename."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    with tmp.open("w") as f:
        json.dump(history, f, indent=2, ensure_ascii=False)
        f.write("\n")
    tmp.replace(path)


# ============================================================
# MAIN
# ============================================================
def main():
    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    timestamp = now.strftime("%Y-%m-%dT%H:%M:%SZ")

    # Resolve repo root so this works regardless of CWD
    repo_root = Path(__file__).resolve().parent.parent
    history_path = repo_root / "data" / "history.json"

    print(f"MEME GP snapshot · {timestamp}")
    print(f"  history file: {history_path}")
    print()

    history = load_history(history_path)

    # Fetch all 9 teams
    teams_data = {}
    success_count = 0
    error_count = 0
    for team in TEAMS:
        result = fetch_team(team)
        teams_data[team["ticker"]] = result
        if "error" in result:
            error_count += 1
            print(f"  ✗ {team['ticker']:11} ({team['chain']}) — {result['error']}")
        else:
            success_count += 1
            mcap = result.get("mcap") or 0
            print(f"  ✓ {team['ticker']:11} ({team['chain']}) — mcap ${mcap:,.0f}")

    print()
    print(f"  fetched: {success_count}/{len(TEAMS)} ok, {error_count} errors")

    # Build today's snapshot row
    new_row = {
        "date":         today,
        "captured_at":  timestamp,
        "teams":        teams_data,
    }

    # Overwrite if today's row already exists, otherwise append
    snapshots = history["snapshots"]
    existing_idx = next((i for i, s in enumerate(snapshots) if s.get("date") == today), None)
    if existing_idx is not None:
        print(f"  ⟳ overwriting existing snapshot for {today}")
        snapshots[existing_idx] = new_row
    else:
        print(f"  + appending new snapshot for {today}")
        snapshots.append(new_row)

    # Save
    save_history(history_path, history)
    print(f"  ✓ wrote {history_path}")
    print(f"  total snapshots in history: {len(snapshots)}")

    # Exit non-zero if all fetches failed — signals to CI that something's wrong
    if success_count == 0:
        print("\n✗ all fetches failed — exiting with error", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
