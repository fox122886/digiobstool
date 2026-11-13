// 使用統計：記錄打開的是哪一段（只在正式網址送出）
(function () {
  function sec() { return (location.hash || '#top').slice(1).slice(0, 40); }
  function send(name, params) { if (typeof window.gtag === 'function') window.gtag('event', name, params); }
  function push() { send('guide_view', { guide_section: sec() }); }
  push();
  window.addEventListener('hashchange', push);
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-tool-link]');
    if (a) send('guide_open_tool', { tool: a.getAttribute('data-tool-link'), transport_type: 'beacon' });
  });
})();
