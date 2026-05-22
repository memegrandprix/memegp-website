#!/usr/bin/env python3
"""
MEME GP - Daily DexScreener Snapshot (with Bitcoin Runes support)
==================================================================

Pulls live on-chain data for all grid teams and appends one row to
data/history.json. Runs daily at 09:00 SAST via GitHub Actions cron.

Two data source modes per team (via "dataSource" field in TEAMS):
  - "dexscreener"  → standard AMM fetch (12 teams)
  - "runes"        → CoinGecko + Ordiscan combo (BILLY only for now)

Bitcoin Runes integration notes:
  - CoinGecko provides: mcap_usd, vol_24h_usd, change_24h
  - Ordiscan provides:  BTC-denominated market data (sanity check / future)
  - Holders NOT available on free APIs → CHASSIS uses volume-only proxy
    (computed in stats-calculator.js, not here)

Run manually:
  python scripts/snapshot.py

Required env vars:
  ORDISCAN_API_KEY  (only needed for runes teams; harmless if absent for SOL/EVM)
"""

import json
import os
import sys
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path


# ============================================================
# TEAMS config — dataSource controls which fetcher is used
# ============================================================
TEAMS = [
    # 12 DexScreener-tracked teams
    {"ticker": "TURBO",      "dataSource": "dexscreener", "chain": "ETH", "contract": "0xa35923162c49cf95e6bf26623385eb431ad920d3"},
    {"ticker": "MASK",       "dataSource": "dexscreener", "chain": "SOL", "contract": "6MQpbiTC2YcogidTmKqMLK82qvE9z5QEm7EP3AEDpump"},
    {"ticker": "NEURO",      "dataSource": "dexscreener", "chain": "CRO", "contract": "0xCFE223d06b86568C24ffd17E8ac748DbAC096b3b"},
    {"ticker": "SUS",        "dataSource": "dexscreener", "chain": "SOL", "contract": "GpXv1GNGMzrKXCNnYFbZk5TaZXUdKJNu5cmtiUyBdoge"},
    {"ticker": "LOL",        "dataSource": "dexscreener", "chain": "SOL", "contract": "53Xy4g1RJnGR6saaJRDNoo1rYTGZ3W5U321EDdSa5BGD"},
    {"ticker": "SHIH",       "dataSource": "dexscreener", "chain": "BNB", "contract": "0xfCa5208e4074e06596CC28B47214A109E4c14444"},
    {"ticker": "VIBECOIN",   "dataSource": "dexscreener", "chain": "SOL", "contract": "AZbem4s8iLJE5eniDZJ7c8q1ahbfMwWgCA8TxVW2tDUB"},
    {"ticker": "MARS",       "dataSource": "dexscreener", "chain": "SOL", "contract": "EWAyfPVbo1LxrywXzkBRkqvG6d8KkrcdBvmASxcZdoge"},
    {"ticker": "420BLAZEIT", "dataSource": "dexscreener", "chain": "SOL", "contract": "Amyv5r77rhmDGMnsAHMxghMrJVGYitQDmkKt7wjdoge"},
    {"ticker": "PUP",        "dataSource": "dexscreener", "chain": "BNB", "contract": "0x73b84f7e3901f39fc29f3704a03126d317ab4444"},
    {"ticker": "PEPONK",     "dataSource": "dexscreener", "chain": "SOL", "contract": "Gqqdgfkn7bcsuBQZEk9oMBkqCv1bRXvPmTLs3sQ9pump"},
    {"ticker": "MOMO",       "dataSource": "dexscreener", "chain": "SOL", "contract": "G4zwEA9NSd3nMBbEj31MMPq2853Brx2oGsKzex3ebonk"},
    # 1 Bitcoin Runes team
    {"ticker": "BILLY",      "dataSource": "runes",       "chain": "BTC",
     "coingecko_id": "billion-dollar-cat-runes",
     "rune_name": "BILLIONDOLLARCAT"},
]

DX_CHAIN = {
    "ETH": "ethereum", "SOL": "solana", "BNB": "bsc", "CRO": "cronos",
}

DEXSCREENER_API   = "https://api.dexscreener.com/latest/dex/tokens/{contract}"
COINGECKO_API     = "https://api.coingecko.com/api/v3/coins/{id}"
ORDISCAN_API      = "https://api.ordiscan.com/v1/rune/{name}/market"
USER_AGENT        = "memegrandprix-snapshot/1.1"
TIMEOUT_SECONDS   = 15

ORDISCAN_API_KEY = os.environ.get("ORDISCAN_API_KEY", "")


def http_get_json(url, headers=None):
    """Shared HTTP helper. Returns parsed JSON or raises with descriptive error."""
    hdrs = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(url, headers=hdrs)
    with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
        if resp.status != 200:
            raise RuntimeError(f"HTTP {resp.status}")
        return json.loads(resp.read().decode("utf-8"))


# ============================================================
# Fetcher 1: DexScreener (unchanged from previous version)
# ============================================================
def fetch_team_dexscreener(team):
    contract = team["contract"]
    expected_chain = DX_CHAIN.get(team["chain"])
    url = DEXSCREENER_API.format(contract=contract)
    try:
        data = http_get_json(url)
    except urllib.error.URLError as e:
        return {"error": f"network: {e.reason}"}
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}"}

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


