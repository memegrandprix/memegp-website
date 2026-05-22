#!/usr/bin/env python3
"""
MEME GP — BILLY Data Fetch Test v2 (CoinGecko + Ordiscan)
==========================================================
Test v1 confirmed:
  - CoinGecko works (status 200, full data available)
  - Ordiscan auth works (no 401), but the rune name format is wrong

Test v2 tries multiple rune name formats against Ordiscan to find
the one their API accepts.
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

# Try several formats Ordiscan might accept.
# The Ordiscan URL slug is "billiondollarcat" (from CoinGecko's link list).
RUNE_NAME_CANDIDATES = [
    ("lowercase-noseparator", "billiondollarcat"),
    ("uppercase-noseparator", "BILLIONDOLLARCAT"),
    ("uppercase-bullet-encoded", "BILLION%E2%80%A2DOLLAR%E2%80%A2CAT"),
    ("uppercase-bullet-raw", "BILLION\u2022DOLLAR\u2022CAT"),
    ("rune-id-format", "845764:84"),
    ("rune-id-encoded", "845764%3A84"),
]


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
                if len(pretty) > 2500:
                    print(pretty[:2500])
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
            print(f"  body: {err_body[:300]}")
        except Exception:
            pass
    except urllib.error.URLError as e:
        print(f"  network error: {e.reason}")
    except Exception as e:
        print(f"  unexpected: {type(e).__name__}: {e}")


def main():
    print("\n" + "#" * 70)
    print("# MEME GP — BILLY DATA FETCH TEST v2")
    print("#" * 70)

    if not ORDISCAN_API_KEY:
        print("\n[!] ORDISCAN_API_KEY env var is missing.")
        sys.exit(1)
    print(f"\n[ok] ORDISCAN_API_KEY loaded (length {len(ORDISCAN_API_KEY)} chars)")

    # ============================================================
    # CoinGecko: grab just market_data (the part we care about)
    # ============================================================
    print("\n\n" + "#" * 70)
    print("# COINGECKO — market_data subset (the bit B-prime needs)")
    print("#" * 70)
    try:
        url = (
            f"https://api.coingecko.com/api/v3/coins/{COINGECKO_ID}"
            "?localization=false&tickers=false&community_data=false&developer_data=false"
        )
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        md = data.get("market_data") or {}
        print(json.dumps({
            "current_price_usd":           md.get("current_price", {}).get("usd"),
            "market_cap_usd":              md.get("market_cap", {}).get("usd"),
            "fully_diluted_valuation_usd": md.get("fully_diluted_valuation", {}).get("usd"),
            "total_volume_usd":            md.get("total_volume", {}).get("usd"),
            "price_change_percentage_24h": md.get("price_change_percentage_24h"),
            "price_change_percentage_7d":  md.get("price_change_percentage_7d"),
            "circulating_supply":          md.get("circulating_supply"),
            "total_supply":                md.get("total_supply"),
            "max_supply":                  md.get("max_supply"),
            "ath_usd":                     md.get("ath", {}).get("usd"),
            "atl_usd":                     md.get("atl", {}).get("usd"),
        }, indent=2))
    except Exception as e:
        print(f"  [error pulling CoinGecko market_data] {e}")

    # ============================================================
    # Ordiscan: try multiple rune name formats
    # ============================================================
    print("\n\n" + "#" * 70)
    print("# ORDISCAN — testing rune name format variants")
    print("#" * 70)
    headers = {"Authorization": f"Bearer {ORDISCAN_API_KEY}"}

    for fmt_label, name in RUNE_NAME_CANDIDATES:
        hit_get(
            f"https://api.ordiscan.com/v1/rune/{name}",
            label=f"rune detail · {fmt_label} · name='{name}'",
            headers=headers,
        )

    print("\n\n" + "#" * 70)
    print("# DONE — paste full output back to Claude")
    print("#" * 70)


if __name__ == "__main__":
    main()
