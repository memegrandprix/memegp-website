/* ============================================================
 * MEME GP — rankings-loader.js
 * ============================================================
 * Renders POWER RANKINGS into mount point id="power-rankings-mount"
 *
 * Behaviour:
 *   - Fetches rankings.json once, reads weeks[]
 *   - Renders week tabs (clickable) + active week's rankings table
 *   - First week (weeks[0]) is the current week, renders by default
 *   - Empty rankings[] = stub state ("not yet archived")
 *   - Per-team COPY TWEET button copies the tweet text to clipboard
 *   - Movement arrow auto-computed from previous_rank vs rank
 *
 * To add data: edit rankings.json. No code changes needed.
 * ============================================================ */

(function () {
  'use strict';

  // -------------------------------------------------------
  // ESCAPE HTML
  // -------------------------------------------------------
  function escapeHTML(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // -------------------------------------------------------
  // MOVEMENT helper — computes arrow direction + magnitude
  //   { kind: 'up'|'down'|'flat'|'new', delta: number }
  // -------------------------------------------------------
  function getMovement(rank, prev) {
    if (prev == null) return { kind: 'new', delta: 0 };
    var d = prev - rank;            // positive = moved up
    if (d > 0) return { kind: 'up',   delta: d };
    if (d < 0) return { kind: 'down', delta: -d };
    return { kind: 'flat', delta: 0 };
  }

  function renderMovement(mv) {
    if (mv.kind === 'new') {
      return '<span class="pr-mv pr-mv--new">NEW</span>';
    }
    if (mv.kind === 'flat') {
      return '<span class="pr-mv pr-mv--flat" aria-label="No change">—</span>';
    }
    var arrow = mv.kind === 'up' ? '▲' : '▼';
    var sign  = mv.kind === 'up' ? '+' : '-';
    return '<span class="pr-mv pr-mv--' + mv.kind + '">' +
           '<span class="pr-mv-arrow">' + arrow + '</span>' +
           '<span class="pr-mv-delta">' + sign + mv.delta + '</span>' +
           '</span>';
  }

  // -------------------------------------------------------
  // LOGO BLOCK with fallback (mirrors news-loader.js pattern)
  // -------------------------------------------------------
  function renderLogo(entry) {
    var ticker = escapeHTML(entry.ticker || '?');
    var tickerShort = (entry.ticker || '?').replace(/^\$/, '');
    var color = entry.color || '#ffcc00';
    if (entry.logo) {
      return '<div class="pr-logo" style="--logo-color:' + color + '" aria-hidden="true">' +
             '<img src="' + escapeHTML(entry.logo) + '" alt="' + ticker + '"' +
             ' onerror="this.parentNode.classList.add(\'pr-logo--fallback\');' +
             ' this.parentNode.setAttribute(\'data-ticker\',\'' + escapeHTML(tickerShort) + '\');' +
             ' this.remove();">' +
             '</div>';
    }
    return '<div class="pr-logo pr-logo--fallback" style="--logo-color:' + color + '"' +
           ' data-ticker="' + escapeHTML(tickerShort) + '" aria-hidden="true"></div>';
  }

  // -------------------------------------------------------
  // RANKINGS ROW
  // -------------------------------------------------------
  function renderRow(entry) {
    var color = entry.color || '#ffcc00';
    var rankClass = entry.rank === 1 ? ' pr-row--p1'
                  : entry.rank === 2 ? ' pr-row--p2'
                  : entry.rank === 3 ? ' pr-row--p3' : '';
    var mv = getMovement(entry.rank, entry.previous_rank);

    return '' +
      '<div class="pr-row' + rankClass + '" style="--row-color:' + color + '">' +
        '<div class="pr-row-rail"></div>' +
        '<div class="pr-row-rank">' +
          '<span class="pr-row-rank-num">' + escapeHTML(String(entry.rank)) + '</span>' +
        '</div>' +
        '<div class="pr-row-mv">' + renderMovement(mv) + '</div>' +
        '<div class="pr-row-team">' +
          '<span class="pr-row-ticker">' + escapeHTML(entry.ticker || '') + '</span>' +
          '<span class="pr-row-name">' + escapeHTML(entry.team_name || '') + '</span>' +
        '</div>' +
        '<div class="pr-row-score">' +
          '<span class="pr-row-score-val">' + escapeHTML(String(entry.score != null ? entry.score : '—')) + '</span>' +
          '<span class="pr-row-score-label">SCORE</span>' +
        '</div>' +
        '<div class="pr-row-comment">' + escapeHTML(entry.commentary || '') + '</div>' +
        '<div class="pr-row-actions">' +
          '<button class="pr-row-copy" data-tweet="' + escapeHTML(entry.tweet || '') + '" aria-label="Copy tweet for ' + escapeHTML(entry.ticker || '') + '">' +
            '<span class="pr-row-copy-icon">📋</span>' +
            '<span class="pr-row-copy-label">COPY</span>' +
          '</button>' +
        '</div>' +
        renderLogo(entry) +
      '</div>';
  }

  // -------------------------------------------------------
  // WEEK TAB BAR
  // -------------------------------------------------------
  function renderTabs(weeks, activeId) {
    return '<div class="pr-tabs" role="tablist">' +
      weeks.map(function (w) {
        var active = w.id === activeId ? ' active' : '';
        var stub = (w.rankings && w.rankings.length === 0) ? ' pr-tab--stub' : '';
        return '<button class="pr-tab' + active + stub + '" data-week="' + escapeHTML(w.id) + '" role="tab">' +
               '<span class="pr-tab-label">' + escapeHTML(w.label) + '</span>' +
               '</button>';
      }).join('') +
      '</div>';
  }

  // -------------------------------------------------------
  // WEEK CONTENT (header + rows OR stub)
  // -------------------------------------------------------
  function renderWeek(week) {
    var header =
      '<div class="pr-week-head">' +
        '<span class="pr-week-subtitle">' + escapeHTML(week.subtitle || '') + '</span>' +
        (week.tag ? '<span class="pr-week-tag">' + escapeHTML(week.tag) + '</span>' : '') +
      '</div>';

    if (!week.rankings || week.rankings.length === 0) {
      return header +
        '<div class="pr-stub">' +
          '<div class="pr-stub-icon">🏁</div>' +
          '<div class="pr-stub-text">RANKINGS FOR THIS WEEK NOT YET ARCHIVED</div>' +
          '<div class="pr-stub-sub">Older weeks will appear here as the season progresses.</div>' +
        '</div>';
    }

    var rows = week.rankings.map(renderRow).join('');
    return header + '<div class="pr-rows">' + rows + '</div>';
  }

  // -------------------------------------------------------
  // FULL RENDER
  // -------------------------------------------------------
  function render(mount, weeks, activeId) {
    var active = weeks.find(function (w) { return w.id === activeId; }) || weeks[0];
    mount.innerHTML =
      renderTabs(weeks, active.id) +
      '<div class="pr-week" id="pr-week-' + escapeHTML(active.id) + '">' +
        renderWeek(active) +
      '</div>';

    wireTabs(mount, weeks);
    wireCopyButtons(mount);
  }

  // -------------------------------------------------------
  // INTERACTIONS
  // -------------------------------------------------------
  function wireTabs(mount, weeks) {
    var tabs = mount.querySelectorAll('.pr-tab');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var weekId = tab.getAttribute('data-week');
        render(mount, weeks, weekId);
      });
    });
  }

  function wireCopyButtons(mount) {
    mount.addEventListener('click', function (e) {
      var btn = e.target.closest('.pr-row-copy');
      if (!btn) return;
      var tweet = btn.getAttribute('data-tweet') || '';
      if (!tweet) return;

      try {
        navigator.clipboard.writeText(tweet).then(
          function () { flashCopied(btn); },
          function () { fallbackCopy(tweet, btn); }
        );
      } catch (err) {
        fallbackCopy(tweet, btn);
      }
    });
  }

  function flashCopied(btn) {
    var prev = btn.innerHTML;
    btn.classList.add('copied');
    btn.innerHTML = '<span class="pr-row-copy-icon">✓</span><span class="pr-row-copy-label">COPIED</span>';
    setTimeout(function () {
      btn.classList.remove('copied');
      btn.innerHTML = prev;
    }, 1600);
  }

  function fallbackCopy(text, btn) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); flashCopied(btn); }
    catch (e) { /* silent */ }
    document.body.removeChild(ta);
  }

  // =======================================================
  // BOOTSTRAP
  // =======================================================
  function init() {
    var mount = document.getElementById('power-rankings-mount');
    if (!mount) return;

    fetch('rankings.json', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('rankings.json HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var weeks = (data && data.weeks) || [];
        if (weeks.length === 0) {
          mount.innerHTML = '<div class="pr-stub"><div class="pr-stub-text">NO RANKINGS DATA</div></div>';
          return;
        }
        render(mount, weeks, weeks[0].id);

        // If the URL anchor matches our section, scroll into view smoothly
        if (location.hash === '#power-rankings') {
          var anchor = document.getElementById('power-rankings');
          if (anchor) anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      })
      .catch(function (err) {
        console.warn('[power-rankings] failed to load rankings.json:', err);
        mount.innerHTML = '<div class="pr-stub"><div class="pr-stub-text">RANKINGS UNAVAILABLE</div><div class="pr-stub-sub">Try refreshing.</div></div>';
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
