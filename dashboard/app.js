// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail view with the model's own
// inputs and the protocol's farm plan, and the live-token table. No network: every byte it shows
// is in data.js.
//
// The page recomputes a row's implied value from the snapshot figures and regenerates its farm
// plan from the same derivation main.ts writes to board.json, so the page's code and the board's
// data are visibly the same arithmetic. The pure helpers below run in a browser and, with no DOM,
// under node for testing.

/* ------------------------------------------------------------------ formatting */

function fmtUsd(n) {
  if (n === null || n === undefined || !isFinite(n)) return 'n/a';
  if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
  return '$' + Math.round(n);
}

function fmtPct(n) {
  if (n === null || n === undefined || !isFinite(n)) return 'n/a';
  return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
}

function fmtAge(days) {
  if (days === null || days === undefined) return 'unknown';
  if (days >= 365) return (days / 365).toFixed(1) + 'y';
  return Math.max(0, Math.round(days)) + 'd';
}

function fmtMult(n) {
  return 'x' + n.toFixed(2);
}

/* ------------------------------------------------------------------ the model */

var CATEGORY_WEIGHT = {
  Dexs: 1.15,
  Lending: 1.12,
  Yield: 1.1,
  'Yield Aggregator': 1.1,
  Derivatives: 1.08,
  CDP: 1.06,
  RWA: 1.06,
  'Onchain Capital Allocator': 1.05,
  'Risk Curators': 1.05,
};

function categoryWeight(category) {
  if (category === null || category === undefined) return 1;
  return CATEGORY_WEIGHT[category] || 1;
}

/** A row's implied value, recomputed from its snapshot figures and the model's constants. */
function impliedOf(row, model) {
  var growth = Math.min(
    model.growth_cap,
    Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d),
  );
  var growthMult = 1 + (growth / 100) * model.growth_weight;
  var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
  var maturity =
    model.maturity_floor +
    (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  var breadth = 1 + Math.min(Math.max(row.chains.length, 0), model.breadth_max_chains) * model.breadth_per_chain;
  var categoryMult = categoryWeight(row.category);
  var implied = Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity * breadth * categoryMult));
  return {
    implied: implied,
    growthPct: growth,
    growthMult: growthMult,
    maturityMult: maturity,
    breadthMult: breadth,
    categoryMult: categoryMult,
    age: age,
  };
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(tvl) {
  if (tvl >= 5000000000) return 250;
  if (tvl >= 1000000000) return 150;
  if (tvl >= 100000000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age) {
  if (age === null || age === undefined) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main action, in the words a farmer can follow. */
function actionFor(category, name, capital, chain) {
  var c = (category || '').toLowerCase();
  if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0 || c.indexOf('uncollateral') >= 0)
    return 'Lend $' + capital + ' of USDC on ' + name + ' (' + chain + ') and keep the loan open';
  if (
    c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 ||
    c.indexOf('farm') >= 0 || c.indexOf('liquidity manager') >= 0
  )
    return "Add $" + capital + " of liquidity to " + name + "'s main pool on " + chain + ' and keep the position open';
  if (c.indexOf('bridge') >= 0 || c.indexOf('cross chain') >= 0)
    return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app';
  if (c.indexOf('stak') >= 0 || c.indexOf('restak') >= 0)
    return 'Stake $' + capital + ' of the chain asset through ' + name + ' and keep the receipt token';
  if (
    c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('option') >= 0 ||
    c.indexOf('synthetic') >= 0
  )
    return 'Post $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge';
  if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and take one market position on ' + name;
  if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('index') >= 0)
    return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares';
  if (c.indexOf('rwa') >= 0)
    return 'Mint $' + capital + ' of the yield-bearing asset on ' + chain + ' through ' + name + ' and hold it';
  if (c.indexOf('stable') >= 0)
    return 'Mint or hold $' + capital + ' of the stable asset through ' + name + ' on ' + chain;
  if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy';
  return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open';
}

