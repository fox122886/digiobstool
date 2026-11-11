// PTC 教師移動：教室版面、統計、路線圖（純函式，不碰 DOM）
// 座標以「格」為單位：x 由左而右、y 由前（講台側）而後，觀課者由教室後方看向講台
import { uid, fmt, fmtHMS, clockHMS, clockTime, wallTime, totalSec, newSession } from './model.js';

export const TEACHER_KINDS = [
  ['move', '經過', '移動經過，未停留'],
  ['watch', '停留觀察', '停留，只觀察學生、未互動'],
  ['class', '全班講解', '停留，對全班說明或教學'],
  ['talk', '與學生討論', '學生—教師討論（依序編號）'],
  ['ask', '學生主動詢問', '學生主動找老師（依序編號）'],
];
export const STUDENT_KINDS = [
  ['direct', '直接移動', 'xxxxx'],
  ['purpose', '有目的的移動（非直接）', '- - - -'],
  ['aimless', '非目的性的移動', '‧‧‧‧'],
];
export const kindName = (k) => (TEACHER_KINDS.find((x) => x[0] === k) || STUDENT_KINDS.find((x) => x[0] === k) || [k, k])[1];
const NUMBERED = new Set(['talk', 'ask']);

// ---------- 版面範本 ----------
let seatNo = 0;
const seats = (n) => Array.from({ length: n }, () => ({ id: uid(), label: String(++seatNo), sex: '' }));
// 小組桌：n 人排成 sr 排，每排 ceil(n / sr) 個位置；人數不整齊時（例如 5 人 2 排）最後一格留空
const group = (x, y, sr, sc, label, n = sr * sc) => ({ id: uid(), kind: 'group', x, y, sr, sc, w: sc, h: sr, label, seats: seats(n) });
const area = (x, y, w, h, label) => ({ id: uid(), kind: 'area', x, y, w, h, label });

export const ROOM_TEMPLATES = [
  ['groups', '分組（6 組 × 4 人）'],
  ['groups5', '分組（6 組 × 5 人）'],
  ['rows', '排排坐（5 排 × 6 人）'],
  ['open', '開放式（小組桌＋學習區）'],
];

export function makeRoom(tpl = 'groups') {
  seatNo = 0;
  if (tpl === 'rows') {
    const items = [area(5, 0, 6, 1, '講台'), area(15, 1, 1, 2, '門')];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) items.push(group(1 + c * 2 + (c >= 3 ? 1 : 0), 3 + r * 2, 1, 1, ''));
    return { w: 16, h: 13, items };
  }
  if (tpl === 'open') {
    return {
      w: 18, h: 14, items: [
        area(1, 0, 4, 1, '老師的桌子'), area(10, 0, 4, 2, '藝術中心'), area(15, 0, 3, 2, '茶水間'),
        area(0, 3, 1, 3, '閱讀資料室'), area(0, 7, 1, 1, '門'), area(1, 13, 4, 1, '科學中心'), area(10, 13, 5, 1, '參考資料室'),
        group(3, 3, 2, 3, '第 1 組'), group(10, 4, 2, 3, '第 2 組'), group(3, 7, 2, 3, '第 3 組'),
        group(11, 8, 2, 3, '第 4 組'), group(4, 10, 2, 3, '第 5 組'), group(11, 11, 2, 3, '第 6 組'),
      ],
    };
  }
  if (tpl === 'groups5') {
    const items = [area(7, 0, 6, 1, '講台'), area(19, 1, 1, 2, '門')];
    [[2, 3], [8, 3], [14, 3], [2, 8], [8, 8], [14, 8]].forEach(([x, y], i) => items.push(group(x, y, 2, 3, `第 ${i + 1} 組`, 5)));
    return { w: 20, h: 12, items };
  }
  const items = [area(6, 0, 6, 1, '講台'), area(17, 1, 1, 2, '門')];
  [[2, 3], [8, 3], [14, 3], [2, 8], [8, 8], [14, 8]].forEach(([x, y], i) => items.push(group(x, y, 2, 2, `第 ${i + 1} 組`)));
  return { w: 18, h: 12, items };
}

export const allSeats = (room) => room.items.filter((it) => it.kind === 'group').flatMap((g) => g.seats.map((st, k) => ({
  ...st, g, x: g.x + (k % g.sc) + 0.5, y: g.y + Math.floor(k / g.sc) + 0.5,
})));
export const seatById = (room, id) => allSeats(room).find((x) => x.id === id);
export const groupName = (g) => g.label || (g.seats.length === 1 ? `${g.seats[0].label} 號座位` : '小組桌');

