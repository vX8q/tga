// fetchJSON: fetch + r.ok check + parse JSON. Throws on 4xx/5xx so callers can .catch().
(function () {
  if (typeof window === 'undefined') return;
  window.TGA = window.TGA || {};
  window.TGA.fetchJSON = function (url, options) {
    return fetch(url, options || {}).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + (r.statusText ? ' ' + r.statusText : ''));
      return r.json();
    });
  };
})();