/** The category's weekly qualifying action, in the words a farmer can follow. */
function weeklyFor(category) {
  var c = (category || '').toLowerCase();
  if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0 || c.indexOf('uncollateral') >= 0)
    return 'Adjust the loan, add collateral or borrow a small amount once';
  if (
    c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 ||
    c.indexOf('farm') >= 0 || c.indexOf('liquidity manager') >= 0
  )
    return 'Swap at least $10 through the pool once, or add a little more liquidity';
  if (c.indexOf('bridge') >= 0 || c.indexOf('cross chain') >= 0) return 'Bridge a small amount once';
  if (c.indexOf('stak') >= 0 || c.indexOf('restak') >= 0) return 'Top up the stake or restake the rewards once';
  if (
    c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('option') >= 0 ||
    c.indexOf('synthetic') >= 0
  )
    return 'Open or close one small position';
  if (c.indexOf('prediction') >= 0) return 'Take one small market position';
  if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('index') >= 0)
    return 'Deposit a little more or rebalance the vault once';
  if (c.indexOf('rwa') >= 0) return 'Mint or redeem a small amount once';
  if (c.indexOf('stable') >= 0) return 'Mint or redeem a small amount once';
  if (c.indexOf('insurance') >= 0) return 'Renew or adjust the cover once';
  return 'Make one deposit or interaction with the protocol once';
}

