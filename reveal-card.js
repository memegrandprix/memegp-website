/* ============================================================
 * MEME GP — reveal-card.js
 * ============================================================
 * Self-filling reveal card (shared across all 15 team pages).
 *
 *  0) AUTO-FILL STATS — reads data/snapshot.json (frozen) + data/history.json,
 *     finds THIS team, runs the same calcStats as the Pit Wall (same snapshot,
 *     same editorialPit, same history) and writes ENGINE/AERO/CHASSIS/DRAG/PIT
 *     + OVERALL + market cap into the card. Guaranteed identical to gp-central.
 *     calcStats applies the staggered reveal gate, so measured stats read "—"
 *     until this team's slot unlocks; PIT + market cap are always shown.
 *
 *  1) UPGRADE TARGETS — highlights the 2 LOWEST of the four upgradeable stats
 *     (ENGINE/AERO/CHASSIS/DRAG) in red. PIT excluded. red = vote to upgrade.
 *
 *  2) GRID RANK + MOVEMENT — rank strip between stats and market cap. Rank +
 *     week-over-week movement read from rankings.json (same file the Power
 *     Rankings use), so the card and Power Rankings never disagree.
 *       ▲N up · ▼N down · – held · NEW first appearance
 *
 * Requires: stats-calculator.js loaded first.
 * Drop-in: <script src="reveal-card.js"></script> after the inline TEAMS
 * script. Self-injects CSS.
 * ============================================================ */