# ============================================================
# Fetcher 2: Bitcoin Runes (CoinGecko + Ordiscan)
# ============================================================
def fetch_team_runes(team):
    """
    Pull data from CoinGecko (mcap/vol/change) and Ordiscan (BTC sanity).
    No liquidity field — CHASSIS uses a volume-only proxy formula
    applied in stats-calculator.js when dataSource === 'runes'.

    Returns the same shape as fetch_team_dexscreener so downstream
    code stays uniform. liq is set to None to signal "use proxy".
    """
    cg_id = team.get("coingecko_id")
    rune_name = team.get("rune_name")
    if not cg_id or not rune_name:
        return {"error": "missing coingecko_id or rune_name in TEAMS config"}

    # ---- CoinGecko (primary source for mcap/vol/change) ----
    try:
        cg_url = (
            COINGECKO_API.format(id=cg_id)
            + "?localization=false&tickers=false"
            + "&community_data=false&developer_data=false"
        )
        cg_data = http_get_json(cg_url)
        md = cg_data.get("market_data") or {}
        mcap_usd       = (md.get("market_cap") or {}).get("usd")
        vol_24h_usd    = (md.get("total_volume") or {}).get("usd")
        change_24h     = md.get("price_change_percentage_24h")
        price_usd      = (md.get("current_price") or {}).get("usd")
    except urllib.error.URLError as e:
        return {"error": f"coingecko network: {e.reason}"}
    except Exception as e:
        return {"error": f"coingecko {type(e).__name__}: {e}"}

    # ---- Ordiscan (BTC-denominated cross-check, optional) ----
    # If Ordiscan fails, we still ship — CoinGecko is the primary source.
    ord_market = None
    if ORDISCAN_API_KEY:
        try:
            ord_url = ORDISCAN_API.format(name=rune_name)
            ord_headers = {"Authorization": f"Bearer {ORDISCAN_API_KEY}"}
            ord_data = http_get_json(ord_url, headers=ord_headers)
            ord_market = ord_data.get("data") or {}
        except Exception as e:
            # Non-fatal — log but continue with CoinGecko data only
            print(f"  [warn] Ordiscan fetch failed for {team['ticker']}: {e}", file=sys.stderr)

    return {
        "mcap":         mcap_usd,
        "fdv":          mcap_usd,    # Runes are fully diluted (no unlock schedule)
        "price":        price_usd,
        "vol_24h":      vol_24h_usd or 0,
        "liq":          None,         # Signal to stats-calculator: use proxy
        "change_24h":   change_24h or 0,
        # Extra Runes-specific fields (informational)
        "btc_mcap":         ord_market.get("market_cap_in_btc") if ord_market else None,
        "btc_price_sats":   ord_market.get("price_in_sats") if ord_market else None,
        "data_source_note": "coingecko+ordiscan",
    }


# ============================================================
# Router: pick fetcher based on dataSource
# ============================================================
def fetch_team(team):
    ds = team.get("dataSource", "dexscreener")
    if ds == "runes":
        return fetch_team_runes(team)
    if ds == "dexscreener":
        return fetch_team_dexscreener(team)
    return {"error": f"unknown dataSource: {ds}"}


def load_history(path):
    if not path.exists():
        return {"snapshots": []}
    try:
        with path.open() as f:
            data = json.load(f)
        if not isinstance(data, dict) or not isinstance(data.get("snapshots"), list):
            print(f"WARN {path} malformed - starting fresh", file=sys.stderr)
            return {"snapshots": []}
        return data
    except (json.JSONDecodeError, OSError) as e:
        print(f"WARN failed to read {path}: {e} - starting fresh", file=sys.stderr)
        return {"snapshots": []}


def save_history(path, history):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    with tmp.open("w") as f:
        json.dump(history, f, indent=2, ensure_ascii=False)
        f.write("\n")
    tmp.replace(path)


def main():
    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    timestamp = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    repo_root = Path(__file__).resolve().parent.parent
    history_path = repo_root / "data" / "history.json"

    print(f"MEME GP snapshot - {timestamp}")
    print(f"  history file: {history_path}")
    print(f"  ORDISCAN_API_KEY: {'set' if ORDISCAN_API_KEY else 'NOT SET (runes teams will skip BTC cross-check)'}")
    print()

    history = load_history(history_path)

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

    new_row = {"date": today, "captured_at": timestamp, "teams": teams_data}
    snapshots = history["snapshots"]
    existing_idx = next((i for i, s in enumerate(snapshots) if s.get("date") == today), None)
    if existing_idx is not None:
        print(f"  overwriting existing snapshot for {today}")
        snapshots[existing_idx] = new_row
    else:
        print(f"  appending new snapshot for {today}")
        snapshots.append(new_row)

    save_history(history_path, history)
    print(f"  wrote {history_path}")
    print(f"  total snapshots: {len(snapshots)}")

    if success_count == 0:
        print("\nALL fetches failed - exiting with error", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
