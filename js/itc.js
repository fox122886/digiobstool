// ITC 間隔時間線標記：記錄畫面、結果頁區塊
// 計時一律以「課堂經過時間」（扣除暫停）計算，倒數不受手機鎖屏或背景節流影響
import {
  ITC_INTERVALS, ITC_MAX_N, uid, fmt, clockHMS, wallTime, isRunning, isPaused,
  samples, itcPos, itcStats, objName, objShort,
} from './model.js';

let C; // 由 app.js 注入：state, app, save, toast, esc, vibrate, nowT, ask
export function init(ctx) { C = ctx; }

const esc = (x) => C.esc(x);
const codeIndex = (s, id) => s.codes.findIndex((c) => c.id === id);

// ---------- 設定頁 ----------
export function setupPanel(s) {
  const it = s.itc;
  const opts = ITC_INTERVALS.map((v) => `<option value="${v}" ${v === it.interval ? 'selected' : ''}>${v ? `每位 ${v} 秒（自動倒數）` : '手動（每位觀察完按一下）'}</option>`).join('');
  return `<section class="panel">
    <header><h2>觀察對象與間隔</h2></header>
    <div class="fields">
      <label class="f" for="itc-n">觀察人數
        <input type="number" id="itc-n" inputmode="numeric" min="1" max="${ITC_MAX_N}" value="${it.labels ? it.labels.length : it.n}" ${it.labels ? 'disabled' : ''}></label>
      <label class="f" for="itc-int">取樣間隔<select id="itc-int">${opts}</select></label>
      <label class="f full" for="itc-labels">座號或代號（選填）
        <input type="text" id="itc-labels" value="${esc((it.labels || []).join(', '))}" placeholder="例如 3, 7, 12, 15；留白則依 1、2、3… 編號"></label>
    </div>
    <p class="hint">依序輪流觀察每一位，全部觀察一次為一輪，觀察到下課或按「結束」為止。填了座號就依填寫順序觀察，人數自動帶入。</p>
    <p class="hint">建議先準備座位表、決定觀察範圍。第一次使用建議選手動，或從 10 秒開始；倒數最後 3 秒會閃爍並震動提醒。</p>
    <p class="err" id="itc-err" hidden></p>
  </section>`;
}

export function readSetup(s) {
  const labels = (C.parseLabels(document.getElementById('itc-labels')?.value || ''));
  const n = labels.length || parseInt(document.getElementById('itc-n')?.value, 10);
  const interval = parseInt(document.getElementById('itc-int')?.value, 10) || 0;
  if (!Number.isFinite(n) || n < 1 || n > ITC_MAX_N) return `觀察人數請填 1 到 ${ITC_MAX_N}。`;
  if (labels.length && new Set(labels).size !== labels.length) return '座號或代號有重複，請檢查。';
  s.itc = { ...s.itc, n, labels: labels.length ? labels : null, interval, cur: { t0: null, sel: null } };
  return '';
}

export function onSetupInput(t) {
  if (t.id === 'itc-labels') {
    const labels = C.parseLabels(t.value);
    const nEl = document.getElementById('itc-n');
    if (labels.length) { nEl.value = labels.length; nEl.disabled = true; } else nEl.disabled = false;
  }
  const err = document.getElementById('itc-err');
  if (err) err.hidden = true;
}

// ---------- 記錄畫面 ----------
function strip(s) {
  const { round, obj } = itcPos(s);
  const sm = samples(s).filter((e) => e.round === round);
  return Array.from({ length: s.itc.n }, (_, i) => {
    const e = sm.find((x) => x.obj === i);
    const c = e && s.codes[codeIndex(s, e.code)];
    const cls = e ? (c ? 'done' : 'done none') : i === obj && s.status !== 'ready' ? 'now' : '';
    return `<span class="cell ${cls}" style="${c ? `--c:${c.color}` : ''}" title="${esc(objName(s, i))}">${esc(objShort(s, i))}</span>`;
  }).join('');
}

