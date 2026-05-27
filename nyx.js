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

const CAT_ORDER  = ['crypto','etf','fund','cash'];
const CAT_LABELS = { crypto:'CRYPTO', etf:'ETF', fund:'FUND', cash:'CASH' };

let AS = []; // user's active portfolio — built from CATALOG + Supabase holdings
let PX = {};
let snapshots = [];
let dcaLog = [];

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
        renderPortfolio(); renderVault();
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
const TAB_TITLES = { portfolio: 'PORTFOLIO', vault: 'VAULT' };

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
  renderVault();
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

// ── VAULT / DCA LOG ──────────────────────────────────────────
const PHASE1_TOTAL = 9702;

function taxFreeDate(dateStr) {
  const d = new Date(dateStr);
  d.setFullYear(d.getFullYear() + 15);
  return d;
}

function countdown(dateStr) {
  const target = taxFreeDate(dateStr);
  const now    = new Date();
  const diff   = target - now;
  if (diff <= 0) return 'TAX FREE';
  const days   = Math.floor(diff / 86400000);
  const years  = Math.floor(days / 365.25);
  const months = Math.floor((days % 365.25) / 30.44);
  return years > 0 ? `${years}y ${months}m` : `${months}m`;
}

async function loadDcaLog() {
  if (!currentUser) return;
  try {
    const { data, error } = await sb.from('dca_log')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('date', { ascending: true });
    if (error) throw error;
    dcaLog = data || [];
  } catch(e) { console.warn('dca_log load', e); }
}

function renderVault() {
  const phase1Lots     = dcaLog.filter(l => l.is_phase1);
  const phase1Deployed = phase1Lots.reduce((s, l) => s + Number(l.amount_eur), 0);
  const phase1Pct      = Math.min(phase1Deployed / PHASE1_TOTAL * 100, 100);

  const fillEl = document.getElementById('vaultPhaseFill');
  const metaEl = document.getElementById('vaultPhaseMeta');
  if (fillEl) fillEl.style.width = phase1Pct.toFixed(1) + '%';
  if (metaEl) {
    const remaining = Math.max(0, PHASE1_TOTAL - phase1Deployed);
    metaEl.textContent = phase1Deployed > 0
      ? `${fe(phase1Deployed, 0)} of ${fe(PHASE1_TOTAL, 0)} · ${fe(remaining, 0)} remaining`
      : `${fe(PHASE1_TOTAL, 0)} to deploy · Jun–Nov 2026`;
  }

  const totalInvested = dcaLog.reduce((s, l) => s + Number(l.amount_eur), 0);
  const totalUnits    = dcaLog.reduce((s, l) => s + Number(l.units), 0);
  const avgPrice      = totalUnits > 0 ? totalInvested / totalUnits : 0;
  const currentPrice  = PX['vwce']?.p || 0;
  const currentVal    = totalUnits * currentPrice;
  const unrlz         = currentVal - totalInvested;

  const summEl = document.getElementById('vaultSummary');
  if (summEl) {
    if (!dcaLog.length) {
      summEl.innerHTML = '';
    } else {
      const plClass = unrlz >= 0 ? 'up' : 'dn';
      const plStr   = (unrlz >= 0 ? '+' : '') + fe(unrlz);
      summEl.innerHTML = `<div class="vsumm-grid">
        <div><div class="vsumm-label">invested</div><div class="vsumm-val">${fe(totalInvested, 0)}</div></div>
        <div><div class="vsumm-label">units</div><div class="vsumm-val">${fn(totalUnits, 4)}</div></div>
        <div><div class="vsumm-label">avg price</div><div class="vsumm-val">${fe(avgPrice)}</div></div>
        ${currentVal > 0 ? `
        <div><div class="vsumm-label">value</div><div class="vsumm-val">${fe(currentVal, 0)}</div></div>
        <div><div class="vsumm-label">p/l</div><div class="vsumm-val ${plClass}">${plStr}</div></div>
        <div></div>` : ''}
      </div>`;
    }
  }

  const lotEl = document.getElementById('lotList');
  if (!lotEl) return;
  if (!dcaLog.length) {
    lotEl.innerHTML = '<div class="portfolio-empty">no purchases logged yet</div>';
    return;
  }
  lotEl.innerHTML = [...dcaLog].reverse().map(lot => {
    const dateStr = new Date(lot.date + 'T00:00:00').toLocaleDateString('sl-SI', { day:'2-digit', month:'short', year:'numeric' });
    const tfYear  = new Date(lot.date + 'T00:00:00').getFullYear() + 15;
    const cd      = countdown(lot.date);
    return `<div class="lot-row">
      <div class="lot-left">
        <div class="lot-date">${dateStr}</div>
        <div class="lot-meta">${fn(lot.units, 4)} u · ${fe(lot.price_per_unit)}/u${lot.is_phase1 ? ' · p1' : ''}</div>
      </div>
      <div class="lot-right">
        <div class="lot-amt">${fe(lot.amount_eur, 0)}</div>
        <div class="lot-tf">${cd} · ${tfYear}</div>
      </div>
      <button class="lot-del" onclick="deleteLot(${lot.id})" title="delete">×</button>
    </div>`;
  }).join('');
}

