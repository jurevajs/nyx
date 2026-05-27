#!/usr/bin/env node
const fs   = require('fs');
const path = require('path');

// ── Slovenian fund NAVs ───────────────────────────────────────
const FUNDS = [
  {
    id:  'tri',
    url: 'https://tecajnica.triglavinvestments.si/',
    key: 'TRIGLAV SKLAD DENARNEGA TRGA EUR',
  },
  {
    id:  'inf',
    url: 'https://www.infond.si/tecajnica-vzajemnih-skladov',
    key: 'INFOND GLOBALNI URAVNOTEŽENI',
  },
];

// ── ETFs via Yahoo Finance EOD ────────────────────────────────
const YAHOO_ASSETS = [
  { id: 'vwce', symbol: 'VWCE.DE' },
];

// ── Slovenian stocks via LJSE REST API ────────────────────────
const LJSE_STOCKS = [];

// ─────────────────────────────────────────────────────────────

function clean(s) {
  return s.toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

async function fetchFund(fund) {
  const res = await fetch(fund.url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; nyx-bot/1.0)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const txt  = await res.text();
  const norm = clean(txt);
  const key  = clean(fund.key);
  const idx  = norm.lastIndexOf(key);
  if (idx < 0) throw new Error(`Key not found: ${fund.key}`);
  const slice = norm.slice(idx, idx + 1200);
  const pm    = slice.match(/([0-9]+,[0-9]{2})\s*(?:€|EUR)/);
  const cm    = slice.match(/([+-]?[0-9]+,[0-9]{2})\s*%/);
  const price  = pm ? parseFloat(pm[1].replace(',', '.')) : NaN;
  const change = cm ? parseFloat(cm[1].replace(',', '.')) : 0;
  if (isNaN(price)) throw new Error(`Price not found for ${fund.id}`);
  return { p: price, ch: change };
}

async function fetchYahooAsset(asset) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${asset.symbol}?interval=1d&range=1mo`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d      = await res.json();
  const result = d.chart?.result?.[0];
  if (!result) throw new Error('No data');
  const close    = result.meta.regularMarketPrice;
  const prevClose = result.meta.previousClose || result.meta.chartPreviousClose;
  if (!close) throw new Error('Invalid price');
  const ch = prevClose ? ((close - prevClose) / prevClose * 100) : 0;
  const closes  = result.indicators?.quote?.[0]?.close || [];
  const history = closes.filter(v => v !== null && Number.isFinite(v));
  return { p: close, ch, history };
}

async function fetchLJSEPriceList() {
  // Try last 5 days to handle weekends and public holidays
  for (let daysBack = 0; daysBack <= 4; daysBack++) {
    const d = new Date();
    d.setDate(d.getDate() - daysBack);
    const dateStr = d.toISOString().slice(0, 10);
    const url = `https://rest.ljse.si/web/Bvt9fe2peQ7pwpyYqODM/price-list/XLJU/${dateStr}/json`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; nyx-bot/1.0)' },
    });
    if (!res.ok) continue;
    const data = await res.json();
    if (data.securities?.length) {
      console.log(`✓ LJSE: ${data.securities.length} securities (${dateStr})`);
      return data.securities;
    }
  }
  throw new Error('No LJSE data found in last 5 days');
}

function parseLJSEStock(symbol, securities) {
  const sec = securities.find(s => s.symbol === symbol);
  if (!sec) throw new Error(`${symbol} not found in LJSE data`);
  const p  = parseFloat(sec.close_price);
  const ch = parseFloat(sec.change_percent) || 0;
  if (isNaN(p)) throw new Error('Invalid price');
  return { p, ch };
}

async function main() {
  const outPath = path.join(__dirname, '../../data/funds.json');

  let existingData = { prices: {}, history: {} };
  try { existingData = JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch (_) {}

  const prices  = { ...existingData.prices  || {} };
  const history = { ...existingData.history || {} };

  // Slovenian fund NAVs
  for (const fund of FUNDS) {
    try {
      prices[fund.id] = await fetchFund(fund);
      console.log(`✓ ${fund.id}: ${prices[fund.id].p} (${prices[fund.id].ch >= 0 ? '+' : ''}${prices[fund.id].ch}%)`);
    } catch (e) {
      console.error(`✗ ${fund.id}: ${e.message} — keeping last known price`);
    }
  }

  // ETFs via Yahoo Finance
  for (const asset of YAHOO_ASSETS) {
    try {
      const result = await fetchYahooAsset(asset);
      prices[asset.id]  = { p: result.p, ch: result.ch };
      if (result.history.length) history[asset.id] = result.history;
      console.log(`✓ ${asset.id}: ${result.p} (${result.ch >= 0 ? '+' : ''}${result.ch.toFixed(2)}%)`);
    } catch (e) {
      console.error(`✗ ${asset.id}: ${e.message} — keeping last known`);
    }
  }

  // Slovenian stocks via LJSE REST API
  let ljseSecurities = null;
  try {
    ljseSecurities = await fetchLJSEPriceList();
  } catch (e) {
    console.error(`✗ LJSE: ${e.message}`);
  }

  for (const stock of LJSE_STOCKS) {
    try {
      if (!ljseSecurities) throw new Error('no LJSE data available');
      const result = parseLJSEStock(stock.symbol, ljseSecurities);
      prices[stock.id] = { p: result.p, ch: result.ch };
      console.log(`✓ ${stock.id}: ${result.p} (${result.ch >= 0 ? '+' : ''}${result.ch.toFixed(2)}%)`);
    } catch (e) {
      console.error(`✗ ${stock.id}: ${e.message} — keeping last known`);
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ updated: new Date().toISOString(), prices, history }, null, 2));
  console.log('Written:', outPath);
}

main().catch(e => { console.error(e); process.exit(1); });