// 點的位置：落在哪個座位、桌、區域；否則找最近的桌（1.5 格內）視為「在某組旁」
export function locate(room, x, y) {
  for (const it of room.items) {
    if (x >= it.x && x <= it.x + it.w && y >= it.y && y <= it.y + it.h) {
      if (it.kind === 'area') return { area: it, label: it.label };
      const k = Math.min(it.sr - 1, Math.floor(y - it.y)) * it.sc + Math.min(it.sc - 1, Math.floor(x - it.x));
      return { group: it, seat: it.seats[k], label: groupName(it) };
    }
  }
  let best = null, bd = 1.5;
  for (const it of room.items) {
    if (it.kind !== 'group') continue;
    const dx = Math.max(it.x - x, 0, x - it.x - it.w), dy = Math.max(it.y - y, 0, y - it.y - it.h);
    const d = Math.hypot(dx, dy);
    if (d < bd) { bd = d; best = it; }
  }
  if (best) return { group: best, near: true, label: `${groupName(best)}旁` };
  return { label: '走道' };
}
export function zoneOf(room, x, y) {
  const r = Math.min(2, Math.floor((y / room.h) * 3)), c = Math.min(2, Math.floor((x / room.w) * 3));
  return { r, c, name: ['前', '中', '後'][r] + ['左', '中', '右'][c] };
}

export const tEvents = (s) => s.events.filter((e) => e.type === 'tm').sort((a, b) => a.t - b.t);
export const sEvents = (s) => s.events.filter((e) => e.type === 'sm').sort((a, b) => a.t - b.t);

// ---------- 統計 ----------
export function ptcStats(s) {
  const room = s.ptc.room;
  const D = Math.max(totalSec(s), ...s.events.map((e) => e.t || 0), 1);
  const tm = tEvents(s);
  let n = 0;
  const pts = tm.map((e, i) => {
    const end = i + 1 < tm.length ? tm[i + 1].t : D;
    const loc = locate(room, e.x, e.y);
    return { ...e, dur: Math.max(0, end - e.t), loc, zone: zoneOf(room, e.x, e.y), no: NUMBERED.has(e.k) ? ++n : null };
  });
  const zones = Array.from({ length: 3 }, (_, r) => Array.from({ length: 3 }, (_, c) => ({ r, c, name: ['前', '中', '後'][r] + ['左', '中', '右'][c], dur: 0, visits: 0, talks: 0 })));
  for (const p of pts) {
    const z = zones[p.zone.r][p.zone.c];
    z.dur += p.dur; z.visits++; if (p.no) z.talks++;
  }
  const groups = room.items.filter((it) => it.kind === 'group' && it.seats.length > 1).map((g) => {
    const mine = pts.filter((p) => p.loc.group === g);
    return { g, name: groupName(g), visits: mine.length, dur: mine.reduce((a, p) => a + p.dur, 0), talks: mine.filter((p) => p.no).length };
  });
  const areas = room.items.filter((it) => it.kind === 'area').map((a) => {
    const mine = pts.filter((p) => p.loc.area === a);
    return { a, name: a.label, visits: mine.length, dur: mine.reduce((x, p) => x + p.dur, 0) };
  });
  // 性別：討論時最接近的座位
  const seatsAll = allSeats(room);
  const sexCount = { M: seatsAll.filter((x) => x.sex === 'M').length, F: seatsAll.filter((x) => x.sex === 'F').length };
  const talkSex = { M: 0, F: 0, '': 0 };
  for (const p of pts.filter((q) => q.no)) {
    const near = p.loc.seat || nearestSeat(seatsAll, p.x, p.y);
    talkSex[near?.sex || ''] = (talkSex[near?.sex || ''] || 0) + 1;
  }
  // 時段：把課堂平均分成三段
  const parts = 3;
  const slots = Array.from({ length: parts }, (_, i) => {
    const a = (D * i) / parts, b = (D * (i + 1)) / parts;
    const mine = pts.filter((p) => p.t >= a && p.t < b);
    const zd = {};
    for (const p of mine) zd[p.zone.name] = (zd[p.zone.name] || 0) + p.dur;
    return { i, a, b, points: mine.length, talks: mine.filter((p) => p.no).length, top: Object.entries(zd).sort((x, y) => y[1] - x[1])[0]?.[0] || '—' };
  });
  const byKind = Object.fromEntries(TEACHER_KINDS.map(([k]) => [k, pts.filter((p) => p.k === k)]));
  const front = pts.filter((p) => p.zone.r === 0).reduce((a, p) => a + p.dur, 0);
  return { D, pts, zones, groups, areas, sexCount, talkSex, slots, byKind, talks: n, front, students: sEvents(s) };
}
function nearestSeat(list, x, y) {
  let best = null, bd = 1.6;
  for (const st of list) { const d = Math.hypot(st.x - x, st.y - y); if (d < bd) { bd = d; best = st; } }
  return best;
}

