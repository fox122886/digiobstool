import { store } from './store.js';
import {
  MODES, PALETTE, PRESETS, MAX_CODES, uid, fmt, fmtDur, clockTime, newSession, elapsedSec, isPaused, isRunning,
  codeOf, openCodes, segments, stats, notes, totalSec, displayTitle, sampleSession, APP_VERSION, wallTime, clockHMS,
} from './model.js';
import { timelineSVG, download, timelinePNG, xlsxBlob, jsonBlob, names } from './output.js';

const app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  view: 'home',
  s: null,          // 目前的觀課
  draft: null,      // 設定頁的草稿
  tick: null,
  wake: null,
  editNote: null,
  persistent: true,
};

// ---------- 共用 UI ----------
let toastTimer;
function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

function ask({ title, body = '', ok = '確定', cancel = '取消', danger = false }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="mt">
      <h2 id="mt">${esc(title)}</h2>${body ? `<p class="muted">${esc(body)}</p>` : ''}
      <div class="modal-actions"><button class="btn" data-r="0">${esc(cancel)}</button>
      <button class="btn ${danger ? 'danger solid' : 'primary'}" data-r="1">${esc(ok)}</button></div></div>`;
    const done = (v) => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]');
      if (b) done(b.dataset.r === '1');
      else if (e.target === wrap) done(false);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    wrap.querySelector('[data-r="1"]').focus();
  });
}

// 依序寫入，避免兩次儲存互相覆蓋
let saveChain = Promise.resolve();
function save(s = state.s) {
  if (!s || s.sample) return saveChain;
  s.updatedAt = Date.now();
  const snap = structuredClone(s);
  saveChain = saveChain.then(() => store.put(snap)).catch((err) => toast('儲存失敗：' + (err?.message || err), 5000));
  return saveChain;
}

const vibrate = (ms = 12) => { try { navigator.vibrate?.(ms); } catch (e) { /* 不支援 */ } };

async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !state.wake && document.visibilityState === 'visible') {
      state.wake = await navigator.wakeLock.request('screen');
      state.wake.addEventListener?.('release', () => { state.wake = null; });
    } else if (!on && state.wake) {
      await state.wake.release();
      state.wake = null;
    }
  } catch (e) { state.wake = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.view === 'record' && state.s && isRunning(state.s)) keepAwake(true);
  if (document.visibilityState === 'visible' && state.view === 'record') updateClock();
});

function stopTick() { clearInterval(state.tick); state.tick = null; }
function startTick() { stopTick(); state.tick = setInterval(updateClock, 250); }

// ---------- 首頁 ----------
async function renderHome() {
  state.view = 'home';
  state.s = null;
  stopTick();
  keepAwake(false);
  let list = [];
  try { list = await store.all(); } catch (e) { toast('讀取記錄失敗'); }
  list.sort((a, b) => (b.clock.startedAt || b.createdAt) - (a.clock.startedAt || a.createdAt));
  const unfinished = list.filter((s) => s.status !== 'ended');
  const done = list.filter((s) => s.status === 'ended');

  const item = (s) => {
    const live = s.status !== 'ended';
    const meta = [s.meta.date, clockTime(s.clock.startedAt), live ? (s.status === 'ready' ? '尚未開始' : '進行中') : fmt(totalSec(s))].filter(Boolean).join(' · ');
    const count = [s.mode !== 'ATC' && `${s.codes.length} 個代碼`, s.mode !== 'UTC' && `${notes(s).length} 則記錄`].filter(Boolean).join('、');
    return `<li><button class="item" data-act="open" data-id="${esc(s.id)}">
      <span class="badge ${live ? 'live' : ''}">${s.mode}</span>
      <span class="main"><span class="t">${esc(displayTitle(s))}</span><br><span class="sub num">${esc(meta)} · ${count}</span></span>
      <span aria-hidden="true" class="muted">›</span></button></li>`;
  };

  app.innerHTML = `<div class="wrap">
    <div class="brand">
      <span class="eyebrow">國立臺灣師範大學 · 數位觀課工具 2.0</span>
      <h1>數位觀課工具</h1>
      <p class="muted">可離線使用，每個動作都即時存在這台裝置上。</p>
    </div>
    ${state.persistent ? '' : `<div class="panel" style="border-color:var(--warn)"><p><b>這個瀏覽器無法長期保存資料</b>（可能是無痕模式）。記錄只會留到關閉頁面為止，結束後請立即匯出。</p></div>`}
    ${unfinished.map((s) => `<div class="panel resume"><div class="grow"><b>有一場觀課尚未結束</b><br>
      <span class="small muted">${esc(s.mode)} · ${esc(displayTitle(s))}</span></div>
      <span class="row"><button class="btn sm" data-act="discard" data-id="${esc(s.id)}">捨棄</button>
      <button class="btn rec" data-act="open" data-id="${esc(s.id)}">繼續記錄</button></span></div>`).join('')}
    <section class="modes" aria-label="選擇觀課工具">
      <button class="mode" data-act="new" data-mode="UTC">
        <span class="tag">UTC</span><h2>通用時間線標記</h2>
        <p>用自訂按鈕記錄教學行為的起訖與次數，課後自動算出時間分配。</p>
        <span class="go">開始設定 →</span></button>
      <button class="mode" data-act="new" data-mode="ATC">
        <span class="tag">ATC</span><h2>軼事記錄時間線標記</h2>
        <p>隨時寫下觀察，每則自動標上「開始寫」與「送出」的課堂時間。</p>
        <span class="go">開始設定 →</span></button>
      <button class="mode" data-act="new" data-mode="DTC">
        <span class="tag">DTC</span><h2>質量雙元時間線標記</h2>
        <p>代碼按鈕與文字記錄並用，同時掌握時間分配與質性觀察。</p>
        <span class="go">開始設定 →</span></button>
    </section>
    <section class="panel" aria-labelledby="hist">
      <header><h2 id="hist">觀課記錄</h2><span class="small muted num">${done.length} 場</span></header>
      ${done.length ? `<ul class="list">${done.map(item).join('')}</ul>` : `<div class="empty">
        <p>完成的觀課會列在這裡，可以回頭查看時間軸、編修與匯出。</p>
        <div class="row" style="justify-content:center"><button class="btn sm" data-act="sample" data-mode="UTC">看 UTC 範例結果</button>
        <button class="btn sm" data-act="sample" data-mode="ATC">看 ATC 範例結果</button>
        <button class="btn sm" data-act="sample" data-mode="DTC">看 DTC 範例結果</button></div></div>`}
    </section>
    <section class="row">
      <button class="btn sm" data-act="backup-all" ${list.length ? '' : 'disabled'}>匯出全部備份</button>
      <label class="btn sm" for="imp">匯入備份檔</label>
      <input id="imp" type="file" accept="application/json,.json" hidden>
    </section>
    <footer class="foot">
      <p>國立臺灣師範大學師資培育學院 張民杰教授 計畫。本工具改寫自 Miikka Turkkila 的
        <a href="https://github.com/MTurkkila/LOBS" target="_blank" rel="noopener">LOBS（Lesson OBServation app）</a>（CC BY-NC-SA 4.0），已修改介面、計時方式、資料保存與匯出功能。</p>
      <p>以<a href="https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hant" target="_blank" rel="noopener">創用 CC 姓名標示-非商業性-相同方式分享 4.0</a> 釋出。版本 <span class="num">${APP_VERSION}</span></p>
      <p>觀課記錄常含學生資訊，建議以座號或代稱記錄，不寫全名。</p>
    </footer>
  </div>`;
}

// ---------- 設定頁 ----------
const hasCodes = (s) => s.mode !== 'ATC';
const hasNotes = (s) => s.mode !== 'UTC';

async function startNew(mode) {
  let codes = [];
  if (mode !== 'ATC') {
    const last = await store.getSetting('lastCodes_' + mode);
    codes = (last && last.length ? last : PRESETS[0].codes.map(([label, kind], i) => ({ label, kind, color: PALETTE[i] })))
      .map((c) => ({ ...c }));
  }
  const lastMeta = await store.getSetting('lastMeta', {});
  const s = newSession(mode, codes);
  if (mode !== 'ATC') s.exclusive = !!(await store.getSetting('lastExclusive_' + mode, false));
  s.meta.school = lastMeta.school || '';
  s.meta.observer = lastMeta.observer || '';
  state.draft = s;
  renderSetup();
}

function codesEditor(s) {
  return s.codes.map((c, i) => `<div class="code-row" data-i="${i}">
    <button class="swatch" style="--c:${c.color}" data-act="color" data-i="${i}" aria-label="變更「${esc(c.label)}」的顏色" title="點一下換顏色"></button>
    <input type="text" id="code-${i}" value="${esc(c.label)}" maxlength="20" data-field="label" data-i="${i}" aria-label="代碼 ${i + 1} 名稱" placeholder="代碼名稱">
    <span class="seg" role="group" aria-label="記錄方式">
      <button type="button" data-act="kind" data-kind="duration" data-i="${i}" aria-pressed="${c.kind === 'duration'}">持續</button>
      <button type="button" data-act="kind" data-kind="event" data-i="${i}" aria-pressed="${c.kind === 'event'}">單次</button>
    </span>
    <button class="icon-btn" data-act="del-code" data-i="${i}" aria-label="刪除「${esc(c.label)}」" ${s.codes.length <= 1 ? 'disabled' : ''}>×</button>
  </div>`).join('');
}

function renderSetup() {
  state.view = 'setup';
  const s = state.draft;
  const m = s.meta;
  const field = (key, label, extra = '') => `<label class="f ${extra}" for="m-${key}">${label}
    <input type="${key === 'date' ? 'date' : 'text'}" id="m-${key}" data-meta="${key}" value="${esc(m[key])}"></label>`;
  app.innerHTML = `<div class="wrap">
    <div class="bar"><button class="back" data-act="home">‹ 首頁</button><h1>${s.mode} ${MODES[s.mode].name}</h1></div>
    <section class="panel">
      <header><h2>觀課資訊</h2><span class="hint">都可以留白，之後再補</span></header>
      <div class="fields">
        ${field('title', '標題', 'full')}
        ${field('date', '日期')}${field('school', '學校')}
        ${field('className', '班級')}${field('subject', '科目')}
        ${field('teacher', '授課教師')}${field('observer', '觀課者')}
      </div>
    </section>
    ${hasCodes(s) ? `<section class="panel">
      <header><h2>代碼按鈕</h2><span class="hint num" id="code-count">${s.codes.length} / ${MAX_CODES}</span></header>
      <p class="hint">「持續」按一下開始、再按一下結束，會算出時間長度；「單次」按一下記一次，適合舉手、讚美這類瞬間行為。點色塊可以換顏色。</p>
      <div class="codes-edit" id="codes">${codesEditor(s)}</div>
      <p class="err" id="code-err" hidden></p>
      <div class="row">
        <button class="btn sm" data-act="add-code" ${s.codes.length >= MAX_CODES ? 'disabled' : ''}>＋ 新增代碼</button>
        <label class="f" for="preset" style="flex-direction:row;align-items:center;gap:8px;margin-left:auto">套用
          <select id="preset" style="min-height:36px;width:auto">
            <option value="">選擇範本…</option>
            ${PRESETS.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
          </select></label>
      </div>
      <label class="row" for="exclusive" style="gap:10px;cursor:pointer;align-items:flex-start">
        <input type="checkbox" id="exclusive" ${s.exclusive ? 'checked' : ''} style="width:20px;height:20px;margin-top:3px">
        <span><b>持續代碼互斥</b><br><span class="hint">開啟後，按下一個持續代碼會自動結束其他進行中的持續代碼。適合「同一時間只會有一種行為」的觀察架構。</span></span>
      </label>
      ${s.codes.length > (s.mode === 'DTC' ? 6 : 8) ? `<p class="hint">超過 ${s.mode === 'DTC' ? 6 : 8} 個按鈕時，手機直式畫面需要捲動${s.mode === 'DTC' ? '，文字框會被擠到下方' : ''}，建議改用平板或橫式。</p>` : ''}
    </section>` : ''}
    ${hasNotes(s) ? `<section class="panel">
      <h2>${s.mode === 'DTC' ? '文字記錄' : '記錄方式'}</h2>
      <p class="hint">開始打字的那一刻會自動記下「開始記錄時間」，送出時再記下「送出時間」，不用先按「輸入」。按 Enter 送出，Shift + Enter 換行，Ctrl + ;（分號）插入現在時刻。${s.mode === 'DTC' ? '打字時可用 Alt + 數字鍵 操作代碼按鈕，不必離開文字框。' : ''}</p>
    </section>` : ''}
    <button class="btn primary lg" data-act="to-record">進入記錄畫面</button>
    <p class="hint" style="text-align:center;margin-top:-8px">進入後按「開始計時」才會開始計算課堂時間。</p>
  </div>`;
}

function refreshCodes() {
  const s = state.draft;
  document.getElementById('codes').innerHTML = codesEditor(s);
  document.getElementById('code-count').textContent = `${s.codes.length} / ${MAX_CODES}`;
  const add = app.querySelector('[data-act="add-code"]');
  if (add) add.disabled = s.codes.length >= MAX_CODES;
}

function validateCodes(s) {
  const labels = s.codes.map((c) => c.label.trim());
  if (labels.some((l) => !l)) return '每個代碼都需要名稱。';
  const dup = labels.find((l, i) => labels.indexOf(l) !== i);
  if (dup) return `代碼「${dup}」重複了，請改成不同名稱。`;
  return '';
}

async function toRecord() {
  const s = state.draft;
  if (hasCodes(s)) {
    s.codes.forEach((c) => { c.label = c.label.trim(); });
    const msg = validateCodes(s);
    const el = document.getElementById('code-err');
    if (msg) { el.textContent = msg; el.hidden = false; el.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    await store.setSetting('lastCodes_' + s.mode, s.codes.map(({ label, kind, color }) => ({ label, kind, color })));
    await store.setSetting('lastExclusive_' + s.mode, !!s.exclusive);
  }
  await store.setSetting('lastMeta', { school: s.meta.school, observer: s.meta.observer });
  state.s = s;
  state.draft = null;
  await save(s);
  renderRecord();
}

// ---------- 記錄畫面 ----------
const nowT = () => elapsedSec(state.s);

function stateLabel(s) {
  if (s.status === 'ready') return ['準備中', ''];
  if (isPaused(s)) return ['暫停中', 'pause'];
  return ['記錄中', 'on'];
}

function codeButtons(s) {
  const open = openCodes(s);
  const t = nowT();
  const running = isRunning(s);
  const { taps } = segments(s, t);
  return s.codes.map((c, i) => {
    const on = open.has(c.id);
    const n = c.kind === 'event' ? taps.filter((x) => x.code === c.id).length : s.events.filter((e) => e.code === c.id && e.type === 'on').length;
    const right = c.kind === 'event' ? `×${n}` : (on ? `<span class="live" data-live="${c.id}">${fmt(t - open.get(c.id))}</span>` : (n ? `${n} 次` : '持續'));
    return `<button class="code ${on ? 'on' : ''}" style="--c:${c.color}" data-act="tap" data-code="${c.id}" ${running ? '' : 'disabled'}
      aria-pressed="${c.kind === 'event' ? 'false' : on}">
      <span class="name">${esc(c.label)}</span>
      <span class="meta"><span>${c.kind === 'event' ? '單次' : (on ? '進行中' : '')}${i < 10 ? ` <span class="key">${(i + 1) % 10}</span>` : ''}</span><span class="num">${right}</span></span>
    </button>`;
  }).join('');
}

function feedHTML(s, { editable = true, newestFirst = true } = {}) {
  const list = notes(s).map((n, i) => ({ n, i }));
  if (newestFirst) list.reverse();
  if (!list.length) return `<p class="hint" style="text-align:center;padding:12px">送出的記錄會出現在這裡，可以隨時修改。</p>`;
  return list.map(({ n, i }) => {
    const editing = state.editNote === n.id;
    return `<article class="note" data-id="${n.id}">
      <span class="no">#${i + 1}</span>
      <div class="when"><span>${fmt(n.t0 ?? n.t)} 開始 → ${fmt(n.t)} 送出<span class="muted">（${clockHMS(wallTime(s, n.t))}）</span></span>
        ${editable && !editing ? `<span class="acts"><button class="btn ghost sm" data-act="edit-note" data-id="${n.id}">修改</button>
        <button class="btn ghost sm" data-act="del-note" data-id="${n.id}" style="color:var(--rec)">刪除</button></span>` : ''}</div>
      ${editing ? `<div style="grid-column:2;display:flex;flex-direction:column;gap:6px">
          <textarea id="edit-${n.id}" aria-label="修改記錄 #${i + 1}">${esc(n.text)}</textarea>
          <div class="row"><button class="btn sm primary" data-act="save-note" data-id="${n.id}">儲存</button>
          <button class="btn sm" data-act="cancel-note">取消</button></div></div>`
        : `<p class="txt" style="grid-column:2">${esc(n.text)}</p>`}
    </article>`;
  }).join('');
}

function actionBar(s) {
  if (s.status === 'ready') return `<button class="btn primary lg" data-act="start">開始計時</button>`;
  const canUndo = s.events.some((e) => e.type !== 'note');
  const undo = hasCodes(s) ? `<button class="btn narrow" data-act="undo" ${canUndo ? '' : 'disabled'} aria-label="復原上一個按鈕動作">↶ 復原</button>` : '';
  if (isPaused(s)) return `<button class="btn primary lg" data-act="resume">繼續</button>${undo}<button class="btn danger narrow" data-act="end">結束觀課</button>`;
  return `<button class="btn lg" data-act="pause">暫停</button>${undo}<button class="btn danger narrow" data-act="end">結束觀課</button>`;
}

function renderRecord() {
  state.view = 'record';
  const s = state.s;
  const [label, cls] = stateLabel(s);
  app.innerHTML = `<div class="rec">
    <header class="rec-top"><div class="in">
      <button class="back" data-act="leave">‹ 首頁</button>
      <span class="clock" id="clock" aria-label="課堂經過時間">${fmt(nowT())}</span>
      <span class="state ${cls}" id="state">${label}</span>
      <span class="wall num" id="wall" title="現在時刻">${clockHMS(Date.now())}</span>
      <span class="title">${esc(s.mode)} · ${esc(displayTitle(s))}</span>
    </div></header>
    <main class="rec-main ${s.mode === 'DTC' ? 'dtc' : ''}" id="rec-main">${s.mode === 'UTC' ? utcBody(s) : s.mode === 'ATC' ? atcBody(s) : dtcBody(s)}</main>
    <footer class="rec-bar"><div class="in" id="actions">${actionBar(s)}</div></footer>
  </div>`;
  if (s.status === 'recording') startTick();
  if (isRunning(s)) keepAwake(true);
  if (hasNotes(s)) restoreDraft();
}

function dtcBody(s) {
  const fine = matchMedia('(pointer: fine)').matches;
  return `<div class="dtc-codes">${s.status === 'ready' ? `<p class="ready-note">按下方「開始計時」後，按鈕與文字框就能使用。${fine ? '打字時可用 Alt + 數字鍵 操作按鈕。' : ''}</p>` : ''}
    <div class="grid-codes" id="codes-grid">${codeButtons(s)}</div></div>
    <div class="dtc-notes">${atcBody(s)}</div>`;
}

function utcBody(s) {
  return `${s.status === 'ready' ? `<p class="ready-note">按下方「開始計時」後，按鈕就能使用。${matchMedia('(pointer: fine)').matches ? '電腦上也可以用數字鍵 1–0 操作。' : ''}</p>` : ''}
    <div class="grid-codes" id="codes-grid">${codeButtons(s)}</div>`;
}

function atcBody(s) {
  const disabled = s.status === 'ready';
  return `<section class="composer">
      <textarea id="note-text" placeholder="${disabled ? '按下方「開始計時」後就能記錄' : '寫下你看到的…（Enter 送出，Shift + Enter 換行，Ctrl + ; 插入時刻）'}" ${disabled ? 'disabled' : ''} aria-label="軼事記錄內容"></textarea>
      <div class="row">
        <span class="t0" id="t0"></span>
        <span class="row">
          <button class="btn sm" data-act="stamp" ${disabled ? 'disabled' : ''} title="插入現在時刻（Ctrl + ;）">插入時刻</button>
          <button class="btn sm primary" data-act="send" ${disabled ? 'disabled' : ''}>送出</button>
        </span>
      </div>
    </section>
    <section class="feed" id="feed" aria-label="已送出的記錄">${feedHTML(s)}</section>`;
}

function updateClock() {
  const s = state.s;
  if (!s || state.view !== 'record') return;
  const t = nowT();
  const c = document.getElementById('clock');
  if (c) c.textContent = fmt(t);
  const w = document.getElementById('wall');
  if (w) w.textContent = clockHMS(Date.now());
  if (hasCodes(s)) {
    const open = openCodes(s);
    app.querySelectorAll('[data-live]').forEach((el) => {
      const st = open.get(el.dataset.live);
      if (st != null) el.textContent = fmt(t - st);
    });
  }
}

function refreshRecord() {
  const s = state.s;
  const [label, cls] = stateLabel(s);
  const st = document.getElementById('state');
  st.textContent = label;
  st.className = 'state ' + cls;
  document.getElementById('actions').innerHTML = actionBar(s);
  if (hasCodes(s)) {
    document.getElementById('codes-grid').innerHTML = codeButtons(s);
    const note = app.querySelector('.ready-note');
    if (note && s.status !== 'ready') note.remove();
  }
  if (hasNotes(s)) {
    const ta = document.getElementById('note-text');
    const on = s.status !== 'ready';
    ta.disabled = !on;
    ta.placeholder = on ? '寫下你看到的…（Enter 送出，Shift + Enter 換行，Ctrl + ; 插入時刻）' : '按下方「開始計時」後就能記錄';
    app.querySelectorAll('[data-act="stamp"],[data-act="send"]').forEach((b) => { b.disabled = !on; });
  }
  updateClock();
}

function refreshFeed() {
  const f = document.getElementById('feed');
  if (f) f.innerHTML = feedHTML(state.s);
}

async function startClock() {
  const s = state.s;
  s.clock.startedAt = Date.now();
  s.status = 'recording';
  try { await navigator.storage?.persist?.(); } catch (e) { /* 忽略 */ }
  await save();
  startTick();
  keepAwake(true);
  refreshRecord();
  if (s.mode === 'ATC' || (s.mode === 'DTC' && matchMedia('(pointer: fine)').matches)) document.getElementById('note-text')?.focus();
}

function pause() {
  const s = state.s;
  s.clock.pauses.push([Date.now(), null]);
  save();
  keepAwake(false);
  refreshRecord();
  toast('已暫停，課堂時間停止計算');
}

function resume() {
  const s = state.s;
  const p = s.clock.pauses[s.clock.pauses.length - 1];
  if (p && p[1] == null) p[1] = Date.now();
  save();
  keepAwake(true);
  refreshRecord();
}

async function endSession() {
  const s = state.s;
  const pending = hasNotes(s) && document.getElementById('note-text')?.value.trim();
  const ok = await ask({
    title: '結束這場觀課？',
    body: pending ? '文字框裡還有尚未送出的內容，結束時會自動送出。' : '結束後課堂時間停止，仍可在結果頁修改記錄。',
    ok: '結束觀課', danger: true,
  });
  if (!ok) return;
  if (pending) sendNote();
  const now = Date.now();
  const p = s.clock.pauses[s.clock.pauses.length - 1];
  if (p && p[1] == null) p[1] = now;
  s.clock.endedAt = now;
  const t = elapsedSec(s);
  for (const code of openCodes(s).keys()) s.events.push({ id: uid(), type: 'off', code, t, auto: true });
  s.status = 'ended';
  s.draft = { text: '', t0: null };
  await save();
  stopTick();
  keepAwake(false);
  renderResult();
}

function tapCode(id) {
  const s = state.s;
  if (!isRunning(s)) return;
  const c = codeOf(s, id);
  if (!c) return;
  const t = nowT();
  const batch = uid(); // 同一次按鍵產生的事件，復原時一起撤回
  if (c.kind === 'event') s.events.push({ id: uid(), type: 'tap', code: id, t, batch });
  else {
    const open = openCodes(s);
    const turningOn = !open.has(id);
    if (turningOn && s.exclusive) {
      for (const other of open.keys()) if (other !== id) s.events.push({ id: uid(), type: 'off', code: other, t, batch, auto: true });
    }
    s.events.push({ id: uid(), type: turningOn ? 'on' : 'off', code: id, t, batch });
  }
  vibrate();
  save();
  document.getElementById('codes-grid').innerHTML = codeButtons(s);
  if (c.kind === 'event') app.querySelector(`[data-code="${id}"]`)?.classList.add('flash');
  const undo = app.querySelector('[data-act="undo"]');
  if (undo) undo.disabled = false;
}

function undoLast() {
  const s = state.s;
  // 只復原按鈕動作；文字記錄用「刪除」處理
  let i = s.events.length - 1;
  while (i >= 0 && s.events[i].type === 'note') i--;
  if (i < 0) return;
  const e = s.events[i];
  s.events = s.events.filter((x, k) => k !== i && !(e.batch && x.batch === e.batch));
  const c = codeOf(s, e.code);
  const what = { on: '開始', off: '結束', tap: '記一次' }[e.type];
  save();
  document.getElementById('codes-grid').innerHTML = codeButtons(s);
  app.querySelector('[data-act="undo"]').disabled = !s.events.some((x) => x.type !== 'note');
  toast(`已復原：${c?.label ?? ''} ${what}（${fmt(e.t)}）`);
}

// ATC
let draftTimer;
function setT0(t) {
  state.s.draft.t0 = t;
  const el = document.getElementById('t0');
  if (!el) return;
  el.innerHTML = t == null ? '' : `開始於 <b>${fmt(t)}</b> <button class="btn ghost sm" data-act="reset-t0" title="把開始時間改成現在">改成現在</button>`;
}
function restoreDraft() {
  const s = state.s;
  const ta = document.getElementById('note-text');
  if (!ta) return;
  ta.value = s.draft?.text || '';
  setT0(s.draft?.t0 ?? null);
}
function onNoteInput(ta) {
  const s = state.s;
  const has = ta.value.trim().length > 0;
  if (has && s.draft.t0 == null) setT0(nowT());
  if (!has && s.draft.t0 != null) setT0(null);
  s.draft.text = ta.value;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => save(), 600);
}
function sendNote() {
  const s = state.s;
  const ta = document.getElementById('note-text');
  const text = ta.value.trim();
  if (!text) { toast('請先輸入記錄內容'); ta.focus(); return; }
  const t = nowT();
  s.events.push({ id: uid(), type: 'note', t0: s.draft.t0 ?? t, t, text });
  ta.value = '';
  s.draft = { text: '', t0: null };
  setT0(null);
  clearTimeout(draftTimer);
  save();
  refreshFeed();
  ta.focus();
}
function insertStamp() {
  const ta = document.getElementById('note-text');
  // 時鐘時刻：方便和其他觀課者、錄影檔對照
  const stamp = `[${clockHMS(Date.now())}] `;
  const a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? a;
  ta.value = ta.value.slice(0, a) + stamp + ta.value.slice(b);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = a + stamp.length;
  onNoteInput(ta);
}

// ---------- 結果頁 ----------
function themeColors() {
  return { ink: 'var(--ink)', muted: 'var(--muted)', line: 'var(--line)', accent: 'var(--accent)', bg: 'var(--surface)' };
}

function renderTimeline() {
  const box = document.getElementById('tl');
  if (!box || !state.s) return;
  box.innerHTML = timelineSVG(state.s, box.clientWidth || 600, themeColors());
}

function renderResult() {
  state.view = 'result';
  stopTick();
  const s = state.s;
  const total = totalSec(s);
  const n = names(s);
  const m = s.meta;
  const meta = (key, label, extra = '') => `<label class="f ${extra}" for="r-${key}">${label}
    <input type="${key === 'date' ? 'date' : 'text'}" id="r-${key}" data-rmeta="${key}" value="${esc(m[key])}" ${s.sample ? 'disabled' : ''}></label>`;

  let body = '';
  if (hasCodes(s)) {
    const st = stats(s);
    const max = Math.max(...st.map((r) => r.pct || 0), 0.0001);
    body = `<section class="panel"><header><h2>時間分配</h2><span class="hint">比例以扣除暫停後的課堂長度計算</span></header>
      <div class="tbl-wrap"><table>
      <thead><tr><th>代碼</th><th class="n">次數</th><th class="n">總時長</th><th class="n">占比</th><th class="n">平均每次</th><th style="width:30%"></th></tr></thead>
      <tbody>${st.map((r) => r.code.kind === 'event'
        ? `<tr><td><span class="dot" style="--c:${r.code.color}"></span>${esc(r.code.label)} <span class="hint">單次</span></td><td class="n">${r.count}</td><td class="n" colspan="3">每分鐘 ${r.perMin.toFixed(2)} 次</td><td></td></tr>`
        : `<tr><td><span class="dot" style="--c:${r.code.color}"></span>${esc(r.code.label)}</td><td class="n">${r.count}</td><td class="n">${fmt(r.total)}</td>
          <td class="n">${(r.pct * 100).toFixed(1)}%</td><td class="n">${r.count ? fmt(r.avg) : '—'}</td>
          <td class="bar-cell"><span style="--c:${r.code.color};width:${(r.pct / max) * 100}%"></span></td></tr>`).join('')}</tbody>
      </table></div></section>
      <section class="panel"><details>
        <summary>記錄明細（可刪除誤按）</summary>
        <div class="tbl-wrap" id="detail">${detailTable(s)}</div>
      </details></section>`;
  }
  if (hasNotes(s)) {
    body += `<section class="panel"><header><h2>文字記錄</h2><span class="hint num">${notes(s).length} 則</span></header>
      <div class="feed" id="feed">${feedHTML(s, { editable: !s.sample, newestFirst: false })}</div></section>`;
  }
  const tlHint = { UTC: '色帶是持續行為，菱形是單次標記', ATC: '圓點是送出時間，淡色線段是撰寫時間', DTC: '色帶是持續行為，菱形是單次標記，最下列圓點是文字記錄' }[s.mode];

  app.innerHTML = `<div class="wrap">
    <div class="bar"><button class="back" data-act="home">‹ 首頁</button><h1>${esc(displayTitle(s))}</h1></div>
    ${s.sample ? `<div class="panel" style="border-color:var(--warn);background:var(--warn-soft)"><p><span class="badge sample">範例</span> 這是示範用的假資料，不會存進記錄；可以試試匯出看看格式。</p></div>` : ''}
    <section class="panel">
      <dl class="summary">
        <div><dt>工具</dt><dd>${s.mode}</dd></div>
        <div><dt>課堂長度</dt><dd>${fmt(total)}</dd></div>
        <div><dt>開始時刻</dt><dd>${clockTime(s.clock.startedAt) || '—'}</dd></div>
        ${hasCodes(s) ? `<div><dt>標記次數</dt><dd>${s.events.filter((e) => e.type === 'on' || e.type === 'tap').length}</dd></div>` : ''}
        ${hasNotes(s) ? `<div><dt>記錄則數</dt><dd>${notes(s).length}</dd></div>` : ''}
      </dl>
    </section>
    <section class="panel"><header><h2>時間軸</h2><span class="hint">${tlHint}</span></header>
      <div class="tl" id="tl"></div></section>
    ${body}
    <section class="panel"><header><h2>匯出</h2><span class="hint">檔名只用英數字，任何系統都能正常開啟</span></header>
      <div class="exports">
        <button class="btn exp" data-act="exp-xlsx"><span>Excel 試算表</span><span class="fn">${n.xlsx}</span></button>
        <button class="btn exp" data-act="exp-png"><span>時間軸圖片</span><span class="fn">${n.png}</span></button>
        <button class="btn exp" data-act="exp-json"><span>備份檔（可匯入其他裝置）</span><span class="fn">${n.json}</span></button>
      </div>
      <p class="hint">登入 Google、自動存到個人雲端硬碟的功能會在下一階段加入。</p>
    </section>
    <section class="panel"><details>
      <summary>觀課資訊</summary>
      <div class="fields" style="margin-top:12px">
        ${meta('title', '標題', 'full')}${meta('date', '日期')}${meta('school', '學校')}
        ${meta('className', '班級')}${meta('subject', '科目')}${meta('teacher', '授課教師')}${meta('observer', '觀課者')}
        <label class="f full" for="r-note">備註<textarea id="r-note" data-rmeta="note" ${s.sample ? 'disabled' : ''}>${esc(m.note)}</textarea></label>
      </div></details></section>
    ${s.sample ? '' : `<button class="btn danger" data-act="delete-session" style="align-self:flex-start">刪除這場觀課</button>`}
  </div>`;
  renderTimeline();
}

function detailTable(s) {
  const { segs, taps } = segments(s, totalSec(s));
  const rows = [
    ...segs.map((g) => ({ t: g.start, c: codeOf(s, g.code), html: `${fmt(g.start)} – ${fmt(g.end)}`, len: fmt(g.end - g.start), ids: [g.onId, g.offId].filter(Boolean) })),
    ...taps.map((x) => ({ t: x.t, c: codeOf(s, x.code), html: fmt(x.t), len: '單次', ids: [x.id] })),
  ].sort((a, b) => a.t - b.t);
  if (!rows.length) return '<p class="hint">沒有任何標記。</p>';
  return `<table><thead><tr><th>代碼</th><th class="n">課堂時間</th><th class="n">時刻</th><th class="n">長度</th><th></th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td><span class="dot" style="--c:${r.c?.color}"></span>${esc(r.c?.label)}</td><td class="n">${r.html}</td><td class="n">${clockHMS(wallTime(s, r.t))}</td><td class="n">${r.len}</td>
    <td>${s.sample ? '' : `<button class="btn ghost sm" data-act="del-mark" data-ids="${r.ids.join(',')}" style="color:var(--rec)">刪除</button>`}</td></tr>`).join('')}
  </tbody></table>`;
}

