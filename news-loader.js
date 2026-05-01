/* ============================================================
 * MEME GP — news-loader.js
 * ============================================================
 * Single source of truth for GP CENTRAL news rendering.
 *
 * Renders TWO things, depending on which mount points exist:
 *   1. Ticker bar       → mount point with id="gp-ticker"
 *   2. Full news feed   → mount point with id="gp-feed"
 *
 * Behaviour:
 *   - Fetches news.json once, sorts by timestamp DESC
 *   - Ticker shows top 3 headlines as compact pills + ALL NEWS link
 *   - Feed shows all items as full cards with COPY TWEET + SHARE buttons
 *   - Filter pills on the feed page filter by event type live (no reload)
 *
 * To add a news item: edit news.json. No code changes needed.
 * ============================================================ */

(function () {
  'use strict';

  // -------------------------------------------------------
  // EVENT TYPE METADATA
  // Controls icon + accent color + label for each item type.
  // Adding a new type = add a row here + your CSS rule.
  // -------------------------------------------------------
  var TYPE_META = {
    upgrade:   { icon: '⬆',  label: 'UPGRADE',         color: '#00ff88' },
    downgrade: { icon: '⬇',  label: 'DOWNGRADE',       color: '#ff0040' },
    new_team:  { icon: '🆕', label: 'NEW TEAM',        color: '#ffcc00' },
    penalty:   { icon: '⚠',  label: 'PENALTY',         color: '#ff8a1a' },
    result:    { icon: '🏁', label: 'RACE RESULT',     color: '#1f6dff' },
    paddock:   { icon: '📰', label: 'PADDOCK',         color: '#a4a4b0' }
  };

  // -------------------------------------------------------
  // RELATIVE TIME FORMATTER
  // Returns short uppercase strings: "3H AGO", "YESTERDAY",
  // "5D AGO", "2W AGO" etc. Matches the broadcast vibe.
  // -------------------------------------------------------
  function formatRelative(isoTimestamp) {
    var then = new Date(isoTimestamp).getTime();
    var now = Date.now();
    var diffMin = Math.max(0, Math.floor((now - then) / 60000));

    if (diffMin < 1)   return 'JUST NOW';
    if (diffMin < 60)  return diffMin + 'M AGO';

    var diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24)   return diffHr + 'H AGO';
    if (diffHr < 48)   return 'YESTERDAY';

    var diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7)   return diffDay + 'D AGO';

    var diffWk = Math.floor(diffDay / 7);
    if (diffWk < 5)    return diffWk + 'W AGO';

    var diffMo = Math.floor(diffDay / 30);
    return diffMo + 'MO AGO';
  }

  // -------------------------------------------------------
  // ESCAPE HTML — safety net for user-written JSON
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
  // SORT helper — newest first
  // -------------------------------------------------------
  function byTimestampDesc(a, b) {
    return new Date(b.timestamp) - new Date(a.timestamp);
  }

  // =======================================================
  // TICKER RENDER
  // Compact bar shown at the top of every page. Top 3 items.
  // =======================================================
  function renderTicker(mount, items) {
    var top = items.slice(0, 3);

    var html = '' +
      '<a href="gp-central.html" class="gpt-badge" aria-label="Open GP Central news">' +
      '  <span class="gpt-badge-dot"></span>' +
      '  <span class="gpt-badge-text">GP CENTRAL</span>' +
      '</a>' +
      '<div class="gpt-items">' +
      top.map(function (it) {
        var meta = TYPE_META[it.type] || TYPE_META.paddock;
        return '' +
          '<a href="gp-central.html#' + escapeHTML(it.id) + '" class="gpt-item">' +
          '  <span class="gpt-item-icon" style="color:' + meta.color + '">' + meta.icon + '</span>' +
          '  <span class="gpt-item-headline">' + escapeHTML(it.headline) + '</span>' +
          '</a>';
      }).join('<span class="gpt-sep">·</span>') +
      '</div>' +
      '<a href="gp-central.html" class="gpt-all">ALL NEWS →</a>';

    mount.innerHTML = html;
  }

  // =======================================================
  // FEED RENDER (gp-central.html)
  // Full news cards, newest first, with filter pills.
  // =======================================================
  function renderFeed(mount, items) {
    var filterBar =
      '<div class="gpf-filters" role="tablist">' +
      '  <button class="gpf-pill active" data-filter="all">ALL</button>' +
      '  <button class="gpf-pill" data-filter="upgrade">UPGRADES</button>' +
      '  <button class="gpf-pill" data-filter="downgrade">DOWNGRADES</button>' +
      '  <button class="gpf-pill" data-filter="new_team">NEW TEAMS</button>' +
      '  <button class="gpf-pill" data-filter="penalty">PENALTIES</button>' +
      '  <button class="gpf-pill" data-filter="result">RESULTS</button>' +
      '  <button class="gpf-pill" data-filter="paddock">PADDOCK</button>' +
      '</div>';

    var cards = items.map(renderCard).join('');

    mount.innerHTML =
      filterBar +
      '<div class="gpf-list" id="gpf-list">' + cards + '</div>';

    wireFilters(mount);
    wireCardActions(mount);

    // If the URL has #anchor, scroll to that card
    if (location.hash) {
      var anchor = mount.querySelector(location.hash);
      if (anchor) anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  // -------------------------------------------------------
  // CARD MARKUP
  // Single news card. Optionally includes stat-change block.
  // -------------------------------------------------------
  function renderCard(it) {
    var meta = TYPE_META[it.type] || TYPE_META.paddock;
    var teamColor = (it.team && it.team.color) || meta.color;

    var statBlock = '';
    if (it.stat_change && typeof it.stat_change.from !== 'undefined') {
      var sc = it.stat_change;
      var direction = sc.to > sc.from ? 'up' : 'down';
      statBlock =
        '<div class="gpf-stat gpf-stat--' + direction + '">' +
        '  <span class="gpf-stat-name">' + escapeHTML(sc.stat) + '</span>' +
        '  <span class="gpf-stat-from">' + escapeHTML(String(sc.from)) + '</span>' +
        '  <span class="gpf-stat-arrow">→</span>' +
        '  <span class="gpf-stat-to">' + escapeHTML(String(sc.to)) + '</span>' +
        '</div>';
    }

    var tagBlock = it.tag
      ? '<span class="gpf-tag">' + escapeHTML(it.tag) + '</span>'
      : '';

    var teamBlock = it.team
      ? '<div class="gpf-team">' +
        '  <span class="gpf-team-dot" style="background:' + teamColor + ';box-shadow:0 0 6px ' + teamColor + '"></span>' +
        '  <span class="gpf-team-ticker">' + escapeHTML(it.team.ticker || '') + '</span>' +
        '  <span class="gpf-team-name">' + escapeHTML(it.team.name || '') + '</span>' +
        '</div>'
      : '';

    var tweetEncoded = encodeURIComponent(it.tweet || it.headline);
    var shareUrl = 'https://twitter.com/intent/tweet?text=' + tweetEncoded;

    return '' +
      '<article class="gpf-card" id="' + escapeHTML(it.id) + '" data-type="' + escapeHTML(it.type) + '" style="--card-accent:' + teamColor + '">' +
      '  <div class="gpf-card-rail"></div>' +
      '  <header class="gpf-card-head">' +
      '    <span class="gpf-card-type" style="color:' + meta.color + '">' +
      '      <span class="gpf-card-type-icon">' + meta.icon + '</span>' +
      '      <span class="gpf-card-type-label">' + meta.label + '</span>' +
      '    </span>' +
      '    <span class="gpf-card-meta">' +
      '      <time datetime="' + escapeHTML(it.timestamp) + '">' + formatRelative(it.timestamp) + '</time>' +
      tagBlock +
      '    </span>' +
      '  </header>' +
      '  <h2 class="gpf-card-headline">' + escapeHTML(it.headline) + '</h2>' +
      '  <p class="gpf-card-body">' + escapeHTML(it.body) + '</p>' +
      statBlock +
      teamBlock +
      '  <footer class="gpf-card-actions">' +
      '    <button class="gpf-btn gpf-btn--copy" data-tweet="' + escapeHTML(it.tweet || '') + '">' +
      '      <span class="gpf-btn-icon">📋</span> COPY TWEET' +
      '    </button>' +
      '    <a class="gpf-btn gpf-btn--share" href="' + shareUrl + '" target="_blank" rel="noopener">' +
      '      <span class="gpf-btn-icon">🐦</span> SHARE TO X' +
      '    </a>' +
      '  </footer>' +
      '</article>';
  }

  // -------------------------------------------------------
  // FILTER PILLS
  // Click a pill to show only matching event types.
  // -------------------------------------------------------
  function wireFilters(mount) {
    var pills = mount.querySelectorAll('.gpf-pill');
    var cards = mount.querySelectorAll('.gpf-card');

    pills.forEach(function (pill) {
      pill.addEventListener('click', function () {
        var filter = pill.getAttribute('data-filter');
        pills.forEach(function (p) { p.classList.remove('active'); });
        pill.classList.add('active');

        cards.forEach(function (c) {
          if (filter === 'all' || c.getAttribute('data-type') === filter) {
            c.style.display = '';
          } else {
            c.style.display = 'none';
          }
        });
      });
    });
  }

  // -------------------------------------------------------
  // CARD ACTIONS — copy tweet to clipboard
  // -------------------------------------------------------
  function wireCardActions(mount) {
    mount.addEventListener('click', function (e) {
      var btn = e.target.closest('.gpf-btn--copy');
      if (!btn) return;

      var tweet = btn.getAttribute('data-tweet') || '';
      if (!tweet) return;

      try {
        navigator.clipboard.writeText(tweet).then(function () {
          flashCopied(btn);
        }, function () {
          fallbackCopy(tweet, btn);
        });
      } catch (err) {
        fallbackCopy(tweet, btn);
      }
    });
  }

  function flashCopied(btn) {
    var prev = btn.innerHTML;
    btn.classList.add('copied');
    btn.innerHTML = '<span class="gpf-btn-icon">✓</span> COPIED!';
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
  // Run on DOMContentLoaded — find mount points, fetch JSON,
  // render whichever views are present on this page.
  // =======================================================
  function init() {
    var ticker = document.getElementById('gp-ticker');
    var feed = document.getElementById('gp-feed');
    if (!ticker && !feed) return; // no GP CENTRAL on this page

    fetch('news.json', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('news.json HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var items = (data && data.items) || [];
        items.sort(byTimestampDesc);
        if (ticker) renderTicker(ticker, items);
        if (feed) renderFeed(feed, items);
      })
      .catch(function (err) {
        console.warn('[gp-central] failed to load news.json:', err);
        if (ticker) {
          ticker.innerHTML = '<a href="gp-central.html" class="gpt-badge"><span class="gpt-badge-dot"></span><span class="gpt-badge-text">GP CENTRAL</span></a>';
        }
        if (feed) {
          feed.innerHTML = '<div class="gpf-empty">News feed unavailable. Try refreshing.</div>';
        }
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
