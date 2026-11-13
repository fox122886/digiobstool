import { store } from './store.js';
import {
  MODES, PALETTE, PRESETS, MAX_CODES, uid, fmt, fmtDur, clockTime, newSession, elapsedSec, isPaused, isRunning,
  codeOf, openCodes, segments, stats, notes, totalSec, displayTitle, sampleSession, APP_VERSION, wallTime, clockHMS,
  ITC_PRESETS, itcPresetCodes, parseLabels, hasRate,
  hasStamp, isBareMark,
} from './model.js';
import * as itc from './itc.js';
import * as ptc from './ptc.js';
import { makeRoom, samplePTC } from './ptcmodel.js';
import { gifBlob, videoBlob } from './anim.js';
import { briefPanel, reportHTML, printColors } from './brief.js';
import { TOOL, track } from './analytics.js';
import { timelineSVG, download, timelinePNG, xlsxBlob, jsonBlob, names } from './output.js';
import * as gd from './gdrive.js';

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
let resyncTimer;
function save(s = state.s, { touch = true } = {}) {
  if (!s || s.sample) return saveChain;
  if (touch) {
    s.updatedAt = Date.now();
    // 結果頁修改後：已登入且權杖有效時，自動更新雲端上的版本
    if (state.view === 'result' && s === state.s && s.status === 'ended') {
      clearTimeout(resyncTimer);
      resyncTimer = setTimeout(() => {
        if (state.account && gd.hasToken() && s.drive?.syncedAt) syncNow(s, { interactive: false });
        else refreshCloud();
      }, 2500);
    }
  }
  const snap = structuredClone(s);
  saveChain = saveChain.then(() => store.put(snap)).catch((err) => toast('儲存失敗：' + (err?.message || err), 5000));
  return saveChain;
}

