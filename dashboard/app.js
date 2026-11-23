// Volume Breakout Radar — dashboard logic. Reads window.RADAR (written by
// main.ts from the same board), renders the board, the detail view and the
// filters. No network: every value comes from the sealed snapshot.
(function () {
  'use strict';
  var R = window.RADAR;
  if (!R) {
    document.body.innerHTML = '<p style="padding:40px">Radar data (data.js) did not load.</p>';
    return;
  }

  var rowsEl = document.getElementById('rows');
  var detailEl = document.getElementById('detail');
  var statsEl = document.getElementById('stats');
  var qEl = document.getElementById('q');
  var catEl = document.getElementById('cat');
  var chainEl = document.getElementById('chain');
  var tierEl = document.getElementById('tier');
  var sortEl = document.getElementById('sort');

  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function moneyFull(n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function pct(g) {
    if (g === null || g === undefined) return 'n/a';
    return (g > 0 ? '+' : '') + g.toFixed(1) + '%';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function tierBadge(tier) {
    if (tier === 'breakout') return '<span class="badge breakout">BREAKOUT</span>';
    if (tier === 'heating') return '<span class="badge heating">HEATING</span>';
    return '<span class="badge steady">STEADY</span>';
  }
  function growthCell(g) {
    if (g === null || g === undefined) return '<td class="num">n/a</td>';
    var cls = g >= 0 ? 'pos' : 'neg';
    return '<td class="num growth ' + cls + '">' + pct(g) + '</td>';
  }

  // ---- header -------------------------------------------------------------
  document.getElementById('snapshot').innerHTML =
    'Snapshot <b>' + esc(R.as_of) + '</b><br>' +
    '<b>' + R.board_size + '</b> ranked rows &middot; <b>' + R.watchlist_size + '</b> on the watchlist<br>' +
    '<b>' + R.breakout_count + '</b> breakout &middot; <b>' + R.heating_count + '</b> heating<br>' +
    'Breakout cutoff: 7d &ge; <b>' + R.growth_p90.toFixed(1) + '%</b> &middot; heating &ge; <b>' + R.growth_p75.toFixed(1) + '%</b>';
  document.getElementById('asof').textContent = R.as_of;

  // ---- filter options ------------------------------------------------------
  var cats = {};
  var chains = {};
  R.rows.forEach(function (r) {
    if (r.category) cats[r.category] = true;
    r.chains.forEach(function (c) { chains[c] = true; });
  });
  Object.keys(cats).sort().forEach(function (c) {
    catEl.add(new Option(c, c));
  });
  Object.keys(chains).sort().forEach(function (c) {
    chainEl.add(new Option(c, c));
  });

  // ---- state from the URL hash (so each view has its own address) -----------
  function readHash() {
    var h = {};
    location.hash.slice(1).split('&').forEach(function (part) {
      var kv = part.split('=');
      if (kv[0]) h[kv[0]] = decodeURIComponent(kv[1] || '');
    });
    return h;
  }
  function writeHash(h) {
    var parts = [];
    ['detail', 'tier', 'cat', 'chain', 'q', 'sort'].forEach(function (k) {
      if (h[k]) parts.push(k + '=' + encodeURIComponent(h[k]));
    });
    var next = parts.length ? '#' + parts.join('&') : '';
    if (location.hash !== next) history.replaceState(null, '', next || location.pathname);
  }
  var state = readHash();
  qEl.value = state.q || '';
  catEl.value = state.cat || '';
  chainEl.value = state.chain || '';
  tierEl.value = state.tier || '';
  sortEl.value = state.sort || 'rank';

  function currentState() {
    return {
      q: qEl.value.trim(),
      cat: catEl.value,
      chain: chainEl.value,
      tier: tierEl.value,
      sort: sortEl.value,
      detail: state.detail || '',
    };
  }

  // ---- board ----------------------------------------------------------------
  function filteredRows() {
    var s = currentState();
    var out = R.rows.filter(function (r) {
      if (s.tier === 'breakout' && r.tier !== 'breakout') return false;
      if (s.tier === 'heating' && r.tier === 'steady') return false;
      if (s.cat && r.category !== s.cat) return false;
      if (s.chain && r.chains.indexOf(s.chain) === -1) return false;
      if (s.q) {
        var q = s.q.toLowerCase();
        if (r.name.toLowerCase().indexOf(q) === -1 && r.slug.indexOf(q) === -1) return false;
      }
      return true;
    });
    if (s.sort === 'tvl') out = out.slice().sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    else if (s.sort === 'growth') out = out.slice().sort(function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); });
    else if (s.sort === 'implied') out = out.slice().sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd; });
    return out;
  }

  function renderBoard() {
    var list = filteredRows();
    var html = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.detail === r.slug ? ' class="selected"' : '') + '>' +
        '<td>' + r.rank + '</td>' +
        '<td class="proto"><b>' + esc(r.name) + '</b><span>' + esc(r.slug) + (r.on_watchlist ? ' &middot; watchlist' : '') + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        growthCell(r.change_7d) +
        '<td>' + tierBadge(r.tier) + '</td>' +
        '<td class="num">' + money(r.implied_value_usd) + '</td></tr>';
    }).join('');
    rowsEl.innerHTML = html || '<tr><td colspan="8">No protocols match these filters.</td></tr>';
    statsEl.innerHTML = 'Showing <b>' + list.length + '</b> of <b>' + R.rows.length + '</b> ranked protocols &middot; ' +
      '<b>' + R.breakout_count + '</b> breakout &middot; <b>' + R.heating_count + '</b> heating &middot; ' +
      'click a row for its farm plan.';
    rowsEl.querySelectorAll('tr[data-slug]').forEach(function (tr) {
      tr.addEventListener('click', function () {
        state.detail = tr.getAttribute('data-slug');
        sync();
      });
    });
  }

  // ---- detail ----------------------------------------------------------------
  function renderDetail() {
    var slug = state.detail;
    if (!slug) { detailEl.hidden = true; detailEl.innerHTML = ''; return; }
    var r = null;
    R.rows.forEach(function (row) { if (row.slug === slug) r = row; });
    if (!r) { detailEl.hidden = true; detailEl.innerHTML = ''; return; }
    var base = r.tvl_usd * R.model.base_multiple;
    var tierMult = r.tier === 'breakout' ? R.model.breakout_mult : r.tier === 'heating' ? R.model.heating_mult : 1;
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    detailEl.innerHTML =
      '<h2>#' + r.rank + ' &nbsp;' + esc(r.name) + ' ' + tierBadge(r.tier) + '</h2>' +
      '<p class="meta">' + esc(r.slug) + ' &middot; ' + esc(r.category || 'uncategorised') + ' &middot; ' + esc(r.chains.join(', ')) +
      ' &middot; listed ' + r.age_days + ' days ago &middot; ' + (r.on_watchlist ? 'on the watchlist' : 'below the watchlist floor') + '</p>' +
      '<div class="breakdown">' +
      '<div><span>TVL &times; 0.30</span><b>' + money(base) + '</b></div>' +
      '<div><span>7d change (model)</span><b>' + pct(r.growth_used) + '</b></div>' +
      '<div><span>Momentum</span><b>&times;' + r.momentum.toFixed(2) + '</b></div>' +
      '<div><span>Maturity</span><b>&times;' + r.maturity.toFixed(2) + '</b></div>' +
      '<div><span>Breadth</span><b>&times;' + r.breadth.toFixed(2) + '</b></div>' +
      '<div><span>Tier</span><b>&times;' + tierMult.toFixed(2) + '</b></div>' +
      '<div><span>Implied value</span><b>' + moneyFull(r.implied_value_usd) + '</b></div>' +
      '</div>' +
      '<h3>Farm plan — six steps, with costs and times</h3><ol>' + steps + '</ol>' +
      '<p class="note">This protocol records no token in the snapshot — that is the record, not proof it has none. ' +
      'The implied value is this radar&rsquo;s own claim from the snapshot&rsquo;s figures; it is not a prediction that a token will launch, or when.</p>';
    detailEl.hidden = false;
  }

  // ---- live table ------------------------------------------------------------
  document.getElementById('live-rows').innerHTML = R.live.map(function (p) {
    return '<tr><td class="proto"><b>' + esc(p.name) + '</b><span>' + esc(p.slug) + '</span></td>' +
      '<td>' + esc(p.category || '—') + '</td>' +
      '<td class="num">' + money(p.tvl_usd) + '</td>' +
      growthCell(p.change_7d) +
      '<td class="num">' + money(p.mcap_usd) + '</td></tr>';
  }).join('');

  // ---- sync ------------------------------------------------------------------
  function sync() {
    writeHash(currentState());
    renderBoard();
    renderDetail();
  }
  [qEl, catEl, chainEl, tierEl, sortEl].forEach(function (el) {
    el.addEventListener('input', function () { state.detail = ''; sync(); });
    el.addEventListener('change', function () { state.detail = ''; sync(); });
  });
  document.getElementById('reset').addEventListener('click', function () {
    qEl.value = ''; catEl.value = ''; chainEl.value = ''; tierEl.value = ''; sortEl.value = 'rank';
    state.detail = '';
    sync();
  });
  window.addEventListener('hashchange', function () {
    state = readHash();
    qEl.value = state.q || '';
    catEl.value = state.cat || '';
    chainEl.value = state.chain || '';
    tierEl.value = state.tier || '';
    sortEl.value = state.sort || 'rank';
    sync();
  });

  renderBoard();
  renderDetail();
})();