async function exportFile(kind) {
  const s = state.s;
  const n = names(s);
  try {
    if (kind === 'xlsx') download(xlsxBlob(s), n.xlsx);
    else if (kind === 'png') download(await timelinePNG(s), n.png);
    else download(jsonBlob(s), n.json);
    toast(`已匯出 ${n[kind]}`);
  } catch (e) {
    toast('匯出失敗：' + (e?.message || e), 5000);
  }
}

async function importFile(file) {
  try {
    const data = JSON.parse(await file.text());
    const arr = Array.isArray(data) ? data : (Array.isArray(data.sessions) ? data.sessions : [data]);
    const existing = new Set((await store.all()).map((s) => s.id));
    let n = 0;
    for (const s of arr) {
      if (!s || !MODES[s.mode] || !Array.isArray(s.events) || !s.clock || !s.meta) continue;
      if (existing.has(s.id)) s.id = uid();
      delete s.sample;
      if (s.status !== 'ended') s.status = 'ended';
      await store.put(s);
      n++;
    }
    toast(n ? `已匯入 ${n} 場觀課` : '這個檔案不是觀課備份檔');
    renderHome();
  } catch (e) {
    toast('無法讀取這個檔案，請確認是本工具匯出的 .json 備份檔', 5000);
  }
}

