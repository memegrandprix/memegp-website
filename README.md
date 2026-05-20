# 🏁 TEAM 12 (MOMO) DEPLOY PACKAGE — May 18, 2026

## What's in this folder

18 files. One new (`teams-momo.html`), 17 modified.

## MOMO — locked spec

- **Ticker:** MOMO
- **Display name:** MOMO MOTORS
- **Chain:** SOL
- **Contract:** G4zwEA9NSd3nMBbEj31MMPq2853Brx2oGsKzex3ebonk
- **Color:** `#F989B9` (Bubblegum Pink)
- **Driver:** Queen Momo
- **Car:** QUEEN-01
- **Livery:** BUBBLEGUM PINK
- **X handle:** @Momo_bonk
- **Identity:** Queen of Shibas

## Launch stats (formula-locked)

| Stat | Score | Derivation |
|---|---|---|
| ENGINE | 5.6 | Market cap $966.56K |
| AERO | 9.5 | 24h vol $526K = formula ceiling |
| CHASSIS | 7.0 | Liquidity ~$138K |
| DRAG | 5.0 | No 7-day history yet |
| PIT | 5.0 | Launch state |
| **OVERALL** | **6.4** | **Debuts at P4** |

## Deploy checklist

### Files to ADD (new)
- `teams-momo.html` → repo root

### Files to REPLACE
- `gp-central.html` → repo root (added MOMO to TEAMS array)
- `news.json` → repo root (new TEAM 12 card at top)
- `season-2.html` → repo root (counters 12/15, progress 80%, GRID PROGRESS 12, MOMO card position 12)
- `about.html` → repo root (counter 12/15 + MOMO appended to ticker list)
- `join.html` → repo root (3 remaining seats, LOCKED 12, OPEN 3 — including all 3 stale meta descriptions)
- `pit-scores.json` → repo `data/` folder (now 12 teams)
- All 11 existing team pages → repo root (mini-grid TEAMS array adds MOMO after PEPONK, loop start i=13, counter "12 / 15 LOCKED")

### Image assets — from `/mnt/user-data/outputs/momo-images/`
Drop into repo root:
- `momo.png`
- `momo-driver.png` (placeholder = the logo)
- `momo-car.png` (placeholder = the logo)
- `momo-card.png` (OG/Twitter card image)

Replace with Grok-generated images later when available.

## X ANNOUNCE TWEET

```
🏁 OFFICIAL TEAM 12 — @Momo_bonk

$MOMO — Queen of Shibas — joins the grid.

DRIVER: Queen Momo
CAR: QUEEN-01
LIVERY: BUBBLEGUM PINK

First female Shiba Inu on Solana. Debuting at P4.

memegrandprix.com/teams-momo.html

race week · june 1.

$MEMEGP
```

Char count: ~263 (under 280 ✓)

Note: uses the new "race week · june 1" signoff (not "lights out · june 1") per the tagline framework locked earlier today.

## Suggested commit message

```
feat: add MOMO MOTORS as Team 12

- Add teams-momo.html (Queen Momo, Bubblegum Pink, Solana)
- Launch stats: 6.4 overall (debuts at P4)
- Update all counters: season-2 (12/15 + 80% bar + GRID PROGRESS 12), about, join
- Add MOMO to TEAMS arrays across gp-central + 11 existing team page mini-grids
- Update pit-scores.json launch state to include MOMO
```

🏁 race week · june 1.
