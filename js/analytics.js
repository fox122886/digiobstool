// 使用統計：把事件放進 Google 代碼管理工具（GTM）的 dataLayer
// GTM 只在正式網址載入（見各頁 <head>），其他地方 push 進 dataLayer 不會送出任何資料
// 只送「哪個工具、做了什麼」，不送任何觀課內容、標題、班級或學生資料
export const TOOL = ['UTC', 'ATC', 'DTC', 'ITC'].includes(document.documentElement.dataset.tool) ? document.documentElement.dataset.tool : null;

export function track(event, params = {}) {
  try {
    (window.dataLayer = window.dataLayer || []).push({ event, entry: TOOL ? TOOL.toLowerCase() : 'home', ...params });
  } catch (e) { /* 統計失敗不影響使用 */ }
}