// ---------- 事件處理 ----------
const actions = {
  home: () => renderHome(),
  async leave() {
    if (state.s?.status === 'recording') toast('記錄已保存，回到首頁可繼續');
    renderHome();
  },
  new: (el) => startNew(el.dataset.mode),
  async open(el) {
    const s = await store.get(el.dataset.id);
    if (!s) { toast('找不到這場觀課'); return renderHome(); }
    state.s = s;
    s.status === 'ended' ? renderResult() : renderRecord();
  },
  sample(el) { state.s = sampleSession(el.dataset.mode); renderResult(); },
  async discard(el) {
    const s = await store.get(el.dataset.id);
    const has = s && s.events.length > 0;
    if (!(await ask({ title: '捨棄這場未結束的觀課？', body: has ? `裡面已有 ${s.events.length} 筆記錄，捨棄後無法復原。` : '這場觀課還沒有任何記錄。', ok: '捨棄', danger: true }))) return;
    await store.del(el.dataset.id);
    renderHome();
  },
  // 設定頁
  color(el) {
    const c = state.draft.codes[+el.dataset.i];
    const used = new Set(state.draft.codes.map((x) => x.color));
    let k = (PALETTE.indexOf(c.color) + 1) % PALETTE.length;
    for (let tries = 0; tries < PALETTE.length && used.has(PALETTE[k]); tries++) k = (k + 1) % PALETTE.length;
    c.color = PALETTE[k];
    el.style.setProperty('--c', c.color);
  },
  kind(el) {
    state.draft.codes[+el.dataset.i].kind = el.dataset.kind;
    el.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
  },
  'del-code'(el) {
    state.draft.codes.splice(+el.dataset.i, 1);
    refreshCodes();
  },
  'add-code'() {
    const s = state.draft;
    if (s.codes.length >= MAX_CODES) return;
    const used = new Set(s.codes.map((c) => c.color));
    const color = PALETTE.find((p) => !used.has(p)) || PALETTE[s.codes.length % PALETTE.length];
    s.codes.push({ id: 'c' + uid(), label: `代碼 ${s.codes.length + 1}`, kind: 'duration', color });
    refreshCodes();
    const inp = document.getElementById(`code-${s.codes.length - 1}`);
    inp?.focus(); inp?.select();
  },
  'to-record': () => toRecord(),
  // 記錄
  start: () => startClock(),
  pause: () => pause(),
  resume: () => resume(),
  end: () => endSession(),
  tap: (el) => tapCode(el.dataset.code),
  undo: () => undoLast(),
  send: () => sendNote(),
  stamp: () => insertStamp(),
  'reset-t0'() { setT0(nowT()); save(); document.getElementById('note-text')?.focus(); },
  'edit-note'(el) { state.editNote = el.dataset.id; refreshNotes(); document.getElementById('edit-' + el.dataset.id)?.focus(); },
  'cancel-note'() { state.editNote = null; refreshNotes(); },
  'save-note'(el) {
    const ev = state.s.events.find((e) => e.id === el.dataset.id);
    const v = document.getElementById('edit-' + el.dataset.id).value.trim();
    if (!v) { toast('內容不能是空的；要移除請按「刪除」'); return; }
    ev.text = v;
    ev.edited = Date.now();
    state.editNote = null;
    save();
    refreshNotes();
    toast('已儲存修改');
  },
  async 'del-note'(el) {
    if (!(await ask({ title: '刪除這則記錄？', ok: '刪除', danger: true }))) return;
    state.s.events = state.s.events.filter((e) => e.id !== el.dataset.id);
    save();
    refreshNotes();
  },
  // 結果
  async 'del-mark'(el) {
    const ids = new Set(el.dataset.ids.split(','));
    state.s.events = state.s.events.filter((e) => !ids.has(e.id));
    await save();
    const open = app.querySelector('details[open]') ? true : false;
    renderResult();
    if (open) app.querySelector('#detail')?.closest('details')?.setAttribute('open', '');
    toast('已刪除一筆標記');
  },
  'exp-xlsx': () => exportFile('xlsx'),
  'exp-png': () => exportFile('png'),
  'exp-json': () => exportFile('json'),
  async 'delete-session'() {
    if (!(await ask({ title: '刪除這場觀課？', body: '刪除後無法復原。如果還需要，請先匯出備份檔。', ok: '刪除', danger: true }))) return;
    await store.del(state.s.id);
    toast('已刪除');
    renderHome();
  },
  async 'backup-all'() {
    const all = (await store.all()).filter((s) => !s.sample);
    const d = new Date();
    const p = (x) => String(x).padStart(2, '0');
    const name = `observations_backup_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.json`;
    download(jsonBlob({ app: APP_VERSION, exportedAt: d.toISOString(), sessions: all }), name);
    toast(`已匯出 ${name}`);
  },
};

