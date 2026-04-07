// ─── tga-schedule.js ──────────────────────────────────────────────────────────
// Глобальный кэш событий, fetchAllEvents, loadGlobalSchedule, renderSchedulePage.
// Зависимости: tga-config.js, tga-i18n.js, tga-utils.js
// Порядок загрузки: tga-utils.js → tga-schedule.js → app.js
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  window.TGA = window.TGA || {};
  var state                = window.TGA._state;
  var fetchJSON            = window.TGA.fetchJSON;
  var t                    = function (k) { return window.TGA.t(k); };
  var parseTimeStringToParts = function (s) { return window.TGA.parseTimeStringToParts(s); };
  var categories           = window.TGA.categories;

  // ── Внутреннее состояние ─────────────────────────────────────────────────
  var globalEventsCache = null;
  var scheduleHidePast  = false;

  var buildScheduleGroups = (window.TGA && window.TGA.buildScheduleGroups) || function () { return []; };
  var buildScheduleHTML   = (window.TGA && window.TGA.buildScheduleHTML)   || function () {};

  var renderNextRaceCards = (window.TGA && window.TGA.renderNextRaceCards) || function () {};
  var stopNextRaceTimers  = (window.TGA && window.TGA.stopNextRaceTimers)  || function () {};

  // ── Утилита: "March 1" → "2026-03-01" ───────────────────────────────────
  function monthDayToISO(md) {
    if (!md) return '';
    md = String(md).trim();
    var m    = md.match(/^([A-Za-z]+)\s+(\d+)/);       // "March 8"
    var mRev = !m && md.match(/^(\d+)\s+([A-Za-z]+)/); // "8 March"
    if (!m && !mRev) return '';
    var monthName = (m ? m[1] : mRev[2]).toLowerCase();
    var dayNum    = m ? m[2] : mRev[1];
    var day = ('0' + parseInt(dayNum, 10)).slice(-2);
    var months = {
      january: '01', february: '02', march: '03',    april: '04',
      may: '05',     june: '06',     july: '07',     august: '08',
      september: '09', october: '10', november: '11', december: '12'
    };
    var mm = months[monthName];
    if (!mm) return '';
    return new Date().getFullYear() + '-' + mm + '-' + day;
  }

  // ── Видимость прошедших строк ────────────────────────────────────────────
  function applySchedulePastVisibility() {
    var root = document.getElementById('view-schedule');
    if (!root) return;
    var pastRows = root.querySelectorAll('.weekend-hdr.sched-past, .sched-row.sched-past');
    [].forEach.call(pastRows, function (tr) {
      tr.style.display = scheduleHidePast ? 'none' : '';
    });
  }

  // ── Загрузка всех событий со статическими фолбэками ─────────────────────
  function fetchAllEvents(seriesData) {
    var allIds = [];
    categories.forEach(function (c) { c.ids.forEach(function (id) { allIds.push(id); }); });
    var byId = {};
    seriesData.forEach(function (s) { byId[s.id] = s; });
    var relevant = allIds.map(function (id) { return byId[id]; }).filter(Boolean);

    return Promise.all(relevant.map(function (s) {
      var se = String((s.season != null && s.season !== '') ? s.season : '2026').trim();
      return fetchJSON('/api/series/' + encodeURIComponent((s.id || '').toLowerCase()) + '/events?season=' + encodeURIComponent(se))
        .then(function (events) {
          return (Array.isArray(events) ? events : []).map(function (e) {
            var ev = Object.assign({}, e, { _seriesId: s.id, _seriesName: s.name });
            ev.time_est = ev.time_est || ev.timeEst || ev.time_et || '';
            ev.time_msk = ev.time_msk || ev.timeMsk || '';
            return ev;
          });
        })
        .catch(function () { return []; });
    })).then(function (arrays) {
      var all = [].concat.apply([], arrays);

      // Добавляем статические расписания для F1 / INDYCAR / F2 / F3, а также
      // гарантируем наличие отдельных этапов (например, WEC Qatar 1812 km).
      var haveIndycar = all.some(function (e) { return (e._seriesId || '').toUpperCase() === 'INDYCAR'; });
      var haveF1      = all.some(function (e) { return (e._seriesId || '').toUpperCase() === 'F1'; });
      var haveF2      = all.some(function (e) { return (e._seriesId || '').toUpperCase() === 'F2'; });
      var haveF3      = all.some(function (e) { return (e._seriesId || '').toUpperCase() === 'F3'; });

      if (!haveIndycar && byId['INDYCAR']) {
        var indyStat = (window.TGA_STATIC_SCHEDULES && window.TGA_STATIC_SCHEDULES.indycarEvents) || [];
        indyStat.forEach(function (e) {
          var iso = monthDayToISO(e.date);
          all.push({
            _seriesId: 'INDYCAR',
            _seriesName: byId['INDYCAR'].name,
            id: '',
            name: e.name,
            start_date: iso,
            date: iso,
            circuit_name: e.track,
            location: e.location,
            time_est: e.est,
            time_msk: e.msk,
            has_detail: false
          });
        });
      }

      if (byId['F1']) {
        [
          { start: 'February 11', end: 'February 13', name: 'Pre-Season Testing 1', circuit: 'Bahrain International Circuit', time_est: '10:00–19:00', id: 'F1_2026_PRE_SEASON_TEST_1', has_detail: true },
          { start: 'February 18', end: 'February 20', name: 'Pre-Season Testing 2', circuit: 'Bahrain International Circuit', time_est: '10:00–19:00', id: 'F1_2026_PRE_SEASON_TEST_2', has_detail: true }
        ].forEach(function (e) {
          var isoStart = monthDayToISO(e.start);
          var isoEnd   = monthDayToISO(e.end);
          all.push({
            _seriesId: 'F1',
            _seriesName: byId['F1'].name,
            id: e.id || '',
            name: e.name,
            start_date: isoStart,
            end_date: isoEnd,
            date: isoStart,
            circuit_name: e.circuit,
            location: '',
            time_est: e.time_est || '',
            time_msk: '',
            has_detail: e.has_detail !== undefined ? e.has_detail : false
          });
        });
      }

      if (!haveF1 && byId['F1']) {
        var f1Stat = [
          { date: 'March 8',      name: 'Australian Grand Prix',          circuit: 'Australia — Albert Park Circuit, Melbourne' },
          { date: 'March 15',     name: 'Chinese Grand Prix',             circuit: 'China — Shanghai International Circuit, Shanghai' },
          { date: 'March 29',     name: 'Japanese Grand Prix',            circuit: 'Japan — Suzuka Circuit, Suzuka' },
          { date: 'April 12',     name: 'Bahrain Grand Prix',             circuit: 'Bahrain — Bahrain International Circuit, Sakhir' },
          { date: 'April 19',     name: 'Saudi Arabian Grand Prix',       circuit: 'Saudi Arabia — Jeddah Corniche Circuit, Jeddah' },
          { date: 'May 3',        name: 'Miami Grand Prix',               circuit: 'United States — Miami International Autodrome, Miami Gardens, Florida' },
          { date: 'May 24',       name: 'Canadian Grand Prix',            circuit: 'Canada — Circuit Gilles Villeneuve, Montreal' },
          { date: 'June 7',       name: 'Monaco Grand Prix',              circuit: 'Monaco — Circuit de Monaco, Monaco' },
          { date: 'June 14',      name: 'Barcelona-Catalunya Grand Prix', circuit: 'Spain — Circuit de Barcelona-Catalunya, Montmeló' },
          { date: 'June 28',      name: 'Austrian Grand Prix',            circuit: 'Austria — Red Bull Ring, Spielberg' },
          { date: 'July 5',       name: 'British Grand Prix',             circuit: 'United Kingdom — Silverstone Circuit, Silverstone' },
          { date: 'July 19',      name: 'Belgian Grand Prix',             circuit: 'Belgium — Circuit de Spa-Francorchamps, Stavelot' },
          { date: 'July 26',      name: 'Hungarian Grand Prix',           circuit: 'Hungary — Hungaroring, Mogyoród' },
          { date: 'August 23',    name: 'Dutch Grand Prix',               circuit: 'Netherlands — Circuit Zandvoort, Zandvoort' },
          { date: 'September 6',  name: 'Italian Grand Prix',             circuit: 'Italy — Monza Circuit, Monza' },
          { date: 'September 13', name: 'Spanish Grand Prix',             circuit: 'Spain — Madring, Madrid' },
          { date: 'September 26', name: 'Azerbaijan Grand Prix',          circuit: 'Azerbaijan — Baku City Circuit, Baku' },
          { date: 'October 11',   name: 'Singapore Grand Prix',           circuit: 'Singapore — Marina Bay Street Circuit, Singapore' },
          { date: 'October 25',   name: 'United States Grand Prix',       circuit: 'United States — Circuit of the Americas, Austin, Texas' },
          { date: 'November 1',   name: 'Mexico City Grand Prix',         circuit: 'Mexico — Autódromo Hermanos Rodríguez, Mexico City' },
          { date: 'November 8',   name: 'São Paulo Grand Prix',           circuit: 'Brazil — Interlagos Circuit, São Paulo' },
          { date: 'November 21',  name: 'Las Vegas Grand Prix',           circuit: 'United States — Las Vegas Strip Circuit, Paradise, Nevada' },
          { date: 'November 29',  name: 'Qatar Grand Prix',               circuit: 'Qatar — Lusail International Circuit, Lusail' },
          { date: 'December 6',   name: 'Abu Dhabi Grand Prix',           circuit: 'United Arab Emirates — Yas Marina Circuit, Abu Dhabi' }
        ];
        f1Stat.forEach(function (e) {
          var iso = monthDayToISO(e.date);
          var timeLocal = '';
          var timeMsk   = '';
          if (e.name === 'Australian Grand Prix') {
            timeLocal = '15:00';
            timeMsk   = '07:00';
          }
          all.push({
            _seriesId: 'F1',
            _seriesName: byId['F1'].name,
            id: '',
            name: e.name,
            start_date: iso,
            date: iso,
            circuit_name: e.circuit,
            location: '',
            time_est: timeLocal,
            time_msk: timeMsk,
            has_detail: false
          });
        });
      }

      if (byId['F2']) {
        all = all.filter(function (e) { return (e._seriesId || '').toUpperCase() !== 'F2'; });
        var f2Stat = [
          { round: 1,  sprint: '7 March',      feature: '8 March',      circuit: 'Australia — Albert Park Circuit, Melbourne' },
          // Rounds 2 and 3 (Bahrain / Saudi Arabia) cancelled for 2026 calendar.
          { round: 4,  sprint: '6 June',       feature: '7 June',       circuit: 'Monaco — Circuit de Monaco, Monaco' },
          { round: 5,  sprint: '13 June',      feature: '14 June',      circuit: 'Spain — Circuit de Barcelona-Catalunya, Montmeló' },
          { round: 6,  sprint: '27 June',      feature: '28 June',      circuit: 'Austria — Red Bull Ring, Spielberg' },
          { round: 7,  sprint: '4 July',       feature: '5 July',       circuit: 'United Kingdom — Silverstone Circuit, Silverstone' },
          { round: 8,  sprint: '18 July',      feature: '19 July',      circuit: 'Belgium — Circuit de Spa-Francorchamps, Stavelot' },
          { round: 9,  sprint: '25 July',      feature: '26 July',      circuit: 'Hungary — Hungaroring, Mogyoród' },
          { round: 10, sprint: '5 September',  feature: '6 September',  circuit: 'Italy — Monza Circuit, Monza' },
          { round: 11, sprint: '12 September', feature: '13 September', circuit: 'Spain — Madring, Madrid' },
          { round: 12, sprint: '26 September', feature: '27 September', circuit: 'Azerbaijan — Baku City Circuit, Baku' },
          { round: 13, sprint: '28 November',  feature: '29 November',  circuit: 'Qatar — Lusail International Circuit, Lusail' },
          { round: 14, sprint: '5 December',   feature: '6 December',   circuit: 'United Arab Emirates — Yas Marina Circuit, Abu Dhabi' }
        ];
        f2Stat.forEach(function (e) {
          var isoSprint  = monthDayToISO(e.sprint);
          var isoFeature = monthDayToISO(e.feature);
          all.push({
            _seriesId: 'F2',
            _seriesName: byId['F2'].name,
            id: '',
            name: 'F2 Round ' + e.round + ' — Sprint Race',
            start_date: isoSprint,
            date: isoSprint,
            circuit_name: e.circuit,
            location: '',
            time_est: e.round === 1 ? '14:10' : '',
            time_msk: e.round === 1 ? '06:10' : '',
            has_detail: false
          });
          all.push({
            _seriesId: 'F2',
            _seriesName: byId['F2'].name,
            id: '',
            name: 'F2 Round ' + e.round + ' — Feature Race',
            start_date: isoFeature,
            date: isoFeature,
            circuit_name: e.circuit,
            location: '',
            time_est: e.round === 1 ? '11:25' : '',
            time_msk: e.round === 1 ? '03:25' : '',
            has_detail: false
          });
        });
      }

      if (byId['F3']) {
        all = all.filter(function (e) { return (e._seriesId || '').toUpperCase() !== 'F3'; });
        var f3Stat = [
          { round: 1,  sprint: '7 March',      feature: '8 March',      circuit: 'Australia — Albert Park Circuit, Melbourne' },
          // Round 2 (Bahrain) cancelled for 2026 calendar.
          { round: 3,  sprint: '6 June',       feature: '7 June',       circuit: 'Monaco — Circuit de Monaco, Monaco' },
          { round: 4,  sprint: '13 June',      feature: '14 June',      circuit: 'Spain — Circuit de Barcelona-Catalunya, Montmeló' },
          { round: 5,  sprint: '27 June',      feature: '28 June',      circuit: 'Austria — Red Bull Ring, Spielberg' },
          { round: 6,  sprint: '4 July',       feature: '5 July',       circuit: 'United Kingdom — Silverstone Circuit, Silverstone' },
          { round: 7,  sprint: '18 July',      feature: '19 July',      circuit: 'Belgium — Circuit de Spa-Francorchamps, Stavelot' },
          { round: 8,  sprint: '25 July',      feature: '26 July',      circuit: 'Hungary — Hungaroring, Mogyoród' },
          { round: 9,  sprint: '5 September',  feature: '6 September',  circuit: 'Italy — Monza Circuit, Monza' },
          { round: 10, sprint: '12 September', feature: '13 September', circuit: 'Spain — Madring, Madrid' }
        ];
        f3Stat.forEach(function (e) {
          var isoSprint  = monthDayToISO(e.sprint);
          var isoFeature = monthDayToISO(e.feature);
          all.push({
            _seriesId: 'F3',
            _seriesName: byId['F3'].name,
            id: '',
            name: 'F3 Round ' + e.round + ' — Sprint Race',
            start_date: isoSprint,
            date: isoSprint,
            circuit_name: e.circuit,
            location: '',
            time_est: e.round === 1 ? '11:15' : '',
            time_msk: e.round === 1 ? '03:15' : '',
            has_detail: false
          });
          all.push({
            _seriesId: 'F3',
            _seriesName: byId['F3'].name,
            id: '',
            name: 'F3 Round ' + e.round + ' — Feature Race',
            start_date: isoFeature,
            date: isoFeature,
            circuit_name: e.circuit,
            location: '',
            time_est: e.round === 1 ? '08:50' : '',
            time_msk: e.round === 1 ? '00:50' : '',
            has_detail: false
          });
        });
      }

      // F2/F3 из API: разворачиваем в две строки — Спринт и Основная гонка
      var staticF2 = (window.TGA_STATIC_SCHEDULES && window.TGA_STATIC_SCHEDULES.f2) || [];
      var staticF3 = (window.TGA_STATIC_SCHEDULES && window.TGA_STATIC_SCHEDULES.f3) || [];
      var expanded = [];
      all.forEach(function (e) {
        var sid = (e._seriesId || '').toUpperCase();
        if (sid !== 'F2' && sid !== 'F3') {
          expanded.push(e);
          return;
        }
        var idStr = String(e.id || '');
        var m = idStr.match(/^F[23]_2026_(\d+)$/i) || idStr.match(/_(\d+)$/);
        var round = m ? parseInt(m[1], 10) : 0;
        var stat = sid === 'F2' ? staticF2 : staticF3;
        var row = stat.filter(function (r) { return r.rd === round; })[0];
        if (!row) {
          expanded.push(e);
          return;
        }
        var sprintDate = monthDayToISO(row.sprint);
        var featureDate = monthDayToISO(row.feature);
        expanded.push({
          _seriesId: e._seriesId,
          _seriesName: e._seriesName,
          id: e.id,
          name: e.name + ' (Sprint)',
          start_date: sprintDate,
          date: sprintDate,
          circuit_name: e.circuit_name || row.circuit,
          location: e.location || '',
          time_est: row.sprintLocal || '',
          time_msk: row.sprintMsk || '',
          has_detail: e.has_detail
        });
        expanded.push({
          _seriesId: e._seriesId,
          _seriesName: e._seriesName,
          id: e.id,
          name: e.name + ' (Feature)',
          start_date: featureDate,
          date: featureDate,
          circuit_name: e.circuit_name || row.circuit,
          location: e.location || '',
          time_est: row.featureLocal || '',
          time_msk: row.featureMsk || '',
          has_detail: e.has_detail
        });
      });
      all = expanded;

      all.sort(function (a, b) {
        var da = a.start_date || a.date || '';
        var db = b.start_date || b.date || '';
        if (da < db) return -1;
        if (da > db) return 1;
        var ta = 24 * 60;
        var tb = 24 * 60;
        if (a.time_est) {
          var pa = parseTimeStringToParts(a.time_est);
          if (pa) ta = (pa.hour != null ? pa.hour : pa.hours) * 60 + (pa.minute != null ? pa.minute : pa.minutes);
        }
        if (b.time_est) {
          var pb = parseTimeStringToParts(b.time_est);
          if (pb) tb = (pb.hour != null ? pb.hour : pb.hours) * 60 + (pb.minute != null ? pb.minute : pb.minutes);
        }
        return ta - tb;
      });
      return all;
    });
  }

  // ── Загрузка и кэширование для next-race-cards ───────────────────────────
  function loadGlobalSchedule(seriesData) {
    var nrRow = document.getElementById('next-races-row');
    if (nrRow) nrRow.classList.add('hidden');

    fetchAllEvents(seriesData).then(function (all) {
      globalEventsCache = all;
      if (window.TGA && typeof window.TGA.renderNextRaceCards === 'function') {
        window.TGA.renderNextRaceCards(all);
      }
    });
  }

  // ── Страница полного расписания ──────────────────────────────────────────
  function renderSchedulePage() {
    if (window.TGA.showView) window.TGA.showView('view-schedule');
    window.scrollTo(0, 0);
    document.title = t('home.full_schedule') + ' — TGA';

    var titleEl = document.getElementById('sched-page-title');
    var breadEl = document.getElementById('sched-page-breadcrumb');
    var body    = document.getElementById('sched-page-body');

    if (titleEl) titleEl.textContent = t('home.full_schedule');
    if (breadEl) {
      breadEl.textContent = '';
      var homeLink = document.createElement('a');
      homeLink.href = '/';
      homeLink.textContent = t('breadcrumb.all');
      breadEl.appendChild(homeLink);
    }

    var ths = document.querySelectorAll('#view-schedule thead th[data-col]');
    [].forEach.call(ths, function (th) {
      var map = {
        series:   t('home.series_col'),
        race:     t('th.race_col'),
        date:     'Date',
        location: t('th.location'),
        time:     'Time'
      };
      var v = map[th.getAttribute('data-col')];
      if (v) th.textContent = v;
    });

    var hidePastToggle = document.getElementById('sched-hide-past-toggle');
    if (hidePastToggle && !hidePastToggle._bound) {
      hidePastToggle._bound = true;
      hidePastToggle.addEventListener('change', function () {
        scheduleHidePast = !!hidePastToggle.checked;
        applySchedulePastVisibility();
      });
    }
    if (hidePastToggle) {
      scheduleHidePast = !!hidePastToggle.checked;
    }

    if (globalEventsCache) {
      buildScheduleHTML(globalEventsCache, 'sched-page-body');
      return;
    }

    if (body) body.innerHTML = '<tr><td colspan="5" class="loading">' + t('loading') + '</td></tr>';

    fetchJSON('/api/series')
      .then(function (data) { return fetchAllEvents(data); })
      .then(function (all) {
        globalEventsCache = all;
        buildScheduleHTML(all, 'sched-page-body');
      })
      .catch(function () {
        if (body) body.innerHTML = '<tr><td colspan="5">' + t('error.no_data') + '</td></tr>';
      });
  }

  // ── Экспорт ──────────────────────────────────────────────────────────────
  window.TGA.monthDayToISO             = monthDayToISO;
  window.TGA.applySchedulePastVisibility = applySchedulePastVisibility;
  window.TGA.fetchAllEvents            = fetchAllEvents;
  window.TGA.loadGlobalSchedule        = loadGlobalSchedule;
  window.TGA.renderSchedulePage        = renderSchedulePage;
  window.TGA.getGlobalEventsCache      = function () { return globalEventsCache; };
  window.TGA.setGlobalEventsCache      = function (v) { globalEventsCache = v; };
})();
