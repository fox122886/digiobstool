// 淺色／深色切換：放在 <head> 同步載入，避免開啟時閃一下另一種顏色
// 三段切換：跟隨系統 → 淺色 → 深色；選擇記在這台裝置（localStorage），讀不到時就跟隨系統
(function () {
  var KEY = 'obs-theme';
  var root = document.documentElement;
  var mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  var ICON = {
    auto: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
    light: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2.5v2.5M12 19v2.5M2.5 12h2.5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></g></svg>',
    dark: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" fill="currentColor"/></svg>',
  };
  var NAME = { auto: '跟隨系統', light: '淺色', dark: '深色' };
  var mem = null; // 無法使用 localStorage 時（例如部分無痕模式），只在這次開啟期間記住

  function get() {
    if (mem) return mem;
    try { var v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'auto'; } catch (e) { return 'auto'; }
  }
  function effective(mode) { return mode === 'auto' ? (mq && mq.matches ? 'dark' : 'light') : mode; }
  function apply(mode) {
    if (mode === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', mode);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', effective(mode) === 'dark' ? '#0F1719' : '#0F6E66');
    paint();
  }
  function label(mode) {
    mode = mode || get();
    var next = { auto: 'light', light: 'dark', dark: 'auto' }[mode];
    return { html: ICON[mode] + '<span>' + NAME[mode] + '</span>', title: '外觀：' + NAME[mode] + '（按一下改為' + NAME[next] + '）' };
  }
  function paint() {
    var l = label();
    var list = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < list.length; i++) {
      list[i].innerHTML = l.html;
      list[i].setAttribute('title', l.title);
      list[i].setAttribute('aria-label', l.title);
    }
  }
  function cycle() {
    var next = { auto: 'light', light: 'dark', dark: 'auto' }[get()];
    mem = next;
    try { if (next === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, next); } catch (e) { /* 無法保存時仍切換本次 */ }
    apply(next);
    root.dispatchEvent(new CustomEvent('obs-theme', { detail: effective(next) }));
    return next;
  }

  apply(get());
  if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (get() === 'auto') apply('auto'); });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-theme-toggle]');
    if (b) { e.preventDefault(); cycle(); }
  });
  document.addEventListener('DOMContentLoaded', function () { apply(get()); });
  window.obsTheme = { get: get, cycle: cycle, label: label, paint: paint };
})();
