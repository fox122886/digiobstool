// PTC 教師移動：設定（教室版面編輯）、記錄（點教室圖）、結果（路線圖、量化分析表）
import { uid, fmt, clockHMS, wallTime, isRunning, isPaused } from './model.js';
import {
  TEACHER_KINDS, STUDENT_KINDS, ROOM_TEMPLATES, makeRoom, allSeats, seatById, locate, kindName,
  tEvents, sEvents, ptcStats, facts, mapSVG, groupName,
} from './ptcmodel.js';

let C; // app.js 注入：state, app, save, toast, esc, vibrate, nowT, ask, themeColors
export function init(ctx) { C = ctx; }
const esc = (x) => C.esc(x);
const cur = () => (C.state.view === 'setup' ? C.state.draft : C.state.s);

// SVG 座標換算成「格」
function toGrid(svg, ev, room, headH = 0) {
  const r = svg.getBoundingClientRect();
  const W = svg.viewBox.baseVal.width;
  const k = r.width / W;
  const u = (W - 28) / room.w;
  return { x: ((ev.clientX - r.left) / k - 14) / u, y: ((ev.clientY - r.top) / k - 14 - headH) / u };
}

// ---------- 設定：教室版面 ----------
let emode = 'move';
let selected = null;
let drag = null;

function editorSVG(s) {
  const box = document.getElementById('ptc-editor');
  const w = Math.min(box?.clientWidth || 360, 760);
  return mapSVG(s, w, C.themeColors(), { edit: true, legend: false, selected: emode === 'move' ? selected : null });
}
function drawEditor() {
  const s = cur();
  const box = document.getElementById('ptc-editor');
  if (box) box.innerHTML = editorSVG(s);
  const tools = document.getElementById('ptc-tools');
  if (tools) tools.innerHTML = toolsHTML(s);
  const n = document.getElementById('ptc-count');
  if (n) {
    const seats = allSeats(s.ptc.room);
    n.textContent = `${seats.length} 個座位（男 ${seats.filter((x) => x.sex === 'M').length}、女 ${seats.filter((x) => x.sex === 'F').length}）`;
  }
}

function toolsHTML(s) {
  if (emode !== 'move') {
    return `<p class="hint">${emode === 'label' ? '點一下座位，輸入學生的座號或代號。' : '點一下座位切換：男（M）→ 女（F）→ 不標記。標記後，結果會比較老師與男生、女生的討論次數。'}</p>
      ${emode === 'label' ? '<button class="btn sm" data-act="ptc-renumber">依位置重新編號</button>' : ''}`;
  }
  const it = s.ptc.room.items.find((x) => x.id === selected);
  const add = `<div class="row"><button class="btn sm" data-act="ptc-add" data-v="group">＋ 小組桌</button><button class="btn sm" data-act="ptc-add" data-v="desk">＋ 單人座位</button><button class="btn sm" data-act="ptc-add" data-v="area">＋ 區域</button></div>`;
  if (!it) return `<p class="hint">拖動桌子或區域可以移動位置；點一下選取後，可以改名稱、大小或刪除。</p>${add}`;
  const btn = (d, label, aria) => `<button class="btn sm sq" data-act="ptc-size" data-d="${d}" aria-label="${aria}">${label}</button>`;
  const size = it.kind === 'group'
    ? `<span class="lab">人數</span>${btn('n-', '−', '少一人')}<span class="num">${it.seats.length} 人</span>${btn('n+', '＋', '多一人')}</div>
      <div class="row ptc-size"><span class="lab">排成</span>${btn('sr-', '−', '少一排')}<span class="num">${it.sr} 排</span>${btn('sr+', '＋', '多一排')}<span class="hint">${it.seats.length % it.sr ? '人數不整齊時，最後一格留空' : ''}</span>`
    : `<span class="lab">寬</span>${btn('w-', '−', '變窄')}<span class="num">${it.w} 格</span>${btn('w+', '＋', '變寬')}</div>
      <div class="row ptc-size"><span class="lab">深</span>${btn('h-', '−', '變淺')}<span class="num">${it.h} 格</span>${btn('h+', '＋', '變深')}`;
  return `<div class="ptc-sel">
      <label class="f" for="ptc-name">${it.kind === 'area' ? '區域名稱' : '桌名（例如 第 1 組）'}<input type="text" id="ptc-name" value="${esc(it.label)}" maxlength="12"></label>
      <div class="row ptc-size">${size}</div>
      <div class="row ptc-size"><span class="lab">位置</span>${btn('x-', '←', '往左')}${btn('y-', '↑', '往前')}${btn('y+', '↓', '往後')}${btn('x+', '→', '往右')}
        <button class="btn sm danger" data-act="ptc-del" style="margin-left:auto">刪除</button></div>
    </div>${add}`;
}

