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

function fe(v, d=2) { return Number(v||0).toLocaleString('de-DE', {minimumFractionDigits:d, maximumFractionDigits:d}) + '€'; }
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
const VAULT_ASSETS = [
  { id:'vwce', name:'VWCE',            sub:'FTSE All-World',      ter:0.0019 },
  { id:'tri',  name:'Triglav DMT EUR', sub:'Triglav Investments', ter:0.0076 },
  { id:'inf',  name:'Infond Globalni', sub:'Infond',              ter:0.0216 },
];

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
  const el = document.getElementById('vaultContent');
  if (!el) return;

  if (!dcaLog.length) {
    el.innerHTML = '<div class="portfolio-empty">no purchases logged yet</div>';
    return;
  }

  let html = '';
  VAULT_ASSETS.forEach(va => {
    const lots = dcaLog.filter(l => l.asset_id === va.id);
    if (!lots.length) return;

    const invested = lots.reduce((s, l) => s + Number(l.amount_eur), 0);
    const units    = lots.reduce((s, l) => s + Number(l.units), 0);
    const avgPrice = units > 0 ? invested / units : 0;
    const currVal  = units * (PX[va.id]?.p || 0);
    const pl       = currVal > 0 ? currVal - invested : null;
    const plClass  = pl !== null ? (pl >= 0 ? 'up' : 'dn') : 'fl';
    const plStr    = pl !== null ? (pl >= 0 ? '+' : '') + fe(pl) : '—';

    html += `<div class="vault-card" onclick="openLotModal('${va.id}')">
      <div class="a-name">${va.name}</div>
      <div class="a-sub" style="margin-bottom:14px">${va.sub}</div>
      <div class="vsumm-grid">
        <div><div class="vsumm-label">invested</div><div class="vsumm-val">${fe(invested, 0)}</div></div>
        <div><div class="vsumm-label">units</div><div class="vsumm-val">${fn(units, 4)}</div></div>
        <div><div class="vsumm-label">avg price</div><div class="vsumm-val">${fe(avgPrice)}</div></div>
        <div><div class="vsumm-label">value</div><div class="vsumm-val">${currVal > 0 ? fe(currVal, 0) : '—'}</div></div>
        <div><div class="vsumm-label">p/l</div><div class="vsumm-val ${plClass}">${plStr}</div></div>
        <div></div>
      </div>
    </div>`;
  });

  el.innerHTML = html;
}

function openLotModal(assetId) {
  const va = VAULT_ASSETS.find(v => v.id === assetId);
  if (!va) return;
  document.getElementById('lotOvTitle').textContent = va.name.toUpperCase();
  const lots = [...dcaLog].filter(l => l.asset_id === assetId).reverse();
  const listEl = document.getElementById('lotOvList');
  listEl.innerHTML = lots.map(lot => {
    const dateStr = new Date(lot.date + 'T00:00:00').toLocaleDateString('sl-SI', { day:'2-digit', month:'short', year:'numeric' });
    const tfYear  = new Date(lot.date + 'T00:00:00').getFullYear() + 15;
    const cd      = countdown(lot.date);
    return `<div class="lot-row">
      <div class="lot-left">
        <div class="lot-date">${dateStr}</div>
        <div class="lot-meta">${fn(lot.units, 4)} u · ${fe(lot.price_per_unit)}/u</div>
      </div>
      <div class="lot-right">
        <div class="lot-amt">${fe(lot.amount_eur, 0)}</div>
        <div class="lot-tf">${cd} · ${tfYear}</div>
      </div>
      <button class="lot-del" onclick="deleteLot(${lot.id},'${assetId}')" title="delete">×</button>
    </div>`;
  }).join('');
  // Fee analysis for active funds
  if (va && va.ter > 0.0019 && lots.length) {
    const fInvested  = lots.reduce((s, l) => s + Number(l.amount_eur), 0);
    const fUnits     = lots.reduce((s, l) => s + Number(l.units), 0);
    const fCurrVal   = fUnits * (PX[assetId]?.p || 0);
    const fFirstDate = new Date(lots[lots.length - 1].date + 'T00:00:00');
    const fYears     = (Date.now() - fFirstDate) / 31557600000;
    const fAvgVal    = (fInvested + (fCurrVal || fInvested)) / 2;
    const fFeesPaid  = fAvgVal * va.ter * fYears;
    const fVwceFees  = fAvgVal * 0.0019 * fYears;
    const fDrag      = fFeesPaid - fVwceFees;
    const fAnnual    = (fCurrVal || fInvested) * (va.ter - 0.0019);
    const fGain      = fCurrVal > 0 ? fCurrVal - fInvested : 0;
    const fTax       = fGain > 0 ? fGain * 0.25 : 0;
    const fBreak     = fAnnual > 0 && fTax > 0 ? fTax / fAnnual : null;

    listEl.innerHTML += '<div class="fee-analysis">'
      + '<div class="label" style="margin:20px 0 12px">FEE ANALYSIS · ' + (va.ter * 100).toFixed(2) + '% TER</div>'
      + '<div class="vsumm-grid">'
      + '<div><div class="vsumm-label">fees paid est.</div><div class="vsumm-val dn">~' + fe(fFeesPaid, 0) + '</div></div>'
      + '<div><div class="vsumm-label">vs vwce</div><div class="vsumm-val dn">~' + fe(fVwceFees, 0) + '</div></div>'
      + '<div><div class="vsumm-label">drag</div><div class="vsumm-val dn">~' + fe(fDrag, 0) + '</div></div>'
      + '<div><div class="vsumm-label">annual drag</div><div class="vsumm-val dn">~' + fe(fAnnual, 0) + '/yr</div></div>'
      + '<div><div class="vsumm-label">exit tax</div><div class="vsumm-val">' + (fTax > 0 ? fe(fTax, 0) : '—') + '</div></div>'
      + '<div><div class="vsumm-label">break-even</div><div class="vsumm-val' + (fBreak && fBreak < 4 ? ' dn' : '') + '">' + (fBreak ? fBreak.toFixed(1) + 'y' : '—') + '</div></div>'
      + '</div></div>';
  }

  document.getElementById('lotOv').classList.add('on');
}

