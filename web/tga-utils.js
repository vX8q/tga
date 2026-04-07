// ─── tga-utils.js ─────────────────────────────────────────────────────────────
// Общие утилиты: esc, dash, форматы дат, серии, страны, паддинг, сортировка.
// Зависимости: tga-config.js, tga-i18n.js
// Порядок загрузки: tga-config.js → tga-i18n.js → tga-utils.js → app.js
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  window.TGA = window.TGA || {};
  var t      = function (k) { return window.TGA.t(k); };
  var getLang = function () { return window.TGA.getLang(); };

  // ─── Экранирование HTML ──────────────────────────────────────────────────
  function esc(s) {
    if (s == null) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ─── Пустое значение → прочерк ──────────────────────────────────────────
  function dash(val) {
    if (val == null || val === '') return '—';
    if (typeof val === 'string' && val.trim() === '') return '—';
    return val;
  }

  // ─── Имена пилотов ───────────────────────────────────────────────────────
  var driverDisplayNames = { 'Cleetus Mitchell': 'Garrett Mitchell' };

  function driverDisplayName(name) {
    if (name == null || typeof name !== 'string') return name;
    var trimmed = name.trim();
    // Убираем кол-во гонок в скобках: "Spencer Boyd (22 races)" → "Spencer Boyd"
    var withoutRaces = trimmed.replace(/\s*\(\d+\s+races?\)\s*$/i, '').trim();
    return driverDisplayNames[withoutRaces] || driverDisplayNames[trimmed] || withoutRaces || trimmed;
  }

  // ─── Хелпер серий ────────────────────────────────────────────────────────
  function isSeriesId(id, name) {
    return (id || '').toLowerCase() === name.toLowerCase();
  }

  // ─── Паддинг панелей ─────────────────────────────────────────────────────
  function adjustEventPanelPadding() {
    requestAnimationFrame(function () {
      var h = document.querySelector('#view-event .event-sticky-header');
      var w = document.getElementById('event-panels-wrap');
      if (h && w) w.style.paddingTop = (h.offsetHeight + 8) + 'px';
    });
  }

  function adjustDetailPanelPadding() {
    requestAnimationFrame(function () {
      var h = document.querySelector('#view-detail .detail-sticky-header');
      var w = document.getElementById('detail-panels-wrap');
      if (h && w) w.style.paddingTop = (h.offsetHeight + 8) + 'px';
    });
  }

  function adjustSeasonPanelPadding() {
    requestAnimationFrame(function () {
      var h = document.querySelector('#view-season .detail-sticky-header');
      var w = document.getElementById('season-content');
      if (h && w) w.style.paddingTop = (h.offsetHeight + 8) + 'px';
    });
  }

  window.addEventListener('resize', function () {
    adjustEventPanelPadding();
    adjustDetailPanelPadding();
    adjustSeasonPanelPadding();
  });

  // ─── Статический рендер Car Specs для Supercars ──────────────────────────
  // (на случай, если API не отвечает)
  function renderSupercarsStaticSpecs() {
    var carWrap = document.getElementById('car-spec-wrap');
    var modelsWrap = document.getElementById('car-models-table-wrap');
    var techWrap = document.getElementById('technical-spec-table-wrap');
    var enginesTitle = document.getElementById('engines-spec-title');
    var enginesWrap = document.getElementById('engines-spec-table-wrap');
    var homologTitle = document.getElementById('homologation-spec-title');
    var homologWrap = document.getElementById('homologation-spec-table-wrap');
    if (!carWrap || !modelsWrap || !techWrap) return;

    var sc = window.tgaSeries && window.tgaSeries.supercars;
    if (!sc) return;

    var carModels = sc.carModels || [];
    var techSpec = sc.technicalSpec || [];
    var engines = sc.engines || [];
    var homologation = sc.homologation || [];

    carWrap.classList.remove('hidden');

    // Car models
    modelsWrap.innerHTML =
      '<table class="data-table"><thead><tr>' +
        '<th>' + t('th.manufacturer') + '</th>' +
        '<th>' + t('th.model') + '</th>' +
      '</tr></thead><tbody>' +
      carModels.map(function (c) {
        return '<tr><td>' + esc(dash(c.manufacturer)) + '</td><td>' + esc(dash(c.model)) + '</td></tr>';
      }).join('') +
      '</tbody></table>';
    if (typeof makeTableSortable === 'function') {
      makeTableSortable(modelsWrap.querySelector('.data-table'), carModels.map(function (c) { return [c.manufacturer, c.model]; }), esc);
    }

    // Technical spec
    techWrap.innerHTML =
      '<table class="data-table"><thead><tr>' +
      '<th>' + t('th.field') + '</th>' +
      '<th>' + t('th.value') + '</th>' +
      '</tr></thead><tbody>' +
      techSpec.map(function (s) {
        var rawVal = dash(s.value);
        var cellVal;
        if (String(s.key || '').toLowerCase().trim() === 'estimated season cost') {
          var idx = rawVal.indexOf(' (');
          if (idx > 0) {
            cellVal = esc(rawVal.slice(0, idx)) + '<br>' + esc(rawVal.slice(idx + 1));
          } else {
            cellVal = esc(rawVal);
          }
        } else {
          cellVal = esc(rawVal);
        }
        return '<tr><td class="col-field">' + esc(dash(s.key)) + '</td><td>' + cellVal + '</td></tr>';
      }).join('') +
      '</tbody></table>';
    if (typeof makeTableSortable === 'function') {
      makeTableSortable(techWrap.querySelector('.data-table'), techSpec.map(function (s) { return [s.key, s.value]; }), esc);
    }

    // Engines
    if (enginesWrap && enginesTitle) {
      enginesWrap.classList.remove('hidden');
      enginesTitle.classList.remove('hidden');
      enginesWrap.innerHTML =
        '<table class="data-table"><thead><tr><th>Car model</th><th>Engine specification</th></tr></thead><tbody>' +
        engines.map(function (e) {
          return '<tr><td>' + esc(dash(e.model)) + '</td><td>' + esc(dash(e.spec)) + '</td></tr>';
        }).join('') +
        '</tbody></table>';
      if (typeof makeTableSortable === 'function') {
        makeTableSortable(enginesWrap.querySelector('.data-table'), engines.map(function (e) { return [e.model, e.spec]; }), esc);
      }
    }

    // Homologation
    if (homologWrap && homologTitle) {
      homologWrap.classList.remove('hidden');
      homologTitle.classList.remove('hidden');
      homologWrap.innerHTML =
        '<table class="data-table"><thead><tr><th>Manufacturer</th><th>Homologating team</th></tr></thead><tbody>' +
        homologation.map(function (h) {
          return '<tr><td>' + esc(dash(h.manufacturer)) + '</td><td>' + esc(dash(h.team)) + '</td></tr>';
        }).join('') +
        '</tbody></table>';
      if (typeof makeTableSortable === 'function') {
        makeTableSortable(homologWrap.querySelector('.data-table'), homologation.map(function (h) { return [h.manufacturer, h.team]; }), esc);
      }
    }
  }

  // ─── Сортировка объектных таблиц ─────────────────────────────────────────
  function addObjectTableSort(tableEl, dataArray, rowRenderer, keys, fullBodyRenderer) {
    if (!tableEl || !dataArray || dataArray.length === 0) return;
    if (!rowRenderer && !fullBodyRenderer) return;
    var thead = tableEl.querySelector('thead tr');
    var tbody = tableEl.querySelector('tbody');
    if (!thead || !tbody) return;
    var dataCopy = dataArray.slice();
    function render() {
      if (fullBodyRenderer) {
        var result = fullBodyRenderer(dataCopy);
        if (typeof result === 'string' && result.indexOf('<tbody') !== -1) {
          tableEl.innerHTML = result;
          attachSortHandlers();
        } else {
          var tb = tableEl.querySelector('tbody');
          if (tb) tb.innerHTML = result;
        }
      } else {
        var tb = tableEl.querySelector('tbody');
        if (tb) tb.innerHTML = dataCopy.map(rowRenderer).join('');
      }
    }
    function attachSortHandlers() {
      var tr = tableEl.querySelector('thead tr');
      var ths = tr ? tr.querySelectorAll('th') : [];
      for (var c = 0; c < ths.length; c++) {
        (function (colIndex) {
          var key = keys[colIndex];
          if (key == null) return;
          ths[colIndex].classList.add('sortable');
          ths[colIndex].addEventListener('click', function () {
            var dir = ths[colIndex].dataset.sortDir === 'asc' ? -1 : 1;
            ths[colIndex].dataset.sortDir = dir === 1 ? 'asc' : 'desc';
            dataCopy.sort(function (a, b) {
              var va = a[key] != null ? String(a[key]) : '';
              var vb = b[key] != null ? String(b[key]) : '';
              var na = parseFloat(va);
              var nb = parseFloat(vb);
              if (!isNaN(na) && !isNaN(nb)) {
                if (na < nb) return dir * -1;
                if (na > nb) return dir * 1;
                return 0;
              }
              return dir * va.localeCompare(vb, undefined, { numeric: true });
            });
            [].forEach.call(ths, function (th) { th.classList.remove('sort-asc', 'sort-desc'); });
            ths[colIndex].classList.add(dir === 1 ? 'sort-asc' : 'sort-desc');
            render();
          });
        })(c);
      }
    }
    attachSortHandlers();
  }

  // ─── Типы серий ──────────────────────────────────────────────────────────
  // Примечание: параметр намеренно называется typeKey, чтобы не тенить внешний t()
  function typeLabel(typeKey) {
    var labels = {
      openwheel: 'Open wheel',
      gt_endurance: 'GT Endurance',
      gt_sprint: 'GT Sprint',
      touring: 'Touring',
      stock_car_racing: 'Stock car',
      single_make: 'Single make'
    };
    return labels[typeKey] || typeKey || '—';
  }

  // ─── Страны ──────────────────────────────────────────────────────────────
  function countryDisplay(country) {
    if (!country) return { icon: '', label: '—' };
    var c = String(country).toUpperCase();
    if (c === 'USA')    return { icon: '\uD83C\uDDFA\uD83C\uDDF8', label: 'USA' };
    if (c === 'ITALY')  return { icon: '\uD83C\uDDEE\uD83C\uDDF9', label: 'Italy' };
    if (c === 'FIA')    return { icon: '\uD83C\uDF10', label: 'World' };
    if (c === 'EUROPE') return { icon: '', label: 'Europe' };
    return { icon: '', label: country };
  }

  function countryHtml(country) {
    var d = countryDisplay(country);
    return esc(d.label);
  }

  function syncStandingsScrollBars() { /* верхняя полоска удалена */ }

  // ─── Категории серий ─────────────────────────────────────────────────────
  var categories = [
    { key: 'openwheel', ids: ['F1', 'INDYCAR', 'SUPER_FORMULA', 'F2', 'F3', 'FREC', 'F4_IT', 'SMP_F4_RU'] },
    { key: 'stockcar',  ids: ['NASCAR_CUP', 'NOAPS', 'NASCAR_TRUCK', 'ARCA', 'NASCAR_MODIFIED'] },
    { key: 'endurance', ids: ['WEC', 'ELMS', 'IMSA'] },
    // В Touring сначала показываем Supercars
    { key: 'touring',   ids: ['SUPERCARS', 'GTWCE_END', 'GTWCE_SPRINT', 'PSC', 'DTM', 'SUPER_GT'] }
  ];

  var categoryBySeriesId = {};
  categories.forEach(function (cat) {
    cat.ids.forEach(function (id) {
      categoryBySeriesId[id] = cat.key;
      categoryBySeriesId[id.toLowerCase()] = cat.key;
    });
  });

  var categoryColors = (window.TGA_CATEGORY_COLORS || {});
  var seriesColors   = (window.TGA_SERIES_COLORS || {});
  var seriesShort    = (window.TGA_SERIES_SHORT || {});

  // ─── Цвета и бейджи серий ────────────────────────────────────────────────
  function hexRgb(hex) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return r + ',' + g + ',' + b;
  }

  function seriesBadge(seriesId) {
    var sid = (seriesId || '').toLowerCase();
    var cat = categoryBySeriesId[sid] || categoryBySeriesId[seriesId] || 'openwheel';
    var color = seriesColors[(seriesId || '').toUpperCase()] || categoryColors[cat] || '#888888';
    var rgb = hexRgb(color);
    var label = seriesShort[seriesId] || seriesShort[(seriesId || '').toUpperCase()] || seriesId;
    return '<span class="series-badge" style="color:' + color + ';background:rgba(' + rgb + ',0.1);border:1px solid rgba(' + rgb + ',0.22)">' + esc(label) + '</span>';
  }

  // ─── Форматы дат ─────────────────────────────────────────────────────────
  function formatShortDate(dateStr) {
    if (!dateStr) return '—';
    var d = new Date(dateStr + 'T12:00:00');
    if (isNaN(d.getTime())) return dateStr;
    var months_en = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var months_ru = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    var day = d.getDate();
    var mon = getLang() === 'ru' ? months_ru[d.getMonth()] : months_en[d.getMonth()];
    return getLang() === 'ru' ? day + ' ' + mon : mon + ' ' + day;
  }

  function formatDateRange(startDs, endDs) {
    if (!startDs) return '—';
    var months_en = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var months_ru = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    var d1 = new Date(startDs + 'T12:00:00');
    if (!endDs || startDs === endDs) {
      var day = d1.getDate();
      var mon = getLang() === 'ru' ? months_ru[d1.getMonth()] : months_en[d1.getMonth()];
      return getLang() === 'ru' ? day + ' ' + mon : mon + ' ' + day;
    }
    var d2 = new Date(endDs + 'T12:00:00');
    var d1day = d1.getDate(), d2day = d2.getDate();
    var m1 = getLang() === 'ru' ? months_ru[d1.getMonth()] : months_en[d1.getMonth()];
    var m2 = getLang() === 'ru' ? months_ru[d2.getMonth()] : months_en[d2.getMonth()];
    if (d1.getMonth() === d2.getMonth()) {
      return getLang() === 'ru' ? d1day + '\u2013' + d2day + '\u00a0' + m1 : m1 + '\u00a0' + d1day + '\u2013' + d2day;
    }
    return getLang() === 'ru'
      ? d1day + '\u00a0' + m1 + '\u2013' + d2day + '\u00a0' + m2
      : m1 + '\u00a0' + d1day + '\u2013' + m2 + '\u00a0' + d2day;
  }

  /** Parse event start datetime. timeStr in HH:MM or 12h AM/PM/a.m./p.m. tzOffset: '+03:00' (MSK) or '-05:00' (EST). */
  function parseEventDate(dateStr, timeStr, tzOffset) {
    if (!dateStr) return null;
    var isoTime = '12:00:00';
    if (timeStr) {
      var m12 = timeStr.match(/(\d+):(\d+)\s*([ap]\.?m\.?|AM|PM)/i);
      var m24 = timeStr.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
      if (m12) {
        var h = parseInt(m12[1], 10);
        var min = m12[2];
        var ampm = m12[3].replace(/\./g, '').toUpperCase();
        if (ampm === 'PM' && h < 12) h += 12;
        if (ampm === 'AM' && h === 12) h = 0;
        isoTime = (h < 10 ? '0' : '') + h + ':' + min + ':00';
      } else if (m24) {
        var hour = parseInt(m24[1], 10);
        var min24 = m24[2];
        isoTime = (hour < 10 ? '0' : '') + hour + ':' + min24 + ':00';
      }
    }
    var offset = (tzOffset && /^[+-]\d{2}:\d{2}$/.test(tzOffset)) ? tzOffset : '-05:00';
    return new Date(dateStr + 'T' + isoTime + offset);
  }

  // ─── Экспорт ─────────────────────────────────────────────────────────────
  window.TGA.esc                      = esc;
  window.TGA.dash                     = dash;
  window.TGA.driverDisplayName        = driverDisplayName;
  window.TGA.isSeriesId               = isSeriesId;
  window.TGA.adjustEventPanelPadding  = adjustEventPanelPadding;
  window.TGA.adjustDetailPanelPadding = adjustDetailPanelPadding;
  window.TGA.adjustSeasonPanelPadding = adjustSeasonPanelPadding;
  window.TGA.renderSupercarsStaticSpecs = renderSupercarsStaticSpecs;
  window.TGA.addObjectTableSort       = addObjectTableSort;
  window.TGA.typeLabel                = typeLabel;
  window.TGA.countryDisplay           = countryDisplay;
  window.TGA.countryHtml              = countryHtml;
  window.TGA.syncStandingsScrollBars  = syncStandingsScrollBars;
  window.TGA.categories               = categories;
  window.TGA.categoryBySeriesId       = categoryBySeriesId;
  window.TGA.hexRgb                   = hexRgb;
  window.TGA.seriesBadge              = seriesBadge;
  window.TGA.formatShortDate          = formatShortDate;
  window.TGA.formatDateRange          = formatDateRange;
  window.TGA.parseEventDate           = parseEventDate;
})();
