// ── SUPABASE ──────────────────────────────────────────────────
const sb = supabase.createClient(
  'https://nkfmpnscfzqjozuutokc.supabase.co',
  'sb_publishable_TTqv2jhLtj9Pk_nB-Mb99Q_wt0E1zvn'
);
let currentUser = null;

// ── CATALOG ───────────────────────────────────────────────────
const CATALOG = [
  // Crypto — prices via CoinGecko EUR
  { id:'eth',  name:'Ethereum',         sub:'ETH',                cat:'crypto', src:'cg', cgId:'ethereum' },
  { id:'link', name:'Chainlink',        sub:'LINK',               cat:'crypto', src:'cg', cgId:'chainlink' },
  // ETFs — prices via GitHub Actions → data/funds.json (Yahoo Finance EOD)
  { id:'vwce', name:'VWCE',             sub:'FTSE All-World',     cat:'etf',   src:'fund' },
  // Slovenian mutual funds — prices via GitHub Actions → data/funds.json
  { id:'tri',  name:'Triglav DMT EUR',  sub:'Triglav Investments', cat:'fund', src:'fund' },
  { id:'inf',  name:'Infond Globalni',  sub:'Infond',              cat:'fund', src:'fund' },
  // Cash (manual price, always €1)
  { id:'cash', name:'Savings',          sub:'EUR',                cat:'cash',  src:'manual', manual:1 },
  { id:'chk',  name:'Checking',         sub:'EUR',                cat:'cash',  src:'manual', manual:1 },
];

let AS = []; // user's active portfolio — built from CATALOG + Supabase holdings
let PX = {};
let snapshots = [];

// ── STORAGE ──────────────────────────────────────────────────
async function saveHoldings() {
  if (!currentUser || !AS.length) return;
  await sb.from('holdings').upsert(
    AS.map(a => ({
      user_id:      currentUser.id,
      asset_id:     a.id,
      qty:          a.qty || 0,
      buy_price:    a.buy || 0,
      manual_price: a.src === 'manual' ? (a.manual || 1) : null,
    })),
    { onConflict: 'user_id,asset_id' }
  );
}

async function loadHoldings() {
  if (!currentUser) return;
  const { data } = await sb.from('holdings').select('*').eq('user_id', currentUser.id);
  if (!data) return;
  AS.length = 0;
  data.forEach(row => {
    const template = CATALOG.find(c => c.id === row.asset_id);
    if (!template) return;
    const asset = { ...template, qty: row.qty || 0, buy: row.buy_price || 0 };
    if (row.manual_price != null) asset.manual = row.manual_price;
    AS.push(asset);
  });
}

async function saveSnapshot() {
  if (!currentUser) return;
  const total = AS.reduce((s, a) => s + gV(a), 0);
  if (total <= 0) return;
  const date  = new Date().toISOString().slice(0, 10);
  const entry = { date, total_eur: Math.round(total * 100) / 100 };
  try {
    await sb.from('snapshots').upsert(
      { user_id: currentUser.id, ...entry },
      { onConflict: 'user_id,date' }
    );
    const idx = snapshots.findIndex(s => s.date === date);
    if (idx >= 0) snapshots[idx] = entry;
    else { snapshots.push(entry); snapshots.sort((a, b) => a.date.localeCompare(b.date)); }
    renderAnalytics();
  } catch(e) { console.warn('snapshot save', e); }
}

async function loadSnapshots() {
  if (!currentUser) return;
  try {
    const { data } = await sb.from('snapshots')
      .select('date, total_eur')
      .eq('user_id', currentUser.id)
      .order('date', { ascending: true })
      .limit(90);
    snapshots = data || [];
  } catch(e) { console.warn('snapshots load', e); }
}

