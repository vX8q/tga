// Schedule: buildScheduleGroups (pure), buildScheduleHTML. Uses window.TGA at call time.
(function () {
  if (typeof window === 'undefined') return;
  window.TGA = window.TGA || {};

  function scheduleEventSeriesUpper(e) {
    return String((e && (e._seriesId || e.series_id)) || '').toUpperCase();
  }

  function sfRoundNumFromId(id) {
    var m = String(id || '').match(/_(\d+)$/);
    return m ? parseInt(m[1], 10) : 0;
  }

  /** Circuit + locality on one line (Super Formula full schedule / series table). */
  function superFormulaVenueLine(e) {
    var c = (e && e.circuit_name && String(e.circuit_name).trim()) || '';
    var l = (e && e.location && String(e.location).trim()) || '';
    if (c && l) return c + ' — ' + l;
    return c || l || '—';
  }

  /**
   * Схлопывает двухдневные этапы Super Formula (один трек, подряд идущие даты) в одну строку расписания.
   * Остальные серии и события проходят без изменений. Массив сортируется по дате старта.
   */
  function collapseSuperFormulaScheduleEvents(events) {
    if (!Array.isArray(events) || events.length === 0) return events;
    var sorted = events.slice().sort(function (a, b) {
      var da = (a.start_date || a.date || '').slice(0, 10);
      var db = (b.start_date || b.date || '').slice(0, 10);
      if (da < db) return -1;
      if (da > db) return 1;
      var sa = scheduleEventSeriesUpper(a);
      var sb = scheduleEventSeriesUpper(b);
      if (sa < sb) return -1;
      if (sa > sb) return 1;
      return 0;
    });
    var out = [];
    for (var i = 0; i < sorted.length; i++) {
      var e = sorted[i];
      if (scheduleEventSeriesUpper(e) !== 'SUPER_FORMULA') {
        out.push(e);
        continue;
      }
      var run = [e];
      var c0 = String(e.circuit_name || '').trim();
      var l0 = String(e.location || '').trim();
      var prevDate = (e.start_date || e.date || '').slice(0, 10);
      var j = i + 1;
      while (j < sorted.length) {
        var n = sorted[j];
        if (scheduleEventSeriesUpper(n) !== 'SUPER_FORMULA') break;
        var cn = String(n.circuit_name || '').trim();
        var ln = String(n.location || '').trim();
        if (cn !== c0 || ln !== l0) break;
        var dn = (n.start_date || n.date || '').slice(0, 10);
        var diff = (new Date(dn + 'T12:00:00').getTime() - new Date(prevDate + 'T12:00:00').getTime()) / 86400000;
        if (diff !== 1) break;
        run.push(n);
        prevDate = dn;
        j++;
      }
      var first = run[0];
      var last = run[run.length - 1];
      var d0 = (first.start_date || first.date || '').slice(0, 10);
      var d1 = (last.start_date || last.date || '').slice(0, 10);
      var baseName = String(first.circuit_name || first.name || '').trim();
      var r1 = sfRoundNumFromId(first.id);
      var r2 = sfRoundNumFromId(last.id);
      var rdLabel = run.length > 1 && r1 && r2 ? (r1 + '–' + r2) : String(r1 || r2 || '');
      var merged = Object.assign({}, first, {
        start_date: d0,
        end_date: run.length > 1 ? d1 : (first.end_date || d0).slice(0, 10),
        date: d0,
        name: baseName,
        circuit_name: first.circuit_name,
        location: first.location,
        id: first.id,
        _seriesId: first._seriesId || first.series_id || 'SUPER_FORMULA',
        has_detail: run.some(function (x) { return x.has_detail; }),
        time_est: 'TBD',
        time_msk: 'TBD',
        _sfRdLabel: rdLabel
      });
      out.push(merged);
      i = j - 1;
    }
    return out;
  }

  function buildScheduleGroups(allEvents) {
    var groups = [], curGroup = null;
    allEvents.forEach(function (e) {
      var ds = (e.start_date || e.date || '').slice(0, 10);
      var ms = ds ? new Date(ds + 'T12:00:00').getTime() : 0;
      if (!curGroup || ms - curGroup.ms > 3 * 86400000) {
        curGroup = { startDs: ds, endDs: ds, ms: ms, events: [] };
        groups.push(curGroup);
      } else if (ds > curGroup.endDs) {
        curGroup.endDs = ds;
      }
      curGroup.events.push(e);
    });
    return groups;
  }

  function buildScheduleHTML(allEvents, bodyId) {
    var esc = window.TGA.esc;
    var t = window.TGA.t;
    var formatDateRange = window.TGA.formatDateRange;
    var formatDateRangeLong = window.TGA.formatDateRangeLong;
    var formatShortDate = window.TGA.formatShortDate;
    var seriesBadge = window.TGA.seriesBadge;
    var formatTimeForDisplay = window.TGA.formatTimeForDisplay;
    var getTimeSettings = window.TGA.getTimeSettings;
    var parseTimeStringToParts = window.TGA.parseTimeStringToParts;
    var estToUtcMs = window.TGA.estToUtcMs;
    var makeSimpleTableSortable = window.TGA.makeSimpleTableSortable;
    var applySchedulePastVisibility = window.TGA.applySchedulePastVisibility;
    var timePlaceholder = (t && t('schedule.tbd')) ? t('schedule.tbd') : 'TBD';
    if (!esc || !formatDateRange || !formatShortDate || !seriesBadge) return;
    var formatDateForGroup = formatDateRangeLong || formatDateRange;

    var body = document.getElementById(bodyId);
    if (!body) return;
    if (allEvents.length === 0) { body.innerHTML = ''; return; }

    allEvents = collapseSuperFormulaScheduleEvents(allEvents);

    var todayMs = new Date(); todayMs.setHours(0, 0, 0, 0); todayMs = todayMs.getTime();
    var groups = buildScheduleGroups(allEvents);
    var nextMarked = false;
    var html = '';

    function buildLocalTimeLabel(ds, estRaw, dateShort) {
      if (!ds || !estRaw || !getTimeSettings) {
        return dateShort || estRaw || '—';
      }
      var settings = getTimeSettings ? getTimeSettings() : { timeFormat: '24h', timeZone: 'my' };
      // Режим Track (EST) — показываем исходное EST‑время в выбранном формате.
      if (settings.timeZone === 'track') {
        var estTime = formatTimeForDisplay ? formatTimeForDisplay(estRaw) : (estRaw || '');
        if (!estTime) return dateShort || estRaw || '—';
        return dateShort ? (dateShort + ' ' + estTime) : estTime;
      }
      // Режим My time — конвертация EST → локальный часовой пояс браузера.
      if (!parseTimeStringToParts || typeof Intl === 'undefined') {
        return dateShort || estRaw || '—';
      }
      var parts = parseTimeStringToParts(estRaw);
      if (!parts) return dateShort || estRaw || '—';
      var y = parseInt(ds.slice(0, 4), 10);
      var m = parseInt(ds.slice(5, 7), 10);
      var d = parseInt(ds.slice(8, 10), 10);
      if (!y || !m || !d) return dateShort || estRaw || '—';
      // Eastern (America/New_York) с учётом зимнего/летнего времени → UTC → локальное время браузера.
      var utcMs = estToUtcMs ? estToUtcMs(y, m, d, parts.hour, parts.minute) : Date.UTC(y, m - 1, d, parts.hour + 5, parts.minute);
      var dt = new Date(utcMs);
      var df = new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: settings && settings.timeFormat === '12h'
      });
      var localTime = df.format(dt);
      if (!localTime) return dateShort || estRaw || '—';
      return dateShort ? (dateShort + ' ' + localTime) : localTime;
    }

    // Конвертация времени по Москве (UTC+3) в системное время пользователя (My time).
    function mskToLocalLabel(ds, mskRaw, dateShort) {
      if (!ds || !mskRaw || !parseTimeStringToParts || typeof Intl === 'undefined') {
        return dateShort || mskRaw || '—';
      }
      var parts = parseTimeStringToParts(mskRaw);
      if (!parts) return dateShort || mskRaw || '—';
      var y = parseInt(ds.slice(0, 4), 10);
      var m = parseInt(ds.slice(5, 7), 10);
      var d = parseInt(ds.slice(8, 10), 10);
      if (!y || !m || !d) return dateShort || mskRaw || '—';
      var settings = getTimeSettings ? getTimeSettings() : null;
      // MSK = UTC+3 → UTC = MSK - 3
      var utcMs = Date.UTC(y, m - 1, d, parts.hour - 3, parts.minute);
      var dt = new Date(utcMs);
      var df = new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: settings && settings.timeFormat === '12h'
      });
      return df.format(dt) || (dateShort + ' ' + mskRaw);
    }

    /** Только время (для колонки Time), без даты. */
    function buildLocalTimeOnly(ds, estRaw) {
      if (!ds || !estRaw || !parseTimeStringToParts || typeof Intl === 'undefined') return '—';
      var parts = parseTimeStringToParts(estRaw);
      if (!parts) return '—';
      var y = parseInt(ds.slice(0, 4), 10);
      var m = parseInt(ds.slice(5, 7), 10);
      var d = parseInt(ds.slice(8, 10), 10);
      if (!y || !m || !d) return '—';
      var settings = getTimeSettings ? getTimeSettings() : { timeFormat: '24h' };
      var utcMs = estToUtcMs ? estToUtcMs(y, m, d, parts.hour, parts.minute) : Date.UTC(y, m - 1, d, parts.hour + 5, parts.minute);
      var dt = new Date(utcMs);
      var df = new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: settings && settings.timeFormat === '12h'
      });
      return df.format(dt) || '—';
    }

    function mskToLocalTimeOnly(ds, mskRaw) {
      if (!ds || !mskRaw || !parseTimeStringToParts || typeof Intl === 'undefined') return '—';
      var parts = parseTimeStringToParts(mskRaw);
      if (!parts) return '—';
      var y = parseInt(ds.slice(0, 4), 10);
      var m = parseInt(ds.slice(5, 7), 10);
      var d = parseInt(ds.slice(8, 10), 10);
      if (!y || !m || !d) return '—';
      var settings = getTimeSettings ? getTimeSettings() : null;
      var utcMs = Date.UTC(y, m - 1, d, parts.hour - 3, parts.minute);
      var dt = new Date(utcMs);
      var df = new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: settings && settings.timeFormat === '12h'
      });
      return df.format(dt) || '—';
    }

    // Timestamp для сортировки события с учётом текущих настроек времени.
    function getEventSortTimeMs(e, settings) {
      var ds = (e.start_date || e.date || '').slice(0, 10);
      if (!ds) return 0;
      var y = parseInt(ds.slice(0, 4), 10);
      var m = parseInt(ds.slice(5, 7), 10);
      var d = parseInt(ds.slice(8, 10), 10);
      if (!y || !m || !d) return 0;

      var seriesIdUpper = scheduleEventSeriesUpper(e);
      var isTrackTz = settings && settings.timeZone === 'track';

      // Без парсера времени сортируем просто по дате.
      if (!parseTimeStringToParts) return Date.UTC(y, m - 1, d, 12, 0);

      var baseStr, parts, utcMs;

      if (isTrackTz) {
        // Track time: используем трековое время (EST / локальное).
        baseStr = e.time_est || e.time_msk || '';
        parts = parseTimeStringToParts(baseStr);
        if (!parts) return Date.UTC(y, m - 1, d, 12, 0);
        return Date.UTC(y, m - 1, d, parts.hour, parts.minute);
      }

      // My time:
      if (seriesIdUpper === 'F1' || seriesIdUpper === 'F2' || seriesIdUpper === 'F3') {
        // F1/F2/F3: time_msk — Москва (UTC+3). Момент в UTC для сортировки.
        baseStr = e.time_msk || e.time_est || '';
        parts = parseTimeStringToParts(baseStr);
        if (!parts) return Date.UTC(y, m - 1, d, 12, 0);
        return Date.UTC(y, m - 1, d, parts.hour - 3, parts.minute);
      }

      // Для остальных серий: Eastern (America/New_York, с DST) → UTC.
      baseStr = e.time_est || '';
      parts = parseTimeStringToParts(baseStr);
      if (!parts) return Date.UTC(y, m - 1, d, 12, 0);
      var estToUtcMsSort = window.TGA && window.TGA.estToUtcMs;
      utcMs = estToUtcMsSort ? estToUtcMsSort(y, m, d, parts.hour, parts.minute) : Date.UTC(y, m - 1, d, parts.hour + 5, parts.minute);
      return utcMs;
    }

    groups.forEach(function (g) {
      var isPastGroup = g.ms > 0 && g.ms < todayMs;
      html += '<tr class="weekend-hdr' + (isPastGroup ? ' sched-past' : '') + '">' +
        '<td colspan="5"><span class="wknd-date">' + esc(formatDateForGroup(g.startDs, g.endDs)) + '</span></td></tr>';

      var getTimeSettings = (window.TGA && window.TGA.getTimeSettings) || null;
      var currentSettings = getTimeSettings ? getTimeSettings() : null;
      var eventsInGroup = g.events.slice().sort(function (a, b) {
        return getEventSortTimeMs(a, currentSettings) - getEventSortTimeMs(b, currentSettings);
      });

      eventsInGroup.forEach(function (e) {
        var ds = (e.start_date || e.date || '').slice(0, 10);
        var endDs = (e.end_date || '').slice(0, 10);
        var ms = ds ? new Date(ds + 'T12:00:00').getTime() : 0;
        var isPast = ms > 0 && ms < todayMs;
        var isNext = !isPast && !nextMarked;
        if (isNext) nextMarked = true;

        var seriesSlug = (e._seriesId || e.series_id || '').toLowerCase().replace(/_+/g, '-');
        var link;
        if (e.has_detail && e.id) {
          var eventSlug = (e.id || '').toLowerCase().replace(/_+/g, '-');
          link = '<a href="/event/' + encodeURIComponent(eventSlug) + '" class="event-link">' + esc(e.name || '—') + '</a>';
        } else if (seriesSlug) {
          // Нет детального файла события, но есть серия — ведём на страницу серии.
          link = '<a href="/series/' + encodeURIComponent(seriesSlug) + '" class="event-link event-link--series">' + esc(e.name || '—') + '</a>';
        } else {
          link = '<span class="event-no-data">' + esc(e.name || '—') + '</span>';
        }

        var dateShort = (ds && endDs && ds !== endDs && formatDateRangeLong)
          ? formatDateRangeLong(e.start_date, e.end_date)
          : (ds ? formatShortDate(ds) : '');
        var estRaw = e.time_est || e.timeEst || e.time_et || '';
        var mskRaw = e.time_msk || e.timeMsk || '';

        var settings = getTimeSettings ? getTimeSettings() : null;
        var useTrackTime = settings && settings.timeZone === 'track';
        var seriesIdUpper = scheduleEventSeriesUpper(e);

        var timeLabel;
        var timeOnlyLabel; // только время для колонки Time (дата — в колонке Date)
        if (seriesIdUpper === 'F1') {
          // F1: Track time = время трассы (time_est). My time = MSK → локальный пояс.
          var f1Track = (estRaw || mskRaw || '') ? (formatTimeForDisplay ? formatTimeForDisplay(estRaw || mskRaw) : (estRaw || mskRaw)) : '';
          if (useTrackTime) {
            timeLabel = (dateShort && f1Track) ? (dateShort + ' ' + f1Track) : (dateShort || f1Track || '—');
            timeOnlyLabel = f1Track || timePlaceholder;
          } else {
            timeLabel = mskToLocalLabel(ds, mskRaw || estRaw, dateShort);
            timeOnlyLabel = mskToLocalTimeOnly(ds, mskRaw || estRaw) || timePlaceholder;
          }
        } else if (seriesIdUpper === 'F2' || seriesIdUpper === 'F3') {
          // F2/F3: отдельные строки спринт/фича; время как у F1 (трасса / MSK → локальное).
          var f2f3Track = (estRaw || mskRaw || '') ? (formatTimeForDisplay ? formatTimeForDisplay(estRaw || mskRaw) : (estRaw || mskRaw)) : '';
          if (useTrackTime) {
            timeLabel = (dateShort && f2f3Track) ? (dateShort + ' ' + f2f3Track) : (dateShort || f2f3Track || '—');
            timeOnlyLabel = f2f3Track || timePlaceholder;
          } else {
            timeLabel = mskToLocalLabel(ds, mskRaw || estRaw, dateShort);
            timeOnlyLabel = mskToLocalTimeOnly(ds, mskRaw || estRaw) || timePlaceholder;
          }
        } else if (seriesIdUpper === 'SUPER_FORMULA') {
          timeOnlyLabel = timePlaceholder;
          timeLabel = timePlaceholder;
        } else {
          var estTime = formatTimeForDisplay ? formatTimeForDisplay(estRaw) : (estRaw || '');
          var estLabel = (dateShort && estTime) ? (dateShort + ' ' + estTime)
            : (dateShort || estTime || '—');
          var localLabel = buildLocalTimeLabel(ds, estRaw, dateShort);
          timeLabel = useTrackTime ? estLabel : localLabel;
          timeOnlyLabel = useTrackTime ? (estTime || timePlaceholder) : (buildLocalTimeOnly(ds, estRaw) || timePlaceholder);
        }
        if (!timeOnlyLabel || timeOnlyLabel === '—') {
          var rawTime = (estRaw || mskRaw || '').trim();
          if (rawTime && rawTime.toUpperCase() !== 'TBD') timeOnlyLabel = rawTime;
          else timeOnlyLabel = timePlaceholder;
        }

        var locCombined = seriesIdUpper === 'SUPER_FORMULA'
          ? superFormulaVenueLine(e)
          : (e.circuit_name || e.location || '—');
        html += '<tr class="sched-row' + (isPast ? ' sched-past' : isNext ? ' sched-next' : '') + '">' +
          '<td class="sched-series">'  + seriesBadge(e._seriesId || e.series_id || '') + '</td>' +
          '<td class="sched-race">'    + link + '</td>' +
          '<td class="sched-date">'    + esc(dateShort || '—') + '</td>' +
          '<td class="sched-location">' + esc(locCombined) + '</td>' +
          '<td class="col-time sched-time">' + esc(timeOnlyLabel) + '</td>' +
        '</tr>';
      });
    });

    body.innerHTML = html;
    var table = body.closest('table');
    if (table && makeSimpleTableSortable) makeSimpleTableSortable(table);
    if (applySchedulePastVisibility) applySchedulePastVisibility();
  }

  /** Returns one time label for event e (track or my time). seriesId optional (e.g. from series page). */
  function getScheduleTimeLabel(e, seriesId) {
    var tFn = window.TGA.t;
    var formatShortDate = window.TGA.formatShortDate;
    var formatTimeForDisplay = window.TGA.formatTimeForDisplay;
    var getTimeSettings = window.TGA.getTimeSettings;
    var parseTimeStringToParts = window.TGA.parseTimeStringToParts;
    var tbdLabel = (tFn && tFn('schedule.tbd')) ? tFn('schedule.tbd') : 'TBD';
    function rawIsPlaceholder(est, msk) {
      var r = String(est || msk || '').trim().toUpperCase();
      return !r || r === 'TBD' || r === '—';
    }
    function timeParsable(str) {
      if (!str || !parseTimeStringToParts) return false;
      return !!parseTimeStringToParts(String(str).trim());
    }
    if (!getTimeSettings) {
      if (rawIsPlaceholder(e.time_est, e.time_msk)) return tbdLabel;
      return (e.time_est || e.time_msk || '—');
    }
    var ds = (e.start_date || e.date || '').slice(0, 10);
    var estRaw = e.time_est || '';
    var mskRaw = e.time_msk || '';
    var dateShort = ds && formatShortDate ? formatShortDate(ds) : '';
    var settings = getTimeSettings();
    var useTrackTime = settings && settings.timeZone === 'track';
    var seriesIdUpper = (seriesId || e._seriesId || e.series_id || '').toUpperCase();

    if (seriesIdUpper === 'SUPER_FORMULA') {
      if (rawIsPlaceholder(estRaw, mskRaw) || (!timeParsable(estRaw) && !timeParsable(mskRaw))) {
        return tbdLabel;
      }
    }

    if (seriesIdUpper === 'F1') {
      if (useTrackTime) {
        var f1Track = (estRaw || mskRaw) ? (formatTimeForDisplay ? formatTimeForDisplay(estRaw || mskRaw) : (estRaw || mskRaw)) : '';
        return (dateShort && f1Track) ? (dateShort + ' ' + f1Track) : (dateShort || f1Track || '—');
      }
      return getMskToLocalLabel(ds, mskRaw || estRaw, dateShort);
    }
    if (useTrackTime) {
      var estTimeTr = formatTimeForDisplay ? formatTimeForDisplay(estRaw) : (estRaw || '');
      if (rawIsPlaceholder(estRaw, mskRaw) || !timeParsable(estRaw)) {
        return tbdLabel;
      }
      return (dateShort && estTimeTr) ? (dateShort + ' ' + estTimeTr) : (dateShort || estTimeTr || '—');
    }
    if (rawIsPlaceholder(estRaw, mskRaw) || !timeParsable(estRaw)) {
      return tbdLabel;
    }
    return getEstToLocalLabel(ds, estRaw, dateShort);
  }

  function getEstToLocalLabel(ds, estRaw, dateShort) {
    var getTimeSettings = window.TGA.getTimeSettings;
    var formatTimeForDisplay = window.TGA.formatTimeForDisplay;
    var parseTimeStringToParts = window.TGA.parseTimeStringToParts;
    if (!ds || !estRaw || !getTimeSettings) return dateShort || estRaw || '—';
    var settings = getTimeSettings();
    if (settings.timeZone === 'track') {
      var t = formatTimeForDisplay ? formatTimeForDisplay(estRaw) : estRaw;
      return dateShort ? (dateShort + ' ' + t) : (t || dateShort || '—');
    }
    if (!parseTimeStringToParts || typeof Intl === 'undefined') return dateShort || estRaw || '—';
    var parts = parseTimeStringToParts(estRaw);
    if (!parts) return dateShort || estRaw || '—';
    var y = parseInt(ds.slice(0, 4), 10), m = parseInt(ds.slice(5, 7), 10), d = parseInt(ds.slice(8, 10), 10);
    if (!y || !m || !d) return dateShort || estRaw || '—';
    var estToUtcMsFn = window.TGA && window.TGA.estToUtcMs;
    var utcMs = estToUtcMsFn ? estToUtcMsFn(y, m, d, parts.hour, parts.minute) : Date.UTC(y, m - 1, d, parts.hour + 5, parts.minute);
    var df = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: settings.timeFormat === '12h' });
    var localTime = df.format(new Date(utcMs));
    return dateShort ? (dateShort + ' ' + localTime) : (localTime || '—');
  }

  function getMskToLocalLabel(ds, mskRaw, dateShort) {
    var getTimeSettings = window.TGA.getTimeSettings;
    var parseTimeStringToParts = window.TGA.parseTimeStringToParts;
    if (!ds || !mskRaw || !parseTimeStringToParts || typeof Intl === 'undefined') return dateShort || mskRaw || '—';
    var parts = parseTimeStringToParts(mskRaw);
    if (!parts) return dateShort || mskRaw || '—';
    var y = parseInt(ds.slice(0, 4), 10), m = parseInt(ds.slice(5, 7), 10), d = parseInt(ds.slice(8, 10), 10);
    if (!y || !m || !d) return dateShort || mskRaw || '—';
    var settings = getTimeSettings ? getTimeSettings() : null;
    var utcMs = Date.UTC(y, m - 1, d, parts.hour - 3, parts.minute);
    var df = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: settings && settings.timeFormat === '12h' });
    return df.format(new Date(utcMs)) || (dateShort + ' ' + mskRaw);
  }

  window.TGA.buildScheduleGroups = buildScheduleGroups;
  window.TGA.buildScheduleHTML = buildScheduleHTML;
  window.TGA.getScheduleTimeLabel = getScheduleTimeLabel;
  window.TGA.collapseSuperFormulaScheduleEvents = collapseSuperFormulaScheduleEvents;
  window.TGA.superFormulaVenueLine = superFormulaVenueLine;
})();
