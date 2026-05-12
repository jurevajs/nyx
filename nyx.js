/* ═══════════════════════════════════════════
   NYX — core logic
   ═══════════════════════════════════════════ */

// ── BACKGROUND ────────────────────────────────────────────────
(function initBg() {
  const canvas = document.getElementById('bgCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let w, h;

  let mx = 0.5, tx = 0.5;

  const STARS = Array.from({ length: 70 }, (_, i) => ({
    x: (Math.sin(i * 127.31) * 0.5 + 0.5),
    y: (Math.sin(i * 311.71) * 0.5 + 0.5) * 0.46,
    r: (Math.sin(i * 89.13)  * 0.5 + 0.5) * 0.85 + 0.18,
    a: (Math.sin(i * 241.93) * 0.5 + 0.5) * 0.32 + 0.07,
  }));

  const LAYERS = [
    { yFrac: 0.54, amp: 0.21, par: 0.006, fill: 'rgba(42,42,42,0.97)', freq: [[1.3,0.4,0.50],[2.4,1.9,0.30],[4.2,3.3,0.16],[0.7,0.8,0.40]] },
    { yFrac: 0.60, amp: 0.28, par: 0.014, fill: 'rgba(24,24,24,1)',    freq: [[1.0,1.6,0.55],[2.2,0.3,0.37],[3.8,3.0,0.21],[1.5,2.3,0.28]] },
    { yFrac: 0.66, amp: 0.36, par: 0.024, fill: 'rgba(13,13,13,1)',    freq: [[0.8,2.9,0.63],[1.8,1.2,0.41],[3.4,0.6,0.27],[5.1,4.3,0.13]] },
    { yFrac: 0.73, amp: 0.45, par: 0.038, fill: 'rgba(3,3,3,1)',       freq: [[0.6,3.6,0.70],[1.4,2.1,0.47],[2.7,1.4,0.31],[4.3,0.9,0.17]] },
  ];

  function profileY(xn, freqs) {
    let v = 0;
    freqs.forEach(([f, ph, a]) => { v += Math.max(0, Math.sin(xn * Math.PI * f + ph)) * a; });
    return v;
  }

  function drawLayer(layer, parallaxX) {
    const baseY = h * layer.yFrac, amp = h * layer.amp, ox = parallaxX * layer.par * w;
    ctx.save(); ctx.translate(ox, 0); ctx.beginPath(); ctx.moveTo(-250, h + 10);
    for (let px = -250; px <= w + 250; px += 2) {
      const xn = (px + 250) / (w + 500);
      ctx.lineTo(px, baseY - profileY(xn, layer.freq) * amp);
    }
    ctx.lineTo(w + 250, h + 10); ctx.closePath(); ctx.fillStyle = layer.fill; ctx.fill(); ctx.restore();
  }

  function frame() {
    tx += (mx - tx) * 0.045;
    const px = tx - 0.5;
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#030303'); sky.addColorStop(0.40, '#0b0b0b');
    sky.addColorStop(0.60, '#131313'); sky.addColorStop(1, '#1a1a1a');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    const gx = w * (0.62 + px * 0.04), gy = h * 0.38;
    const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, w * 0.55);
    glow.addColorStop(0, 'rgba(255,255,255,0.07)'); glow.addColorStop(0.45, 'rgba(255,255,255,0.018)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
    STARS.forEach(s => { ctx.beginPath(); ctx.arc(s.x * w + px * 0.004 * w, s.y * h, s.r, 0, Math.PI * 2); ctx.fillStyle = `rgba(255,255,255,${s.a})`; ctx.fill(); });
    LAYERS.forEach(layer => drawLayer(layer, px));
    requestAnimationFrame(frame);
  }

  function resize() { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; }
  document.addEventListener('mousemove', e => { mx = e.clientX / window.innerWidth; });
  window.addEventListener('resize', resize);
  resize(); frame();
})();

// ── SUPABASE ──────────────────────────────────────────────────
const sb = supabase.createClient(
  'https://nkfmpnscfzqjozuutokc.supabase.co',
  'sb_publishable_TTqv2jhLtj9Pk_nB-Mb99Q_wt0E1zvn'
);
let currentUser = null;

// ── CATALOG ───────────────────────────────────────────────────
const CATALOG = [
  // Crypto — prices via CoinGecko EUR
  { id:'btc',  name:'Bitcoin',          sub:'BTC',                cat:'crypto', src:'cg', cgId:'bitcoin'       },
  { id:'eth',  name:'Ethereum',         sub:'ETH',                cat:'crypto', src:'cg', cgId:'ethereum'      },
  { id:'sol',  name:'Solana',           sub:'SOL',                cat:'crypto', src:'cg', cgId:'solana'        },
  { id:'bnb',  name:'BNB',              sub:'BNB',                cat:'crypto', src:'cg', cgId:'binancecoin'   },
  { id:'xrp',  name:'XRP',              sub:'XRP',                cat:'crypto', src:'cg', cgId:'ripple'        },
  { id:'ada',  name:'Cardano',          sub:'ADA',                cat:'crypto', src:'cg', cgId:'cardano'       },
  { id:'avax', name:'Avalanche',        sub:'AVAX',               cat:'crypto', src:'cg', cgId:'avalanche-2'   },
  { id:'dot',  name:'Polkadot',         sub:'DOT',                cat:'crypto', src:'cg', cgId:'polkadot'      },
  { id:'link', name:'Chainlink',        sub:'LINK',               cat:'crypto', src:'cg', cgId:'chainlink'     },
  { id:'pol',  name:'Polygon',          sub:'POL',                cat:'crypto', src:'cg', cgId:'matic-network' },
  // ETFs — prices via GitHub Actions → data/funds.json (Stooq EOD)
  { id:'vwce', name:'VWCE',             sub:'FTSE All-World',     cat:'etf',   src:'fund' },
  { id:'cspx', name:'CSPX',             sub:'S&P 500',            cat:'etf',   src:'fund' },
  { id:'iwda', name:'IWDA',             sub:'MSCI World',         cat:'etf',   src:'fund' },
  // Stocks — prices via GitHub Actions → data/funds.json (Stooq EOD)
  { id:'krkg', name:'Krka d.d.',        sub:'KRKG.LJ',            cat:'stock', src:'fund' },
  // Slovenian mutual funds — prices via GitHub Actions → data/funds.json
  { id:'tri',  name:'Triglav DMT EUR',  sub:'Triglav Investments', cat:'fund', src:'fund' },
  { id:'inf',  name:'Infond Globalni',  sub:'Infond',              cat:'fund', src:'fund' },
  // Cash (manual price, always €1)
  { id:'cash', name:'Savings',          sub:'EUR',                cat:'cash',  src:'manual', manual:1 },
  { id:'chk',  name:'Checking',         sub:'EUR',                cat:'cash',  src:'manual', manual:1 },
];

let AS = []; // user's active portfolio — built from CATALOG + Supabase holdings

let PX = {};
let investSignals = {};
let chartRanges = { eth: '1h', vwce: '7d' };
let chartSeries  = { eth: {}, vwce: {} };
let FUND_HISTORY = {};

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
        renderPortfolio(); renderInvest();
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
  budget = { paycheck: 0, rent: 30, invest: 20, fun: 20 };
  planBlocks = [];
}

