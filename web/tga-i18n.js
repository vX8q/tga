(function () {
  'use strict';
  window.TGA = window.TGA || {};
  var state = window.TGA._state;
  var logger = window.TGA.logger;

  var lang = 'en';
  try {
    var stored = typeof localStorage !== 'undefined' && localStorage.getItem('tga-lang');
    if (stored === 'ru' || stored === 'en') lang = stored;
  } catch (e) {}
  function getLang() { return lang; }

  var theme = (function () {
    try {
      var stored = typeof localStorage !== 'undefined' && localStorage.getItem('tga-theme');
      if (stored === 'light' || stored === 'dark') return stored;
    } catch (e) {}
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
    return 'dark';
  })();
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.setAttribute('data-theme', theme);
  }
  var translations = (typeof window !== 'undefined' && window.TGA_TRANSLATIONS) || {};

  function t(key) {
    if (!key) return '';
    var tr = translations[lang] || translations.en || {};
    var val = tr[key];
    if (val !== undefined && val !== null) return val;
    return key;
  }

  function updateLangUI() {
    if (typeof document === 'undefined' || !document.documentElement) return;
    document.querySelectorAll('.lang-opt').forEach(function (opt) {
      opt.classList.toggle('active', opt.dataset.lang === lang);
    });
    var footer = document.getElementById('footer-text');
    if (footer) footer.textContent = t('footer');
    translateStaticUI();
  }

  function updateThemeUI() {
    if (typeof document === 'undefined' || !document.documentElement) return;
    var btn = document.getElementById('themeToggle');
    if (!btn) return;
    var opts = btn.querySelectorAll('.theme-opt');
    for (var i = 0; i < opts.length; i++) {
      opts[i].classList.toggle('active', opts[i].dataset.theme === theme);
    }
    document.documentElement.setAttribute('data-theme', theme || 'dark');
  }

  var timeSettings = (function () {
    try {
      var raw = typeof localStorage !== 'undefined' && localStorage.getItem('tga-time-settings');
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          var fmt = parsed.timeFormat === '12h' ? '12h' : '24h';
          var tzRaw = typeof parsed.timeZone === 'string' && parsed.timeZone ? parsed.timeZone : 'my';
          var tz = (tzRaw === 'track' || tzRaw === 'est') ? 'track' : 'my';
          return { timeFormat: fmt, timeZone: tz };
        }
      }
    } catch (e) {}
    return { timeFormat: '24h', timeZone: 'my' };
  })();
  function getTimeSettings() { return timeSettings; }
  function setTimeSettings(next) {
    timeSettings = {
      timeFormat: next && next.timeFormat === '12h' ? '12h' : '24h',
      timeZone: (next && typeof next.timeZone === 'string' && next.timeZone === 'track') ? 'track' : 'my'
    };
    try { if (typeof localStorage !== 'undefined') localStorage.setItem('tga-time-settings', JSON.stringify(timeSettings)); } catch (e) {}
    if (state) state.loadedSeriesId = null;
    updateTimeSettingsUI();
  }

  function parseTimeStringToParts(s) {
    if (s == null || typeof s !== 'string') return null;
    var str = s.trim();
    if (!str) return null;
    // "14:30" or "14:30–15:00" or "2:30 PM" or "2:30 PM – 4:00 PM"
    var range = str.split(/\s*[–\-]\s*/);
    var first = (range[0] || '').trim();
    var m12 = first.match(/(\d{1,2}):(\d{2})\s*([ap]\.?m\.?|AM|PM)/i);
    if (m12) {
      var h = parseInt(m12[1], 10);
      var ampm = m12[3].replace(/\./g, '').toUpperCase();
      if (ampm === 'PM' && h < 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      return { hour: h, minute: parseInt(m12[2], 10) || 0 };
    }
    var m24 = first.match(/(\d{1,2}):(\d{2})/);
    if (m24) return { hour: parseInt(m24[1], 10), minute: parseInt(m24[2], 10) || 0 };
    return null;
  }

  /** Возвращает смещение (часы) Eastern → UTC для даты: EST = +5, EDT = +4. America/New_York. */
  function getEasternToUtcOffsetHours(y, m, d) {
    if (typeof Intl === 'undefined' || !Intl.DateTimeFormat) return 5;
    try {
      var utcNoon = Date.UTC(Number(y), Number(m) - 1, Number(d), 12, 0);
      var formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false });
      var parts = formatter.formatToParts(new Date(utcNoon));
      var hourPart = parts.find(function (p) { return p.type === 'hour'; });
      var nyHour = hourPart ? parseInt(hourPart.value, 10) : 7;
      return 12 - nyHour;
    } catch (e) {
      return 5;
    }
  }

  /** Даёт UTC timestamp для момента (y,m,d, hour, minute) в Eastern (America/New_York, с DST). */
  function estToUtcMs(y, m, d, hour, minute) {
    var offset = getEasternToUtcOffsetHours(y, m, d);
    return Date.UTC(Number(y), Number(m) - 1, Number(d), hour + offset, minute || 0);
  }

  function formatTimeForDisplay(raw) {
    if (raw == null || typeof raw !== 'string') return '';
    var str = raw.trim();
    if (!str) return '';
    var parts = parseTimeStringToParts(str);
    if (!parts || typeof Intl === 'undefined' || !Intl.DateTimeFormat) return str;
    var settings = getTimeSettings();
    var hour12 = settings && settings.timeFormat === '12h';
    var df = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: hour12 });
    var d = new Date();
    d.setHours(parts.hour, parts.minute || 0, 0, 0);
    return df.format(d);
  }

  function updateTimeSettingsUI() {
    if (typeof document === 'undefined') return;
    var s = getTimeSettings();
    ['time-format-select', 'time-format-select-detail'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && s.timeFormat) el.value = s.timeFormat;
    });
    ['time-zone-select', 'time-zone-select-detail'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && s.timeZone) el.value = s.timeZone;
    });
  }

  // ─── trimTrailingZeros (defined before localizeStatValue which uses it) ───
  function trimTrailingZeros(s) {
    if (s == null) return '';
    var v = String(s).trim();
    if (!/^\d/.test(v)) return v;
    v = v.replace(/(\.\d*?)0+$/, '$1');
    v = v.replace(/\.$/, '');
    return v;
  }

  function localizeStatKey(k) {
    if (k == null) return '';
    var key = String(k).toLowerCase().trim();
    var ru = (typeof window !== 'undefined' && window.TGA_RU && window.TGA_RU.raceStatKeysRu) || {};
    return (lang === 'ru' && ru[key]) ? ru[key] : String(k).trim();
  }

  function pluralRu(n, a, b, c) {
    var num = Math.abs(Number(n));
    if (isNaN(num)) return c;
    var mod10 = num % 10, mod100 = num % 100;
    if (mod10 === 1 && mod100 !== 11) return a;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return b;
    return c;
  }

  function localizeStatValue(v) {
    if (v == null) return '';
    var val = String(v).trim();
    if (lang !== 'ru') return trimTrailingZeros(val);
    val = trimTrailingZeros(val);
    val = val.replace(/\bmph\b/gi, 'миль/ч');
    val = val.replace(/\bkm\/h\b/gi, 'км/ч');
    val = val.replace(/\bkm\/hr\b/gi, 'км/ч');
    val = val.replace(/\blaps\b/gi, 'кругов');
    val = val.replace(/\bcaution\b/gi, 'SC');
    val = val.replace(/\bcautions\b/gi, 'машины безопасности');
    val = val.replace(/\bred flag(s?)\b/gi, 'красн$1 флаг$1');
    val = val.replace(/\bminutes\b/gi, 'минут');
    val = val.replace(/\bseconds\b/gi, 'секунд');
    val = val.replace(/\bhours\b/gi, 'часов');
    val = val.replace(/\bdegree(s?)\b/gi, 'градус$1');
    val = val.replace(/\b°\s*F\b/gi, '°F');
    val = val.replace(/\b°\s*C\b/gi, '°C');
    return val;
  }

  var specKeySkip = Object.create ? Object.create(null) : {};
  function normalizeSpecKey(k) {
    if (k == null) return '';
    return String(k).toLowerCase().trim().replace(/\s*\/\s*/g, ' / ');
  }
  var specKeyRu = (typeof window !== 'undefined' && window.TGA_RU && window.TGA_RU.specKeyRu) || {};
  function localizeSpecKey(k) {
    if (k == null) return '';
    var key = normalizeSpecKey(k);
    return (lang === 'ru' && specKeyRu[key]) ? specKeyRu[key] : String(k).trim();
  }

  function localizeSpecValue(v) {
    if (v == null) return '';
    var val = String(v).trim();
    if (lang !== 'ru') return val;
    val = val.replace(/\bhp\b/gi, 'л.с.');
    val = val.replace(/\bkW\b/g, 'кВт');
    val = val.replace(/\bmm\b/gi, 'мм');
    val = val.replace(/\bcm\b/gi, 'см');
    val = val.replace(/\bkg\b/gi, 'кг');
    val = val.replace(/\blb\b/gi, 'фунт.');
    val = val.replace(/\bft\b/gi, 'фут');
    val = val.replace(/\bin\b/gi, 'дюйм');
    val = val.replace(/\bmph\b/gi, 'миль/ч');
    val = val.replace(/\bkm\/h\b/gi, 'км/ч');
    val = val.replace(/\brpm\b/gi, 'об/мин');
    val = val.replace(/\bN⋅m\b/g, 'Н⋅м');
    val = val.replace(/\bNm\b/g, 'Н⋅м');
    val = val.replace(/\bpsi\b/gi, 'psi');
    val = val.replace(/\bbar\b/gi, 'бар');
    val = val.replace(/\bl\b/gi, 'л');
    val = val.replace(/\bgal\b/gi, 'гал');
    val = val.replace(/\bdegrees?\b/gi, 'град.');
    return val;
  }

  var tableHeaderRu = (typeof window !== 'undefined' && window.TGA_RU && window.TGA_RU.tableHeaderRu) || {};
  var carNumHeaders = ['car', 'car #', '#', 'no.', 'no'];

  function findCarNumberColumn(headers) {
    if (!Array.isArray(headers)) return -1;
    for (var i = 0; i < headers.length; i++) {
      var h = (headers[i] != null ? String(headers[i]) : '').toLowerCase().trim();
      for (var j = 0; j < carNumHeaders.length; j++) {
        if (h === carNumHeaders[j]) return i;
      }
    }
    return -1;
  }

  function localizeTableHeader(h) {
    if (h == null) return '';
    var key = String(h).toLowerCase().trim();
    if (lang === 'ru' && tableHeaderRu[key]) return tableHeaderRu[key];
    if (lang === 'ru' && logger && typeof logger.warn === 'function' && !tableHeaderRu[key] && key.length > 0) {
      logger.warn('Missing tableHeaderRu for: "' + key + '"');
    }
    return String(h).trim();
  }

  var cellNotesRu = (typeof window !== 'undefined' && window.TGA_RU && window.TGA_RU.cellNotesRu) || {};
  function localizeCellNote(v) {
    if (v == null) return '';
    var key = String(v).toLowerCase().trim();
    return (lang === 'ru' && cellNotesRu[key]) ? cellNotesRu[key] : String(v).trim();
  }

  var raceReasonParts = (typeof window !== 'undefined' && window.TGA_RU && window.TGA_RU.raceReasonParts) || [];
  function localizeRaceReason(v) {
    if (v == null) return '';
    var text = String(v).trim();
    if (lang !== 'ru' || !raceReasonParts.length) return text;
    for (var i = 0; i < raceReasonParts.length; i++) {
      var pair = raceReasonParts[i];
      if (Array.isArray(pair) && pair[0] && pair[1]) text = text.replace(pair[0], pair[1]);
    }
    return text;
  }

  var translateValueHeaders = ['value'];
  var translateReasonHeaders = ['reason'];

  function localizeDate(s) {
    if (s == null || typeof s !== 'string') return '';
    var str = s.trim();
    if (!str) return '';

    // Попробуем разобрать ISO-дату вида "2025-04-06"
    var isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      var year = parseInt(isoMatch[1], 10);
      var monthIdx = parseInt(isoMatch[2], 10) - 1; // 0-based
      var day = parseInt(isoMatch[3], 10);
      var monthsEn = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      var monthsRu = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
      if (monthIdx >= 0 && monthIdx < 12) {
        if (lang === 'ru') {
          return day + ' ' + monthsRu[monthIdx] + ' ' + year;
        }
        // Формат по умолчанию для страниц события: "16 March 2025"
        return day + ' ' + monthsEn[monthIdx] + ' ' + year;
      }
    }

    // Для уже человекочитаемых дат оставляем старое поведение:
    if (lang !== 'ru') return str;
    var monthsRu2 = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    var monthsEn2 = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    for (var i = 0; i < 12; i++) {
      str = str.replace(new RegExp(monthsEn2[i], 'gi'), monthsRu2[i]);
    }
    return str;
  }

  var degRu = { '°': '°', 'degrees': 'градусы', 'degree': 'градус' };
  function localizeTrackInfo(s) {
    if (s == null || typeof s !== 'string') return '';
    var str = s.trim();
    if (lang !== 'ru') return str;
    str = str.replace(/\bTurn\s+(\d+)\b/gi, 'Поворот $1');
    str = str.replace(/\bDegrees?\b/gi, 'градусов');
    str = str.replace(/\bdegrees?\b/gi, 'градусов');
    str = str.replace(/\bmiles?\b/gi, 'миль');
    str = str.replace(/\bkm\b/gi, 'км');
    return str;
  }

  function localizeDistance(s) {
    if (s == null) return '';
    var v = String(s).trim();
    if (lang !== 'ru') return trimTrailingZeros(v);
    v = trimTrailingZeros(v);
    v = v.replace(/\bmi\b/gi, 'миль');
    v = v.replace(/\bkm\b/gi, 'км');
    v = v.replace(/\bmiles?\b/gi, 'миль');
    return v;
  }

  function translateStaticUI() {
    if (typeof document === 'undefined') return;
    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var key = el.getAttribute('data-i18n');
      if (key) el.textContent = t(key);
    }
  }

  function setLang(newLang) {
    if (lang === newLang) return;
    if (newLang === 'ru' || newLang === 'en') lang = newLang;
    try { localStorage.setItem('tga-lang', lang); } catch (e) {}
    if (state) {
      state.eventCache = {};
      state.loadedSeriesId = null;
    }
    var sl = typeof document !== 'undefined' && document.getElementById('series-list');
    if (sl) sl._listLoaded = false;
    updateLangUI();
    translateStaticUI();
    if (typeof window !== 'undefined' && window.TGA && typeof window.TGA.route === 'function') {
      window.TGA.route();
    }
  }

  function setTheme(newTheme) {
    if (newTheme !== 'light' && newTheme !== 'dark') newTheme = 'dark';
    if (theme === newTheme) return;
    theme = newTheme;
    try { if (typeof localStorage !== 'undefined') localStorage.setItem('tga-theme', theme); } catch (e) {}
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.setAttribute('data-theme', theme);
    }
    updateThemeUI();
  }

  window.TGA.getLang = getLang;
  window.TGA.t = t;
  window.TGA.setLang = setLang;
  window.TGA.setTheme = setTheme;
  window.TGA.updateLangUI = updateLangUI;
  window.TGA.updateThemeUI = updateThemeUI;
  window.TGA.translateStaticUI = translateStaticUI;
  window.TGA.getTimeSettings = getTimeSettings;
  window.TGA.setTimeSettings = setTimeSettings;
  window.TGA.formatTimeForDisplay = formatTimeForDisplay;
  window.TGA.parseTimeStringToParts = parseTimeStringToParts;
  window.TGA.estToUtcMs = estToUtcMs;
  window.TGA.updateTimeSettingsUI = updateTimeSettingsUI;
  window.TGA.findCarNumberColumn = findCarNumberColumn;
  window.TGA.localizeTableHeader = localizeTableHeader;
  window.TGA.localizeCellNote = localizeCellNote;
  window.TGA.localizeRaceReason = localizeRaceReason;
  window.TGA.translateValueHeaders = translateValueHeaders;
  window.TGA.translateReasonHeaders = translateReasonHeaders;
  window.TGA.localizeStatKey = localizeStatKey;
  window.TGA.localizeStatValue = localizeStatValue;
  window.TGA.localizeSpecKey = localizeSpecKey;
  window.TGA.localizeSpecValue = localizeSpecValue;
  window.TGA.normalizeSpecKey = normalizeSpecKey;
  window.TGA.specKeySkip = specKeySkip;
  window.TGA.localizeDate = localizeDate;
  window.TGA.localizeDistance = localizeDistance;
  window.TGA.localizeTrackInfo = localizeTrackInfo;
  window.TGA.trimTrailingZeros = trimTrailingZeros;
  window.TGA.pluralRu = pluralRu;
})();
