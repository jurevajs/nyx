#!/usr/bin/env node
const fs   = require('fs');
const path = require('path');

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

async function main() {
  const outPath = path.join(__dirname, '../../data/funds.json');

  // Load existing data so we keep last-known prices if a fetch fails today
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(outPath, 'utf8')).prices || {}; } catch (_) {}

  const prices = { ...existing };

  for (const fund of FUNDS) {
    try {
      prices[fund.id] = await fetchFund(fund);
      console.log(`✓ ${fund.id}: ${prices[fund.id].p} (${prices[fund.id].ch > 0 ? '+' : ''}${prices[fund.id].ch}%)`);
    } catch (e) {
      console.error(`✗ ${fund.id}: ${e.message} — keeping last known price`);
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ updated: new Date().toISOString(), prices }, null, 2));
  console.log('Written:', outPath);
}

main().catch(e => { console.error(e); process.exit(1); });