function refreshNotes() {
  if (state.view === 'record') refreshFeed();
  else {
    const f = document.getElementById('feed');
    if (f) f.innerHTML = feedHTML(state.s, { editable: !state.s.sample, newestFirst: false });
    renderTimeline();
  }
}

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.act];
  if (fn) fn(el, e);
});

app.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'note-text') return onNoteInput(t);
  if (state.view === 'setup' && t.dataset.meta) state.draft.meta[t.dataset.meta] = t.value;
  if (state.view === 'setup' && t.dataset.field === 'label') {
    state.draft.codes[+t.dataset.i].label = t.value;
    document.getElementById('code-err').hidden = true;
  }
  if (state.view === 'result' && t.dataset.rmeta && !state.s.sample) {
    state.s.meta[t.dataset.rmeta] = t.value;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => save(), 500);
  }
});

app.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'preset' && t.value) {
    const p = PRESETS.find((x) => x.id === t.value);
    state.draft.codes = p.codes.map(([label, kind], i) => ({ id: 'c' + uid(), label, kind, color: PALETTE[i] }));
    t.value = '';
    refreshCodes();
    toast(`已套用「${p.name}」`);
  }
  if (t.id === 'imp' && t.files?.[0]) importFile(t.files[0]);
  if (t.id === 'exclusive' && state.draft) state.draft.exclusive = t.checked;
  if (state.view === 'result' && t.dataset.rmeta === 'title') app.querySelector('.bar h1').textContent = displayTitle(state.s);
});

