(function () {
  try {
    var rawPath = (window.location && window.location.pathname) || '/';
    var path = rawPath.toLowerCase().replace(/\/+$/, '').replace(/\.html$/, '') || '/';
    var isPublic = path === '/' || path === '/terms' || path === '/privacy' || path === '/refunds';
    var hasUser = false;
    try {
      var raw = localStorage.getItem('yourbody_user');
      if (raw && raw !== 'null' && raw !== 'undefined') {
        hasUser = true;
      } else {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf('sb-') === 0 && k.indexOf('-auth-token') !== -1) {
            hasUser = true;
            break;
          }
        }
      }
    } catch (e) {}
    var isStandalone = false;
    try {
      isStandalone = Boolean(
        (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
        (window.navigator && window.navigator.standalone)
      );
    } catch (e) {}

    if (hasUser || !isPublic || isStandalone) {
      document.documentElement.classList.add('hide-prerender');
      try {
        var style = document.createElement('style');
        style.textContent = '#prerender { display: none !important; }';
        (document.head || document.documentElement).appendChild(style);
      } catch (e) {}
      var removePrerender = function () {
        var el = document.getElementById('prerender');
        if (el) el.remove();
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', removePrerender);
      } else {
        removePrerender();
      }
      try {
        if (typeof MutationObserver !== 'undefined') {
          var observer = new MutationObserver(function () {
            var el = document.getElementById('prerender');
            if (el) {
              el.remove();
              observer.disconnect();
            }
          });
          observer.observe(document.documentElement, { childList: true, subtree: true });
        }
      } catch (e) {}
    }
  } catch (e) {}
})();
