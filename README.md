# 數位觀課工具 2.0（UTC／ATC／DTC／ITC）

國立臺灣師範大學師資培育學院 張民杰教授團隊的數位觀課工具改版。
可離線使用的網頁 APP（PWA），每個動作即時存在使用者的裝置上。

- **開始使用**：<https://fox122886.github.io/digiobstool/>
- **操作指引**：<https://fox122886.github.io/digiobstool/guide.html>
- **隱私權政策**：<https://fox122886.github.io/digiobstool/privacy.html>

手機可在瀏覽器選單選「加到主畫面」（iPhone 為 Safari「分享 → 加入主畫面」），安裝後可離線開啟。

## 目前包含

- **UTC 通用時間線標記**：1–12 個自訂代碼按鈕，可設為「持續」（按開始／再按結束）或「單次」（按一下記一次）。
- **ATC 軼事記錄時間線標記**：開始打字即記下開始時間，送出時記下送出時間。
- **DTC 質量雙元時間線標記**：UTC 按鈕與 ATC 文字並用；匯出時標出每則文字撰寫期間進行中的代碼。
- **ITC 間隔時間線標記**：時間抽樣（「在工作中」觀察），可選輪播或座位表（含空位、觀察順序、缺席自動跳過），間隔可手動或自動倒數 3–30 秒，可選「先看後記」與提示音；可同時標記教學活動。結果有各輪分布、在工作中率走勢、依活動統計、座位熱區與可修改的對象 × 輪表。

鍵盤操作（電腦）：數字鍵 1–0 對應代碼按鈕；打字時用 Alt + 數字鍵；Enter 送出文字、Shift + Enter 換行、Ctrl + ; 插入現在時刻。ITC 用數字鍵選類別、Enter 記錄並換下一位。

## 檔案結構

```
index.html             入口頁
guide.html             操作指引（截圖在 guide/img/）
app.css                版面與配色（含深色模式）
manifest.webmanifest   安裝到主畫面用的設定
sw.js                  離線快取（改版時要更新裡面的 VERSION）
js/app.js              畫面與操作
js/model.js            資料模型、計時、統計（純函式）
js/output.js           時間軸圖、Excel／PNG／JSON 匯出
js/store.js            IndexedDB 本機資料庫
js/itc.js              ITC 時間抽樣的記錄與結果畫面
js/analytics.js        使用統計事件（GA4）
utc/ atc/ dtc/ itc/    各工具入口頁（由 tools/make_tool_pages.py 從 index.html 產生）
tools/                 產生入口頁的腳本與 GA4 程式片段
js/gdrive.js           Google 雲端硬碟同步（drive.file 權限）
privacy.html           隱私權政策
vendor/xlsx.full.min.js SheetJS 0.18.5（Apache 2.0）
vendor/gifenc.esm.js   gifenc 1.0.3（MIT），PTC 路線動畫 GIF 編碼
vendor/mp4-muxer.mjs   mp4-muxer 5.1.3（MIT），PTC 路線動畫 MP4 封裝
js/anim.js             PTC 路線動畫（WebCodecs H.264；不支援時改用 MediaRecorder）
icons/                 APP 圖示
```

不需要任何建置步驟，整個資料夾直接放上靜態網站空間即可。

## 本機測試

```
cd obs-app
python -m http.server 8000
```

用瀏覽器開 `http://localhost:8000`。直接雙擊 index.html 開啟無法運作（瀏覽器不允許以 file:// 載入模組）。

## 部署到 GitHub Pages

1. 在 GitHub 建立公開儲存庫（例如 `observation-tools`），把本資料夾內容上傳到根目錄。
2. Settings → Pages → Source 選「Deploy from a branch」，分支選 `main`、資料夾選 `/ (root)`。
3. 幾分鐘後網址為 `https://<帳號>.github.io/observation-tools/`。

之後每次修改：更新檔案 → 把 `sw.js` 的 `VERSION` 改成新字串 → 推上 GitHub。使用者下次開啟就會換成新版。

## Google 雲端硬碟同步

- 使用 Google Identity Services 在瀏覽器取得權杖，權限只有 `drive.file`，APP 只能存取自己建立的檔案。
- OAuth 用戶端 ID 寫在 `js/gdrive.js` 的 `CLIENT_ID`；已授權的 JavaScript 來源需包含部署網域。
- 每場觀課存成一份 Google 試算表與一份 JSON，放在使用者雲端硬碟的「數位觀課記錄」資料夾。
- 換網域或移轉 Google Cloud 專案時，更新 `CLIENT_ID` 與 `ALLOWED_HOSTS` 即可。

## 資料格式

每場觀課是一個 JSON 物件，`events` 為事件序列：

| type | 欄位 | 說明 |
| --- | --- | --- |
| `on` / `off` | `code`, `t` | 持續型代碼開始／結束 |
| `tap` | `code`, `t` | 單次型代碼 |
| `note` | `t0`, `t`, `text` | 軼事記錄（開始輸入時間、送出時間） |
| `sample` | `round`, `obj`, `code`, `t0`, `t`, `act` | ITC 取樣（`code` 為 null 表示未記錄；`act` 為當時的教學活動） |
| `act` | `t`, `label` | ITC 教學活動切換 |

`t` 是扣除暫停後的課堂經過秒數，由 `clock.startedAt` 與 `clock.pauses` 推算。

## 授權

本工具改寫自 Miikka Turkkila 的 [LOBS（Lesson OBServation app）](https://github.com/MTurkkila/LOBS)，
依原作授權以 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hant) 釋出。
SheetJS 依其 Apache 2.0 授權隨附；gifenc（Matt DesLauriers）與 mp4-muxer（Vanilagy）依其 MIT 授權隨附。

## 使用統計（Google Analytics G-T79F3ZXDMG）

GA4 只在 `fox122886.github.io` 與 `web.ntnu.edu.tw` 載入（`tools/ga-snippet.html`，已放進各頁 `<head>`）；其他網址（本機、預覽）不會送出。
要在 GA4 報表依工具分開看，請到「管理 → 自訂定義」把 `tool`、`entry`、`format`、`guide_section` 等參數建成事件範圍的自訂維度。
所有事件都帶 `entry`（`home` 或 `utc`／`atc`／`dtc`／`itc`，表示從哪個入口進來），不含任何觀課內容。

| 事件 | 時機 | 參數 |
|---|---|---|
| `obs_setup` | 進入設定頁 | `tool` |
| `obs_start` | 按「開始計時」 | `tool`、`code_count`；ITC 另有 `itc_layout`、`itc_n`、`itc_interval`、`itc_rec`、`itc_acts` |
| `obs_end` | 結束觀課 | `tool`、`obs_minutes`、`item_count` |
| `obs_export` | 匯出檔案 | `tool`、`format`（xlsx／png／json）、`sample` |
| `obs_sample` | 看範例結果 | `tool` |
| `drive_sync` | 存到雲端硬碟成功 | `tool` |
| `backup_all`／`backup_import` | 匯出全部備份／匯入備份 | `session_count` |
| `guide_view` | 開啟操作指引或跳到某一段 | `guide_section` |
| `guide_open_tool` | 從指引按「開啟 XTC」 | `tool` |