async function addAsset(id) {
  if (AS.find(a => a.id === id)) { closeAddAsset(); return; }
  const template = CATALOG.find(c => c.id === id);
  if (!template) return;
  const asset = { ...template, qty: 0, buy: 0 };
  if (template.src === 'manual') { asset.manual = 1; PX[id] = { p: 1, ch: 0 }; }
  AS.push(asset);
  closeAddAsset();
  renderPortfolio();
  if (template.src === 'cg') fetchCoinGecko().then(renderPortfolio);
  if (currentUser) {
    await sb.from('holdings').upsert({
      user_id:      currentUser.id,
      asset_id:     id,
      qty:          0,
      buy_price:    0,
      manual_price: template.src === 'manual' ? 1 : null,
    }, { onConflict: 'user_id,asset_id' });
  }
}

async function removeAsset(id) {
  const idx = AS.findIndex(a => a.id === id);
  if (idx < 0) return;
  AS.splice(idx, 1);
  delete PX[id];
  closeM();
  renderPortfolio();
  if (currentUser) {
    await sb.from('holdings').delete().eq('user_id', currentUser.id).eq('asset_id', id);
  }
}

function savePX() { localStorage.setItem('nyx_px', JSON.stringify(PX)); }
function loadPX() {
  try {
    const c = JSON.parse(localStorage.getItem('nyx_px') || '{}');
    Object.entries(c).forEach(([k, v]) => { if (v && typeof v.p === 'number') PX[k] = v; });
  } catch(e) {}
}

// ── AUTH ─────────────────────────────────────────────────────
let isSignUp = false;
let appStarted = false;

function friendlyError(error) {
  const msg = error.message || '';
  if (/invalid login/i.test(msg))       return 'wrong email or password';
  if (/email not confirmed/i.test(msg)) return 'check your email to confirm your account';
  if (/already registered/i.test(msg))  return 'email already in use — try signing in';
  if (/password.*6/i.test(msg))         return 'password must be at least 6 characters';
  if (/invalid email/i.test(msg))       return 'invalid email address';
  if (/rate limit/i.test(msg))          return 'too many attempts — wait a moment';
  return msg || 'something went wrong';
}

function showAuth() {
  document.getElementById('authOverlay').style.display = 'flex';
  document.getElementById('nyxWrapper').style.display  = 'none';
}

function hideAuth() {
  document.getElementById('authOverlay').style.display = 'none';
  document.getElementById('nyxWrapper').style.display  = 'flex';
  requestAnimationFrame(() => switchTab('portfolio', false));
}

function toggleAuthMode() {
  isSignUp = !isSignUp;
  document.getElementById('authWinTitle').textContent   = isSignUp ? 'SIGN UP' : 'SIGN IN';
  document.getElementById('authSubmitBtn').textContent  = isSignUp ? 'SIGN UP' : 'SIGN IN';
  document.getElementById('authToggleText').textContent = isSignUp ? 'already have an account? sign in' : 'no account? sign up';
  document.getElementById('authError').textContent = '';
}

async function authSubmit() {
  const email    = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const errEl    = document.getElementById('authError');
  errEl.textContent = '';
  errEl.style.color = '';

  if (!email || !password) { errEl.textContent = 'enter email and password'; return; }

  const btn = document.getElementById('authSubmitBtn');
  btn.textContent = '…'; btn.disabled = true;

  try {
    if (isSignUp) {
      const { error } = await sb.auth.signUp({ email, password });
      if (error) { console.error('signup error:', error); errEl.textContent = friendlyError(error); }
      else { errEl.style.color = 'rgba(140,255,170,0.9)'; errEl.textContent = 'check your email to confirm'; }
    } else {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) {
        console.error('signin error:', error);
        errEl.textContent = friendlyError(error);
      } else {
        currentUser = data.user;
        try { await loadHoldings(); } catch(e) { console.error('data load:', e); }
        hideAuth();
        renderPortfolio(); renderAnalytics();
        if (!appStarted) { fetchAll(); setInterval(fetchAll, 5 * 60 * 1000); appStarted = true; }
      }
    }
  } catch(e) {
    console.error('auth error:', e);
    errEl.textContent = 'something went wrong — check console';
  } finally {
    btn.textContent = isSignUp ? 'SIGN UP' : 'SIGN IN';
    btn.disabled = false;
  }
}

async function signOut() {
  await sb.auth.signOut();
  AS.length = 0;
  PX = {};
  snapshots = [];
}

