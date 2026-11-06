// 本機資料庫：IndexedDB，不可用時退回記憶體（並提示使用者）
const DB_NAME = 'obs-tools';
const DB_VER = 1;
let dbPromise = null;
let memoryOnly = false;
const mem = { sessions: new Map(), settings: new Map() };

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { memoryOnly = true; resolve(null); };
      req.onblocked = () => { memoryOnly = true; resolve(null); };
    } catch (e) {
      memoryOnly = true;
      resolve(null);
    }
  });
  return dbPromise;
}

function run(db, name, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const req = fn(tx.objectStore(name));
    let out;
    if (req) req.onsuccess = () => { out = req.result; };
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('交易中止'));
  });
}

export const store = {
  async ready() { await open(); return !memoryOnly; },
  async all() {
    const db = await open();
    if (!db) return [...mem.sessions.values()].map((s) => structuredClone(s));
    return run(db, 'sessions', 'readonly', (s) => s.getAll());
  },
  async get(id) {
    const db = await open();
    if (!db) return structuredClone(mem.sessions.get(id));
    return run(db, 'sessions', 'readonly', (s) => s.get(id));
  },
  async put(session) {
    const copy = structuredClone(session);
    const db = await open();
    if (!db) { mem.sessions.set(copy.id, copy); return; }
    return run(db, 'sessions', 'readwrite', (s) => s.put(copy));
  },
  async del(id) {
    const db = await open();
    if (!db) { mem.sessions.delete(id); return; }
    return run(db, 'sessions', 'readwrite', (s) => s.delete(id));
  },
  async getSetting(key, fallback = null) {
    const db = await open();
    if (!db) return mem.settings.has(key) ? structuredClone(mem.settings.get(key)) : fallback;
    const row = await run(db, 'settings', 'readonly', (s) => s.get(key));
    return row ? row.value : fallback;
  },
  async setSetting(key, value) {
    const db = await open();
    if (!db) { mem.settings.set(key, structuredClone(value)); return; }
    return run(db, 'settings', 'readwrite', (s) => s.put({ key, value }));
  },
};
