(function () {
  window.TGA = window.TGA || {};

  window.TGA._state = {
    loadedSeriesId: null,
    eventCache: {}
  };

  var DEBUG = (window.TGA.debug) || false;

  var logger = (function () {
    var noop = function () {};
    var report = (typeof window.TGA.onError === 'function')
      ? window.TGA.onError
      : noop;
    return {
      warn:  function (msg, err) { console.warn('[TGA]', msg, err || '');  report(msg, err); },
      error: function (msg, err) { console.error('[TGA]', msg, err || ''); report(msg, err); },
      debug: function (msg, data) { if (DEBUG) console.log('[TGA:debug]', msg, data || ''); }
    };
  })();

  var EVENT_CONFIG = {
    'IMSA_2026_1': {
      imsaDaytonaFormat: true,
      hideDistanceInOverview: true,
      preSeasonAsPractice: true,
      raceTableClass: 'imsa-race-table',
      skipSessionMeta: true,
      skipQualResultsTitle: true
    },
    'IMSA_2026_PRE_SEASON_TEST': {
      skipSessionMeta: true,
      preSeasonOverview: true,
      imsaDaytonaFormat: true
    },
    'F1_2026_PRE_SEASON_TEST_1': { skipSessionMeta: true, preSeasonOverview: true, f1PreSeasonNoResultsTitle: true },
    'F1_2026_PRE_SEASON_TEST_2': { skipSessionMeta: true, preSeasonOverview: true, f1PreSeasonNoResultsTitle: true }
  };

  function eventCfg(evKey, flag) {
    var cfg = EVENT_CONFIG[evKey];
    return cfg ? !!cfg[flag] : false;
  }

  window.TGA.DEBUG = DEBUG;
  window.TGA.EVENT_CONFIG = EVENT_CONFIG;
  window.TGA.eventCfg = eventCfg;
  window.TGA.logger = logger;
})();