function closeLotModal() {
  document.getElementById('lotOv').classList.remove('on');
}

function openLogBuy() {
  document.getElementById('logAsset').value  = 'vwce';
  document.getElementById('logDate').value   = new Date().toISOString().slice(0, 10);
  document.getElementById('logAmount').value = '';
  document.getElementById('logUnits').value  = '';
  document.getElementById('logPrice').value  = PX['vwce']?.p?.toFixed(2) || '';
  document.getElementById('logOv').classList.add('on');
  setTimeout(() => document.getElementById('logAmount').focus(), 50);
}

function logAssetChanged() {
  const id = document.getElementById('logAsset').value;
  const p  = PX[id]?.p;
  document.getElementById('logPrice').value  = p ? p.toFixed(2) : '';
  document.getElementById('logUnits').value  = '';
  document.getElementById('logAmount').value = '';
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
  const assetId  = document.getElementById('logAsset').value;
  const d        = new Date(date + 'T00:00:00');
  const isPhase1 = assetId === 'vwce' && d.getFullYear() === 2026 && d.getMonth() >= 5 && d.getMonth() <= 10;

  const btn = document.getElementById('logSaveBtn');
  btn.textContent = '…'; btn.disabled = true;
  try {
    const { data, error } = await sb.from('dca_log').insert({
      user_id: currentUser.id, asset_id: assetId,
      date, amount_eur: amount, units, price_per_unit: pricePerUnit, is_phase1: isPhase1,
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

async function deleteLot(id, assetId) {
  if (!confirm('Delete this purchase?')) return;
  try {
    const { error } = await sb.from('dca_log').delete().eq('id', id).eq('user_id', currentUser.id);
    if (error) throw error;
    dcaLog = dcaLog.filter(l => l.id !== id);
    renderVault();
    const remaining = dcaLog.filter(l => l.asset_id === assetId);
    if (remaining.length) openLotModal(assetId);
    else closeLotModal();
  } catch(e) { console.error('delete lot', e); alert(e.message); }
}

// ── REALIZED GAINS / €1,000 EXEMPTION ────────────────────────
let realizedGains = [];

async function loadRealizedGains() {
  if (!currentUser) return;
  try {
    const year = new Date().getFullYear();
    const { data, error } = await sb.from('realized_gains')
      .select('*')
      .eq('user_id', currentUser.id)
      .gte('date', `${year}-01-01`)
      .lte('date', `${year}-12-31`)
      .order('date', { ascending: true });
    if (error) throw error;
    realizedGains = data || [];
  } catch(e) { console.warn('realized_gains load', e); }
}

function renderExemptionBar() {
  const year  = new Date().getFullYear();
  const used  = realizedGains.reduce((s, g) => s + Number(g.gain_eur), 0);
  const pct   = Math.min(used / 1000 * 100, 100);
  const amtEl = document.getElementById('exemptionAmt');
  const fillEl = document.getElementById('exemptionFill');
  const yrEl  = document.getElementById('exemptionYear');
  if (yrEl)  yrEl.textContent  = year + ' EXEMPTION';
  if (amtEl) amtEl.textContent = used > 0 ? `${fe(used)} of 1.000€` : '0€ used';
  if (fillEl) {
    fillEl.style.width = pct + '%';
    fillEl.className = 'exm-bar-fill' + (used >= 1000 ? ' over' : used >= 800 ? ' warn' : '');
  }
}

function openGainModal() {
  const year = new Date().getFullYear();
  document.getElementById('gainOvTitle').textContent = `REALIZED GAINS ${year}`;
  document.getElementById('gainDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('gainNote').value = '';
  document.getElementById('gainAmt').value  = '';
  const listEl = document.getElementById('gainList');
  if (!realizedGains.length) {
    listEl.innerHTML = '<div class="portfolio-empty" style="padding:0 0 4px">no gains logged this year</div>';
  } else {
    const total = realizedGains.reduce((s, g) => s + Number(g.gain_eur), 0);
    listEl.innerHTML = realizedGains.map(g => {
      const dateStr = new Date(g.date + 'T00:00:00').toLocaleDateString('sl-SI', { day:'2-digit', month:'short' });
      return `<div class="lot-row">
        <div class="lot-left">
          <div class="lot-date">${dateStr}</div>
          <div class="lot-meta">${g.note || '—'}</div>
        </div>
        <div class="lot-right">
          <div class="lot-amt up">+${fe(g.gain_eur)}</div>
        </div>
        <button class="lot-del" onclick="deleteGain(${g.id})" title="delete">×</button>
      </div>`;
    }).join('') + `<div class="gain-total">total ${fe(total)} of 1.000€</div>`;
  }
  document.getElementById('gainOv').classList.add('on');
  setTimeout(() => document.getElementById('gainAmt').focus(), 50);
}

function closeGainModal() { document.getElementById('gainOv').classList.remove('on'); }

async function saveGain() {
  const date = document.getElementById('gainDate').value;
  const note = document.getElementById('gainNote').value.trim();
  const gain = parseFloat(document.getElementById('gainAmt').value);
  if (!date || !(gain > 0)) return;
  const btn = document.getElementById('gainSaveBtn');
  btn.textContent = '…'; btn.disabled = true;
  try {
    const { data, error } = await sb.from('realized_gains').insert({
      user_id: currentUser.id, date, gain_eur: gain, note: note || null,
    }).select().single();
    if (error) throw error;
    realizedGains.push(data);
    realizedGains.sort((a, b) => a.date.localeCompare(b.date));
    renderExemptionBar();
    openGainModal();
  } catch(e) {
    console.error('save gain', e);
    alert('Failed to save — run the realized_gains SQL in Supabase.\n\n' + e.message);
  } finally { btn.textContent = 'log'; btn.disabled = false; }
}

async function deleteGain(id) {
  if (!confirm('Delete this entry?')) return;
  try {
    const { error } = await sb.from('realized_gains').delete().eq('id', id).eq('user_id', currentUser.id);
    if (error) throw error;
    realizedGains = realizedGains.filter(g => g.id !== id);
    renderExemptionBar();
    openGainModal();
  } catch(e) { console.error('delete gain', e); alert(e.message); }
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
        .then(async () => { renderPortfolio(); await loadSnapshots(); await loadDcaLog(); await loadRealizedGains(); renderVault(); renderExemptionBar(); })
        .catch(e => console.error('[NYX] data load failed:', e));
    } else if (event === 'SIGNED_OUT' || (event === 'INITIAL_SESSION' && !currentUser)) {
      appStarted = false;
      showAuth();
    }
  });

  document.getElementById('ov')?.addEventListener('click',    e => { if (e.target === e.currentTarget) closeM(); });
  document.getElementById('addOv')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeAddAsset(); });
  document.getElementById('logOv')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeLogBuy(); });
  document.getElementById('lotOv')?.addEventListener('click',  e => { if (e.target === e.currentTarget) closeLotModal(); });
  document.getElementById('gainOv')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeGainModal(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeM();
    if (e.key === 'Enter' && document.getElementById('authOverlay').style.display !== 'none') authSubmit();
  });
});
