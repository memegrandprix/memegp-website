/**
 * MEME GP — Shared Stat Calculator (B-prime, deployed 2026-05-19)
 * ============================================================
 * Single source of truth for the 5-stat formulas.
 *
 * Design: B-prime — approved May 17, 2026 (see transcript
 * 2026-05-17-14-33-38-memegp-formula-rebuild-magnet-strategy.txt)
 *
 * Used by:
 *   - gp-central.html        (live Pit Wall rendering)
 *   - team pages             (stat displays)
 *   - Friday-freeze snapshot (every Friday 09:00 SAST)
 *   - race engine            (consumes frozen stats)
 *
 * Why piecewise: the May 17 session diagnosed three problems with the
 * old simple-log formulas:
 *   1. DRAG ceiling pile-up (11 of 12 teams at 9.5)
 *   2. AERO scores compressed to 1-3 (no differentiation)
 *   3. ENGINE bottom too harsh ($10K coins → 1.0)
 *
 * B-prime fixes each by anchoring SCOREPOSTS at meaningful mcap/vol/liq
 * levels and interpolating between them, so growth is measurable and
 * the field spreads across the full 1.0-9.5 range.
 *
 * IMPORTANT: This file IS the formula. Any change here ripples
 * across the entire platform. Modify with care.
 * ============================================================
 */
