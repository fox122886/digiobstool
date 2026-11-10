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
- **ITC 間隔時間線標記**：時間抽樣（「在工作中」觀察），輪流觀察 1–60 位對象，間隔可手動或自動倒數 3–30 秒；結果有各輪分布圖與可修改的對象 × 輪表。

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
js/gdrive.js           Google 雲端硬碟同步（drive.file 權限）
privacy.html           隱私權政策
vendor/xlsx.full.min.js SheetJS 0.18.5（Apache 2.0）
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
| `sample` | `round`, `obj`, `code`, `t0`, `t` | ITC 取樣（`code` 為 null 表示未記錄） |

`t` 是扣除暫停後的課堂經過秒數，由 `clock.startedAt` 與 `clock.pauses` 推算。

## 授權

本工具改寫自 Miikka Turkkila 的 [LOBS（Lesson OBServation app）](https://github.com/MTurkkila/LOBS)，
依原作授權以 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hant) 釋出。
SheetJS 依其 Apache 2.0 授權隨附。