// ── TAB NAVIGATION ────────────────────────────────────────────
const TAB_TITLES = { portfolio: 'PORTFOLIO', analytics: 'ANALYTICS' };

function switchTab(id, animate = true) {
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + id).classList.add('active');
  const btn = document.querySelector(`.tab-btn[data-tab="${id}"]`);
  btn.classList.add('active');
  document.getElementById('winTitle').textContent = TAB_TITLES[id] || id.toUpperCase();
  const ind = document.querySelector('.tab-indicator');
  if (ind) {
    if (!animate) ind.style.transition = 'none';
    ind.style.left = (btn.offsetLeft + btn.offsetWidth / 2 - 2) + 'px';
    if (!animate) requestAnimationFrame(() => { ind.style.transition = ''; });
  }
}

// ── PRICE FETCH ──────────────────────────────────────────────
async function fetchCoinGecko() {
  const needed = new Map();
  CATALOG.filter(c => c.src === 'cg').forEach(c => {
    if (AS.find(a => a.id === c.id)) needed.set(c.cgId, c.id);
  });
  if (!needed.size) return;
  try {
    const r = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${[...needed.keys()].join(',')}&vs_currencies=eur&include_24hr_change=true`
    );
    if (!r.ok) return;
    const d = await r.json();
    needed.forEach((assetId, cgId) => {
      const row = d[cgId];
      if (row?.eur) PX[assetId] = { p: row.eur, ch: row.eur_24h_change || 0 };
    });
  } catch(e) { console.warn('coingecko', e); }
}

async function fetchFundsJson() {
  try {
    const r = await fetch('data/funds.json?_=' + Date.now());
    if (!r.ok) return;
    const d = await r.json();
    if (!d.prices) return;
    Object.entries(d.prices).forEach(([id, px]) => {
      if (px && typeof px.p === 'number') PX[id] = px;
    });
    const age = Date.now() - new Date(d.updated).getTime();
    const ageStr = age < 3600000 ? Math.round(age / 60000) + 'm ago'
                 : age < 86400000 ? Math.round(age / 3600000) + 'h ago'
                 : Math.round(age / 86400000) + 'd ago';
    console.log(`[NYX] prices updated ${ageStr}`);
  } catch(e) { console.warn('fund json', e); }
}

async function fetchAll() {
  setStatus('fetching...');
  await fetchFundsJson();
  await Promise.allSettled([fetchCoinGecko()]);
  AS.filter(a => a.src === 'manual').forEach(a => { PX[a.id] = { p: a.manual || 1, ch: 0 }; });
  savePX();
  const t = new Date().toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' });
  setStatus(`updated ${t}`);
  renderPortfolio();
  renderAnalytics();
  saveSnapshot();
}

// ── FORMAT ───────────────────────────────────────────────────
const gP  = a => PX[a.id]?.p  || 0;
const gCh = a => PX[a.id]?.ch || 0;
const gV  = a => gP(a) * a.qty;

function fe(v, d=2) { return '€ ' + Number(v||0).toLocaleString('de-DE', {minimumFractionDigits:d, maximumFractionDigits:d}); }
function fp(v)      { return (v>=0?'+':'')+Number(v||0).toFixed(2)+'%'; }
function fn(v, d=4) { return Number(v||0).toLocaleString('de-DE', {maximumFractionDigits:d}); }
function setStatus(t) { const el = document.getElementById('statusTxt'); if (el) el.textContent = t; }

// ── PORTFOLIO ────────────────────────────────────────────────
function renderPortfolio() {
  const T = AS.reduce((s, a) => s + gV(a), 0);
  const el = document.getElementById('total');
  if (el) el.textContent = T > 0 ? fe(T) : '€ —';
  const wch = T > 0 ? AS.reduce((s, a) => s + gCh(a) * gV(a), 0) / T : 0;
  const cel = document.getElementById('totalChange');
  if (cel) { cel.textContent = T > 0 ? fp(wch) + ' today' : '—'; cel.className = 'total-ch ' + (wch >= 0 ? 'up' : 'dn'); }
  const list = document.getElementById('assetList'); if (!list) return;
  if (!AS.length) {
    list.innerHTML = '<div class="portfolio-empty">tap + to add your first asset</div>';
    return;
  }
  list.innerHTML = AS.map(a => {
    const p = gP(a), ch = gCh(a), v = gV(a);
    const pStr = p > 0 ? fe(p) : '<span class="loading">…</span>';
    const chStr = p > 0 ? `<div class="a-ch ${ch>=0?'up':'dn'}">${fp(ch)}</div>` : '';
    return `<div class="asset" onclick="openM('${a.id}')">
      <div><div class="a-name">${a.name}</div><div class="a-sub">${a.sub}</div></div>
      <div><div class="a-price">${pStr}</div>${chStr}</div>
      <div><div class="a-val">${a.qty > 0 ? fe(v) : '—'}</div><div class="a-units">${a.qty > 0 ? fn(a.qty) + ' u' : 'tap'}</div></div>
    </div>`;
  }).join('');
}

// ── ANALYTICS ────────────────────────────────────────────────
const CAT_ORDER  = ['crypto','etf','fund','cash'];
const CAT_LABELS = { crypto:'CRYPTO', etf:'ETF', fund:'FUND', cash:'CASH' };

function renderSparkline(elId, values) {
  const el = document.getElementById(elId); if (!el) return;
  const pts = (values || []).map(Number).filter(Number.isFinite);
  if (pts.length < 2) { el.innerHTML = '<div class="news-loading">building history…</div>'; return; }
  const w = 320, h = 70, pad = 4;
  const min = Math.min(...pts), max = Math.max(...pts), span = max - min || 1;
  const step = (w - pad * 2) / (pts.length - 1);
  const points = pts.map((v, i) => [pad + i * step, pad + (h - pad * 2) * (1 - (v - min) / span)]);
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `M ${points[0][0].toFixed(1)} ${h - pad} L ${points.map(([x,y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ')} L ${points[points.length-1][0].toFixed(1)} ${h - pad} Z`;
  const rising = pts[pts.length - 1] >= pts[0];
  const stroke = rising ? 'rgba(140,255,170,0.92)' : 'rgba(255,100,100,0.92)';
  const fill   = rising ? 'rgba(140,255,170,0.10)' : 'rgba(255,100,100,0.10)';
  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <rect class="spark-bg" x="0" y="0" width="${w}" height="${h}" rx="8"></rect>
    <path class="spark-area" d="${area}" style="fill:${fill}"></path>
    <polyline class="spark-line" points="${line}" style="stroke:${stroke}"></polyline>
  </svg>`;
}

function renderAnalytics() {
  const total = AS.reduce((s, a) => s + gV(a), 0);

  // Net worth history chart
  if (snapshots.length >= 2) {
    renderSparkline('analyticsChart', snapshots.map(s => parseFloat(s.total_eur)));
  }

  // Allocation
  const el = document.getElementById('allocList');
  if (!el) return;

  if (total <= 0) {
    el.innerHTML = '<div class="portfolio-empty">set quantities in Portfolio to see allocation</div>';
    return;
  }

  // By category
  const byCat = {};
  AS.forEach(a => { const v = gV(a); if (v > 0) byCat[a.cat] = (byCat[a.cat] || 0) + v; });

  let html = '';
  CAT_ORDER.forEach(cat => {
    if (!byCat[cat]) return;
    const pct = byCat[cat] / total * 100;
    html += `<div class="alloc-row">
      <div class="alloc-label">${CAT_LABELS[cat]}</div>
      <div class="alloc-bar-track"><div class="alloc-bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
      <div class="alloc-pct">${pct.toFixed(1)}%</div>
      <div class="alloc-val">${fe(byCat[cat])}</div>
    </div>`;
  });

  // By asset
  const withValue = AS.filter(a => gV(a) > 0).sort((a, b) => gV(b) - gV(a));
  if (withValue.length > 1) {
    html += '<div class="divider"></div>';
    withValue.forEach(a => {
      const v = gV(a), pct = v / total * 100;
      html += `<div class="alloc-row">
        <div class="alloc-label">${a.name}</div>
        <div class="alloc-bar-track"><div class="alloc-bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
        <div class="alloc-pct">${pct.toFixed(1)}%</div>
        <div class="alloc-val">${fe(v)}</div>
      </div>`;
    });
  }

  el.innerHTML = html;
}

// ── ADD ASSET PICKER ─────────────────────────────────────────
function openAddAsset() {
  renderAssetCatalog('');
  document.getElementById('addOv').classList.add('on');
  setTimeout(() => document.getElementById('assetSearch')?.focus(), 50);
}

function closeAddAsset() {
  document.getElementById('addOv').classList.remove('on');
  const s = document.getElementById('assetSearch');
  if (s) s.value = '';
}

function renderAssetCatalog(query) {
  const q = (query || '').toLowerCase();
  const added = new Set(AS.map(a => a.id));
  const items = CATALOG.filter(c =>
    !added.has(c.id) &&
    (!q || c.name.toLowerCase().includes(q) || c.sub.toLowerCase().includes(q) || c.id.includes(q))
  );
  const el = document.getElementById('catalogList');
  if (!el) return;
  if (!items.length) { el.innerHTML = '<div class="news-loading" style="padding:12px 0">nothing left to add</div>'; return; }
  let html = '';
  CAT_ORDER.forEach(cat => {
    const group = items.filter(c => c.cat === cat);
    if (!group.length) return;
    html += `<div class="add-cat-header">${CAT_LABELS[cat]}</div>`;
    group.forEach(c => {
      html += `<div class="add-asset-item" onclick="addAsset('${c.id}')">
        <div class="aa-info"><div class="aa-name">${c.name}</div><div class="aa-sub">${c.sub}</div></div>
        <div class="aa-plus">+</div>
      </div>`;
    });
  });
  el.innerHTML = html;
}

// ── PORTFOLIO MODAL ──────────────────────────────────────────
function openM(id) {
  const a = AS.find(x => x.id === id); if (!a) return;
  document.getElementById('eId').value  = id;
  document.getElementById('mTitle').textContent = a.name.toUpperCase();
  document.getElementById('eQty').value = a.qty  || '';
  document.getElementById('eBuy').value = a.buy  || '';
  document.getElementById('eMan').value = a.manual || '';
  document.getElementById('mManField').style.display = a.src === 'manual' ? 'block' : 'none';
  document.getElementById('ov').classList.add('on');
  setTimeout(() => document.getElementById('eQty').focus(), 50);
}

function closeM() { document.getElementById('ov').classList.remove('on'); }

async function saveH() {
  const id = document.getElementById('eId').value;
  const a  = AS.find(x => x.id === id); if (!a) return;
  a.qty = parseFloat(document.getElementById('eQty').value) || 0;
  a.buy = parseFloat(document.getElementById('eBuy').value) || 0;
  if (a.src === 'manual') {
    a.manual = parseFloat(document.getElementById('eMan').value) || 1;
    PX[a.id] = { p: a.manual, ch: 0 };
  }
  closeM();
  renderPortfolio();
  await saveHoldings();
}

// ── BOOT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadPX();
  requestAnimationFrame(() => switchTab('portfolio', false));

  sb.auth.onAuthStateChange(async (event, session) => {
    currentUser = session?.user || null;

    if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && currentUser) {
      hideAuth();
      renderPortfolio(); renderAnalytics();
      if (!appStarted) {
        fetchAll();
        setInterval(fetchAll, 5 * 60 * 1000);
        appStarted = true;
      }
      loadHoldings()
        .then(async () => { renderPortfolio(); await loadSnapshots(); renderAnalytics(); })
        .catch(e => console.error('[NYX] data load failed:', e));
    } else if (event === 'SIGNED_OUT' || (event === 'INITIAL_SESSION' && !currentUser)) {
      appStarted = false;
      showAuth();
    }
  });

  document.getElementById('ov')?.addEventListener('click',    e => { if (e.target === e.currentTarget) closeM(); });
  document.getElementById('addOv')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeAddAsset(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeM();
    if (e.key === 'Enter' && document.getElementById('authOverlay').style.display !== 'none') authSubmit();
  });
});
