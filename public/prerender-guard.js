(function () {
  try {
    function normalizePath(raw) {
      if (!raw) return '/';
      var clean = String(raw).toLowerCase().split('?')[0].split('#')[0];
      clean = clean.replace(/\/+$/, '') || '/';
      if (clean.endsWith('.html')) {
        clean = clean.slice(0, -5) || '/';
      }
      if (clean === '/index') {
        clean = '/';
      }
      return clean || '/';
    }

    function detectPrerenderRoute() {
      if (typeof document !== 'undefined') {
        try {
          var meta = document.querySelector('meta[name="prerender-route"]');
          if (meta && meta.getAttribute('content')) {
            return normalizePath(meta.getAttribute('content'));
          }
        } catch (e) {}
        try {
          var el = document.getElementById('prerender');
          if (el && el.getAttribute('data-prerender-route')) {
            return normalizePath(el.getAttribute('data-prerender-route'));
          }
        } catch (e) {}
      }
      return '/';
    }

    function shouldKeepPrerender(options) {
      if (!options) return false;
      var path = normalizePath(options.pathname);
      var prerenderRoute = normalizePath(options.prerenderRoute || '/');
      var isPublic = path === '/' || path === '/terms' || path === '/privacy' || path === '/refunds';
      var isRouteMatch = path === prerenderRoute;
      return !options.hasUser && !options.isStandalone && isPublic && isRouteMatch;
    }

    var rawPath = (typeof window !== 'undefined' && window.location && window.location.pathname) || '/';
    var path = normalizePath(rawPath);
    var prerenderRoute = detectPrerenderRoute();

    var hasUser = false;
    var AUTH_KEY_REGEX = /^sb-[a-zA-Z0-9_.-]+-auth-token$/;
    try {
      if (typeof localStorage !== 'undefined') {
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
      }
    } catch (e) {}

    var isStandalone = false;
    try {
      if (typeof window !== 'undefined') {
        isStandalone = Boolean(
          (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
          (window.navigator && window.navigator.standalone)
        );
      }
    } catch (e) {}

    var removePrerender = function () {
      if (typeof document !== 'undefined') {
        var el = document.getElementById('prerender');
        if (el) el.remove();
      }
    };

    var removePrerenderIfRootPopulated = function () {
      if (typeof document !== 'undefined') {
        var root = document.getElementById('root');
        if (root && root.childElementCount > 0) {
          removePrerender();
        }
      }
    };

    // Fail-safe listeners: if early JS error occurs after #root has rendered content,
    // drop prerender so #root is visible. If #root is empty (e.g. JS blocked/failed before mount),
    // keep prerender visible so static copy stays readable.
    if (typeof window !== 'undefined') {
      window.addEventListener('error', removePrerenderIfRootPopulated);
      window.addEventListener('unhandledrejection', removePrerenderIfRootPopulated);
    }

    // Fail-safe bounded timeout: 8s after DOMContentLoaded, remove prerender ONLY if #root has mounted content
    var scheduleTimeout = function () {
      setTimeout(removePrerenderIfRootPopulated, 8000);
    };
    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', scheduleTimeout);
      } else {
        scheduleTimeout();
      }
    }

    var keep = shouldKeepPrerender({
      pathname: path,
      prerenderRoute: prerenderRoute,
      hasUser: hasUser,
      isStandalone: isStandalone,
    });

    if (typeof document !== 'undefined') {
      if (!keep) {
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
      } else {
        try {
          if (typeof MutationObserver !== 'undefined') {
            var routeObserver = new MutationObserver(function () {
              var el = document.getElementById('prerender');
              if (el) {
                var attrRoute = el.getAttribute('data-prerender-route');
                if (attrRoute && normalizePath(attrRoute) !== path) {
                  document.documentElement.classList.add('hide-prerender');
                  el.remove();
                  routeObserver.disconnect();
                }
              }
            });
            routeObserver.observe(document.documentElement, { childList: true, subtree: true });
          }
        } catch (e) {}
      }
    }

    if (typeof module !== 'undefined' && module.exports) {
      module.exports = {
        normalizePath: normalizePath,
        detectPrerenderRoute: detectPrerenderRoute,
        shouldKeepPrerender: shouldKeepPrerender,
      };
    }
  } catch (e) {}
})();
