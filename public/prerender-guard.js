(function () {
  try {
    var rawPath = (window.location && window.location.pathname) || '/';
    var path = rawPath.toLowerCase().replace(/\/+$/, '').replace(/\.html$/, '') || '/';
    var isPublic = path === '/' || path === '/terms' || path === '/privacy' || path === '/refunds';
    var hasUser = false;
    var AUTH_KEY_REGEX = /^sb-[a-zA-Z0-9_.-]+-auth-token$/;
    try {
      var raw = localStorage.getItem('yourbody_user');
      if (raw && raw !== 'null' && raw !== 'undefined') {
        hasUser = true;
      } else {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && AUTH_KEY_REGEX.test(k)) {
            var val = localStorage.getItem(k);
            if (val) {
              try {
                var parsed = JSON.parse(val);
                if (parsed && (parsed.access_token || parsed.user)) {
                  hasUser = true;
                  break;
                }
              } catch (e) {}
            }
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

    var removePrerender = function () {
      var el = document.getElementById('prerender');
      if (el) el.remove();
    };

    var removePrerenderIfRootPopulated = function () {
      var root = document.getElementById('root');
      if (root && root.childElementCount > 0) {
        removePrerender();
      }
    };

    // Fail-safe listeners: if early JS error occurs after #root has rendered content,
    // drop prerender so #root is visible. If #root is empty (e.g. JS blocked/failed before mount),
    // keep prerender visible so static copy stays readable.
    window.addEventListener('error', removePrerenderIfRootPopulated);
    window.addEventListener('unhandledrejection', removePrerenderIfRootPopulated);

    // Fail-safe bounded timeout: 8s after DOMContentLoaded, remove prerender ONLY if #root has mounted content
    var scheduleTimeout = function () {
      setTimeout(removePrerenderIfRootPopulated, 8000);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', scheduleTimeout);
    } else {
      scheduleTimeout();
    }

    if (hasUser || !isPublic || isStandalone) {
      document.documentElement.classList.add('hide-prerender');
      try {
        var style = document.createElement('style');
        style.textContent = '#prerender { display: none !important; }';
        (document.head || document.documentElement).appendChild(style);
      } catch (e) {}
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
