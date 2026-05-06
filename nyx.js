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

// ── DATA ─────────────────────────────────────────────────────
const AS = [
  { id:'eth',  name:'Ethereum',         sub:'ETH',            cat:'crypto', symbol:'ETHEUR',   src:'binance' },
  { id:'link', name:'Chainlink',        sub:'LINK',           cat:'crypto', symbol:'LINKEUR',  src:'binance' },
  { id:'vwce', name:'VWCE',             sub:'FTSE All-World', cat:'etf',    yahoo:'VWCE.DE',   src:'yahoo'   },
  { id:'krkg', name:'Krka',             sub:'KRKG.LJ',        cat:'stock',  stooq:'krkg.lj',   src:'stooq'   },
  { id:'tri',  name:'Triglav DMT EUR',  sub:'mutual fund',    cat:'fund',   src:'triglav',
    fundKey:'TRIGLAV SKLAD DENARNEGA TRGA EUR', fundUrl:'https://tecajnica.triglavinvestments.si/' },
  { id:'inf',  name:'Infond Globalni',  sub:'mutual fund',    cat:'fund',   src:'infond',
    fundKey:'INFOND GLOBALNI URAVNOTEŽENI', fundUrl:'https://www.infond.si/tecajnica-vzajemnih-skladov' },
  { id:'cash', name:'Savings',          sub:'EUR',            cat:'cash',   src:'manual', manual:1 },
  { id:'chk',  name:'Checking',         sub:'EUR',            cat:'cash',   src:'manual', manual:1 },
];
AS.forEach(a => { a.qty = 0; a.buy = 0; });

let PX = {};
let investSignals = {};
let chartRanges = { eth: '1h', vwce: '1h' };
let chartSeries  = { eth: {}, vwce: {} };
let vwceDailyHistory = [];
let budget = { paycheck: 0, rent: 30, invest: 20, fun: 20 };
let planBlocks = [];

// ── STORAGE ──────────────────────────────────────────────────
async function saveHoldings() {
  if (!currentUser) return;
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
  if (data) data.forEach(row => {
    const a = AS.find(x => x.id === row.asset_id);
    if (a) {
      a.qty = row.qty || 0;
      a.buy = row.buy_price || 0;
      if (row.manual_price != null) a.manual = row.manual_price;
    }
  });
}

async function saveBudget(obj) {
  if (!currentUser) return;
  await sb.from('budget').upsert({
    user_id:     currentUser.id,
    paycheck:    obj.paycheck   || 0,
    rent_pct:    obj.rent       || 0,
    invest_pct:  obj.invest     || 0,
    fun_pct:     obj.fun        || 0,
  }, { onConflict: 'user_id' });
}

async function loadBudgetData() {
  if (!currentUser) return;
  const { data } = await sb.from('budget').select('*').eq('user_id', currentUser.id).maybeSingle();
  if (data) budget = { paycheck: data.paycheck || 0, rent: data.rent_pct || 0, invest: data.invest_pct || 0, fun: data.fun_pct || 0 };
}

async function savePlan(day, blocks) {
  if (!currentUser) return;
  await sb.from('planner_blocks').delete().eq('user_id', currentUser.id).eq('date', day);
  if (blocks.length) {
    await sb.from('planner_blocks').insert(blocks.map(b => ({
      user_id:    currentUser.id,
      date:       day,
      time_label: (b.from || '') + '|' + (b.to || ''),
      note:       b.text || '',
    })));
  }
}

async function loadPlanData(day) {
  if (!currentUser) return;
  const { data } = await sb.from('planner_blocks')
    .select('*').eq('user_id', currentUser.id).eq('date', day).order('created_at');
  if (data) planBlocks = data.map(row => {
    const parts = (row.time_label || '|').split('|');
    return { from: parts[0] || '', to: parts[1] || '', text: row.note || '' };
  });
}

function savePX() { localStorage.setItem('nyx_px', JSON.stringify(PX)); }
function loadPX() {
  try {
    const c = JSON.parse(localStorage.getItem('nyx_px') || '{}');
    Object.entries(c).forEach(([k, v]) => { if (v && typeof v.p === 'number') PX[k] = v; });
  } catch(e) {}
}

