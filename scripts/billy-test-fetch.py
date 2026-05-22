#!/usr/bin/env python3
"""
MEME GP — BILLY Data Fetch Test v3 (Ordiscan endpoint discovery)
=================================================================
v2 confirmed:
  - Rune name format: BILLIONDOLLARCAT (uppercase, no separators)
  - /v1/rune/BILLIONDOLLARCAT works → returns rune metadata
  - But we still need HOLDERS and MARKET data

v3 tries multiple endpoint paths against the working rune name.
"""

import json
import os
import sys
import urllib.request
import urllib.error

ORDISCAN_API_KEY = os.environ.get("ORDISCAN_API_KEY", "")
USER_AGENT = "memegrandprix-test/1.0"
TIMEOUT = 20
COINGECKO_ID = "billion-dollar-cat-runes"

# Confirmed working rune name
RUNE = "BILLIONDOLLARCAT"

# Try every documented Ordiscan endpoint that might give us holders / market data.
# Based on common API patterns and the Ordiscan SDK we saw on GitHub.
ENDPOINTS_TO_TRY = [
    # Holders-related
    ("holders-v1",          f"https://api.ordiscan.com/v1/rune/{RUNE}/holders"),
    ("holders-with-limit",  f"https://api.ordiscan.com/v1/rune/{RUNE}/holders?limit=5"),
    ("rune-stats",          f"https://api.ordiscan.com/v1/rune/{RUNE}/stats"),
    ("rune-holder-count",   f"https://api.ordiscan.com/v1/rune/{RUNE}/holder-count"),
    # Market-related
    ("market",              f"https://api.ordiscan.com/v1/rune/{RUNE}/market"),
    ("market-info",         f"https://api.ordiscan.com/v1/rune/{RUNE}/market-info"),
    ("price",               f"https://api.ordiscan.com/v1/rune/{RUNE}/price"),
    # The SDK we saw used .getMarketInfo({name}) — maybe it's a query param
    ("market-q-param",      f"https://api.ordiscan.com/v1/runes/market?name={RUNE}"),
    # General list/search endpoint might include holders
    ("runes-list",          f"https://api.ordiscan.com/v1/runes?name={RUNE}"),
]


def hit_get(url, label, headers):
    print()
    print("=" * 70)
    print(f"[{label}]")
    print(f"GET {url}")
    print("=" * 70)
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            print(f"  ✅ status: {resp.status}")
            body = resp.read().decode("utf-8", errors="replace")
            try:
                data = json.loads(body)
                pretty = json.dumps(data, indent=2)
                if len(pretty) > 2000:
                    print(pretty[:2000])
                    print(f"\n  ... (truncated, full was {len(pretty):,} chars)")
                else:
                    print(pretty)
            except json.JSONDecodeError:
                print(body[:1200])
    except urllib.error.HTTPError as e:
        print(f"  ❌ HTTP {e.code} {e.reason}")
        try:
            err_body = e.read().decode("utf-8", errors="replace")
            print(f"     body: {err_body[:200]}")
        except Exception:
            pass
    except Exception as e:
        print(f"  ❌ {type(e).__name__}: {e}")


def main():
    print("\n" + "#" * 70)
    print("# MEME GP — BILLY DATA FETCH TEST v3")
    print("# Goal: find Ordiscan endpoints that return holders + market data")
    print("#" * 70)

    if not ORDISCAN_API_KEY:
        print("\n[!] ORDISCAN_API_KEY env var missing")
        sys.exit(1)
    print(f"\n[ok] API key loaded (length {len(ORDISCAN_API_KEY)})")

    headers = {
        "Authorization": f"Bearer {ORDISCAN_API_KEY}",
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
    }

    for label, url in ENDPOINTS_TO_TRY:
        hit_get(url, label, headers)

    print("\n\n" + "#" * 70)
    print("# DONE — paste full output to Claude")
    print("# Look for the endpoints with ✅ status: 200")
    print("#" * 70)


if __name__ == "__main__":
    main()
