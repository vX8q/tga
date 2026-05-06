// tga-event.js — Event page rendering: overview, sections (pre_season_tests, entry-list, practice, qualifying), race.
// Depends: tga-config.js, tga-i18n.js, tga-utils.js, fetch-json.js (window.TGA.*). Load before app.js.

(function () {
  'use strict';
  window.TGA = window.TGA || {};

  var state = window.TGA._state;
  var fetchJSON = window.TGA.fetchJSON;
  var logger = window.TGA.logger;
  var eventCfg = window.TGA.eventCfg;
  var EVENT_CONFIG = window.TGA.EVENT_CONFIG;
  var t = window.TGA.t;
  var getLang = window.TGA.getLang;
  var esc = window.TGA.esc;
  var dash = window.TGA.dash;
  var isSeriesId = window.TGA.isSeriesId;
  var driverDisplayName = window.TGA.driverDisplayName;
  var addObjectTableSort = window.TGA.addObjectTableSort;
  var trimTrailingZeros = window.TGA.trimTrailingZeros;
  var findCarNumberColumn = window.TGA.findCarNumberColumn;
  var localizeTableHeader = window.TGA.localizeTableHeader;
  var localizeCellNote = window.TGA.localizeCellNote;
  var localizeRaceReason = window.TGA.localizeRaceReason;
  var localizeStatKey = window.TGA.localizeStatKey;
  var localizeStatValue = window.TGA.localizeStatValue;
  var localizeSpecKey = window.TGA.localizeSpecKey;
  var localizeSpecValue = window.TGA.localizeSpecValue;
  var localizeDate = window.TGA.localizeDate;
  var localizeDistance = window.TGA.localizeDistance;
  var localizeEventPreview = window.TGA.localizeEventPreview;
  var translateValueHeaders = window.TGA.translateValueHeaders;
  var translateReasonHeaders = window.TGA.translateReasonHeaders;
  var adjustEventPanelPadding = window.TGA.adjustEventPanelPadding;
  var categoryBySeriesId = window.TGA.categoryBySeriesId;

  // F1 2025: соответствие "конструктор → шасси" для entry list Australian GP.
  // Локальная копия, чтобы не зависеть от наличия tga-series.js на странице события.
  var F1_2025_ENTRY_CHASSIS = {
    'Alpine-Renault': 'A525',
    'Aston Martin Aramco-Mercedes': 'AMR25',
    'Ferrari': 'SF-25',
    'Haas-Ferrari': 'VF-25',
    'Kick Sauber-Ferrari': 'C45',
    'McLaren-Mercedes': 'MCL39',
    'Mercedes': 'F1 W16',
    'Racing Bulls-Honda RBPT': 'VCARB02',
    'Red Bull Racing-Honda RBPT': 'RB21',
    'Williams-Mercedes': 'FW47'
  };

  var slugify = function (s) {
    return window.TGA.slugify ? window.TGA.slugify(s) : (s != null ? String(s).toLowerCase().replace(/[^a-z0-9\u0400-\u04ff]+/g, '-').replace(/^-+|-+$/g, '') : '');
  };
  var seriesIdToSlug = function (id) {
    return window.TGA.seriesIdToSlug ? window.TGA.seriesIdToSlug(id) : '';
  };
  var eventIdToSlug = function (id) {
    return window.TGA.eventIdToSlug ? window.TGA.eventIdToSlug(id) : '';
  };
  var showView = function (id) {
    if (window.TGA.showView) window.TGA.showView(id);
  };

  // ——— Series id from event id ———
  function eventSeriesId(eventId) {
    if (!eventId || typeof eventId !== 'string') return '';
    var u = String(eventId).toUpperCase();
    if (u.indexOf('NASCAR_') === 0) return u.replace(/_\d+.*$/, ''); // NASCAR_CUP_2026_1 -> NASCAR_CUP
    var first = u.split('_')[0];
    return first || '';
  }

  // ——— Event block definitions (overview nav) ———
  var eventBlockDefs = [
    { id: 'pre_season_tests', icon: 'pre_season', check: function (d) { return !!(d.tables && d.tables.pre_season_tests); }, meta: 'pre_season' },
    { id: 'entry-list',       icon: 'entry',      check: function (d) {
      var id = d && d.event_id ? String(d.event_id).toUpperCase() : '';
      var isF1 = id.indexOf('F1_') === 0;
      var hasEntryTable = !!(d && d.tables && d.tables.entry_list);
      return isF1 || hasEntryTable || (Array.isArray(d.entry_list) && d.entry_list.length > 0);
    }, meta: 'entry' },
    { id: 'practice',        icon: 'practice',    check: function (d) { return hasTableKey(d, 'practice'); }, meta: 'practice' },
    { id: 'qualifying',      icon: 'qualifying',   check: function (d) { return hasTableKey(d, 'qualifying'); }, meta: 'qualifying' },
    { id: 'race',             icon: 'race',        check: function (d) { return hasTableKey(d, 'race') || hasTableKey(d, 'race_results'); }, meta: 'race' }
  ];

  function hasTableKey(d, key) {
    var t = d && d.tables;
    if (!t || typeof t !== 'object') return false;
    if (t[key]) return true;
    if (key === 'race' && t.race_results) return true;
    return false;
  }

  // ——— Stat row parsing (key/value rows) ———
  function parseStatRow(row) {
    if (!row || !Array.isArray(row)) return null;
    var k = row[0] != null ? String(row[0]).trim() : '';
    var v = row.length > 1 ? row[1] : '';
    if (k === '') return null;
    return { key: k, value: v };
  }

  function getEventRaceStats(data) {
    var out = {};
    var tbl = data && data.tables && data.tables.race_stats;
    if (!tbl || !Array.isArray(tbl.rows)) return out;
    for (var i = 0; i < tbl.rows.length; i++) {
      var p = parseStatRow(tbl.rows[i]);
      if (p) out[p.key] = p.value;
    }
    return out;
  }

  function renderRaceStatsTable(stats) {
    if (!stats || typeof stats !== 'object') return '';
    var rows = [];
    for (var k in stats) if (Object.prototype.hasOwnProperty.call(stats, k)) {
      var keyLabel = (typeof localizeStatKey === 'function' ? localizeStatKey(k) : k);
      var valLabel = (typeof localizeStatValue === 'function' ? localizeStatValue(stats[k]) : stats[k]);
      rows.push('<tr><td class="col-field">' + esc(keyLabel) + '</td><td>' + esc(dash(valLabel)) + '</td></tr>');
    }
    if (rows.length === 0) return '';
    return '<div class="table-wrap"><table class="data-table"><thead><tr><th>' + esc(t('th.field') || 'Field') + '</th><th>' + esc(t('th.value') || 'Value') + '</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }

  function findHeaderIndex(headers, name) {
    if (!Array.isArray(headers) || !name) return -1;
    var n = String(name).toLowerCase();
    for (var i = 0; i < headers.length; i++) {
      if (String(headers[i] || '').toLowerCase() === n) return i;
    }
    return -1;
  }

  // F1: в колонке Grid не показываем номера после PL (PL1/PL2 → PL).
  function normalizeF1GridColumn(headers, rows, seriesId) {
    if (!isSeriesId || !isSeriesId(seriesId, 'f1')) return { headers: headers, rows: rows };
    if (!Array.isArray(headers) || !Array.isArray(rows)) return { headers: headers, rows: rows };
    var gridIdx = findHeaderIndex(headers, 'Grid');
    if (gridIdx < 0) return { headers: headers, rows: rows };
    var newRows = rows.map(function (row) {
      var r = row.slice();
      if (gridIdx < r.length && r[gridIdx] != null) {
        var val = String(r[gridIdx]).trim();
        if (/^PL\d+$/i.test(val)) r[gridIdx] = 'PL';
      }
      return r;
    });
    return { headers: headers, rows: newRows };
  }

  function removeColumnByName(headers, rows, columnName) {
    var idx = findHeaderIndex(headers, columnName);
    if (idx < 0) return { headers: headers, rows: rows };
    var h = headers.slice();
    h.splice(idx, 1);
    var r = (rows || []).map(function (row) {
      var a = row.slice();
      if (idx < a.length) a.splice(idx, 1);
      return a;
    });
    return { headers: h, rows: r };
  }

  function normalizeFinStColumns(headers, rows) {
    if (!Array.isArray(headers) || !Array.isArray(rows)) return { headers: headers, rows: rows };
    var finStIdx = findHeaderIndex(headers, 'Fin / ST');
    if (finStIdx < 0) return { headers: headers, rows: rows };
    var newHeaders = headers.slice();
    newHeaders.splice(finStIdx, 1, 'Fin', 'ST');
    var newRows = rows.map(function (row) {
      var r = row.slice();
      var cell = finStIdx < r.length && r[finStIdx] != null ? String(r[finStIdx]).trim() : '';
      var fin = '';
      var st = '';
      if (cell.indexOf('/') >= 0) {
        var parts = cell.split('/');
        fin = (parts[0] || '').trim();
        st = parts.slice(1).join('/').trim();
      } else {
        fin = cell;
      }
      if (st) {
        var stMatch = st.match(/^(ST\s*\d+)/i);
        st = stMatch ? stMatch[1].replace(/\s+/g, ' ').toUpperCase() : st;
      }
      r.splice(finStIdx, 1, fin, st);
      return r;
    });
    return { headers: newHeaders, rows: newRows };
  }

  function splitTeamCarSponsor(cellText) {
    if (cellText == null || typeof cellText !== 'string') return { team: '', car: '', sponsor: '' };
    var s = cellText.trim();
    var parts = s.split('/').map(function (p) { return p.trim(); });
    return {
      team: parts[0] || '',
      car: parts[1] || '',
      sponsor: parts[2] || ''
    };
  }

  function filterRowsByNumericColumn(rows, colIndex, minValue) {
    if (!Array.isArray(rows) || colIndex < 0) return rows;
    return rows.filter(function (row) {
      var v = row[colIndex];
      if (v == null || v === '') return false;
      var n = parseFloat(String(v).replace(/,/g, ''), 10);
      return !isNaN(n) && n >= minValue;
    });
  }

  // ——— IMSA table helpers ———
  function normalizeImsaTable(headers, rows, options) {
    options = options || {};
    var teamCarCol = findHeaderIndex(headers, 'TEAM/CAR/SPONSOR');
    if (teamCarCol < 0) return { headers: headers, rows: rows };
    var newHeaders = headers.slice();
    newHeaders[teamCarCol] = 'Team';
    var insertAt = teamCarCol + 1;
    newHeaders.splice(insertAt, 0, 'Car');
    var newRows = (rows || []).map(function (row) {
      var r = row.slice();
      var cell = r[teamCarCol];
      var split = splitTeamCarSponsor(cell);
      r[teamCarCol] = split.team;
      r.splice(insertAt, 0, split.car);
      return r;
    });
    return { headers: newHeaders, rows: newRows };
  }

  function buildImsaDaytonaQualTable(headers, rows) {
    var norm = normalizeImsaTable(headers, rows);
    return buildTableSection(
      '',
      norm.headers,
      norm.rows,
      { tableClass: 'qualifying-table' }
    );
  }

  function buildImsaDaytonaRaceTable(headers, rows) {
    var norm = normalizeImsaTable(headers, rows);
    return buildTableSection(
      '',
      norm.headers,
      norm.rows,
      { tableClass: 'race-results-table' }
    );
  }

  // ——— Generic table section (title, headers, rows → HTML string) ———
  function buildTableSection(title, headers, rows, options, _e, _f, _g, _h) {
    options = options || {};
    var tableClass = options.tableClass || '';
    var sectionClass = options.sectionClass || '';
    var titleTag = options.titleTag !== false ? ('<h4 class="table-section-title">' + esc(title || '') + '</h4>') : '';
    if (!Array.isArray(headers) || !Array.isArray(rows)) return titleTag;
    var th = '<thead><tr>';
    for (var i = 0; i < headers.length; i++) {
      var h = headers[i];
      var label = (typeof localizeTableHeader === 'function' ? localizeTableHeader(h) : h);
      th += '<th>' + esc(label) + '</th>';
    }
    th += '</tr></thead>';
    var tb = '<tbody>';
    for (var j = 0; j < rows.length; j++) {
      var row = rows[j];
      tb += '<tr>';
      for (var c = 0; c < ((row && row.length) || 0); c++) {
        var cell = row[c];
        var note = (typeof localizeCellNote === 'function' ? localizeCellNote(cell) : cell);
        var display = (typeof localizeRaceReason === 'function' ? localizeRaceReason(note) : note);
        tb += '<td>' + esc(dash(display)) + '</td>';
      }
      tb += '</tr>';
    }
    tb += '</tbody>';
    var wrapClass = 'table-wrap';
    if (sectionClass) wrapClass += ' ' + sectionClass;
    return titleTag + '<div class="' + wrapClass + '"><table class="data-table ' + tableClass + '">' + th + tb + '</table></div>';
  }

  function buildSessionMetaTable(meta) {
    if (!meta || typeof meta !== 'object') return '';
    var rows = [];
    for (var k in meta) if (Object.prototype.hasOwnProperty.call(meta, k)) {
      var v = meta[k];
      rows.push('<tr><td class="col-field">' + esc(k) + '</td><td>' + esc(dash(v)) + '</td></tr>');
    }
    if (rows.length === 0) return '';
    return '<div class="table-wrap"><table class="data-table table-meta"><thead><tr><th>' + esc(t('th.field') || 'Field') + '</th><th>' + esc(t('th.value') || 'Value') + '</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }

  function add(a, b) { return (a || 0) + (b || 0); }

  function applyTeamNameByNumber(entryList, rows, numberColIndex, teamColIndex) {
    if (!Array.isArray(entryList) || !Array.isArray(rows) || numberColIndex < 0 || teamColIndex < 0) return rows;
    var byNumber = {};
    for (var i = 0; i < entryList.length; i++) {
      var e = entryList[i];
      var num = e && (e.number != null ? String(e.number).trim() : '');
      if (num) byNumber[num] = e.team || '';
    }
    return rows.map(function (row) {
      var r = row.slice();
      var num = r[numberColIndex] != null ? String(r[numberColIndex]).trim() : '';
      if (teamColIndex < r.length && byNumber[num]) r[teamColIndex] = byNumber[num];
      return r;
    });
  }

  // ——— F1 2025 entry list table (grouped by team, with chassis) ———
  function buildF12025EntryListHTML(entryList) {
    if (!Array.isArray(entryList) || entryList.length === 0) return '';
    var chassisMeta = F1_2025_ENTRY_CHASSIS || {};

    // Клонируем и сортируем по команде, затем по номеру.
    var list = entryList.slice().sort(function (a, b) {
      var ta = (a.team || '').toLowerCase();
      var tb = (b.team || '').toLowerCase();
      if (ta < tb) return -1;
      if (ta > tb) return 1;
      var na = (a.number != null ? String(a.number) : '');
      var nb = (b.number != null ? String(b.number) : '');
      return na.localeCompare(nb, undefined, { numeric: true });
    });

    var rowsHtml = [];
    var i = 0;
    while (i < list.length) {
      var base = list[i];
      var man = String(base.manufacturer || '').trim();
      var teamName = String(base.team || '').trim();
      // F1 2025: шасси по конструктору (manufacturer), а не по названию команды.
      var chassis = chassisMeta && chassisMeta[man] ? chassisMeta[man] : '';
      var span = 1;
      for (var j = i + 1; j < list.length; j++) {
        var e2 = list[j];
        if (String(e2.team || '').trim() !== teamName) break;
        span++;
      }
      for (var k = 0; k < span; k++) {
        var e = list[i + k];
        var cells = '';
        if (k === 0) {
          cells += '<td rowspan="' + span + '">' + esc(dash(man)) + '</td>' +
                   '<td rowspan="' + span + '">' + esc(dash(chassis)) + '</td>' +
                   '<td rowspan="' + span + '">' + esc(dash(teamName)) + '</td>';
        }
        var num = e.number != null ? e.number : '';
        var drv = driverDisplayName ? driverDisplayName(e.driver) : e.driver;
        cells += '<td class="col-num">' + esc(dash(num)) + '</td>' +
                 '<td>' + esc(dash(drv)) + '</td>';
        rowsHtml.push('<tr>' + cells + '</tr>');
      }
      i += span;
    }

    var header =
      '<thead><tr>' +
      '<th>' + esc(t('th.manufacturer') || 'Manufacturer') + '</th>' +
      '<th>' + esc(t('th.chassis') || 'Chassis') + '</th>' +
      '<th>' + esc(t('th.team') || 'Team') + '</th>' +
      '<th>' + esc(t('th.no') || 'No.') + '</th>' +
      '<th>' + esc(t('th.driver') || 'Driver') + '</th>' +
      '</tr></thead>';

    return '<div class="table-wrap"><table class="data-table">' + header + '<tbody>' +
      rowsHtml.join('') + '</tbody></table></div>';
  }

  function renderOneRaceSession(session, seriesId, entryList, parentEl) {
    if (!session || !parentEl) return;
    var title = session.title || '';
    var subtitle = session.subtitle || '';
    // F1: не показываем служебный подзаголовок вида "R1 RACE" — оставляем только название этапа.
    if (isSeriesId(seriesId, 'f1') && /^R\d+\s+RACE$/i.test(subtitle)) {
      subtitle = '';
    }
    // F2/F3: подзаголовок с местом дублирует шапку события — не показываем.
    if (isSeriesId(seriesId, 'f2') || isSeriesId(seriesId, 'f3')) {
      subtitle = '';
    }
    var meta = session.meta;
    var headers = session.headers;
    var rows = session.rows;
    if (Array.isArray(session.rows_old)) rows = session.rows_old;
    var html = '';
    if (title) html += '<h4 class="table-section-title">' + esc(title) + '</h4>';
    if (subtitle) html += '<p class="table-subtitle">' + esc(subtitle) + '</p>';
    if (meta) html += buildSessionMetaTable(meta);
    var hasResultsTable = Array.isArray(headers) && Array.isArray(rows) && rows.length > 0;
    if (hasResultsTable) {
      var finStNorm = normalizeFinStColumns(headers, rows);
      headers = finStNorm.headers;
      rows = finStNorm.rows;
      if (isSeriesId(seriesId, 'imsa')) {
        var norm = normalizeImsaTable(headers, rows);
        headers = norm.headers;
        rows = norm.rows;
      }
      var numCol = findCarNumberColumn(headers);
      var teamCol = findHeaderIndex(headers, 'Team');
      if (teamCol < 0) teamCol = findHeaderIndex(headers, 'TEAM/CAR/SPONSOR');
      if (numCol >= 0 && teamCol >= 0 && Array.isArray(entryList)) rows = applyTeamNameByNumber(entryList, rows, numCol, teamCol);
      html += buildTableSection('', headers, rows, { tableClass: 'race-results-table' });
    }
    var div = document.createElement('div');
    div.className = 'event-race-session';
    div.innerHTML = html;
    parentEl.appendChild(div);
  }

  function appendTable(parentEl, html) {
    if (!parentEl) return;
    var div = document.createElement('div');
    div.innerHTML = html;
    parentEl.appendChild(div);
  }

  // ——— renderEventPage: fetch event JSON, show view, fill breadcrumb/title/meta, route to overview/section/race ———
  function renderEventPage(eventId, section) {
    if (!eventId) return;
    showView('view-event');
    var breadcrumb = document.getElementById('event-breadcrumb');
    var titleEl = document.getElementById('event-title');
    var metaEl = document.getElementById('event-meta');
    var contentEl = document.getElementById('event-content');
    if (breadcrumb) breadcrumb.innerHTML = '<a href="/">← ' + (t('breadcrumb.all') || 'All series') + '</a><span class="breadcrumb-sep">/</span><span>' + esc(eventId) + '</span>';
    if (titleEl) titleEl.textContent = '—';
    if (metaEl) metaEl.textContent = '';
    if (contentEl) contentEl.innerHTML = '<p class="loading-msg">Loading…</p>';

    var apiEventId = (eventId || '').replace(/-/g, '_');
    var seriesId = eventSeriesId(apiEventId);
    var slug = eventIdToSlug(apiEventId) || String(apiEventId).toLowerCase().replace(/_/g, '-');
    var url = '/api/events/' + encodeURIComponent(apiEventId.toLowerCase());
    var fetchFn = fetchJSON || window.fetch;
    if (typeof fetchFn !== 'function') {
      if (contentEl) contentEl.innerHTML = '<p class="empty-msg">Cannot load event.</p>';
      return;
    }
    var doFetch = fetchFn.bind && fetchFn.call ? fetchFn : function (u) { return fetch(u).then(function (r) { return r.json(); }); };
    doFetch(url)
      .then(function (data) {
        if (!data || typeof data !== 'object') { if (contentEl) contentEl.innerHTML = '<p class="empty-msg">No data.</p>'; return; }
        if (data.data && typeof data.data === 'object') data = data.data;
        if (data.event && typeof data.event === 'object') data = data.event;
        if (Array.isArray(data) && data.length > 0) data = data[0];
        var d = data;
        var evSeriesId = eventSeriesId(d && d.event_id);
        var raceName = d.race || eventId;
        if (evSeriesId && evSeriesId.toUpperCase() === 'F1' && typeof raceName === 'string') {
          raceName = raceName.replace(/^F1\s*[—-]\s*/i, '');
        }
        if (titleEl && raceName) titleEl.textContent = raceName;
        if (metaEl) {
          var parts = [];
          var formatDateRangeLong = window.TGA && window.TGA.formatDateRangeLong;
          var getEventSessionDateRange = window.TGA && window.TGA.getEventSessionDateRange;
          var sessionRange = getEventSessionDateRange ? getEventSessionDateRange(d) : null;
          var startIso = (sessionRange && sessionRange.minIso) ? sessionRange.minIso : (d.start_date || '').slice(0, 10);
          var endIso = (sessionRange && sessionRange.maxIso) ? sessionRange.maxIso : (d.end_date || '').slice(0, 10);
          var datePart = (startIso && endIso && startIso !== endIso && formatDateRangeLong)
            ? formatDateRangeLong(startIso, endIso)
            : (startIso ? (typeof localizeDate === 'function' ? localizeDate(startIso) : startIso) : (d.date && typeof localizeDate === 'function' ? localizeDate(d.date) : (d.date || '')));
          if (datePart) parts.push(datePart);
          var trackVal = d.track || '';
          var locVal = d.location || '';
          if (trackVal) parts.push(trackVal);
          if (locVal) {
            var locTrim = String(locVal).trim();
            var trackTrim = String(trackVal).trim();
            // Не дублируем, если location совпадает с track или содержит его.
            if (!trackTrim ||
                (locTrim !== trackTrim &&
                 locTrim.indexOf(trackTrim) === -1 &&
                 trackTrim.indexOf(locTrim) === -1)) {
              parts.push(locVal);
            }
          }
          metaEl.textContent = parts.join(' · ');
        }
        if (document.title !== undefined) document.title = (raceName || eventId) + ' — The Grid Archive (TGA)';
        var seriesSlug = seriesIdToSlug(seriesId) || seriesId;
        if (breadcrumb) {
          var evId = String(d.event_id || eventId || '');
          var evIdUpper = evId.toUpperCase();
          var isF1Series = ((seriesId || '').toUpperCase() === 'F1');

          // Пытаемся вытащить год сезона из event_id (F1_2025_1) или из slug в URL (f1-2025-1).
          var seasonYear = null;
          if (isF1Series) {
            var yearMatchId = evIdUpper.match(/^F1_(\d{4})_/);
            if (yearMatchId && yearMatchId[1]) {
              seasonYear = yearMatchId[1];
            } else {
              var yearMatchSlug = String(eventId || '').match(/f1-(\d{4})-/i);
              if (yearMatchSlug && yearMatchSlug[1]) seasonYear = yearMatchSlug[1];
            }
          }

          var f1HomeHref = isF1Series ? '/series/f1/history' : ('/series/' + encodeURIComponent(seriesSlug));
          var crumbHtml =
            '<a href="/">← ' + (t('breadcrumb.all') || 'All series') + '</a><span class="breadcrumb-sep">/</span>' +
            // Для F1 первый линк ведёт в историю всех сезонов (1950 — настоящее).
            // Для остальных серий — на главную страницу серии.
            '<a href="' + f1HomeHref + '">' + (isF1Series ? 'F1' : esc(seriesId || '')) + '</a>';

          // Для F1 добавляем промежуточный "F1 20XX" → /season/f1-20XX (расписание сезона).
          if (isF1Series && seasonYear) {
            var seasonSlug = 'f1-' + seasonYear;
            crumbHtml += '<span class="breadcrumb-sep">/</span>' +
              '<a href="/season/' + seasonSlug + '">F1 ' + seasonYear + '</a>';
          }

          crumbHtml += '<span class="breadcrumb-sep">/</span>' +
            '<span>' + esc(raceName || eventId) + '</span>';
          breadcrumb.innerHTML = crumbHtml;
        }
        if (section === 'race') {
          renderRaceContent(d, contentEl);
        } else if (section && section !== 'overview') {
          renderEventSectionContent(d, section, contentEl);
        } else {
          renderEventOverviewContent(d, eventId, contentEl);
        }
        if (typeof adjustEventPanelPadding === 'function') adjustEventPanelPadding();
      })
      .catch(function (err) {
        if (logger && logger.error) logger.error('event load failed', err);
        if (contentEl) contentEl.innerHTML = '<p class="empty-msg">Failed to load event.</p>';
      });
  }

  function renderEventOverviewContent(data, eventId, el) {
    if (!el) return;
    el.innerHTML = '';
    var seriesId = eventSeriesId(eventId || (data && data.event_id));
    var seriesLc = (seriesId || '').toLowerCase();
  // Основные данные события для заголовков карточек: название и дата.
  var raceName = (data && (data.race || data.event_id)) || (eventId || '');
  if (seriesId && seriesId.toUpperCase() === 'F1' && typeof raceName === 'string') {
    raceName = raceName.replace(/^F1\s*[—-]\s*/i, '');
  }
  var eventDateMeta = '';
  if (data) {
    var formatDateRangeLong = window.TGA && window.TGA.formatDateRangeLong;
    var getEventSessionDateRange = window.TGA && window.TGA.getEventSessionDateRange;
    var sessionRange = getEventSessionDateRange ? getEventSessionDateRange(data) : null;
    var startIso = (sessionRange && sessionRange.minIso) ? sessionRange.minIso : (data.start_date || '').slice(0, 10);
    var endIso = (sessionRange && sessionRange.maxIso) ? sessionRange.maxIso : (data.end_date || '').slice(0, 10);
    if (startIso && endIso && startIso !== endIso && formatDateRangeLong) {
      eventDateMeta = formatDateRangeLong(startIso, endIso);
    } else {
      var baseDate = startIso || (data.date || '');
      eventDateMeta = baseDate
        ? (typeof localizeDate === 'function' ? localizeDate(baseDate) : baseDate)
        : '';
    }
    if (data.track) eventDateMeta += (eventDateMeta ? ' · ' : '') + data.track;
    if (data.location) eventDateMeta += (eventDateMeta ? ', ' : '') + data.location;
  }
    var html = '';
    var evIdUpper = String(data && data.event_id || eventId || '').toUpperCase();
    if (data.event_preview) {
      var previewBody = typeof localizeEventPreview === 'function' ? localizeEventPreview(data.event_preview) : data.event_preview;
      html += '<section class="event-data-section"><h2>' + esc(t('event.event_preview') || 'Event preview') + '</h2><p class="event-preview-text">' + esc(previewBody) + '</p></section>';
    }
    if ((data.laps || data.distance) && evIdUpper !== 'SUPER_GT_2026_2') {
      html += '<section class="event-data-section event-overview-laps-and-blocks"><div class="table-wrap"><table class="data-table"><thead><tr><th>' + esc(t('th.laps') || 'Laps') + '</th><th>' + esc(t('th.distance') || 'Distance') + '</th></tr></thead><tbody><tr><td>' + esc(dash(data.laps)) + '</td><td>' + esc(typeof localizeDistance === 'function' ? localizeDistance(data.distance) : dash(data.distance)) + '</td></tr></tbody></table></div></section>';
    }
    var stats = getEventRaceStats(data);
    if (Object.keys(stats).length > 0) html += '<section class="event-data-section">' + renderRaceStatsTable(stats) + '</section>';
    var blocks = [];
    for (var i = 0; i < eventBlockDefs.length; i++) {
      var bl = eventBlockDefs[i];
      if (bl.check && bl.check(data)) {
        var slug = eventIdToSlug(eventId) || (eventId ? String(eventId).toLowerCase().replace(/_/g, '-') : '');
        var href = '/event/' + encodeURIComponent(slug) + (bl.id !== 'overview' ? '/' + bl.id : '');
        var blockLabel = (typeof t === 'function' && t('block.' + bl.id)) ? t('block.' + bl.id) : bl.id.replace(/-/g, ' ');
        blocks.push(
          '<a href="' + href + '" class="event-block">' +
            (bl.icon ? '<span class="event-block-icon">' + bl.icon + '</span>' : '') +
            (raceName ? '<span class="event-block-event">' + esc(raceName) + '</span>' : '') +
            (eventDateMeta ? '<span class="event-block-meta">' + esc(eventDateMeta) + '</span>' : '') +
            '<span class="event-block-label">' + esc(blockLabel) + '</span>' +
          '</a>'
        );
      }
    }
    if (blocks.length > 0) {
      var isSuperGtFuji2026 = evIdUpper === 'SUPER_GT_2026_2';
      var blocksClass = 'event-blocks' + ((seriesLc === 'frec' || seriesLc === 'f2' || seriesLc === 'imsa' || isSuperGtFuji2026) ? ' event-blocks--row' : '');
      html += '<section class="event-data-section event-overview-laps-and-blocks"><div class="' + blocksClass + '">' + blocks.join('') + '</div></section>';
    }
    var wrap = document.createElement('div');
    wrap.className = 'event-overview-content';
    wrap.innerHTML = html;
    el.appendChild(wrap);
  }

  function renderRaceContent(data, el) {
    if (!el) return;
    el.innerHTML = '';
    var tables = data && data.tables;
    var entryList = Array.isArray(data.entry_list) ? data.entry_list : [];
    var seriesId = eventSeriesId(data.event_id);
    if (tables && tables.race_results) {
      var rr = tables.race_results;
      var rp = tables.race_points;
      if (rp && Array.isArray(rp.headers) && Array.isArray(rp.rows) && rp.rows.length > 0) {
        var rpTitle = (rp.title != null && String(rp.title).trim()) ? String(rp.title).trim() : 'Points system';
        appendTable(el, buildTableSection(rpTitle, rp.headers, rp.rows, { tableClass: 'wec-race-points-table' }));
      }
      if (rr.intro && String(rr.intro).trim()) {
        var introP = document.createElement('p');
        introP.className = 'race-note';
        introP.textContent = String(rr.intro).trim();
        el.appendChild(introP);
      }
      var headers = rr.headers || [];
      var rows = rr.rows || [];
      var finStNorm = normalizeFinStColumns(headers, rows);
      headers = finStNorm.headers;
      rows = finStNorm.rows;
      if (isSeriesId(seriesId, 'imsa')) {
        var qualHtml = buildImsaDaytonaRaceTable(headers, rows);
        appendTable(el, qualHtml);
      } else {
        var sectionHtml = buildTableSection(t('section.race_results') || 'Race results', headers, rows, { tableClass: 'race-results-table' });
        appendTable(el, sectionHtml);
      }
      // Специальная заметка для F1 Australian GP 2025 (F1_2025_1): авария Изака Хаджара на прогревочном круге.
      var evIdLower = String(data && data.event_id || '').toLowerCase();
      if (isSeriesId(seriesId, 'f1') && evIdLower === 'f1_2025_1'.toLowerCase()) {
        var note = document.createElement('p');
        note.className = 'race-note';
        note.textContent = 'Isack Hadjar crashed during the formation lap.';
        el.appendChild(note);
      }
      return;
    }
    var raceT = tables && (tables.race || tables.race_results);
    if (raceT && raceT.sessions && Array.isArray(raceT.sessions)) {
      for (var s = 0; s < raceT.sessions.length; s++) {
        renderOneRaceSession(raceT.sessions[s], seriesId, entryList, el);
        var sess = raceT.sessions[s];
        var sessTitleLc = (sess && sess.title && String(sess.title).toLowerCase().trim()) || '';
        if (sessTitleLc.indexOf('sprint') >= 0) {
          if (tables.penalties && tables.penalties.headers && tables.penalties.rows && tables.penalties.rows.length > 0) {
            var penTitle1 = document.createElement('h4');
            penTitle1.className = 'table-section-title';
            penTitle1.textContent = (typeof t === 'function' && t('table.penalties')) ? t('table.penalties') : 'Penalties during the race';
            el.appendChild(penTitle1);
            appendTable(el, buildTableSection('', tables.penalties.headers, tables.penalties.rows, { tableClass: 'penalties-table' }));
          }
          if (tables.penalties_after && tables.penalties_after.rows && tables.penalties_after.rows.length > 0) {
            var penTitle2 = document.createElement('h4');
            penTitle2.className = 'table-section-title';
            penTitle2.textContent = 'Penalties added after the chequered flag';
            el.appendChild(penTitle2);
            appendTable(el, buildTableSection('', tables.penalties_after.headers, tables.penalties_after.rows, { tableClass: 'penalties-table penalties-table--after' }));
          }
          if (tables.vsc && tables.vsc.rows && tables.vsc.rows.length > 0) {
            var vscTitleEl = document.createElement('h4');
            vscTitleEl.className = 'table-section-title';
            vscTitleEl.textContent = (tables.vsc.title && String(tables.vsc.title).trim()) ? tables.vsc.title : ((typeof t === 'function' && t('table.vsc')) ? t('table.vsc') : 'Race neutralisation');
            el.appendChild(vscTitleEl);
            appendTable(el, buildTableSection('', tables.vsc.headers || ['Type', 'Laps'], tables.vsc.rows, { tableClass: 'vsc-table' }));
          }
          var sprintPenalties = tables.penalties_sprint_after;
          if (sprintPenalties && sprintPenalties.headers && sprintPenalties.rows && sprintPenalties.rows.length > 0) {
            var penTitle3 = document.createElement('h4');
            penTitle3.className = 'table-section-title';
            penTitle3.textContent = (typeof t === 'function' && t('table.penalties_after')) ? t('table.penalties_after') : 'Penalties added after the chequered flag';
            el.appendChild(penTitle3);
            appendTable(el, buildTableSection('', sprintPenalties.headers, sprintPenalties.rows, { tableClass: 'penalties-table penalties-table--after' }));
          }
          var vscSprint = tables.vsc_sprint;
          if (vscSprint && vscSprint.rows && vscSprint.rows.length > 0) {
            var vscTitle = document.createElement('h4');
            vscTitle.className = 'table-section-title';
            vscTitle.textContent = (vscSprint.title && String(vscSprint.title).trim()) ? vscSprint.title : ((typeof t === 'function' && t('table.vsc')) ? t('table.vsc') : 'Race neutralisation');
            el.appendChild(vscTitle);
            appendTable(el, buildTableSection('', vscSprint.headers || ['Type', 'Laps'], vscSprint.rows, { tableClass: 'vsc-table' }));
          }
        }
      }
      return;
    }
    if (raceT && Array.isArray(raceT.headers) && Array.isArray(raceT.rows)) {
      var h = raceT.headers;
      var r = raceT.rows;
      var finStNorm2 = normalizeFinStColumns(h, r);
      h = finStNorm2.headers;
      r = finStNorm2.rows;
      if (isSeriesId(seriesId, 'imsa')) appendTable(el, buildImsaDaytonaRaceTable(h, r));
      else appendTable(el, buildTableSection('', h, r, { tableClass: 'race-results-table' }));
    }
  }

  function renderEventSectionContent(data, sectionId, el) {
    if (!el) return;
    el.innerHTML = '';
    var tables = data && data.tables;
    var entryList = Array.isArray(data.entry_list) ? data.entry_list : [];
    var seriesId = eventSeriesId(data && data.event_id);

    if (sectionId === 'pre_season_tests' && tables && tables.pre_season_tests) {
      var pst = tables.pre_season_tests;
      var sessions = pst.sessions;
      if (Array.isArray(sessions)) {
        for (var i = 0; i < sessions.length; i++) {
          var sess = sessions[i];
          var headers = sess.headers || [];
          var rows = sess.rows || sess.rows_old || [];
          if (sess.title) appendTable(el, '<h4 class="table-section-title">' + esc(sess.title) + '</h4>');
          if (sess.meta) appendTable(el, buildSessionMetaTable(sess.meta));
          appendTable(el, buildTableSection('', headers, rows, { tableClass: 'pre-season-results-table' }));
        }
      }
      return;
    }

    if (sectionId === 'entry-list' && tables && tables.entry_list && Array.isArray(tables.entry_list.sessions)) {
      var entrySessions = tables.entry_list.sessions;
      for (var ei = 0; ei < entrySessions.length; ei++) {
        var es = entrySessions[ei] || {};
        var eh = Array.isArray(es.headers) ? es.headers : [];
        var er = Array.isArray(es.rows) ? es.rows : [];
        if (es.title) appendTable(el, '<h4 class="table-section-title">' + esc(es.title) + '</h4>');
        if (es.meta) appendTable(el, buildSessionMetaTable(es.meta));
        appendTable(el, buildTableSection('', eh, er, {}));
      }
      return;
    }

    if (sectionId === 'entry-list' && entryList.length > 0) {
      var isF1SeriesEntry = isSeriesId(seriesId, 'f1');
      var isFrecEntry =
        isSeriesId(seriesId, 'frec') ||
        (data && typeof data.series === 'string' && data.series.toLowerCase().indexOf('formula regional european') >= 0) ||
        (data && typeof data.event_id === 'string' && /^FREC_/.test(String(data.event_id).toUpperCase()));
      var isIndyCarEntry =
        isSeriesId(seriesId, 'indycar') ||
        (data && typeof data.series === 'string' && data.series.toLowerCase().indexOf('indycar') >= 0) ||
        (data && typeof data.event_id === 'string' && /^INDYCAR_/.test(String(data.event_id).toUpperCase()));
      var seasonEntry = data && data.season ? String(data.season) : '';
      if (!seasonEntry) {
        var evID = String(data && data.event_id || '').toUpperCase();
        var m = evID.match(/^F1_(\d{4})_/);
        if (m && m[1]) seasonEntry = m[1];
      }

      // F1/IndyCar: базовая сортировка entry list по команде, затем по номеру,
      // чтобы машины одной команды шли подряд.
      if (isF1SeriesEntry || isIndyCarEntry) {
        entryList = entryList.slice().sort(function (a, b) {
          var ta = (a.team || '').toLowerCase();
          var tb = (b.team || '').toLowerCase();
          if (ta < tb) return -1;
          if (ta > tb) return 1;
          var na = (a.number != null ? String(a.number) : '');
          var nb = (b.number != null ? String(b.number) : '');
          return na.localeCompare(nb, undefined, { numeric: true });
        });
      }

      // F1 2025: используем статический список команд и шасси, группируя по команде с rowSpan.
      if (isF1SeriesEntry && seasonEntry === '2025') {
        appendTable(el, buildF12025EntryListHTML(entryList));
        return;
      }
      if (isFrecEntry) {
        entryList = entryList.slice().sort(function (a, b) {
          var ta = (a.team || '').toLowerCase();
          var tb = (b.team || '').toLowerCase();
          if (ta < tb) return -1;
          if (ta > tb) return 1;
          var na = (a.number != null ? String(a.number) : '');
          var nb = (b.number != null ? String(b.number) : '');
          return na.localeCompare(nb, undefined, { numeric: true });
        });
        var frecHeaders = [(t('th.team') || 'Team'), (t('th.no') || 'No.'), (t('th.driver') || 'Driver')];
        var frecRows = entryList.map(function (e) {
          return [e.team || '', e.number || '', driverDisplayName ? driverDisplayName(e.driver) : e.driver];
        });
        appendTable(el, buildTableSection(t('section.entry_list') || 'Entry list', frecHeaders, frecRows, {}));
        return;
      }
      var hasCrew = entryList.some(function (e) { return e.crew_chief != null && String(e.crew_chief).trim() !== ''; });
      var hasClass = entryList.some(function (e) { return e.class != null && String(e.class).trim() !== ''; });
      var h = [(t('th.no') || 'No.'), (t('th.driver') || 'Driver'), (t('th.manufacturer') || 'Manufacturer'), (t('th.chassis') || 'Chassis')];
      if (hasClass) h.push('Class');
      if (hasClass) h.push('Car');
      if (hasCrew) h.push('Crew Chief');
      var r = entryList.map(function (e) {
        var producer = e.constructor || e.manufacturer || '';
        var chassis = e.manufacturer || e.car || '';
        var row = [e.number, driverDisplayName ? driverDisplayName(e.driver) : e.driver, producer, chassis];
        if (hasClass) row.push(e.class || '');
        if (hasClass) row.push(e.car || '');
        if (hasCrew) row.push(e.crew_chief || '');
        return row;
      });
      appendTable(el, buildTableSection(t('section.entry_list') || 'Entry list', h, r, {}));
      return;
    }

    if (sectionId === 'practice' || sectionId === 'qualifying') {
      var key = sectionId;
      var tbl = tables && tables[key];
      if (!tbl) {
        var keys = key === 'practice' ? ['practice', 'practice2', 'practice1'] : ['qualifying'];
        for (var k = 0; k < keys.length; k++) {
          tbl = tables && tables[keys[k]];
          if (tbl) break;
        }
      }
      if (tbl && tbl.sessions && Array.isArray(tbl.sessions)) {
        for (var j = 0; j < tbl.sessions.length; j++) {
          var s = tbl.sessions[j];
          var sh = s.headers || [];
          var sr = s.rows || s.rows_old || [];
          if (sectionId === 'qualifying') {
            var norm = normalizeF1GridColumn(sh, sr, seriesId);
            sh = norm.headers;
            sr = norm.rows;
          }
          if (s.title) appendTable(el, '<h4 class="table-section-title">' + esc(s.title) + '</h4>');
          if (s.meta) appendTable(el, buildSessionMetaTable(s.meta));
          if (isSeriesId(eventSeriesId(data.event_id), 'imsa') && sh.length > 0 && sr.length > 0) {
            appendTable(el, buildImsaDaytonaQualTable(sh, sr));
          } else {
            appendTable(el, buildTableSection('', sh, sr, { tableClass: key === 'qualifying' ? 'qualifying-table' : '' }));
          }
        }

        // Специальные заметки под квалификацией для отдельных этапов F1.
        if (sectionId === 'qualifying' && isSeriesId(seriesId, 'f1')) {
          var qNoteText = (tbl && typeof tbl.note === 'string' && tbl.note.trim()) ? tbl.note.trim() : '';
          if (!qNoteText) {
            var evId = String(data && data.event_id || '').toUpperCase();
            if (evId === 'F1_2025_3') {
              qNoteText = 'Carlos Sainz Jr. received a three-place grid penalty for impeding Lewis Hamilton in Q2.';
            } else if (evId === 'F1_2025_4') {
              qNoteText = 'George Russell and Kimi Antonelli both received a one-place grid penalty for entering the fast lane in the pit lane before a re-start time was confirmed.';
            }
          }
          if (qNoteText) {
            var qNote = document.createElement('p');
            qNote.className = 'race-note';
            qNote.textContent = qNoteText;
            el.appendChild(qNote);
          }
        }

        return;
      }
      if (tbl && Array.isArray(tbl.headers) && Array.isArray(tbl.rows)) {
        var th = tbl.headers || [];
        var tr = tbl.rows || [];
        if (sectionId === 'qualifying') {
          var norm2 = normalizeF1GridColumn(th, tr, seriesId);
          th = norm2.headers;
          tr = norm2.rows;
        }
        if (tbl.title) appendTable(el, '<h4 class="table-section-title">' + esc(tbl.title) + '</h4>');
        if (tbl.meta) appendTable(el, buildSessionMetaTable(tbl.meta));
        if (isSeriesId(eventSeriesId(data.event_id), 'imsa')) appendTable(el, buildImsaDaytonaQualTable(th, tr));
        else appendTable(el, buildTableSection('', th, tr, {}));
      }
    }
  }

  // ——— Exports ———
  window.TGA.eventSeriesId = eventSeriesId;
  window.TGA.buildTableSection = buildTableSection;
  window.TGA.buildImsaDaytonaQualTable = buildImsaDaytonaQualTable;
  window.TGA.normalizeImsaTable = normalizeImsaTable;
  window.TGA.renderEventPage = renderEventPage;
  window.TGA.renderEventOverviewContent = renderEventOverviewContent;
  window.TGA.renderRaceContent = renderRaceContent;
  window.TGA.renderEventSectionContent = renderEventSectionContent;
})();
