#!/usr/bin/env node
// SEC EDGAR（米国証券取引委員会の公開データ。APIキー不要・毎秒10件まで・連絡先入りのUser-Agent必須）
//  - company_tickers.json：ティッカーとCIKの対応（時価総額の大きい順）
//  - data.sec.gov/submissions/CIK##########.json：会社ごとの提出書類一覧
//  - Form 4（役員・大株主の売買報告）のXMLを読み、取引を data/trades.json に貯める
//  - Wikidata（CC0）：会社名の日本語表記
import fs from 'node:fs';
import path from 'node:path';
const UA = { 'User-Agent': `us-insider (mminnie.com) ${process.env.SEC_CONTACT || ''}`.trim(), 'Accept-Encoding': 'gzip, deflate' };
const DATA = path.resolve('data');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (f, d) => (fs.existsSync(path.join(DATA, f)) ? JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')) : d);
const save = (f, v) => fs.writeFileSync(path.join(DATA, f), JSON.stringify(v));
let last = 0;
async function sec(url, type = 'json') { // 毎秒5件まで（上限10件の半分）
  const wait = 200 - (Date.now() - last); if (wait > 0) await sleep(wait); last = Date.now();
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { headers: UA });
    if (r.status === 429 || r.status === 403) { console.error('throttled', r.status, url); await sleep(15000); continue; }
    if (!r.ok) return null;
    return type === 'json' ? r.json() : r.text();
  }
  return null;
}
const N = +(process.env.COMPANIES || 500);
const DAYS = +(process.env.DAYS || 45);
const since = new Date(Date.now() - DAYS * 864e5).toISOString().slice(0, 10);

// 会社一覧（上位N社）
const tick = await sec('https://www.sec.gov/files/company_tickers.json');
const list = Object.values(tick || {}).slice(0, N).map((x) => ({ cik: String(x.cik_str), ticker: x.ticker, name: x.title }));
const companies = read('companies.json', {});
for (const c of list) companies[c.cik] = { ...(companies[c.cik] || {}), ...c };
console.log('companies', list.length);

// 日本語名（Wikidata、未取得の会社だけ）
const need = list.filter((c) => companies[c.cik].ja === undefined).map((c) => c.cik.padStart(10, '0'));
for (let i = 0; i < need.length; i += 100) {
  const vals = need.slice(i, i + 100).map((c) => `"${c}"`).join(' ');
  const q = `SELECT ?cik ?ja WHERE { VALUES ?cik { ${vals} } ?item wdt:P5531 ?cik . OPTIONAL { ?item rdfs:label ?ja FILTER(lang(?ja)="ja") } }`;
  try {
    const r = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q), { headers: { 'User-Agent': UA['User-Agent'], Accept: 'application/sparql-results+json' } });
    const j = await r.json();
    for (const b of j.results.bindings) { const k = String(+b.cik.value); if (companies[k]) companies[k].ja = b.ja?.value || companies[k].ja || ''; }
  } catch (e) { console.error('wikidata', e.message); }
  for (const c of need.slice(i, i + 100)) { const k = String(+c); if (companies[k] && companies[k].ja === undefined) companies[k].ja = ''; }
  await sleep(1000);
}

// Form 4
const trades = read('trades.json', {});
const seen = new Set(Object.keys(trades));
const tag = (x, t) => { const m = x.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)); return m ? m[1].replace(/<value>|<\/value>/g, '').replace(/<[^>]+>/g, '').trim() : ''; };
let nf = 0;
for (const c of list) {
  const sub = await sec(`https://data.sec.gov/submissions/CIK${c.cik.padStart(10, '0')}.json`);
  const r = sub?.filings?.recent; if (!r) continue;
  for (let i = 0; i < r.form.length; i++) {
    if (r.form[i] !== '4' || r.filingDate[i] < since) continue;
    const acc = r.accessionNumber[i]; if (seen.has(acc)) continue;
    const doc = r.primaryDocument[i].replace(/^xslF345X\d+\//, '');
    const xml = await sec(`https://www.sec.gov/Archives/edgar/data/${c.cik}/${acc.replace(/-/g, '')}/${doc}`, 'text');
    if (!xml || !xml.includes('<ownershipDocument')) { trades[acc] = { skip: true, d: r.filingDate[i] }; seen.add(acc); continue; }
    const owner = tag(xml, 'rptOwnerName'), title = tag(xml, 'officerTitle'), isDir = tag(xml, 'isDirector') === '1' || tag(xml, 'isDirector') === 'true', isTen = tag(xml, 'isTenPercentOwner') === '1' || tag(xml, 'isTenPercentOwner') === 'true';
    const tx = [...xml.matchAll(/<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/g)].map((m) => {
      const t = m[1];
      return { date: tag(t, 'transactionDate'), code: tag(t, 'transactionCode'), shares: +tag(t, 'transactionShares') || 0, price: +tag(t, 'transactionPricePerShare') || 0, ad: tag(t, 'transactionAcquiredDisposedCode'), after: +tag(t, 'sharesOwnedFollowingTransaction') || 0 };
    }).filter((t) => t.code === 'P' || t.code === 'S');
    const plan = /10b5-1/i.test(xml);
    trades[acc] = { cik: c.cik, filed: r.filingDate[i], owner, title, dir: isDir, ten: isTen, plan, tx };
    seen.add(acc); nf++;
  }
}
// 400日より古い記録は捨てる
for (const [k, v] of Object.entries(trades)) if ((v.filed || v.d || '') < new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10)) delete trades[k];
console.log('new form4', nf, 'total', Object.keys(trades).length);
save('companies.json', companies); save('trades.json', trades); save('meta.json', { at: new Date().toISOString() });
