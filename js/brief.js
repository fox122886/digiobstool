// 觀課重點與觀課重點摘要（一頁）
// 原則：只陳述記錄中的客觀事實（時間、次數、比例），不下評價；每一點都能連回結果頁的對應區塊
import { fmt, clockHMS, wallTime, totalSec, stats, segments, notes, itcStats, hasRate, MODES, displayTitle, clockTime, noteStamps, hasStamp, isBareMark } from './model.js';

const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (x) => `${Math.round(x * 100)}%`;
const min = (sec) => `${Math.round(sec / 60)} 分`;
const B = (x) => `<b>${esc(x)}</b>`;

// 某段時間內，各持續代碼占了多少秒
function overlap(segs, a, b) {
  const by = {};
  for (const g of segs) {
    const d = Math.min(g.end, b) - Math.max(g.start, a);
    if (d > 0) by[g.code] = (by[g.code] || 0) + d;
  }
  return by;
}
// 所有持續代碼聯集後的覆蓋時間
function covered(segs) {
  const iv = segs.map((g) => [g.start, g.end]).sort((x, y) => x[0] - y[0]);
  let sum = 0, cs = -1, ce = -1;
  for (const [a, b] of iv) {
    if (a > ce) { if (ce > cs) sum += ce - cs; cs = a; ce = b; } else ce = Math.max(ce, b);
  }
  if (ce > cs) sum += ce - cs;
  return sum;
}

function codeInsights(s) {
  const out = [];
  const total = totalSec(s);
  const { segs, taps } = segments(s, total);
  const st = stats(s).filter((r) => r.code.kind !== 'event' && r.count);
  const name = (id) => s.codes.find((c) => c.id === id)?.label || '';
  if (!total || (!segs.length && !taps.length)) return out;

  // 1. 占比最高的持續代碼
  const top = [...st].sort((a, b) => b.total - a.total)[0];
  if (top) out.push({ go: '時間分配', text: `${B(top.code.label)}占全課 ${B(pct(top.pct))}（${fmt(top.total)}），共 ${top.count} 段。` });

  // 2. 教師／學生相關代碼的時間比（代碼名稱以「教師」「學生」開頭時）
  const sumBy = (re) => st.filter((r) => re.test(r.code.label)).reduce((a, r) => a + r.total, 0);
  const tT = sumBy(/^教師/), sT = sumBy(/^學生/);
  if (tT && sT) out.push({ go: '時間分配', text: `以「教師」開頭的代碼共 ${B(min(tT))}，以「學生」開頭的共 ${B(min(sT))}，約 ${B(`${Math.round((tT / (tT + sT)) * 10)} : ${Math.round((sT / (tT + sT)) * 10)}`)}。` });

  // 3. 課堂節奏：每 5 分鐘以哪個代碼為主，相鄰相同的合併
  const bin = 300;
  const phases = [];
  for (let a = 0; a < total; a += bin) {
    const by = overlap(segs, a, Math.min(total, a + bin));
    const best = Object.entries(by).sort((x, y) => y[1] - x[1])[0];
    const lab = best && best[1] >= Math.min(bin, total - a) * 0.4 ? name(best[0]) : '（無明顯主軸）';
    const last = phases[phases.length - 1];
    if (last && last.lab === lab) last.b = Math.min(total, a + bin); else phases.push({ lab, a, b: Math.min(total, a + bin) });
  }
  if (phases.length > 1) {
    out.push({ go: '時間軸', text: `課堂節奏（每 5 分鐘的主要代碼）：${phases.slice(0, 6).map((p) => `${Math.round(p.a / 60)}–${Math.round(p.b / 60)} 分${B(p.lab)}`).join('，')}${phases.length > 6 ? '……' : ''}。` });
  }

  // 4. 最長的一段
  const longest = [...segs].sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
  if (longest) out.push({ go: '時間軸', text: `最長的一段是${B(name(longest.code))} ${B(fmt(longest.end - longest.start))}（${clockHMS(wallTime(s, longest.start)).slice(0, 5)}–${clockHMS(wallTime(s, longest.end)).slice(0, 5)}）。` });

  // 5. 單次代碼：最密集的 10 分鐘
  for (const c of s.codes.filter((x) => x.kind === 'event')) {
    const mine = taps.filter((t) => t.code === c.id).map((t) => t.t);
    if (!mine.length) continue;
    let best = { n: 0, a: 0 };
    for (const t0 of mine) { const n = mine.filter((t) => t >= t0 && t < t0 + 600).length; if (n > best.n) best = { n, a: t0 }; }
    out.push({ go: '時間軸', text: `${B(c.label)}共 ${B(mine.length + ' 次')}${mine.length > 2 ? `，其中 ${best.n} 次集中在 ${Math.floor(best.a / 60)}–${Math.floor(best.a / 60) + 10} 分` : ''}。` });
  }

  // 6. 未標記與重疊時間
  const cov = covered(segs);
  const sumAll = st.reduce((a, r) => a + r.total, 0);
  const gap = total - cov, ov = sumAll - cov;
  const bits = [];
  if (gap >= 30) bits.push(`有 ${B(min(gap))}沒有標記任何持續代碼`);
  if (ov >= 30) bits.push(`代碼同時進行的時間共 ${B(min(ov))}，所以占比加總會超過 100%`);
  if (bits.length) out.push({ go: '時間分配', text: bits.join('；') + '。' });
  return out;
}

