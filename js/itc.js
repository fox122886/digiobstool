// ITC 間隔時間線標記：設定、記錄畫面、結果頁區塊
// 計時一律以「課堂經過時間」（扣除暫停）計算，倒數不受手機鎖屏或背景節流影響
import {
  ITC_INTERVALS, ITC_MAX_N, ITC_ACTS, ITC_SEAT_ORDERS, ITC_TASKS, uid, fmt, clockHMS, wallTime, isRunning, isPaused,
  samples, itcPos, itcStats, objName, objShort, isSeat, seatOrder, hasRate, actColor,
} from './model.js';

let C; // 由 app.js 注入：state, app, save, toast, esc, vibrate, nowT, parseLabels, ask
export function init(ctx) { C = ctx; }

const esc = (x) => C.esc(x);
const codeIndex = (s, id) => s.codes.findIndex((c) => c.id === id);
const pctText = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const REC_WINDOWS = [2, 3, 5, 10];
const recOptions = (I) => (I > 0 ? REC_WINDOWS.filter((w) => w * 2 <= I) : []);

// ---------- 提示音（Web Audio，第一次需由點擊啟動） ----------
let ac = null;
function unlockAudio() {
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
  } catch (e) { ac = null; }
}
function beep(freq = 880, dur = 0.09, times = 1) {
  const s = C.state.s;
  if (!s?.itc?.sound || !ac || ac.state !== 'running') return;
  const t0 = ac.currentTime + 0.01;
  for (let i = 0; i < times; i++) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    const st = t0 + i * 0.15;
    o.frequency.value = freq;
    o.type = 'sine';
    g.gain.setValueAtTime(0.0001, st);
    g.gain.exponentialRampToValueAtTime(0.3, st + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, st + dur);
    o.connect(g).connect(ac.destination);
    o.start(st);
    o.stop(st + dur + 0.02);
  }
}
const SND = { next: () => beep(880, 0.1), rec: () => beep(660, 0.07, 2), warn: () => beep(520, 0.07) };

// ---------- 設定頁 ----------
function seatDefaults(it) {
  it.seat = it.seat || { rows: 5, cols: 6, empty: [], order: 'snake', from: 'front', labels: {} };
  it.seat.labels = it.seat.labels || {};
  it.seat.empty = it.seat.empty || [];
  return it.seat;
}
const seatCount = (st) => st.rows * st.cols - st.empty.filter((k) => { const [r, c] = k.split(',').map(Number); return r < st.rows && c < st.cols; }).length;
let seatEditMode = 'toggle';

function seatEditor(s) {
  const st = seatDefaults(s.itc);
  const order = seatOrder(st.rows, st.cols, st.empty, st.order, st.from);
  const idx = new Map(order.map((p, i) => [`${p.r},${p.c}`, i]));
  const cells = [];
  for (let r = 0; r < st.rows; r++) {
    for (let c = 0; c < st.cols; c++) {
      const k = `${r},${c}`;
      const i = idx.get(k);
      const lab = st.labels[k];
      cells.push(i == null
        ? `<button type="button" class="seat void" data-act="itc-seat" data-k="${k}" aria-label="第 ${r + 1} 排第 ${c + 1} 個：空位">空</button>`
        : `<button type="button" class="seat" data-act="itc-seat" data-k="${k}" aria-label="第 ${r + 1} 排第 ${c + 1} 個：觀察順序 ${i + 1}${lab ? `，${esc(lab)}` : ''}">
            <b>${esc(lab || String(i + 1))}</b>${lab ? `<small>${i + 1}</small>` : ''}</button>`);
    }
  }
  return `<div class="seat-wrap"><div class="desk">講台</div>
      <div class="seat-grid" style="--cols:${st.cols}">${cells.join('')}</div></div>
    <p class="hint num" id="itc-seatcount">共 ${order.length} 個座位${order.length > ITC_MAX_N ? `（最多 ${ITC_MAX_N} 個，請把部分設為空位）` : ''}</p>`;
}

