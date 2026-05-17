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

// ── ETFs and stocks via Twelve Data ──────────────────────────
const TD_ASSETS = [
  { id: 'vwce', symbol: 'VWCE', exchange: 'XETRA' },
  { id: 'cspx', symbol: 'CSPX', exchange: 'LSE'   },
  { id: 'iwda', symbol: 'IWDA', exchange: 'AMS'   },
  { id: 'krkg', symbol: 'KRKG', exchange: 'LJE'   },
];

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

async function fetchTwelveDataAsset(asset, apiKey) {
  const url = `https://api.twelvedata.com/time_series?symbol=${asset.symbol}&exchange=${asset.exchange}&interval=1day&outputsize=30&apikey=${apiKey}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; nyx-bot/1.0)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  if (d.status === 'error') throw new Error(d.message || 'API error');
  if (!d.values?.length) throw new Error('No data');
  // values are newest-first
  const close    = parseFloat(d.values[0].close);
  const prevClose = d.values.length > 1 ? parseFloat(d.values[1].close) : NaN;
  if (isNaN(close)) throw new Error('Invalid price');
  const ch = (!isNaN(prevClose) && prevClose) ? ((close - prevClose) / prevClose * 100) : 0;
  const history = d.values.slice().reverse().map(v => {
    const p = parseFloat(v.close);
    return isNaN(p) ? null : p;
  }).filter(v => v !== null);
  return { p: close, ch, history };
}

async function main() {
  const apiKey  = process.env.TWELVE_DATA_KEY;
  if (!apiKey) throw new Error('TWELVE_DATA_KEY env var not set');

  const outPath = path.join(__dirname, '../../data/funds.json');

  let existingData = { prices: {}, history: {} };
  try { existingData = JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch (_) {}

  const prices  = { ...existingData.prices  || {} };
  const history = { ...existingData.history || {} };

  for (const fund of FUNDS) {
    try {
      prices[fund.id] = await fetchFund(fund);
      console.log(`✓ ${fund.id}: ${prices[fund.id].p} (${prices[fund.id].ch >= 0 ? '+' : ''}${prices[fund.id].ch}%)`);
    } catch (e) {
      console.error(`✗ ${fund.id}: ${e.message} — keeping last known price`);
    }
  }

  for (const asset of TD_ASSETS) {
    try {
      const result = await fetchTwelveDataAsset(asset, apiKey);
      prices[asset.id]  = { p: result.p, ch: result.ch };
      if (result.history.length) history[asset.id] = result.history;
      console.log(`✓ ${asset.id}: ${result.p} (${result.ch >= 0 ? '+' : ''}${result.ch.toFixed(2)}%)`);
    } catch (e) {
      console.error(`✗ ${asset.id}: ${e.message} — keeping last known`);
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ updated: new Date().toISOString(), prices, history }, null, 2));
  console.log('Written:', outPath);
}

main().catch(e => { console.error(e); process.exit(1); });
