// 時間軸圖與匯出（xlsx／png／json）
import { MODES, segments, stats, notes, totalSec, fmt, fmtHMS, fileBase, displayTitle, clockTime, APP_VERSION, wallTime, clockHMS,
  itcStats, objName, objShort, hasRate, isSeat, actColor, taskOf, ITC_TASKS } from './model.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function tickStep(D, px) {
  const steps = [30, 60, 120, 300, 600, 900, 1200, 1800, 3600];
  const maxTicks = Math.max(2, Math.floor(px / 64));
  return steps.find((s) => D / s <= maxTicks) || 3600;
}

function clip(text, maxUnits) {
  let w = 0, out = '';
  for (const ch of text) {
    w += /[\u0000-ÿ]/.test(ch) ? 0.55 : 1;
    if (w > maxUnits) return out + '…';
    out += ch;
  }
  return out;
}

/**
 * 產生時間軸 SVG 字串
 * colors: { ink, muted, line, accent, bg }，可用 CSS 變數字串（畫面）或實際色碼（匯出 PNG）
 */
export function timelineSVG(s, width, colors, opts = {}) {
  if (s.mode === 'ITC') return itcSVG(s, width, colors, opts);
  const W = Math.max(320, Math.round(width));
  const D = Math.max(totalSec(s), 60);
  const narrow = W < 560;
  const L = narrow ? 76 : 120, R = 16;
  const headH = opts.header ? 56 : 0;
  const axisY = headH + 22;
  const rowsTop = axisY + 10;
  const font = opts.font || 'system-ui, -apple-system, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif';
  const plotW = W - L - R;
  const x = (t) => L + (Math.min(Math.max(t, 0), D) / D) * plotW;
  const parts = [];

  const rows = [];
  if (s.mode !== 'ATC') for (const c of s.codes) rows.push({ label: c.label, kind: c.kind, code: c, h: 30 });
  if (s.mode !== 'UTC') rows.push({ label: '文字記錄', kind: 'note', h: 44 });
  let acc = rowsTop;
  for (const r of rows) { r.y0 = acc; acc += r.h; }
  const H = acc + 14;

  if (opts.header) {
    parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${colors.bg}"/>`);
    parts.push(`<text x="16" y="26" font-size="17" font-weight="700" fill="${colors.ink}">${esc(displayTitle(s))}</text>`);
    const sub = [MODES[s.mode].tag + ' ' + MODES[s.mode].name, s.meta.date, clockTime(s.clock.startedAt) && '開始 ' + clockTime(s.clock.startedAt), '全長 ' + fmt(totalSec(s))].filter(Boolean).join('　');
    parts.push(`<text x="16" y="46" font-size="12.5" fill="${colors.muted}">${esc(sub)}</text>`);
  }

  // 刻度
  const step = tickStep(D, plotW);
  for (let t = 0; t <= D + 0.001; t += step) {
    const xx = x(t).toFixed(1);
    parts.push(`<line x1="${xx}" x2="${xx}" y1="${axisY + 4}" y2="${H - 10}" stroke="${colors.line}" stroke-width="1"/>`);
    const anchor = t === 0 ? 'start' : 'middle';
    parts.push(`<text x="${xx}" y="${axisY}" font-size="11" fill="${colors.muted}" text-anchor="${anchor}" font-variant-numeric="tabular-nums">${step < 60 ? fmt(t) : `${Math.round(t / 60)} 分`}</text>`);
  }

  const { segs, taps } = segments(s, totalSec(s));
  rows.forEach((row) => {
    const mid = row.y0 + row.h / 2;
    if (row.kind === 'note' && s.mode === 'DTC') parts.push(`<line x1="16" x2="${W - R}" y1="${row.y0}" y2="${row.y0}" stroke="${colors.line}" stroke-width="1"/>`);
    parts.push(`<text x="${L - 10}" y="${mid + 4}" font-size="12.5" font-weight="600" fill="${colors.ink}" text-anchor="end">${esc(clip(row.label, narrow ? 4.5 : 7.5))}</text>`);
    parts.push(`<line x1="${L}" x2="${W - R}" y1="${mid}" y2="${mid}" stroke="${colors.line}" stroke-width="1" stroke-dasharray="2 3"/>`);
    if (row.kind === 'note') {
      notes(s).forEach((n, k) => {
        const a = x(n.t0 ?? n.t), b = x(n.t);
        if (b - a > 1) parts.push(`<line x1="${a.toFixed(1)}" x2="${b.toFixed(1)}" y1="${mid}" y2="${mid}" stroke="${colors.accent}" stroke-width="3" stroke-linecap="round" opacity=".45"/>`);
        parts.push(`<g><title>#${k + 1} ${fmt(n.t)} ${esc(n.text)}</title><circle cx="${b.toFixed(1)}" cy="${mid}" r="6" fill="${colors.accent}"/>`);
        parts.push(`<text x="${b.toFixed(1)}" y="${(k % 2 ? mid + 19 : mid - 10)}" font-size="10.5" font-weight="700" fill="${colors.ink}" text-anchor="middle">${k + 1}</text></g>`);
      });
    } else if (row.kind === 'event') {
      for (const t of taps.filter((t) => t.code === row.code.id)) {
        const xx = x(t.t);
        parts.push(`<g><title>${esc(row.label)} ${fmt(t.t)}</title><path d="M${xx.toFixed(1)} ${mid - 8}l6 8l-6 8l-6 -8z" fill="${row.code.color}"/></g>`);
      }
    } else {
      for (const g of segs.filter((g) => g.code === row.code.id)) {
        const a = x(g.start), b = Math.max(x(g.end), a + 2);
        parts.push(`<rect x="${a.toFixed(1)}" y="${mid - 8}" width="${(b - a).toFixed(1)}" height="16" rx="3" fill="${row.code.color}"><title>${esc(row.label)} ${fmt(g.start)}–${fmt(g.end)}</title></rect>`);
      }
    }
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family='${font}' role="img" aria-label="${esc(displayTitle(s))} 時間軸">${parts.join('')}</svg>`;
}

// ---------- 下載 ----------
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ---------- PNG ----------
export async function timelinePNG(s) {
  // 匯出圖一律用淺色底，方便貼進報告
  const colors = { bg: '#FFFFFF', ink: '#17262A', muted: '#56686C', line: '#D3DCDA', accent: '#0F6E66' };
  const W = 1200;
  const svg = timelineSVG(s, W, colors, { header: true, matrix: true });
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = img.width * scale;
  canvas.height = img.height * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('圖片產生失敗'))), 'image/png'));
}

// ---------- XLSX ----------
function sheet(XLSX, rows, widths) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  if (widths) ws['!cols'] = widths.map((w) => ({ wch: w }));
  return ws;
}

export function workbook(s) {
  const XLSX = window.XLSX;
  if (!XLSX) throw new Error('試算表元件尚未載入');
  const wb = XLSX.utils.book_new();
  const m = s.meta;
  const total = totalSec(s);
  const info = [
    ['欄位', '內容'],
    ['工具', `${s.mode} ${MODES[s.mode].full}`],
    ['標題', m.title], ['日期', m.date], ['學校', m.school], ['班級', m.className], ['科目', m.subject],
    ['授課教師', m.teacher], ['觀課者', m.observer], ['備註', m.note],
    ['開始時刻', clockTime(s.clock.startedAt)], ['結束時刻', clockTime(s.clock.endedAt)],
    ['課堂長度（秒，扣除暫停）', Math.round(total)], ['課堂長度', fmtHMS(total)],
    ['暫停次數', s.clock.pauses.length],
    ['匯出程式版本', APP_VERSION],
  ];
  if (s.mode === 'ITC') {
    const st = itcStats(s);
    info.splice(info.length - 1, 0,
      ['記錄方式', isSeat(s) ? `座位表（${s.itc.seat.rows} 排 × ${s.itc.seat.cols} 個）` : '輪播（依序號）'],
      ['觀察對象數', s.itc.n], ['取樣間隔', s.itc.interval ? `${s.itc.interval} 秒（自動倒數）` : '手動'],
      ['先看後記', s.itc.rec ? `先看 ${s.itc.interval - s.itc.rec} 秒，最後 ${s.itc.rec} 秒記錄` : '不分段'],
      ['在工作中類別', s.codes.filter((c) => c.task === 'on').map((c) => c.label).join('、') || '（未設定）'],
      ['不在工作中類別', s.codes.filter((c) => c.task === 'off').map((c) => c.label).join('、') || '（未設定）'],
      ['教學活動', s.itc.acts ? s.itc.acts.join('、') : '（未標記）'],
      ['結束時缺席', (s.itc.absent || []).map((i) => objName(s, i)).join('、') || '無'],
      ['輪數', st.rounds.length], ['觀察人次', st.total],
      ['在工作中率（%）', st.rate == null ? '' : Math.round(st.rate * 1000) / 10]);
  }
  XLSX.utils.book_append_sheet(wb, sheet(XLSX, info, [24, 48]), '觀課資訊');

  if (s.mode === 'ITC') { itcSheets(XLSX, wb, s); return wb; }
  if (s.mode !== 'ATC') {
    const st = stats(s);
    const rows = [['代碼', '類型', '次數', '總時長（秒）', '總時長', '占全課比例（%）', '平均每次（秒）', '每分鐘次數']];
    for (const r of st) {
      if (r.code.kind === 'event') rows.push([r.code.label, '單次', r.count, '', '', '', '', Math.round(r.perMin * 100) / 100]);
      else rows.push([r.code.label, '持續', r.count, Math.round(r.total * 10) / 10, fmtHMS(r.total), Math.round(r.pct * 1000) / 10, Math.round(r.avg * 10) / 10, '']);
    }
    XLSX.utils.book_append_sheet(wb, sheet(XLSX, rows, [16, 8, 8, 14, 12, 16, 16, 12]), '統計');

    const { segs, taps } = segments(s, total);
    const label = (id) => s.codes.find((c) => c.id === id)?.label ?? id;
    const wall = (t) => clockHMS(wallTime(s, t));
    const detail = [
      ...segs.map((g) => ({ t: g.start, row: [label(g.code), '持續', Math.round(g.start * 10) / 10, Math.round(g.end * 10) / 10, Math.round((g.end - g.start) * 10) / 10, fmtHMS(g.start), fmtHMS(g.end), wall(g.start), wall(g.end)] })),
      ...taps.map((t) => ({ t: t.t, row: [label(t.code), '單次', Math.round(t.t * 10) / 10, '', '', fmtHMS(t.t), '', wall(t.t), ''] })),
    ].sort((a, b) => a.t - b.t);
    const rows2 = [['序', '代碼', '類型', '開始（秒）', '結束（秒）', '長度（秒）', '開始', '結束', '開始時刻', '結束時刻'], ...detail.map((d, i) => [i + 1, ...d.row])];
    XLSX.utils.book_append_sheet(wb, sheet(XLSX, rows2, [6, 16, 8, 12, 12, 12, 10, 10, 10, 10]), '明細');

    // 舊版 UTC 1.1 格式：每個代碼一組 start/stop 欄，純秒數
    const cols = [];
    for (const c of s.codes) {
      if (c.kind === 'event') {
        cols.push(['tap ' + c.label, ...taps.filter((t) => t.code === c.id).map((t) => Math.round(t.t))]);
      } else {
        const mine = segs.filter((g) => g.code === c.id);
        cols.push(['start ' + c.label, ...mine.map((g) => Math.round(g.start))]);
        cols.push(['stop ' + c.label, ...mine.map((g) => Math.round(g.end))]);
      }
    }
    const len = Math.max(...cols.map((c) => c.length));
    const legacy = Array.from({ length: len }, (_, r) => cols.map((c) => (c[r] ?? null)));
    XLSX.utils.book_append_sheet(wb, sheet(XLSX, legacy), '舊版格式');
  }
  if (s.mode !== 'UTC') {
    const head = ['序數', '開始記錄時間', '送出時間', '記錄文字', '開始（秒）', '送出（秒）', '開始時刻', '送出時刻'];
    const widths = [6, 14, 12, 60, 12, 12, 10, 10];
    // DTC：標出撰寫期間有哪些持續代碼在進行，方便質量對照
    const { segs } = segments(s, total);
    const label = (id) => s.codes.find((c) => c.id === id)?.label ?? id;
    const during = (a, b) => [...new Set(segs.filter((g) => g.start <= b && g.end >= a).map((g) => label(g.code)))].join('、');
    if (s.mode === 'DTC') { head.push('撰寫期間進行中的代碼'); widths.push(24); }
    const rows = [head, ...notes(s).map((n, i) => {
      const row = [i + 1, fmtHMS(n.t0 ?? n.t), fmtHMS(n.t), n.text, Math.round((n.t0 ?? n.t) * 10) / 10, Math.round(n.t * 10) / 10,
        clockHMS(wallTime(s, n.t0 ?? n.t)), clockHMS(wallTime(s, n.t))];
      if (s.mode === 'DTC') row.push(during(n.t0 ?? n.t, n.t));
      return row;
    })];
    XLSX.utils.book_append_sheet(wb, sheet(XLSX, rows, widths), '文字記錄');
  }
  return wb;
}

export function xlsxBlob(s) {
  const out = window.XLSX.write(workbook(s), { bookType: 'xlsx', type: 'array' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function jsonBlob(data) {
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
}

export const names = (s) => {
  const b = fileBase(s);
  return { xlsx: `${b}.xlsx`, png: `${b}_timeline.png`, json: `${b}.json` };
};

// ================= ITC =================
const NONE = '未記錄';

function itcSheets(XLSX, wb, s) {
  const st = itcStats(s);
  const rate = hasRate(s);
  const codeName = (id) => s.codes.find((c) => c.id === id)?.label ?? NONE;
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  const pr = (v) => (v == null ? '' : Math.round(v * 1000) / 10);
  const taskName = Object.fromEntries(ITC_TASKS);

  const sum = [['類別', '人次', '比例（%）', '在工作中率歸屬']];
  for (const r of st.byCode) sum.push([r.code.label, r.count, pct(r.count, st.total), taskName[r.code.task || 'skip']]);
  sum.push([NONE, st.none, pct(st.none, st.total), '不計入'], ['合計', st.total, st.total ? 100 : 0, '']);
  if (rate) sum.push([], ['在工作中率（%）', pr(st.rate), '', '在工作中 ÷（在工作中＋不在工作中）']);
  XLSX.utils.book_append_sheet(wb, sheet(XLSX, sum, [18, 8, 10, 30]), '統計');

  const acts = !!s.itc.acts;
  const rh = ['輪', '開始時刻', '結束時刻', '開始（課堂時間）', '結束（課堂時間）', ...(acts ? ['主要教學活動'] : []), ...s.codes.map((c) => c.label), NONE, '小計', ...(rate ? ['在工作中率（%）'] : [])];
  const rr = st.rounds.map((r) => [r.round, clockHMS(wallTime(s, r.start)), clockHMS(wallTime(s, r.end)), fmtHMS(r.start), fmtHMS(r.end), ...(acts ? [r.act] : []),
    ...s.codes.map((c) => r.counts[c.id]), r.none, r.size, ...(rate ? [pr(r.rate)] : [])]);
  rr.push(['合計', '', '', '', '', ...(acts ? [''] : []), ...st.byCode.map((x) => x.count), st.none, st.total, ...(rate ? [pr(st.rate)] : [])]);
  XLSX.utils.book_append_sheet(wb, sheet(XLSX, [rh, ...rr], [6, 10, 10, 14, 14, ...(acts ? [12] : []), ...s.codes.map(() => 12), 8, 8, 14]), '各輪');

  // 對象 × 輪：每格是該輪的類別；右側是各類別人次
  const seat = isSeat(s);
  const head = ['對象', ...(seat ? ['排', '位'] : []), ...st.rounds.map((r) => `第${r.round}輪`), ...s.codes.map((c) => c.label), NONE, '合計', ...(rate ? ['在工作中率（%）'] : [])];
  const grid = st.perObj.map((o) => {
    const cells = st.rounds.map((r) => { const e = r.items.find((x) => x.obj === o.i); return e ? codeName(e.code) : ''; });
    return [o.name, ...(seat ? [o.seat.r + 1, o.seat.c + 1] : []), ...cells, ...s.codes.map((c) => o.counts[c.id]), o.none, o.total, ...(rate ? [pr(o.rate)] : [])];
  });
  XLSX.utils.book_append_sheet(wb, sheet(XLSX, [head, ...grid], [10, ...(seat ? [5, 5] : []), ...st.rounds.map(() => 12), ...s.codes.map(() => 12), 8, 8, 14]), '對象x輪');

  if (acts) {
    const ah = ['教學活動', '時段數', '累計時間', '累計（秒）', '觀察人次', ...s.codes.map((c) => c.label), NONE, ...(rate ? ['在工作中率（%）'] : [])];
    const ar = st.byAct.map((a) => [a.label, a.times, fmtHMS(a.dur), Math.round(a.dur), a.total, ...s.codes.map((c) => a.counts[c.id]), a.none, ...(rate ? [pr(a.rate)] : [])]);
    XLSX.utils.book_append_sheet(wb, sheet(XLSX, [ah, ...ar], [14, 8, 10, 10, 10, ...s.codes.map(() => 12), 8, 14]), '依活動');
    const sh = ['序', '教學活動', '開始時刻', '結束時刻', '開始（課堂時間）', '結束（課堂時間）', '長度（秒）'];
    const sr = st.segs.map((g, i) => [i + 1, g.label, clockHMS(wallTime(s, g.start)), clockHMS(wallTime(s, g.end)), fmtHMS(g.start), fmtHMS(g.end), Math.round(g.end - g.start)]);
    XLSX.utils.book_append_sheet(wb, sheet(XLSX, [sh, ...sr], [6, 14, 10, 10, 14, 14, 10]), '活動時段');
  }

  const dh = ['序', '輪', '對象', '類別', '在工作中率歸屬', ...(acts ? ['教學活動'] : []), '觀察開始（課堂時間）', '記錄（課堂時間）', '觀察開始時刻', '記錄時刻', '開始（秒）', '記錄（秒）'];
  const dr = st.rounds.flatMap((r) => r.items).map((e, i) => [i + 1, e.round, objName(s, e.obj), codeName(e.code), e.code ? taskName[taskOf(s, e.code)] : '不計入', ...(acts ? [e.act || ''] : []),
    fmtHMS(e.t0 ?? e.t), fmtHMS(e.t), clockHMS(wallTime(s, e.t0 ?? e.t)), clockHMS(wallTime(s, e.t)),
    Math.round((e.t0 ?? e.t) * 10) / 10, Math.round(e.t * 10) / 10]);
  XLSX.utils.book_append_sheet(wb, sheet(XLSX, [dh, ...dr], [6, 6, 10, 16, 14, ...(acts ? [12] : []), 16, 14, 12, 10, 10, 10]), '明細');
}

const textW = (t, size) => [...String(t)].reduce((w, ch) => w + (/[\u0000-\u00ff]/.test(ch) ? 0.58 : 1) * size, 0);

/** ITC 圖：上方圖例＋各輪類別分布（100% 堆疊長條）；opts.matrix 時下方加「對象 × 輪」格子圖（匯出圖片用） */
function itcSVG(s, width, colors, opts = {}) {
  const st = itcStats(s);
  const W = Math.max(320, Math.round(width));
  const font = opts.font || 'system-ui, -apple-system, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif';
  const L = 44, R = 16;
  const parts = [];
  let y = 0;

  if (opts.header) {
    const sub = [`${MODES.ITC.tag} ${MODES.ITC.name}`, s.meta.date, clockTime(s.clock.startedAt) && '開始 ' + clockTime(s.clock.startedAt),
      `${s.itc.n} 位對象`, s.itc.interval ? `每位 ${s.itc.interval} 秒` : '手動取樣', `${st.rounds.length} 輪`, `${st.total} 人次`].filter(Boolean).join('　');
    parts.push(`<text x="16" y="26" font-size="17" font-weight="700" fill="${colors.ink}">${esc(displayTitle(s))}</text>`);
    parts.push(`<text x="16" y="46" font-size="12.5" fill="${colors.muted}">${esc(sub)}</text>`);
    y = 64;
  }

  // 圖例（自動換行）
  const items = [...s.codes.map((c, i) => ({ label: `${i + 1} ${c.label}`, color: c.color })), { label: NONE, color: null }];
  let lx = 16, ly = y + 16;
  for (const it of items) {
    const w = 14 + 6 + textW(it.label, 12) + 18;
    if (lx + w > W - R && lx > 16) { lx = 16; ly += 22; }
    parts.push(it.color
      ? `<rect x="${lx}" y="${ly - 10}" width="14" height="14" rx="3" fill="${it.color}"/>`
      : `<rect x="${lx + 0.5}" y="${ly - 9.5}" width="13" height="13" rx="3" fill="none" stroke="${colors.muted}" stroke-dasharray="2 2"/>`);
    parts.push(`<text x="${lx + 20}" y="${ly + 1}" font-size="12" fill="${colors.ink}">${esc(it.label)}</text>`);
    lx += w;
  }
  y = ly + 18;

  // 各輪分布
  const top = y + 8, ph = 150, bottom = top + ph;
  const R0 = Math.max(st.rounds.length, 1);
  const plotW = W - L - R;
  const band = plotW / R0;
  const bw = Math.max(4, Math.min(48, band * 0.72));
  for (const p of [0, 0.5, 1]) {
    const yy = bottom - p * ph;
    parts.push(`<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="${colors.line}"/>`);
    parts.push(`<text x="${L - 6}" y="${yy + 4}" font-size="11" fill="${colors.muted}" text-anchor="end">${p * 100}%</text>`);
  }
  const every = Math.max(1, Math.ceil(R0 / Math.floor(plotW / 34)));
  st.rounds.forEach((r, k) => {
    const cx = L + band * (k + 0.5);
    let acc = 0;
    const segs = [...s.codes.map((c) => ({ n: r.counts[c.id], color: c.color, label: c.label })), { n: r.none, color: null, label: NONE }];
    for (const g of segs) {
      if (!g.n) continue;
      const h = (g.n / r.size) * ph;
      const yy = bottom - acc - h;
      parts.push(g.color
        ? `<rect x="${(cx - bw / 2).toFixed(1)}" y="${yy.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${g.color}"><title>第${r.round}輪 ${esc(g.label)} ${g.n} 人次</title></rect>`
        : `<rect x="${(cx - bw / 2 + 0.5).toFixed(1)}" y="${(yy + 0.5).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${Math.max(0, h - 1).toFixed(1)}" fill="none" stroke="${colors.muted}" stroke-dasharray="2 2"><title>第${r.round}輪 ${NONE} ${g.n} 人次</title></rect>`);
      acc += h;
    }
    if (!r.complete) parts.push(`<text x="${cx}" y="${top - 4}" font-size="10.5" fill="${colors.muted}" text-anchor="middle">${r.size}/${s.itc.n}</text>`);
    if (k % every === 0 || k === R0 - 1) {
      parts.push(`<text x="${cx}" y="${bottom + 16}" font-size="11.5" font-weight="600" fill="${colors.ink}" text-anchor="middle">${r.round}</text>`);
      parts.push(`<text x="${cx}" y="${bottom + 31}" font-size="10.5" fill="${colors.muted}" text-anchor="middle">${clockTime(wallTime(s, r.start))}</text>`);
    }
  });
  parts.push(`<text x="${L}" y="${bottom + 48}" font-size="11" fill="${colors.muted}">輪次（下方為該輪開始時刻）</text>`);
  y = bottom + 60;

  // 在工作中率走勢與教學活動時段（橫軸為課堂時間）
  const rate = hasRate(s);
  if ((rate && st.rounds.length) || st.segs.length) {
    const D = Math.max(totalSec(s), ...st.rounds.map((r) => r.end), 60);
    const xt = (t) => L + (Math.min(Math.max(t, 0), D) / D) * plotW;
    parts.push(`<text x="16" y="${y + 14}" font-size="13" font-weight="700" fill="${colors.ink}">${rate ? '在工作中率' : '教學活動'}${rate && st.segs.length ? '與教學活動' : ''}</text>`);
    if (rate) parts.push(`<text x="${W - R}" y="${y + 14}" font-size="11.5" fill="${colors.muted}" text-anchor="end">全課 ${st.rate == null ? '—' : Math.round(st.rate * 100) + '%'}</text>`);
    y += 26;
    const t2 = y, h2 = rate ? 110 : 22, b2 = t2 + h2;
    for (const g of st.segs) {
      const x0 = xt(g.start), x1 = xt(g.end);
      const col = actColor(s, g.label);
      parts.push(`<rect x="${x0.toFixed(1)}" y="${t2}" width="${Math.max(0, x1 - x0).toFixed(1)}" height="${h2}" fill="${col}" fill-opacity="${rate ? 0.16 : 0.85}"><title>${esc(g.label)} ${fmt(g.start)}–${fmt(g.end)}</title></rect>`);
      if (rate) parts.push(`<rect x="${x0.toFixed(1)}" y="${b2 - 5}" width="${Math.max(0, x1 - x0).toFixed(1)}" height="5" fill="${col}"/>`);
      const lab = clip(g.label, (x1 - x0 - 8) / 11.5);
      if (x1 - x0 > 26 && lab && lab !== '…') parts.push(`<text x="${(x0 + 5).toFixed(1)}" y="${rate ? b2 - 10 : t2 + 15}" font-size="11" font-weight="600" fill="${rate ? col : '#fff'}">${esc(lab)}</text>`);
    }
    if (rate) {
      for (const p of [0, 0.5, 1]) {
        const yy = b2 - p * h2;
        parts.push(`<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="${colors.line}" stroke-dasharray="${p === 0 ? '' : '3 3'}"/>`);
        parts.push(`<text x="${L - 6}" y="${yy + 4}" font-size="11" fill="${colors.muted}" text-anchor="end">${p * 100}%</text>`);
      }
      const pts = st.rounds.filter((r) => r.rate != null).map((r) => [xt((r.start + r.end) / 2), b2 - r.rate * h2, r]);
      if (pts.length > 1) parts.push(`<polyline points="${pts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ')}" fill="none" stroke="${colors.ink}" stroke-width="2" stroke-linejoin="round"/>`);
      for (const [px, py, r] of pts) parts.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.5" fill="${colors.bg || '#fff'}" stroke="${colors.ink}" stroke-width="2"><title>第${r.round}輪 在工作中率 ${Math.round(r.rate * 100)}%</title></circle>`);
    }
    const step = Math.max(60, tickStep(D, plotW)); // 時刻只顯示到分鐘，刻度至少間隔 1 分鐘
    for (let t = 0; t <= D + 0.1; t += step) {
      parts.push(`<text x="${xt(t).toFixed(1)}" y="${b2 + 15}" font-size="10.5" fill="${colors.muted}" text-anchor="middle">${clockTime(wallTime(s, t))}</text>`);
    }
    y = b2 + 24;
    if (st.segs.length) {
      let ax = 16;
      const seen = [...new Set(st.segs.map((g) => g.label))];
      for (const label of seen) {
        const w = 14 + 6 + textW(label, 12) + 18;
        if (ax + w > W - R && ax > 16) { ax = 16; y += 20; }
        parts.push(`<rect x="${ax}" y="${y}" width="14" height="10" rx="2" fill="${actColor(s, label)}"/>`);
        parts.push(`<text x="${ax + 20}" y="${y + 10}" font-size="12" fill="${colors.ink}">${esc(label)}</text>`);
        ax += w;
      }
      y += 24;
    }
  }

  // 對象 × 輪 格子圖
  if (opts.matrix && st.rounds.length) {
    const nameW = Math.min(110, Math.max(36, ...st.perObj.map((o) => textW(o.name, 12))) + 12);
    const cw = Math.max(12, Math.min(30, (W - 16 - nameW - R) / R0));
    const ch = 20;
    parts.push(`<text x="16" y="${y + 14}" font-size="13" font-weight="700" fill="${colors.ink}">對象 × 輪</text>`);
    y += 26;
    st.rounds.forEach((r, k) => {
      if (k % Math.max(1, Math.ceil(16 / cw)) === 0) parts.push(`<text x="${16 + nameW + cw * (k + 0.5)}" y="${y + 10}" font-size="10.5" fill="${colors.muted}" text-anchor="middle">${r.round}</text>`);
    });
    y += 16;
    st.perObj.forEach((o, row) => {
      const yy = y + row * ch;
      parts.push(`<text x="${16 + nameW - 8}" y="${yy + 14}" font-size="12" fill="${colors.ink}" text-anchor="end">${esc(o.name)}</text>`);
      st.rounds.forEach((r, k) => {
        const e = r.items.find((x) => x.obj === o.i);
        const x = 16 + nameW + cw * k;
        if (!e) return;
        const ci = s.codes.findIndex((c) => c.id === e.code);
        if (ci < 0) {
          parts.push(`<rect x="${x + 1.5}" y="${yy + 2.5}" width="${cw - 3}" height="${ch - 5}" rx="2" fill="none" stroke="${colors.muted}" stroke-dasharray="2 2"/>`);
        } else {
          parts.push(`<rect x="${x + 1}" y="${yy + 2}" width="${cw - 2}" height="${ch - 4}" rx="2" fill="${s.codes[ci].color}"/>`);
          if (cw >= 16) parts.push(`<text x="${x + cw / 2}" y="${yy + 14}" font-size="10.5" font-weight="700" fill="#fff" text-anchor="middle">${ci + 1}</text>`);
        }
      });
    });
    y += st.perObj.length * ch + 12;
  }

  // 座位熱區（匯出圖片用）
  if (opts.matrix && isSeat(s) && st.total) {
    const seat = s.itc.seat;
    const at = new Map((s.itc.pos || []).map((p, i) => [`${p.r},${p.c}`, i]));
    const cw = Math.min(84, (W - 32 - (seat.cols - 1) * 6) / seat.cols), chh = 40, gap = 6;
    const gx = 16;
    parts.push(`<text x="16" y="${y + 14}" font-size="13" font-weight="700" fill="${colors.ink}">座位熱區</text>`);
    parts.push(`<text x="${gx + seat.cols * (cw + gap)}" y="${y + 14}" font-size="11" fill="${colors.muted}" text-anchor="end">${rate ? '顏色越深，在工作中率越高' : '格內數字為最常出現的類別'}</text>`);
    y += 24;
    const deskW = Math.min(seat.cols * (cw + gap) - gap, 220);
    const gridW = seat.cols * (cw + gap) - gap;
    parts.push(`<rect x="${gx + (gridW - deskW) / 2}" y="${y}" width="${deskW}" height="20" rx="4" fill="none" stroke="${colors.muted}"/>`);
    parts.push(`<text x="${gx + gridW / 2}" y="${y + 14}" font-size="11" fill="${colors.muted}" text-anchor="middle">講台</text>`);
    y += 28;
    for (let r = 0; r < seat.rows; r++) {
      for (let c = 0; c < seat.cols; c++) {
        const i = at.get(`${r},${c}`);
        const x = gx + c * (cw + gap), yy = y + r * (chh + gap);
        if (i == null) continue;
        const o = st.perObj[i];
        let fill = 'none', op = 1, val = '—', dark = false;
        if (o.total && rate && o.rate != null) { fill = '#2E8B57'; op = 0.12 + o.rate * 0.88; val = Math.round(o.rate * 100) + '%'; dark = o.rate > 0.55; }
        else if (o.total) {
          const top = s.codes.map((cd, k) => [cd, o.counts[cd.id], k]).sort((a2, b2) => b2[1] - a2[1])[0];
          if (top[1]) { fill = top[0].color; op = 0.85; val = String(top[2] + 1); dark = true; }
        }
        parts.push(`<rect x="${x}" y="${yy}" width="${cw}" height="${chh}" rx="6" fill="${fill}" fill-opacity="${op.toFixed(2)}" stroke="${colors.line}"/>`);
        parts.push(`<text x="${x + cw / 2}" y="${yy + 17}" font-size="12" font-weight="700" fill="${dark ? '#fff' : colors.ink}" text-anchor="middle">${esc(clip(o.name.replace(/ 號$/, ''), cw / 12))}</text>`);
        parts.push(`<text x="${x + cw / 2}" y="${yy + 32}" font-size="11" fill="${dark ? '#fff' : colors.muted}" text-anchor="middle">${val}</text>`);
      }
    }
    y += seat.rows * (chh + gap) + 10;
  }

  const H = Math.round(y);
  const bg = opts.header ? `<rect x="0" y="0" width="${W}" height="${H}" fill="${colors.bg}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family='${font}' role="img" aria-label="${esc(displayTitle(s))} 各輪類別分布">${bg}${parts.join('')}</svg>`;
}