function layoutBody(s) {
  const it = s.itc;
  if (!isSeat(s)) {
    return `<div class="fields">
        <label class="f" for="itc-n">觀察人數
          <input type="number" id="itc-n" inputmode="numeric" min="1" max="${ITC_MAX_N}" value="${it.labels ? it.labels.length : it.n}" ${it.labels ? 'disabled' : ''}></label>
        <label class="f full" for="itc-labels">座號或代號（選填）
          <input type="text" id="itc-labels" value="${esc((it.labels || []).join(', '))}" placeholder="例如 3, 7, 12, 15；留白則依 1、2、3… 編號"></label>
      </div>
      <p class="hint">依序輪流觀察每一位，全部觀察一次為一輪。填了座號就依填寫順序觀察，人數自動帶入。</p>`;
  }
  const st = seatDefaults(it);
  const num = (id, label, v) => `<label class="f" for="${id}">${label}<select id="${id}">${[...Array(10).keys()].map((i) => `<option value="${i + 1}" ${i + 1 === v ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>`;
  return `<div class="fields two">
      ${num('itc-rows', '排數（前到後）', st.rows)}${num('itc-cols', '每排座位（左到右）', st.cols)}
      <label class="f" for="itc-order">觀察順序<select id="itc-order">${ITC_SEAT_ORDERS.map(([v, l]) => `<option value="${v}" ${v === st.order ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="f" for="itc-from">起點<select id="itc-from">
        <option value="front" ${st.from === 'front' ? 'selected' : ''}>前排（講台側）</option>
        <option value="back" ${st.from === 'back' ? 'selected' : ''}>後排</option></select></label>
    </div>
    <div class="row seat-tools">
      <span class="seg" role="group" aria-label="點座位時">
        <button type="button" data-act="itc-seatmode" data-v="toggle" aria-pressed="${seatEditMode === 'toggle'}">點座位：設為空位</button>
        <button type="button" data-act="itc-seatmode" data-v="label" aria-pressed="${seatEditMode === 'label'}">點座位：填座號</button>
      </span>
    </div>
    <div id="itc-seats">${seatEditor(s)}</div>
    <p class="hint">由教室後方看向講台的方向排列。座位上的數字是觀察順序；填了座號就顯示座號，觀察順序改標在右下角。</p>`;
}

export function setupPanel(s) {
  const it = s.itc;
  const seat = isSeat(s);
  const opts = ITC_INTERVALS.map((v) => `<option value="${v}" ${v === it.interval ? 'selected' : ''}>${v ? `每位 ${v} 秒（自動倒數）` : '手動（每位觀察完按一下）'}</option>`).join('');
  const acts = it.actList || ITC_ACTS;
  return `<section class="panel" id="itc-who">
    <header><h2>觀察對象</h2></header>
    <span class="seg wide" role="group" aria-label="記錄方式">
      <button type="button" data-act="itc-layout" data-v="rotate" aria-pressed="${!seat}">輪播（依序號）</button>
      <button type="button" data-act="itc-layout" data-v="seat" aria-pressed="${seat}">座位表</button>
    </span>
    <div id="itc-layout-body">${layoutBody(s)}</div>
    <p class="hint" id="itc-absent-hint">記錄中點一下本輪進度格${seat ? '或座位' : ''}，可以把學生標記為缺席，之後每一輪自動跳過。</p>
    <p class="err" id="itc-err" hidden></p>
  </section>
  <section class="panel">
    <header><h2>取樣方式</h2></header>
    <div class="fields">
      <label class="f" for="itc-int">取樣間隔<select id="itc-int">${opts}</select></label>
      <label class="f" for="itc-rec">先看後記<select id="itc-rec">${recSelect(it.interval, it.rec)}</select></label>
    </div>
    <label class="row check" for="itc-sound"><input type="checkbox" id="itc-sound" ${it.sound !== false ? 'checked' : ''}>
      <span><b>提示音</b><br><span class="hint">換下一位時「嗶」一聲；倒數最後 3 秒、或進入記錄時段時再提醒。建議戴單耳耳機，記錄中也可以隨時關閉。</span></span></label>
    <p class="hint" id="itc-rec-hint">${recHint(it.interval, it.rec)}</p>
  </section>
  <section class="panel">
    <header><h2>教學活動（選用）</h2></header>
    <label class="row check" for="itc-useacts"><input type="checkbox" id="itc-useacts" ${it.useActs ? 'checked' : ''}>
      <span><b>同時標記教學活動</b><br><span class="hint">記錄畫面多一排活動按鈕，老師換活動時點一下。結果會依活動算出在工作中率，例如講述時與小組活動時的差異。</span></span></label>
    <label class="f" for="itc-acts">活動名稱（用逗號或空白分隔，最多 8 個）
      <input type="text" id="itc-acts" value="${esc(acts.join('、'))}" ${it.useActs ? '' : 'disabled'}></label>
  </section>`;
}

function recSelect(I, rec) {
  const ok = recOptions(I);
  return `<option value="0">不分段（整段都可以選）</option>${ok.map((w) => `<option value="${w}" ${w === rec ? 'selected' : ''}>先看 ${I - w} 秒，最後 ${w} 秒記錄</option>`).join('')}`;
}
function recHint(I, rec) {
  if (!I) return '手動模式：看清楚後點一下類別，就記錄並換下一位。第一次使用建議先用手動，或從每位 10 秒開始。';
  if (rec) return `「先看後記」：每位前 ${I - rec} 秒只觀察、按鈕暫停，最後 ${rec} 秒才選類別，時間到自動記錄。可避免邊看邊改選，讓不同觀課者的標準一致。`;
  return `每位倒數 ${I} 秒，期間點選他的狀態，可以改選；時間到自動記錄並換下一位，沒有選的記為「未記錄」。`;
}

export function readSetup(s) {
  const it = s.itc;
  const interval = parseInt(document.getElementById('itc-int')?.value, 10) || 0;
  const rec = parseInt(document.getElementById('itc-rec')?.value, 10) || 0;
  let n, labels = null, pos = null;
  if (isSeat(s)) {
    const st = seatDefaults(it);
    st.empty = st.empty.filter((k) => { const [r, c] = k.split(',').map(Number); return r < st.rows && c < st.cols; });
    pos = seatOrder(st.rows, st.cols, st.empty, st.order, st.from);
    n = pos.length;
    if (n < 1) return '至少要有一個座位。';
    if (n > ITC_MAX_N) return `座位最多 ${ITC_MAX_N} 個，請把部分座位設為空位。`;
    labels = pos.map((p) => st.labels[`${p.r},${p.c}`] || '');
    if (!labels.some(Boolean)) labels = null;
    // 沒填座號的座位用觀察順序當編號，不可和填了的座號撞號
    const names = pos.map((_, i) => labels?.[i] || String(i + 1));
    const dup = names.find((x, i) => names.indexOf(x) !== i);
    if (dup) return labels?.includes(dup) && names.filter((x) => x === dup).length > 1 && !labels.every(Boolean)
      ? `座號「${dup}」和沒填座號的座位（以觀察順序編為 ${dup}）重複。請把座號補齊，或改用不同代號。`
      : `座號「${dup}」重複了，請檢查。`;
  } else {
    labels = C.parseLabels(document.getElementById('itc-labels')?.value || '');
    n = labels.length || parseInt(document.getElementById('itc-n')?.value, 10);
    if (!Number.isFinite(n) || n < 1 || n > ITC_MAX_N) return `觀察人數請填 1 到 ${ITC_MAX_N}。`;
    if (labels.length && new Set(labels).size !== labels.length) return '座號或代號有重複，請檢查。';
    if (!labels.length) labels = null;
  }
  const useActs = !!document.getElementById('itc-useacts')?.checked;
  const actList = C.parseLabels(document.getElementById('itc-acts')?.value || '').slice(0, 8);
  if (useActs && !actList.length) return '請填至少一個教學活動名稱，或取消「同時標記教學活動」。';
  Object.assign(it, {
    n, labels, pos, interval, rec: recOptions(interval).includes(rec) ? rec : 0,
    sound: !!document.getElementById('itc-sound')?.checked,
    useActs, actList: actList.length ? actList : [...ITC_ACTS], acts: useActs ? actList : null,
    absent: [], actNow: null, cur: { t0: null, sel: null },
  });
  return '';
}

// 設定頁的 input／change
export function onSetupInput(t) {
  const s = C.state.draft;
  const it = s.itc;
  const err = document.getElementById('itc-err');
  if (err) err.hidden = true;
  if (t.id === 'itc-labels') {
    const labels = C.parseLabels(t.value);
    const nEl = document.getElementById('itc-n');
    if (labels.length) { nEl.value = labels.length; nEl.disabled = true; } else nEl.disabled = false;
  }
  if (['itc-rows', 'itc-cols', 'itc-order', 'itc-from'].includes(t.id)) {
    const st = seatDefaults(it);
    const key = { 'itc-rows': 'rows', 'itc-cols': 'cols', 'itc-order': 'order', 'itc-from': 'from' }[t.id];
    st[key] = key === 'rows' || key === 'cols' ? +t.value : t.value;
    document.getElementById('itc-seats').innerHTML = seatEditor(s);
  }
  if (t.id === 'itc-int' || t.id === 'itc-rec') {
    const I = parseInt(document.getElementById('itc-int').value, 10) || 0;
    const recEl = document.getElementById('itc-rec');
    let rec = parseInt(recEl.value, 10) || 0;
    if (!recOptions(I).includes(rec)) rec = 0;
    it.interval = I; it.rec = rec;
    if (t.id === 'itc-int') recEl.innerHTML = recSelect(I, rec);
    recEl.disabled = !recOptions(I).length;
    document.getElementById('itc-rec-hint').textContent = recHint(I, rec);
  }
  if (t.id === 'itc-useacts') {
    it.useActs = t.checked;
    document.getElementById('itc-acts').disabled = !t.checked;
  }
  if (t.id === 'itc-sound') it.sound = t.checked;
}

// 設定頁與記錄畫面中，data-act 以 itc- 開頭、且 app.js 沒有處理的動作
export async function action(act, el) {
  const s = C.state.view === 'setup' ? C.state.draft : C.state.s;
  if (!s) return;
  if (act === 'itc-layout') {
    s.itc.layout = el.dataset.v;
    if (isSeat(s)) seatDefaults(s.itc);
    document.getElementById('itc-layout-body').innerHTML = layoutBody(s);
    C.app.querySelectorAll('[data-act="itc-layout"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === s.itc.layout)));
    const hint = document.getElementById('itc-absent-hint');
    if (hint) hint.textContent = `記錄中點一下本輪進度格${isSeat(s) ? '或座位' : ''}，可以把學生標記為缺席，之後每一輪自動跳過。`;
  } else if (act === 'itc-seatmode') {
    seatEditMode = el.dataset.v;
    C.app.querySelectorAll('[data-act="itc-seatmode"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === seatEditMode)));
  } else if (act === 'itc-seat') {
    const st = seatDefaults(s.itc);
    const k = el.dataset.k;
    const empty = new Set(st.empty);
    if (seatEditMode === 'toggle' || empty.has(k)) {
      if (empty.has(k)) empty.delete(k); else empty.add(k);
      st.empty = [...empty];
    } else {
      const [r, c] = k.split(',').map(Number);
      const v = await promptText(`第 ${r + 1} 排第 ${c + 1} 個座位`, '座號或代號（留白則用觀察順序）', st.labels[k] || '');
      if (v == null) return;
      if (v) st.labels[k] = v.slice(0, 12); else delete st.labels[k];
    }
    document.getElementById('itc-seats').innerHTML = seatEditor(s);
    C.app.querySelector(`[data-act="itc-seat"][data-k="${k}"]`)?.focus();
  } else if (act === 'itc-absent') {
    await toggleAbsent(+el.dataset.obj);
  } else if (act === 'itc-act') {
    setAct(el.dataset.v);
  } else if (act === 'itc-sound') {
    s.itc.sound = !s.itc.sound;
    unlockAudio();
    C.save();
    el.outerHTML = soundBtn(s);
    if (s.itc.sound) SND.next();
    C.toast(s.itc.sound ? '提示音已開啟' : '提示音已關閉');
  }
}

function promptText(title, label, value) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<form class="modal" role="dialog" aria-modal="true" aria-labelledby="pt">
      <h2 id="pt">${esc(title)}</h2>
      <label class="f" for="pt-in">${esc(label)}<input type="text" id="pt-in" maxlength="12" value="${esc(value)}" autocomplete="off"></label>
      <div class="modal-actions"><button type="button" class="btn" data-v="cancel">取消</button><button class="btn primary">確定</button></div></form>`;
    const done = (v) => { wrap.remove(); resolve(v); };
    wrap.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); done(wrap.querySelector('#pt-in').value.trim()); });
    wrap.addEventListener('click', (e) => { if (e.target.dataset?.v === 'cancel' || e.target === wrap) done(null); });
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(null); });
    document.body.appendChild(wrap);
    const inp = wrap.querySelector('#pt-in');
    inp.focus(); inp.select();
  });
}

// ---------- 記錄畫面 ----------
const presentList = (s) => { const ab = new Set(s.itc.absent || []); return [...Array(s.itc.n).keys()].filter((i) => !ab.has(i)); };
const curAct = (s) => { const a = s.events.filter((e) => e.type === 'act'); return a.length ? a[a.length - 1].label : (s.itc.actNow || s.itc.acts?.[0] || null); };

// 自動倒數中目前是「觀察」或「記錄」時段
function phaseOf(s) {
  const I = s.itc.interval, rec = s.itc.rec || 0;
  if (!I || !rec || s.status !== 'recording' || s.itc.cur?.t0 == null) return 'rec';
  return I - (C.nowT() - s.itc.cur.t0) > rec ? 'look' : 'rec';
}

function cellState(s, i, round, obj, sm) {
  const e = sm.find((x) => x.obj === i);
  const c = e && s.codes[codeIndex(s, e.code)];
  const absent = (s.itc.absent || []).includes(i);
  const cls = absent ? 'absent' : e ? (c ? 'done' : 'done none') : i === obj && s.status !== 'ready' ? 'now' : '';
  return { cls, style: c ? `--c:${c.color}` : '', title: `${objName(s, i)}${absent ? '（缺席）' : ''}` };
}

function strip(s) {
  const { round, obj } = itcPos(s);
  const sm = samples(s).filter((e) => e.round === round);
  return Array.from({ length: s.itc.n }, (_, i) => {
    const st = cellState(s, i, round, obj, sm);
    return `<button type="button" class="cell ${st.cls}" style="${st.style}" data-act="itc-absent" data-obj="${i}" title="${esc(st.title)}" aria-label="${esc(st.title)}，點一下可標記或取消缺席">${esc(objShort(s, i))}</button>`;
  }).join('');
}

function seatMap(s) {
  const { round, obj } = itcPos(s);
  const sm = samples(s).filter((e) => e.round === round);
  const st = s.itc.seat;
  const at = new Map((s.itc.pos || []).map((p, i) => [`${p.r},${p.c}`, i]));
  const cells = [];
  for (let r = 0; r < st.rows; r++) {
    for (let c = 0; c < st.cols; c++) {
      const i = at.get(`${r},${c}`);
      if (i == null) { cells.push('<span class="seat void" aria-hidden="true"></span>'); continue; }
      const x = cellState(s, i, round, obj, sm);
      cells.push(`<button type="button" class="seat ${x.cls}" style="${x.style}" data-act="itc-absent" data-obj="${i}" title="${esc(x.title)}" aria-label="${esc(x.title)}，點一下可標記或取消缺席">${esc(objShort(s, i))}</button>`);
    }
  }
  return `<div class="seat-wrap rec"><div class="desk">講台</div><div class="seat-grid" style="--cols:${st.cols}">${cells.join('')}</div></div>`;
}

function actsRow(s) {
  if (!s.itc.acts) return '';
  const now = curAct(s);
  return `<div class="itc-acts" role="group" aria-label="教學活動"><span class="lab">活動</span>${s.itc.acts.map((a) => `<button type="button" class="actchip" data-act="itc-act" data-v="${esc(a)}" aria-pressed="${a === now}" style="--c:${actColor(s, a)}">${esc(a)}</button>`).join('')}</div>`;
}

function buttons(s) {
  const auto = s.itc.interval > 0;
  const sel = s.itc.cur?.sel;
  const locked = !isRunning(s) || phaseOf(s) === 'look';
  const counts = {};
  for (const e of samples(s)) counts[e.code] = (counts[e.code] || 0) + 1;
  return s.codes.map((c, i) => `<button class="code ${auto && sel === c.id ? 'on' : ''}" style="--c:${c.color}" data-act="itc-pick" data-code="${c.id}"
      ${locked ? 'disabled' : ''} aria-pressed="${auto ? String(sel === c.id) : 'false'}">
      <span class="name">${esc(c.label)}</span>
      <span class="meta"><span>${i < 10 ? `<span class="key">${(i + 1) % 10}</span>` : ''}</span><span class="num">${counts[c.id] || 0} 人次</span></span>
    </button>`).join('');
}

function recent(s) {
  const sm = samples(s).slice(-4).reverse();
  if (!sm.length) return '';
  return `<ol class="itc-recent">${sm.map((e) => {
    const c = s.codes[codeIndex(s, e.code)];
    return `<li><span class="num muted">${clockHMS(wallTime(s, e.t))}</span>
      <span>第 ${e.round} 輪 · <b>${esc(objName(s, e.obj))}</b></span>
      <span class="tag" style="${c ? `--c:${c.color}` : ''}">${c ? esc(c.label) : '未記錄'}</span></li>`;
  }).join('')}</ol>`;
}

const SPK = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/>';
function soundBtn(s) {
  const on = s.itc.sound !== false;
  return `<button type="button" class="itc-snd" data-act="itc-sound" aria-pressed="${on}" aria-label="提示音${on ? '開啟中' : '已關閉'}" title="提示音">${SPK}${on
    ? '<path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>'
    : '<path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'}</svg></button>`;
}

function progText(s, obj) {
  const p = presentList(s);
  const k = p.indexOf(obj);
  return `${k < 0 ? '–' : k + 1} / ${p.length}`;
}
function nextName(s, obj) {
  const ab = new Set(s.itc.absent || []);
  for (let j = 1; j <= s.itc.n; j++) { const o = (obj + j) % s.itc.n; if (!ab.has(o)) return objName(s, o); }
  return objName(s, obj);
}

export function body(s) {
  const auto = s.itc.interval > 0;
  const { round, obj } = itcPos(s);
  const ready = s.status === 'ready';
  const rec = s.itc.rec || 0;
  const how = auto
    ? (rec ? `每位 ${s.itc.interval} 秒：前 ${s.itc.interval - rec} 秒只觀察（按鈕暫停），最後 ${rec} 秒選類別，時間到自動記錄並換下一位。`
      : `每位觀察 ${s.itc.interval} 秒，觀察中按下符合的類別，時間到自動記錄並換下一位；沒有按就記為「未記錄」。`)
    : '觀察完一位就按下符合的類別，會立即記錄並換下一位。';
  return `<section class="itc-now ${auto ? 'auto' : 'manual'}" id="itc-now">
      <div class="who">
        <span class="lab">第 <b id="itc-round">${round}</b> 輪 · <span class="num" id="itc-prog">${progText(s, obj)}</span></span>
        <span class="obj" id="itc-obj">${esc(objName(s, obj))}</span>
        <span class="lab">下一位：<span id="itc-next">${esc(nextName(s, obj))}</span></span>
      </div>
      <div class="cd-box">
        <span class="cd num" id="itc-cd">${ready ? (auto ? fmt(s.itc.interval) : '00:00') : ''}</span>
        <span class="lab" id="itc-cd-lab">${auto ? (rec ? '觀察' : '倒數') : '已觀察'}</span>
      </div>
      ${soundBtn(s)}
    </section>
    <div id="itc-map">${isSeat(s) ? seatMap(s) : `<div class="itc-strip" aria-label="本輪進度">${strip(s)}</div>`}</div>
    ${actsRow(s)}
    ${ready ? `<p class="ready-note">按「開始計時」後，${how}${matchMedia('(pointer: fine)').matches ? '電腦上也可以用數字鍵 1–0。' : ''}${s.itc.acts ? '老師換教學活動時，點一下上方的活動按鈕。' : ''}</p>` : ''}
    <div class="grid-codes" id="itc-grid">${buttons(s)}</div>
    <div id="itc-recent-box">${recent(s)}</div>`;
}

export function actionBar(s) {
  if (s.status === 'ready') return `<button class="btn primary lg" data-act="start">開始計時</button>`;
  const auto = s.itc.interval > 0;
  const undo = `<button class="btn narrow" data-act="itc-undo" ${samples(s).length ? '' : 'disabled'} aria-label="復原上一筆">↶ 復原</button>`;
  const end = `<button class="btn danger narrow" data-act="end">結束</button>`;
  if (isPaused(s)) return `<button class="btn primary lg" data-act="resume">繼續</button>${undo}${end}`;
  const next = auto
    ? `<button class="btn narrow" data-act="itc-next" title="不等倒數，立即記錄並換下一位">記錄 ›</button>`
    : `<button class="btn narrow" data-act="itc-next" title="這位無法觀察，記為未記錄">跳過 ›</button>`;
  return `<button class="btn grow" data-act="pause">暫停</button>${undo}${next}${end}`;
}

export function refresh() {
  const s = C.state.s;
  const main = document.getElementById('rec-main');
  if (main) main.innerHTML = body(s);
  const a = document.getElementById('actions');
  if (a) a.innerHTML = actionBar(s);
  lastPhase = null;
  tick();
}

function refreshParts(pop = true) {
  const s = C.state.s;
  const { round, obj } = itcPos(s);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('itc-round', round);
  set('itc-prog', progText(s, obj));
  set('itc-obj', objName(s, obj));
  set('itc-next', nextName(s, obj));
  const g = document.getElementById('itc-grid'); if (g) g.innerHTML = buttons(s);
  const mp = document.getElementById('itc-map'); if (mp) mp.innerHTML = isSeat(s) ? seatMap(s) : `<div class="itc-strip" aria-label="本輪進度">${strip(s)}</div>`;
  const rb = document.getElementById('itc-recent-box'); if (rb) rb.innerHTML = recent(s);
  const u = C.app.querySelector('[data-act="itc-undo"]'); if (u) u.disabled = !samples(s).length;
  document.getElementById('itc-now')?.classList.remove('warn');
  lastPhase = null;
  const now = document.getElementById('itc-obj');
  if (pop && now) { now.classList.remove('pop'); void now.offsetWidth; now.classList.add('pop'); }
}

// 開始計時時呼叫（在使用者點擊的當下，順便啟用音效）
export function onStart(s) {
  s.itc.cur = { t0: 0, sel: null };
  if (s.itc.acts && !s.events.some((e) => e.type === 'act')) s.events.push({ id: uid(), type: 'act', t: 0, label: s.itc.actNow || s.itc.acts[0] });
  unlockAudio();
}
export function onResume() { unlockAudio(); }

function record(code, t) {
  const s = C.state.s;
  const { round, obj } = itcPos(s);
  const e = { id: uid(), type: 'sample', round, obj, code: code || null, t0: s.itc.cur.t0 ?? t, t };
  if (s.itc.acts) e.act = curAct(s);
  s.events.push(e);
  s.itc.cur = { t0: t, sel: null };
}

// 每 250 毫秒呼叫一次：更新倒數；時間到就記錄並換下一位
let lastPhase = null, phaseK = -1, warnedK = -1;
export function tick() {
  const s = C.state.s;
  if (!s || s.mode !== 'ITC' || s.status !== 'recording') return;
  const auto = s.itc.interval > 0;
  const t = C.nowT();
  const cur = s.itc.cur;
  if (cur.t0 == null) cur.t0 = t;
  const cd = document.getElementById('itc-cd');
  if (!auto) { if (cd) cd.textContent = fmt(t - cur.t0); return; }
  const I = s.itc.interval;
  const rec = s.itc.rec || 0;
  if (isRunning(s)) {
    let n = 0;
    while (t - s.itc.cur.t0 >= I) {
      const due = Math.round((s.itc.cur.t0 + I) * 10) / 10;
      if (n >= 2) {
        // 畫面離開太久（例如鎖屏）：不補一長串「未記錄」，直接從現在接續
        s.itc.cur = { t0: t, sel: null };
        C.toast('畫面離開期間沒有取樣，已從這一位接續');
        break;
      }
      record(s.itc.cur.sel, due);
      n++;
    }
    if (n) { C.vibrate(40); SND.next(); C.save(); refreshParts(); }
  }
  const left = Math.max(0, I - (t - s.itc.cur.t0));
  const k = samples(s).length;
  const phase = phaseOf(s);
  const box = document.getElementById('itc-now');
  if (phase !== lastPhase || phaseK !== k) {
    if (rec && isRunning(s) && phase === 'rec' && lastPhase === 'look' && phaseK === k) { SND.rec(); C.vibrate([30, 60, 30]); }
    lastPhase = phase; phaseK = k;
    const g = document.getElementById('itc-grid'); if (g) g.innerHTML = buttons(s);
    box?.classList.toggle('look', rec > 0 && phase === 'look');
    box?.classList.toggle('recph', rec > 0 && phase === 'rec');
    const lab = document.getElementById('itc-cd-lab');
    if (lab) lab.textContent = rec ? (phase === 'look' ? '觀察' : '請記錄') : '倒數';
  }
  if (!rec && I >= 5 && left <= 3 && warnedK !== k && isRunning(s)) { warnedK = k; SND.warn(); }
  if (cd) cd.textContent = fmt(Math.ceil(rec && phase === 'look' ? left - rec : left));
  box?.classList.toggle('warn', !rec && I >= 5 && left <= 3);
}

export function pick(id) {
  const s = C.state.s;
  if (!isRunning(s)) return;
  unlockAudio();
  if (phaseOf(s) === 'look') { C.toast(`先觀察，最後 ${s.itc.rec} 秒再選`); return; }
  if (s.itc.interval > 0) {
    s.itc.cur.sel = s.itc.cur.sel === id ? null : id;
    C.vibrate(10);
    C.save();
    const g = document.getElementById('itc-grid'); if (g) g.innerHTML = buttons(s);
  } else {
    record(id, C.nowT());
    C.vibrate(15);
    C.save();
    refreshParts();
  }
}

export function next() {
  const s = C.state.s;
  if (!isRunning(s)) return;
  const sel = s.itc.interval > 0 ? s.itc.cur.sel : null;
  record(sel, C.nowT());
  C.vibrate(15);
  C.save();
  refreshParts();
  tick();
}

export function undo() {
  const s = C.state.s;
  let i = s.events.length - 1;
  while (i >= 0 && s.events[i].type !== 'sample') i--;
  if (i < 0) return;
  const e = s.events[i];
  s.events.splice(i, 1);
  // 回到被復原的那一位：自動模式重新倒數、並保留原本選的類別
  s.itc.cur = { t0: s.itc.interval > 0 ? C.nowT() : (e.t0 ?? C.nowT()), sel: s.itc.interval > 0 ? e.code : null };
  C.save();
  refreshParts();
  tick();
  const c = s.codes[codeIndex(s, e.code)];
  C.toast(`已復原：第 ${e.round} 輪 ${objName(s, e.obj)}（${c ? c.label : '未記錄'}）`);
}

async function toggleAbsent(i) {
  const s = C.state.s;
  if (s.status === 'ended') return;
  const ab = new Set(s.itc.absent || []);
  const name = objName(s, i);
  if (ab.has(i)) {
    if (!(await C.ask({ title: `${name} 取消缺席？`, body: '之後輪到時會恢復觀察。', ok: '取消缺席' }))) return;
    ab.delete(i);
  } else {
    if (ab.size >= s.itc.n - 1) { C.toast('至少要留一位觀察對象'); return; }
    if (!(await C.ask({ title: `${name} 標記為缺席？`, body: '之後每一輪都會自動跳過，再點一次可以取消。已記錄的資料不受影響。', ok: '標記缺席' }))) return;
    ab.add(i);
  }
  const before = itcPos(s).obj;
  s.itc.absent = [...ab];
  // 目前這一位被標記缺席：重新開始計時下一位
  if (itcPos(s).obj !== before && s.status === 'recording') s.itc.cur = { t0: C.nowT(), sel: null };
  C.save();
  refreshParts(itcPos(s).obj !== before);
  tick();
  C.toast(ab.has(i) ? `${name} 已標記缺席` : `${name} 已取消缺席`);
}

function setAct(label) {
  const s = C.state.s;
  if (!s?.itc.acts || s.status === 'ended') return;
  unlockAudio();
  if (s.status === 'ready') { s.itc.actNow = label; }
  else {
    const t = C.nowT();
    const acts = s.events.filter((e) => e.type === 'act');
    const last = acts[acts.length - 1];
    if (last?.label === label) return;
    // 剛切換不到 5 秒又改：視為修正，不另外切一段
    if (last && t - last.t < 5) { last.label = label; if (acts.length > 1 && acts[acts.length - 2].label === label) s.events.splice(s.events.indexOf(last), 1); }
    else s.events.push({ id: uid(), type: 'act', t, label });
  }
  C.vibrate(10);
  C.save();
  C.app.querySelectorAll('[data-act="itc-act"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === curAct(s))));
}

export function onKey(e, typing) {
  const s = C.state.s;
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return false;
  const d = /^Digit[0-9]$/.test(e.code) ? +e.code.slice(5) : null;
  if (d != null) {
    const c = s.codes[d === 0 ? 9 : d - 1];
    if (c) { pick(c.id); return true; }
  }
  if (e.key === 'Enter' && s.status === 'recording') { next(); return true; }
  return false;
}

// ---------- 結果頁 ----------
export function summaryItems(s) {
  const st = itcStats(s);
  return `<div><dt>觀察人次</dt><dd>${st.total}</dd></div>
    <div><dt>輪數</dt><dd>${st.rounds.length}</dd></div>
    ${hasRate(s) ? `<div><dt>在工作中率</dt><dd>${pctText(st.rate)}</dd></div>` : ''}
    <div><dt>取樣間隔</dt><dd>${s.itc.interval ? `${s.itc.interval} 秒` : '手動'}</dd></div>`;
}

function heatMap(s, st) {
  const seat = s.itc.seat;
  const at = new Map((s.itc.pos || []).map((p, i) => [`${p.r},${p.c}`, i]));
  const rate = hasRate(s);
  const cells = [];
  for (let r = 0; r < seat.rows; r++) {
    for (let c = 0; c < seat.cols; c++) {
      const i = at.get(`${r},${c}`);
      if (i == null) { cells.push('<span class="seat void" aria-hidden="true"></span>'); continue; }
      const o = st.perObj[i];
      let style = '', val = '', dk = false;
      if (!o.total) val = '—';
      else if (rate && o.rate != null) { style = `--a:${Math.round(12 + o.rate * 88)}%`; val = pctText(o.rate); dk = o.rate > 0.55; }
      else {
        const top = s.codes.map((cd) => [cd, o.counts[cd.id]]).sort((a, b) => b[1] - a[1])[0];
        if (top && top[1]) { style = `--c:${top[0].color};--a:85%`; val = `${codeIndex(s, top[0].id) + 1}`; dk = true; }
      }
      const tip = `${o.name}：${o.total} 人次${rate ? `，在工作中率 ${pctText(o.rate)}` : ''}${(s.itc.absent || []).includes(i) ? '（結束時為缺席）' : ''}`;
      cells.push(`<span class="seat heat ${o.total ? '' : 'empty'} ${dk ? 'dk' : ''}" style="${style}" title="${esc(tip)}"><b>${esc(o.name.replace(/ 號$/, ''))}</b><small class="num">${val}</small></span>`);
    }
  }
  return `<section class="panel"><header><h2>座位熱區</h2><span class="hint">${rate ? '顏色越深，在工作中率越高' : '顯示每個座位最常出現的類別編號'}</span></header>
    <div class="seat-wrap heatwrap"><div class="desk">講台</div><div class="seat-grid" style="--cols:${seat.cols}">${cells.join('')}</div></div>
    <p class="hint">議課時請聚焦在教學安排與座位區域的關係，避免據此替個別學生貼標籤。</p></section>`;
}

function actTable(s, st) {
  if (!st.byAct.length) return '';
  const rate = hasRate(s);
  const bar = (a) => {
    const tot = a.total || 1;
    return `<span class="stack">${s.codes.map((c) => (a.counts[c.id] ? `<i style="--c:${c.color};width:${(a.counts[c.id] / tot) * 100}%" title="${esc(c.label)} ${a.counts[c.id]}"></i>` : '')).join('')}${a.none ? `<i class="none" style="width:${(a.none / tot) * 100}%"></i>` : ''}</span>`;
  };
  return `<section class="panel"><header><h2>依教學活動</h2><span class="hint">時間為該活動的累計長度</span></header>
    <div class="tbl-wrap"><table>
      <thead><tr><th>活動</th><th class="n">時間</th><th class="n">人次</th>${rate ? '<th class="n">在工作中率</th>' : ''}<th style="width:34%">類別分布</th></tr></thead>
      <tbody>${st.byAct.map((a) => `<tr><td><span class="dot" style="--c:${actColor(s, a.label)}"></span>${esc(a.label)}${a.times > 1 ? ` <span class="hint">${a.times} 段</span>` : ''}</td>
        <td class="n">${fmt(a.dur)}</td><td class="n">${a.total}</td>${rate ? `<td class="n"><b>${pctText(a.rate)}</b></td>` : ''}<td>${a.total ? bar(a) : ''}</td></tr>`).join('')}</tbody>
    </table></div></section>`;
}

export function resultBody(s) {
  const st = itcStats(s);
  const rate = hasRate(s);
  const max = Math.max(...st.byCode.map((r) => r.pct), st.total ? st.none / st.total : 0, 0.0001);
  const pct = (a) => (st.total ? `${((a / st.total) * 100).toFixed(1)}%` : '—');
  const taskName = Object.fromEntries(ITC_TASKS);
  const legend = s.codes.map((c, i) => `<span><span class="itc-sw" style="--c:${c.color}">${i + 1}</span>${esc(c.label)}</span>`).join('')
    + '<span><span class="itc-sw none">–</span>未記錄</span>';
  const matrix = st.rounds.length ? `<div class="tbl-wrap itc-matrix-wrap"><table class="itc-matrix">
      <thead><tr><th>對象</th>${st.rounds.map((r) => `<th class="n" title="${clockHMS(wallTime(s, r.start))} 開始">${r.round}</th>`).join('')}${rate ? '<th class="n rate">在工作中</th>' : ''}</tr></thead>
      <tbody>${st.perObj.map((o) => `<tr><th scope="row">${esc(o.name)}${(s.itc.absent || []).includes(o.i) ? ' <span class="hint">缺</span>' : ''}</th>${st.rounds.map((r) => {
        const e = r.items.find((x) => x.obj === o.i);
        if (!e) return '<td></td>';
        const ci = codeIndex(s, e.code);
        const c = s.codes[ci];
        const label = `第${r.round}輪 ${o.name}：${c ? c.label : '未記錄'}（${clockHMS(wallTime(s, e.t))}）`;
        return `<td><button class="itc-cell ${c ? '' : 'none'}" style="${c ? `--c:${c.color}` : ''}" data-act="itc-cell" data-id="${e.id}" ${s.sample ? 'disabled' : ''}
          title="${esc(label)}" aria-label="${esc(label)}">${c ? ci + 1 : '–'}</button></td>`;
      }).join('')}${rate ? `<td class="n rate">${pctText(o.rate)}</td>` : ''}</tr>`).join('')}</tbody></table></div>` : '<p class="hint">沒有任何記錄。</p>';

  return `<section class="panel"><header><h2>各類別人次</h2><span class="hint num">共 ${st.total} 人次</span></header>
      <div class="tbl-wrap"><table>
        <thead><tr><th>類別</th><th class="n">人次</th><th class="n">比例</th><th style="width:36%"></th></tr></thead>
        <tbody>${st.byCode.map((r) => `<tr><td><span class="dot" style="--c:${r.code.color}"></span>${esc(r.code.label)}${rate ? ` <span class="hint">${taskName[r.code.task || 'skip']}</span>` : ''}</td><td class="n">${r.count}</td>
          <td class="n">${pct(r.count)}</td><td class="bar-cell"><span style="--c:${r.code.color};width:${(r.pct / max) * 100}%"></span></td></tr>`).join('')}
          ${st.none ? `<tr><td><span class="dot none"></span>未記錄</td><td class="n">${st.none}</td><td class="n">${pct(st.none)}</td><td></td></tr>` : ''}
        </tbody></table></div>
      ${rate ? `<p class="hint">在工作中率＝「在工作中」÷（「在工作中」＋「不在工作中」），「不計入」與未記錄不列入。全課為 <b>${pctText(st.rate)}</b>。</p>` : ''}</section>
    ${actTable(s, st)}
    ${isSeat(s) ? heatMap(s, st) : ''}
    <section class="panel"><header><h2>對象 × 輪</h2><span class="hint">${s.sample ? '每一格是該位在該輪的類別' : '點格子可以修改該筆記錄'}</span></header>
      <div class="itc-legend">${legend}</div>
      ${matrix}</section>
    <section class="panel"><details><summary>各輪明細</summary>
      <div class="tbl-wrap"><table>
        <thead><tr><th>輪</th><th class="n">時刻</th>${s.itc.acts ? '<th>活動</th>' : ''}${s.codes.map((c, i) => `<th class="n" title="${esc(c.label)}">${i + 1}</th>`).join('')}<th class="n">未記錄</th><th class="n">小計</th>${rate ? '<th class="n">在工作中</th>' : ''}</tr></thead>
        <tbody>${st.rounds.map((r) => `<tr><td>${r.round}${r.complete ? '' : ' <span class="hint">未滿</span>'}</td>
          <td class="n">${clockHMS(wallTime(s, r.start))}–${clockHMS(wallTime(s, r.end))}</td>${s.itc.acts ? `<td>${esc(r.act)}</td>` : ''}
          ${s.codes.map((c) => `<td class="n">${r.counts[c.id] || ''}</td>`).join('')}<td class="n">${r.none || ''}</td><td class="n">${r.size}</td>${rate ? `<td class="n">${pctText(r.rate)}</td>` : ''}</tr>`).join('')}</tbody>
      </table></div></details></section>`;
}

// 修改一筆記錄的類別
export function editCell(id) {
  const s = C.state.s;
  const e = s.events.find((x) => x.id === id);
  if (!e) return Promise.resolve(false);
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    const cur = e.code;
    wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="pt">
      <h2 id="pt">第 ${e.round} 輪 · ${esc(objName(s, e.obj))}</h2>
      <p class="hint">記錄於 ${clockHMS(wallTime(s, e.t))}${e.act ? `（${esc(e.act)}）` : ''}，請選擇正確的類別。</p>
      <div class="itc-pick">${s.codes.map((c, i) => `<button class="btn ${c.id === cur ? 'primary' : ''}" data-v="${c.id}"><span class="itc-sw" style="--c:${c.color}">${i + 1}</span>${esc(c.label)}</button>`).join('')}
        <button class="btn ${cur ? '' : 'primary'}" data-v=""><span class="itc-sw none">–</span>未記錄</button></div>
      <div class="modal-actions"><button class="btn" data-v="cancel">取消</button></div></div>`;
    const done = (v) => {
      wrap.remove();
      document.removeEventListener('keydown', onKey);
      if (v === 'cancel' || v === undefined) return resolve(false);
      e.code = v || null;
      e.edited = Date.now();
      resolve(true);
    };
    const onKey = (ev) => { if (ev.key === 'Escape') done('cancel'); };
    wrap.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-v]');
      if (b) done(b.dataset.v);
      else if (ev.target === wrap) done('cancel');
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    wrap.querySelector('.btn.primary')?.focus();
  });
}

export function homeCount(s) {
  const st = itcStats(s);
  return `${s.itc.n} 位對象、${st.rounds.length} 輪${hasRate(s) && st.total ? `、在工作中 ${pctText(st.rate)}` : ''}`;
}

export function taskSelect(c, i) {
  return `<select class="task" data-field="task" data-i="${i}" aria-label="「${esc(c.label)}」計算在工作中率時" title="計算在工作中率時的歸屬">
    ${ITC_TASKS.map(([v, l]) => `<option value="${v}" ${(c.task || 'skip') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
}