// 自動整理的「顯著面向」事實，供量化分析表參考
export function facts(s) {
  const st = ptcStats(s);
  const pct = (a) => `${Math.round((a / st.D) * 100)}%`;
  const out = { student: [], space: [], time: [] };
  const visited = st.groups.filter((g) => g.visits);
  if (st.groups.length) {
    const none = st.groups.filter((g) => !g.visits).map((g) => g.name);
    out.student.push(`造訪 ${visited.length} / ${st.groups.length} 組${none.length ? `；未造訪：${none.join('、')}` : ''}。`);
    const top = [...st.groups].sort((a, b) => b.dur - a.dur)[0];
    if (top?.dur) out.student.push(`停留最久：${top.name}（${fmt(top.dur)}，討論 ${top.talks} 次）。`);
  }
  if (st.sexCount.M || st.sexCount.F) out.student.push(`討論對象：男生旁 ${st.talkSex.M} 次、女生旁 ${st.talkSex.F} 次（座位男 ${st.sexCount.M}、女 ${st.sexCount.F} 人）。`);
  const z = st.zones.flat();
  const top = [...z].sort((a, b) => b.dur - a.dur)[0];
  out.space.push(`停留最久的區域：${top.name}（${pct(top.dur)}）；前排（講台側）合計 ${pct(st.front)}。`);
  const empty = z.filter((q) => !q.visits).map((q) => q.name);
  if (empty.length) out.space.push(`未到過的區域：${empty.join('、')}。`);
  for (const sl of st.slots) out.time.push(`${fmt(sl.a)}–${fmt(sl.b)}：移動 ${sl.points} 點、討論 ${sl.talks} 次，多在${sl.top}。`);
  return out;
}