let _budgetTimer, _planTimer;
function debouncedSaveBudget(obj) { clearTimeout(_budgetTimer); _budgetTimer = setTimeout(() => saveBudget(obj), 800); }
function debouncedSavePlan(day, blocks) { clearTimeout(_planTimer); _planTimer = setTimeout(() => savePlan(day, blocks), 800); }

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
        try { await Promise.all([loadHoldings(), loadBudgetData(), loadPlanData(todayKey())]); } catch(e) { console.error('data load:', e); }
        hideAuth();
        renderPortfolio(); renderInvest(); renderBudget(); renderPlanner();
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
}

// ── TAB NAVIGATION ────────────────────────────────────────────
const TAB_TITLES = { portfolio: 'PORTFOLIO', invest: 'INVEST', budget: 'BUDGET', planner: 'DAILY PLANNER' };

function switchTab(id) {
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + id).classList.add('active');
  document.querySelector(`.tab-btn[data-tab="${id}"]`).classList.add('active');
  document.getElementById('winTitle').textContent = TAB_TITLES[id] || id.toUpperCase();
}

// ── PRICE FETCH ──────────────────────────────────────────────
async function fetchBinance() {
  const symbols = AS.filter(a => a.src === 'binance').map(a => a.symbol);
  try {
    await Promise.allSettled(symbols.map(async symbol => {
      const r = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);
      if (!r.ok) return;
      const d = await r.json();
      const asset = AS.find(a => a.symbol === symbol);
      if (!asset) return;
      const price = parseFloat(d.lastPrice), ch = parseFloat(d.priceChangePercent);
      if (!isNaN(price)) PX[asset.id] = { p: price, ch: isNaN(ch) ? 0 : ch };
    }));
  } catch(e) { console.warn('binance', e); }
}

async function fetchYahoo(a) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${a.yahoo}?interval=1d&range=5d`;
  try {
    const d = await fetchWithProxy(url, 'json');
    const result = d?.chart?.result?.[0];
    const meta   = result?.meta;
    if (!meta) return;
    const price = meta.regularMarketPrice, prev = meta.previousClose ?? meta.chartPreviousClose;
    if (price && !isNaN(price)) PX[a.id] = { p: price, ch: prev ? (price - prev) / prev * 100 : 0 };
    const closes = (result?.indicators?.quote?.[0]?.close || []).map(v => Number(v)).filter(v => Number.isFinite(v));
    if (a.id === 'vwce' && closes.length) vwceDailyHistory = closes;
  } catch(e) { console.warn('yahoo', a.yahoo, e); }
}

async function fetchBinanceSeries(interval, limit) {
  try {
    const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=ETHEUR&interval=${interval}&limit=${limit}`);
    if (!r.ok) return [];
    const d = await r.json();
    return d.map(k => parseFloat(k[4])).filter(v => Number.isFinite(v));
  } catch(e) { return []; }
}

async function fetchYahooSeries(symbol, range, interval, limit = 0) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}`;
  try {
    const d = await fetchWithProxy(url, 'json');
    const closes = (d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []).map(v => Number(v)).filter(v => Number.isFinite(v));
    return limit > 0 ? closes.slice(-limit) : closes;
  } catch(e) { return []; }
}

async function fetchChartSeries() {
  const [eth1h, eth24h, eth7d, vwce1h, vwce24h, vwce7d] = await Promise.all([
    fetchBinanceSeries('1m', 60),
    fetchBinanceSeries('1h', 24),
    fetchBinanceSeries('1h', 168),
    fetchYahooSeries('VWCE.DE', '1d',  '1m', 60),
    fetchYahooSeries('VWCE.DE', '5d',  '1h', 24),
    fetchYahooSeries('VWCE.DE', '1mo', '1d', 7),
  ]);
  chartSeries.eth  = { '1h': eth1h,  '24h': eth24h,  '7d': eth7d  };
  chartSeries.vwce = { '1h': vwce1h, '24h': vwce24h, '7d': vwce7d };
  if (!chartSeries.vwce['7d']?.length  && vwceDailyHistory.length) chartSeries.vwce['7d']  = vwceDailyHistory.slice(-7);
  if (!chartSeries.vwce['1h']?.length)  chartSeries.vwce['1h']  = chartSeries.vwce['24h'] || chartSeries.vwce['7d'] || [];
  if (!chartSeries.vwce['24h']?.length) chartSeries.vwce['24h'] = chartSeries.vwce['7d']  || chartSeries.vwce['1h'] || [];
}

async function fetchStooq(a) {
  const url = `https://stooq.com/q/d/l/?s=${a.stooq}&i=d`;
  try {
    const txt = await fetchWithProxy(url, 'text');
    const lines = txt.trim().split('\n');
    if (lines.length < 2) return;
    const last = lines[lines.length - 1].split(',');
    const prev = lines.length > 2 ? lines[lines.length - 2].split(',') : null;
    const close = parseFloat(last[4]), prevClose = prev ? parseFloat(prev[4]) : close;
    if (!isNaN(close)) PX[a.id] = { p: close, ch: prevClose ? ((close - prevClose) / prevClose * 100) : 0 };
  } catch(e) { console.warn('stooq', a.id, e); }
}

