// Google Analytics（GA4）：只在正式網址載入，本機測試與預覽不送資料
// 放在外部檔案（不用行內 <script>），讓 Content-Security-Policy 不必允許 'unsafe-inline'
(function (w, d, h) {
  if (!/^(fox122886\.github\.io|web\.ntnu\.edu\.tw)$/.test(h)) return;
  w.dataLayer = w.dataLayer || [];
  w.gtag = function () { w.dataLayer.push(arguments); };
  w.gtag('js', new Date());
  w.gtag('config', 'G-T79F3ZXDMG');
  var j = d.createElement('script');
  j.async = true;
  j.src = 'https://www.googletagmanager.com/gtag/js?id=G-T79F3ZXDMG';
  d.head.appendChild(j);
})(window, document, location.hostname);
