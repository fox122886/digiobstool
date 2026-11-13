# 資安說明

給資安檢測與程式碼掃描人員參考：本工具的架構、已採取的防護措施，以及開源掃描工具報出項目的逐項說明。

## 架構與資料流

- **純前端靜態網站**：只有 HTML、CSS、JavaScript 檔案，沒有後端程式、沒有資料庫伺服器、沒有帳號系統，也不收任何表單送到伺服器。
- **資料存在使用者自己的裝置**：觀課記錄寫在瀏覽器的 IndexedDB；淺色／深色的選擇記在 localStorage。都不會傳給本工具的開發者。
- **Google 雲端硬碟同步（使用者自行選用）**：
  - 用 Google Identity Services 在瀏覽器取得存取權杖，權限只有 `drive.file`，也就是 APP 只能讀寫自己建立的檔案，看不到使用者雲端硬碟的其他內容。
  - 權杖只放在記憶體變數，不寫進 IndexedDB 或 localStorage，關閉頁面就失效。
  - IndexedDB 只記帳號的 email 與資料夾編號，用來顯示「已連結」。
- **使用統計**：GA4（G-T79F3ZXDMG）只記錄操作事件（例如用了哪個工具、匯出哪種格式），不含任何觀課內容。程式只在正式網域載入。

## 第三方元件

| 元件 | 版本 | 用途 | 載入方式 |
| --- | --- | --- | --- |
| gifenc | 1.0.3（MIT） | PTC 路線動畫的 GIF 編碼 | `vendor/`，本站提供 |
| mp4-muxer | 5.1.3（MIT） | PTC 路線動畫的 MP4 封裝 | `vendor/`，本站提供 |
| Google Identity Services | Google 維護 | 雲端硬碟登入 | `accounts.google.com/gsi/client` |
| Google Analytics 4 | Google 維護 | 使用統計 | `googletagmanager.com/gtag/js` |

**已移除 SheetJS（xlsx 0.18.5）。** npm 上的 0.18.5 有已知弱點 CVE-2023-30533（原型污染）與 CVE-2024-22363（ReDoS），兩者都發生在「讀取」試算表檔案時。本工具原本只用它「寫出」檔案，實際上不受影響，但為了避免掃描報告出現高風險元件，已改成自己撰寫的 OpenDocument 試算表產生器（`js/ods.js`，約 120 行，只產生 XML 與不壓縮的 zip）。匯出格式因此由 .xlsx 改為 .ods。Excel、Google 試算表、LibreOffice、Numbers 都能直接開啟 .ods，它也是國家發展委員會推動的政府文件標準格式（ODF）。

## 防護措施

### 內容安全政策（CSP）

每個頁面（`index.html`、各工具入口頁、`guide.html`、`privacy.html`）都以 `<meta http-equiv="Content-Security-Policy">` 設定：

```
default-src 'self';
script-src 'self' https://*.googletagmanager.com https://accounts.google.com/gsi/client;
style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style;
img-src 'self' data: blob: https://*.google-analytics.com https://*.googletagmanager.com;
connect-src 'self' https://www.googleapis.com https://accounts.google.com/gsi/ https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com;
frame-src https://accounts.google.com/gsi/;
font-src 'self' data:; media-src 'self' blob:; worker-src 'self'; manifest-src 'self';
object-src 'none'; base-uri 'self'; form-action 'self'
```

- **不允許行內程式**：`script-src` 沒有 `'unsafe-inline'` 和 `'unsafe-eval'`，原本寫在頁面裡的 GA4 片段已移到 `ga.js`、`guide.js`。就算有人設法把 `<script>` 或 `onerror=` 塞進頁面也不會執行，實測確認會被瀏覽器擋下。
- **`style-src` 保留 `'unsafe-inline'`**：畫面用 `style="--c:#2F6FB3"` 這類行內樣式傳遞代碼顏色、長條寬度等數值。樣式無法執行程式；而且下面的匯入檢查只允許 `#` 加十六進位的顏色值，外來資料無法注入任意樣式。
- **meta 版 CSP 的限制**：`frame-ancestors`（防止網頁被嵌入其他網站的框架）只能用 HTTP 標頭設定，GitHub Pages 無法自訂標頭。本工具沒有需要防範點擊劫持的敏感操作（例如轉帳或改密碼）。日後若改放到可設定標頭的主機，建議加上 `frame-ancestors 'none'`。

### 輸出跳脫

