# 🏁 TEAM 11 (PEPONK) DEPLOY PACKAGE — May 17, 2026

## What's in this folder

17 files ready to push to the repo. Two new files (teams-peponk.html, pit-scores.json) and 15 modified files.

## Deploy checklist

### Files to ADD (new)
- `teams-peponk.html` → repo root (new team page)

### Files to REPLACE (modified)
- `gp-central.html` → repo root
- `news.json` → repo root  
- `season-2.html` → repo root
- `about.html` → repo root
- `join.html` → repo root
- `pit-scores.json` → repo `data/` folder (REPLACES `data/pit-scores.json`)
- All 10 team pages → repo root:
  - `teams-turbo.html`
  - `teams-mask.html`
  - `teams-neuroticat.html`
  - `teams-sus.html`
  - `teams-lol.html`
  - `teams-shih.html`
  - `teams-vibe.html`
  - `teams-mars.html`
  - `teams-420blazeit.html`
  - `teams-pup.html` (NB: also contains the `$PUP → PUP` driver-block bug fix from earlier)

### Image assets (Pieter to handle)
Three new PNGs need to be in the repo root before Push, or the team page will show broken images:
- `peponk.png` — the cigar frog logo (already uploaded earlier — drop into repo)
- `peponk-driver.png` — placeholder for now, Grok-generated later
- `peponk-car.png` — placeholder for now, Grok-generated later

Suggest: use `peponk.png` as a temporary stand-in for both `peponk-driver.png` and `peponk-car.png` until proper images are generated. Just rename copies.

## What changed

| File | Change |
|---|---|
| `teams-peponk.html` | NEW — full team page, PEPONK orange (#FB8802), driver "Peponk", car PEPONK-01, livery PEPONK ORANGE, stats 5.1 overall (ENG 4.7 / AER 5.8 / CHA 4.8 / DRG 5.0 / PIT 5.0) |
| `gp-central.html` | TEAMS array gets PEPONK at slot 11 (Solana, FB8802 color) |
| `news.json` | New OFFICIAL TEAM 11 card prepended at top of items |
| `season-2.html` | Banner counters LOCKED 11 / OPEN 4, progress bar 73.33%, PEPONK card at position 11 |
| `about.html` | TEAMS LOCKED counter "11 / 15" + PEPONK appended to ticker list |
| `join.html` | Page subtitle "4 remaining", status pills LOCKED 11 / OPEN 4, **3 stale meta descriptions fixed** (were "7 remaining" — now "4 remaining") |
| 10 team pages | Mini-grid TEAMS array adds PEPONK after PUP, loop start changes i=11 → i=12, grid-strip counter "11 / 15 LOCKED" |
| `teams-pup.html` | ALSO fixes the `$PUP → PUP` driver-block bug from earlier (independent of the Team 11 deploy) |
| `pit-scores.json` | Adds PEPONK: 5.0 (launch state) |

## X ANNOUNCE TWEET — ready to fire

```
🏁 OFFICIAL TEAM 11 — @peponkwtf

$PEPONK — PEPE meets BONK — joins the grid.

DRIVER: Peponk
CAR: PEPONK-01
LIVERY: PEPONK ORANGE

Bonk taught Solana how to meme. Pepe taught the internet how to hold.

memegrandprix.com/teams-peponk.html

lights out · june 1.

$MEMEGP
```

Char count: ~275 (under 280 limit ✓)

## Push order (recommended)

1. Drop `peponk.png` into repo root (and rename copies for placeholder driver/car if needed)
2. Replace all 17 files in repo
3. Test locally if you can (load season-2.html, see counter shows 11/15)
4. Commit: `feat: add PEPONK as Team 11 + fix PUP driver-block bug`
5. Push to git
6. Wait for Vercel to deploy
7. Verify live site shows 11 teams
8. **Fire the announce tweet on X**

## Known cosmetic items NOT addressed in this deploy

- Mini-grid OVR values across team pages still show pre-formula-rebuild numbers (TURBO 7.7, NEURO 3.7, etc). These are "race-day commit" values per your decision. Will need a sweep before Race 1 to sync with live Pit Wall.
- The full font/logo/styling pass on the PEPONK car block — uses generic PUP-styled CSS for now.

🏁 lights out · june 1.