// ---------- Google 雲端硬碟 ----------
function syncTime(ms) {
  return new Date(ms).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

function cloudRow(unsynced) {
  if (!gd.available()) return '';
  const a = state.account;
  if (!a) {
    return `<div class="panel cloud-row"><div class="grow"><b>存到 Google 雲端硬碟</b><br>
      <span class="small muted">登入後，結束觀課會自動存到你的雲端硬碟。</span></div>
      <button class="btn sm primary" data-act="g-signin">連結 Google</button></div>`;
  }
  return `<div class="panel cloud-row"><div class="grow"><span class="small muted">已連結 Google 雲端硬碟</span><br><b class="email">${esc(a.email)}</b></div>
    <span class="row">
      ${unsynced ? `<button class="btn sm primary" data-act="g-sync-all">同步 ${unsynced} 場觀課</button>` : ''}
      ${a.folderUrl ? `<a class="btn sm" href="${esc(a.folderUrl)}" target="_blank" rel="noopener">開啟資料夾</a>` : ''}
      <button class="btn sm ghost" data-act="g-signout">登出</button>
    </span></div>`;
}

function cloudPanel(s) {
  if (s.sample || !gd.available()) return '';
  const a = state.account;
  let body;
  if (state.syncing === s.id) {
    body = `<p class="muted">正在存到雲端硬碟…</p>`;
  } else if (!a) {
    body = `<p class="hint">登入 Google 後，可以把這場觀課存一份到你自己的雲端硬碟（Google 試算表＋備份檔）。記錄只會存到你的帳號，不會經過其他伺服器。</p>
      <div class="row"><button class="btn primary sm" data-act="g-sync">登入並存到雲端硬碟</button></div>`;
  } else if (!gd.needsSync(s)) {
    body = `<p>已存到雲端硬碟 <span class="hint num">（${syncTime(s.drive.syncedAt)}）</span></p>
      <div class="row"><a class="btn sm primary" href="${esc(s.drive.sheetUrl)}" target="_blank" rel="noopener">開啟試算表</a>
      <a class="btn sm" href="${esc(s.drive.folderUrl)}" target="_blank" rel="noopener">開啟資料夾</a></div>`;
  } else {
    body = `<p class="hint">${s.drive?.syncedAt ? '記錄有修改，雲端硬碟上的還是修改前的版本。' : '這場觀課還沒存到雲端硬碟。'}</p>
      <div class="row"><button class="btn primary sm" data-act="g-sync">${s.drive?.syncedAt ? '更新雲端硬碟上的版本' : '存到雲端硬碟'}</button></div>`;
  }
  if (state.cloudErr) body += `<p class="err">${esc(state.cloudErr)}</p>`;
  return `<section class="panel" id="cloud"><header><h2>Google 雲端硬碟</h2>${a ? `<span class="hint">${esc(a.email)}</span>` : ''}</header>${body}</section>`;
}

function refreshCloud() {
  const el = document.getElementById('cloud');
  if (el && state.view === 'result' && state.s) el.outerHTML = cloudPanel(state.s) || '<span id="cloud"></span>';
}

async function syncNow(s, { interactive = true } = {}) {
  if (!gd.available() || !s || s.sample) return;
  if (!navigator.onLine) { state.cloudErr = '目前沒有網路，連線後再按一次即可。'; refreshCloud(); return; }
  state.cloudErr = null;
  try {
    if (!state.account) {
      state.syncing = s.id; refreshCloud();
      state.account = await gd.signIn();
      state.account.folderUrl = (await store.getSetting('googleFolder'))?.url;
    } else if (!(await gd.getToken({ interactive }))) {
      return;
    }
    state.syncing = s.id; refreshCloud();
    s.drive = await gd.syncSession(s);
    track('drive_sync', { tool: s.mode });
    await save(s, { touch: false });
    if (interactive) toast('已存到你的雲端硬碟');
  } catch (e) {
    state.cloudErr = e.message || String(e);
  } finally {
    state.syncing = null;
    refreshCloud();
  }
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
  if (state.updateReady) { location.reload(); return; }
  state.view = 'home';
  state.s = null;
  stopTick();
  keepAwake(false);
  let list = [];
  try { list = await store.all(); } catch (e) { toast('讀取記錄失敗'); }
  list.sort((a, b) => (b.clock.startedAt || b.createdAt) - (a.clock.startedAt || a.createdAt));
  const unfinished = list.filter((s) => s.status !== 'ended');
  const allDone = list.filter((s) => s.status === 'ended');
  // 工具入口頁（例如 itc/）只列該工具的記錄
  const done = TOOL ? allDone.filter((s) => s.mode === TOOL) : allDone;
  const modes = TOOL ? [TOOL] : Object.keys(TOOL_INFO);
  const card = (m) => `<button class="mode" data-act="new" data-mode="${m}">
        <span class="tag">${m}</span><h2>${TOOL ? '開始新的觀課' : TOOL_INFO[m].name}</h2>
        <p>${TOOL_INFO[m].desc}</p>
        <span class="go">開始設定 →</span></button>`;

  const item = (s) => {
    const live = s.status !== 'ended';
    const when = [s.meta.date, clockTime(s.clock.startedAt)].filter(Boolean).join(' ');
    const count = isITC(s) ? itc.homeCount(s) : isPTC(s) ? ptc.homeCount(s) : [hasCodes(s) && `${s.codes.length} 個代碼`, hasNotes(s) && `${notes(s).length} 則記錄`].filter(Boolean).join('、');
    const dur = live ? (s.status === 'ready' ? '未開始' : '進行中') : fmt(totalSec(s));
    return `<li><button class="item" data-act="open" data-id="${esc(s.id)}">
      <span class="badge ${live ? 'live' : ''}">${s.mode}</span>
      <span class="main"><span class="t">${esc(displayTitle(s))}</span><br><span class="sub"><span class="num">${esc(when)}</span> · ${count}${s.drive?.syncedAt && !gd.needsSync(s) ? ' · <span class="cloud-ok">已存雲端</span>' : ''}</span></span>
      <span class="dur num">${dur}</span></button></li>`;
  };

  app.innerHTML = `<div class="wrap">
    <div class="brand">
      <button type="button" class="theme-btn" data-theme-toggle>${window.obsTheme ? window.obsTheme.label().html : ''}</button>
      ${TOOL ? `<p class="small"><a href="./">‹ 數位觀課工具</a></p><h1><span class="num">${TOOL}</span> ${TOOL_INFO[TOOL].name}</h1>
      <p class="muted">可離線使用，每個動作都即時存在這台裝置上。<a class="guide-link" href="guide.html#${TOOL.toLowerCase()}">${TOOL} 操作說明 →</a></p>`
      : `<h1>數位觀課工具</h1>
      <p class="muted">可離線使用，每個動作都即時存在這台裝置上。<a class="guide-link" href="guide.html">操作指引 →</a></p>`}
    </div>
    ${state.persistent ? '' : `<div class="panel" style="border-color:var(--warn)"><p><b>這個瀏覽器無法長期保存資料</b>（可能是無痕模式）。記錄只會留到關閉頁面為止，結束後請立即匯出。</p></div>`}
    ${unfinished.map((s) => `<div class="panel resume"><div class="grow"><b>有一場觀課尚未結束</b><br>
      <span class="small muted">${esc(s.mode)} · ${esc(displayTitle(s))}</span></div>
      <span class="row"><button class="btn sm" data-act="discard" data-id="${esc(s.id)}">捨棄</button>
      <button class="btn rec" data-act="open" data-id="${esc(s.id)}">繼續記錄</button></span></div>`).join('')}
    <section class="modes ${TOOL ? 'one' : ''}" aria-label="選擇觀課工具">
      ${modes.map(card).join('')}
    </section>
    ${cloudRow(state.account ? done.filter(gd.needsSync).length : 0)}
    <section class="panel" aria-labelledby="hist">
      <header><h2 id="hist">${TOOL ? `${TOOL} ` : ''}觀課記錄</h2><span class="small muted num">${done.length} 場</span></header>
      ${done.length ? `<ul class="list">${done.map(item).join('')}</ul>` : `<div class="empty">
        <p>完成的觀課會列在這裡，可以回頭查看時間軸、編修與匯出。</p>
        <div class="row" style="justify-content:center">${modes.map((m) => `<button class="btn sm" data-act="sample" data-mode="${m}">看 ${m} 範例結果</button>`).join('')}</div></div>`}
      ${TOOL && allDone.length > done.length ? `<p class="small muted">其他工具的 ${allDone.length - done.length} 場記錄，請到<a href="./">數位觀課工具首頁</a>查看。</p>` : ''}
    </section>
    <section class="row">
      <button class="btn sm" data-act="backup-all" ${list.length ? '' : 'disabled'}>匯出全部備份</button>
      <label class="btn sm" for="imp">匯入備份檔</label>
      <input id="imp" type="file" accept="application/json,.json" hidden>
    </section>
    <footer class="foot">
      <p>國立臺灣師範大學師資培育學院 張民杰教授團隊。本工具改寫自 Miikka Turkkila 的
        <a href="https://github.com/MTurkkila/LOBS" target="_blank" rel="noopener">LOBS（Lesson OBServation app）</a>（CC BY-NC-SA 4.0），已修改介面、計時方式、資料保存與匯出功能。</p>
      <p>以<a href="https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hant" target="_blank" rel="noopener">創用 CC 姓名標示-非商業性-相同方式分享 4.0</a> 釋出。版本 <span class="num">${APP_VERSION}</span></p>
      <p>觀課記錄常含學生資訊，建議以座號或代稱記錄，不寫全名。<a href="privacy.html">隱私權政策</a></p>
    </footer>
  </div>`;
}

// ---------- 設定頁 ----------
const TOOL_INFO = {
  UTC: { name: '通用時間線標記', desc: '用自訂按鈕記錄教學行為的起訖與次數，課後自動算出時間分配。' },
  ATC: { name: '軼事記錄時間線標記', desc: '隨時寫下觀察，每則自動標上「開始寫」與「送出」的課堂時間。' },
  DTC: { name: '質量雙元時間線標記', desc: '代碼按鈕與文字記錄並用，同時掌握時間分配與質性觀察。' },
  ITC: { name: '間隔時間線標記', desc: '輪流觀察每位學生，每隔數秒記下他是否在工作中，統計全班投入情形。' },
  PTC: { name: '教師移動路徑標記', desc: '在教室圖上點出老師走過的位置，畫出移動路線與師生討論，分析巡視的空間與時間分布。（雛形）' },
};
const hasCodes = (s) => s.mode === 'UTC' || s.mode === 'DTC';
const hasNotes = (s) => s.mode === 'ATC' || s.mode === 'DTC';
const isITC = (s) => s.mode === 'ITC';
const isPTC = (s) => s.mode === 'PTC';

async function startNew(mode) {
  track('obs_setup', { tool: mode });
  let codes = [];
  if (mode !== 'ATC' && mode !== 'PTC') {
    const last = await store.getSetting('lastCodes_' + mode);
    const fallback = mode === 'ITC' ? itcPresetCodes(ITC_PRESETS[0]) : PRESETS[0].codes.map(([label, kind], i) => ({ label, kind, color: PALETTE[i] }));
    codes = (last && last.length ? last : fallback).map((c) => ({ ...c }));
  }
  const lastMeta = await store.getSetting('lastMeta', {});
  const s = newSession(mode, codes);
  if (hasCodes(s)) s.exclusive = !!(await store.getSetting('lastExclusive_' + mode, false));
  if (mode === 'ITC') {
    const last = await store.getSetting('lastITC', {});
    s.itc = {
      n: last.n || 25, labels: last.labels || null, interval: last.interval ?? 0, rec: last.rec || 0, sound: last.sound !== false,
      layout: last.layout || 'rotate', seat: last.seat || null, useActs: !!last.useActs, actList: last.actList || null,
      absent: [], cur: { t0: null, sel: null },
    };
  }
  if (mode === 'PTC') {
    const last = await store.getSetting('lastPTC', {});
    s.ptc = { room: last.room ? JSON.parse(JSON.stringify(last.room)) : makeRoom('groups'), student: !!last.student, analysis: {} };
  }
  s.meta.school = lastMeta.school || '';
  s.meta.observer = lastMeta.observer || '';
  state.draft = s;
  renderSetup();
  if (mode === 'PTC') ptc.mountSetup();
}

function codesEditor(s) {
  return s.codes.map((c, i) => `<div class="code-row" data-i="${i}">
    <button class="swatch" style="--c:${c.color}" data-act="color" data-i="${i}" aria-label="變更「${esc(c.label)}」的顏色" title="點一下換顏色"></button>
    <input type="text" id="code-${i}" value="${esc(c.label)}" maxlength="20" data-field="label" data-i="${i}" aria-label="代碼 ${i + 1} 名稱" placeholder="代碼名稱">
    ${isITC(s) ? itc.taskSelect(c, i) : `<span class="seg" role="group" aria-label="記錄方式">
      <button type="button" data-act="kind" data-kind="duration" data-i="${i}" aria-pressed="${c.kind === 'duration'}">持續</button>
      <button type="button" data-act="kind" data-kind="event" data-i="${i}" aria-pressed="${c.kind === 'event'}">單次</button>
    </span>`}
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
    <div class="bar"><button class="back" data-act="home">‹ 首頁</button><h1>${s.mode} ${MODES[s.mode].name}</h1>
      <a class="bar-help" href="guide.html#${s.mode.toLowerCase()}" target="_blank" rel="noopener" data-guide="${s.mode}">說明</a></div>
    <section class="panel">
      <header><h2>觀課資訊</h2><span class="hint">都可以留白，之後再補</span></header>
      <div class="fields">
        ${field('title', '標題', 'full')}
        ${field('focus', '觀察焦點（選填，例如觀察前會談約定的焦點）', 'full')}
        ${field('date', '日期')}${field('school', '學校')}
        ${field('className', '班級')}${field('subject', '科目')}
        ${field('teacher', '授課教師')}${field('observer', '觀課者')}
      </div>
    </section>
    ${hasCodes(s) ? `<section class="panel">
      <header><h2>代碼按鈕</h2><span class="hint num" id="code-count">${s.codes.length} / ${MAX_CODES}</span></header>
      <p class="hint">「持續」按一下開始、再按一下結束，會算出時間長度；「單次」按一下記一次，適合舉手、讚美這類瞬間行為。點色塊可以換顏色。分類方式可參考<a href="guide.html#codes">操作指引的代碼分類範例</a>。</p>
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
    ${isPTC(s) ? ptc.setupPanel(s) : ''}
    ${isITC(s) ? itc.setupPanel(s) + `<section class="panel">
      <header><h2>記錄類別</h2><span class="hint num" id="code-count">${s.codes.length} / ${MAX_CODES}</span></header>
      <p class="hint">觀察每一位時，按下他符合的類別；預設是「學生在工作中」的六個類別。請用可以直接看到的外顯行為來定義每一類。點色塊可以換顏色。</p>
      <p class="hint">右側選單決定計算「在工作中率」時歸在哪一邊：在工作中率＝在工作中 ÷（在工作中＋不在工作中），「不計入」的類別（例如無法判斷）不列入。全部設為「不計入」就不計算。</p>
      <div class="codes-edit" id="codes">${codesEditor(s)}</div>
      <p class="err" id="code-err" hidden></p>
      <div class="row">
        <button class="btn sm" data-act="add-code" ${s.codes.length >= MAX_CODES ? 'disabled' : ''}>＋ 新增類別</button>
        <label class="f" for="preset" style="flex-direction:row;align-items:center;gap:8px;margin-left:auto">套用
          <select id="preset" style="min-height:36px;width:auto">
            <option value="">選擇範本…</option>
            ${ITC_PRESETS.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
          </select></label>
      </div>
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
  if (isITC(s)) {
    const msg = itc.readSetup(s);
    if (msg) { const el = document.getElementById('itc-err'); el.textContent = msg; el.hidden = false; el.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    const it = s.itc;
    await store.setSetting('lastITC', { n: it.layout === 'seat' ? undefined : it.n, labels: it.layout === 'seat' ? null : it.labels, interval: it.interval, rec: it.rec,
      sound: it.sound, layout: it.layout, seat: it.seat, useActs: it.useActs, actList: it.actList });
  }
  if (isPTC(s)) {
    const msg = ptc.readSetup(s);
    if (msg) { const el = document.getElementById('ptc-err'); el.textContent = msg; el.hidden = false; el.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    await store.setSetting('lastPTC', { room: s.ptc.room, student: s.ptc.student });
  }
  if (hasCodes(s) || isITC(s)) {
    s.codes.forEach((c) => { c.label = c.label.trim(); });
    const msg = validateCodes(s);
    const el = document.getElementById('code-err');
    if (msg) { el.textContent = msg; el.hidden = false; el.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    await store.setSetting('lastCodes_' + s.mode, s.codes.map(({ label, kind, color, task }) => ({ label, kind, color, ...(task ? { task } : {}) })));
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

// 文字中的 [HH:MM:SS] 顯示成時刻標記
const stampHTML = (text) => esc(text).replace(/\[(\d{1,2}:\d{2}:\d{2})\]/g, '<mark class="ts">$1</mark>');

function feedHTML(s, { editable = true, newestFirst = true, onlyKey = false } = {}) {
  let list = notes(s).map((n, i) => ({ n, i }));
  if (onlyKey) list = list.filter(({ n }) => hasStamp(n));
  if (newestFirst) list.reverse();
  if (!list.length) return `<p class="hint" style="text-align:center;padding:12px">${onlyKey ? '沒有插入時刻的記錄。' : '送出的記錄會出現在這裡，可以隨時修改。'}</p>`;
  return list.map(({ n, i }) => {
    const editing = state.editNote === n.id;
    const key = hasStamp(n), bare = isBareMark(n);
    return `<article class="note ${key ? 'key' : ''}" data-id="${n.id}">
      <span class="no">#${i + 1}</span>
      <div class="when"><span>${fmt(n.t0 ?? n.t)} 開始 → ${fmt(n.t)} 送出<span class="muted">（${clockHMS(wallTime(s, n.t))}）</span></span>
        ${editable && !editing ? `<span class="acts"><button class="btn ghost sm" data-act="edit-note" data-id="${n.id}">修改</button>
        <button class="btn ghost sm" data-act="del-note" data-id="${n.id}" style="color:var(--rec)">刪除</button></span>` : ''}</div>
      ${editing ? `<div style="grid-column:2;display:flex;flex-direction:column;gap:6px">
          <textarea id="edit-${n.id}" aria-label="修改記錄 #${i + 1}">${esc(bare ? n.text.trimEnd() + ' ' : n.text)}</textarea>
          <div class="row"><button class="btn sm primary" data-act="save-note" data-id="${n.id}">儲存</button>
          <button class="btn sm" data-act="cancel-note">取消</button></div></div>`
        : `<p class="txt" style="grid-column:2">${stampHTML(n.text)}${bare ? `<span class="todo">待補充內容${editable ? `　<button class="btn ghost sm" data-act="edit-note" data-id="${n.id}">補充</button>` : ''}</span>` : ''}</p>`}
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

// ---------- 手機：聊天式輸入介面（ATC、DTC） ----------
const mqPhone = matchMedia('(max-width: 859px)');
const chatMode = (s) => hasNotes(s) && mqPhone.matches;

function topActions(s) {
  if (s.status === 'ready') return '';
  return `${isPaused(s)
    ? '<button class="btn sm primary" data-act="resume">繼續</button>'
    : '<button class="btn sm" data-act="pause">暫停</button>'}
    <button class="btn sm danger" data-act="end">結束</button>`;
}

function chips(s) {
  const open = openCodes(s);
  return s.codes.map((c) => `<button type="button" class="chip ${open.has(c.id) ? 'on' : ''}" style="--c:${c.color}" data-act="tap" data-code="${c.id}"
    ${isRunning(s) ? '' : 'disabled'}>${esc(c.label)}${c.kind === 'event' ? ' ＋' : ''}</button>`).join('');
}

function renderChat() {
  const s = state.s;
  const [label, cls] = stateLabel(s);
  const ready = s.status === 'ready';
  const canUndo = s.events.some((e) => e.type !== 'note');
  app.innerHTML = `<div class="rec chat">
    <header class="rec-top"><div class="in">
      <button class="back" data-act="leave" aria-label="回首頁">‹</button>
      <span class="clockbox"><span class="clock" id="clock" aria-label="課堂經過時間">${fmt(nowT())}</span>
        <span class="wall num" id="wall" title="現在時刻">${clockHMS(Date.now())}</span></span>
      <span class="state ${cls}" id="state">${label}</span>
      <span class="top-acts" id="actions">${topActions(s)}</span>
    </div></header>
    <main class="rec-main" id="rec-main">
      ${hasCodes(s) ? `<div class="grid-codes" id="codes-grid">${codeButtons(s)}</div>
        <div class="row" style="justify-content:flex-end;margin-top:-6px"><button class="btn ghost sm" data-act="undo" ${canUndo && !ready ? '' : 'disabled'}>↶ 復原按鈕動作</button></div>` : ''}
      <section class="feed" id="feed" aria-label="已送出的記錄">${feedHTML(s, { newestFirst: false })}</section>
    </main>
    <footer class="chatbar" id="chatbar">
      ${ready ? `<button class="btn primary lg" data-act="start" style="width:100%">開始計時</button>` : `
      ${hasCodes(s) ? `<div class="chips" id="chips" aria-label="代碼按鈕（打字時使用）">${chips(s)}</div>` : ''}
      <div class="t0" id="t0"></div>
      <div class="chat-row">
        <button type="button" class="stamp" data-act="stamp" aria-label="插入現在時刻" title="插入現在時刻">時刻</button>
        <textarea id="note-text" rows="1" enterkeyhint="send" placeholder="寫下你看到的…" aria-label="記錄內容"></textarea>
        <button type="button" class="send" data-act="send" aria-label="送出">送出</button>
      </div>`}
    </footer>
  </div>`;
  watchChatbar();
  restoreDraft();
  growNote();
  scrollFeedEnd();
}

// 讓輸入列貼在鍵盤上緣（iOS／Android 皆以 visualViewport 計算）
function updateKeyboard() {
  const vv = window.visualViewport;
  const root = document.documentElement.style;
  const kb = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
  root.setProperty('--kb', kb + 'px');
  root.setProperty('--sab', kb > 0 ? '0px' : 'env(safe-area-inset-bottom, 0px)');
}
window.visualViewport?.addEventListener('resize', updateKeyboard);
window.visualViewport?.addEventListener('scroll', updateKeyboard);

let barObserver;
function watchChatbar() {
  updateKeyboard();
  barObserver?.disconnect();
  const bar = document.getElementById('chatbar');
  if (!bar || !window.ResizeObserver) return;
  barObserver = new ResizeObserver(() => document.documentElement.style.setProperty('--bar', bar.offsetHeight + 'px'));
  barObserver.observe(bar);
}

function growNote() {
  const ta = document.getElementById('note-text');
  if (!ta || !app.querySelector('.rec.chat')) return;
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight + 2, 132) + 'px';
}

function scrollFeedEnd() {
  if (!app.querySelector('.rec.chat')) return;
  requestAnimationFrame(() => document.getElementById('feed')?.lastElementChild?.scrollIntoView({ block: 'nearest' }));
}

mqPhone.addEventListener?.('change', () => {
  if (state.view === 'record' && state.s && hasNotes(state.s)) renderRecord();
});

function renderRecord() {
  state.view = 'record';
  const s = state.s;
  if (chatMode(s)) {
    renderChat();
    if (s.status === 'recording') startTick();
    if (isRunning(s)) keepAwake(true);
    return;
  }
  const [label, cls] = stateLabel(s);
  app.innerHTML = `<div class="rec">
    <header class="rec-top"><div class="in">
      <button class="back" data-act="leave">‹ 首頁</button>
      <span class="clock" id="clock" aria-label="課堂經過時間">${fmt(nowT())}</span>
      <span class="state ${cls}" id="state">${label}</span>
      <span class="wall num" id="wall" title="現在時刻">${clockHMS(Date.now())}</span>
      <span class="title">${esc(s.mode)} · ${esc(displayTitle(s))}</span>
    </div></header>
    <main class="rec-main ${s.mode === 'DTC' ? 'dtc' : ''} ${isITC(s) ? 'itc' : ''} ${isPTC(s) ? 'ptc' : ''}" id="rec-main">${isPTC(s) ? ptc.body(s) : isITC(s) ? itc.body(s) : s.mode === 'UTC' ? utcBody(s) : s.mode === 'ATC' ? atcBody(s) : dtcBody(s)}</main>
    <footer class="rec-bar"><div class="in" id="actions">${isPTC(s) ? ptc.actionBar(s) : isITC(s) ? itc.actionBar(s) : actionBar(s)}</div></footer>
  </div>`;
  if (s.status === 'recording') startTick();
  if (isRunning(s)) keepAwake(true);
  if (hasNotes(s)) restoreDraft();
  if (isITC(s)) itc.tick();
  if (isPTC(s)) ptc.mountRecord();
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
  if (isITC(s)) itc.tick();
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
  if (isITC(s)) { itc.refresh(); updateClock(); return; }
  if (isPTC(s)) { ptc.refresh(); updateClock(); return; }
  if (app.querySelector('.rec.chat')) {
    document.getElementById('actions').innerHTML = topActions(s);
    refreshCodeViews();
    updateClock();
    return;
  }
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
  const chat = !!app.querySelector('.rec.chat');
  if (f) f.innerHTML = feedHTML(state.s, { newestFirst: !chat });
  if (chat) scrollFeedEnd();
}

// 代碼按鈕的各個顯示處（大按鈕、打字時的小按鈕、復原鈕）一起更新
function refreshCodeViews() {
  const s = state.s;
  if (!hasCodes(s)) return;
  const grid = document.getElementById('codes-grid');
  if (grid) grid.innerHTML = codeButtons(s);
  const ch = document.getElementById('chips');
  if (ch) ch.innerHTML = chips(s);
  const undo = app.querySelector('[data-act="undo"]');
  if (undo) undo.disabled = !s.events.some((e) => e.type !== 'note') || s.status === 'ready';
}

async function startClock() {
  const s = state.s;
  s.clock.startedAt = Date.now();
  s.status = 'recording';
  if (isITC(s)) itc.onStart(s);
  startTick();
  track('obs_start', {
    tool: s.mode,
    ...(hasCodes(s) || isITC(s) ? { code_count: s.codes.length } : {}),
    ...(isITC(s) ? {
      itc_layout: s.itc.layout || 'rotate', itc_n: s.itc.n, itc_interval: s.itc.interval,
      itc_rec: s.itc.rec || 0, itc_acts: s.itc.acts ? 'yes' : 'no',
    } : {}),
  });
  try { await navigator.storage?.persist?.(); } catch (e) { /* 忽略 */ }
  await save();
  keepAwake(true);
  if (app.querySelector('.rec.chat')) renderRecord();
  else refreshRecord();
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
  if (isITC(s)) itc.onResume();
  save();
  keepAwake(true);
  refreshRecord();
}

async function endSession() {
  const s = state.s;
  const pending = hasNotes(s) && document.getElementById('note-text')?.value.trim();
  const ok = await ask({
    title: '結束這場觀課？',
    body: pending ? '文字框裡還有尚未送出的內容，結束時會自動送出。'
      : isITC(s) ? '結束後停止取樣；目前這一位尚未記錄的觀察不會保存。仍可在結果頁修改每一筆記錄。'
      : '結束後課堂時間停止，仍可在結果頁修改記錄。',
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
  track('obs_end', { tool: s.mode, obs_minutes: Math.round(totalSec(s) / 6) / 10, item_count: s.events.length });
  await save();
  stopTick();
  keepAwake(false);
  renderResult();
  if (state.account && gd.hasToken()) syncNow(s, { interactive: false });
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
  refreshCodeViews();
  if (c.kind === 'event') app.querySelectorAll(`[data-code="${id}"]`).forEach((el) => el.classList.add('flash'));
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
  refreshCodeViews();
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
  growNote();
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
  growNote();
  clearTimeout(draftTimer);
  save();
  refreshFeed();
  ta.focus();
}

// 聊天式介面：點代碼小按鈕、時刻、送出時不讓輸入框失焦，鍵盤才不會收起來
app.addEventListener('pointerdown', (e) => {
  if (!app.querySelector('.rec.chat')) return;
  if (e.target.closest('.chatbar button') && document.activeElement?.id === 'note-text') e.preventDefault();
});
app.addEventListener('focusin', (e) => {
  if (e.target.id === 'note-text') app.querySelector('.rec.chat')?.classList.add('typing');
});
app.addEventListener('focusout', (e) => {
  if (e.target.id !== 'note-text') return;
  setTimeout(() => {
    if (document.activeElement?.id !== 'note-text') app.querySelector('.rec.chat')?.classList.remove('typing');
  }, 150);
});
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
  return { ink: 'var(--ink)', muted: 'var(--muted)', line: 'var(--line)', accent: 'var(--accent)', bg: 'var(--surface)', warn: 'var(--warn)' };
}

function renderTimeline() {
  const box = document.getElementById('tl');
  if (!box || !state.s) return;
  box.innerHTML = timelineSVG(state.s, box.clientWidth || 600, themeColors());
}

function renderResult() {
  if (state.view !== 'result') state.cloudErr = null;
  state.view = 'result';
  stopTick();
  const s = state.s;
  const total = totalSec(s);
  const n = names(s);
  const m = s.meta;
  const meta = (key, label, extra = '') => `<label class="f ${extra}" for="r-${key}">${label}
    <input type="${key === 'date' ? 'date' : 'text'}" id="r-${key}" data-rmeta="${key}" value="${esc(m[key])}" ${s.sample ? 'disabled' : ''}></label>`;

  let body = isITC(s) ? itc.resultBody(s) : isPTC(s) ? ptc.resultBody(s) : '';
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
    const nKey = notes(s).filter(hasStamp).length, nBare = notes(s).filter(isBareMark).length;
    body += `<section class="panel"><header><h2>文字記錄</h2><span class="hint num">${notes(s).length} 則${nKey ? `，${nKey} 則有時刻標記` : ''}${nBare ? `（${nBare} 則待補充）` : ''}</span></header>
      ${nKey ? `<div class="row"><button class="btn sm" data-act="only-key" aria-pressed="${!!state.onlyKey}">只看有時刻標記的記錄</button></div>` : ''}
      <div class="feed" id="feed">${feedHTML(s, { editable: !s.sample, newestFirst: false, onlyKey: !!state.onlyKey })}</div></section>`;
  }
  const tlHint = { UTC: '色帶是持續行為，菱形是單次標記', ATC: '圓點是送出時間，淡色線段是撰寫時間', DTC: '色帶是持續行為，菱形是單次標記，最下列圓點是文字記錄', ITC: '每一欄是一輪，顏色比例是該輪各類別的人次' + (isITC(s) && (hasRate(s) || s.itc.acts) ? '；下方是各輪在工作中率與教學活動時段' : ''), PTC: '即原始觀察記錄：實線箭頭是教師移動，圈內數字是學生—教師討論的順序' }[s.mode];

  app.innerHTML = `<div class="wrap">
    <div class="bar"><button class="back" data-act="home">‹ 首頁</button><h1>${esc(displayTitle(s))}</h1></div>
    ${s.sample ? `<div class="panel" style="border-color:var(--warn);background:var(--warn-soft)"><p><span class="badge sample">範例</span> 這是示範用的假資料，不會存進記錄；可以試試匯出看看格式。</p></div>` : ''}
    ${isPTC(s) ? '' : briefPanel(s)}
    <section class="panel">
      <dl class="summary">
        <div><dt>工具</dt><dd>${s.mode}</dd></div>
        <div><dt>課堂長度</dt><dd>${fmt(total)}</dd></div>
        <div><dt>開始時刻</dt><dd>${clockTime(s.clock.startedAt) || '—'}</dd></div>
        ${hasCodes(s) ? `<div><dt>標記次數</dt><dd>${s.events.filter((e) => e.type === 'on' || e.type === 'tap').length}</dd></div>` : ''}
        ${hasNotes(s) ? `<div><dt>記錄則數</dt><dd>${notes(s).length}</dd></div>` : ''}
        ${isITC(s) ? itc.summaryItems(s) : ''}${isPTC(s) ? ptc.summaryItems(s) : ''}
      </dl>
    </section>
    <section class="panel"><header><h2>${isITC(s) ? '各輪分布' : isPTC(s) ? '移動路線' : '時間軸'}</h2><span class="hint">${tlHint}</span></header>
      <div class="tl" id="tl"></div></section>
    ${body}
    ${cloudPanel(s)}
    <section class="panel"><header><h2>匯出</h2><span class="hint">檔名只用英數字，任何系統都能正常開啟</span></header>
      <div class="exports">
        ${isPTC(s) ? '' : `<button class="btn exp" data-act="report"><span>觀課重點摘要（一頁）</span><span class="fn">可列印或存成 PDF</span></button>`}
        <button class="btn exp" data-act="exp-xlsx"><span>Excel 試算表</span><span class="fn">${n.xlsx}</span></button>
        <button class="btn exp" data-act="exp-png"><span>${isITC(s) ? '分布圖與對象 × 輪圖片' : isPTC(s) ? '路線圖（原始觀察記錄）' : '時間軸圖片'}</span><span class="fn">${n.png}</span></button>
        ${isPTC(s) ? `<label class="f anim-len" for="anim-sec">路線動畫長度（整節課壓縮成）<select id="anim-sec">
          <option value="10">10 秒</option><option value="20" selected>20 秒</option><option value="30">30 秒</option><option value="60">60 秒</option></select></label>
        <button class="btn exp" data-act="exp-mp4"><span>路線動畫影片（MP4）</span><span class="fn">${n.mp4}</span></button>
        <button class="btn exp" data-act="exp-gif"><span>路線動畫（GIF）</span><span class="fn">${n.gif}</span></button>` : ''}
        <button class="btn exp" data-act="exp-json"><span>備份檔（可匯入其他裝置）</span><span class="fn">${n.json}</span></button>
      </div>
    </section>
    <section class="panel"><details>
      <summary>觀課資訊</summary>
      <div class="fields" style="margin-top:12px">
        ${meta('title', '標題', 'full')}${meta('focus', '觀察焦點', 'full')}${meta('date', '日期')}${meta('school', '學校')}
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
    track('obs_export', { tool: s.mode, format: kind, sample: s.sample ? 'yes' : 'no' });
  } catch (e) {
    toast('匯出失敗：' + (e?.message || e), 5000);
  }
}

// PTC 路線動畫：MP4 給簡報與投影，GIF 給 LINE 或文件
async function exportAnim(kind) {
  const s = state.s;
  const n = names(s);
  const seconds = +(document.getElementById('anim-sec')?.value || 20);
  const ctl = new AbortController();
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="anim-h">
    <h2 id="anim-h">產生${kind === 'gif' ? ' GIF ' : '影片'}中…</h2>
    <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span style="width:0%"></span></div>
    <p class="hint num" id="anim-p">0%</p>
    <p class="hint">產生期間請停留在這個畫面${kind === 'gif' ? '' : '（部分瀏覽器需要即時錄製，時間約等於影片長度）'}。</p>
    <div class="modal-actions"><button class="btn" data-v="cancel">取消</button></div></div>`;
  wrap.querySelector('[data-v="cancel"]').addEventListener('click', () => ctl.abort());
  document.body.appendChild(wrap);
  const bar = wrap.querySelector('.progress span'), pbox = wrap.querySelector('.progress'), pct = wrap.querySelector('#anim-p');
  const onProgress = (f) => { const v = Math.round(f * 100); bar.style.width = v + '%'; pbox.setAttribute('aria-valuenow', v); pct.textContent = v + '%'; };
  keepAwake(true);
  try {
    if (kind === 'gif') {
      const blob = await gifBlob(s, { seconds, onProgress, signal: ctl.signal });
      download(blob, n.gif);
      toast(`已匯出 ${n.gif}（${(blob.size / 1048576).toFixed(1)} MB）`, 4000);
    } else {
      const { blob, ext } = await videoBlob(s, { seconds, onProgress, signal: ctl.signal });
      download(blob, n[ext]);
      toast(ext === 'mp4' ? `已匯出 ${n.mp4}（${(blob.size / 1048576).toFixed(1)} MB）` : `這個瀏覽器只能產生 WebM 影片，已匯出 ${n.webm}`, 5000);
    }
    track('obs_export', { tool: s.mode, format: kind, sample: s.sample ? 'yes' : 'no' });
  } catch (e) {
    if (e?.name !== 'AbortError') toast('動畫產生失敗：' + (e?.message || e), 6000);
  } finally {
    wrap.remove();
    keepAwake(false);
  }
}

// 觀課重點摘要：白底 A4 一頁，可列印或存成 PDF
function renderReport() {
  state.view = 'report';
  const s = state.s;
  const chart = timelineSVG(s, 700, printColors, { legend: true });
  app.innerHTML = `<div class="wrap report-wrap">${reportHTML(s, chart)}</div>`;
  window.scrollTo(0, 0);
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
    if (n) track('backup_import', { session_count: n });
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
  sample(el) { state.s = el.dataset.mode === 'PTC' ? samplePTC() : sampleSession(el.dataset.mode); track('obs_sample', { tool: el.dataset.mode }); renderResult(); },
  async 'g-signin'() {
    try {
      state.account = await gd.signIn();
      state.account.folderUrl = (await store.getSetting('googleFolder'))?.url;
      toast(`已連結 ${state.account.email}`);
    } catch (e) { toast(e.message || String(e), 6000); }
    renderHome();
  },
  async 'g-signout'() {
    if (!(await ask({ title: '登出 Google？', body: '登出後不會再自動存到雲端硬碟；已經存好的檔案仍會留在你的雲端硬碟。', ok: '登出' }))) return;
    await gd.signOut();
    state.account = null;
    renderHome();
  },
  'g-sync'() { syncNow(state.s, { interactive: true }); },
  async 'g-sync-all'(el) {
    try { await gd.getToken({ interactive: true }); } catch (e) { toast(e.message, 6000); return; }
    const list = (await store.all()).filter(gd.needsSync);
    el.disabled = true;
    let n = 0;
    for (const s of list) {
      el.textContent = `同步中 ${n + 1} / ${list.length}`;
      try { s.drive = await gd.syncSession(s); await save(s, { touch: false }); n++; } catch (e) { toast('同步中斷：' + e.message, 6000); break; }
    }
    if (n) toast(`已同步 ${n} 場觀課`);
    renderHome();
  },
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
  tap(el) {
    tapCode(el.dataset.code);
    if (el.classList.contains('chip')) document.getElementById('note-text')?.focus({ preventScroll: true });
  },
  undo: () => undoLast(),
  'itc-pick': (el) => itc.pick(el.dataset.code),
  'itc-next': () => itc.next(),
  'itc-undo': () => itc.undo(),
  async 'itc-cell'(el) {
    if (await itc.editCell(el.dataset.id)) {
      await save();
      renderResult();
      toast('已修改');
    }
  },
  send: () => sendNote(),
  stamp: () => insertStamp(),
  'reset-t0'() { setT0(nowT()); save(); document.getElementById('note-text')?.focus(); },
  'only-key'(el) {
    state.onlyKey = !state.onlyKey;
    el.setAttribute('aria-pressed', String(state.onlyKey));
    const f = document.getElementById('feed');
    if (f) f.innerHTML = feedHTML(state.s, { editable: !state.s.sample, newestFirst: false, onlyKey: state.onlyKey });
  },
  'edit-note'(el) {
    state.editNote = el.dataset.id;
    refreshNotes();
    const ta = document.getElementById('edit-' + el.dataset.id);
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  },
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
  'exp-mp4': () => exportAnim('mp4'),
  'brief-go'(el) {
    const sec = [...app.querySelectorAll('section.panel')].find((x) => x.querySelector('h2')?.textContent.trim() === el.dataset.go);
    if (!sec) return;
    sec.querySelector('details:not([open])')?.setAttribute('open', '');
    sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    sec.classList.remove('flash'); void sec.offsetWidth; sec.classList.add('flash');
  },
  report() { renderReport(); track('report_open', { tool: state.s.mode, sample: state.s.sample ? 'yes' : 'no' }); },
  'report-back'() { renderResult(); },
  'report-print'() { track('report_print', { tool: state.s.mode }); window.print(); },
  'exp-gif': () => exportAnim('gif'),
  async 'delete-session'() {
    if (!(await ask({ title: '刪除這場觀課？', body: `刪除後無法復原。如果還需要，請先匯出備份檔。${state.s.drive?.syncedAt ? '已存到雲端硬碟的檔案不會一起刪除。' : ''}`, ok: '刪除', danger: true }))) return;
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
    track('backup_all', { session_count: all.length });
  },
};

function refreshNotes() {
  if (state.view === 'record') refreshFeed();
  else if (state.editNote) {
    const f = document.getElementById('feed');
    if (f) f.innerHTML = feedHTML(state.s, { editable: !state.s.sample, newestFirst: false, onlyKey: !!state.onlyKey });
  } else {
    // 存檔或刪除後重畫整頁，讓觀課重點、時刻標記數量一起更新，並保留捲動位置
    const y = window.scrollY;
    renderResult();
    window.scrollTo(0, y);
  }
}

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.act];
  if (fn) fn(el, e);
  else if (el.dataset.act.startsWith('itc-')) itc.action(el.dataset.act, el, e);
  else if (el.dataset.act.startsWith('ptc-')) ptc.action(el.dataset.act, el, e);
});