function openLogBuy() {
  document.getElementById('logDate').value   = new Date().toISOString().slice(0, 10);
  document.getElementById('logAmount').value = '';
  document.getElementById('logUnits').value  = '';
  document.getElementById('logPrice').value  = PX['vwce']?.p?.toFixed(2) || '';
  document.getElementById('logOv').classList.add('on');
  setTimeout(() => document.getElementById('logAmount').focus(), 50);
}

function closeLogBuy() { document.getElementById('logOv').classList.remove('on'); }

function logCalc(mode) {
  const amount = parseFloat(document.getElementById('logAmount').value);
  const units  = parseFloat(document.getElementById('logUnits').value);
  const price  = parseFloat(document.getElementById('logPrice').value);
  if (mode === 'price' && amount > 0 && units > 0) {
    document.getElementById('logPrice').value = (amount / units).toFixed(4);
  } else if (mode === 'units' && amount > 0 && price > 0) {
    document.getElementById('logUnits').value = (amount / price).toFixed(4);
  }
}

async function saveLogBuy() {
  const date   = document.getElementById('logDate').value;
  const amount = parseFloat(document.getElementById('logAmount').value);
  const units  = parseFloat(document.getElementById('logUnits').value);
  const price  = parseFloat(document.getElementById('logPrice').value);
  if (!date || !(amount > 0) || !(units > 0)) return;
  const pricePerUnit = price > 0 ? price : amount / units;
  const d        = new Date(date + 'T00:00:00');
  const isPhase1 = d.getFullYear() === 2026 && d.getMonth() >= 5 && d.getMonth() <= 10;

  const btn = document.getElementById('logSaveBtn');
  btn.textContent = '…'; btn.disabled = true;
  try {
    const { data, error } = await sb.from('dca_log').insert({
      user_id: currentUser.id, asset_id: 'vwce',
      date, amount_eur: amount, units, price_per_unit: pricePerUnit, is_phase1,
    }).select().single();
    if (error) throw error;
    dcaLog.push(data);
    dcaLog.sort((a, b) => a.date.localeCompare(b.date));
    closeLogBuy();
    renderVault();
  } catch(e) {
    console.error('log buy', e);
    alert('Failed to save — make sure the dca_log table exists in Supabase.\n\n' + e.message);
  } finally {
    btn.textContent = 'save'; btn.disabled = false;
  }
}

async function deleteLot(id) {
  if (!confirm('Delete this purchase entry?')) return;
  try {
    const { error } = await sb.from('dca_log').delete().eq('id', id).eq('user_id', currentUser.id);
    if (error) throw error;
    dcaLog = dcaLog.filter(l => l.id !== id);
    renderVault();
  } catch(e) { console.error('delete lot', e); alert(e.message); }
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
      renderPortfolio(); renderVault();
      if (!appStarted) {
        fetchAll();
        setInterval(fetchAll, 5 * 60 * 1000);
        appStarted = true;
      }
      loadHoldings()
        .then(async () => { renderPortfolio(); await loadSnapshots(); await loadDcaLog(); renderVault(); })
        .catch(e => console.error('[NYX] data load failed:', e));
    } else if (event === 'SIGNED_OUT' || (event === 'INITIAL_SESSION' && !currentUser)) {
      appStarted = false;
      showAuth();
    }
  });

  document.getElementById('ov')?.addEventListener('click',    e => { if (e.target === e.currentTarget) closeM(); });
  document.getElementById('addOv')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeAddAsset(); });
  document.getElementById('logOv')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeLogBuy(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeM();
    if (e.key === 'Enter' && document.getElementById('authOverlay').style.display !== 'none') authSubmit();
  });
});
