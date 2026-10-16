(function () {
  try {
    var rawPath = (window.location && window.location.pathname) || '/';
    var path = rawPath.toLowerCase().replace(/\/+$/, '').replace(/\.html$/, '') || '/';
    var isPublic = path === '/' || path === '/terms' || path === '/privacy' || path === '/refunds';
    var hasUser = false;
    try {
      var raw = localStorage.getItem('yourbody_user');
      hasUser = Boolean(raw && raw !== 'null' && raw !== 'undefined');
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
    }
  } catch (e) {}
})();