export function setupPanel(s) {
  const room = s.ptc.room;
  const opt = (v, max) => Array.from({ length: max - 7 }, (_, i) => i + 8).map((n) => `<option value="${n}" ${n === v ? 'selected' : ''}>${n}</option>`).join('');
  return `<section class="panel" id="ptc-room">
    <header><h2>教室版面</h2><span class="hint num" id="ptc-count"></span></header>
    <div class="row">
      <label class="f" for="ptc-tpl" style="flex:1">範本<select id="ptc-tpl">${ROOM_TEMPLATES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
      <button class="btn sm" data-act="ptc-tpl" style="align-self:flex-end">套用範本</button>
    </div>
    <div class="fields two">
      <label class="f" for="ptc-w">教室寬（格）<select id="ptc-w">${opt(room.w, 24)}</select></label>
      <label class="f" for="ptc-h">教室深（格）<select id="ptc-h">${opt(room.h, 24)}</select></label>
    </div>
    <span class="seg wide" role="group" aria-label="點教室圖時">
      <button type="button" data-act="ptc-emode" data-v="move" aria-pressed="${emode === 'move'}">移動與調整</button>
      <button type="button" data-act="ptc-emode" data-v="label" aria-pressed="${emode === 'label'}">座號</button>
      <button type="button" data-act="ptc-emode" data-v="sex" aria-pressed="${emode === 'sex'}">性別</button>
    </span>
    <div class="ptc-editor" id="ptc-editor"></div>
    <div id="ptc-tools"></div>
    <p class="hint">由教室後方看向講台的方向排列（講台在上方）。一格約一個座位大小。版面會自動記住，下次同一個班可以直接沿用。</p>
    <p class="err" id="ptc-err" hidden></p>
  </section>
  <section class="panel">
    <header><h2>記錄方式</h2></header>
    <p class="hint">記錄時，老師走到哪裡就在教室圖上點哪裡，路線會依序連起來。點完可以選這一點是「經過、停留觀察、全班講解、與學生討論、學生主動詢問」；討論與詢問會依序編號 ①②③。</p>
    <label class="row check" for="ptc-student"><input type="checkbox" id="ptc-student" ${s.ptc.student ? 'checked' : ''}>
      <span><b>同時記錄學生移動</b><br><span class="hint">記錄畫面多一個「學生」切換：先點學生座位、再點他去的地方，並選擇直接移動、有目的的移動或非目的性的移動。一人同時記錄老師與學生負擔較重，也可以兩位觀課者分工。</span></span></label>
  </section>`;
}