畫面以樣板字串組合 HTML，再透過 `innerHTML` 放進頁面。所有來自使用者輸入的文字都先經過 `esc()`，把 `& < > " '` 轉成 HTML 實體後才插入。使用者輸入的文字包括：

- 觀課資訊
- 代碼名稱
- 文字記錄
- ITC 對象與活動名稱
- PTC 區域、座位名稱與分析欄位

其餘插入的值都是程式產生的數字、編號或固定字串。

### 匯入檢查

備份檔（.json）可能被人改過，所以匯入時由 `js/model.js` 的 `safeImport()` 逐欄檢查：

- 文字欄位：照收，顯示時一律跳脫。
- 編號、類型、日期等欄位：只允許英數字與 `_ . , : + # -`，最長 80 字。
- 顏色欄位：只允許 `#` 加十六進位。
- 含 `__proto__`、`constructor`、`prototype` 鍵名的資料：不收。
- 其他：備份裡原帳號的雲端硬碟連結一律去掉；檔案超過 50 MB 不讀。

不合格的場次整場不匯入，並提示使用者。

### 匯出檔案

- **試算表**：所有文字都寫成字串型儲存格（`office:value-type="string"`），不會被當成公式計算，避免 CSV／試算表公式注入。
- **檔名**：只用英數字（例如 `UTC_20261113_1010.ods`），中文標題寫在檔案內容裡。

## 開源源碼掃描結果（Semgrep）

- 工具：Semgrep 1.185.0，搭配官方開源規則庫 [semgrep-rules](https://github.com/semgrep/semgrep-rules)。
- 規則組：`javascript/browser`、`javascript/lang`、`javascript/audit`、`html`、`generic/secrets`、`generic/unicode`，共 283 條規則。
- 掃描範圍：30 個檔案，含 `vendor/` 內的第三方元件。

| 規則 | 數量 | 處理 |
| --- | --- | --- |
| `html-in-template-string` | 289 | **誤報，已說明**。只要樣板字串裡有 HTML 標籤，這條規則就會報出。所有使用者文字都經 `esc()` 跳脫（見上方「輸出跳脫」），並以下方的自我檢查實測確認。 |
| `insecure-innerhtml`、`insecure-document-method` | 各 42、44 | **誤報，已說明**。同上，放進 `innerHTML` 的內容都已跳脫；另有 CSP 禁止行內程式作為第二道防線。`theme.js` 的一處放的是程式內固定的圖示。 |
| `unsafe-dynamic-method` | 1 | **已修正**。按鈕動作原本以 `actions[el.dataset.act]` 查表，改為 `Object.hasOwn()` 確認是自己定義的動作，避免查到 `constructor` 這類原型屬性。 |
| `detected-google-oauth-url` | 1 | **不是問題，已說明**。`js/gdrive.js` 的 OAuth 用戶端 ID 本來就必須公開給瀏覽器使用，不是密鑰。Google Cloud 端限定只有本站網域能用它取得權杖，程式也只在 `ALLOWED_HOSTS` 列出的網域啟用登入。 |
| `missing-template-string-indicator` | 2 | **誤報**。報出的是 `feedHTML(s, { newestFirst: false })` 函式參數裡的物件，不是漏寫的 `$`。 |
| `useless-assignment` | 1 | **刻意寫法**。輸入框自動長高時，先把高度設回 `auto`，才能量到正確的捲動高度，再設定新高度。 |

`vendor/` 內的 gifenc、mp4-muxer 沒有被報出任何項目。

## 自我檢查腳本

`tools/security_check.py` 用無頭瀏覽器實際操作 APP，做兩項測試：

1. **惡意字串測試**：把 `"><img src=x onerror=…>`、`<script>…</script>`、`' onmouseover='…` 這類字串放進五種工具範例資料的每個文字欄位。接著逐一開啟首頁、結果頁（全部展開）、觀課重點摘要、記錄中畫面，確認畫面上只當文字顯示：沒有產生任何元素、沒有程式被執行，也沒有觸發 CSP 攔截。
2. **匯入測試**：正常備份 5 場要全部匯入；顏色、編號、類型等欄位被竄改的 5 場要全部擋下。

```
pip install playwright && playwright install chromium
python tools/security_check.py
```

目前結果：21 個畫面皆為「注入元素 0、程式被執行 0」，匯入測試通過。

## 回報問題

發現資安問題請到 GitHub 儲存庫開 issue；涉及尚未修補的弱點時，請先私下聯繫維護者。
