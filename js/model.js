// 觀課資料模型與計算（純函式，方便測試）
export const APP_VERSION = '2.0.0-alpha';

export const MODES = {
  UTC: { tag: 'UTC', name: '通用時間線標記', full: '通用時間線標記數位觀課工具', en: 'Universal timeline coding' },
  ATC: { tag: 'ATC', name: '軼事記錄時間線標記', full: '軼事記錄時間線標記數位觀課工具', en: 'Anecdotal timeline coding' },
  DTC: { tag: 'DTC', name: '質量雙元時間線標記', full: '質量雙元時間線標記數位觀課工具', en: 'Duality timeline coding' },
  ITC: { tag: 'ITC', name: '間隔時間線標記', full: '間隔時間線標記數位觀課工具', en: 'Interval timeline coding' },
  PTC: { tag: 'PTC', name: '教師移動路徑標記', full: '教師移動路徑標記數位觀課工具（雛形）', en: 'Path timeline coding' },
};

// 12 色：亮暗主題下白字皆可讀
export const PALETTE = ['#2F6FB3', '#C2572B', '#2E8B57', '#8E4FB0', '#9A6B00', '#C23B6E',
  '#2A8A96', '#6B6F2A', '#5A5FCB', '#A0522D', '#1F7A7A', '#7A4E9C'];

export const PRESETS = [
  { id: 'interaction', name: '範例：師生互動', codes: [
    ['教師講述', 'duration'], ['教師提問', 'duration'], ['學生回答', 'duration'],
    ['學生提問', 'duration'], ['小組討論', 'duration'], ['個別練習', 'duration']] },
  { id: 'management', name: '範例：班級經營', codes: [
    ['教學活動', 'duration'], ['轉換時間', 'duration'], ['秩序提醒', 'event'], ['正向回饋', 'event']] },
  // 以下取自原 UTC 使用說明與「100道焦點問題」的分類參考
  { id: 'fiac', name: '佛蘭德斯互動分析（FIAC）', exclusive: true, codes: [
    ['接納感受', 'duration'], ['稱讚鼓勵', 'duration'], ['採納學生想法', 'duration'], ['教師提問', 'duration'], ['講述', 'duration'],
    ['給予指示', 'duration'], ['批評或維護權威', 'duration'], ['學生被動發言', 'duration'], ['學生主動發言', 'duration'], ['停頓、沉默或混亂', 'duration']] },
  { id: 'student', name: '教學情境＋個別學生行為', codes: [
    ['GI-1 單向教學', 'duration'], ['GI-2 雙向互動', 'duration'], ['GA 分組活動', 'duration'], ['IL 個別學習', 'duration'],
    ['I 積極主動', 'duration'], ['E 被動努力', 'duration'], ['N 不專心', 'duration'], ['D 干擾行為', 'duration']] },
  { id: 'two-students', name: '兩位個別學生行為', codes: [
    ['A生 I 積極主動', 'duration'], ['A生 E 被動努力', 'duration'], ['A生 N 不專心', 'duration'], ['A生 D 干擾', 'duration'],
    ['B生 I 積極主動', 'duration'], ['B生 E 被動努力', 'duration'], ['B生 N 不專心', 'duration'], ['B生 D 干擾', 'duration']] },
  { id: 'group-roles', name: '小組討論：依職務的發言', codes: [
    ['組長發言', 'duration'], ['記錄發言', 'duration'], ['報告發言', 'duration'], ['提問員發言', 'duration'],
    ['靜默', 'duration'], ['離題', 'duration'], ['正題', 'duration']] },
  { id: 'blank', name: '空白（兩個按鈕）', codes: [['代碼 1', 'duration'], ['代碼 2', 'duration']] },
];

export const MAX_CODES = 12;

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = (n) => String(n).padStart(2, '0');