function noteInsights(s) {
  const out = [];
  const ns = notes(s);
  const total = totalSec(s);
  if (!ns.length) return out;
  out.push({ go: '文字記錄', text: `共 ${B(ns.length + ' 則')}文字記錄，平均每 ${B(fmt(total / ns.length))} 一則；撰寫一則平均 ${fmt(ns.reduce((a, n) => a + (n.t - (n.t0 ?? n.t)), 0) / ns.length)}。` });
  // 文字中插入的時刻 = 關鍵時刻
  const keys = ns.filter(hasStamp);
  if (keys.length) {
    const hms = keys.flatMap((n) => noteStamps(s, n).map((x) => x.hms.slice(0, 5)));
    const bare = keys.filter(isBareMark).length;
    out.push({ go: '文字記錄', text: `插入時刻的關鍵時刻 ${B(hms.length + ' 個')}：${hms.map((x) => B(x)).join('、')}${bare ? `；其中 ${B(bare + ' 則')}只有時刻，待補充內容` : ''}。` });
  }
  // 最長沒有記錄的空白
  const pts = [0, ...ns.map((n) => n.t), total];
  let g = { d: 0, a: 0, b: 0 };
  for (let i = 1; i < pts.length; i++) { const a = i === 1 ? 0 : pts[i - 1]; const b = i === pts.length - 1 ? total : (ns[i - 1].t0 ?? ns[i - 1].t); if (b - a > g.d) g = { d: b - a, a, b }; }
  if (g.d >= 180) out.push({ go: '時間軸', text: `最長的空白是 ${Math.floor(g.a / 60)}–${Math.floor(g.b / 60)} 分（約 ${B(min(g.d))}沒有文字記錄），議課時可以請授課教師補充這段的情形。` });
  // 前中後段分布
  const third = ns.map((n) => Math.min(2, Math.floor((n.t / total) * 3)));
  out.push({ go: '時間軸', text: `前、中、後三段各有 ${[0, 1, 2].map((k) => B(third.filter((x) => x === k).length)).join('／')} 則記錄。` });
  // DTC：寫記錄時進行中的代碼
  if (s.mode === 'DTC') {
    const { segs } = segments(s, total);
    const cnt = {};
    for (const n of ns) for (const g of segs) if (g.start <= n.t && g.end >= (n.t0 ?? n.t)) cnt[g.code] = (cnt[g.code] || 0) + 1;
    const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 2);
    if (top.length) out.push({ go: '文字記錄', text: `文字記錄最常寫在${top.map(([id, k]) => `${B(s.codes.find((c) => c.id === id)?.label)}期間（${k} 則）`).join('、')}，可以對照該段的時間分配一起討論。` });
  }
  return out;
}