// 設定頁畫好後掛上拖動事件
export function mountSetup() {
  drawEditor();
  const box = document.getElementById('ptc-editor');
  if (!box) return;
  box.addEventListener('pointerdown', (ev) => {
    const s = cur();
    const svg = box.querySelector('svg');
    if (!svg) return;
    const g = toGrid(svg, ev, s.ptc.room);
    const loc = locate(s.ptc.room, g.x, g.y);
    const it = loc.near ? null : (loc.group || loc.area);
    if (emode !== 'move') {
      if (!loc.seat) return;
      ev.preventDefault();
      if (emode === 'sex') {
        loc.seat.sex = { '': 'M', M: 'F', F: '' }[loc.seat.sex || ''];
        drawEditor();
      } else {
        promptText('座號或代號', loc.seat.label).then((v) => { if (v != null) { loc.seat.label = v.slice(0, 6); drawEditor(); } });
      }
      return;
    }
    selected = it?.id || null;
    if (it) { drag = { id: it.id, ox: g.x - it.x, oy: g.y - it.y, moved: false }; box.setPointerCapture(ev.pointerId); ev.preventDefault(); }
    drawEditor();
  });
  box.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const s = cur();
    const svg = box.querySelector('svg');
    const g = toGrid(svg, ev, s.ptc.room);
    const it = s.ptc.room.items.find((x) => x.id === drag.id);
    const nx = Math.max(0, Math.min(s.ptc.room.w - it.w, Math.round(g.x - drag.ox)));
    const ny = Math.max(0, Math.min(s.ptc.room.h - it.h, Math.round(g.y - drag.oy)));
    if (nx !== it.x || ny !== it.y) { it.x = nx; it.y = ny; drag.moved = true; box.innerHTML = editorSVG(s); }
  });
  const end = () => { drag = null; };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
}

