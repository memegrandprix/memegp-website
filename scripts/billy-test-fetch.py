#!/usr/bin/env python3
"""
MEME GP — BILLY Data Fetch Test (CoinGecko + Ordiscan)
=======================================================
Verifies that we can pull BILLY's real Bitcoin Runes data from two
free APIs:
  - CoinGecko    → mcap, vol_24h, change_24h        (no API key needed)
  - Ordiscan     → holders, market info             (needs API key)

Reads ORDISCAN_API_KEY from environment.
"""

import json
import os
import sys
import urllib.request
import urllib.error

ORDISCAN_API_KEY = os.environ.get("ORDISCAN_API_KEY", "")

USER_AGENT = "memegrandprix-test/1.0"
TIMEOUT = 20

# CoinGecko: BILLY's API ID
COINGECKO_ID = "billion-dollar-cat-runes"

# Ordiscan: the canonical Rune name as Ordiscan expects it
RUNE_NAME = "BILLION%E2%80%A2DOLLAR%E2%80%A2CAT"   # URL-encoded "BILLION•DOLLAR•CAT"


def hit_get(url, label, headers=None):
    print()
    print("=" * 70)
    print(f"[{label}]")
    print(f"GET {url}")
    print("=" * 70)
    if headers is None:
        headers = {}
    headers.setdefault("User-Agent", USER_AGENT)
    headers.setdefault("Accept", "application/json")
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            print(f"  status: {resp.status}")
            body = resp.read().decode("utf-8", errors="replace")
            try:
                data = json.loads(body)
                pretty = json.dumps(data, indent=2)
                if len(pretty) > 3500:
                    print(pretty[:3500])
                    print(f"\n  ... (truncated, full response was {len(pretty):,} chars)")
                else:
                    print(pretty)
            except json.JSONDecodeError:
                print("  (non-JSON response)")
                print(body[:1500])
    except urllib.error.HTTPError as e:
        print(f"  HTTP error: {e.code} {e.reason}")
        try:
            err_body = e.read().decode("utf-8", errors="replace")
            print(f"  body: {err_body[:600]}")
        except Exception:
            pass
    except urllib.error.URLError as e:
        print(f"  network error: {e.reason}")
    except Exception as e:
        print(f"  unexpected: {type(e).__name__}: {e}")


def main():
    print("\n" + "#" * 70)
    print("# MEME GP — BILLY DATA FETCH TEST")
    print("# CoinGecko + Ordiscan combined probe")
    print("#" * 70)

    if not ORDISCAN_API_KEY:
        print("\n[!] ORDISCAN_API_KEY env var is missing.")
        print("    In GitHub Actions: Settings → Secrets → Actions")
        print("    Add a new secret named ORDISCAN_API_KEY")
        sys.exit(1)
    else:
        print(f"\n[ok] ORDISCAN_API_KEY loaded (length {len(ORDISCAN_API_KEY)} chars)")

    # CoinGecko: full coin data
    hit_get(
        f"https://api.coingecko.com/api/v3/coins/{COINGECKO_ID}"
        "?localization=false&tickers=false&community_data=false&developer_data=false",
        label="CoinGecko / coin info",
    )

    # Ordiscan endpoints
    ordiscan_headers = {"Authorization": f"Bearer {ORDISCAN_API_KEY}"}

    hit_get(
        f"https://api.ordiscan.com/v1/rune/{RUNE_NAME}/market",
        label="Ordiscan / rune market info",
        headers=ordiscan_headers,
    )

    hit_get(
        f"https://api.ordiscan.com/v1/rune/{RUNE_NAME}",
        label="Ordiscan / rune detail",
        headers=ordiscan_headers,
    )

    hit_get(
        f"https://api.ordiscan.com/v1/rune/{RUNE_NAME}/holders?limit=5",
        label="Ordiscan / rune holders (top 5 + total)",
        headers=ordiscan_headers,
    )

    print()
    print("=" * 70)
    print("DONE — copy ALL of the output above and paste it back to Claude.")
    print("=" * 70)


if __name__ == "__main__":
    main()
