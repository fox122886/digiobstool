# 數位觀課工具 2.0（UTC／ATC／DTC）

國立臺灣師範大學師資培育學院 張民杰教授團隊的數位觀課工具改版。
可離線使用的網頁 APP（PWA），每個動作即時存在使用者的裝置上。

## 目前包含

- **UTC 通用時間線標記**：1–12 個自訂代碼按鈕，可設為「持續」（按開始／再按結束）或「單次」（按一下記一次）。
- **ATC 軼事記錄時間線標記**：開始打字即記下開始時間，送出時記下送出時間。
- **DTC 質量雙元時間線標記**：UTC 按鈕與 ATC 文字並用；匯出時標出每則文字撰寫期間進行中的代碼。

鍵盤操作（電腦）：數字鍵 1–0 對應代碼按鈕；打字時用 Alt + 數字鍵；Enter 送出文字、Shift + Enter 換行、Ctrl + ; 插入現在時刻。

## 檔案結構

```
index.html             入口頁
app.css                版面與配色（含深色模式）
manifest.webmanifest   安裝到主畫面用的設定
sw.js                  離線快取（改版時要更新裡面的 VERSION）
js/app.js              畫面與操作
js/model.js            資料模型、計時、統計（純函式）
js/output.js           時間軸圖、Excel／PNG／JSON 匯出
js/store.js            IndexedDB 本機資料庫
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

## 資料格式

每場觀課是一個 JSON 物件，`events` 為事件序列：

| type | 欄位 | 說明 |
| --- | --- | --- |
| `on` / `off` | `code`, `t` | 持續型代碼開始／結束 |
| `tap` | `code`, `t` | 單次型代碼 |
| `note` | `t0`, `t`, `text` | 軼事記錄（開始輸入時間、送出時間） |

`t` 是扣除暫停後的課堂經過秒數，由 `clock.startedAt` 與 `clock.pauses` 推算。

## 授權

本工具改寫自 Miikka Turkkila 的 [LOBS（Lesson OBServation app）](https://github.com/MTurkkila/LOBS)，
依原作授權以 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hant) 釋出。
SheetJS 依其 Apache 2.0 授權隨附。
