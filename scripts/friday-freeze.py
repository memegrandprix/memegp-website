#!/usr/bin/env python3
"""
MEME GP - Friday-Freeze Weekly Snapshot (with Bitcoin Runes support)
=====================================================================
Runs every Friday at 09:00 SAST (07:00 UTC) via GitHub Actions.

Same dual-source logic as snapshot.py:
  - dexscreener teams → DexScreener API
  - runes teams       → CoinGecko + Ordiscan

Writes:
  data/snapshot.json
  data/snapshots/YYYY-MM-DD.json

Required env vars:
  ORDISCAN_API_KEY  (used by runes teams only)
"""

import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

# Import the shared TEAMS config + fetchers from snapshot.py to keep
# them as a single source of truth. We're in the same scripts/ folder.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from snapshot import TEAMS, fetch_team  # noqa: E402


def iso_week_string(date):
    year, week, _ = date.isocalendar()
    return f"{year}-W{week:02d}"


def get_freeze_timestamp():
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
            print(f"  FAIL {team['ticker']:11} ({team['chain']:3} {team['dataSource']:11}) - {result['error']}")
        else:
            success_count += 1
            mcap = result.get("mcap") or 0
            print(f"  OK   {team['ticker']:11} ({team['chain']:3} {team['dataSource']:11}) - mcap ${mcap:,.0f}")

    print()
    print(f"  fetched: {success_count}/{len(TEAMS)} ok, {error_count} errors")

    snapshot = {
        "frozen_at":   timestamp,
        "freeze_week": iso_week_string(now),
        "teams":       teams_data,
    }

    data_dir.mkdir(parents=True, exist_ok=True)
    archive_dir.mkdir(parents=True, exist_ok=True)

    tmp = snapshot_path.with_suffix(".json.tmp")
    with tmp.open("w") as f:
        json.dump(snapshot, f, indent=2, ensure_ascii=False)
        f.write("\n")
    tmp.replace(snapshot_path)
    print(f"  wrote {snapshot_path}")

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
