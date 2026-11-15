#!/usr/bin/env node
// data/ から静的サイトを dist/ に作る（米国株インサイダー速報）
// 株価は載せない。SECに提出された Form 4（役員・大株主の売買報告）の内容を日本語で整理するだけ。売買の推奨はしない。
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = path.join(ROOT, 'dist');
const SITE = { name: '米国株インサイダー速報', url: 'https://us.mminnie.com', operator: 'mminnie.com 編集部', contact: 'https://docs.google.com/forms/d/e/1FAIpQLSchNBjp8QQ7mbNG5nNGSI6-ikkx00QRZFPM8st0B6WLA16alQ/viewform', ga: 'G-XL7DW884H3', ads: 'ca-pub-2361768568271631' };
const read = (f, d) => (fs.existsSync(path.join(ROOT, 'data', f)) ? JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8')) : d);
const companies = read('companies.json', {}), trades = read('trades.json', {}), meta = read('meta.json', {});
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const nf = (n) => Math.round(Number(n)).toLocaleString('ja-JP');
const jst = (d = Date.now()) => new Date(new Date(d).getTime() + 9 * 3600e3).toISOString();
const today = jst().slice(0, 10);
const ver = Date.now().toString(36);
const md = (d) => (d ? `${+d.slice(5, 7)}/${+d.slice(8, 10)}` : '');
// 金額（ドル）を日本語の単位で
const usd = (v) => (v >= 1e8 ? `${(v / 1e8).toFixed(v >= 1e9 ? 0 : 1)}億ドル` : v >= 1e4 ? `${nf(v / 1e4)}万ドル` : `${nf(v)}ドル`);
const usdB = (v) => { const s = usd(v); const m = s.match(/^([\d,.]+)(.*)$/); return `${m[1]}<i>${m[2]}</i>`; };
fs.rmSync(DIST, { recursive: true, force: true });
const sitemap = [];
function write(p, html, index = true) { const f = path.join(DIST, p.endsWith('/') ? p + 'index.html' : p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, html); if (index) sitemap.push(SITE.url + p); }

// 名前・役職
const cap = (s) => String(s || '').replace(/\s*\/[a-z]{1,4}\/?\s*$/i, '').replace(/\s*\/[a-z]{1,4}\/\s*/ig, ' ').toLowerCase().replace(/(^|[\s\-'.])([a-z])/g, (m, a, b) => a + b.toUpperCase());
function personName(n) { // SECは「姓 名 ミドル」の順。会社名らしいものはそのまま
  if (/\b(INC|LLC|L\.?P\.?|CORP|CO|LTD|TRUST|FUND|HOLDINGS?|PARTNERS|GROUP|CAPITAL|MANAGEMENT|FOUNDATION|PLC|N\.?A\.?)\b/i.test(n)) return cap(n).replace(/\bInc\b/, 'Inc.').replace(/\bLlc\b/, 'LLC').replace(/\bL\.p\./i, 'L.P.');
  const w = String(n).trim().split(/\s+/); if (w.length < 2) return cap(n);
  const [last, ...rest] = w; return cap(rest.join(' ') + ' ' + last);
}
function role(t) {
  const ti = t.title || '', out = [];
  if (/chief executive|\bceo\b/i.test(ti)) out.push('CEO');
  else if (/chief financial|\bcfo\b/i.test(ti)) out.push('CFO');
  else if (/chief operating|\bcoo\b/i.test(ti)) out.push('COO');
  else if (/chair/i.test(ti)) out.push('会長');
  else if (/president/i.test(ti)) out.push('社長');
  else if (/general counsel|chief legal/i.test(ti)) out.push('法務責任者');
  else if (/chief .*officer|\bc[a-z]o\b/i.test(ti)) out.push('経営幹部');
  else if (/vice president|\bevp\b|\bsvp\b|\bvp\b/i.test(ti)) out.push('副社長級');
  else if (ti) out.push('役員');
  if (t.dir) out.push('取締役');
  if (t.ten) out.push('大株主（10%以上）');
  return out.length ? out.join('・') : '報告者';
}

// 取引を「1件の報告×売り買い」単位にまとめる
const rows = [];
for (const [acc, t] of Object.entries(trades)) {
  if (t.skip || !t.tx?.length) continue;
  const iss = t.iss || {}; const c = companies[iss.cik || t.cik] || {};
  const sym = (iss.sym || c.ticker || '').toUpperCase().replace(/[^A-Z0-9.\-]/g, ''); if (!sym) continue;
  for (const code of ['P', 'S']) {
    const tx = t.tx.filter((x) => x.code === code && x.shares > 0); if (!tx.length) continue;
    const shares = tx.reduce((s, x) => s + x.shares, 0), value = tx.reduce((s, x) => s + x.shares * x.price, 0);
    if (!value) continue;
    const dates = tx.map((x) => x.date.slice(0, 10)).sort();
    rows.push({ acc, sym, cik: iss.cik || t.cik, co: c.ja || cap(iss.name || c.name || sym), en: cap(iss.name || c.name || ''), code, shares, value, avg: value / shares, d0: dates[0], d1: dates[dates.length - 1], filed: t.filed, owner: personName(t.owner), role: role(t), title: t.title || '', plan: code === 'S' && t.plan, after: tx[tx.length - 1].after, pct: (() => { const af = tx[tx.length - 1].after; const before = code === 'P' ? af - shares : af + shares; return before > 0 ? shares / before : null; })() });
  }
}
rows.sort((a, b) => (a.filed < b.filed ? 1 : a.filed > b.filed ? -1 : b.value - a.value));
const buys = rows.filter((r) => r.code === 'P'), sells = rows.filter((r) => r.code === 'S');
const bySym = {}; for (const r of rows) (bySym[r.sym] ||= []).push(r);
const cutoff = (n) => jst(Date.now() - n * 864e5).slice(0, 10);

// 日ごとの買い・売りの金額（SVG）。上が買い、下が売り
function flowChart(list, n = 45, label = '', H = 240) {
  const days = []; for (let i = n - 1; i >= 0; i--) days.push(cutoff(i));
  const b = Object.fromEntries(days.map((d) => [d, 0])), s = Object.fromEntries(days.map((d) => [d, 0]));
  for (const r of list) { const d = r.d1; if (!(d in b)) continue; if (r.code === 'P') b[d] += r.value; else s[d] += r.value; }
  const W = 720, mid = H / 2, bw = (W - 40) / n;
  const mb = Math.max(1, ...Object.values(b)), ms = Math.max(1, ...Object.values(s));
  const sc = (v, m) => Math.sqrt(v / m) * (mid - 26); // 金額の幅が大きいので平方根で縮める
  const bars = days.map((d, i) => { const x = 20 + i * bw; return `${b[d] ? `<rect class="by" x="${x.toFixed(1)}" y="${(mid - sc(b[d], mb)).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${sc(b[d], mb).toFixed(1)}"/>` : ''}${s[d] ? `<rect class="sl" x="${x.toFixed(1)}" y="${mid}" width="${(bw - 2).toFixed(1)}" height="${sc(s[d], ms).toFixed(1)}"/>` : ''}`; }).join('');
  const tick = days.map((d, i) => (i % 7 === (n - 1) % 7 ? `<text x="${(20 + i * bw + bw / 2).toFixed(1)}" y="${H - 4}" class="tk">${md(d)}</text>` : '')).join('');
  const bd = days.reduce((m, d) => (b[d] > b[m] ? d : m), days[0]);
  return `<figure class="flow"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label || '日ごとの買い・売りの金額')}"><line x1="16" x2="${W - 16}" y1="${mid}" y2="${mid}" class="ax"/>${bars}${tick}<text x="20" y="16" class="lb by-t">買い ▲</text><text x="20" y="${H - 22}" class="lb sl-t">売り ▼</text>${b[bd] ? `<text x="${W - 20}" y="16" class="pk" text-anchor="end">買いが最も多い日：${md(bd)}（${usd(b[bd])}）</text>` : ''}</svg><figcaption>${esc(label || `日ごとの買い・売りの金額（直近${n}日、取引日ベース）`)}</figcaption></figure>`;
}

const tag = (r) => (r.code === 'P' ? '<i class="tg b">買い</i>' : `<i class="tg s">売り</i>${r.plan ? '<i class="tg p">計画売却</i>' : ''}`);
const line = (r, withCo = true) => `<li class="tr ${r.code === 'P' ? 'b' : 's'}"><a href="/stock/${r.sym}/"><span class="sym">${esc(r.sym)}</span>${withCo ? `<span class="co">${esc(r.co)}</span>` : ''}<span class="who">${esc(r.owner)}<small>${esc(r.role)}</small></span><span class="amt">${tag(r)}<b>${usdB(r.value)}</b><small>${nf(r.shares)}株・平均${r.avg.toFixed(2)}ドル${r.pct != null && r.pct < 50 ? `・持ち株の${r.code === 'P' ? '+' : '−'}${r.pct >= 0.995 ? Math.round(r.pct * 100) : (r.pct * 100).toFixed(r.pct < 0.1 ? 1 : 0)}%` : ''}</small></span><span class="dt">取引 ${md(r.d1)}<small>報告 ${md(r.filed)}</small></span></a></li>`;

function layout({ title, desc, path: p, body, index = true }) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}｜${SITE.name}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${SITE.url}${p}">
${index ? '' : '<meta name="robots" content="noindex,follow">'}<meta name="color-scheme" content="light dark">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:type" content="website"><meta property="og:url" content="${SITE.url}${p}"><meta name="twitter:card" content="summary">
<link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/fonts.css?v=${ver}"><link rel="stylesheet" href="/style.css?v=${ver}">
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${SITE.ads}" crossorigin="anonymous"></script>
<script async src="https://www.googletagmanager.com/gtag/js?id=${SITE.ga}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${SITE.ga}');</script>
</head><body><header class="top"><a class="logo" href="/"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M3 20V9h4v11zM10 20V4h4v16zM17 20v-7h4v7z"/></svg>${SITE.name}</a><nav><a href="/buys/">買い一覧</a><a href="/companies/">会社一覧</a><a href="/guide/">読み方</a></nav></header>
<main>${body}</main>
<footer><p>当サイトは米国証券取引委員会（SEC）のEDGARで公開された Form 4 の内容を自動で集計・翻訳したものです。株価の予想や売買の推奨は行っていません。投資の判断はご自身の責任で、原文（SEC）もあわせてご確認ください。</p><p><a href="/about/">運営者情報</a><a href="/privacy/">プライバシーポリシー</a><a href="${SITE.contact}" target="_blank" rel="noopener">お問い合わせ</a></p><p>© ${today.slice(0, 4)} ${SITE.operator}</p></footer></body></html>`;
}
const updated = `<p class="note">最終更新：${esc(meta.at ? jst(meta.at).slice(0, 16).replace('T', ' ') : today)}（平日1日2回、自動更新）</p>`;

// 複数の役員が近い時期に買った会社（30日以内に2人以上）
const clusters = Object.entries(bySym).map(([sym, l]) => { const b = l.filter((r) => r.code === 'P' && r.d1 >= cutoff(30)); const who = [...new Set(b.map((r) => r.owner))]; return who.length >= 2 ? { sym, co: b[0].co, who, sum: b.reduce((x, r) => x + r.value, 0), last: b[0].d1 } : null; }).filter(Boolean).sort((a, b) => b.who.length - a.who.length || b.sum - a.sum);
// 読むときの確認点（どのページにも置く）
const checks = `<section class="box chk"><h2>この記録を読むときの5つの確認点</h2><ol><li><b>市場での買いか</b><span>研究では、役員が市場で買ったあとは株価が平均より少し上がる傾向が見られ、売りでは差が見られないとされます。売りは税金・資産の分散など理由がさまざまです。</span></li><li><b>いつもの取引か</b><span>毎年同じ時期にくり返す「定例」の取引は情報が少なく、定例でない取引のほうが注目されるとされます。前もって決めた計画による売却（計画売却）も同じです。</span></li><li><b>1人か、複数か</b><span>複数の役員が近い時期に買ったときは、1人だけのときより注目されるとされます。</span></li><li><b>誰が、持ち株のどれだけを</b><span>CEO・CFOなど会社の中心にいる人が、持ち株を大きく増やす買いは情報が強いとされます。</span></li><li><b>会社の大きさ</b><span>こうした傾向は主に小さな会社で見られ、当サイトが扱う大きな会社では弱いとされます。</span></li></ol><p class="note">過去の研究の平均的な傾向で、個々の銘柄の値動きを示すものではありません。売買の判断材料ではなく、調べるきっかけとしてお使いください。</p></section>`;
// トップ
{
  const n = 30, c = cutoff(n);
  const b30 = buys.filter((r) => r.d1 >= c), s30 = sells.filter((r) => r.d1 >= c);
  const sum = (l) => l.reduce((s, r) => s + r.value, 0);
  const plan = s30.filter((r) => r.plan).length;
  const bigSell = [...s30].sort((a, b) => b.value - a.value).slice(0, 15);
  const ceoBuys = b30.filter((r) => /CEO|CFO|会長|社長/.test(r.role));
  const body = `<section class="hero">${flowChart(rows, 45)}
<div class="hero-t"><h1>米国株の役員・大株主が<br>自社株を買った・売った記録</h1><p>SECに出された売買の報告（Form 4）を、時価総額の大きい米国企業${nf(Object.keys(companies).length)}社について日本語でまとめています。</p></div>
<div class="nums"><div class="n b"><span>直近${n}日の買い</span><b>${nf(b30.length)}<i>件</i></b><small>${usd(sum(b30))}</small></div><div class="n s"><span>直近${n}日の売り</span><b>${nf(s30.length)}<i>件</i></b><small>${usd(sum(s30))}・うち計画売却${nf(plan)}件</small></div></div></section>
${clusters.length ? `<section class="box"><h2>複数の役員が買った会社（直近30日）</h2><ul class="cls">${clusters.slice(0, 10).map((c) => `<li><a href="/stock/${c.sym}/"><span class="sym">${esc(c.sym)}</span><b>${esc(c.co)}</b><span>${c.who.length}人が買い・合計${usd(c.sum)}</span></a></li>`).join('')}</ul></section>` : ''}
${ceoBuys.length ? `<section class="box"><h2>CEO・CFO・会長が自社株を買った</h2><ul class="trs">${ceoBuys.slice(0, 10).map((r) => line(r)).join('')}</ul></section>` : ''}
<section class="box"><h2>最近の「買い」（市場で自分のお金で買ったもの）</h2><p class="lead">役員が市場で自社株を買う例は売りより少なく、見ている人が多い情報です。報酬として受け取った株や、ストックオプションの行使は含めていません。</p><ul class="trs">${buys.slice(0, 30).map((r) => line(r)).join('')}</ul><p><a class="more" href="/buys/">買いをすべて見る（${nf(buys.length)}件）</a></p></section>
<section class="box"><h2>金額の大きい「売り」（直近${n}日）</h2><p class="lead">「計画売却」は、前もって決めた計画（10b5-1プラン）にそって自動で売ったものです。会社の先行きの判断とは関係なく、税金の支払いや資産の分散のための売却が多いとされます。</p><ul class="trs">${bigSell.map((r) => line(r)).join('')}</ul></section>
${checks}${updated}`;
  write('/', layout({ title: '米国株の役員・大株主の売買（Form 4）を日本語で', desc: `米国株の役員・大株主が自社株を買った・売った記録（SEC Form 4）を日本語で毎日更新。直近${n}日の買い${b30.length}件・売り${s30.length}件。会社ごとの売買履歴も見られます。`, path: '/', body }));
}

// 買い一覧
write('/buys/', layout({ title: '米国株 役員の自社株買い一覧', desc: `米国株の役員・大株主が市場で自社株を買った記録の一覧（${buys.length}件、SEC Form 4）。`, path: '/buys/', body: `<section class="hero sm">${flowChart(buys, 45, '日ごとの買いの金額（直近45日）')}<div class="hero-t"><h1>役員・大株主の自社株買い 一覧</h1><p>市場で自分のお金で買ったもの（取引コード P）だけを、報告日の新しい順に並べています。</p></div></section><section class="box"><ul class="trs">${buys.map((r) => line(r)).join('')}</ul></section>${checks}${updated}` }));

// 会社ページ
const coList = [];
for (const [sym, list] of Object.entries(bySym)) {
  const r0 = list[0], b = list.filter((r) => r.code === 'P'), s = list.filter((r) => r.code === 'S');
  const sb = b.reduce((x, r) => x + r.value, 0), ss = s.reduce((x, r) => x + r.value, 0), pl = s.filter((r) => r.plan).length;
  const people = [...new Set(list.map((r) => r.owner))];
  coList.push({ sym, co: r0.co, en: r0.en, nb: b.length, ns: s.length, sb, ss, last: list[0].filed });
  const sumText = `${r0.co}（${sym}）では、当サイトの記録のある期間に、役員・大株主による市場での${[b.length ? `買いが${b.length}件（${usd(sb)}）` : '', s.length ? `売りが${s.length}件（${usd(ss)}）` : ''].filter(Boolean).join('、')}ありました。${s.length ? `売りのうち${pl}件は前もって決めた計画にそった売却です。` : ''}${b.length ? `買ったのは${[...new Set(b.map((r) => `${r.owner}（${r.role}）`))].slice(0, 3).join('、')}${new Set(b.map((r) => r.owner)).size > 3 ? 'など' : ''}です。` : '市場での買いはありません。'}`;
  const body = `<section class="hero sm">${flowChart(list, 90, `${r0.co}（${sym}）の日ごとの買い・売り（直近90日）`, 180)}
<div class="hero-t"><p class="crumbs"><a href="/">トップ</a> › <a href="/companies/">会社一覧</a></p><h1><span class="sym big">${esc(sym)}</span>${esc(r0.co)}の役員・大株主の売買</h1>${r0.en && r0.en !== r0.co ? `<p class="en">${esc(r0.en)}</p>` : ''}</div>
<div class="nums"><div class="n b"><span>買い</span><b>${b.length}<i>件</i></b><small>${usd(sb)}</small></div><div class="n s"><span>売り</span><b>${s.length}<i>件</i></b><small>${usd(ss)}${pl ? `・計画売却${pl}件` : ''}</small></div><div class="n"><span>報告した人</span><b>${people.length}<i>人</i></b><small>最終報告 ${md(r0.filed)}</small></div></div></section>
<section class="box"><p class="lead">${esc(sumText)}</p><ul class="trs">${list.map((r) => line(r, false)).join('')}</ul></section>
${checks}<section class="box"><h2>この記録の見方</h2><ul class="kv"><li><span>買い</span><b>役員などが市場で自分のお金で買ったもの（取引コード P）</b></li><li><span>売り</span><b>市場で売ったもの（取引コード S）</b></li><li><span>計画売却</span><b>前もって決めた計画（10b5-1プラン）にそった売却</b></li><li><span>平均</span><b>報告書にある1株あたりの取引価格の平均</b></li></ul><p class="note">報酬として受け取った株やストックオプションの行使は含めていません。原文は <a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${esc(r0.cik)}&type=4" target="_blank" rel="noopener">SEC EDGAR</a> で確認できます。</p></section>
${updated}`;
  write(`/stock/${sym}/`, layout({ title: `${r0.co}（${sym}）の役員の自社株売買・インサイダー取引の開示`, desc: sumText, path: `/stock/${sym}/`, body }), list.length >= 1);
}
// 取引の報告がない会社も、検索して来た人のためにページを作る（検索エンジンには出さない）
for (const c of Object.values(companies)) {
  const sym = String(c.ticker || '').toUpperCase().replace(/[^A-Z0-9.\-]/g, ''); if (!sym || bySym[sym]) continue;
  const co = c.ja || cap(c.name);
  write(`/stock/${sym}/`, layout({ title: `${co}（${sym}）の役員の自社株売買`, desc: `${co}（${sym}）の役員・大株主の売買の報告（Form 4）。`, path: `/stock/${sym}/`, index: false, body: `<section class="hero sm">${flowChart([], 90, `${co}（${sym}）の日ごとの買い・売り（直近90日）`, 120)}<div class="hero-t"><p class="crumbs"><a href="/">トップ</a> › <a href="/companies/">会社一覧</a></p><h1><span class="sym big">${esc(sym)}</span>${esc(co)}の役員・大株主の売買</h1></div></section><section class="box"><p class="lead">当サイトの記録のある期間に、役員・大株主による市場での買い・売りの報告はありません（報酬として受け取った株やオプションの行使は含めていません）。</p></section>${checks}${updated}` }), false);
  coList.push({ sym, co, en: cap(c.name), nb: 0, ns: 0, sb: 0, ss: 0, last: '' });
}
coList.sort((a, b) => b.nb - a.nb || b.sb + b.ss - (a.sb + a.ss));
write('/companies/', layout({ title: '会社一覧（米国株の役員の売買）', desc: `時価総額の大きい米国企業${coList.length}社の、役員・大株主の売買の件数の一覧。ティッカーや日本語の会社名で探せます。`, path: '/companies/', body: `<section class="hero sm">${flowChart(rows, 45)}<div class="hero-t"><h1>会社一覧</h1><p>時価総額の大きい米国企業${coList.length}社。役員・大株主の買いの件数が多い順です。</p></div></section><section class="box"><input class="q" type="search" placeholder="ティッカーか会社名で探す（例：NVDA、エヌビディア）" oninput="var q=this.value.toLowerCase();document.querySelectorAll('.cl tbody tr').forEach(function(r){r.hidden=q&&r.textContent.toLowerCase().indexOf(q)<0})"><table class="cl"><thead><tr><th>銘柄</th><th>会社</th><th class="r">買い</th><th class="r">売り</th><th class="r">最終報告</th></tr></thead><tbody>${coList.map((c) => `<tr><td><a class="sym" href="/stock/${c.sym}/">${esc(c.sym)}</a></td><td><a href="/stock/${c.sym}/">${esc(c.co)}</a><small>${esc(c.en)}</small></td><td class="r b">${c.nb ? `${c.nb}件<small>${usd(c.sb)}</small>` : '—'}</td><td class="r s">${c.ns ? `${c.ns}件<small>${usd(c.ss)}</small>` : '—'}</td><td class="r">${md(c.last) || '—'}</td></tr>`).join('')}</tbody></table></section>${updated}` }));

// 読み方・運営者情報・プライバシー
const guideArt = `<svg class="gart" viewBox="0 0 720 200" role="img" aria-label="Form 4 の流れ"><g class="gs"><rect x="20" y="50" width="180" height="100"/><rect x="270" y="50" width="180" height="100"/><rect x="520" y="50" width="180" height="100"/></g><g class="ga"><path d="M205 100h55M455 100h55"/></g><text x="110" y="95" class="gt">役員・大株主が</text><text x="110" y="120" class="gt">自社株を売買</text><text x="360" y="95" class="gt">2営業日以内に</text><text x="360" y="120" class="gt">SECへ Form 4</text><text x="610" y="95" class="gt">当サイトが</text><text x="610" y="120" class="gt">日本語で集計</text></svg>`;
write('/guide/', layout({ title: 'インサイダーの売買報告（Form 4）の読み方', desc: '米国株の役員・大株主が出す売買の報告（Form 4）の意味、買いと売りの違い、計画売却（10b5-1プラン）の見方を説明します。', path: '/guide/', body: `<article class="box prose">${guideArt}<h1>インサイダーの売買報告（Form 4）の読み方</h1>
<h2>Form 4 とは</h2><p>米国の上場企業の役員・取締役や、株を10%以上持つ大株主は、自社の株を売買すると原則2営業日以内に、SEC（米国証券取引委員会）へ「Form 4」という報告を出します。報告はすべて公開され、誰でも読めます。ここでいう「インサイダー」は会社の内部の人という意味で、違法なインサイダー取引のことではありません。</p>
<h2>「買い」が注目される理由</h2><p>役員の売りは、税金の支払いや資産の分散など、さまざまな理由で日常的に行われます。一方、市場で自分のお金を使って自社株を買う例は少なく、会社の内部をよく知る人の行動として注目されることがあります。ただし、買いのあとに株価が上がるとは限りません。</p>
<h2>計画売却（10b5-1プラン）</h2><p>役員が前もって売る時期や数量を決めておき、その計画にそって自動で売る仕組みです。報告にこの計画への言及があるものを、当サイトでは「計画売却」と表示しています。</p>
<h2>当サイトが含めていないもの</h2><ul><li>報酬として受け取った株（取引コード A）</li><li>ストックオプションの行使（取引コード M）</li><li>贈与（取引コード G）など、市場での売買でないもの</li></ul>
<h2>注意</h2><p>当サイトは公開された報告を自動で集計・翻訳したもので、内容の正確さを保証するものではありません。株価の予想や売買の推奨は行っていません。</p></article>` }));
write('/about/', layout({ title: '運営者情報', desc: `${SITE.name}の運営者情報`, path: '/about/', index: false, body: `<article class="box prose"><h1>運営者情報</h1><ul class="kv"><li><span>サイト名</span><b>${SITE.name}</b></li><li><span>運営</span><b>${SITE.operator}</b></li><li><span>お問い合わせ</span><b><a href="${SITE.contact}" target="_blank" rel="noopener">お問い合わせフォーム</a></b></li></ul><h2>データについて</h2><p>米国証券取引委員会（SEC）のEDGARで公開されている Form 4 を、SECの利用ルールにそって取得しています。会社名の日本語表記の一部は Wikidata（CC0）を使っています。</p><h2>免責</h2><p>掲載内容は投資の勧誘や助言ではありません。投資の判断はご自身でお願いします。</p></article>` }));
write('/privacy/', layout({ title: 'プライバシーポリシー', desc: 'プライバシーポリシー', path: '/privacy/', index: false, body: `<article class="box prose"><h1>プライバシーポリシー</h1><h2>広告について</h2><p>当サイトは第三者配信の広告サービス（Google アドセンス）を利用しています。広告配信事業者は、ユーザーの興味に応じた広告を表示するために Cookie を使用することがあります。Cookie を無効にする設定やGoogleアドセンスに関する詳細は「<a href="https://policies.google.com/technologies/ads?hl=ja" target="_blank" rel="noopener">広告 – ポリシーと規約 – Google</a>」をご覧ください。</p><h2>アクセス解析について</h2><p>当サイトは Google アナリティクスを利用しています。データは匿名で収集され、個人を特定するものではありません。</p><h2>免責事項</h2><p>当サイトの情報の正確性には注意していますが、内容を保証するものではありません。当サイトの情報によって生じた損害について責任を負いかねます。</p></article>` }));

// 静的ファイル
fs.cpSync(path.join(ROOT, 'static'), DIST, { recursive: true });
fs.writeFileSync(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE.url}/sitemap.xml\n`);
fs.writeFileSync(path.join(DIST, 'ads.txt'), `google.com, ${SITE.ads.replace('ca-', '')}, DIRECT, f08c47fec0942fa0\n`);
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap.map((u) => `<url><loc>${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`);
fs.writeFileSync(path.join(DIST, '_headers'), `https://:project.pages.dev/*\n  X-Robots-Tag: noindex\n`);
console.log('build', rows.length, 'rows', Object.keys(bySym).length, 'stocks', sitemap.length, 'urls');
