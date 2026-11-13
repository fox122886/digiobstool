// Google 雲端硬碟同步：只用 drive.file 權限，APP 只看得到自己建立的檔案
// 全程在瀏覽器完成，記錄不經過任何其他伺服器
import { store } from './store.js';
import { sheetBlob, jsonBlob, names } from './output.js';
import { displayTitle } from './model.js';

export const CLIENT_ID = '515879782369-vlgbvjmlet2itbt2c81ki348fb4hb2kt.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_NAME = '數位觀課記錄';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
// 已在 Google Cloud 登記的網址；其他地方（例如預覽頁）不提供雲端同步
const ALLOWED_HOSTS = ['fox122886.github.io', 'localhost', '127.0.0.1'];

let token = null;
let tokenExp = 0;
let gisPromise = null;

export const available = () => ALLOWED_HOSTS.includes(location.hostname);

export function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { gisPromise = null; reject(new Error('無法載入 Google 登入元件，請確認網路連線')); };
      document.head.appendChild(s);
    });
  }
  return gisPromise;
}

export const hasToken = () => !!token && Date.now() < tokenExp - 60_000;

// 取得存取權杖。interactive 為 false 時只用現有權杖，不會跳出視窗
export async function getToken({ interactive = true } = {}) {
  if (hasToken()) return token;
  if (!interactive) return null;
  await loadGis();
  const account = await store.getSetting('googleAccount');
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      hint: account?.email || undefined,
      callback: (r) => {
        if (r.error) return reject(new Error(r.error === 'access_denied' ? '沒有取得雲端硬碟的存取權限' : (r.error_description || r.error)));
        if (!window.google.accounts.oauth2.hasGrantedAllScopes(r, SCOPE)) {
          return reject(new Error('請在授權畫面勾選「查看、編輯、建立及刪除這個應用程式使用的檔案」'));
        }
        token = r.access_token;
        tokenExp = Date.now() + (Number(r.expires_in) || 3600) * 1000;
        resolve(token);
      },
      error_callback: (e) => reject(new Error(e?.type === 'popup_closed' ? '已取消登入' : e?.type === 'popup_failed_to_open' ? '登入視窗被瀏覽器擋住了，請允許彈出視窗後再試一次' : (e?.message || '登入失敗'))),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

async function api(url, opts = {}, retry = true) {
  const t = await getToken({ interactive: false });
  if (!t) throw Object.assign(new Error('需要重新登入 Google'), { code: 'auth' });
  const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${t}` } });
  if (res.status === 401) {
    token = null;
    throw Object.assign(new Error('登入已過期，請再按一次'), { code: 'auth' });
  }
  if (res.status === 429 || res.status >= 500) {
    if (retry) { await new Promise((r) => setTimeout(r, 1500)); return api(url, opts, false); }
  }
  if (!res.ok) {
    let msg = `Google 雲端硬碟回應錯誤（${res.status}）`;
    try { const j = await res.json(); if (j?.error?.message) msg += `：${j.error.message}`; } catch (e) { /* 無內容 */ }
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

function multipart(meta, blob) {
  const b = 'obs' + Math.random().toString(36).slice(2);
  const body = new Blob([
    `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
    `--${b}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`, blob, `\r\n--${b}--`,
  ]);
  return { body, type: `multipart/related; boundary=${b}` };
}

async function create(meta, blob) {
  const { body, type } = multipart(meta, blob);
  return api(`${UPLOAD}/files?uploadType=multipart&fields=id,webViewLink`, { method: 'POST', headers: { 'Content-Type': type }, body });
}

async function update(id, meta, blob) {
  const { body, type } = multipart(meta, blob);
  return api(`${UPLOAD}/files/${id}?uploadType=multipart&fields=id,webViewLink`, { method: 'PATCH', headers: { 'Content-Type': type }, body });
}

async function trash(id) {
  try {
    await api(`${API}/files/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
  } catch (e) { /* 舊檔已被使用者刪除時略過 */ }
}

// 登入並取得帳號資訊
export async function signIn() {
  await getToken({ interactive: true });
  const about = await api(`${API}/about?fields=user(displayName,emailAddress)`);
  const account = { email: about?.user?.emailAddress || '', name: about?.user?.displayName || '' };
  await store.setSetting('googleAccount', account);
  await ensureFolder();
  return account;
}

export async function signOut() {
  const t = token;
  token = null;
  tokenExp = 0;
  await store.setSetting('googleAccount', null);
  await store.setSetting('googleFolder', null);
  try { if (t && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(t, () => {}); } catch (e) { /* 略過 */ }
}

export const account = () => store.getSetting('googleAccount');

export async function ensureFolder() {
  const saved = await store.getSetting('googleFolder');
  if (saved?.id) {
    try {
      const f = await api(`${API}/files/${saved.id}?fields=id,trashed,webViewLink`);
      if (f && !f.trashed) return saved;
    } catch (e) { if (e.code === 'auth') throw e; }
  }
  const q = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and name='${FOLDER_NAME}' and trashed=false`);
  const found = await api(`${API}/files?q=${q}&fields=files(id,webViewLink)&spaces=drive`);
  let folder = found?.files?.[0];
  if (!folder) {
    folder = await api(`${API}/files?fields=id,webViewLink`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder', description: '數位觀課工具 2.0 自動儲存的觀課記錄' }),
    });
  }
  const info = { id: folder.id, url: folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}` };
  await store.setSetting('googleFolder', info);
  return info;
}

export const needsSync = (s) => !s.sample && s.status === 'ended' && (!s.drive?.syncedAt || s.drive.syncedVersion !== s.updatedAt);

/**
 * 把一場觀課存到雲端硬碟：一份 Google 試算表（方便檢視、分享）＋一份 JSON（完整資料）
 * 檔名沿用匯出的純 ASCII 檔名；中文標題寫在檔案說明裡
 */
export async function syncSession(s) {
  const folder = await ensureFolder();
  const n = names(s);
  const base = n.ods.replace(/\.ods$/, '');
  const desc = `${displayTitle(s)}｜${s.meta.date || ''}｜數位觀課工具 ${s.mode}`;
  const prev = s.drive || {};
  const drive = { ...prev };

  // 試算表：上傳 ods 並轉成 Google 試算表；內容變更時換一份新的，舊的移到垃圾桶
  const sheet = await create({ name: base, parents: [folder.id], mimeType: 'application/vnd.google-apps.spreadsheet', description: desc }, sheetBlob(s));
  if (prev.sheetId && prev.sheetId !== sheet.id) await trash(prev.sheetId);
  drive.sheetId = sheet.id;
  drive.sheetUrl = sheet.webViewLink || `https://docs.google.com/spreadsheets/d/${sheet.id}/edit`;

  // JSON 備份：已存在就更新同一個檔案
  const data = { ...s, drive: undefined };
  let json = null;
  if (prev.jsonId) {
    try { json = await update(prev.jsonId, { name: n.json, description: desc }, jsonBlob(data)); } catch (e) { if (e.code === 'auth') throw e; json = null; }
  }
  if (!json) json = await create({ name: n.json, parents: [folder.id], description: desc }, jsonBlob(data));
  drive.jsonId = json.id;

  drive.folderId = folder.id;
  drive.folderUrl = folder.url;
  drive.syncedAt = Date.now();
  drive.syncedVersion = s.updatedAt;
  return drive;
}