export function fmt(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
export function fmtHMS(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`;
}
export function fmtDur(sec) {
  sec = Math.round(sec || 0);
  if (sec < 60) return `${sec} 秒`;
  const m = Math.floor(sec / 60), s = sec % 60;
  return s ? `${m} 分 ${s} 秒` : `${m} 分`;
}
export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function clockTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function newSession(mode, codes = []) {
  const now = Date.now();
  return {
    id: uid(), app: APP_VERSION, mode, status: 'ready',
    meta: { date: todayISO(), title: '', school: '', className: '', subject: '', teacher: '', observer: '', note: '' },
    codes: codes.map((c, i) => ({ id: 'c' + (i + 1) + uid().slice(-3), label: c.label, kind: c.kind, color: c.color || PALETTE[i % PALETTE.length], ...(c.task ? { task: c.task } : {}) })),
    clock: { startedAt: null, pauses: [], endedAt: null },
    events: [],
    exclusive: false, // 持續型代碼互斥：開始一個就結束其他
    draft: { text: '', t0: null },
    createdAt: now, updatedAt: now,
  };
}

// 課堂經過時間（毫秒）：扣除暫停，以時間戳計算，不受背景節流影響
export function elapsedMs(s, now = Date.now()) {
  const c = s.clock;
  if (!c.startedAt) return 0;
  const end = c.endedAt ?? now;
  let paused = 0;
  for (const [a, b] of c.pauses) paused += Math.max(0, Math.min(b ?? end, end) - a);
  return Math.max(0, end - c.startedAt - paused);
}
export const elapsedSec = (s, now) => Math.round(elapsedMs(s, now) / 100) / 10;

// 課堂經過秒數 → 實際時鐘時刻（毫秒），會把暫停的時間加回去
export function wallTime(s, t) {
  const c = s.clock;
  if (!c.startedAt) return null;
  let cur = c.startedAt;
  let left = t * 1000;
  for (const [a, b] of c.pauses) {
    const active = a - cur;
    if (left <= active) return cur + left;
    left -= active;
    cur = b ?? a;
  }
  return cur + left;
}
export function clockHMS(ms) {
  if (ms == null) return '';
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
export const isPaused = (s) => { const p = s.clock.pauses; return p.length > 0 && p[p.length - 1][1] == null; };
export const isRunning = (s) => s.status === 'recording' && !isPaused(s);

export function codeOf(s, id) { return s.codes.find((c) => c.id === id); }

export function openCodes(s) {
  const open = new Map();
  for (const e of s.events) {
    if (e.type === 'on' && !open.has(e.code)) open.set(e.code, e.t);
    else if (e.type === 'off') open.delete(e.code);
  }
  return open; // code id -> start t
}

export function totalSec(s) {
  return elapsedSec(s);
}

// 將事件整理成「區段」與「單次」：on/off 配對，未結束的區段以目前時間收尾
export function segments(s, endT = totalSec(s)) {
  const evs = [...s.events].sort((a, b) => a.t - b.t);
  const open = new Map();
  const segs = [], taps = [];
  for (const e of evs) {
    if (e.type === 'on') {
      if (!open.has(e.code)) open.set(e.code, e);
    } else if (e.type === 'off') {
      const on = open.get(e.code);
      if (on) { segs.push({ code: e.code, start: on.t, end: e.t, onId: on.id, offId: e.id }); open.delete(e.code); }
    } else if (e.type === 'tap') {
      taps.push({ code: e.code, t: e.t, id: e.id });
    }
  }
  for (const [code, on] of open) segs.push({ code, start: on.t, end: Math.max(on.t, endT), onId: on.id, offId: null, open: true });
  segs.sort((a, b) => a.start - b.start);
  return { segs, taps };
}

export function stats(s) {
  const total = totalSec(s);
  const { segs, taps } = segments(s, total);
  return s.codes.map((c) => {
    if (c.kind === 'event') {
      const n = taps.filter((t) => t.code === c.id).length;
      return { code: c, count: n, total: null, pct: null, avg: null, perMin: total ? n / (total / 60) : 0 };
    }
    const mine = segs.filter((g) => g.code === c.id);
    const sum = mine.reduce((a, g) => a + (g.end - g.start), 0);
    return { code: c, count: mine.length, total: sum, pct: total ? sum / total : 0, avg: mine.length ? sum / mine.length : 0 };
  });
}

// 文字中插入的時刻 [HH:MM:SS] 視為「關鍵時刻標記」
export const STAMP_RE = /\[(\d{1,2}):(\d{2}):(\d{2})\]/g;
// 時鐘時刻換回課堂經過秒數（扣除暫停）
export function clockToT(s, h, m, sec) {
  const c = s.clock;
  if (!c.startedAt) return null;
  const d = new Date(c.startedAt);
  d.setHours(h, m, sec, 0);
  let target = d.getTime();
  if (target < c.startedAt - 60e3) target += 864e5; // 跨午夜
  let paused = 0;
  for (const [a, b] of c.pauses) paused += Math.max(0, Math.min(b ?? target, target) - a);
  return Math.max(0, (target - c.startedAt - paused) / 1000);
}
export function noteStamps(s, n) {
  return [...String(n.text || '').matchAll(STAMP_RE)].map((m) => ({ hms: `${m[1].padStart(2, '0')}:${m[2]}:${m[3]}`, t: clockToT(s, +m[1], +m[2], +m[3]) ?? n.t }));
}
export const hasStamp = (n) => /\[\d{1,2}:\d{2}:\d{2}\]/.test(n.text || '');
export const isBareMark = (n) => hasStamp(n) && !String(n.text).replace(STAMP_RE, '').trim();

export function notes(s) {
  return s.events.filter((e) => e.type === 'note').sort((a, b) => a.t - b.t);
}

// 純 ASCII 檔名：模式_日期_時間
export function fileBase(s) {
  const d = new Date(s.clock.startedAt || s.createdAt);
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${s.mode}_${stamp}`.replace(/[^A-Za-z0-9_-]/g, '_');
}

export function displayTitle(s) {
  const m = s.meta;
  if (m.title) return m.title;
  const bits = [m.className, m.subject].filter(Boolean).join(' ');
  return bits || `${MODES[s.mode].name}觀課`;
}

// 範例資料（標示為範例，用於試看結果頁）
export function sampleSession(mode) {
  if (mode === 'ITC') return sampleITC();
  const base = new Date(); base.setHours(10, 10, 0, 0); base.setDate(base.getDate() - 1);
  const preset = PRESETS[0].codes.map(([label, kind], i) => ({ label, kind, color: PALETTE[i] }));
  const s = newSession(mode, mode !== 'ATC' ? [...preset.slice(0, 5), { label: '學生舉手', kind: 'event', color: PALETTE[5] }] : []);
  s.sample = true;
  s.status = 'ended';
  s.meta = { ...s.meta, date: todayISO(base), title: '範例：五年甲班 數學「分數的加法」', school: '範例國小', className: '五年甲班', subject: '數學', teacher: '王老師', observer: '林老師' };
  s.clock.startedAt = base.getTime();
  const dur = 40 * 60;
  s.clock.endedAt = base.getTime() + dur * 1000;
  let n = 0;
  const ev = (type, t, extra = {}) => s.events.push({ id: 'e' + (++n), type, t, ...extra });
  if (mode !== 'ATC') {
    const [lec, ask, ans, , grp] = s.codes.map((c) => c.id);
    const tap = s.codes[5].id;
    const plan = [[lec, 0, 300], [ask, 300, 360], [ans, 360, 450], [ask, 450, 500], [ans, 500, 600], [lec, 600, 840],
      [grp, 840, 1500], [ask, 1500, 1560], [ans, 1560, 1740], [lec, 1740, 1980], [ask, 1980, 2040], [ans, 2040, 2220], [lec, 2220, 2400]];
    for (const [c, a, b] of plan) { ev('on', a, { code: c }); ev('off', b, { code: c }); }
    for (const t of [310, 455, 1505, 1520, 1990, 2000, 2010]) ev('tap', t, { code: tap });
    if (s.codes[3]) { ev('on', 1200, { code: s.codes[3].id }); ev('off', 1260, { code: s.codes[3].id }); }
  }
  if (mode !== 'UTC') {
    const items = [
      [62, 95, '教師以生活情境（分披薩）引起動機，多數學生專注抬頭。'],
      [310, 352, '提問「1/2 加 1/3 可以直接相加嗎？」第 3 排三位學生回答「2/5」。'],
      [540, 590, '教師未直接糾正，請學生用圖形表示，[10:19:12] 12 號自行發現錯誤。'],
      [900, 965, '小組討論：第 2 組由 7 號主導，其他成員參與較少。'],
      [1380, 1430, '巡視時對第 5 組提供提示卡，討論重新熱絡。'],
      [1820, 1880, '[10:40:35] 分享時 12 號主動上台說明通分的理由，用詞精準。'],
      [2100, 2103, '[10:45:00] '],
      [2280, 2340, '收尾以出口卡檢核，約有 4 位學生仍以分子分母各自相加。'],
    ];
    for (const [t0, t, text] of items) ev('note', t, { t0, text });
  }
  s.updatedAt = s.clock.endedAt;
  return s;
}

// ================= ITC 間隔時間線標記（時間抽樣） =================
// 依序輪流觀察 n 位對象；每位觀察一段時間後記下一個類別，全部觀察一次為一輪
export const ITC_INTERVALS = [0, 3, 5, 10, 15, 20, 30]; // 0 = 手動
export const ITC_MAX_N = 60;

// 「在工作中」類別：綠＝主動投入、青＝被動、藍＝求助、灰＝無法判斷、橘＝不在工作中、紅＝干擾
const ON_TASK_COLORS = ['#2E8B57', '#2A8A96', '#2F6FB3', '#6E747A', '#C2572B', '#A8324A'];
// task：計算「在工作中率」時的歸屬。on＝在工作中、off＝不在工作中、skip＝不計入
export const ITC_PRESETS = [
  { id: 'on-task', name: '學生在工作中（預設）', codes: ['主動在工作中', '被動在工作中', '尋求協助', '無法判斷', '不在工作中', '干擾行為'], colors: ON_TASK_COLORS, task: ['on', 'on', 'on', 'skip', 'off', 'off'] },
  { id: 'engage', name: '參與程度 A–F', codes: ['A 主動參與', 'B 任務被動', 'C 尋求協助', 'D 未能聚焦', 'E 未參與', 'F 不良行為'], colors: ON_TASK_COLORS, task: ['on', 'on', 'on', 'off', 'off', 'off'] },
  { id: 'tdo', name: '教專「在工作中」A／H／O（工具 5）', codes: ['A 專注認真', 'H 尋求協助', 'O 非工作中', '其他'], colors: ['#2E8B57', '#2F6FB3', '#C2572B', '#6E747A'], task: ['on', 'on', 'off', 'skip'] },
  { id: 'on-off', name: '在工作中／不在工作中', codes: ['在工作中', '不在工作中'], colors: ['#2E8B57', '#C2572B'], task: ['on', 'off'] },
  { id: 'activity', name: '數位學習活動', codes: ['聽講與回應', '看課本', '看平板', '看大螢幕', '寫練習題', '其他'] },
];
export const itcPresetCodes = (p) => p.codes.map((label, i) => ({ label, kind: 'event', color: p.colors?.[i] || PALETTE[i % PALETTE.length], task: p.task?.[i] || 'skip' }));
export const ITC_TASKS = [['on', '在工作中'], ['off', '不在工作中'], ['skip', '不計入']];
export const ITC_ACTS = ['講述', '提問討論', '小組活動', '個別練習', '轉換／其他'];
export const ITC_ACT_COLORS = ['#5B7FA6', '#B0813A', '#3E8E6E', '#8A6BB0', '#8C8C8C', '#B5566B', '#4F9AA8', '#9A8A3A'];
export const ITC_SEAT_ORDERS = [['row', '橫向逐排'], ['snake', '橫向 S 形'], ['col', '直向逐行'], ['colsnake', '直向 S 形']];

export function parseLabels(text) {
  return String(text || '').split(/[\s,，、;；]+/).map((x) => x.trim()).filter(Boolean).slice(0, ITC_MAX_N);
}

export const samples = (s) => s.events.filter((e) => e.type === 'sample');
export const objName = (s, i) => (s.itc.labels?.[i] ? s.itc.labels[i] : `${i + 1} 號`);
export const objShort = (s, i) => (s.itc.labels?.[i] ? s.itc.labels[i] : String(i + 1));
export const isSeat = (s) => s.itc?.layout === 'seat';

// 座位表：r＝第幾排（0＝最前排，靠講台），c＝由左而右第幾個（觀課者站在教室後方看過去）
export function seatOrder(rows, cols, empty, pattern = 'snake', from = 'front') {
  const skip = new Set(empty || []);
  const R = [...Array(rows).keys()];
  const Cs = [...Array(cols).keys()];
  if (from === 'back') R.reverse();
  const out = [];
  if (pattern === 'row' || pattern === 'snake') {
    R.forEach((r, k) => { const cs = pattern === 'snake' && k % 2 ? [...Cs].reverse() : Cs; for (const c of cs) out.push({ r, c }); });
  } else {
    Cs.forEach((c, k) => { const rs = pattern === 'colsnake' && k % 2 ? [...R].reverse() : R; for (const r of rs) out.push({ r, c }); });
  }
  return out.filter((p) => !skip.has(`${p.r},${p.c}`));
}

// 下一筆要記錄的輪次與對象：從上一筆的位置往後找第一位沒有缺席的對象
export function itcPos(s) {
  const sm = samples(s);
  const k = sm.length;
  const n = s.itc.n;
  const ab = new Set(s.itc.absent || []);
  if (!k) {
    for (let o = 0; o < n; o++) if (!ab.has(o)) return { k, round: 1, obj: o };
    return { k, round: 1, obj: 0 };
  }
  const last = sm[k - 1];
  for (let j = 1; j <= n; j++) {
    const o = (last.obj + j) % n;
    if (!ab.has(o)) return { k, round: last.round + Math.floor((last.obj + j) / n), obj: o };
  }
  return { k, round: last.round + 1, obj: last.obj };
}

export const taskOf = (s, codeId) => s.codes.find((c) => c.id === codeId)?.task || 'skip';
export const hasRate = (s) => s.codes.some((c) => c.task === 'on');
// 在工作中率＝在工作中 ÷（在工作中＋不在工作中）；不計入與未記錄不列入分母
export function onRate(s, list) {
  let on = 0, off = 0;
  for (const e of list) { const k = taskOf(s, e.code); if (k === 'on') on++; else if (k === 'off') off++; }
  return on + off ? on / (on + off) : null;
}

// 教學活動時段：由 act 事件切出
export function actSegments(s) {
  const acts = s.events.filter((e) => e.type === 'act').sort((a, b) => a.t - b.t);
  const end = Math.max(totalSec(s), ...samples(s).map((e) => e.t), 0);
  return acts.map((a, i) => ({ label: a.label, start: a.t, end: i + 1 < acts.length ? acts[i + 1].t : end })).filter((g) => g.end > g.start);
}
export const actColor = (s, label) => ITC_ACT_COLORS[Math.max(0, (s.itc.acts || []).indexOf(label)) % ITC_ACT_COLORS.length];

export function itcStats(s) {
  const sm = samples(s);
  const n = s.itc.n;
  const total = sm.length;
  const byCode = s.codes.map((c) => {
    const count = sm.filter((e) => e.code === c.id).length;
    return { code: c, count, pct: total ? count / total : 0 };
  });
  const none = sm.filter((e) => !e.code).length;
  const roundMap = new Map();
  for (const e of sm) {
    if (!roundMap.has(e.round)) roundMap.set(e.round, []);
    roundMap.get(e.round).push(e);
  }
  const present = n - (s.itc.absent || []).length;
  const lastRound = Math.max(0, ...roundMap.keys());
  const rounds = [...roundMap.entries()].sort((a, b) => a[0] - b[0]).map(([round, items]) => {
    const counts = {};
    for (const c of s.codes) counts[c.id] = 0;
    let rNone = 0;
    for (const e of items) { if (e.code && counts[e.code] != null) counts[e.code]++; else rNone++; }
    const acts = {};
    for (const e of items) if (e.act) acts[e.act] = (acts[e.act] || 0) + 1;
    const act = Object.entries(acts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    return {
      round, items, counts, none: rNone, size: items.length, complete: round < lastRound || items.length >= present,
      start: Math.min(...items.map((e) => e.t0 ?? e.t)), end: Math.max(...items.map((e) => e.t)), rate: onRate(s, items), act,
    };
  });
  const perObj = Array.from({ length: n }, (_, i) => {
    const mine = sm.filter((e) => e.obj === i);
    const counts = {};
    for (const c of s.codes) counts[c.id] = mine.filter((e) => e.code === c.id).length;
    return { i, name: objName(s, i), counts, none: mine.filter((e) => !e.code).length, total: mine.length, rate: onRate(s, mine), seat: s.itc.pos?.[i] || null };
  });
  const segs = actSegments(s);
  const byAct = (s.itc.acts || []).map((label) => {
    const mine = sm.filter((e) => e.act === label);
    const counts = {};
    for (const c of s.codes) counts[c.id] = mine.filter((e) => e.code === c.id).length;
    const dur = segs.filter((g) => g.label === label).reduce((a, g) => a + g.end - g.start, 0);
    return { label, total: mine.length, counts, none: mine.filter((e) => !e.code).length, rate: onRate(s, mine), dur, times: segs.filter((g) => g.label === label).length };
  }).filter((a) => a.total || a.dur);
  return { total, byCode, none, rounds, perObj, rate: onRate(s, sm), byAct, segs };
}

// 範例：10 位學生、每位 20 秒、40 分鐘（12 輪）；3 號、8 號較常分心，小組活動時段主動比例較高
function sampleITC() {
  const base = new Date(); base.setHours(10, 10, 0, 0); base.setDate(base.getDate() - 1);
  const s = newSession('ITC', itcPresetCodes(ITC_PRESETS[0]));
  s.sample = true;
  s.status = 'ended';
  s.meta = { ...s.meta, date: todayISO(base), title: '範例：六年丙班 社會「地方的產業」', school: '範例國小', className: '六年丙班', subject: '社會', teacher: '陳老師', observer: '林老師' };
  // 座位表：4 排 × 3 個座位，最後一排右邊兩個是空位，共 10 位；橫向 S 形、從前排開始
  const seat = { rows: 4, cols: 3, empty: ['3,1', '3,2'], order: 'snake', from: 'front', labels: {} };
  const pos = seatOrder(seat.rows, seat.cols, seat.empty, seat.order, seat.from);
  s.itc = { n: pos.length, labels: null, interval: 20, rec: 0, sound: true, layout: 'seat', seat, pos, absent: [], acts: [...ITC_ACTS], cur: { t0: null, sel: null } };
  // 教學活動：講述 → 提問討論 → 小組活動 → 個別練習 → 講述
  const plan = [[0, '講述'], [400, '提問討論'], [800, '小組活動'], [1800, '個別練習'], [2200, '講述']];
  plan.forEach(([t, label], i) => s.events.push({ id: 'a' + i, type: 'act', t, label }));
  const actAt = (t) => plan.filter((p) => p[0] <= t).pop()[1];
  s.clock.startedAt = base.getTime();
  const per = 20;
  let seed = 7;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const [act, pas, help, unk, off, dis] = s.codes.map((c) => c.id);
  let t = 0, n = 0;
  for (let r = 1; r <= 12; r++) {
    const group = r >= 5 && r <= 9; // 小組活動
    for (let i = 0; i < 10; i++) {
      const weak = i === 2 || i === 7;
      const x = rnd();
      let code;
      if (r === 1 && i === 4) code = null; // 一筆未記錄
      else if (weak) code = x < 0.2 ? act : x < 0.45 ? pas : x < 0.55 ? help : x < 0.6 ? unk : x < 0.9 ? off : dis;
      else if (group) code = x < 0.62 ? act : x < 0.82 ? pas : x < 0.92 ? help : x < 0.96 ? unk : off;
      else code = x < 0.3 ? act : x < 0.82 ? pas : x < 0.86 ? help : x < 0.9 ? unk : off;
      s.events.push({ id: 's' + (++n), type: 'sample', round: r, obj: i, code, t0: t, t: t + per, act: actAt(t + per) });
      t += per;
    }
  }
  s.clock.endedAt = base.getTime() + t * 1000;
  s.updatedAt = s.clock.endedAt;
  return s;
}