// ── TAB NAVIGATION ────────────────────────────────────────────
const TAB_TITLES = { portfolio: 'PORTFOLIO', invest: 'INVEST' };

function switchTab(id) {
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + id).classList.add('active');
  document.querySelector(`.tab-btn[data-tab="${id}"]`).classList.add('active');
  document.getElementById('winTitle').textContent = TAB_TITLES[id] || id.toUpperCase();
}

// ── PRICE FETCH ──────────────────────────────────────────────
async function fetchCoinGecko() {
  // Portfolio crypto + always ETH for the Invest tab
  const needed = new Map();
  CATALOG.filter(c => c.src === 'cg').forEach(c => {
    if (AS.find(a => a.id === c.id) || c.id === 'eth') needed.set(c.cgId, c.id);
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

async function fetchBinanceSeries(interval, limit) {
  try {
    const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=ETHEUR&interval=${interval}&limit=${limit}`);
    if (!r.ok) return [];
    const d = await r.json();
    return d.map(k => parseFloat(k[4])).filter(v => Number.isFinite(v));
  } catch(e) { return []; }
}

async function fetchChartSeries() {
  const [eth1h, eth24h, eth7d] = await Promise.all([
    fetchBinanceSeries('1m', 60),
    fetchBinanceSeries('1h', 24),
    fetchBinanceSeries('1h', 168),
  ]);
  chartSeries.eth  = { '1h': eth1h, '24h': eth24h, '7d': eth7d };
  const hist = FUND_HISTORY.vwce || [];
  chartSeries.vwce = { '7d': hist.slice(-7), '30d': hist.slice(-30) };
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
    if (d.history) {
      Object.entries(d.history).forEach(([id, hist]) => {
        if (Array.isArray(hist)) FUND_HISTORY[id] = hist;
      });
    }
    const age = Date.now() - new Date(d.updated).getTime();
    const ageStr = age < 3600000 ? Math.round(age / 60000) + 'm ago'
                 : age < 86400000 ? Math.round(age / 3600000) + 'h ago'
                 : Math.round(age / 86400000) + 'd ago';
    console.log(`[NYX] prices updated ${ageStr}`);
  } catch(e) { console.warn('fund json', e); }
}

// ── INVEST SIGNAL ─────────────────────────────────────────────
async function fetchInvestSignal() {
  try {
    const prices = chartSeries.eth['7d']?.length ? chartSeries.eth['7d'] : await fetchBinanceSeries('1h', 168);
    if (prices.length < 4) return;
    const first = prices[0], last = prices[prices.length - 1];
    const trend7d = ((last - first) / first) * 100;
    const changes = [];
    for (let i = 1; i < prices.length; i++) changes.push((prices[i] - prices[i-1]) / prices[i-1] * 100);
    const mean = changes.reduce((a, b) => a + b, 0) / changes.length;
    const vol  = Math.sqrt(changes.reduce((s, c) => s + Math.pow(c - mean, 2), 0) / changes.length);
    let score, label, note, icon;
    if (trend7d > 5 && vol < 4)    { score = 2; label = 'safe';    icon = '◎'; note = `ETH +${trend7d.toFixed(1)}% over 7d, volatility low (${vol.toFixed(1)}%/day). Momentum favors entry.`; }
    else if (trend7d < -8 || vol > 7) { score = 0; label = 'risky';   icon = '⚠'; note = `ETH ${trend7d.toFixed(1)}% over 7d, volatility high (${vol.toFixed(1)}%/day). Consider waiting.`; }
    else                            { score = 1; label = 'caution'; icon = '◐'; note = `ETH ${trend7d > 0 ? '+' : ''}${trend7d.toFixed(1)}% over 7d, vol ${vol.toFixed(1)}%/day. Mixed signals.`; }
    investSignals.eth = { score, label, note, icon, trend7d, vol };
  } catch(e) { console.warn('signal fetch', e); }
}

// ── FEAR & GREED ─────────────────────────────────────────────
let fearGreedData = null;

async function fetchFearGreed() {
  try {
    const r = await fetch('https://api.alternative.me/fng/?limit=1');
    const d = await r.json();
    if (d.data?.[0]) fearGreedData = { value: +d.data[0].value, label: d.data[0].value_classification };
  } catch(e) { console.warn('fng', e); }
}

function renderFearGreed() {
  const valEl = document.getElementById('fgVal'), lblEl = document.getElementById('fgLabel'), fillEl = document.getElementById('fgFill');
  if (!valEl || !fearGreedData) return;
  const { value, label } = fearGreedData;
  valEl.textContent = value; lblEl.textContent = label;
  if (fillEl) fillEl.style.width = value + '%';
  const color = value <= 25 ? 'rgba(255,80,80,0.8)' : value <= 45 ? 'rgba(255,150,80,0.8)' : value <= 55 ? 'rgba(255,255,255,0.5)' : value <= 75 ? 'rgba(140,255,170,0.85)' : 'rgba(100,255,150,0.9)';
  valEl.style.color = color;
  if (fillEl) fillEl.style.background = color;
}

// ── ETH NEWS ─────────────────────────────────────────────────
let ethNews = [];

async function fetchEthNews() {
  const ETH_RE = /ethereum|vitalik|eth\b|eip-|staking|l2\b|layer.?2|rollup|dencun|pectra|uniswap|aave|defi/i;
  const feeds = [
    { rss: 'https://cointelegraph.com/rss/tag/ethereum',                              source: 'Cointelegraph' },
    { rss: 'https://thedefiant.io/feed',                                              source: 'The Defiant'   },
    { rss: 'https://www.coindesk.com/arc/outboundfeeds/rss/?category=ethereum',       source: 'CoinDesk'      },
  ];
  for (const feed of feeds) {
    try {
      const url = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed.rss)}&count=15`;
      const r = await fetch(url), d = await r.json();
      if (d.status !== 'ok' || !d.items?.length) continue;
      const matched = d.items.filter(i => ETH_RE.test(i.title || '')).slice(0, 3);
      if (!matched.length) continue;
      ethNews = matched.map(i => ({ title: i.title?.trim() || '', source: feed.source, time: new Date(i.pubDate || 0).getTime() / 1000 }));
      return;
    } catch(e) { console.warn('eth news', feed.source, e); }
  }
}

function timeAgo(ts) {
  const s = Date.now() / 1000 - ts;
  if (s < 3600)  return Math.floor(s / 60)   + 'm ago';
  if (s < 86400) return Math.floor(s / 3600)  + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

function renderEthNews() {
  const el = document.getElementById('newsBlock');
  if (!el || !ethNews.length) return;
  el.innerHTML = ethNews.map(n => `<div class="news-item">
    <div class="news-title">${n.title.length > 90 ? n.title.slice(0, 90) + '…' : n.title}</div>
    <div class="news-meta">${n.source} · ${timeAgo(n.time)}</div>
  </div>`).join('');
}

function setChartRange(assetId, range) { chartRanges[assetId] = range; updateChartButtons(assetId); renderInvest(); }
function updateChartButtons(assetId) {
  document.querySelectorAll(`.chart-btn[data-asset="${assetId}"]`).forEach(btn => {
    btn.classList.toggle('active', btn.dataset.range === chartRanges[assetId]);
  });
}

function renderSparkline(elId, series) {
  const el = document.getElementById(elId); if (!el) return;
  const values = (series || []).map(v => Number(v)).filter(v => Number.isFinite(v));
  if (values.length < 2) { el.innerHTML = '<div class="news-loading">loading…</div>'; return; }
  const w = 320, h = 54, pad = 4;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const step = (w - pad * 2) / (values.length - 1);
  const points = values.map((v, i) => [pad + i * step, pad + (h - pad * 2) * (1 - ((v - min) / span))]);
  const linePoints = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const areaPath = `M ${points[0][0].toFixed(1)} ${h - pad} L ${points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ')} L ${points[points.length-1][0].toFixed(1)} ${h - pad} Z`;
  const rising = values[values.length - 1] >= values[0];
  const stroke = rising ? 'rgba(140,255,170,0.92)' : 'rgba(255,100,100,0.92)';
  const fill   = rising ? 'rgba(140,255,170,0.10)' : 'rgba(255,100,100,0.10)';
  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <rect class="spark-bg" x="0" y="0" width="${w}" height="${h}" rx="8"></rect>
    <path class="spark-area" d="${areaPath}" style="fill:${fill}"></path>
    <polyline class="spark-line" points="${linePoints}" style="stroke:${stroke}"></polyline>
  </svg>`;
}

async function fetchAll() {
  setStatus('fetching...');
  await fetchFundsJson(); // must run first — chart series reads FUND_HISTORY.vwce
  await Promise.allSettled([
    fetchCoinGecko(),
    fetchChartSeries(),
    fetchInvestSignal(),
    fetchFearGreed(),
    fetchEthNews(),
  ]);
  AS.filter(a => a.src === 'manual').forEach(a => { PX[a.id] = { p: a.manual || 1, ch: 0 }; });
  savePX();
  const t = new Date().toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' });
  setStatus(`updated ${t}`);
  renderPortfolio();
  renderInvest();
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

// ── INVEST PANEL ─────────────────────────────────────────────
function renderInvest() {
  const eth = AS.find(a => a.id === 'eth');
  if (eth) {
    const p = gP(eth), ch = gCh(eth);
    const pEl = document.getElementById('ethPrice'), cEl = document.getElementById('ethCh');
    if (pEl) pEl.textContent = p > 0 ? fe(p) : '—';
    if (cEl) { cEl.textContent = p > 0 ? fp(ch) : '—'; cEl.className = 'ipc-ch ' + (ch >= 0 ? 'up' : 'dn'); }
  }
  const vwce = AS.find(a => a.id === 'vwce');
  if (vwce) {
    const p = gP(vwce), ch = gCh(vwce);
    const pEl = document.getElementById('vwcePrice'), cEl = document.getElementById('vwceCh');
    if (pEl) pEl.textContent = p > 0 ? fe(p) : '—';
    if (cEl) { cEl.textContent = p > 0 ? fp(ch) : '—'; cEl.className = 'ipc-ch ' + (ch >= 0 ? 'up' : 'dn'); }
  }
  const sig = investSignals.eth;
  const verdictEl = document.getElementById('signalVerdict'), noteEl = document.getElementById('signalNote');
  if (sig && verdictEl && noteEl) { verdictEl.className = `signal-verdict ${sig.label}`; verdictEl.textContent = sig.label.toUpperCase(); noteEl.textContent = sig.note; }
  updateChartButtons('eth'); updateChartButtons('vwce');
  renderSparkline('ethChart', chartSeries.eth[chartRanges.eth]);
  renderSparkline('vwceChart', chartSeries.vwce[chartRanges.vwce]);
  renderFearGreed(); renderEthNews();
}

// ── ADD ASSET PICKER ─────────────────────────────────────────
const CAT_LABELS = { crypto:'CRYPTO', etf:'ETF', stock:'STOCK', fund:'FUND', cash:'CASH' };
const CAT_ORDER  = ['crypto','etf','stock','fund','cash'];

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

  sb.auth.onAuthStateChange(async (event, session) => {
    console.log('[NYX] auth event:', event, '| user:', session?.user?.email || null);
    currentUser = session?.user || null;

    if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && currentUser) {
      hideAuth();
      renderPortfolio(); renderInvest();
      if (!appStarted) {
        fetchAll();
        setInterval(fetchAll, 5 * 60 * 1000);
        appStarted = true;
      }
      loadHoldings()
        .then(() => renderPortfolio())
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