async function fetchFundPage(a) {
  try {
    const txt = await fetchWithProxy(a.fundUrl, 'text');
    const clean = s => s.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
    const norm = clean(txt), key = clean(a.fundKey);
    const idx = norm.lastIndexOf(key); if (idx < 0) return;
    const slice = norm.slice(idx, idx + 1200);
    const pm = slice.match(/([0-9]+,[0-9]{2})\s*(?:€|EUR)/);
    const cm = slice.match(/([+-]?[0-9]+,[0-9]{2})\s*%/);
    const price = pm ? parseFloat(pm[1].replace(',', '.')) : NaN;
    const change = cm ? parseFloat(cm[1].replace(',', '.')) : 0;
    if (!isNaN(price)) PX[a.id] = { p: price, ch: change };
  } catch(e) { console.warn('fund', a.id, e); }
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
  await Promise.allSettled([
    fetchBinance(),
    ...AS.filter(a => a.src === 'yahoo').map(a => fetchYahoo(a)),
    ...AS.filter(a => a.src === 'stooq').map(a => fetchStooq(a)),
    ...AS.filter(a => a.src === 'triglav' || a.src === 'infond').map(a => fetchFundPage(a)),
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

const PROXY_CACHE = new Map();
const PROXY_CACHE_TTL = 10 * 60 * 1000;

async function fetchWithProxy(url, responseType = 'text') {
  const cacheKey = `${responseType}:${url}`;
  const cached = PROXY_CACHE.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < PROXY_CACHE_TTL) return cached.value;
  const proxies = [
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  ];
  for (const proxyUrl of proxies) {
    try {
      const r = await fetch(proxyUrl);
      if (!r.ok) continue;
      const value = responseType === 'json' ? await r.json() : await r.text();
      PROXY_CACHE.set(cacheKey, { ts: Date.now(), value });
      return value;
    } catch(e) {}
  }
  throw new Error(`All proxies failed for ${url}`);
}

// ── PORTFOLIO ────────────────────────────────────────────────
function renderPortfolio() {
  const T = AS.reduce((s, a) => s + gV(a), 0);
  const el = document.getElementById('total');
  if (el) el.textContent = T > 0 ? fe(T) : '€ —';
  const wch = T > 0 ? AS.reduce((s, a) => s + gCh(a) * gV(a), 0) / T : 0;
  const cel = document.getElementById('totalChange');
  if (cel) { cel.textContent = T > 0 ? fp(wch) + ' today' : '—'; cel.className = 'total-ch ' + (wch >= 0 ? 'up' : 'dn'); }
  const list = document.getElementById('assetList'); if (!list) return;
  list.innerHTML = AS.map(a => {
    const p = gP(a), ch = gCh(a), v = gV(a);
    const pStr = p > 0 ? fe(p) : '<span class="loading">…</span>';
    const chStr = p > 0 ? `<div class="a-ch ${ch>=0?'up':'dn'}">${fp(ch)}</div>` : '';
    return `<div class="asset" onclick="openM('${a.id}')">
      <div><div class="a-name">${a.name}</div><div class="a-sub">${a.sub}</div></div>
      <div><div class="a-price">${pStr}</div>${chStr}</div>
      <div><div class="a-val">${a.qty > 0 ? fe(v) : '—'}</div><div class="a-units">${a.qty > 0 ? fn(a.qty) + ' u' : 'add'}</div></div>
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

// ── BUDGET ───────────────────────────────────────────────────
function renderBudget() {
  const pEl = document.getElementById('paycheckInput');
  if (pEl) pEl.value = budget.paycheck || '';
  ['rent', 'invest', 'fun'].forEach(cat => {
    const slider = document.getElementById(`slider_${cat}`);
    if (slider) slider.value = budget[cat] || 0;
    updateSliderAmt(cat);
  });
  updateRemaining();
}

function updateSliderAmt(cat) {
  const slider = document.getElementById(`slider_${cat}`), amtEl = document.getElementById(`amt_${cat}`);
  if (!slider || !amtEl) return;
  const pct = parseFloat(slider.value) || 0;
  const pay = parseFloat(document.getElementById('paycheckInput')?.value) || 0;
  budget[cat] = pct;
  amtEl.textContent = pay > 0 ? `${pct}%  ·  ${fe(pay * pct / 100, 0)}` : `${pct}%`;
  updateRemaining();
}

function updateRemaining() {
  const pay = parseFloat(document.getElementById('paycheckInput')?.value) || 0;
  const used = ['rent', 'invest', 'fun'].reduce((s, c) => s + (budget[c] || 0), 0);
  const rem = pay * (100 - used) / 100;
  const el = document.getElementById('budgetRemaining');
  if (el) { el.textContent = fe(rem, 0); el.className = 'b-rem-val' + (rem < 0 ? ' over' : ''); }
  debouncedSaveBudget(budget);
}

function setPaycheck() {
  budget.paycheck = parseFloat(document.getElementById('paycheckInput')?.value) || 0;
  ['rent', 'invest', 'fun'].forEach(c => updateSliderAmt(c));
  updateRemaining();
}

// ── PLANNER ──────────────────────────────────────────────────
function todayKey() { return new Date().toISOString().slice(0, 10); }
function formatDate(d) { return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); }
function formatDay(d)  { return d.toLocaleDateString('en-GB', { weekday: 'long' }).toUpperCase(); }
function escAttr(v)    { return String(v || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

function renderPlanner() {
  const now = new Date();
  const dEl = document.getElementById('dateBig'), dyEl = document.getElementById('dateDay');
  if (dEl) dEl.textContent = formatDate(now);
  if (dyEl) dyEl.textContent = formatDay(now);
  const container = document.getElementById('timeBlocks'); if (!container) return;
  container.innerHTML = planBlocks.map((b, i) => `
    <div class="time-block" id="tb_${i}">
      <input class="tb-input tb-time-input" type="text" placeholder="FROM" value="${escAttr(b.from)}"
        onchange="updateBlock(${i},'from',this.value)" oninput="updateBlock(${i},'from',this.value)">
      <input class="tb-input tb-time-input" type="text" placeholder="TO" value="${escAttr(b.to)}"
        onchange="updateBlock(${i},'to',this.value)" oninput="updateBlock(${i},'to',this.value)">
      <input class="tb-input tb-desc-input" type="text" placeholder="DESCRIPTION" value="${escAttr(b.text)}"
        onchange="updateBlock(${i},'text',this.value)" oninput="updateBlock(${i},'text',this.value)">
    </div>
  `).join('');
}

function updateBlock(i, key, val) {
  planBlocks[i][key] = val;
  debouncedSavePlan(todayKey(), planBlocks);
}

function addBlock() {
  planBlocks.push({ from: '', to: '', text: '' });
  debouncedSavePlan(todayKey(), planBlocks);
  renderPlanner();
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
      renderPortfolio(); renderInvest(); renderBudget(); renderPlanner();
      if (!appStarted) {
        fetchAll();
        setInterval(fetchAll, 5 * 60 * 1000);
        appStarted = true;
      }
      Promise.all([loadHoldings(), loadBudgetData(), loadPlanData(todayKey())])
        .then(() => { renderPortfolio(); renderBudget(); renderPlanner(); })
        .catch(e => console.error('[NYX] data load failed:', e));
    } else if (event === 'SIGNED_OUT' || (event === 'INITIAL_SESSION' && !currentUser)) {
      appStarted = false;
      showAuth();
    }
  });

  document.getElementById('ov')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeM(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeM();
    if (e.key === 'Enter' && document.getElementById('authOverlay').style.display !== 'none') authSubmit();
  });
});