(function () {
  'use strict';

  var UPGRADEABLE = ['ENGINE', 'AERO', 'CHASSIS', 'DRAG'];
  var PIT_BASE = 5.0; // editorial PIT — matches gp-central TEAMS editorialPit

  var _data = { rankings: null, snapshot: null, history: null, upgrades: null };
  var _fetched = false;

  // -------------------------------------------------------
  // CSS
  // -------------------------------------------------------
  function injectCSS() {
    if (document.getElementById('reveal-card-css')) return;
    var el = document.createElement('style');
    el.id = 'reveal-card-css';
    el.textContent = [
      '.stat-row.is-upgrade-target .stat-row-fill{background:linear-gradient(180deg,#ff0040,#a3002a);}',
      // target: gold base fill, then a hatched-red ghost showing the +1 up for grabs (score->ghost)
      '.stat-row.is-upgrade-target .stat-row-main{position:relative;background:linear-gradient(90deg,',
      '  rgba(255,204,0,.18) 0%, rgba(255,204,0,.18) var(--score-pct,0%),',
      '  transparent var(--score-pct,0%), transparent 100%);}',
      '.stat-row.is-upgrade-target .stat-row-main::before{content:"";position:absolute;top:0;bottom:0;',
      '  left:var(--score-pct,0%);width:calc(var(--ghost-pct,0%) - var(--score-pct,0%));',
      '  background:repeating-linear-gradient(135deg,rgba(255,43,80,.40) 0 6px,rgba(255,43,80,.14) 6px 12px);',
      '  border-left:2px dashed rgba(255,43,80,.7);pointer-events:none;z-index:0;}',
      // keep stat name + value painted above the ghost layer
      '.stat-row-main .stat-row-name,.stat-row-main .stat-row-value{position:relative;z-index:1;}',
      '.stat-row.is-upgrade-target .stat-row-value{color:#ff2b5e;}',
      '.stat-row.is-upgrade-target .stat-row-name{color:#ff6688;}',
      '.stat-row.is-upgrade-target .stat-row-name::after{content:"\\25B2 UPGRADE";',
      '  font-family:\'Orbitron\',sans-serif;font-size:8px;font-weight:900;letter-spacing:1px;',
      '  color:#ff2b5e;border:1px solid rgba(255,0,64,.5);border-radius:4px;',
      '  padding:2px 5px;margin-left:10px;vertical-align:middle;white-space:nowrap;}',
      // EARNED upgrade (locked) — green
      '.stat-row.is-upgrade-earned .stat-row-fill{background:linear-gradient(180deg,#16c784,#0e8f5e);}',
      // gold up to the frozen base (--base-pct), green for the earned +1 (base->score)
      '.stat-row.is-upgrade-earned .stat-row-main{background:linear-gradient(90deg,',
      '  rgba(255,204,0,.18) 0%, rgba(255,204,0,.18) var(--base-pct,0%),',
      '  rgba(22,199,132,.30) var(--base-pct,0%), rgba(22,199,132,.30) var(--score-pct,0%),',
      '  transparent var(--score-pct,0%), transparent 100%);}',
      '.stat-row.is-upgrade-earned .stat-row-value{color:#16c784;}',
      '.stat-row.is-upgrade-earned .stat-row-name{color:#3fe0a0;}',
      '.stat-row.is-upgrade-earned .stat-row-name::after{content:"\\25B2 UPGRADED";',
      '  font-family:\'Orbitron\',sans-serif;font-size:8px;font-weight:900;letter-spacing:1px;',
      '  color:#16c784;border:1px solid rgba(22,199,132,.5);border-radius:4px;',
      '  padding:2px 5px;margin-left:10px;vertical-align:middle;white-space:nowrap;}',
      // BOTH earned + target: keep the green earned section + value, but the badge reads UPGRADE (red)
      '.stat-row.is-upgrade-earned.is-upgrade-target .stat-row-name::after{content:"\\25B2 UPGRADE";',
      '  color:#ff2b5e;border-color:rgba(255,0,64,.5);}',
      '  background:#0a0a12;border:1px solid var(--line,#23232e);border-radius:6px;',
      '  padding:11px 18px;margin:0 0 10px;}',
      '.rank-strip-label{font-family:\'Orbitron\',sans-serif;font-size:11px;font-weight:700;',
      '  letter-spacing:2px;color:var(--dim,#8a8a99);}',
      '.rank-strip-right{display:flex;align-items:center;gap:10px;}',
      '.rank-strip-value{font-family:\'Orbitron\',sans-serif;font-weight:900;letter-spacing:1px;',
      '  color:var(--gold,#ffcc00);font-size:22px;line-height:1;}',
      '.rank-mv{display:inline-flex;align-items:center;gap:4px;font-family:\'Orbitron\',sans-serif;',
      '  font-weight:900;font-size:12px;letter-spacing:.5px;padding:3px 8px;border-radius:5px;}',
      '.rank-mv--up{background:rgba(22,199,132,.15);border:1px solid rgba(22,199,132,.5);color:#16c784;}',
      '.rank-mv--down{background:rgba(255,59,92,.15);border:1px solid rgba(255,59,92,.5);color:#ff3b5c;}',
      '.rank-mv--flat{background:rgba(255,204,0,.13);border:1px solid rgba(255,204,0,.45);color:#ffcc00;}',
      '.rank-mv--new{background:rgba(138,138,153,.15);border:1px solid rgba(138,138,153,.5);color:#b8b8c4;}',
      '.rank-strip--locked .rank-strip-value{color:var(--dim,#8a8a99);}'
    ].join('');
    document.head.appendChild(el);
  }

  // -------------------------------------------------------
  // HELPERS
  // -------------------------------------------------------
  function clean(t) { return String(t || '').replace(/^\$/, '').toUpperCase(); }
  function r1(n) { return (Math.round(n * 10) / 10).toFixed(1); }

  function fmtUsd(n) {
    if (n == null || !isFinite(n)) return '\u2014';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }

  function currentTicker() {
    var el = document.querySelector('.driver-ticker .ticker');
    if (el && el.textContent.trim()) return el.textContent.trim();
    try {
      if (typeof TEAMS !== 'undefined') {
        var c = TEAMS.find(function (t) { return t.current; });
        if (c) return c.ticker;
      }
    } catch (e) {}
    return null;
  }

  function isRevealed(ticker) {
    var S = window.MEMEGP_Stats;
    if (!S || typeof S.isRevealed !== 'function') return false;
    return S.isRevealed(clean(ticker));
  }

  function statRowMap() {
    var map = {};
    document.querySelectorAll('.stat-list .stat-row').forEach(function (row) {
      var nameEl = row.querySelector('.stat-row-name');
      if (!nameEl) return;
      var name = nameEl.textContent.trim().toUpperCase();
      var valEl = row.querySelector('.stat-row-value');
      var v = valEl ? parseFloat(valEl.textContent) : NaN;
      map[name] = { row: row, valEl: valEl, value: isFinite(v) ? v : null };
    });
    return map;
  }

  // -------------------------------------------------------
  // AUTO-FILL from snapshot (mirrors gp-central renderFrozenMode inputs)
  // -------------------------------------------------------
  function snapshotTeam(ticker) {
    var sn = _data.snapshot;
    if (!sn || !sn.teams) return null;
    var tk = clean(ticker);
    var keys = Object.keys(sn.teams);
    for (var i = 0; i < keys.length; i++) {
      if (clean(keys[i]) === tk) return sn.teams[keys[i]];
    }
    return null;
  }

  function writeStat(map, name, val) {
    var e = map[name];
    if (!e) return;
    if (e.valEl) e.valEl.textContent = (val == null ? '\u2014' : r1(val));
    e.row.style.setProperty('--score-pct', (val == null ? 0 : Math.max(0, Math.min(100, val * 10))) + '%');
  }

  function populate(ticker, map) {
    var S = window.MEMEGP_Stats;
    var t = snapshotTeam(ticker);
    if (!S || typeof S.calcStats !== 'function' || !t) return; // nothing to fill — leave HTML as-is

    var data = {
      mcap: t.mcap, price: t.price, vol: t.vol_24h,
      liq: t.liq, change24h: t.change_24h, dataSource: 'dexscreener'
    };
    var stats = S.calcStats(data, PIT_BASE, _data.history, clean(ticker));

    writeStat(map, 'ENGINE', stats.engine);
    writeStat(map, 'AERO', stats.aero);
    writeStat(map, 'CHASSIS', stats.chassis);
    writeStat(map, 'DRAG', stats.drag);
    writeStat(map, 'PIT', stats.pit);

    var ov = document.querySelector('.block-header-overall-num');
    if (ov) ov.textContent = (stats.overall == null ? '\u2014' : r1(stats.overall));

    var mcEl = document.querySelector('.mcap-strip-value');
    if (mcEl) mcEl.innerHTML = '<span class="currency">$</span>' + fmtUsd(data.mcap).replace('$', '');
    var volEl = document.querySelector('.mcap-strip-right .vol');
    if (volEl) volEl.textContent = fmtUsd(data.vol);
    var snapEl = document.querySelector('.mcap-strip-right .snapshot');
    if (snapEl && _data.snapshot && _data.snapshot.frozen_at) {
      var d = new Date(_data.snapshot.frozen_at);
      snapEl.textContent = 'Snapshot \u00b7 ' + d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    }
  }

  // -------------------------------------------------------
  // 2-LOWEST HIGHLIGHT
  // -------------------------------------------------------
  function lowestTwo(map) {
    var items = UPGRADEABLE.map(function (name, i) { return { name: name, i: i, e: map[name] }; })
      .filter(function (x) { return x.e; });
    if (items.length < 2) return null;
    // Prefer stats that actually have a value; only fall back to all if fewer than 2 are valued.
    // A team missing a stat (e.g. no liquidity -> CHASSIS null) still gets a clean 2-upgrade cycle
    // rather than collapsing the whole section.
    var valued = items.filter(function (x) { return x.e.value !== null; });
    var pool = (valued.length >= 2) ? valued : items;
    pool.sort(function (a, b) {
      var av = (a.e.value == null) ? Infinity : a.e.value;
      var bv = (b.e.value == null) ? Infinity : b.e.value;
      return av !== bv ? av - bv : a.i - b.i;
    });
    return [pool[0].name, pool[1].name];
  }
  function applyHighlight(map, baseMap, targets, earned) {
    var earnedArr = earned || [];
    UPGRADEABLE.forEach(function (name) {
      var e = map[name];
      if (!e) return;
      var isEarned = earnedArr.indexOf(name) !== -1;
      // a stat can be BOTH earned (keeps its green section) and a current target (reads UPGRADE)
      var isTarget = !!targets && targets.indexOf(name) !== -1;
      e.row.classList.toggle('is-upgrade-earned', isEarned);              // green = earned section
      e.row.classList.toggle('is-upgrade-target', isTarget);             // red = still a target
      // gold base | green earned: gold runs to the frozen base, green is the earned +1
      if (isEarned) {
        var base = (baseMap && baseMap[name] && baseMap[name].value != null)
          ? baseMap[name].value
          : (e.value != null ? e.value - 1 : 0);
        e.row.style.setProperty('--base-pct', Math.max(0, Math.min(100, base * 10)) + '%');
      } else {
        e.row.style.removeProperty('--base-pct');
      }
      // gold base | red ghost: hatched zone marks the +1 the community can still earn
      if (isTarget) {
        var cur = (e.value != null) ? e.value : 0;
        var ghost = Math.min(cur + 1, 9.5);
        e.row.style.setProperty('--ghost-pct', Math.max(0, Math.min(100, ghost * 10)) + '%');
      } else {
        e.row.style.removeProperty('--ghost-pct');
      }
    });
  }

  // -------------------------------------------------------
  // RANK + MOVEMENT (from rankings.json)
  // -------------------------------------------------------
  function rankingEntry(ticker) {
    var r = _data.rankings;
    if (!r || !Array.isArray(r.weeks) || !r.weeks.length) return null;
    var wk = r.weeks[0];
    if (!wk || !Array.isArray(wk.rankings)) return null;
    var tk = clean(ticker);
    return wk.rankings.find(function (e) { return clean(e.ticker) === tk; }) || null;
  }
  function computeRank(ticker) {
    var S = window.MEMEGP_Stats;
    if (!S || !S.REVEAL || !Array.isArray(S.REVEAL.order)) return null;
    var idx = S.REVEAL.order.indexOf(clean(ticker));
    return idx === -1 ? null : S.REVEAL.order.length - idx;
  }
  function getMovement(rank, prev) {
    if (prev == null) return { kind: 'new', delta: 0 };
    var d = prev - rank;
    if (d > 0) return { kind: 'up', delta: d };
    if (d < 0) return { kind: 'down', delta: -d };
    return { kind: 'flat', delta: 0 };
  }
  function movementChip(mv) {
    if (mv.kind === 'new') return '<span class="rank-mv rank-mv--new">NEW</span>';
    if (mv.kind === 'flat') return '<span class="rank-mv rank-mv--flat">\u2013</span>';
    return '<span class="rank-mv rank-mv--' + mv.kind + '">' + (mv.kind === 'up' ? '\u25B2' : '\u25BC') + ' ' + mv.delta + '</span>';
  }
  function renderRank(ticker, revealed) {
    var block = document.querySelector('.block-stats');
    if (!block) return;
    var mcap = block.querySelector('.mcap-strip');
    var strip = block.querySelector('.rank-strip');
    if (!strip) {
      strip = document.createElement('div');
      strip.className = 'rank-strip';
      if (mcap) block.insertBefore(strip, mcap); else block.appendChild(strip);
    }
    if (!revealed) {
      strip.className = 'rank-strip rank-strip--locked';
      strip.innerHTML = '<span class="rank-strip-label">GRID RANK</span><span class="rank-strip-value">\u2014</span>';
      return;
    }
    // Current standings: frozen base + earned upgrades, re-sorted, with movement
    // measured against the opening grid. Falls back to the static entry if the
    // calculator isn't available.
    var rank = null, prev = null;
    var S = window.MEMEGP_Stats;
    var opening = (_data.rankings && _data.rankings.weeks && _data.rankings.weeks[0] &&
                   _data.rankings.weeks[0].rankings) || null;
    if (S && typeof S.rankWithUpgrades === 'function' && opening) {
      var standings = S.rankWithUpgrades(opening);
      var tk = clean(ticker);
      var me = standings.filter(function (e) { return clean(e.ticker) === tk; })[0];
      if (me) { rank = me.rank; prev = me.previous_rank; }
    }
    if (rank == null) {
      var entry = rankingEntry(ticker);
      rank = entry && entry.rank != null ? entry.rank : computeRank(ticker);
      prev = entry ? entry.previous_rank : null;
    }
    if (rank == null) { strip.style.display = 'none'; return; }
    strip.style.display = '';
    strip.className = 'rank-strip';
    var mv = getMovement(rank, prev);
    strip.innerHTML = '<span class="rank-strip-label">GRID RANK</span><span class="rank-strip-right">' +
      '<span class="rank-strip-value">P' + rank + '</span>' + movementChip(mv) + '</span>';
  }

  // -------------------------------------------------------
  // DEVELOPMENT CYCLE (reads data/upgrades.json)
  //   - targets = the 2 lowest upgradeable stats (live, gated)
  //   - box 1 (15 likes) = lowest · box 2 (10 RTs) = 2nd-lowest
  //   - locked state + pinned Week-0 base come from upgrades.json
  // -------------------------------------------------------
  function injectDevCSS() {
    if (document.getElementById('dev-cycle-css')) return;
    var el = document.createElement('style');
    el.id = 'dev-cycle-css';
    el.textContent = `
.dev-head-wrap{max-width:1280px;margin:40px auto 0;padding:0 24px}
.dev-head{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.dev-head h2{font-family:'Orbitron',sans-serif;font-size:22px;font-weight:900;letter-spacing:3px;color:var(--gold,#ffcc00)}
.dev-dot{width:9px;height:9px;border-radius:50%;background:var(--accent,#ff0040);box-shadow:0 0 8px var(--accent,#ff0040);animation:devpulse 1.6s ease-in-out infinite}
.dev-head .dev-sub{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--muted,#7a7a88);letter-spacing:1.2px}
.dev-week{font-family:'Orbitron',sans-serif;font-size:9px;letter-spacing:2px;color:var(--gold,#ffcc00);border:1px solid var(--gold,#ffcc00);border-radius:4px;padding:4px 9px;margin-left:auto}
.dev-blocks{margin-top:18px}
.dev-blocks .block{min-height:0}
.block-header-logo.coin{overflow:hidden;background:#0a0a12;display:flex;align-items:center;justify-content:center}
.block-header-logo.coin img{width:100%;height:100%;object-fit:cover}
.dev-block .tag{font-family:'Orbitron',sans-serif;font-size:8px;letter-spacing:2px;color:var(--muted,#7a7a88);border:1px solid var(--line-bright,#2a2a36);border-radius:4px;padding:4px 7px}
.dev-body{padding:18px;display:flex;flex-direction:column;gap:14px;flex:1}
.dev-hero{display:flex;align-items:center;gap:16px;background:#0a0a12;border:1px solid var(--line,#1d1d28);border-left:5px solid var(--gold,#ffcc00);border-radius:6px;padding:16px 18px}
.locked .dev-hero{border-left-color:var(--green,#00ff88)}
.dev-hero-icon{width:68px;height:68px;flex-shrink:0;display:flex;align-items:center;justify-content:center}
.dev-hero-icon img{width:60px;height:60px;object-fit:contain}
.dev-hero-meta{display:flex;flex-direction:column;gap:6px;min-width:0}
.dev-hero-name{font-family:'Orbitron',sans-serif;font-size:26px;font-weight:900;letter-spacing:2px;color:var(--gold,#ffcc00);line-height:1}
.dev-hero-vals{font-family:'Orbitron',sans-serif;font-size:20px;font-weight:900}
.dev-hero-vals .now{color:var(--muted,#7a7a88)}
.dev-hero-vals .arrow{color:var(--muted,#7a7a88);margin:0 8px}
.dev-hero-vals .next{color:var(--gold,#ffcc00)}
.locked .dev-hero-vals .next{color:var(--green,#00ff88)}
.dev-state{display:flex;align-items:center;justify-content:center;gap:9px;font-family:'Orbitron',sans-serif;font-size:12px;font-weight:900;letter-spacing:1.5px;padding:10px;border-radius:6px;border:1px solid var(--line,#1d1d28)}
.dev-state .gear{width:17px;height:17px;animation:devspin 2.6s linear infinite}
.dev-state .ico{width:16px;height:16px}
.in-prog .dev-state{color:var(--gold,#ffcc00);background:rgba(255,204,0,.06)}
.locked .dev-state{color:var(--green,#00ff88);background:rgba(0,255,136,.07)}
.dev-state .done,.dev-state .done-txt{display:none}
.locked .dev-state .done{display:inline-block}
.locked .dev-state .done-txt{display:inline}
.locked .dev-state .gear,.locked .dev-state .prog-txt{display:none}
.dev-foot{min-height:var(--footer-min-h,72px);padding:14px 18px;border-top:1px solid var(--line,#1d1d28);background:#0a0a12;display:flex;align-items:center;justify-content:space-between;margin-top:auto;gap:10px}
.dev-req{display:flex;align-items:center;gap:7px;font-family:'Orbitron',sans-serif;font-size:11px;font-weight:700;letter-spacing:1px;color:var(--muted,#7a7a88)}
.dev-req .ico{width:15px;height:15px}
.dev-delta{font-family:'Orbitron',sans-serif;font-size:13px;font-weight:900;letter-spacing:.5px;color:var(--gold,#ffcc00)}
.locked .dev-delta,.locked .dev-req{color:var(--green,#00ff88)}
/* FAILED state (window closed, target not met) */
.dev-state .fail,.dev-state .fail-txt{display:none}
.failed .dev-state{color:#ff2b5e;background:rgba(255,0,64,.07);border-color:rgba(255,0,64,.32)}
.failed .dev-state .gear,.failed .dev-state .prog-txt,.failed .dev-state .done,.failed .dev-state .done-txt{display:none}
.failed .dev-state .fail{display:inline-block;width:16px;height:16px}
.failed .dev-state .fail-txt{display:inline}
.failed .dev-hero{border-left-color:#ff0040;opacity:.92}
.failed .dev-hero-name{color:#ff6688}
.failed .dev-hero-vals .now{color:#9aa}
.failed .dev-hero-vals .next{color:#ff2b5e;text-decoration:line-through;text-decoration-thickness:2px}
.failed .dev-delta,.failed .dev-req{color:#ff2b5e}
.sum-body{padding:20px 18px;display:flex;flex-direction:column;gap:14px;flex:1}
.sum-hero{text-align:center;padding:6px 0 4px}
.sum-hero .lab{font-family:'Orbitron',sans-serif;font-size:9px;letter-spacing:2px;color:var(--muted,#7a7a88);margin-bottom:4px}
.sum-hero .val{font-family:'Orbitron',sans-serif;font-size:46px;font-weight:900;line-height:1;color:var(--gold,#ffcc00)}
.sum-row{display:flex;align-items:center;justify-content:space-between;font-family:'Orbitron',sans-serif;font-size:13px;letter-spacing:1px}
.sum-row .k{color:var(--muted,#7a7a88);font-size:10px;letter-spacing:2px}
.sum-row .v{font-weight:900}
.sum-row .v .base{color:var(--muted,#7a7a88)}
.sum-row .v .arrow{color:var(--muted,#7a7a88);margin:0 5px}
.sum-row .v .cur{color:var(--gold,#ffcc00)}
.sum-bar{height:8px;border-radius:5px;background:#0a0a12;border:1px solid var(--line,#1d1d28);overflow:hidden}
.sum-bar > i{display:block;height:100%;width:0;background:linear-gradient(90deg,#ffcc00,#00ff88);transition:width .5s ease}
.sum-foot{min-height:var(--footer-min-h,72px);padding:14px 18px;border-top:1px solid var(--line,#1d1d28);background:#0a0a12;display:flex;align-items:center;justify-content:space-between;margin-top:auto}
.sum-foot .k{font-family:'Orbitron',sans-serif;font-size:9px;letter-spacing:2px;color:var(--muted,#7a7a88)}
.sum-foot .v{font-family:'Orbitron',sans-serif;font-size:13px;font-weight:900;color:var(--text,#f0f0f5)}
.sum-foot .v .lk{color:var(--green,#00ff88)}
@keyframes devspin{to{transform:rotate(360deg)}}
@keyframes devpulse{0%,100%{opacity:1}50%{opacity:.3}}
`;
    document.head.appendChild(el);
  }

  function devTeam(ticker) {
    var u = _data.upgrades;
    if (!u || !u.teams) return null;
    var tk = clean(ticker);
    var keys = Object.keys(u.teams);
    for (var i = 0; i < keys.length; i++) { if (clean(keys[i]) === tk) return u.teams[keys[i]]; }
    return null;
  }

  function setQ(scope, sel, txt) { var e = scope.querySelector(sel); if (e) e.textContent = txt; }
  function setId(id, txt) { var e = document.getElementById(id); if (e) e.textContent = txt; }

  function fillUpgradeBox(n, statName, map, lockedArr, cycleLocked) {
    var box = document.getElementById('dev-up' + n);
    if (!box || !statName) return;
    var isLocked = lockedArr.indexOf(statName) !== -1;
    var state = isLocked ? 'locked' : (cycleLocked ? 'failed' : 'in-prog');
    box.className = 'block dev-block ' + state;
    var v = (map[statName] && map[statName].value != null) ? map[statName].value : null;
    var icon = box.querySelector('.dev-hero-icon img');
    if (icon) {
      icon.style.visibility = 'visible';   // undo any earlier empty-src onerror hide
      icon.src = 'icon-' + statName.toLowerCase() + '.png';
    }
    setQ(box, '.dev-hero-name', statName);
    setQ(box, '.dev-hero-vals .now', v != null ? r1(v) : '\u2014');
    setQ(box, '.dev-hero-vals .next', v != null ? r1(v + 1) : '\u2014');
    setQ(box, '.dev-delta', statName + ' +1');

    // Inject the FAILED label once (X icon + dramatic text), CSS hides it unless .failed.
    var ds = box.querySelector('.dev-state');
    if (ds && !ds.querySelector('.fail-txt')) {
      ds.insertAdjacentHTML('beforeend',
        '<svg class="ico fail" width="16" height="16" viewBox="0 0 24 24" fill="none" ' +
        'stroke="currentColor" stroke-width="2.6"><path d="M18 6 6 18M6 6l12 12"/></svg>' +
        '<span class="fail-txt"></span>');
    }
    if (ds) {
      var ft = ds.querySelector('.fail-txt');
      if (ft) ft.textContent = (n === '2' ? 'DEPLOYMENT FAILED' : 'UPGRADE FAILED');
    }
  }

  function renderDevCycle(ticker, map, targets, revealed) {
    var head = document.getElementById('dev-cycle');
    var row = document.getElementById('dev-row');
    if (!head || !row) return;                 // page has no dev section
    if (!revealed || !targets) {               // gate: hidden until this team's slot unlocks
      head.hidden = true; row.hidden = true; return;
    }
    injectDevCSS();
    head.hidden = false; row.hidden = false;

    var S = window.MEMEGP_Stats;
    var dev = devTeam(ticker) || {};

    // Single source of truth: earned upgrades + base come from stats-calculator.
    // Fall back to upgrades.json only if the accessors aren't available.
    var lockedArr = (S && typeof S.getEarned === 'function') ? S.getEarned(ticker)
                    : (Array.isArray(dev.locked) ? dev.locked : []);

    var base = null;
    if (S && typeof S.getBaseStats === 'function') {
      var b = S.getBaseStats(ticker);
      if (b) base = (b.engine + b.aero + b.chassis + b.drag + b.pit) / 5;
    }
    if (base == null && dev.base_overall != null) base = dev.base_overall;

    var cycleLocked = !!(S && S.cycleLocked);
    fillUpgradeBox('1', targets[0], map, lockedArr, cycleLocked);   // lowest  → 15 likes
    fillUpgradeBox('2', targets[1], map, lockedArr, cycleLocked);   // 2nd     → 10 RTs

    var count = targets.filter(function (t) { return lockedArr.indexOf(t) !== -1; }).length;
    var gained = count * 0.2;
    setId('dev-sum-gain', '+' + gained.toFixed(1));
    setId('dev-sum-base', base != null ? r1(base) : '\u2014');
    setId('dev-sum-cur', base != null ? r1(base + gained) : '\u2014');
    setId('dev-sum-locked', count + ' / 2');
    setId('dev-sum-status', count === 2 ? 'COMPLETE' : (cycleLocked ? 'CLOSED' : 'ACTIVE'));
    var bar = document.getElementById('dev-sum-bar');
    if (bar) bar.style.width = (58 + count * 21) + '%';
  }

  // -------------------------------------------------------
  // FETCH + RUN
  // -------------------------------------------------------
  function fetchJSON(path) {
    return fetch(path, { cache: 'no-cache' })
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }
  function fetchData(done) {
    if (_fetched) { done(); return; }
    _fetched = true;
    Promise.all([
      fetchJSON('rankings.json'),
      fetchJSON('data/snapshot.json'),
      fetchJSON('data/history.json'),
      fetchJSON('data/upgrades.json')
    ]).then(function (res) {
      _data.rankings = res[0];
      _data.snapshot = res[1];
      _data.history = (res[2] && Array.isArray(res[2].snapshots)) ? res[2].snapshots : null;
      _data.upgrades = res[3];
      done();
    });
  }

  // Build a {NAME:{value}} map from the FROZEN base (no upgrades) so the dev
  // cycle picks fixed targets and shows base→target, independent of what the
  // main stat rows now display (which include earned upgrades).
  function baseStatMap(ticker) {
    var S = window.MEMEGP_Stats;
    if (!S || typeof S.getBaseStats !== 'function') return null;
    var b = S.getBaseStats(ticker);
    if (!b) return null;
    return {
      ENGINE:  { value: b.engine },
      AERO:    { value: b.aero },
      CHASSIS: { value: b.chassis },
      DRAG:    { value: b.drag },
      PIT:     { value: b.pit }
    };
  }

  function run() {
    injectCSS();
    var ticker = currentTicker();
    var revealed = isRevealed(ticker);
    var map = statRowMap();
    populate(ticker, map);              // main rows show current = base + earned upgrades
    map = statRowMap();                 // re-read after populate (for highlight rows)
    var baseMap = baseStatMap(ticker) || map;   // frozen base for targets + dev cycle
    var targets = revealed ? lowestTwo(baseMap) : null;
    var S = window.MEMEGP_Stats;
    var earned = (S && typeof S.getEarned === 'function') ? S.getEarned(ticker) : [];
    applyHighlight(map, baseMap, targets, earned);
    renderRank(ticker, revealed);
    renderDevCycle(ticker, baseMap, targets, revealed);
  }

  function init() { run(); fetchData(run); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  setInterval(run, 60000); // re-evaluate as this team's slot unlocks

  window.MemeGPCard = {
    refresh: run,
    rank: function () { var e = rankingEntry(currentTicker()); return e && e.rank != null ? e.rank : computeRank(currentTicker()); },
    movement: function () { var e = rankingEntry(currentTicker()); return e ? getMovement(e.rank, e.previous_rank) : null; },
    lowest: function () { return lowestTwo(statRowMap()); }
  };
})();