app.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'note-text') return onNoteInput(t);
  if (state.view === 'setup' && t.dataset.meta) state.draft.meta[t.dataset.meta] = t.value;
  if (state.view === 'setup' && t.id?.startsWith('itc-')) itc.onSetupInput(t);
  if (t.id?.startsWith('ptc-') || t.dataset?.ptcA || t.dataset?.ptcKind) ptc.onInput(t);
  if (state.view === 'setup' && t.dataset.field === 'task') state.draft.codes[+t.dataset.i].task = t.value;
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
  if (t.id === 'preset' && t.value && isITC(state.draft)) {
    const p = ITC_PRESETS.find((x) => x.id === t.value);
    state.draft.codes = itcPresetCodes(p).map((c) => ({ id: 'c' + uid(), ...c }));
    t.value = '';
    refreshCodes();
    toast(`已套用「${p.name}」`);
    return;
  }
  if (t.id === 'preset' && t.value) {
    const p = PRESETS.find((x) => x.id === t.value);
    state.draft.codes = p.codes.map(([label, kind], i) => ({ id: 'c' + uid(), label, kind, color: PALETTE[i] }));
    state.draft.exclusive = !!p.exclusive;
    const ex = document.getElementById('exclusive');
    if (ex) ex.checked = state.draft.exclusive;
    t.value = '';
    refreshCodes();
    toast(`已套用「${p.name}」${p.exclusive ? '，並開啟互斥' : ''}`);
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
  if (isITC(state.s)) {
    // 用 Tab 移到按鈕上時，Enter 照常按下該按鈕；滑鼠點過留下的焦點則當作「下一位」
    if (e.key === 'Enter' && t.matches?.('button, a') && (t.matches(':focus-visible') || t.closest('.modal'))) return;
    if (itc.onKey(e, t.matches?.('input, textarea, select'))) e.preventDefault();
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
document.documentElement.addEventListener('obs-theme', () => { if (state.view === 'result') renderTimeline(); });

// ---------- 啟動 ----------
itc.init({ state, app, save, toast, esc, vibrate, nowT, parseLabels, ask });
ptc.init({ state, app, save, toast, esc, vibrate, nowT, ask, themeColors, rerender: () => renderResult() });

(async () => {
  state.persistent = await store.ready();
  if (gd.available()) {
    state.account = await gd.account();
    if (state.account) state.account.folderUrl = (await store.getSetting('googleFolder'))?.url;
    if (navigator.onLine) gd.loadGis().catch(() => {}); // 先載入，按登入時視窗才不會被擋
  }
  await renderHome();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    const hadController = !!navigator.serviceWorker.controller;
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      // 回到畫面時檢查是否有新版
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    } catch (e) { /* 預覽環境不支援時略過 */ }
    // 新版接手後：在首頁或結果頁就立即重新載入；記錄中則等回到首頁再套用，不打斷觀課
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return; // 第一次安裝不需要重新載入
      if (state.view === 'home' || state.view === 'result') location.reload();
      else state.updateReady = true;
    });
  }
})();