function itcInsights(s) {
  const out = [];
  const st = itcStats(s);
  if (!st.total) return out;
  const rate = hasRate(s);
  if (rate) out.push({ go: '各類別人次', text: `全課在工作中率 ${B(pct(st.rate))}（${st.rounds.length} 輪、${st.total} 人次）。` });
  const rr = st.rounds.filter((r) => r.rate != null && r.complete);
  if (rate && rr.length > 2) {
    const lo = [...rr].sort((a, b) => a.rate - b.rate)[0], hi = [...rr].sort((a, b) => b.rate - a.rate)[0];
    out.push({ go: '各輪分布', text: `最低是第 ${lo.round} 輪（${clockHMS(wallTime(s, lo.start)).slice(0, 5)}）${B(pct(lo.rate))}${lo.act ? `，當時是${B(lo.act)}` : ''}；最高是第 ${hi.round} 輪 ${pct(hi.rate)}${hi.act ? `（${esc(hi.act)}）` : ''}。` });
    const h = Math.ceil(rr.length / 2);
    const r1 = rr.slice(0, h).reduce((a, r) => a + r.rate, 0) / h, r2 = rr.slice(h).reduce((a, r) => a + r.rate, 0) / (rr.length - h);
    out.push({ go: '各輪分布', text: `前半節平均 ${B(pct(r1))}，後半節平均 ${B(pct(r2))}。` });
  }
  if (rate && st.byAct.length > 1) {
    const a = st.byAct.filter((x) => x.rate != null).sort((x, y) => y.rate - x.rate);
    if (a.length > 1) out.push({ go: '依教學活動', text: `依教學活動：${a.map((x) => `${esc(x.label)} ${B(pct(x.rate))}`).join('、')}。` });
  }
  if (!rate) {
    const top = [...st.byCode].sort((a, b) => b.count - a.count)[0];
    out.push({ go: '各類別人次', text: `最常出現的類別是${B(top.code.label)}（${pct(top.pct)}）。` });
  }
  if (rate) {
    const low = st.perObj.filter((o) => o.total && o.rate != null && o.rate < 0.7).length;
    if (low) out.push({ go: '對象 × 輪', text: `有 ${B(low + ' 位')}對象的在工作中率低於 70%，可對照「對象 × 輪」看是哪幾輪、當時的教學活動為何。` });
  }
  if (st.none) out.push({ go: '各類別人次', text: `有 ${st.none} 人次未記錄（占 ${pct(st.none / st.total)}）。` });
  return out;
}

export function insights(s) {
  if (s.mode === 'ITC') return itcInsights(s);
  if (s.mode === 'ATC') return noteInsights(s);
  if (s.mode === 'UTC') return codeInsights(s);
  if (s.mode === 'DTC') return [...codeInsights(s).slice(0, 4), ...noteInsights(s).filter((x) => x.go === '文字記錄')];
  return [];
}

export function briefPanel(s) {
  const list = insights(s);
  if (!list.length) return '';
  return `<section class="panel brief" id="sec-brief">
    <header><h2>觀課重點</h2><span class="hint">由記錄自動整理的客觀事實，點一下跳到對應圖表</span></header>
    ${s.meta.focus ? `<p class="brief-focus"><span>觀察焦點</span>${esc(s.meta.focus)}</p>` : ''}
    <ol class="brief-list">${list.map((x) => `<li><button type="button" data-act="brief-go" data-go="${esc(x.go)}"><span class="txt">${x.text}</span><span class="go">${esc(x.go)} ›</span></button></li>`).join('')}</ol>
    <div class="row" style="justify-content:flex-end"><button class="btn sm primary" data-act="report">觀課重點摘要（一頁）→</button></div>
  </section>`;
}

// ---------- 觀課重點摘要（一頁） ----------
const PRINT = { bg: '#FFFFFF', ink: '#17262A', muted: '#56686C', line: '#D3DCDA', accent: '#0F6E66', warn: '#9A6400' };
export { PRINT as printColors };