/** A step as one string: its action, then its cost and time. */
function stepText(step) {
  var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
  if (s.length > 600) s = s.slice(0, 596) + '...';
  if (s.length < 20) s = s + ' Hold the position and check the protocol\u2019s own page.';
  return s;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 * This is the same derivation main.ts writes to board.json.
 */
function farmSteps(row) {
  var chain = row.chains.length > 0 ? row.chains[0] : 'its main chain';
  var capital = capitalFor(row.tvl_usd);
  var hold = holdDaysFor(row.age_days);
  var gas = capital >= 150 ? 8 : 4;
  return [
    {
      text: 'Set up a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline',
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(row.category, row.name, capital, chain),
      cost: '$' + capital + ' of capital and about $' + gas + ' of gas',
      time: '15 minutes to set up',
    },
    {
      text: weeklyFor(row.category) + ' each week, on a different day than the last one',
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text:
        "Once a week, open " + row.name + "'s own points or rewards page and check what counted; claim only from the link the protocol itself publishes",
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes a week',
    },
    {
      text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot',
      cost: 'the $' + capital + ' stays in the position',
      time: hold + ' days',
    },
    {
      text: 'Write the wallet, the dates and every transaction in a farm log, then unwind in stages and keep a small position until any token event',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ].map(stepText);
}

/* ------------------------------------------------------------------ rendering (browser only) */

if (typeof document !== 'undefined' && document.getElementById('board')) {
  (function () {
    'use strict';

    var DATA = window.RADAR;
    if (!DATA) return;
    var model = DATA.model;

    var state = { q: '', category: 'all', chain: 'all', scope: 'all', sort: 'implied', selected: null };

    var params = new URLSearchParams(window.location.search);
    var view = params.get('view') || 'board';
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('scope')) state.scope = params.get('scope');
    if (params.get('q')) state.q = params.get('q');
    if (params.get('sort')) state.sort = params.get('sort');
    if (view === 'detail' && params.get('slug')) state.selected = params.get('slug');

    function el(tag, attrs) {
      var node = document.createElement(tag);
      if (attrs) {
        Object.keys(attrs).forEach(function (k) {
          if (k === 'class') node.className = attrs[k];
          else if (k === 'text') node.textContent = attrs[k];
          else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
          else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
        });
      }
      for (var i = 2; i < arguments.length; i++) {
        var child = arguments[i];
        if (child === null || child === undefined) continue;
        if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
        else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
        else node.appendChild(child);
      }
      return node;
    }

    function filteredRows() {
      var rows = DATA.rows.filter(function (r) {
        if (state.scope === 'watchlist' && !r.on_watchlist) return false;
        if (state.scope === 'early' && r.on_watchlist) return false;
        if (state.category !== 'all' && r.category !== state.category) return false;
        if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
        if (state.q) {
          var q = state.q.toLowerCase();
          if (r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
        }
        return true;
      });
      var by = {
        implied: function (a, b) { return a.rank - b.rank; },
        tvl: function (a, b) { return b.tvl_usd - a.tvl_usd || a.rank - b.rank; },
        growth: function (a, b) { return (b.change_7d === null ? -Infinity : b.change_7d) - (a.change_7d === null ? -Infinity : a.change_7d) || a.rank - b.rank; },
        age: function (a, b) { return (b.age_days === null ? -1 : b.age_days) - (a.age_days === null ? -1 : a.age_days) || a.rank - b.rank; },
      };
      return rows.sort(by[state.sort] || by.implied);
    }

    function renderMeta() {
      document.getElementById('meta').textContent =
        'Snapshot ' + DATA.as_of + ' \u00b7 ' + DATA.rows.length + ' pre-token rows on the board \u00b7 ' +
        DATA.watchlist_size + ' on the watchlist \u00b7 ' + DATA.early_size + ' early finds below the floor \u00b7 ' +
        DATA.live_size + ' already trading, shown apart';
      document.getElementById('source').textContent =
        'Snapshot: DefiLlama protocols, fetched ' + DATA.as_of + '. Floor for the watchlist: ' +
        fmtUsd(DATA.floor_usd) + '. Model ' + DATA.model_version + '.';
    }

    function renderStats() {
      var stats = document.getElementById('stats');
      stats.innerHTML = '';
      var items = [
        [String(DATA.watchlist_size), 'on the watchlist'],
        [String(DATA.board_size), 'rows on the board'],
        [String(DATA.early_size), 'early finds below the floor'],
        [fmtUsd(DATA.rows[0] ? DATA.rows[0].implied_value_usd : 0), 'top implied value'],
      ];
      items.forEach(function (it) {
        stats.appendChild(el('div', { class: 'stat' }, el('b', { text: it[0] }), el('span', { text: it[1] })));
      });
    }

    function fillSelect(id, values) {
      var sel = document.getElementById(id);
      values.forEach(function (v) {
        sel.appendChild(el('option', { value: v }, document.createTextNode(v)));
      });
      sel.value = id === 'category' ? state.category : state.chain;
    }

    function renderBoard() {
      var rows = filteredRows();
      var tbody = document.querySelector('#board tbody');
      tbody.innerHTML = '';
      rows.forEach(function (r) {
        var tr = el('tr', { class: state.selected === r.slug ? 'sel' : '', onclick: function () { select(r.slug); } });
        tr.appendChild(el('td', { class: 'num' }, document.createTextNode(String(r.rank))));
        var nameCell = el('td', null, el('span', { class: 'name', text: r.name }));
        if (r.on_watchlist) nameCell.appendChild(el('span', { class: 'badge', text: 'Watchlist' }));
        nameCell.appendChild(document.createElement('br'));
        nameCell.appendChild(el('span', { class: 'slug', text: r.slug }));
        tr.appendChild(nameCell);
        tr.appendChild(el('td', null, document.createTextNode(r.category || '—')));
        tr.appendChild(el('td', null, document.createTextNode(r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : ''))));
        tr.appendChild(el('td', { class: 'num' }, document.createTextNode(fmtUsd(r.tvl_usd))));
        var chg = el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg') }, document.createTextNode(fmtPct(r.change_7d)));
        tr.appendChild(chg);
        tr.appendChild(el('td', { class: 'num' }, document.createTextNode(fmtAge(r.age_days))));
        tr.appendChild(el('td', { class: 'num' }, document.createTextNode(fmtUsd(r.implied_value_usd))));
        tbody.appendChild(tr);
      });
      document.getElementById('count').textContent =
        'Showing ' + rows.length + ' of ' + DATA.rows.length + ' rows.';
      document.getElementById('board-title').textContent =
        state.scope === 'watchlist' ? 'The board — watchlist' :
        state.scope === 'early' ? 'The board — early finds' : 'The board';
    }

    function renderDetail() {
      var box = document.getElementById('detail');
      box.innerHTML = '';
      if (!state.selected) { box.hidden = true; return; }
      var row = null;
      DATA.rows.forEach(function (r) { if (r.slug === state.selected) row = r; });
      if (!row) { box.hidden = true; return; }
      box.hidden = false;
      var v = impliedOf(row, model);
      var match = v.implied === row.implied_value_usd;

      box.appendChild(el('h3', { text: '#' + row.rank + ' ' + row.name }));
      var chainsShort = row.chains.slice(0, 4).join(', ') + (row.chains.length > 4 ? ' +' + (row.chains.length - 4) + ' more' : '');
      box.appendChild(el('p', { class: 'sub', text:
        (row.category || 'No category') + ' \u00b7 ' + chainsShort +
        ' \u00b7 listed ' + (row.listed_at || 'date unknown') + ' \u00b7 ' +
        (row.on_watchlist ? 'on the watchlist' : 'an early find below the floor') +
        ' \u00b7 records no token' }));

      var cols = el('div', { class: 'cols' });
      var left = el('div');
      left.appendChild(el('h4', { text: 'How the value is worked out' }));
      var dl = el('dl');
      var facts = [
        ['Value locked', fmtUsd(row.tvl_usd)],
        ['7-day change', fmtPct(row.change_7d)],
        ['Age with no token', fmtAge(row.age_days)],
        ['Base (TVL \u00d7 0.30)', fmtUsd(row.tvl_usd * model.base_multiple)],
        ['Growth multiplier', fmtMult(v.growthMult)],
        ['Maturity multiplier', fmtMult(v.maturityMult)],
        ['Breadth multiplier', fmtMult(v.breadthMult) + ' (' + row.chains.length + ' chains)'],
        ['Category multiplier', fmtMult(v.categoryMult)],
        ['Implied value', fmtUsd(row.implied_value_usd)],
        ['Page recomputes', fmtUsd(v.implied) + (match ? ' — matches the board' : ' — differs from the board')],
      ];
      facts.forEach(function (f) {
        dl.appendChild(el('dt', { text: f[0] }));
        dl.appendChild(el('dd', { text: f[1] }));
      });
      left.appendChild(dl);
      cols.appendChild(left);

      var right = el('div');
      right.appendChild(el('h4', { text: 'Farm plan — six steps' }));
      var ol = el('ol');
      farmSteps(row).forEach(function (s) {
        var cut = s.indexOf(' Cost: ');
        var action = cut >= 0 ? s.slice(0, cut) : s;
        var rest = cut >= 0 ? s.slice(cut + 1) : '';
        var li = el('li', null, el('b', { text: action }));
        if (rest) li.appendChild(el('span', { text: rest }));
        ol.appendChild(li);
      });
      right.appendChild(ol);
      cols.appendChild(right);
      box.appendChild(cols);

      box.appendChild(el('p', { class: 'note', text:
        'This protocol records no token in the snapshot. That is the snapshot\u2019s record, not proof ' +
        'it has none, and the implied value is this radar\u2019s own claim, not a promise of a launch.' }));
    }

    function renderLive() {
      var tbody = document.querySelector('#live tbody');
      tbody.innerHTML = '';
      DATA.live.forEach(function (r) {
        var tr = el('tr');
        tr.appendChild(el('td', null, el('span', { class: 'name', text: r.name })));
        tr.appendChild(el('td', null, document.createTextNode(r.category || '—')));
        tr.appendChild(el('td', null, document.createTextNode(r.chains.slice(0, 3).join(', '))));
        tr.appendChild(el('td', { class: 'num' }, document.createTextNode(fmtUsd(r.tvl_usd))));
        tr.appendChild(el('td', { class: 'num' }, document.createTextNode(fmtUsd(r.mcap_usd))));
        tr.appendChild(el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg') }, document.createTextNode(fmtPct(r.change_7d))));
        tbody.appendChild(tr);
      });
    }

    function select(slug) {
      state.selected = state.selected === slug ? null : slug;
      renderBoard();
      renderDetail();
      if (state.selected) {
        var box = document.getElementById('detail');
        if (box.scrollIntoView) box.scrollIntoView({ block: 'nearest' });
      }
    }

    function wire() {
      var q = document.getElementById('q');
      q.value = state.q;
      q.addEventListener('input', function () { state.q = q.value; renderBoard(); });
      document.getElementById('sort').value = state.sort;
      document.getElementById('sort').addEventListener('change', function (e) { state.sort = e.target.value; renderBoard(); });
      document.getElementById('category').addEventListener('change', function (e) { state.category = e.target.value; renderBoard(); });
      document.getElementById('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
      var buttons = document.querySelectorAll('.scope button');
      buttons.forEach(function (b) {
        if (b.getAttribute('data-scope') === state.scope) b.classList.add('on');
        else b.classList.remove('on');
        b.addEventListener('click', function () {
          state.scope = b.getAttribute('data-scope');
          buttons.forEach(function (x) { x.classList.toggle('on', x === b); });
          renderBoard();
        });
      });
    }

    // Populate the filter selects from the data, then render.
    var categories = [];
    var chains = [];
    DATA.rows.forEach(function (r) {
      if (r.category && categories.indexOf(r.category) < 0) categories.push(r.category);
      r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
    });
    categories.sort();
    chains.sort();
    fillSelect('category', categories);
    fillSelect('chain', chains);

    renderMeta();
    renderStats();
    wire();
    renderBoard();
    renderLive();
    renderDetail();
    if (view === 'detail' && state.selected) {
      document.body.classList.add('detail-view');
    }
    var main = document.querySelector('main');
    if (main) main.setAttribute('aria-busy', 'false');
  })();
}