function promptText(title, value) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<form class="modal" role="dialog" aria-modal="true" aria-labelledby="pt"><h2 id="pt">${esc(title)}</h2>
      <input type="text" id="pt-in" maxlength="6" value="${esc(value)}" autocomplete="off" aria-label="${esc(title)}">
      <div class="modal-actions"><button type="button" class="btn" data-v="cancel">取消</button><button class="btn primary">確定</button></div></form>`;
    const done = (v) => { wrap.remove(); resolve(v); };
    wrap.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); done(wrap.querySelector('#pt-in').value.trim()); });
    wrap.addEventListener('click', (e) => { if (e.target.dataset?.v === 'cancel' || e.target === wrap) done(null); });
    document.body.appendChild(wrap);
    const i = wrap.querySelector('#pt-in'); i.focus(); i.select();
  });
}

export function readSetup(s) {
  const room = s.ptc.room;
  room.items = room.items.filter((it) => it.x < room.w && it.y < room.h);
  for (const it of room.items) { it.x = Math.min(it.x, room.w - it.w); it.y = Math.min(it.y, room.h - it.h); }
  s.ptc.student = !!document.getElementById('ptc-student')?.checked;
  if (!room.items.length) return '教室裡至少要有一張桌子或一個區域。';
  const labels = allSeats(room).map((x) => x.label).filter(Boolean);
  const dup = labels.find((x, i) => labels.indexOf(x) !== i);
  if (dup) return `座號「${dup}」重複了，請檢查。`;
  return '';
}

export function onInput(t) {
  const s = cur();
  if (!s?.ptc) return;
  const room = s.ptc.room;
  if (t.id === 'ptc-replay') { replay(+t.value); return; }
  if (t.id === 'ptc-w' || t.id === 'ptc-h') {
    room[t.id === 'ptc-w' ? 'w' : 'h'] = +t.value;
    for (const it of room.items) { it.x = Math.max(0, Math.min(it.x, room.w - it.w)); it.y = Math.max(0, Math.min(it.y, room.h - it.h)); }
    drawEditor();
  } else if (t.id === 'ptc-name') {
    const it = room.items.find((x) => x.id === selected);
    if (it) { it.label = t.value.trim(); const box = document.getElementById('ptc-editor'); if (box) box.innerHTML = editorSVG(s); }
  } else if (t.dataset.ptcA) {
    s.ptc.analysis = s.ptc.analysis || {};
    s.ptc.analysis[t.dataset.ptcA] = t.type === 'checkbox' ? t.checked : t.value;
    if (!s.sample) C.save();
  } else if (t.dataset.ptcKind) {
    const e = s.events.find((x) => x.id === t.dataset.ptcKind);
    if (e) { e.k = t.value; if (!s.sample) C.save(); C.rerender(); }
  }
}

function sizeItem(it, d, room) {
  const k = d.slice(0, -1), up = d.endsWith('+');
  if (k === 'n' || k === 'sr') {
    // 人數 1–12、排數 1–4；每排的位置數自動算，人數不整齊時最後一格留空
    let n = it.seats.length, sr = it.sr;
    if (k === 'n') n = Math.max(1, Math.min(12, n + (up ? 1 : -1)));
    else sr = Math.max(1, Math.min(4, n, sr + (up ? 1 : -1)));
    sr = Math.min(sr, n);
    if (n === it.seats.length && sr === it.sr) return;
    const old = it.seats;
    let next = Math.max(0, ...allSeats(room).map((x) => +x.label || 0));
    it.seats = Array.from({ length: n }, (_, i) => old[i] || { id: uid(), label: String(++next), sex: '' });
    it.sr = sr; it.sc = Math.ceil(n / sr); it.w = it.sc; it.h = it.sr;
  } else if (k === 'w' || k === 'h') it[k] = Math.max(1, Math.min(room[k] , it[k] + (up ? 1 : -1)));
  else it[k] += up ? 1 : -1;
  it.x = Math.max(0, Math.min(it.x, room.w - it.w));
  it.y = Math.max(0, Math.min(it.y, room.h - it.h));
}

// ---------- 記錄 ----------
let who = 'teacher';
let pickSeat = null;
let lastSKind = 'purpose';

export function body(s) {
  const ready = s.status === 'ready';
  return `${s.ptc.student ? `<span class="seg wide ptc-who" role="group" aria-label="現在記錄">
      <button type="button" data-act="ptc-who" data-v="teacher" aria-pressed="${who === 'teacher'}">記錄教師</button>
      <button type="button" data-act="ptc-who" data-v="student" aria-pressed="${who === 'student'}">記錄學生</button></span>` : ''}
    <div class="ptc-map" id="ptc-map"></div>
    <div class="ptc-bar" id="ptc-bar">${barHTML(s)}</div>
    ${ready ? '<p class="ready-note">按「開始計時」後，老師走到哪裡就在教室圖上點哪裡。點完可在下方選這一點的類型；預設是「經過」。</p>' : ''}`;
}

function barHTML(s) {
  if (who === 'student' && s.ptc.student) {
    if (pickSeat) {
      const seat = seatById(s.ptc.room, pickSeat);
      return `<p><b>${esc(seat?.label)} 號${seat?.sex ? `（${seat.sex}）` : ''}</b>：請點他移動到的地方 <button class="btn sm" data-act="ptc-cancel">取消</button></p>`;
    }
    const last = sEvents(s).slice(-1)[0];
    const lastIsNewest = last && last === s.events.filter((e) => e.type === 'tm' || e.type === 'sm').slice(-1)[0];
    return `<p class="hint">先點要移動的學生座位，再點他去的地方。學生回座位時，點他的座位再點一次座位。</p>
      ${lastIsNewest ? `<div class="ptc-kinds" role="group" aria-label="上一筆學生移動的類型">${STUDENT_KINDS.map(([k, l]) => `<button type="button" class="chip" data-act="ptc-skind" data-k="${k}" aria-pressed="${last.k === k}">${l}</button>`).join('')}</div>` : ''}`;
  }
  const tm = tEvents(s);
  const last = tm[tm.length - 1];
  if (!last) return '<p class="hint">還沒有記錄。</p>';
  const st = ptcStats(s);
  const p = st.pts[st.pts.length - 1];
  return `<p class="num"><b>${fmt(last.t)}</b> · ${esc(p.loc.label)} · 第 ${tm.length} 點${st.talks ? ` · 討論 ${st.talks} 次` : ''}</p>
    <div class="ptc-kinds" role="group" aria-label="這一點的類型">${TEACHER_KINDS.map(([k, l]) => `<button type="button" class="chip" data-act="ptc-kind" data-k="${k}" aria-pressed="${last.k === k}">${l}${k === 'talk' || k === 'ask' ? ' ①' : ''}</button>`).join('')}</div>`;
}

function drawMap() {
  const s = C.state.s;
  const box = document.getElementById('ptc-map');
  if (!box || !s) return;
  box.innerHTML = mapSVG(s, Math.min(box.clientWidth || 360, 900), C.themeColors(), { legend: false, live: true, compact: box.clientWidth < 420 });
  if (pickSeat) {
    const el = box.querySelector(`[data-seat="${pickSeat}"]`);
    if (el) { el.setAttribute('fill', 'var(--accent)'); el.setAttribute('fill-opacity', '.45'); }
  }
}
function drawBar() { const b = document.getElementById('ptc-bar'); if (b) b.innerHTML = barHTML(C.state.s); }

export function actionBar(s) {
  if (s.status === 'ready') return `<button class="btn primary lg" data-act="start">開始計時</button>`;
  const can = s.events.some((e) => e.type === 'tm' || e.type === 'sm');
  const undo = `<button class="btn narrow" data-act="ptc-undo" ${can ? '' : 'disabled'} aria-label="復原上一點">↶ 復原</button>`;
  if (isPaused(s)) return `<button class="btn primary lg" data-act="resume">繼續</button>${undo}<button class="btn danger narrow" data-act="end">結束</button>`;
  return `<button class="btn grow" data-act="pause">暫停</button>${undo}<button class="btn danger narrow" data-act="end">結束</button>`;
}

export function refresh() {
  const s = C.state.s;
  const main = document.getElementById('rec-main');
  if (main) main.innerHTML = body(s);
  const a = document.getElementById('actions');
  if (a) a.innerHTML = actionBar(s);
  mountRecord();
}

let mapBound = false;
export function mountRecord() {
  drawMap();
  const box = document.getElementById('ptc-map');
  if (!box || box.dataset.bound) return;
  box.dataset.bound = '1';
  let down = null;
  box.addEventListener('pointerdown', (ev) => { down = { x: ev.clientX, y: ev.clientY }; });
  box.addEventListener('pointerup', (ev) => {
    if (!down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 12) { down = null; return; }
    down = null;
    const svg = box.querySelector('svg');
    if (svg) tap(toGrid(svg, ev, C.state.s.ptc.room));
  });
  if (!mapBound) {
    mapBound = true;
    window.addEventListener('resize', () => { if (C.state.view === 'record' && C.state.s?.mode === 'PTC') drawMap(); });
  }
}

function tap(g) {
  const s = C.state.s;
  const room = s.ptc.room;
  if (g.x < 0 || g.y < 0 || g.x > room.w || g.y > room.h) return;
  if (!isRunning(s)) { C.toast(s.status === 'ready' ? '請先按「開始計時」' : '暫停中，按「繼續」後再記錄'); return; }
  const t = C.nowT();
  if (who === 'student' && s.ptc.student) {
    const loc = locate(room, g.x, g.y);
    if (!pickSeat) {
      if (!loc.seat) { C.toast('請先點要移動的學生座位'); return; }
      pickSeat = loc.seat.id;
      C.vibrate(10);
    } else {
      const seat = seatById(room, pickSeat);
      const back = loc.seat?.id === pickSeat;
      s.events.push({ id: uid(), type: 'sm', t, seat: pickSeat, x: back ? seat.x : +g.x.toFixed(2), y: back ? seat.y : +g.y.toFixed(2), k: back ? 'direct' : lastSKind });
      pickSeat = null;
      C.vibrate(15);
      C.save();
    }
  } else {
    s.events.push({ id: uid(), type: 'tm', t, x: +g.x.toFixed(2), y: +g.y.toFixed(2), k: 'move' });
    C.vibrate(12);
    C.save();
  }
  drawMap(); drawBar(); syncUndo();
}
function syncUndo() { const u = C.app.querySelector('[data-act="ptc-undo"]'); if (u) u.disabled = !C.state.s.events.some((e) => e.type === 'tm' || e.type === 'sm'); }

export async function action(act, el) {
  const s = cur();
  if (!s?.ptc) return;
  const room = s.ptc.room;
  if (act === 'ptc-tpl') {
    if (room.items.length && !(await C.ask({ title: '套用範本？', body: '目前的教室版面會被取代。', ok: '套用' }))) return;
    s.ptc.room = makeRoom(document.getElementById('ptc-tpl').value);
    selected = null;
    document.getElementById('ptc-w').value = s.ptc.room.w;
    document.getElementById('ptc-h').value = s.ptc.room.h;
    drawEditor();
  } else if (act === 'ptc-emode') {
    emode = el.dataset.v; selected = null;
    C.app.querySelectorAll('[data-act="ptc-emode"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === emode)));
    drawEditor();
  } else if (act === 'ptc-add') {
    const v = el.dataset.v;
    let next = Math.max(0, ...allSeats(room).map((x) => +x.label || 0));
    const seats = (n) => Array.from({ length: n }, () => ({ id: uid(), label: String(++next), sex: '' }));
    const gn = room.items.filter((x) => x.kind === 'group' && x.seats.length > 1).length + 1;
    const it = v === 'area' ? { id: uid(), kind: 'area', x: 0, y: 0, w: 3, h: 1, label: '新區域' }
      : v === 'desk' ? { id: uid(), kind: 'group', x: 0, y: 0, sr: 1, sc: 1, w: 1, h: 1, label: '', seats: seats(1) }
      : { id: uid(), kind: 'group', x: 0, y: 0, sr: 2, sc: 2, w: 2, h: 2, label: `第 ${gn} 組`, seats: seats(4) };
    room.items.push(it); selected = it.id;
    drawEditor();
    C.toast('已加在左上角，拖到想要的位置');
  } else if (act === 'ptc-size') {
    const it = room.items.find((x) => x.id === selected);
    if (it) { sizeItem(it, el.dataset.d, room); drawEditor(); }
  } else if (act === 'ptc-del') {
    room.items = room.items.filter((x) => x.id !== selected); selected = null; drawEditor();
  } else if (act === 'ptc-renumber') {
    const list = allSeats(room).sort((a, b) => a.y - b.y || a.x - b.x);
    list.forEach((x, i) => { room.items.flatMap((it) => it.seats || []).find((q) => q.id === x.id).label = String(i + 1); });
    drawEditor();
  } else if (act === 'ptc-who') {
    who = el.dataset.v; pickSeat = null;
    C.app.querySelectorAll('[data-act="ptc-who"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === who)));
    drawMap(); drawBar();
  } else if (act === 'ptc-kind') {
    const last = tEvents(s).slice(-1)[0];
    if (last) { last.k = el.dataset.k; C.save(); drawMap(); drawBar(); }
  } else if (act === 'ptc-skind') {
    const last = sEvents(s).slice(-1)[0];
    if (last) { last.k = el.dataset.k; lastSKind = el.dataset.k; C.save(); drawMap(); drawBar(); }
  } else if (act === 'ptc-cancel') {
    pickSeat = null; drawMap(); drawBar();
  } else if (act === 'ptc-undo') {
    let i = s.events.length - 1;
    while (i >= 0 && s.events[i].type !== 'tm' && s.events[i].type !== 'sm') i--;
    if (i < 0) return;
    const e = s.events.splice(i, 1)[0];
    C.save(); drawMap(); drawBar(); syncUndo();
    C.toast(`已復原：${e.type === 'tm' ? '教師' : '學生'}移動 ${fmt(e.t)}`);
  } else if (act === 'ptc-del-pt') {
    const i = s.events.findIndex((e) => e.id === el.dataset.id);
    if (i >= 0) { s.events.splice(i, 1); if (!s.sample) C.save(); C.rerender(); }
  }
}

// ---------- 結果 ----------
export function summaryItems(s) {
  const st = ptcStats(s);
  const visited = st.groups.filter((g) => g.visits).length;
  return `<div><dt>移動點數</dt><dd>${st.pts.length}</dd></div>
    <div><dt>學生—教師討論</dt><dd>${st.talks} 次</dd></div>
    ${st.groups.length ? `<div><dt>造訪組別</dt><dd>${visited} / ${st.groups.length}</dd></div>` : ''}
    <div><dt>前排停留</dt><dd>${Math.round((st.front / st.D) * 100)}%</dd></div>`;
}

export function homeCount(s) {
  const st = ptcStats(s);
  return `${st.pts.length} 點、討論 ${st.talks} 次`;
}

export function replay(t) {
  const s = C.state.s;
  const box = document.getElementById('tl');
  if (!box) return;
  box.innerHTML = mapSVG(s, box.clientWidth || 600, C.themeColors(), { until: t });
  const lab = document.getElementById('ptc-replay-t');
  if (lab) lab.textContent = t >= ptcStats(s).D ? '全部' : `${fmt(t)}（${clockHMS(wallTime(s, t))}）`;
}

export function resultBody(s) {
  const st = ptcStats(s);
  const f = facts(s);
  const a = s.ptc.analysis || {};
  const dis = s.sample ? 'disabled' : '';
  const cb = (k, label, fs) => `<label class="row check" for="pa-${k}"><input type="checkbox" id="pa-${k}" data-ptc-a="${k}" ${a[k] ? 'checked' : ''} ${dis}><span>${label}${fs?.length ? `<ul class="facts">${fs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</span></label>`;
  const tx = (k, ph) => `<input type="text" class="ptc-a-text" data-ptc-a="${k}" value="${esc(a[k] || '')}" placeholder="${ph}" ${dis}>`;
  const maxZ = Math.max(...st.zones.flat().map((z) => z.dur), 1);
  const pct = (x) => `${Math.round((x / st.D) * 100)}%`;
  return `<section class="panel"><header><h2>時間軸重播</h2><span class="hint num" id="ptc-replay-t">全部</span></header>
      <input type="range" id="ptc-replay" min="0" max="${Math.ceil(st.D)}" step="5" value="${Math.ceil(st.D)}" aria-label="拖動以重播到某個時間點的移動路線">
      <p class="hint">拖動滑桿，路線圖會只顯示到該時間點為止的移動，可以和授課教師一起回顧某一段教學。</p></section>
    <section class="panel"><header><h2>教師移動量化分析表</h2><span class="hint">依教專「工具 6」格式</span></header>
      <p class="hint">下方「資料」由工具依記錄自動整理，供勾選與撰寫時參考；請依客觀具體事實填寫。</p>
      <h3>一、教師移動有特別顯著處，顯著面向為（可複選）</h3>
      ${cb('f_student', '(1) 學生（例如移動區偏好在某一位、某一組或某一性別之學生）', f.student)}
      ${cb('f_space', '(2) 空間（例如移動區偏好在某一方位或組別）', f.space)}
      ${cb('f_time', '(3) 時間（例如移動發生偏好在某一段教學時段）', f.time)}
      ${cb('f_other', '(4) 其他')}${tx('f_other_t', '其他顯著處')}
      <label class="f" for="pa-note" style="margin-top:8px">說明<textarea id="pa-note" data-ptc-a="f_note" rows="3" ${dis}>${esc(a.f_note || '')}</textarea></label>
      <h3>二、教師移動原因（可複選）</h3>
      ${cb('r_focus', '(1) 教師移動與<b>學生學習專注度</b>有關')}${tx('r_focus_t', '說明')}
      ${cb('r_design', '(2) 教師移動與<b>教學活動設計</b>有關')}${tx('r_design_t', '說明')}
      ${cb('r_manage', '(3) 教師移動與<b>班級經營</b>有關')}${tx('r_manage_t', '說明')}
      ${cb('r_other', '(4) 其他相關原因')}${tx('r_other_t', '說明')}
      <p class="hint">匯出的試算表有「量化分析表」工作表，路線圖圖片即「原始觀察記錄」。</p></section>
    <section class="panel"><header><h2>區域分布</h2><span class="hint">教室分成前中後 × 左中右，數字為停留時間比例</span></header>
      <div class="ptc-zones">${st.zones.flat().map((z) => `<div style="--a:${Math.round((z.dur / maxZ) * 85)}%" title="${z.name}：停留 ${fmt(z.dur)}，到達 ${z.visits} 次，討論 ${z.talks} 次">
        <b>${z.name}</b><span class="num">${pct(z.dur)}</span><small>${z.visits} 次${z.talks ? `・討論 ${z.talks}` : ''}</small></div>`).join('')}</div>
      <p class="hint">上方為講台側。顏色越深，停留越久。</p></section>
    ${st.groups.length || st.areas.length ? `<section class="panel"><header><h2>各組與區域</h2></header>
      <div class="tbl-wrap"><table><thead><tr><th>組別／區域</th><th class="n">到達次數</th><th class="n">停留時間</th><th class="n">討論次數</th></tr></thead>
      <tbody>${st.groups.map((g) => `<tr${g.visits ? '' : ' class="muted-row"'}><td>${esc(g.name)}${g.visits ? '' : ' <span class="hint">未造訪</span>'}</td><td class="n">${g.visits}</td><td class="n">${fmt(g.dur)}</td><td class="n">${g.talks}</td></tr>`).join('')}
        ${st.areas.map((x) => `<tr><td>${esc(x.name)} <span class="hint">區域</span></td><td class="n">${x.visits}</td><td class="n">${fmt(x.dur)}</td><td class="n">—</td></tr>`).join('')}</tbody></table></div>
      ${st.sexCount.M || st.sexCount.F ? `<p class="hint">性別：討論時在男生旁 ${st.talkSex.M} 次、女生旁 ${st.talkSex.F} 次（座位男 ${st.sexCount.M}、女 ${st.sexCount.F} 人）。</p>` : ''}</section>` : ''}
    <section class="panel"><header><h2>各時段</h2><span class="hint">課堂平均分成三段</span></header>
      <div class="tbl-wrap"><table><thead><tr><th>時段</th><th class="n">移動點數</th><th class="n">討論次數</th><th>最常停留</th></tr></thead>
      <tbody>${st.slots.map((x) => `<tr><td class="num">${fmt(x.a)}–${fmt(x.b)}</td><td class="n">${x.points}</td><td class="n">${x.talks}</td><td>${x.top}</td></tr>`).join('')}</tbody></table></div></section>
    <section class="panel"><details><summary>教師移動明細（可修改類型或刪除）</summary>
      <div class="tbl-wrap"><table><thead><tr><th class="n">#</th><th class="n">時間</th><th>位置</th><th>類型</th><th class="n">停留</th><th></th></tr></thead>
      <tbody>${st.pts.map((q, i) => `<tr><td class="n">${q.no ? `<b>${q.no}</b>` : i + 1}</td><td class="n">${fmt(q.t)}</td><td>${esc(q.loc.label)}</td>
        <td><select data-ptc-kind="${q.id}" aria-label="第 ${i + 1} 點的類型" ${dis}>${TEACHER_KINDS.map(([k, l]) => `<option value="${k}" ${k === q.k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
        <td class="n">${fmt(q.dur)}</td><td>${s.sample ? '' : `<button class="btn sm" data-act="ptc-del-pt" data-id="${q.id}" aria-label="刪除第 ${i + 1} 點">刪除</button>`}</td></tr>`).join('')}</tbody></table></div>
      ${st.students.length ? `<h3>學生移動</h3><ul class="facts">${st.students.map((e) => { const seat = seatById(s.ptc.room, e.seat); return `<li class="num">${fmt(e.t)}　${esc(seat?.label || '')} 號${seat?.sex ? `（${seat.sex}）` : ''} → ${esc(locate(s.ptc.room, e.x, e.y).label)}　${kindName(e.k)}</li>`; }).join('')}</ul>` : ''}
    </details></section>`;
}