(function (global) {
  'use strict';

  // ============================================================
  // PRE_REVEAL_MODE — Sunday 7 June 2026 inaugural rankings drop
  // ------------------------------------------------------------
  // When true: calcStats returns null for engine/aero/chassis/drag/overall
  // PIT stays visible (it's editorial, not measured)
  // Rendering pages already handle null via existing chassis logic
  //
  // FLIP TO FALSE Sunday 7 June after the countdown reveal completes.
  // ============================================================
  const PRE_REVEAL_MODE = false;   // LIVE — reveals complete, full grid public

  // ============================================================
  // FREEZE OVERRIDE — force the whole platform into frozen mode
  // ------------------------------------------------------------
  // The automatic freeze only covers Fri 09:00 -> Sun 23:59 SAST.
  // For a reveal that runs OUTSIDE that window (e.g. a Monday drop),
  // set this to true so the Pit Wall reads the locked snapshot.json
  // instead of going live and drifting mid-reveal. Flip back to
  // false once the reveal is done and you want live data again.
  // ============================================================
  const FREEZE_OVERRIDE = false;

  // ============================================================
  // STAGGERED REVEAL — inaugural Power Rankings drop
  // ------------------------------------------------------------
  // Reveals one team every `intervalMinutes`, worst OVR first
  // (P15 -> P1), purely time-gated on the client — NO redeploys.
  //
  // While `startUTC` is null, or before it passes, every score
  // stays hidden (the pre-reveal blackout). As each interval
  // elapses, the next team in `order` unlocks. Any page load — or
  // the 60s tick on open pages — shows the correct state for the
  // current time automatically.
  //
  // Set startUTC to an ISO-8601 UTC string once the time is locked,
  // e.g. '2026-06-07T14:00:00Z'. Flip PRE_REVEAL_MODE to false after
  // the drop completes to force everything live.
  // ============================================================
  const REVEAL = {
    startUTC: null,            // TODO: set when the Sunday start time is locked
    intervalMinutes: 30,
    // P15 -> P1 (worst OVR first, champion last).
    // VERIFIED against the frozen 2026-W23 snapshot + full history.json
    // (DRAG uses all days) via verify-reveal-order.js on 6 Jun 2026.
    // Near-ties within 0.1 OVR (a late move could swap these):
    //   MONKO / MARS         (2.9 / 3.0)
    //   PEPONK / MOMO / BILLY / VIBECOIN  (5.5 / 5.6 / 5.7 / 5.8)
    order: [
      'NEURO', 'MONKO', '420BLAZEIT', 'SUS', 'SHIH', 'DOBERMANN',
      'LOL', 'PEPONK', 'MOMO', 'BILLY', 'VIBECOIN', 'MASK', 'TURBO', 'PUP',
    ],
  };

  // PREVIEW KEY — open any page with ?preview=<this value> to force-reveal
  // everything IN THAT BROWSER ONLY (for screenshotting cards before the
  // public drop). Inert without the URL param. Use it on a LOCAL copy for
  // zero public exposure. Note: the key lives in this public file, so it's
  // convenience, not security — the truly private path is local-only.
  const PREVIEW_KEY = 'gp-grid-preview-2026';
  function _previewActive() {
    try {
      return typeof location !== 'undefined' &&
             typeof location.search === 'string' &&
             location.search.indexOf('preview=' + PREVIEW_KEY) !== -1;
    } catch (e) { return false; }
  }

  // How many teams are revealed as of `now` (Date, optional)?
  function revealedCount(now) {
    if (_previewActive()) return REVEAL.order.length; // preview: show the full grid
    if (!REVEAL.startUTC) return 0;
    const start = Date.parse(REVEAL.startUTC);
    if (isNaN(start)) return 0;
    const t = now ? now.getTime() : Date.now();
    if (t < start) return 0;
    const step = REVEAL.intervalMinutes * 60 * 1000;
    const count = Math.floor((t - start) / step) + 1; // team 1 reveals at start
    return Math.min(count, REVEAL.order.length);
  }

  // Is a given team's score revealed yet?
  // PRE_REVEAL_MODE === false is a master override -> everything live.
  function isRevealed(ticker, now) {
    if (_previewActive()) return true;          // preview: reveal in this browser only
    if (PRE_REVEAL_MODE === false) return true;
    const idx = REVEAL.order.indexOf(ticker);
    if (idx === -1) return true;   // unknown ticker -> don't hide it
    return idx < revealedCount(now);
  }

  // ----- helpers -----
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function round(v) { return Math.round(v * 10) / 10; }

  // ============================================================
  // ENGINE — raw power from market cap
  // ------------------------------------------------------------
  // Piecewise log10(mcap) with scoreposts:
  //   $10K   → 1.5  (entry-tier)
  //   $250K  → 4.5  (mid-tier)
  //   $5M    → 7.0  (strong)
  //   $100M+ → 9.5  (whale)
  // ============================================================
  function calcEngine(mcap) {
    if (!mcap || mcap <= 0) return 1.0;
    const lm = Math.log10(mcap);
    let raw;
    if (lm <= 4.0) {
      raw = 1.5;
    } else if (lm <= 5.4) {        // $10K → $250K
      raw = 1.5 + (4.5 - 1.5) * (lm - 4.0) / (5.4 - 4.0);
    } else if (lm <= 6.7) {        // $250K → $5M
      raw = 4.5 + (7.0 - 4.5) * (lm - 5.4) / (6.7 - 5.4);
    } else if (lm <= 8.0) {        // $5M → $100M
      raw = 7.0 + (9.5 - 7.0) * (lm - 6.7) / (8.0 - 6.7);
    } else {
      raw = 9.5;
    }
    return clamp(raw, 1.0, 9.5);
  }

  // ============================================================
  // AERO — downforce from trading activity
  // ------------------------------------------------------------
  // DUAL PATH: take the MAX of two scores. A team strong in EITHER
  // dimension gets credit. This fixes the old problem where huge-cap
  // teams with real volume scored low on turnover %.
  //
  // Path 1 (turnover): vol / mcap as %
  //   0.1%  → 1.0
  //   5%    → 5.0
  //   30%+  → 9.5
  //
  // Path 2 (absolute volume in USD):
  //   $50      → 1.0
  //   $5K      → 5.0
  //   $100K+   → 9.5
  // ============================================================
  function calcAero(mcap, vol) {
    if (!mcap || !vol) return 1.0;
    // Path 1 — turnover
    const turn = (vol / mcap) * 100;
    let aerTurn;
    if (turn <= 0.1) {
      aerTurn = 1.0;
    } else if (turn <= 5) {
      // log scale: log10(0.1) = -1, log10(5) ≈ 0.7
      aerTurn = 1.0 + 4.0 * (Math.log10(turn) - (-1)) / (Math.log10(5) - (-1));
    } else if (turn <= 30) {
      aerTurn = 5.0 + 4.5 * (Math.log10(turn) - Math.log10(5)) / (Math.log10(30) - Math.log10(5));
    } else {
      aerTurn = 9.5;
    }
    // Path 2 — absolute volume
    let aerAbs;
    if (vol <= 50) {
      aerAbs = 1.0;
    } else if (vol <= 5000) {
      aerAbs = 1.0 + 4.0 * (Math.log10(vol) - 1.7) / (3.7 - 1.7);
    } else if (vol <= 100000) {
      aerAbs = 5.0 + 4.5 * (Math.log10(vol) - 3.7) / (5.0 - 3.7);
    } else {
      aerAbs = 9.5;
    }
    return clamp(Math.max(aerTurn, aerAbs), 1.0, 9.5);
  }

  // ============================================================
  // CHASSIS — stiffness from liquidity depth (AMM teams)
  // ------------------------------------------------------------
  // Piecewise log10(liq) with scoreposts:
  //   $5K    → 1.0  (thin pool)
  //   $50K   → 5.0  (mid pool)
  //   $500K+ → 9.5  (deep pool)
  // Returns null if liq is missing — excluded from overall.
  // ============================================================
  function calcChassis(liq) {
    if (!liq || liq <= 0) return null;
    const ll = Math.log10(liq);
    let raw;
    if (ll <= 3.7) {              // ≤ $5K
      raw = 1.0;
    } else if (ll <= 4.7) {       // $5K → $50K
      raw = 1.0 + 4.0 * (ll - 3.7);
    } else if (ll <= 5.7) {       // $50K → $500K
      raw = 5.0 + 4.5 * (ll - 4.7);
    } else {
      raw = 9.5;
    }
    return clamp(raw, 1.0, 9.5);
  }

  // ============================================================
  // CHASSIS (Runes proxy) — for Bitcoin Runes teams
  // ------------------------------------------------------------
  // Bitcoin Runes don't have AMM liquidity pools. Magic Eden uses
  // an order book model that isn't directly comparable to AMM depth.
  // Holders data isn't available on free APIs (Ordiscan free tier
  // doesn't expose holder counts for runes).
  //
  // Proxy formula: wide log scale of absolute 24h volume, calibrated
  // so a healthy Bitcoin Runes market lands mid-pack:
  //   $500    → 1.0
  //   $5K     → 5.0
  //   $100K+  → 9.5
  //
  // This curve is DIFFERENT from AERO's abs-volume path (which has
  // the same scoreposts but combines with turnover via max()).
  // Here it's standalone, scaling absolute trade activity to chassis.
  //
  // Disclaimer: this is a proxy. Real holder integration is on
  // the platform roadmap. See teams-billy.html for the public note.
  // ============================================================
  function calcChassisRunes(vol) {
    if (!vol || vol <= 0) return 1.0;
    const lv = Math.log10(vol);
    let raw;
    if (lv <= 2.7) {              // ≤ $500
      raw = 1.0;
    } else if (lv <= 3.7) {       // $500 → $5K
      raw = 1.0 + 4.0 * (lv - 2.7);
    } else if (lv <= 5.0) {       // $5K → $100K
      raw = 5.0 + 4.5 * (lv - 3.7) / 1.3;
    } else {
      raw = 9.5;
    }
    return clamp(raw, 1.0, 9.5);
  }

  // ============================================================
  // DRAG — straight-line stability from multi-day data
  // ------------------------------------------------------------
  // Multi-day composite:
  //   drag_raw = 0.6 × vol_score + 0.4 × stab_score, then map to 1.0-9.5
  //
  //   vol_score:  log10(avg_vol) scaled (avg_vol $500 → 0, $100K → 10)
  //   stab_score: 10 - std_chg/2 (std 0 → 10, std 20+ → 0)
  //
  // FLOOR: if avg_vol < $500, drag = 1.0 (dead-trade penalty)
  //
  // history is an array of past snapshots, each with .teams[ticker]
  // containing { vol, change24h }. If history is missing/empty, falls
  // back to single-day (vol, change24h) from `d` itself.
  // ============================================================
  function calcDrag(d, history, ticker) {
    // Build the history we'll use — if no snapshots, use today only
    let chgs = [];
    let vols = [];
    if (history && history.length > 0 && ticker) {
      for (const snap of history) {
        const t = snap && snap.teams && snap.teams[ticker];
        if (t) {
          if (typeof t.change24h === 'number') chgs.push(t.change24h);
          else if (typeof t.change_24h === 'number') chgs.push(t.change_24h);
          if (typeof t.vol === 'number') vols.push(t.vol);
          else if (typeof t.vol_24h === 'number') vols.push(t.vol_24h);
        }
      }
    }
    // If no history found, use today's snapshot
    if (chgs.length === 0 && d) {
      chgs = [d.change24h || 0];
      vols = [d.vol || 0];
    }
    // Compute avg_vol
    const avgVol = vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : 0;
    // Floor: dead trade → 1.0
    if (avgVol < 500) return 1.0;
    // Compute std of change24h
    let std;
    if (chgs.length < 2) {
      std = Math.abs(chgs[0] || 0);
    } else if (chgs.length === 2) {
      // 2-point std — matches the Python: abs(diff) / sqrt(2)
      std = Math.abs(chgs[0] - chgs[1]) / Math.sqrt(2);
    } else {
      const mean = chgs.reduce((a, b) => a + b, 0) / chgs.length;
      const variance = chgs.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / (chgs.length - 1);
      std = Math.sqrt(variance);
    }
    // Score components
    // vol_score: (log10(avg_vol) - 2.7) / (5.0 - 2.7) * 10, clamped 0-10
    // So log10($500) = 2.7 → 0; log10($100K) = 5.0 → 10
    const volScore = clamp((Math.log10(avgVol) - 2.7) / (5.0 - 2.7) * 10, 0, 10);
    const stabScore = clamp(10 - std / 2, 0, 10);
    // Weighted composite (volume-led at 60/40)
    const dragRaw = 0.6 * volScore + 0.4 * stabScore;
    // Map 0-10 → 1.0-9.5 (so dead-perfect gets 9.5, dead-zero gets 1.0)
    const drag = 1.0 + (9.5 - 1.0) * dragRaw / 10;
    return clamp(drag, 1.0, 9.5);
  }

  // ============================================================
  // PIT — community raid score (weekly)
  // ------------------------------------------------------------
  // All teams start each race week at PIT = 5.0 (neutral baseline).
  // PIT moves up/down based on community raid performance on
  // designated MEME GP tweets during the week.
  //
  // The editorialPit value passed in comes from the TEAMS array
  // in gp-central.html — currently locked at 5.0 for all teams.
  // Future: post-race-1, this gets driven by raid scoring data.
  // Defaults to 5.0 if absent.
  // ============================================================
  function calcPit(editorialPit) {
    return editorialPit != null ? editorialPit : 5.0;
  }

  // ============================================================
  // MAIN — compute all 5 stats + OVERALL
  // ------------------------------------------------------------
  // @param {object} d              — today's on-chain data
  // @param {number} d.mcap         — market cap (USD)
  // @param {number} d.vol          — 24h volume (USD)
  // @param {number} d.liq          — liquidity pool depth (USD)
  // @param {number} d.change24h    — 24h price change (percent)
  // @param {number} [editorialPit] — PIT score (community raid; default 5.0)
  // @param {array}  [history]      — array of past snapshots for DRAG
  // @param {string} [ticker]       — team ticker (needed for history lookup)
  //
  // ============================================================
  // FROZEN BASE  —  Week-1 measurement, LOCKED Friday.
  // ------------------------------------------------------------
  // The market no longer moves these scores. Only earned upgrades
  // (+1 per locked stat) change a team's score. This is the single
  // source of truth: every page runs through calcStats, so editing
  // these two objects re-syncs the entire site at once.
  //
  // To record a new earned upgrade: add the stat to EARNED_UPGRADES.
  // To set a new weekly base: replace the numbers in FROZEN_BASE.
  //
  // >>> WEEK 2 ACTION (Fri 26 Jun 09:00 SAST): replace all 14 objects below
  //     with the new on-chain snapshot. Current values are the 2026-W23 base.
  //     MARS removed (grid integrity). PUP/BILLY earned upgrades persist via
  //     EARNED_UPGRADES and render green — do NOT bake them into the base.
  // ============================================================
  const FROZEN_BASE = {
    TURBO:      { engine: 9.0, aero: 6.9, chassis: 6.5, drag: 7.1 },
    MASK:       { engine: 5.7, aero: 6.6, chassis: 7.4, drag: 6.0 },
    NEURO:      { engine: 1.5, aero: 3.5, chassis: 1.4, drag: 1.0 },
    SUS:        { engine: 4.0, aero: 2.3, chassis: 4.0, drag: 3.3 },
    LOL:        { engine: 4.5, aero: 7.2, chassis: 5.1, drag: 4.7 },
    SHIH:       { engine: 3.9, aero: 4.2, chassis: 4.8, drag: 4.1 },
    VIBECOIN:   { engine: 5.6, aero: 6.7, chassis: 5.5, drag: 5.8 },
    '420BLAZEIT': { engine: 3.2, aero: 2.9, chassis: 3.1, drag: 3.3 },
    PUP:        { engine: 5.8, aero: 9.5, chassis: 8.3, drag: 7.8 },
    PEPONK:     { engine: 5.1, aero: 7.3, chassis: 5.1, drag: 5.0 },
    MOMO:       { engine: 4.9, aero: 5.2, chassis: 5.8, drag: 7.0 },
    DOBERMANN:  { engine: 4.9, aero: 5.0, chassis: 4.8, drag: 4.2 },
    MONKO:      { engine: 3.3, aero: 1.8, chassis: 3.2, drag: 1.0 },
    BILLY:      { engine: 6.0, aero: 5.6, chassis: 5.6, drag: 6.1 }
  };

  // Earned upgrades — locked stats per team (+1 each, permanent for the season).
  // PERMANENT: drives the green stat bars all season long. Never resets.
  const EARNED_UPGRADES = {
    BILLY: ['AERO'],
    PUP:   ['ENGINE', 'ENGINE']   // 2× ENGINE — Week-1 (5.8→6.8) + Week-2 (6.8→7.8). Stacks via occurrence count below.
  };

  // Upgrades earned THIS CYCLE — drives ONLY the DEVELOPMENT CYCLE "locked" state.
  // RESETS TO {} every Friday when a new window opens. This is the fix for the
  // "earned-last-week shows LOCKED again" bug: a stat earned in a prior week can be
  // a target AGAIN this week (its frozen base is still its lowest), and must read
  // "DEVELOPMENT IN PROGRESS" until it is earned THIS cycle — not pre-locked off the
  // permanent list. When the community hits a target's threshold this week, add the
  // stat here (and, if it's a fresh stat, to EARNED_UPGRADES above for the green bar).
  const CYCLE_EARNED = {
    PUP: ['ENGINE']   // Week-2 window: ENGINE target hit (6.8→7.8). Flips dev card green. Reset to {} next Friday.
  };

  // ============================================================
  // CYCLE WINDOW — the upgrade window auto-opens/closes on these moments,
  // so nobody has to remember to flip a flag each Friday.
  //   OPEN   (CYCLE_LOCKED=false): unearned targets show "DEVELOPMENT IN PROGRESS"
  //   CLOSED (CYCLE_LOCKED=true):  unearned targets show "UPGRADE FAILED"
  // Update these two ISO-UTC moments each cycle. Friday 09:00 SAST = 07:00 UTC.
  // ============================================================
  const CYCLE_OPEN_UTC  = '2026-06-26T07:00:00Z'; // Fri 26 Jun 09:00 SAST — new base snapshot + window OPENS
  const CYCLE_CLOSE_UTC = '2026-07-03T23:59:00Z'; // Fri 03 Jul 23:59 UTC — upgrade window LOCKS → Race Week 2
  function isCycleLocked(date){
    const now = date ? date.getTime() : Date.now();
    return now < Date.parse(CYCLE_OPEN_UTC) || now >= Date.parse(CYCLE_CLOSE_UTC);
  }
  const CYCLE_LOCKED = isCycleLocked();

  const FROZEN_PIT = 5.0; // PIT resets weekly to 5, not upgradeable

  function cleanTk(t){ return String(t == null ? '' : t).toUpperCase().replace(/^\$/, '').trim(); }

  // Pure frozen base (no upgrades) — for the dev cycle "base -> target" display.
  function getBaseStats(ticker){
    const b = FROZEN_BASE[cleanTk(ticker)];
    if (!b) return null;
    return { engine: b.engine, aero: b.aero, chassis: b.chassis, drag: b.drag, pit: FROZEN_PIT };
  }
  // Earned (locked) upgrade stat names for a team.
  function getEarned(ticker){
    return EARNED_UPGRADES[cleanTk(ticker)] || [];
  }
  // Stat names earned IN THE CURRENT CYCLE — for the dev-cycle locked state only.
  function getCycleEarned(ticker){
    return CYCLE_EARNED[cleanTk(ticker)] || [];
  }

  // Given the published opening-grid entries (from rankings.json), overlay the
  // CURRENT score (frozen base + earned upgrades), re-sort by it, and compute
  // movement vs the opening grid. Returns a new array sorted by current rank,
  // each entry carrying { rank, previous_rank, score, ...original fields }.
  // This makes the power rankings + per-team grid rank reflect upgrades from
  // the single source — edit EARNED_UPGRADES and the whole board re-sorts.
  function rankWithUpgrades(openingEntries){
    if (!Array.isArray(openingEntries)) return [];
    var rows = openingEntries.map(function(e){
      var s = calcStats({}, FROZEN_PIT, null, e.ticker);
      var cur = (s && s.overall != null) ? s.overall : e.score;
      var copy = {}; for (var k in e) { if (e.hasOwnProperty(k)) copy[k] = e[k]; }
      copy._openingRank = e.rank;
      copy.score = cur;
      return copy;
    });
    rows.sort(function(a, b){
      return (b.score - a.score) || (a._openingRank - b._openingRank);
    });
    rows.forEach(function(e, i){ e.rank = i + 1; e.previous_rank = e._openingRank; });
    return rows;
  }

  // @returns {object|null} {engine, aero, chassis, drag, pit, overall}
  //                        or null if mcap is missing/zero.
  // ============================================================
  function calcStats(d, editorialPit, history, ticker) {
    const pitVal = round(calcPit(editorialPit));

    // Reveal gate — hide a team's stats until its slot unlocks (PIT stays visible).
    if (!isRevealed(ticker)) {
      return { engine: null, aero: null, chassis: null, drag: null, pit: pitVal, overall: null };
    }

    // FROZEN PATH: return the locked Friday base + any earned upgrades.
    // The market does not move these — only upgrades do.
    const fb = getBaseStats(ticker);
    if (fb) {
      const up = getEarned(ticker);
      // Count occurrences so a stat upgraded across multiple weeks compounds (+1 each),
      // instead of capping at +1 via indexOf. PUP ENGINE = base 5.8 + 2 = 7.8.
      const bump = (name, val) => {
        let cnt = 0;
        for (let i = 0; i < up.length; i++) { if (up[i] === name) cnt++; }
        return Math.min(val + cnt, 9.5);
      };
      const eng = bump('ENGINE', fb.engine);
      const aer = bump('AERO', fb.aero);
      const cha = bump('CHASSIS', fb.chassis);
      const dra = bump('DRAG', fb.drag);
      const ovr = (eng + aer + cha + dra + pitVal) / 5;
      return {
        engine: round(eng), aero: round(aer), chassis: round(cha),
        drag: round(dra), pit: pitVal, overall: round(ovr)
      };
    }

    // LIVE FALLBACK: only used for tickers without a frozen base (safety net).
    if (!d || !d.mcap) return null;
    const engine  = calcEngine(d.mcap);
    const aero    = calcAero(d.mcap, d.vol || d.vol_24h || 0);
    let chassis;
    const vol = d.vol || d.vol_24h || 0;
    if (d.liq != null && d.liq > 0) {
      chassis = calcChassis(d.liq);
    } else if (vol > 0 && (d.dataSource === 'runes' || d.liq === null)) {
      chassis = calcChassisRunes(vol);
    } else {
      chassis = null;
    }
    const drag    = calcDrag(d, history, ticker);
    const stats = [engine, aero, chassis, drag, pitVal].filter(s => s !== null);
    const overall = stats.length ? stats.reduce((a, b) => a + b, 0) / stats.length : null;
    return {
      engine:  round(engine),
      aero:    round(aero),
      chassis: chassis !== null ? round(chassis) : null,
      drag:    round(drag),
      pit:     pitVal,
      overall: overall !== null ? round(overall) : null,
    };
  }

  // ----- formula metadata -----
  // Subtitles updated to reflect B-prime mechanics. Communities reading
  // this should understand what each stat measures and how to improve.
  const STATS_META = {
    overall: { name: 'OVERALL', mechanics: 'LIVE',                                       flavor: 'all stats combined',                                       icon: 'how-it-works.png' },
    engine:  { name: 'ENGINE',  mechanics: 'MARKET CAP',                                 flavor: 'biggest cars on the grid',                                 icon: 'icon-engine.png' },
    aero:    { name: 'AERO',    mechanics: 'TRADING ACTIVITY (TURNOVER OR ABS VOLUME)',  flavor: 'most active traders',                                      icon: 'icon-aero.png' },
    chassis: { name: 'CHASSIS', mechanics: 'LIQUIDITY DEPTH',                            flavor: 'deepest pools',                                            icon: 'icon-chassis.png' },
    drag:    { name: 'DRAG',    mechanics: 'MULTI-DAY VOLUME \u00d7 PRICE STABILITY',    flavor: 'smoothest at speed',                                       icon: 'icon-drag.png' },
    pit:     { name: 'PIT',     mechanics: 'COMMUNITY RAID SCORE',                       flavor: 'how loud is your community',                               icon: 'icon-pit.png' },
  };

  // ============================================================
  // MODE DETECTION — live vs frozen (Friday-Freeze mechanic)
  // ------------------------------------------------------------
  // Race weeks run Monday 00:00 SAST → Sunday 23:59 SAST.
  // Stats move LIVE Monday through Friday 09:00 SAST.
  // Stats are FROZEN Friday 09:00 SAST through Sunday 23:59 SAST.
  // On Monday 00:00 SAST, the new week starts fresh and stats move
  // again until the next Friday 09:00 freeze moment.
  //
  // SAST = UTC+2 year-round (no daylight saving in South Africa).
  // Friday 09:00 SAST = Friday 07:00 UTC.
  // Monday 00:00 SAST = Sunday 22:00 UTC.
  //
  // All functions accept an optional `date` parameter for testing.
  // ============================================================

  // SAST offset in milliseconds (UTC+2)
  const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

  // Convert a JS Date to a "SAST view" — a Date whose UTC methods
  // return SAST values. This is the standard trick for timezone math
  // without pulling in a library.
  function toSAST(date) {
    return new Date(date.getTime() + SAST_OFFSET_MS);
  }

  // Build a UTC Date from SAST components (year, month, day, hour).
  function fromSAST(year, month, day, hour, min) {
    return new Date(Date.UTC(year, month, day, hour, min || 0) - SAST_OFFSET_MS);
  }

  // getNextFreezeMoment(date) — when is the next Friday 09:00 SAST?
  // If `date` is exactly at a freeze moment, returns the NEXT one
  // (i.e. one week later). This keeps semantics clean: at freeze
  // moment, we're already frozen.
  function getNextFreezeMoment(date) {
    const now = date || new Date();
    const sastView = toSAST(now);
    const year  = sastView.getUTCFullYear();
    const month = sastView.getUTCMonth();
    const day   = sastView.getUTCDate();
    const dow   = sastView.getUTCDay(); // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
    // Days until Friday (5). If today IS Friday, that's 0 days unless
    // we're already past 09:00 SAST, in which case we want next Friday.
    let daysUntilFri = (5 - dow + 7) % 7;
    if (dow === 5) {
      // It's Friday in SAST — check the hour
      const h = sastView.getUTCHours();
      const m = sastView.getUTCMinutes();
      if (h > 9 || (h === 9 && m > 0)) {
        daysUntilFri = 7;
      } else if (h === 9 && m === 0) {
        // Exactly at the freeze moment → next one is in a week
        daysUntilFri = 7;
      }
    }
    return fromSAST(year, month, day + daysUntilFri, 9, 0);
  }

  // getLastFreezeMoment(date) — when was the most recent Friday 09:00 SAST?
  // If `date` is exactly at a freeze moment, returns THAT moment
  // (i.e. we just entered frozen mode this very instant).
  function getLastFreezeMoment(date) {
    const now = date || new Date();
    const sastView = toSAST(now);
    const year  = sastView.getUTCFullYear();
    const month = sastView.getUTCMonth();
    const day   = sastView.getUTCDate();
    const dow   = sastView.getUTCDay();
    // Days since Friday (5)
    let daysSinceFri = (dow - 5 + 7) % 7;
    if (dow === 5) {
      const h = sastView.getUTCHours();
      const m = sastView.getUTCMinutes();
      if (h < 9 || (h === 9 && m === 0)) {
        // Friday before or exactly at 09:00 — the last freeze was last Friday
        // (exception: exactly at 09:00 is the freeze moment itself)
        if (h === 9 && m === 0) {
          daysSinceFri = 0; // freeze moment is right now
        } else {
          daysSinceFri = 7; // last freeze was last Friday
        }
      }
      // Friday after 09:00 SAST — daysSinceFri = 0 is already correct
    }
    return fromSAST(year, month, day - daysSinceFri, 9, 0);
  }

  // getNextLiveMoment(date) — when does the next live week start?
  // Live mode begins Monday 00:00 SAST.
  function getNextLiveMoment(date) {
    const now = date || new Date();
    const sastView = toSAST(now);
    const year  = sastView.getUTCFullYear();
    const month = sastView.getUTCMonth();
    const day   = sastView.getUTCDate();
    const dow   = sastView.getUTCDay();
    // Days until next Monday (1)
    let daysUntilMon = (1 - dow + 7) % 7;
    if (dow === 1) {
      const h = sastView.getUTCHours();
      const m = sastView.getUTCMinutes();
      // If it's Monday and we're past 00:00 (which is basically always
      // unless we hit the exact instant), the next Monday is a week away
      if (h > 0 || m > 0) {
        daysUntilMon = 7;
      } else {
        // Exactly Monday 00:00 → next live moment is a week away
        daysUntilMon = 7;
      }
    }
    return fromSAST(year, month, day + daysUntilMon, 0, 0);
  }

  // getCurrentMode(date) — 'live' or 'frozen'?
  // Live:   Monday 00:00 SAST  →  Friday 09:00 SAST (exclusive)
  // Frozen: Friday 09:00 SAST  →  Monday 00:00 SAST (exclusive)
  function getCurrentMode(date) {
    if (FREEZE_OVERRIDE) return 'frozen';   // manual hold (reveal outside Fri-Sun)
    const now = date || new Date();
    const sastView = toSAST(now);
    const dow = sastView.getUTCDay();
    const h   = sastView.getUTCHours();
    const m   = sastView.getUTCMinutes();
    // Frozen window: Fri 09:00+ through Sun 23:59
    if (dow === 5 && (h > 9 || (h === 9 && m >= 0))) return 'frozen';
    if (dow === 6) return 'frozen'; // Saturday
    if (dow === 0) return 'frozen'; // Sunday
    // Everything else is live
    return 'live';
  }

  // ----- pre-reveal display helper -----
  // Pages can use this to render placeholders consistently.
  // Returns "—" for null/undefined (pre-reveal hidden), formatted number otherwise.
  function displayStat(value, decimals) {
    if (value === null || value === undefined || isNaN(value)) return '—';
    return Number(value).toFixed(decimals != null ? decimals : 1);
  }

  // ----- public API -----
  const MEMEGP_Stats = {
    // Stat computation
    calcStats:   calcStats,
    getBaseStats: getBaseStats,   // frozen base (no upgrades) — for dev cycle base→target
    getEarned:    getEarned,       // earned/locked upgrade stat names for a team
    getCycleEarned: getCycleEarned, // earned THIS cycle only — dev-cycle locked state
    cycleLocked:  CYCLE_LOCKED,     // true once the upgrade window has closed (computed from window below)
    isCycleLocked: isCycleLocked,   // live check: isCycleLocked(date?) for mid-session re-eval
    CYCLE_OPEN_UTC:  CYCLE_OPEN_UTC,
    CYCLE_CLOSE_UTC: CYCLE_CLOSE_UTC,
    rankWithUpgrades: rankWithUpgrades, // opening grid -> current standings + movement
    FROZEN_BASE:  FROZEN_BASE,
    EARNED_UPGRADES: EARNED_UPGRADES,
    CYCLE_EARNED: CYCLE_EARNED,
    calcEngine:  calcEngine,
    calcAero:    calcAero,
    calcChassis: calcChassis,
    calcChassisRunes: calcChassisRunes,
    calcDrag:    calcDrag,
    calcPit:     calcPit,
    clamp:       clamp,
    round:       round,
    STATS_META:  STATS_META,
    // Mode detection (Friday-Freeze)
    getCurrentMode:      getCurrentMode,
    getLastFreezeMoment: getLastFreezeMoment,
    getNextFreezeMoment: getNextFreezeMoment,
    getNextLiveMoment:   getNextLiveMoment,
    // Pre-reveal mode (flip PRE_REVEAL_MODE to false in source to disable)
    PRE_REVEAL_MODE:     PRE_REVEAL_MODE,
    displayStat:         displayStat,
    // Staggered reveal (Power Rankings drop)
    REVEAL:              REVEAL,
    revealedCount:       revealedCount,
    isRevealed:          isRevealed,
  };

  // Browser global
  if (typeof window !== 'undefined') {
    global.MEMEGP_Stats = MEMEGP_Stats;
  }
  // CommonJS (Node.js — for Friday-freeze snapshot script + tests)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MEMEGP_Stats;
  }

})(typeof window !== 'undefined' ? window : globalThis);
