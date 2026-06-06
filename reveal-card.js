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

  var _data = { rankings: null, snapshot: null, history: null };
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
      '.stat-row.is-upgrade-target .stat-row-main{background:linear-gradient(90deg,',
      '  rgba(255,0,64,.20) 0%, rgba(255,0,64,.20) var(--score-pct,0%),',
      '  transparent var(--score-pct,0%), transparent 100%);}',
      '.stat-row.is-upgrade-target .stat-row-value{color:#ff2b5e;}',
      '.stat-row.is-upgrade-target .stat-row-name{color:#ff6688;}',
      '.stat-row.is-upgrade-target .stat-row-name::after{content:"\\25B2 UPGRADE";',
      '  font-family:\'Orbitron\',sans-serif;font-size:8px;font-weight:900;letter-spacing:1px;',
      '  color:#ff2b5e;border:1px solid rgba(255,0,64,.5);border-radius:4px;',
      '  padding:2px 5px;margin-left:10px;vertical-align:middle;white-space:nowrap;}',
      '.rank-strip{display:flex;align-items:center;justify-content:space-between;',
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
    if (items.length < 4 || items.some(function (x) { return x.e.value === null; })) return null;
    items.sort(function (a, b) { return a.e.value !== b.e.value ? a.e.value - b.e.value : a.i - b.i; });
    return [items[0].name, items[1].name];
  }
  function applyHighlight(map, targets) {
    UPGRADEABLE.forEach(function (name) {
      var e = map[name];
      if (e) e.row.classList.toggle('is-upgrade-target', !!targets && targets.indexOf(name) !== -1);
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
    var entry = rankingEntry(ticker);
    var rank = entry && entry.rank != null ? entry.rank : computeRank(ticker);
    if (rank == null) { strip.style.display = 'none'; return; }
    strip.style.display = '';
    strip.className = 'rank-strip';
    var mv = getMovement(rank, entry ? entry.previous_rank : null);
    strip.innerHTML = '<span class="rank-strip-label">GRID RANK</span><span class="rank-strip-right">' +
      '<span class="rank-strip-value">P' + rank + '</span>' + movementChip(mv) + '</span>';
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
      fetchJSON('data/history.json')
    ]).then(function (res) {
      _data.rankings = res[0];
      _data.snapshot = res[1];
      _data.history = (res[2] && Array.isArray(res[2].snapshots)) ? res[2].snapshots : null;
      done();
    });
  }

  function run() {
    injectCSS();
    var ticker = currentTicker();
    var revealed = isRevealed(ticker);
    var map = statRowMap();
    populate(ticker, map);              // write snapshot-derived stats (gate handled by calcStats)
    map = statRowMap();                 // re-read after populate
    applyHighlight(map, revealed ? lowestTwo(map) : null);
    renderRank(ticker, revealed);
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
