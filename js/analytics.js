// 使用統計：送到 Google Analytics（GA4）
// GA4 只在正式網址載入（見各頁 <head>）；其他網址沒有 gtag，事件只留在本機的 window.__obsEvents 供測試
// 只送「哪個工具、做了什麼」，不送任何觀課內容、標題、班級或學生資料
export const TOOL = ['UTC', 'ATC', 'DTC', 'ITC'].includes(document.documentElement.dataset.tool) ? document.documentElement.dataset.tool : null;

export function track(event, params = {}) {
  const p = { entry: TOOL ? TOOL.toLowerCase() : 'home', ...params };
  try {
    (window.__obsEvents = window.__obsEvents || []).push({ event, ...p });
    if (typeof window.gtag === 'function') window.gtag('event', event, p);
  } catch (e) { /* 統計失敗不影響使用 */ }
}