export function reportHTML(s, chartSVG) {
  const m = s.meta;
  const list = insights(s);
  const kv = (k, v) => `<div><dt>${k}</dt><dd>${esc(v) || '&nbsp;'}</dd></div>`;
  let extra = '';
  if (s.mode === 'UTC' || s.mode === 'DTC') {
    const st = stats(s).filter((x) => x.count);
    extra += `<div><h3>時間分配</h3><table class="rt"><thead><tr><th>代碼</th><th>次數</th><th>總時長</th><th>占比</th></tr></thead><tbody>${st.map((x) => `<tr><td><i style="background:${x.code.color}"></i>${esc(x.code.label)}</td><td>${x.count}</td><td>${x.total == null ? '—' : fmt(x.total)}</td><td>${x.pct == null ? `每分 ${x.perMin.toFixed(2)} 次` : pct(x.pct)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  if (s.mode === 'ATC' || s.mode === 'DTC') {
    // 有插入時刻的記錄就只列關鍵時刻（其餘見結果頁或 Excel），沒有就列出全部
    const all = notes(s);
    const keys = all.filter(hasStamp);
    const list = keys.length ? keys : all;
    const txt = (n) => esc(n.text).replace(/\[(\d{1,2}:\d{2}:\d{2})\]/g, '<b>$1</b>') + (isBareMark(n) ? '<span class="todo">（待補充）</span>' : '');
    const when = (n) => (noteStamps(s, n)[0]?.hms || clockHMS(wallTime(s, n.t))).slice(0, 5);
    extra += `<div><h3>${keys.length ? '關鍵時刻（文字中插入的時刻）' : '文字記錄'}</h3><table class="rt notes"><tbody>${list.map((n) => `<tr><td class="t">${when(n)}</td><td>${txt(n)}</td></tr>`).join('')}</tbody></table>
      ${keys.length && all.length > keys.length ? `<p class="rnote">其餘 ${all.length - keys.length} 則文字記錄請見結果頁或 Excel。</p>` : ''}</div>`;
  }
  if (s.mode === 'ITC') {
    const st = itcStats(s);
    if (st.byAct.length) extra += `<div><h3>依教學活動</h3><table class="rt"><thead><tr><th>活動</th><th>時間</th><th>人次</th>${hasRate(s) ? '<th>在工作中率</th>' : ''}</tr></thead><tbody>${st.byAct.map((a) => `<tr><td>${esc(a.label)}</td><td>${fmt(a.dur)}</td><td>${a.total}</td>${hasRate(s) ? `<td>${a.rate == null ? '—' : pct(a.rate)}</td>` : ''}</tr>`).join('')}</tbody></table></div>`;
  }
  return `<div class="report-bar no-print">
      <button class="back" data-act="report-back">‹ 回到結果</button>
      <span class="hint">按「列印／存成 PDF」後，在列印視窗的目的地選「另存為 PDF」即可存檔。</span>
      <button class="btn primary sm" data-act="report-print">列印／存成 PDF</button>
    </div>
    <article class="report" aria-label="觀課重點摘要">
      <header class="rh">
        <p class="kicker">觀課重點摘要　${MODES[s.mode].tag} ${esc(MODES[s.mode].name)}</p>
        <h1>${esc(displayTitle(s))}</h1>
        <dl class="rmeta">${kv('日期', m.date)}${kv('班級', m.className)}${kv('領域／科目', m.subject)}${kv('授課教師', m.teacher)}${kv('觀課人員', m.observer)}${kv('課堂時間', `${clockTime(s.clock.startedAt) || ''}　共 ${fmt(totalSec(s))}`)}</dl>
      </header>
      ${m.focus ? `<section><h2>觀察焦點</h2><p class="rtext">${esc(m.focus)}</p></section>` : ''}
      <section><h2>觀課重點（依記錄整理的事實）</h2><ol class="rbrief">${list.map((x) => `<li>${x.text}</li>`).join('') || '<li>（沒有足夠的記錄）</li>'}</ol></section>
      <section class="rchart ${s.mode.toLowerCase()}">${chartSVG}</section>
      ${extra ? `<section class="rextra ${s.mode === 'DTC' ? 'two' : ''}">${extra}</section>` : ''}
      ${m.note ? `<section><h2>備註</h2><p class="rtext">${esc(m.note)}</p></section>` : ''}
      <footer class="rf">由數位觀課工具產生　${esc(m.date || '')}　·　張民杰教授團隊</footer>
    </article>`;
}
