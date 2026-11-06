// 觀課資料模型與計算（純函式，方便測試）
export const APP_VERSION = '2.0.0-alpha';

export const MODES = {
  UTC: { tag: 'UTC', name: '通用時間線標記', full: '通用時間線標記數位觀課工具', en: 'Universal timeline coding' },
  ATC: { tag: 'ATC', name: '軼事記錄時間線標記', full: '軼事記錄時間線標記數位觀課工具', en: 'Anecdotal timeline coding' },
  DTC: { tag: 'DTC', name: '質量雙元時間線標記', full: '質量雙元時間線標記數位觀課工具', en: 'Duality timeline coding' },
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
    codes: codes.map((c, i) => ({ id: 'c' + (i + 1) + uid().slice(-3), label: c.label, kind: c.kind, color: c.color || PALETTE[i % PALETTE.length] })),
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
      [540, 590, '教師未直接糾正，請學生用圖形表示，12 號自行發現錯誤。'],
      [900, 965, '小組討論：第 2 組由 7 號主導，其他成員參與較少。'],
      [1380, 1430, '巡視時對第 5 組提供提示卡，討論重新熱絡。'],
      [1820, 1880, '分享時 12 號主動上台說明通分的理由，用詞精準。'],
      [2280, 2340, '收尾以出口卡檢核，約有 4 位學生仍以分子分母各自相加。'],
    ];
    for (const [t0, t, text] of items) ev('note', t, { t0, text });
  }
  s.updatedAt = s.clock.endedAt;
  return s;
}