// ---------- 路線圖 SVG ----------
const SEX_COLOR = { M: '#2F6FB3', F: '#C2572B' };
const T_COLOR = '#17262A';
export function mapSVG(s, width, colors, opts = {}) {
  const room = s.ptc.room;
  // 線條與符號一律跟著主題的文字色，深色模式下才看得清楚
  const TC = colors.ink || T_COLOR, BG = colors.bg || '#fff', WARN = colors.warn || '#9A6B00';
  const pad = 14;
  const headH = opts.header ? 56 : 0;
  const legendH = opts.legend === false ? 0 : 66;
  const W = Math.max(300, Math.round(width));
  const u = (W - pad * 2) / room.w;
  const H = Math.round(headH + pad * 2 + room.h * u + legendH);
  const X = (x) => (pad + x * u).toFixed(1), Y = (y) => (headH + pad + y * u).toFixed(1);
  const until = opts.until ?? Infinity;
  const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const p = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif" role="img" aria-label="教師移動路線圖">`);
  p.push(`<defs><marker id="ar" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="${Math.max(5, u / 6)}" markerHeight="${Math.max(5, u / 6)}" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${TC}"/></marker></defs>`);
  p.push(`<rect width="${W}" height="${H}" fill="${colors.bg || '#fff'}"/>`);
  if (opts.header) {
    p.push(`<text x="16" y="26" font-size="17" font-weight="700" fill="${colors.ink}">${esc(s.meta.title || '教師移動')}</text>`);
    p.push(`<text x="16" y="46" font-size="12" fill="${colors.muted}">${esc([s.meta.date, s.meta.className, s.meta.subject, s.meta.teacher && '授課：' + s.meta.teacher, s.meta.observer && '觀課：' + s.meta.observer, '課堂長度 ' + fmt(totalSec(s))].filter(Boolean).join('　'))}</text>`);
  }
  p.push(`<rect x="${X(0)}" y="${Y(0)}" width="${(room.w * u).toFixed(1)}" height="${(room.h * u).toFixed(1)}" fill="none" stroke="${colors.line}" stroke-width="1.5" rx="6"/>`);
  const fs = Math.max(9, Math.min(13, u * 0.42));
  for (const it of room.items) {
    if (it.kind === 'area') {
      p.push(`<rect x="${X(it.x)}" y="${Y(it.y)}" width="${(it.w * u).toFixed(1)}" height="${(it.h * u).toFixed(1)}" fill="${colors.line}" fill-opacity=".35" stroke="${colors.muted}" stroke-dasharray="3 3" rx="4"${opts.edit ? ` data-item="${it.id}"` : ''}/>`);
      p.push(`<text x="${X(it.x + it.w / 2)}" y="${(+Y(it.y + it.h / 2) + fs * 0.35).toFixed(1)}" font-size="${fs}" fill="${colors.muted}" text-anchor="middle" pointer-events="none">${esc(it.label)}</text>`);
    } else {
      p.push(`<rect x="${X(it.x)}" y="${Y(it.y)}" width="${(it.w * u).toFixed(1)}" height="${(it.h * u).toFixed(1)}" fill="${colors.bg || '#fff'}" stroke="${colors.ink}" stroke-width="1.4" rx="3"${opts.edit ? ` data-item="${it.id}"` : ''}/>`);
      it.seats.forEach((st, k) => {
        const sx = it.x + (k % it.sc), sy = it.y + Math.floor(k / it.sc);
        p.push(`<rect x="${X(sx)}" y="${Y(sy)}" width="${u.toFixed(1)}" height="${u.toFixed(1)}" fill="${st.sex ? SEX_COLOR[st.sex] : 'none'}" fill-opacity="${st.sex ? 0.1 : 0}" stroke="${colors.line}" data-seat="${st.id}"/>`);
        p.push(`<text x="${(+X(sx) + 3).toFixed(1)}" y="${(+Y(sy) + fs).toFixed(1)}" font-size="${fs * 0.85}" fill="${colors.ink}" pointer-events="none">${esc(st.label)}</text>`);
        if (st.sex) p.push(`<text x="${X(sx + 0.5)}" y="${(+Y(sy + 0.78)).toFixed(1)}" font-size="${fs * 0.95}" font-weight="700" fill="${SEX_COLOR[st.sex]}" text-anchor="middle" pointer-events="none">${st.sex}</text>`);
      });
      if (it.label && it.seats.length > 1 && !opts.compact) p.push(`<text x="${X(it.x + it.w / 2)}" y="${(+Y(it.y) - 3).toFixed(1)}" font-size="${fs * 0.8}" fill="${colors.muted}" text-anchor="middle" pointer-events="none">${esc(it.label)}</text>`);
    }
  }
  if (opts.selected) {
    const it = room.items.find((x) => x.id === opts.selected);
    if (it) p.push(`<rect x="${(+X(it.x) - 3).toFixed(1)}" y="${(+Y(it.y) - 3).toFixed(1)}" width="${(it.w * u + 6).toFixed(1)}" height="${(it.h * u + 6).toFixed(1)}" fill="none" stroke="${colors.accent || '#0F6E66'}" stroke-width="2.5" rx="5" pointer-events="none"/>`);
  }
  if (!opts.edit) {
    // 學生移動
    const pos = {};
    for (const e of sEvents(s).filter((q) => q.t <= until)) {
      const seat = seatById(room, e.seat);
      if (!seat) continue;
      const from = pos[e.seat] || { x: seat.x, y: seat.y };
      pos[e.seat] = { x: e.x, y: e.y };
      const x1 = +X(from.x), y1 = +Y(from.y), x2 = +X(e.x), y2 = +Y(e.y);
      const col = colors.muted;
      if (e.k === 'direct') {
        const L = Math.hypot(x2 - x1, y2 - y1), n = Math.max(2, Math.floor(L / 9));
        for (let i = 0; i <= n; i++) {
          const cx = x1 + ((x2 - x1) * i) / n, cy = y1 + ((y2 - y1) * i) / n;
          p.push(`<path d="M${(cx - 3).toFixed(1)},${(cy - 3).toFixed(1)} l6,6 m0,-6 l-6,6" stroke="${col}" stroke-width="1.3"/>`);
        }
      } else {
        p.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="1.6" stroke-dasharray="${e.k === 'purpose' ? '7 5' : '1.5 4'}" stroke-linecap="round"/>`);
      }
      p.push(`<rect x="${(x2 - 9).toFixed(1)}" y="${(y2 - 8).toFixed(1)}" width="18" height="16" fill="${colors.bg || '#fff'}" stroke="${col}"/><text x="${x2.toFixed(1)}" y="${(y2 + 4).toFixed(1)}" font-size="10.5" text-anchor="middle" fill="${colors.ink}">${esc(seat.label)}</text>`);
    }
    // 教師移動
    const st = ptcStats(s);
    const pts = st.pts.filter((q) => q.t <= until);
    if (pts.length > 1) {
      const recent = opts.live ? Math.max(0, pts[pts.length - 1].t - 300) : -1;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const fade = opts.live && b.t < recent;
        // 箭頭畫在線段中間（同紙本記法），避免和停留點重疊
        const mx = ((+X(a.x) + +X(b.x)) / 2).toFixed(1), my = ((+Y(a.y) + +Y(b.y)) / 2).toFixed(1);
        p.push(`<path d="M${X(a.x)},${Y(a.y)} L${mx},${my} L${X(b.x)},${Y(b.y)}" fill="none" stroke="${TC}" stroke-opacity="${fade ? 0.28 : 0.9}" stroke-width="2" marker-mid="url(#ar)"><title>${fmt(a.t)} → ${fmt(b.t)}</title></path>`);
      }
    }
    pts.forEach((q, i) => {
      const last = i === pts.length - 1;
      if (q.no) {
        const r = Math.max(8, Math.min(13, u * 0.36));
        p.push(`<circle cx="${X(q.x)}" cy="${Y(q.y)}" r="${r}" fill="${colors.bg || '#fff'}" stroke="${q.k === 'ask' ? WARN : TC}" stroke-width="1.8"><title>${q.no}. ${kindName(q.k)} ${fmt(q.t)}（停留 ${fmt(q.dur)}）</title></circle>`);
        p.push(`<text x="${X(q.x)}" y="${(+Y(q.y) + 4).toFixed(1)}" font-size="${Math.round(r * 0.95)}" font-weight="700" text-anchor="middle" fill="${q.k === 'ask' ? WARN : TC}" pointer-events="none">${q.no}</text>`);
      } else if (q.k === 'watch' || q.k === 'class') {
        p.push(`<rect x="${(+X(q.x) - 5).toFixed(1)}" y="${(+Y(q.y) - 5).toFixed(1)}" width="10" height="10" fill="${q.k === 'class' ? TC : colors.bg || '#fff'}" stroke="${TC}" stroke-width="1.6" transform="rotate(45 ${X(q.x)} ${Y(q.y)})"><title>${kindName(q.k)} ${fmt(q.t)}（停留 ${fmt(q.dur)}）</title></rect>`);
      } else {
        p.push(`<circle cx="${X(q.x)}" cy="${Y(q.y)}" r="2.6" fill="${TC}"/>`);
      }
      if (last && opts.live) p.push(`<circle cx="${X(q.x)}" cy="${Y(q.y)}" r="${Math.max(10, u * 0.4)}" fill="none" stroke="${colors.accent || '#0F6E66'}" stroke-width="3"><animate attributeName="r" values="${Math.max(10, u * 0.4)};${Math.max(14, u * 0.55)};${Math.max(10, u * 0.4)}" dur="1.4s" repeatCount="indefinite"/></circle>`);
      if (i === 0 && !opts.live) p.push(`<text x="${(+X(q.x) + 8).toFixed(1)}" y="${(+Y(q.y) - 8).toFixed(1)}" font-size="11" font-weight="700" fill="${colors.accent || '#0F6E66'}">起點</text>`);
    });
  }
  if (legendH) {
    let ly = +Y(room.h) + 22, lx = 16;
    const item = (svg, label) => {
      const w = 36 + label.length * 12.5 + 18;
      if (lx + w > W - 10) { lx = 16; ly += 22; }
      p.push(svg(lx, ly) + `<text x="${lx + 34}" y="${ly + 4}" font-size="11.5" fill="${colors.ink}">${label}</text>`);
      lx += w;
    };
    item((x, y) => `<line x1="${x}" y1="${y}" x2="${x + 26}" y2="${y}" stroke="${TC}" stroke-width="2" marker-end="url(#ar)"/>`, '教師移動');
    item((x, y) => `<circle cx="${x + 13}" cy="${y}" r="8" fill="${BG}" stroke="${TC}" stroke-width="1.6"/><text x="${x + 13}" y="${y + 4}" font-size="9" font-weight="700" text-anchor="middle" fill="${TC}">1</text>`, '學生—教師討論（順序）');
    item((x, y) => `<rect x="${x + 8}" y="${y - 5}" width="10" height="10" fill="${BG}" stroke="${TC}" stroke-width="1.5" transform="rotate(45 ${x + 13} ${y})"/>`, '停留觀察');
    item((x, y) => `<rect x="${x + 8}" y="${y - 5}" width="10" height="10" fill="${TC}" transform="rotate(45 ${x + 13} ${y})"/>`, '全班講解');
    if (sEvents(s).length) {
      item((x, y) => `<path d="M${x},${y - 3} l6,6 m0,-6 l-6,6 M${x + 10},${y - 3} l6,6 m0,-6 l-6,6 M${x + 20},${y - 3} l6,6 m0,-6 l-6,6" stroke="${colors.muted}" stroke-width="1.3"/>`, '學生直接移動');
      item((x, y) => `<line x1="${x}" y1="${y}" x2="${x + 26}" y2="${y}" stroke="${colors.muted}" stroke-width="1.6" stroke-dasharray="7 5"/>`, '學生有目的的移動');
      item((x, y) => `<line x1="${x}" y1="${y}" x2="${x + 26}" y2="${y}" stroke="${colors.muted}" stroke-width="1.6" stroke-dasharray="1.5 4" stroke-linecap="round"/>`, '學生非目的性的移動');
    }
  }
  p.push('</svg>');
  return p.join('');
}

// ---------- Excel ----------
const ck = (v) => (v ? '☑' : '☐');
export function ptcInfoRows(s) {
  const st = ptcStats(s);
  return [['教室版面', `${s.ptc.room.w} × ${s.ptc.room.h} 格，${allSeats(s.ptc.room).length} 個座位`],
    ['教師移動點數', st.pts.length], ['學生—教師討論次數', st.talks], ['學生移動次數', st.students.length]];
}
export function ptcSheets(XLSX, wb, s, sheet) {
  const st = ptcStats(s);
  const ws = (rows, w, name) => XLSX.utils.book_append_sheet(wb, sheet(XLSX, rows, w), name);
  ws([['序', '課堂時間', '時刻', '類型', '討論編號', '位置', '區域', '停留（秒）', 'x', 'y'],
    ...st.pts.map((q, i) => [i + 1, fmtHMS(q.t), clockHMS(wallTime(s, q.t)), kindName(q.k), q.no || '', q.loc.label, q.zone.name, Math.round(q.dur), +q.x.toFixed(2), +q.y.toFixed(2)])],
  [6, 12, 10, 14, 10, 16, 8, 10, 7, 7], '教師移動');
  if (st.students.length) {
    ws([['序', '課堂時間', '時刻', '學生', '性別', '類型', '目的地'],
      ...st.students.map((e, i) => { const seat = seatById(s.ptc.room, e.seat); return [i + 1, fmtHMS(e.t), clockHMS(wallTime(s, e.t)), seat?.label || '', seat?.sex || '', kindName(e.k), locate(s.ptc.room, e.x, e.y).label]; })],
    [6, 12, 10, 8, 6, 22, 16], '學生移動');
  }
  ws([['區域', '停留（秒）', '停留比例（%）', '到達次數', '討論次數'], ...st.zones.flat().map((z) => [z.name, Math.round(z.dur), Math.round((z.dur / st.D) * 1000) / 10, z.visits, z.talks])], [8, 12, 14, 10, 10], '區域統計');
  ws([['組別／區域', '到達次數', '停留（秒）', '討論次數'], ...st.groups.map((g) => [g.name, g.visits, Math.round(g.dur), g.talks]), ...st.areas.map((a) => [a.name, a.visits, Math.round(a.dur), ''])], [16, 10, 12, 10], '組別統計');
  const a = s.ptc.analysis || {};
  const f = facts(s);
  const m = s.meta;
  ws([
    ['教師移動量化分析表'], [],
    ['授課教師', m.teacher, '任教班級', m.className, '任教領域／科目', m.subject],
    ['觀課人員', m.observer, '教學單元', m.title, '日期', m.date],
    [], ['內容分析'],
    ['一、教師移動有特別顯著處，顯著面向為（可複選）'],
    [`${ck(a.f_student)} (1) 學生（例如移動區偏好在某一位、某一組或某一性別之學生）`], ...f.student.map((x) => ['', '資料：' + x]),
    [`${ck(a.f_space)} (2) 空間（例如移動區偏好在某一方位或組別）`], ...f.space.map((x) => ['', '資料：' + x]),
    [`${ck(a.f_time)} (3) 時間（例如移動發生偏好在某一段教學時段）`], ...f.time.map((x) => ['', '資料：' + x]),
    [`${ck(a.f_other)} (4) 其他：${a.f_other_t || ''}`],
    ['說明', a.f_note || ''], [],
    ['二、教師移動原因（可複選）'],
    [`${ck(a.r_focus)} (1) 教師移動與學生學習專注度有關：${a.r_focus_t || ''}`],
    [`${ck(a.r_design)} (2) 教師移動與教學活動設計有關：${a.r_design_t || ''}`],
    [`${ck(a.r_manage)} (3) 教師移動與班級經營有關：${a.r_manage_t || ''}`],
    [`${ck(a.r_other)} (4) 其他相關原因：${a.r_other_t || ''}`], [],
    ['註：原始觀察記錄請見「教師移動」工作表與路線圖圖片。'],
  ], [60, 40, 12, 14, 14, 14], '量化分析表');
}

// ---------- 範例 ----------
export function samplePTC() {
  const s = newSession('PTC', []);
  s.sample = true;
  s.meta = { ...s.meta, title: '範例：五年二班 自然「植物的身體」', className: '五年二班', subject: '自然', teacher: '王老師', observer: '李老師' };
  const room = makeRoom('open');
  const sx = 'MFMFMMFFMFMFMFFMMFFMMFMF';
  allSeats(room).forEach((st, i) => { const real = room.items.flatMap((it) => it.seats || []).find((q) => q.id === st.id); real.sex = sx[i % sx.length]; });
  s.ptc = { room, student: true, analysis: {} };
  const start = Date.now() - 45 * 60e3;
  s.clock = { startedAt: start, pauses: [], endedAt: start + 40 * 60e3 };
  s.status = 'ended';
  const path = [
    [0, 3, 1.6, 'class'], [180, 7, 1.8, 'move'], [200, 6.2, 5.3, 'talk'], [320, 9.5, 6.5, 'move'], [340, 12.5, 6.6, 'talk'],
    [480, 9, 2.4, 'move'], [500, 3.5, 1.6, 'class'], [760, 6.4, 9.4, 'move'], [780, 5, 9.4, 'talk'], [900, 7.3, 12.5, 'watch'],
    [1000, 10.5, 10.5, 'move'], [1020, 13.8, 10.2, 'talk'], [1140, 14.7, 7.4, 'ask'], [1260, 9.2, 7.3, 'move'], [1290, 2.5, 6.6, 'talk'],
    [1440, 1.6, 3.6, 'watch'], [1560, 9, 3.3, 'move'], [1600, 13.2, 3.6, 'talk'], [1760, 9.4, 8.6, 'watch'], [1900, 6.8, 12.6, 'talk'],
    [2050, 8.8, 9.3, 'move'], [2100, 3.2, 1.6, 'class'],
  ];
  for (const [t, x, y, k] of path) s.events.push({ id: uid(), type: 'tm', t, x, y, k });
  const seatsAll = allSeats(room);
  const sm = [[230, 0, 11, 1.5, 'direct'], [235, 1, 12, 1.5, 'direct'], [600, 9, 16, 1, 'purpose'], [700, 14, 0.5, 4.5, 'aimless'], [1180, 20, 2.5, 13.2, 'purpose'], [1500, 9, seatsAll[9].x, seatsAll[9].y, 'direct']];
  for (const [t, i, x, y, k] of sm) s.events.push({ id: uid(), type: 'sm', t, seat: seatsAll[i].id, x, y, k });
  s.ptc.analysis = { f_space: true, f_note: '前半段多在講台與前方兩組，後方「科學中心」一帶較少到達。', r_design: true, r_design_t: '小組實驗時段巡視較頻繁。' };
  return s;
}
