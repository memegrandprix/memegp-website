/**
 * MEME GP — Shared Stat Calculator
 * ============================================================
 * Single source of truth for the 5-stat formulas.
 *
 * Extracted from gp-central.html (lines 1517-1549) on 2026-05-19
 * during Friday-freeze build sprint sub-component 1.
 *
 * Used by:
 *   - gp-central.html        (live Pit Wall rendering)
 *   - team pages             (stat displays)
 *   - Friday-freeze snapshot (every Friday 09:00 SAST)
 *   - race engine            (consumes frozen stats)
 *
 * IMPORTANT: This file IS the formula. Any change here ripples
 * across the entire platform. Modify with care.
 * ============================================================
 */
(function (global) {
  'use strict';

  // ----- helpers -----
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function round(v) { return Math.round(v * 10) / 10; }

  /**
   * Compute the five stats from a token's on-chain snapshot.
   *
   * @param {object} d              — on-chain data
   * @param {number} d.mcap         — market cap (USD)
   * @param {number} d.vol          — 24h volume (USD)
   * @param {number} d.liq          — liquidity pool depth (USD)
   * @param {number} d.change24h    — 24h price change (percent, e.g. -5.03)
   * @param {number} [editorialPit] — PIT score (editorial, defaults to 4.0)
   *
   * @returns {object|null} { engine, aero, chassis, drag, pit, overall }
   *                       or null if mcap is missing/zero.
   */
  function calcStats(d, editorialPit) {
    if (!d || !d.mcap) return null;

    // ENGINE — raw power from market cap (log10, clamped 1.0–9.5)
    const engine = clamp(Math.log10(d.mcap), 1.0, 9.5);

    // AERO — downforce from trading velocity (turnover linear, clamped 1.0–9.5)
    const turnover = d.vol / d.mcap;
    const aero = clamp(turnover * 15 + 1.5, 1.0, 9.5);

    // CHASSIS — stiffness from liquidity depth (log10, clamped 1.0–9.5)
    // Null if liquidity is missing (excluded from overall average).
    const chassis = d.liq ? clamp(Math.log10(d.liq), 1.0, 9.5) : null;

    // DRAG — straight-line stability from price calm × volume health
    // Inactive tokens (24h vol < $500) get a 1.0 floor — penalty for dead trade.
    let drag;
    if ((d.vol || 0) < 500) {
      drag = 1.0;
    } else {
      const base = 10 - Math.abs(d.change24h || 0) / 3;
      const volHealth = clamp(Math.log10((d.vol / d.mcap) * 100) + 2, 0, 1.5);
      drag = clamp(base * volHealth, 1.0, 9.5);
    }

    // PIT — editorial today, formula activates with full holder/engagement data
    const pit = editorialPit != null ? editorialPit : 4.0;

    // OVERALL — mean of all non-null stats
    const stats = [engine, aero, chassis, drag, pit].filter(s => s !== null);
    const overall = stats.length ? stats.reduce((a, b) => a + b, 0) / stats.length : null;

    return {
      engine: round(engine),
      aero: round(aero),
      chassis: chassis !== null ? round(chassis) : null,
      drag: round(drag),
      pit: round(pit),
      overall: overall !== null ? round(overall) : null,
    };
  }

  // ----- formula metadata (mirrors STATS_META in gp-central.html) -----
  const STATS_META = {
    overall: { name: 'OVERALL', mechanics: 'LIVE',                              flavor: 'all stats combined',                                          icon: null },
    engine:  { name: 'ENGINE',  mechanics: 'MARKET CAP',                        flavor: 'biggest cars on the grid',                                    icon: 'icon-engine.png' },
    aero:    { name: 'AERO',    mechanics: '24H VOLUME \u00f7 MARKET CAP',      flavor: 'most active traders',                                         icon: 'icon-aero.png' },
    chassis: { name: 'CHASSIS', mechanics: 'LIQUIDITY DEPTH',                   flavor: 'deepest pools',                                               icon: 'icon-chassis.png' },
    drag:    { name: 'DRAG',    mechanics: 'PRICE STABILITY \u00d7 VOLUME HEALTH', flavor: 'smoothest at speed',                                      icon: 'icon-drag.png' },
    pit:     { name: 'PIT',     mechanics: 'ON-CHAIN COMMUNITY',                flavor: 'editorial today, formula activates with full holder data',    icon: 'icon-pit.png' },
  };

  // ----- public API -----
  const MEMEGP_Stats = {
    calcStats: calcStats,
    clamp: clamp,
    round: round,
    STATS_META: STATS_META,
  };

  // Browser global
  if (typeof window !== 'undefined') {
    global.MEMEGP_Stats = MEMEGP_Stats;
  }

  // CommonJS (Node.js — for the Friday-freeze snapshot script)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MEMEGP_Stats;
  }

})(typeof window !== 'undefined' ? window : globalThis);