function buttons(s) {
  const auto = s.itc.interval > 0;
  const sel = s.itc.cur?.sel;
  const running = isRunning(s);
  const counts = {};
  for (const e of samples(s)) counts[e.code] = (counts[e.code] || 0) + 1;
  return s.codes.map((c, i) => `<button class="code ${auto && sel === c.id ? 'on' : ''}" style="--c:${c.color}" data-act="itc-pick" data-code="${c.id}"
      ${running ? '' : 'disabled'} aria-pressed="${auto ? String(sel === c.id) : 'false'}">
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

export function body(s) {
  const auto = s.itc.interval > 0;
  const { round, obj } = itcPos(s);
  const ready = s.status === 'ready';
  const next = (obj + 1) % s.itc.n;
  return `<section class="itc-now ${auto ? 'auto' : 'manual'}" id="itc-now">
      <div class="who">
        <span class="lab">第 <b id="itc-round">${round}</b> 輪 · <span class="num" id="itc-prog">${obj + 1} / ${s.itc.n}</span></span>
        <span class="obj" id="itc-obj">${esc(objName(s, obj))}</span>
        <span class="lab">下一位：<span id="itc-next">${esc(objName(s, next))}</span></span>
      </div>
      <div class="cd-box">
        <span class="cd num" id="itc-cd">${ready ? (auto ? fmt(s.itc.interval) : '00:00') : ''}</span>
        <span class="lab" id="itc-cd-lab">${auto ? '倒數' : '已觀察'}</span>
      </div>
    </section>
    <div class="itc-strip" id="itc-strip" aria-label="本輪進度">${strip(s)}</div>
    ${ready ? `<p class="ready-note">${auto ? `按「開始計時」後，每位觀察 ${s.itc.interval} 秒，觀察中按下符合的類別，時間到自動記錄並換下一位；沒有按就記為「未記錄」。`
      : '按「開始計時」後，觀察完一位就按下符合的類別，會立即記錄並換下一位。'}${matchMedia('(pointer: fine)').matches ? '電腦上也可以用數字鍵 1–0。' : ''}</p>` : ''}
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
  tick();
}

function refreshParts() {
  const s = C.state.s;
  const { round, obj } = itcPos(s);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('itc-round', round);
  set('itc-prog', `${obj + 1} / ${s.itc.n}`);
  set('itc-obj', objName(s, obj));
  set('itc-next', objName(s, (obj + 1) % s.itc.n));
  const g = document.getElementById('itc-grid'); if (g) g.innerHTML = buttons(s);
  const st = document.getElementById('itc-strip'); if (st) st.innerHTML = strip(s);
  const rb = document.getElementById('itc-recent-box'); if (rb) rb.innerHTML = recent(s);
  const u = C.app.querySelector('[data-act="itc-undo"]'); if (u) u.disabled = !samples(s).length;
  document.getElementById('itc-now')?.classList.remove('warn');
  const now = document.getElementById('itc-obj');
  if (now) { now.classList.remove('pop'); void now.offsetWidth; now.classList.add('pop'); }
}

// 開始計時時呼叫
export function onStart(s) { s.itc.cur = { t0: 0, sel: null }; }

function record(code, t) {
  const s = C.state.s;
  const { round, obj } = itcPos(s);
  s.events.push({ id: uid(), type: 'sample', round, obj, code: code || null, t0: s.itc.cur.t0 ?? t, t });
  s.itc.cur = { t0: t, sel: null };
}

// 每 250 毫秒呼叫一次：更新倒數；時間到就記錄並換下一位
export function tick() {
  const s = C.state.s;
  if (!s || s.mode !== 'ITC' || s.status !== 'recording') return;
  const auto = s.itc.interval > 0;
  const t = C.nowT();
  const cur = s.itc.cur;
  if (cur.t0 == null) cur.t0 = t;
  const cd = document.getElementById('itc-cd');
  if (!auto) { if (cd) cd.textContent = fmt(t - cur.t0); return; }
  if (!isRunning(s)) { if (cd) cd.textContent = fmt(Math.ceil(Math.max(0, s.itc.interval - (t - cur.t0)))); return; }
  const I = s.itc.interval;
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
  if (n) { C.vibrate(40); C.save(); refreshParts(); }
  const left = Math.max(0, I - (t - s.itc.cur.t0));
  if (cd) cd.textContent = fmt(Math.ceil(left));
  const box = document.getElementById('itc-now');
  if (box) box.classList.toggle('warn', I >= 5 && left <= 3);
}

export function pick(id) {
  const s = C.state.s;
  if (!isRunning(s)) return;
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
    <div><dt>取樣間隔</dt><dd>${s.itc.interval ? `${s.itc.interval} 秒` : '手動'}</dd></div>`;
}

export function resultBody(s) {
  const st = itcStats(s);
  const max = Math.max(...st.byCode.map((r) => r.pct), st.total ? st.none / st.total : 0, 0.0001);
  const pct = (a) => (st.total ? `${((a / st.total) * 100).toFixed(1)}%` : '—');
  const legend = s.codes.map((c, i) => `<span><span class="itc-sw" style="--c:${c.color}">${i + 1}</span>${esc(c.label)}</span>`).join('')
    + '<span><span class="itc-sw none">–</span>未記錄</span>';
  const matrix = st.rounds.length ? `<div class="tbl-wrap itc-matrix-wrap"><table class="itc-matrix">
      <thead><tr><th>對象</th>${st.rounds.map((r) => `<th class="n" title="${clockHMS(wallTime(s, r.start))} 開始">${r.round}</th>`).join('')}</tr></thead>
      <tbody>${st.perObj.map((o) => `<tr><th scope="row">${esc(o.name)}</th>${st.rounds.map((r) => {
        const e = r.items.find((x) => x.obj === o.i);
        if (!e) return '<td></td>';
        const ci = codeIndex(s, e.code);
        const c = s.codes[ci];
        const label = `第${r.round}輪 ${o.name}：${c ? c.label : '未記錄'}（${clockHMS(wallTime(s, e.t))}）`;
        return `<td><button class="itc-cell ${c ? '' : 'none'}" style="${c ? `--c:${c.color}` : ''}" data-act="itc-cell" data-id="${e.id}" ${s.sample ? 'disabled' : ''}
          title="${esc(label)}" aria-label="${esc(label)}">${c ? ci + 1 : '–'}</button></td>`;
      }).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="hint">沒有任何記錄。</p>';

  return `<section class="panel"><header><h2>各類別人次</h2><span class="hint num">共 ${st.total} 人次</span></header>
      <div class="tbl-wrap"><table>
        <thead><tr><th>類別</th><th class="n">人次</th><th class="n">比例</th><th style="width:36%"></th></tr></thead>
        <tbody>${st.byCode.map((r) => `<tr><td><span class="dot" style="--c:${r.code.color}"></span>${esc(r.code.label)}</td><td class="n">${r.count}</td>
          <td class="n">${pct(r.count)}</td><td class="bar-cell"><span style="--c:${r.code.color};width:${(r.pct / max) * 100}%"></span></td></tr>`).join('')}
          ${st.none ? `<tr><td><span class="dot none"></span>未記錄</td><td class="n">${st.none}</td><td class="n">${pct(st.none)}</td><td></td></tr>` : ''}
        </tbody></table></div></section>
    <section class="panel"><header><h2>對象 × 輪</h2><span class="hint">${s.sample ? '每一格是該位在該輪的類別' : '點格子可以修改該筆記錄'}</span></header>
      <div class="itc-legend">${legend}</div>
      ${matrix}</section>
    <section class="panel"><details><summary>各輪明細</summary>
      <div class="tbl-wrap"><table>
        <thead><tr><th>輪</th><th class="n">時刻</th>${s.codes.map((c, i) => `<th class="n" title="${esc(c.label)}">${i + 1}</th>`).join('')}<th class="n">未記錄</th><th class="n">小計</th></tr></thead>
        <tbody>${st.rounds.map((r) => `<tr><td>${r.round}${r.complete ? '' : ' <span class="hint">未滿</span>'}</td>
          <td class="n">${clockHMS(wallTime(s, r.start))}–${clockHMS(wallTime(s, r.end))}</td>
          ${s.codes.map((c) => `<td class="n">${r.counts[c.id] || ''}</td>`).join('')}<td class="n">${r.none || ''}</td><td class="n">${r.size}</td></tr>`).join('')}</tbody>
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
      <p class="hint">記錄於 ${clockHMS(wallTime(s, e.t))}，請選擇正確的類別。</p>
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
  return `${s.itc.n} 位對象、${st.rounds.length} 輪`;
}
