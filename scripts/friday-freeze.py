#!/usr/bin/env python3
"""
MEME GP - Friday-Freeze Weekly Snapshot

Runs every Friday at 09:00 SAST (07:00 UTC) via GitHub Actions cron.
Captures a frozen weekly snapshot of all grid teams that gp-central.html
reads during the parc fermé window (Fri 09:00 → Mon 00:00 SAST).

Writes raw on-chain data only — gp-central.html runs B-prime on the
snapshot data the same way it does on live data. No formula duplication.

Outputs:
  data/snapshot.json                  - the canonical "current frozen state"
  data/snapshots/YYYY-MM-DD.json      - archive copy for race engine + analytics

Run manually:
  python scripts/friday-freeze.py

Or with a fixed timestamp (for testing):
  FREEZE_AT=2026-06-05T07:00:00Z python scripts/friday-freeze.py
"""

import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path


# Teams config - mirrors gp-central.html TEAMS array (12 teams as of May 19)
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
    {"ticker": "PUP",        "chain": "BNB", "contract": "0x73b84f7e3901f39fc29f3704a03126d317ab4444"},
    {"ticker": "PEPONK",     "chain": "SOL", "contract": "Gqqdgfkn7bcsuBQZEk9oMBkqCv1bRXvPmTLs3sQ9pump"},
    {"ticker": "MOMO",       "chain": "SOL", "contract": "G4zwEA9NSd3nMBbEj31MMPq2853Brx2oGsKzex3ebonk"},
]

DX_CHAIN = {
    "ETH": "ethereum",
    "SOL": "solana",
    "BNB": "bsc",
    "CRO": "cronos",
}

DEXSCREENER_API = "https://api.dexscreener.com/latest/dex/tokens/{contract}"
USER_AGENT = "memegrandprix-friday-freeze/1.0"
TIMEOUT_SECONDS = 15


def fetch_team(team):
    """Identical logic to snapshot.py - returns raw on-chain data."""
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

    on_chain = [p for p in pairs if p.get("chainId") == expected_chain]
    pool = on_chain if on_chain else pairs

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


def iso_week_string(date):
    """ISO 8601 week format: 2026-W23"""
    year, week, _ = date.isocalendar()
    return f"{year}-W{week:02d}"


def get_freeze_timestamp():
    """Allow env override for testing, default to now."""
    override = os.environ.get("FREEZE_AT")
    if override:
        return datetime.fromisoformat(override.replace("Z", "+00:00"))
    return datetime.now(timezone.utc)


def main():
    now = get_freeze_timestamp()
    today = now.strftime("%Y-%m-%d")
    timestamp = now.strftime("%Y-%m-%dT%H:%M:%SZ")

    repo_root = Path(__file__).resolve().parent.parent
    data_dir = repo_root / "data"
    snapshot_path = data_dir / "snapshot.json"
    archive_dir = data_dir / "snapshots"
    archive_path = archive_dir / f"{today}.json"

    print(f"MEME GP friday-freeze - {timestamp}")
    print(f"  ISO week:       {iso_week_string(now)}")
    print(f"  snapshot file:  {snapshot_path}")
    print(f"  archive file:   {archive_path}")
    print()

    teams_data = {}
    success_count = 0
    error_count = 0
    for team in TEAMS:
        result = fetch_team(team)
        teams_data[team["ticker"]] = result
        if "error" in result:
            error_count += 1
            print(f"  FAIL {team['ticker']:11} ({team['chain']}) - {result['error']}")
        else:
            success_count += 1
            mcap = result.get("mcap") or 0
            print(f"  OK   {team['ticker']:11} ({team['chain']}) - mcap ${mcap:,.0f}")

    print()
    print(f"  fetched: {success_count}/{len(TEAMS)} ok, {error_count} errors")

    # Build the snapshot
    snapshot = {
        "frozen_at":   timestamp,
        "freeze_week": iso_week_string(now),
        "teams":       teams_data,
    }

    # Ensure directories exist
    data_dir.mkdir(parents=True, exist_ok=True)
    archive_dir.mkdir(parents=True, exist_ok=True)

    # Atomic write to current snapshot
    tmp = snapshot_path.with_suffix(".json.tmp")
    with tmp.open("w") as f:
        json.dump(snapshot, f, indent=2, ensure_ascii=False)
        f.write("\n")
    tmp.replace(snapshot_path)
    print(f"  wrote {snapshot_path}")

    # Atomic write to archive
    tmp = archive_path.with_suffix(".json.tmp")
    with tmp.open("w") as f:
        json.dump(snapshot, f, indent=2, ensure_ascii=False)
        f.write("\n")
    tmp.replace(archive_path)
    print(f"  wrote {archive_path}")

    if success_count == 0:
        print("\nALL fetches failed - exiting with error", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
