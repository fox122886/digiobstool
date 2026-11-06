// 時間軸圖與匯出（xlsx／png／json）
import { MODES, segments, stats, notes, totalSec, fmt, fmtHMS, fileBase, displayTitle, clockTime, APP_VERSION, wallTime, clockHMS } from './model.js';

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
  const svg = timelineSVG(s, W, colors, { header: true });
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
  XLSX.utils.book_append_sheet(wb, sheet(XLSX, info, [24, 48]), '觀課資訊');

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