document.addEventListener('keydown', (e) => {
  if (state.view !== 'record' || !state.s) return;
  const t = e.target;
  // ATC：Enter 送出；輸入法選字中（注音、倉頡）不送出
  if (t.id === 'note-text' && e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
    e.preventDefault();
    sendNote();
    return;
  }
  // ATC：Ctrl + ; 插入時鐘時刻（Mac 也用 Control 鍵）
  if (t.id === 'note-text' && e.ctrlKey && e.code === 'Semicolon') {
    e.preventDefault();
    insertStamp();
    return;
  }
  // 代碼按鈕：數字鍵（不在輸入框時），或 Alt + 數字鍵（打字中也能用）
  const digit = /^Digit[0-9]$/.test(e.code) ? +e.code.slice(5) : null;
  if (!hasCodes(state.s) || digit == null || e.ctrlKey || e.metaKey) return;
  const typing = t.matches?.('input, textarea, select');
  if (typing && !e.altKey) return;
  const c = state.s.codes[digit === 0 ? 9 : digit - 1];
  if (c) { e.preventDefault(); tapCode(c.id); }
});

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (state.view === 'result') renderTimeline(); }, 150);
});
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (state.view === 'result') renderTimeline(); });

// ---------- 啟動 ----------
(async () => {
  state.persistent = await store.ready();
  await renderHome();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 預覽環境不支援時略過 */ });
  }
})();
