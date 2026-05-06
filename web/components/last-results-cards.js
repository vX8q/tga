// Last-results cards: shows winners from the most recent completed race day.
(function () {
  if (typeof window === 'undefined') return;
  window.TGA = window.TGA || {};

  function renderLastResultsCards(allEvents) {
    var t = window.TGA.t;
    var esc = window.TGA.esc;
    var seriesBadge = window.TGA.seriesBadge;
    var formatShortDate = window.TGA.formatShortDate;
    if (!t || !esc || !seriesBadge || !formatShortDate) return;

    var container = document.getElementById('last-results-row');
    if (!container) return;

    // Filter to past events which have detailed JSON (so results can exist).
    // ВАЖНО: используем локальную дату, а не toISOString(), чтобы не было сдвига по UTC.
    var today = new Date();
    var todayISO = today.getFullYear() + '-' +
      ('0' + (today.getMonth() + 1)).slice(-2) + '-' +
      ('0' + today.getDate()).slice(-2);

    function isIsoYMD(s) {
      return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
    }

    /** Карточка Last Results: показывать только пока «сегодня» не позже чем конец_события + 7 календарных дней. */
    var LAST_RESULTS_DAYS_AFTER_END = 7;
    function isWithinLastResultsWindowByEndDate(endStr) {
      if (!isIsoYMD(endStr)) return false;
      var parts = endStr.split('-');
      var y = parseInt(parts[0], 10);
      var mo = parseInt(parts[1], 10) - 1;
      var da = parseInt(parts[2], 10);
      var limit = new Date(y, mo, da + LAST_RESULTS_DAYS_AFTER_END);
      var ly = limit.getFullYear();
      var lm = ('0' + (limit.getMonth() + 1)).slice(-2);
      var ld = ('0' + limit.getDate()).slice(-2);
      var limitISO = ly + '-' + lm + '-' + ld;
      return todayISO <= limitISO;
    }

    /**
     * Оценка UTC-момента, после которого гонку разумно считать завершённой (старт + типичная длительность).
     * Нужна, чтобы в тот же календарный день показывать Last Results после финиша, даже без JSON с таблицами.
     */
    function estimateRaceFinishedUtcMs(ev) {
      if (!ev) return null;
      var parseTime = window.TGA && window.TGA.parseTimeStringToParts;
      var estToUtc = window.TGA && window.TGA.estToUtcMs;
      if (!parseTime || !estToUtc) return null;
      var ds = (ev.start_date || ev.date || '').slice(0, 10);
      if (!isIsoYMD(ds)) return null;
      var y = parseInt(ds.slice(0, 4), 10);
      var m = parseInt(ds.slice(5, 7), 10);
      var d = parseInt(ds.slice(8, 10), 10);
      var sid = String(ev._seriesId || ev.series_id || '').toUpperCase();
      var startUtc;
      if (sid === 'F1' || sid === 'F2' || sid === 'F3') {
        var mskRaw = String(ev.time_msk || ev.time_est || '').trim();
        var pm = parseTime(mskRaw);
        if (!pm) return null;
        startUtc = Date.UTC(y, m - 1, d, pm.hour - 3, pm.minute || 0);
      } else {
        var estRaw = String(ev.time_est || '').trim();
        var pe = parseTime(estRaw);
        if (!pe) return null;
        startUtc = estToUtc(y, m, d, pe.hour, pe.minute || 0);
      }
      var hours = 4;
      if (sid === 'NASCAR_CUP' || sid === 'NOAPS' || sid === 'NASCAR_TRUCK' || sid === 'ARCA' || sid === 'NASCAR_MODIFIED') {
        hours = 4.5;
      } else if (sid === 'INDYCAR') {
        hours = 3.5;
      } else if (sid === 'F1') {
        hours = 3.5;
      } else if (sid === 'F2' || sid === 'F3') {
        hours = 2.5;
      } else if (sid === 'SUPERCARS' || sid === 'SUPER_FORMULA' || sid === 'SUPER_GT' || sid === 'DTM') {
        hours = 3.5;
      } else if (sid === 'WEC' || sid === 'ELMS') {
        hours = 9;
      } else if (sid === 'IMSA') {
        var nm = String(ev.name || '').toLowerCase();
        // IMSA имеет как спринты (~100–160 минут), так и эндуранс.
        // Используем грубую эвристику по названию этапа.
        if (nm.indexOf('rolex') >= 0 || /\b24\b/.test(nm)) hours = 26;
        else if (nm.indexOf('12 hour') >= 0 || nm.indexOf('twelve') >= 0) hours = 13;
        else if (nm.indexOf('10 hour') >= 0 || nm.indexOf('ten') >= 0 || nm.indexOf('petit le mans') >= 0) hours = 11;
        else if (nm.indexOf('six hours') >= 0 || nm.indexOf('6 hour') >= 0) hours = 7;
        else if (nm.indexOf('long beach') >= 0) hours = 2.25;
        else if (nm.indexOf('detroit') >= 0) hours = 2.25;
        else if (nm.indexOf('monterey') >= 0 || nm.indexOf('laguna seca') >= 0) hours = 2.5;
        else hours = 3.5;
      }
      return startUtc + hours * 3600000;
    }

    var allPast = [];
    var pastDetailed = [];
    (Array.isArray(allEvents) ? allEvents : []).forEach(function (e) {
      if (!e || !e.id) return;
      var dateStr = (e.end_date || e.start_date || e.date || '').slice(0, 10);
      if (!isIsoYMD(dateStr) || dateStr > todayISO) return;
      // События «сегодня» по календарю не считаем прошедшими, пока не прошёл
      // оценочный момент финиша — иначе последняя группа расписания становится
      // «сегодняшним» кластером (ещё без результатов), а не прошлым уикендом.
      if (dateStr === todayISO) {
        var finMsToday = estimateRaceFinishedUtcMs(e);
        if (finMsToday == null || Date.now() < finMsToday) return;
      }

      allPast.push({ event: e, dateStr: dateStr });

      // Раньше мы фильтровали по has_detail, но для F1 / IndyCar / Cup этот флаг
      // не всегда заполнен, хотя детальные файлы и API уже есть.
      // Теперь пробуем все прошедшие события и просто игнорируем те, для которых
      // /api/events/{id} не вернёт данные.
      var sid = String(e._seriesId || e.series_id || '').toUpperCase();
      var eid = String(e.id || '').toUpperCase();

      // Исключаем выставочный Cook Out Clash (NASCAR_CUP_*_0) из блока "Last results".
      if (sid === 'NASCAR_CUP' && /_0$/.test(eid)) return;

      pastDetailed.push({ event: e, dateStr: dateStr });
    });

    if (pastDetailed.length === 0) {
      container.innerHTML =
        '<div class="lrc-label">' + esc(t('home.last_results') || 'Last Results') + '</div>' +
        '<div class="lrc-empty">' + esc(t('home.no_results') || 'No recent results') + '</div>';
      container.classList.remove('hidden');
      return;
    }

    // Определяем "прошлый уикенд" на основе тех же групп, что и Full Schedule.
    pastDetailed.sort(function (a, b) {
      return a.dateStr < b.dateStr ? -1 : a.dateStr > b.dateStr ? 1 : 0;
    });
    var recent = [];
    var buildScheduleGroups = window.TGA && typeof window.TGA.buildScheduleGroups === 'function'
      ? window.TGA.buildScheduleGroups
      : null;
    if (buildScheduleGroups && allPast.length > 0) {
      allPast.sort(function (a, b) {
        return a.dateStr < b.dateStr ? -1 : a.dateStr > b.dateStr ? 1 : 0;
      });
      var groups = buildScheduleGroups(allPast.map(function (p) { return p.event; }));
      if (Array.isArray(groups) && groups.length > 0) {
        var lastGroup = groups[groups.length - 1];
        var eventsInGroup = Array.isArray(lastGroup.events) ? lastGroup.events : [];
        // Быстрый поиск подробных событий по id.
        var detailedById = {};
        pastDetailed.forEach(function (p) {
          var id = String(p.event.id || '').toUpperCase();
          if (!id) return;
          detailedById[id] = p;
        });
        eventsInGroup.forEach(function (e) {
          var id = String(e.id || '').toUpperCase();
          if (!id) return;
          var p = detailedById[id];
          if (!p) return;
          // Пробрасываем границы уикенда из группы расписания.
          if (lastGroup && lastGroup.startDs) {
            p.weekendStart = lastGroup.startDs;
            p.weekendEnd = lastGroup.endDs || lastGroup.startDs;
          }
          recent.push(p);
        });
      }
    }
    // Фоллбек: если по какой-то причине нет групп, используем последние 4 дня, как раньше.
    if (recent.length === 0) {
      var lastDate = pastDetailed[pastDetailed.length - 1].dateStr;
      var lastDateObj = new Date(lastDate + 'T00:00:00');
      var windowStartObj = new Date(lastDateObj.getTime() - 3 * 24 * 60 * 60 * 1000);
      var windowStartISO = windowStartObj.toISOString().slice(0, 10);
      recent = pastDetailed.filter(function (p) {
        return p.dateStr >= windowStartISO && p.dateStr <= lastDate;
      });
    }

    // Не показывать «вечно» последний кластер: только если с даты окончания этапа прошло не больше 7 дней.
    function scheduleItemEndDateStr(p) {
      if (!p) return '';
      var ev = p.event || {};
      var wk = String(p.weekendEnd || '').slice(0, 10);
      if (isIsoYMD(wk)) return wk;
      var end = String(ev.end_date || '').slice(0, 10);
      if (isIsoYMD(end)) return end;
      return String(ev.start_date || ev.date || p.dateStr || '').slice(0, 10);
    }
    recent = recent.filter(function (p) {
      return isWithinLastResultsWindowByEndDate(scheduleItemEndDateStr(p));
    });

    // Если нет событий последнего уикенда с детальными файлами — выходим.
    if (recent.length === 0) {
      container.innerHTML =
        '<div class="lrc-label">' + esc(t('home.last_results') || 'Last Results') + '</div>' +
        '<div class="lrc-empty">' + esc(t('home.no_results') || 'No recent results') + '</div>';
      container.classList.remove('hidden');
      return;
    }

    // Collapse multiple расписания, которые ссылаются на один и тот же event.id, в одну карточку.
    var byEventId = {};
    recent.forEach(function (p) {
      var eid = String(p.event.id || '').toUpperCase();
      if (!eid) return;
      if (!byEventId[eid]) {
        byEventId[eid] = p;
      }
    });
    var recentUnique = Object.keys(byEventId).map(function (k) { return byEventId[k]; });

    if (recentUnique.length === 0) {
      container.innerHTML =
        '<div class="lrc-label">' + esc(t('home.last_results') || 'Last Results') + '</div>' +
        '<div class="lrc-empty">' + esc(t('home.no_results') || 'No recent results') + '</div>';
      container.classList.remove('hidden');
      return;
    }

    // Fetch event details for each recent event to get race_results winner.
    var fetchJSON = window.TGA && window.TGA.fetchJSON;
    if (!fetchJSON) {
      fetchJSON = function (url) {
        return fetch(url).then(function (r) {
          if (!r.ok) {
            var err = new Error(r.status === 404 ? 'Not found' : 'HTTP ' + r.status);
            throw err;
          }
          return r.json();
        });
      };
    }

    var promises = recentUnique.map(function (item) {
      var e = item.event;
      var eventId = String(e.id || '');
      if (!eventId) return Promise.resolve(null);
      // Do not request non-detailed events here: this avoids noisy 404s
      // for schedule-only ids while still showing a pending card.
      if (e.has_detail === false) {
        // Сегодня и раньше — показываем карточку с Results pending; только будущие даты отбрасываем.
        if (item.dateStr && item.dateStr <= todayISO) {
          return Promise.resolve({
            event: e,
            dateStr: item.dateStr,
            winners: [],
            rangeStart: item.dateStr,
            rangeEnd: item.dateStr,
            isF1SprintWeekend: false
          });
        }
        return Promise.resolve(null);
      }
      var apiEventId = eventId; // keep as-is; backend normalises case.

      return fetchJSON('/api/events/' + encodeURIComponent(apiEventId) + '?_=' + Date.now())
        .then(function (d) {
          if (!d || typeof d !== 'object') return null;
          if (d.data && typeof d.data === 'object') d = d.data;
          if (d.event && typeof d.event === 'object') d = d.event;
          if (Array.isArray(d) && d.length > 0) d = d[0];

          var tables = d.tables || {};
          var winners = [];
          var raceWasCancelled = false;

          /** F1: в tables.race.sessions только спринт (классификация), ГП в race_results. */
          function f1RaceBlockIsSprintSessionsOnly(raceBlock) {
            if (!raceBlock || !Array.isArray(raceBlock.sessions) || raceBlock.sessions.length === 0) return false;
            var anyRows = false;
            for (var sxi = 0; sxi < raceBlock.sessions.length; sxi++) {
              var sess = raceBlock.sessions[sxi];
              if (!sess || !Array.isArray(sess.rows) || sess.rows.length === 0) continue;
              anyRows = true;
              var rawLabel = '';
              if (sess.meta && typeof sess.meta.Session === 'string') {
                rawLabel = sess.meta.Session;
              }
              if ((!rawLabel || /^(Race)$/i.test(rawLabel)) && typeof sess.title === 'string') {
                rawLabel = sess.title;
              } else if (!rawLabel && typeof sess.title === 'string') {
                rawLabel = sess.title;
              }
              if (!/sprint/i.test(String(rawLabel || ''))) return false;
            }
            return anyRows;
          }

          function isCancelledText(text) {
            var s = String(text || '').trim().toLowerCase();
            if (!s) return false;
            return s.indexOf('race cancelled') >= 0 ||
              s.indexOf('race canceled') >= 0 ||
              (s.indexOf('cancelled') >= 0 && s.indexOf('weather') >= 0) ||
              (s.indexOf('canceled') >= 0 && s.indexOf('weather') >= 0);
          }

          function detectCancelledRace(tablesObj) {
            if (!tablesObj || !tablesObj.race) return false;
            var raceBlock = tablesObj.race;
            if (isCancelledText(raceBlock.note) || isCancelledText(raceBlock.subtitle)) return true;
            if (Array.isArray(raceBlock.note_lines)) {
              for (var ni = 0; ni < raceBlock.note_lines.length; ni++) {
                if (isCancelledText(raceBlock.note_lines[ni])) return true;
              }
            }
            if (Array.isArray(raceBlock.sessions)) {
              for (var si = 0; si < raceBlock.sessions.length; si++) {
                var sess = raceBlock.sessions[si] || {};
                if (isCancelledText(sess.note) || isCancelledText(sess.subtitle)) return true;
                if (Array.isArray(sess.note_lines)) {
                  for (var nli = 0; nli < sess.note_lines.length; nli++) {
                    if (isCancelledText(sess.note_lines[nli])) return true;
                  }
                }
              }
            }
            return false;
          }

          // Диапазон дат этапа: по умолчанию — дата из расписания,
          // но если в сессиях есть meta.Date (Thu 05 Mar 2026, Sun 08 Mar 2026),
          // расширяем до мин/макс по этим датам.
          var evStart = item.dateStr || '';
          var evEnd = item.dateStr || '';

          function parseMetaDateToISO(str) {
            if (!str || typeof str !== 'string') return null;
            // Ожидаемый формат: "Thu 05 Mar 2026"
            var m = str.match(/(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/);
            if (!m) return null;
            var day = ('0' + parseInt(m[1], 10)).slice(-2);
            var monMap = {
              jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
              jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
            };
            var monKey = String(m[2] || '').slice(0, 3).toLowerCase();
            var mm = monMap[monKey];
            if (!mm) return null;
            var year = m[3];
            return year + '-' + mm + '-' + day;
          }

          function updateRangeFromMetaDate(metaDate) {
            var iso = parseMetaDateToISO(metaDate);
            if (!iso) return;
            if (!evStart || iso < evStart) evStart = iso;
            if (!evEnd || iso > evEnd) evEnd = iso;
          }

          // Собираем даты по всем заездам/сессиям (practice, qualifying, race и т.д.), не только race.sessions.
          Object.keys(tables).forEach(function (key) {
            var tbl = tables[key];
            if (!tbl) return;
            if (tbl.meta && typeof tbl.meta.Date === 'string') updateRangeFromMetaDate(tbl.meta.Date);
            if (Array.isArray(tbl.sessions)) {
              tbl.sessions.forEach(function (sess) {
                if (sess && sess.meta && typeof sess.meta.Date === 'string') updateRangeFromMetaDate(sess.meta.Date);
              });
            }
          });

          // GTWCE Sprint: на карточке только абсолютный победитель гонки (Pos 1) — команда и номер, без имён пилотов.
          function extractGtwceSprintOverallWinnerFromSession(table, label) {
            if (!table || !Array.isArray(table.headers) || !Array.isArray(table.rows) || table.rows.length === 0) {
              return;
            }
            var headers = table.headers;
            var posCol = headers.indexOf('Pos');
            if (posCol < 0) posCol = headers.indexOf('Pos.');
            var teamCol = headers.indexOf('Team');
            var carNoCol = headers.indexOf('Car #');
            if (carNoCol < 0) carNoCol = headers.indexOf('Car No');
            if (carNoCol < 0) carNoCol = headers.indexOf('Car No.');
            if (carNoCol < 0) {
              carNoCol = headers.indexOf('No.');
              if (carNoCol < 0) carNoCol = headers.indexOf('No');
            }
            var winnerRow = null;
            for (var i = 0; i < table.rows.length; i++) {
              var row = table.rows[i] || [];
              if (posCol >= 0 && posCol < row.length) {
                var p = String(row[posCol] || '').trim().toUpperCase();
                if (p === '1' || p === 'P1') {
                  winnerRow = row;
                  break;
                }
              }
            }
            if (!winnerRow) winnerRow = table.rows[0] || null;
            if (!winnerRow) return;
            var team = teamCol >= 0 && teamCol < winnerRow.length ? String(winnerRow[teamCol] || '').trim() : '';
            var car = carNoCol >= 0 && carNoCol < winnerRow.length ? String(winnerRow[carNoCol] || '').trim() : '';
            winners.push({ name: team, car: car, label: label || '' });
          }

          function extractWinnerFromTable(table, label) {
            if (!table || !Array.isArray(table.headers) || !Array.isArray(table.rows) || table.rows.length === 0) {
              return;
            }
            var headers = table.headers;
            var posCol = headers.indexOf('Pos');
            if (posCol < 0) {
              posCol = headers.indexOf('Pos.');
            }
            var drvCol = headers.indexOf('Driver');
            if (drvCol < 0) drvCol = headers.indexOf('Drivers');
            if (drvCol < 0) return;
            var carCol = headers.indexOf('Car');
            if (carCol < 0) {
              carCol = headers.indexOf('#');
            }
            // Многие таблицы (IndyCar, F1, NASCAR и др.) используют "No." / "No" как номер машины.
            if (carCol < 0) {
              carCol = headers.indexOf('No.');
            }
            if (carCol < 0) {
              carCol = headers.indexOf('No');
            }
            var winnerRow = null;
            for (var i = 0; i < table.rows.length; i++) {
              var row = table.rows[i] || [];
              if (posCol >= 0 && posCol < row.length) {
                var p = String(row[posCol] || '').trim().toUpperCase();
                if (p === '1' || p === 'P1') {
                  winnerRow = row;
                  break;
                }
              }
            }
            if (!winnerRow) {
              winnerRow = table.rows[0] || null;
            }
            if (!winnerRow) return;
            var name = String(winnerRow[drvCol] || '').trim();
            var car = (carCol >= 0 && carCol < winnerRow.length) ? String(winnerRow[carCol] || '').trim() : '';
            winners.push({ name: name, car: car, label: label || '' });
          }

          // TGA-style tables (IMSA, etc.) use uppercase headers like "POS", "CAR NO", "DRIVERS".
          function extractWinnerFromTgaTable(table, label) {
            if (!table || !Array.isArray(table.headers) || !Array.isArray(table.rows) || table.rows.length === 0) {
              return;
            }
            var headers = table.headers.map(function (h) { return String(h || '').trim().toUpperCase(); });
            var posCol = headers.indexOf('POS');
            var drvCol = headers.indexOf('DRIVERS');
            var carCol = headers.indexOf('CAR NO');
            if (drvCol < 0) return;
            var winnerRow = null;
            for (var i = 0; i < table.rows.length; i++) {
              var row = table.rows[i] || [];
              if (posCol >= 0 && posCol < row.length) {
                var p = String(row[posCol] || '').trim().toUpperCase();
                if (p === '1' || p === 'P1') {
                  winnerRow = row;
                  break;
                }
              }
            }
            if (!winnerRow) winnerRow = table.rows[0] || null;
            if (!winnerRow) return;
            var name = String(winnerRow[drvCol] || '').trim();
            // DRIVERS is usually "A; B; C" - keep as crew.
            name = name.split(/\s*;\s*/).filter(Boolean).join(' / ');
            var car = (carCol >= 0 && carCol < winnerRow.length) ? String(winnerRow[carCol] || '').trim() : '';
            winners.push({ name: name, car: car, label: label || '' });
          }

          // WEC: первые строки по классу Hypercar / LMGT3 в итоговой таблице (порядок = общий финиш).
          // На карточке — только класс и команда (без имён пилотов): колонка Team, не Drivers.
          function extractWecClassWinnersFromRaceResults(table) {
            if (!table || !Array.isArray(table.headers) || !Array.isArray(table.rows) || table.rows.length === 0) return;
            var hLower = table.headers.map(function (x) { return String(x || '').trim().toLowerCase(); });
            var classIdx = hLower.indexOf('class');
            var teamIdx = hLower.indexOf('team');
            var noIdx = hLower.indexOf('no.');
            if (noIdx < 0) noIdx = hLower.indexOf('no');
            var posIdx = hLower.indexOf('pos');
            if (posIdx < 0) posIdx = hLower.indexOf('pos.');
            if (classIdx < 0 || teamIdx < 0) return;
            var wantOrder = ['hypercar', 'lmgt3'];
            var seen = {};
            (table.rows || []).forEach(function (row) {
              if (!row || !Array.isArray(row)) return;
              var clsRaw = String(row[classIdx] || '').trim().toLowerCase();
              if (wantOrder.indexOf(clsRaw) < 0 || seen[clsRaw]) return;
              var posCell = String((posIdx >= 0 && posIdx < row.length ? row[posIdx] : row[0]) || '').trim().toUpperCase();
              if (posCell === 'RET' || posCell.indexOf('RET') === 0) return;
              seen[clsRaw] = true;
              var name = String(row[teamIdx] || '').trim();
              var car = (noIdx >= 0 && noIdx < row.length) ? String(row[noIdx] || '').trim() : '';
              var label = clsRaw === 'lmgt3' ? 'LMGT3' : 'Hypercar';
              winners.push({ name: name, car: car, label: label });
            });
          }

          // IMSA: show class winners (GTP/LMP2/GTD Pro/GTD) from tables.race using CLASS + CLASS POS.
          function extractImsaClassWinnersFromTgaRace(table) {
            if (!table || !Array.isArray(table.headers) || !Array.isArray(table.rows) || table.rows.length === 0) return;
            var headers = table.headers.map(function (h) { return String(h || '').trim().toUpperCase(); });
            var clsCol = headers.indexOf('CLASS');
            var clsPosCol = headers.indexOf('CLASS POS');
            var carCol = headers.indexOf('CAR NO');
            var teamCarCol = headers.indexOf('TEAM/CAR/SPONSOR');
            if (teamCarCol < 0) {
              teamCarCol = headers.indexOf('TEAM/CAR');
            }
            if (clsCol < 0 || clsPosCol < 0) return;

            var want = ['GTP', 'LMP2', 'GTD PRO', 'GTD'];
            var bestByClass = {};

            for (var i = 0; i < table.rows.length; i++) {
              var row = table.rows[i] || [];
              var cls = String(row[clsCol] || '').trim().toUpperCase();
              if (!cls) continue;
              if (want.indexOf(cls) < 0) continue;
              var cp = String(row[clsPosCol] || '').trim().toUpperCase();
              if (cp !== '1' && cp !== 'P1') continue;
              if (!bestByClass[cls]) bestByClass[cls] = row;
            }

            want.forEach(function (cls) {
              var row = bestByClass[cls];
              if (!row) return;
              var teamLine = '';
              if (teamCarCol >= 0 && teamCarCol < row.length) {
                teamLine = String(row[teamCarCol] || '').trim();
              }
              // Usually "Team / Car" — show only team part.
              if (teamLine.indexOf('/') >= 0) {
                teamLine = teamLine.split('/')[0].trim();
              }
              var name = teamLine || '';
              var car = (carCol >= 0 && carCol < row.length) ? String(row[carCol] || '').trim() : '';
              var label = cls === 'GTD PRO' ? 'GTD Pro' : cls;
              winners.push({ name: name, car: car, label: label });
            });
          }

          // ELMS: show class-winning crews from a single race table.
          function extractElmsClassWinnersFromRace(table, entryList) {
            if (!table || !Array.isArray(table.headers) || !Array.isArray(table.rows) || table.rows.length === 0) return;
            var headers = table.headers.map(function (h) { return String(h || '').trim(); });
            var clsCol = -1;
            var posCol = -1;
            var noCol = -1;
            var teamCol = -1;
            for (var hi = 0; hi < headers.length; hi++) {
              var lh = headers[hi].toLowerCase();
              if (lh === 'class') clsCol = hi;
              if (lh === 'pos' || lh === 'pos.') posCol = hi;
              if (lh === 'no' || lh === 'no.') noCol = hi;
              if (lh === 'team') teamCol = hi;
            }
            if (clsCol < 0) return;

            var classOrder = ['LMP2', 'LMP2 Pro/Am', 'LMP3', 'LMGT3'];
            var winnerByClass = {};
            for (var ri = 0; ri < table.rows.length; ri++) {
              var row = table.rows[ri] || [];
              var cls = String(row[clsCol] || '').trim();
              if (!cls || classOrder.indexOf(cls) < 0) continue;
              var posVal = posCol >= 0 ? String(row[posCol] || '').trim() : '';
              // Prefer class winner rows (Pos=1 in class ordering). Fallback to first seen in class.
              if (!winnerByClass[cls] || posVal === '1' || posVal === 'P1') {
                winnerByClass[cls] = row;
              }
            }

            var byNo = {};
            if (Array.isArray(entryList)) {
              entryList.forEach(function (e) {
                var n = String((e && e.number) || '').trim();
                if (n) byNo[n] = e;
              });
            }

            classOrder.forEach(function (cls) {
              var row = winnerByClass[cls];
              if (!row) return;
              var carNo = (noCol >= 0 && noCol < row.length) ? String(row[noCol] || '').trim() : '';
              var team = (teamCol >= 0 && teamCol < row.length) ? String(row[teamCol] || '').trim() : '';
              var entry = carNo ? byNo[carNo] : null;
              var teamName = team || (entry && entry.team ? String(entry.team).trim() : '');
              winners.push({
                name: teamName || '',
                car: carNo || '',
                label: cls
              });
            });
          }

          // GT World Challenge Europe (Endurance / Sprint): class labels on cards — Overall / Gold / Silver / Bronze.
          function extractGtwceClassWinnersFromRace(raceBlock, entryList) {
            if (!raceBlock) return;
            var table = raceBlock;
            if (Array.isArray(raceBlock.sessions) &&
                (!Array.isArray(raceBlock.headers) || !Array.isArray(raceBlock.rows) || raceBlock.rows.length === 0)) {
              table = null;
              for (var sIdx = 0; sIdx < raceBlock.sessions.length; sIdx++) {
                var sess = raceBlock.sessions[sIdx];
                if (!sess || !Array.isArray(sess.headers) || !Array.isArray(sess.rows) || sess.rows.length === 0) continue;
                var st = String(sess.title || '').trim();
                if (/^main\s+race$/i.test(st) || /^race$/i.test(st)) {
                  table = sess;
                  break;
                }
              }
              if (!table) {
                for (var sIdx2 = 0; sIdx2 < raceBlock.sessions.length; sIdx2++) {
                  var sess2 = raceBlock.sessions[sIdx2];
                  if (!sess2 || !Array.isArray(sess2.headers) || !Array.isArray(sess2.rows) || sess2.rows.length === 0) continue;
                  var hasClass = false;
                  for (var hci = 0; hci < sess2.headers.length; hci++) {
                    if (String(sess2.headers[hci] || '').trim().toLowerCase() === 'class') {
                      hasClass = true;
                      break;
                    }
                  }
                  if (hasClass) {
                    table = sess2;
                    break;
                  }
                }
              }
            }
            if (!table || !Array.isArray(table.headers) || !Array.isArray(table.rows) || table.rows.length === 0) return;
            var headers = table.headers.map(function (h) { return String(h || '').trim(); });
            var clsCol = -1;
            var posCol = -1;
            var noCol = -1;
            var teamCol = -1;
            for (var hi = 0; hi < headers.length; hi++) {
              var lh = headers[hi].toLowerCase();
              if (lh === 'class') clsCol = hi;
              if (lh === 'pos' || lh === 'pos.') posCol = hi;
              if (lh === 'no' || lh === 'no.' || lh === 'car #' || lh === 'car no') noCol = hi;
              if (lh === 'team') teamCol = hi;
            }
            if (clsCol < 0) return;

            var classOrder = ['Pro Cup', 'Gold Cup', 'Silver Cup', 'Bronze Cup'];
            var gtwceCardLabelByClass = {
              'Pro Cup': 'Overall',
              'Gold Cup': 'Gold',
              'Silver Cup': 'Silver',
              'Bronze Cup': 'Bronze'
            };
            var winnerByClass = {};
            for (var ri = 0; ri < table.rows.length; ri++) {
              var row = table.rows[ri] || [];
              var cls = String(row[clsCol] || '').trim();
              if (!cls || classOrder.indexOf(cls) < 0) continue;
              var posVal = posCol >= 0 ? String(row[posCol] || '').trim() : '';
              if (!winnerByClass[cls] || posVal === '1' || posVal === 'P1') {
                winnerByClass[cls] = row;
              }
            }

            var byNo = {};
            if (Array.isArray(entryList)) {
              entryList.forEach(function (e) {
                var n = String((e && e.number) || '').trim();
                if (n) byNo[n] = e;
              });
            }

            classOrder.forEach(function (cls) {
              var row = winnerByClass[cls];
              if (!row) return;
              var carNo = (noCol >= 0 && noCol < row.length) ? String(row[noCol] || '').trim() : '';
              var team = (teamCol >= 0 && teamCol < row.length) ? String(row[teamCol] || '').trim() : '';
              var entry = carNo ? byNo[carNo] : null;
              var teamName = team || (entry && entry.team ? String(entry.team).trim() : '');
              winners.push({
                name: teamName || '',
                car: carNo || '',
                label: gtwceCardLabelByClass[cls] || cls
              });
            });
          }

          // Super GT: show two class winners from one race table (GT500 + GT300).
          function extractSuperGtClassWinnersFromRace(table) {
            if (!table || !Array.isArray(table.headers) || !Array.isArray(table.rows) || table.rows.length === 0) return;
            var headers = table.headers.map(function (h) { return String(h || '').trim().toUpperCase(); });
            var clsCol = headers.indexOf('CLASS');
            var posCol = headers.indexOf('POS.');
            if (posCol < 0) posCol = headers.indexOf('POS');
            var noCol = headers.indexOf('NO.');
            if (noCol < 0) noCol = headers.indexOf('NO');
            var drvCol = headers.indexOf('DRIVERS');
            var teamCol = headers.indexOf('TEAM');
            if (clsCol < 0) return;

            var want = ['GT500', 'GT300'];
            var byClass = {};
            for (var ri = 0; ri < table.rows.length; ri++) {
              var row = table.rows[ri] || [];
              var cls = String(row[clsCol] || '').trim().toUpperCase();
              if (!cls || want.indexOf(cls) < 0) continue;
              var pos = posCol >= 0 ? String(row[posCol] || '').trim().toUpperCase() : '';
              if (!byClass[cls] || pos === '1' || pos === 'P1') byClass[cls] = row;
            }

            want.forEach(function (cls) {
              var row = byClass[cls];
              if (!row) return;
              var crew = drvCol >= 0 && drvCol < row.length ? String(row[drvCol] || '').trim() : '';
              crew = crew.split(/\s*;\s*/).filter(Boolean).join(' / ');
              var team = teamCol >= 0 && teamCol < row.length ? String(row[teamCol] || '').trim() : '';
              var name = crew || team || '';
              var carNo = noCol >= 0 && noCol < row.length ? String(row[noCol] || '').trim() : '';
              winners.push({ name: name, car: carNo, label: cls });
            });
          }

          function lastResultsRaceSessionLabel(sess) {
            var rawLabel = '';
            if (sess.meta && typeof sess.meta.Session === 'string') {
              rawLabel = sess.meta.Session;
            }
            if ((!rawLabel || /^(Race)$/i.test(rawLabel)) && typeof sess.title === 'string') {
              rawLabel = sess.title;
            } else if (!rawLabel && typeof sess.title === 'string') {
              rawLabel = sess.title;
            }
            var label = String(rawLabel || '');
            label = label.replace(/\s*Results?$/i, '');
            label = label.replace(/^Race\s+(Round\s+\d+)$/i, '$1');
            var m = label.match(/(Race\s+\d+)\b/i);
            if (m) {
              label = m[1];
            } else {
              label = label.replace(/\s*Race$/i, '');
            }
            return label;
          }

          var seriesIdForSessions = String(e._seriesId || '').toUpperCase();

          // Если есть разбиение на отдельные гонки в tables.race.sessions (Supercars, F2/F3 и т.п.),
          // берём победителей только оттуда.
          if (tables.race && Array.isArray(tables.race.sessions)) {
            tables.race.sessions.forEach(function (sess) {
              var label = lastResultsRaceSessionLabel(sess);
              if (sess.meta && typeof sess.meta.Date === 'string') {
                updateRangeFromMetaDate(sess.meta.Date);
              }
              if (seriesIdForSessions === 'GTWCE_SPRINT') {
                extractGtwceSprintOverallWinnerFromSession(sess, label);
              } else {
                extractWinnerFromTable(sess, label);
              }
            });
          }
          if (tables.race_results) {
            // Главная гонка: всегда добавляем отдельно (даже если есть sessions).
            var mainRaceLabel = (tables.race && Array.isArray(tables.race.sessions)) ? 'Race' : '';
            var sidUpperForRr = String(e._seriesId || '').toUpperCase();
            if (sidUpperForRr === 'WEC') {
              extractWecClassWinnersFromRaceResults(tables.race_results);
            }
            if (winners.length === 0) {
              extractWinnerFromTable(tables.race_results, mainRaceLabel);
            } else if (sidUpperForRr === 'F1' && f1RaceBlockIsSprintSessionsOnly(tables.race)) {
              // Подпись «Feature» выставляется ниже для карточки спринт-уикенда.
              extractWinnerFromTable(tables.race_results, '');
            }
          }
          if (winners.length === 0 && tables.race) {
            // Fallback: some series (e.g. IMSA) store results in tables.race without race_results.
            var sidUpper = String(e._seriesId || '').toUpperCase();
            if (sidUpper === 'IMSA') {
              extractImsaClassWinnersFromTgaRace(tables.race);
            } else if (sidUpper === 'SUPER_GT') {
              extractSuperGtClassWinnersFromRace(tables.race);
            } else if (sidUpper === 'ELMS') {
              extractElmsClassWinnersFromRace(tables.race, d.entry_list || []);
            } else if (sidUpper === 'GTWCE_END') {
              extractGtwceClassWinnersFromRace(tables.race, d.entry_list || []);
            } else if (sidUpper === 'GTWCE_SPRINT' && tables.race && Array.isArray(tables.race.sessions)) {
              tables.race.sessions.forEach(function (sess) {
                extractGtwceSprintOverallWinnerFromSession(sess, lastResultsRaceSessionLabel(sess));
              });
            } else {
              extractWinnerFromTgaTable(tables.race, '');
            }
          }
          var sidUpperF1Check = String(e._seriesId || '').toUpperCase();
          var isF1SprintWeekend = sidUpperF1Check === 'F1' && !!tables.race_results &&
            f1RaceBlockIsSprintSessionsOnly(tables.race);
          if (isF1SprintWeekend) {
            if (winners[0]) winners[0].label = 'Sprint';
            if (winners[1]) winners[1].label = 'Feature';
          }
          raceWasCancelled = detectCancelledRace(tables);

          return {
            event: e,
            dateStr: item.dateStr,
            winners: winners,
            raceWasCancelled: raceWasCancelled,
            rangeStart: evStart,
            rangeEnd: evEnd,
            isF1SprintWeekend: isF1SprintWeekend
          };
        })
        .catch(function () {
          if (item.dateStr && item.dateStr <= todayISO) {
            return {
              event: e,
              dateStr: item.dateStr,
              winners: [],
              raceWasCancelled: false,
              rangeStart: item.dateStr,
              rangeEnd: item.dateStr,
              isF1SprintWeekend: false
            };
          }
          return null;
        });
    });

    Promise.all(promises).then(function (results) {
      var cards = results.filter(Boolean);

      function eventSeriesUpperLrc(ev) {
        return String((ev && (ev._seriesId || ev.series_id)) || '').toUpperCase();
      }

      function mergeSuperFormulaLastResultCards(arr) {
        if (!Array.isArray(arr) || arr.length === 0) return arr;
        var sf = [];
        var rest = [];
        arr.forEach(function (c) {
          if (eventSeriesUpperLrc(c.event) === 'SUPER_FORMULA') sf.push(c);
          else rest.push(c);
        });
        sf.sort(function (a, b) {
          var da = (a.rangeStart || a.dateStr || '').slice(0, 10);
          var db = (b.rangeStart || b.dateStr || '').slice(0, 10);
          return da < db ? -1 : da > db ? 1 : 0;
        });
        var outSf = [];
        for (var i = 0; i < sf.length; i++) {
          var c = sf[i];
          var e = c.event;
          var run = [c];
          var c0 = String(e.circuit_name || '').trim();
          var l0 = String(e.location || '').trim();
          var prev = (c.rangeEnd || c.rangeStart || c.dateStr || '').slice(0, 10);
          var j = i + 1;
          while (j < sf.length) {
            var c2 = sf[j];
            var e2 = c2.event;
            if (String(e2.circuit_name || '').trim() !== c0 || String(e2.location || '').trim() !== l0) break;
            var d2 = (c2.rangeStart || c2.dateStr || '').slice(0, 10);
            var diffMs = new Date(d2 + 'T12:00:00').getTime() - new Date(prev + 'T12:00:00').getTime();
            if (diffMs !== 86400000) break;
            run.push(c2);
            prev = (c2.rangeEnd || c2.dateStr || d2).slice(0, 10);
            j++;
          }
          if (run.length === 1) {
            outSf.push(c);
          } else {
            var first = run[0];
            var last = run[run.length - 1];
            var fe = first.event;
            var rs = (first.rangeStart || first.dateStr || '').slice(0, 10);
            var re = (last.rangeEnd || last.dateStr || '').slice(0, 10);
            var allWinners = [];
            run.forEach(function (x) {
              var w = x.winners;
              if (Array.isArray(w)) {
                for (var wi = 0; wi < w.length; wi++) allWinners.push(w[wi]);
              }
            });
            outSf.push({
              event: Object.assign({}, fe, {
                start_date: rs,
                end_date: re,
                name: String(fe.circuit_name || fe.name || '').trim(),
                _seriesId: fe._seriesId || fe.series_id || 'SUPER_FORMULA'
              }),
              dateStr: re,
              rangeStart: rs,
              rangeEnd: re,
              winners: allWinners
            });
          }
          i = j - 1;
        }
        var merged = rest.concat(outSf);
        merged.sort(function (a, b) {
          var ka = (a.rangeStart || a.dateStr || '').slice(0, 10);
          var kb = (b.rangeStart || b.dateStr || '').slice(0, 10);
          return ka < kb ? -1 : ka > kb ? 1 : 0;
        });
        return merged;
      }

      function mergeSupercarsLastResultCards(arr) {
        if (!Array.isArray(arr) || arr.length === 0) return arr;
        var sc = [];
        var rest = [];
        arr.forEach(function (c) {
          if (eventSeriesUpperLrc(c.event) === 'SUPERCARS') sc.push(c);
          else rest.push(c);
        });
        sc.sort(function (a, b) {
          var da = (a.rangeStart || a.dateStr || '').slice(0, 10);
          var db = (b.rangeStart || b.dateStr || '').slice(0, 10);
          return da < db ? -1 : da > db ? 1 : 0;
        });
        var outSc = [];
        for (var i = 0; i < sc.length; i++) {
          var c = sc[i];
          var e = c.event || {};
          var run = [c];
          var c0 = String(e.circuit_name || '').trim();
          var l0 = String(e.location || '').trim();
          var prev = (c.rangeEnd || c.rangeStart || c.dateStr || '').slice(0, 10);
          var j = i + 1;
          while (j < sc.length) {
            var c2 = sc[j];
            var e2 = c2.event || {};
            if (String(e2.circuit_name || '').trim() !== c0 || String(e2.location || '').trim() !== l0) break;
            var d2 = (c2.rangeStart || c2.dateStr || '').slice(0, 10);
            var diffMs = new Date(d2 + 'T12:00:00').getTime() - new Date(prev + 'T12:00:00').getTime();
            // Same/next day and also overlapping ranges (diff < 0 when one card already spans
            // more days from detailed session metadata) belong to one merged weekend card.
            if (diffMs > 86400000) break;
            run.push(c2);
            var c2End = (c2.rangeEnd || c2.dateStr || d2).slice(0, 10);
            if (!prev || c2End > prev) prev = c2End;
            j++;
          }
          if (run.length === 1) {
            outSc.push(c);
          } else {
            var first = run[0];
            var last = run[run.length - 1];
            var fe = first.event || {};
            var rs = (first.rangeStart || first.dateStr || '').slice(0, 10);
            var re = (last.rangeEnd || last.dateStr || '').slice(0, 10);
            var allWinners = [];
            run.forEach(function (x) {
              var w = x.winners;
              if (Array.isArray(w)) {
                for (var wi = 0; wi < w.length; wi++) allWinners.push(w[wi]);
              }
            });
            // Дедуп победителей: иногда один и тот же winner попадает дважды при сборке sessions.
            (function () {
              var seen = {};
              allWinners = allWinners.filter(function (w) {
                var key = String((w && w.label) || '') + '|' + String((w && w.car) || '') + '|' + String((w && w.name) || '');
                if (seen[key]) return false;
                seen[key] = true;
                return true;
              });
            })();
            outSc.push({
              event: Object.assign({}, fe, {
                start_date: rs,
                end_date: re,
                // Drop trailing race number in merged card title.
                name: String(fe.name || fe.circuit_name || '').replace(/\s*Race\s*\d+\s*$/i, '').trim() || String(fe.circuit_name || '').trim(),
                _seriesId: fe._seriesId || fe.series_id || 'SUPERCARS'
              }),
              dateStr: re,
              rangeStart: rs,
              rangeEnd: re,
              winners: allWinners
            });
          }
          i = j - 1;
        }
        var merged = rest.concat(outSc);
        merged.sort(function (a, b) {
          var ka = (a.rangeStart || a.dateStr || '').slice(0, 10);
          var kb = (b.rangeStart || b.dateStr || '').slice(0, 10);
          return ka < kb ? -1 : ka > kb ? 1 : 0;
        });
        return merged;
      }

      cards = mergeSuperFormulaLastResultCards(cards);
      cards = mergeSupercarsLastResultCards(cards);

      // Будущие по календарю не показываем. Прошлые/сегодня — только если с даты окончания события
      // прошло не больше 7 дней (иначе карточка «зависает» в ленте).
      // «Сегодня»: есть победители ИЛИ по расписанию уже после оценочного финиша (старт + длительность).
      cards = cards.filter(function (card) {
        var e = card.event || {};
        var endIso = (card.rangeEnd || e.end_date || e.start_date || card.dateStr || '').slice(0, 10);
        if (!isIsoYMD(endIso)) return false;
        if (endIso > todayISO) return false;
        if (!isWithinLastResultsWindowByEndDate(endIso)) return false;
        if (endIso < todayISO) return true;
        var w = card.winners;
        if (w && w.length > 0) return true;
        var finMs = estimateRaceFinishedUtcMs(card.event);
        return finMs != null && Date.now() >= finMs;
      });

      if (cards.length === 0) {
        container.innerHTML =
          '<div class="lrc-label">' + esc(t('home.last_results') || 'Last Results') + '</div>' +
          '<div class="lrc-empty">' + esc(t('home.no_results') || 'No recent results') + '</div>';
        container.classList.remove('hidden');
        return;
      }

      container.innerHTML =
        '<div class="lrc-label">' + esc(t('home.last_results') || 'Last Results') + '</div>' +
        '<div class="lrc-cards">' +
        cards.map(function (card, idx) {
          var e = card.event;
          // Для каждой карточки показываем собственный диапазон дат события.
          var startIso = (card.rangeStart || e.start_date || e.date || card.dateStr || '').slice(0, 10);
          var endIso = (card.rangeEnd || e.end_date || startIso || '').slice(0, 10);
          var rangeStart = startIso || card.dateStr || '';
          var rangeEnd = endIso || rangeStart;
          var name = e.name || '—';
          var seriesIdUpper = String(e._seriesId || e.series_id || '').toUpperCase();
          // Для F2/F3 убираем "(Sprint)/(Feature)" из названия события — это уже есть в подписях.
          if (seriesIdUpper === 'F2' || seriesIdUpper === 'F3') {
            name = name.replace(/\s*\((Sprint|Feature)\)\s*$/i, '');
          }
          // Для Supercars: "Melbourne SuperSprint Race 1" → "Melbourne SuperSprint".
          if (seriesIdUpper === 'SUPERCARS') {
            name = name.replace(/\s*Race\s*\d+\s*$/i, '');
          }
          var eventSlug = (e.id || '').toLowerCase().replace(/_+/g, '-');
          var seriesSlug = (e._seriesId || e.series_id || '').toLowerCase().replace(/_+/g, '-');
          var eventNameLc = String(e.name || '').toLowerCase();
          // In "Last Results" we should always open the event page.
          // Even when results are pending, the event overview is still valid.
          var href = eventSlug
            ? '/event/' + encodeURIComponent(eventSlug)
            : '/series/' + encodeURIComponent(seriesSlug);
          var delayMs = idx * 55;

          // Additional classes for background images (to be styled in CSS).
          var extraClass = '';
          var circuitName = (e.circuit_name || '').toLowerCase();
          var trackName = (e.track || '').toLowerCase();
          var location = (e.location || '').toLowerCase();
          var trackKey = [circuitName, trackName, location].filter(Boolean).join(' ');
          if (trackKey.indexOf('shanghai international circuit') >= 0) {
            extraClass += ' lrc-card--f1-2026-2';
          }
          if (trackKey.indexOf('las vegas motor speedway') >= 0) {
            extraClass += ' lrc-card--cup-2026-3';
          }
          if (trackKey.indexOf('phoenix raceway') >= 0) {
            // Один и тот же фон для всех серий на Phoenix.
            extraClass += ' lrc-card--phoenix';
          }
          if (trackKey.indexOf('darlington raceway') >= 0) {
            extraClass += ' lrc-card--darlington';
          }
          if (trackKey.indexOf('rockingham speedway') >= 0) {
            extraClass += ' lrc-card--rockingham';
          }
          if (trackKey.indexOf('martinsville speedway') >= 0) {
            extraClass += ' lrc-card--martinsville';
          }
          if (trackKey.indexOf('suzuka circuit') >= 0) {
            extraClass += ' lrc-card--suzuka';
          }
          if (trackKey.indexOf('barber motorsports park') >= 0) {
            extraClass += ' lrc-card--barber';
          }
          if (trackKey.indexOf('sebring international raceway') >= 0) {
            extraClass += ' lrc-card--sebring';
          }
          if (trackKey.indexOf('streets of arlington') >= 0) {
            extraClass += ' lrc-card--indycar-2026-3';
          }
          if (trackKey.indexOf('albert park circuit') >= 0) {
            extraClass += ' lrc-card--albert-park';
          }
          if (trackKey.indexOf('mobility resort motegi') >= 0) {
            extraClass += ' lrc-card--motegi';
          }
          if (trackKey.indexOf('circuit de barcelona-catalunya') >= 0 || trackKey.indexOf('barcelona') >= 0 || trackKey.indexOf('montmelo') >= 0) {
            extraClass += ' lrc-card--barcelona';
          }
          if (trackKey.indexOf('taupo') >= 0) {
            extraClass += ' lrc-card--taupo';
          }
          if (trackKey.indexOf('okayama') >= 0 || trackKey.indexOf('okoyama') >= 0) {
            extraClass += ' lrc-card--okayama';
          }
          if (trackKey.indexOf('paul ricard') >= 0 || trackKey.indexOf('le castellet') >= 0) {
            extraClass += ' lrc-card--paul-ricard';
          }
          if (trackKey.indexOf('thompson') >= 0) {
            extraClass += ' lrc-card--thompson';
          }
          if (trackKey.indexOf('imola') >= 0) {
            extraClass += ' lrc-card--imola';
          }
          if (trackKey.indexOf('kansas speedway') >= 0 || trackKey.indexOf('kansas city, kansas') >= 0) {
            extraClass += ' lrc-card--kansas';
          }
          if (trackKey.indexOf('autopolis') >= 0) {
            extraClass += ' lrc-card--autopolis';
          }
          if (trackKey.indexOf('talladega') >= 0) {
            extraClass += ' lrc-card--talladega';
          }
          if (trackKey.indexOf('texas motor speedway') >= 0 || trackKey.indexOf('fort worth') >= 0) {
            extraClass += ' lrc-card--texas';
          }
          if (trackKey.indexOf('brands hatch') >= 0) {
            extraClass += ' lrc-card--brands-hatch';
          }
          if (trackKey.indexOf('oxford plains') >= 0 || trackKey.indexOf('oxford') >= 0) {
            extraClass += ' lrc-card--oxford-plains';
          }
          if (trackKey.indexOf('fuji') >= 0 || trackKey.indexOf('fuji speedway') >= 0) {
            extraClass += ' lrc-card--fuji';
          }
          if (trackKey.indexOf('miami international autodrome') >= 0 || trackKey.indexOf('miami') >= 0) {
            extraClass += ' lrc-card--miami';
          }
          if (trackKey.indexOf('gilles villeneuve') >= 0 || trackKey.indexOf('circuit gilles') >= 0 || trackKey.indexOf('montreal') >= 0) {
            extraClass += ' lrc-card--montreal';
          }
          if (trackKey.indexOf('laguna seca') >= 0 || trackKey.indexOf('weathertech raceway') >= 0 || trackKey.indexOf('monterey') >= 0) {
            extraClass += ' lrc-card--laguna-seca';
          }
          if (trackKey.indexOf('red bull ring') >= 0 || trackKey.indexOf('spielberg') >= 0) {
            extraClass += ' lrc-card--red-bull-ring';
          }
          if (trackKey.indexOf('long beach') >= 0) {
            extraClass += ' lrc-card--long-beach';
          }
          if (trackKey.indexOf('euromarque') >= 0 || trackKey.indexOf('christchurch') >= 0) {
            extraClass += ' lrc-card--euromarque';
          }
          if (eventNameLc.indexOf('taupo') >= 0 || eventNameLc.indexOf('taupō') >= 0) {
            extraClass += ' lrc-card--taupo';
          }
          if (eventNameLc.indexOf('okayama') >= 0 || eventNameLc.indexOf('okoyama') >= 0) {
            extraClass += ' lrc-card--okayama';
          }
          if (eventNameLc.indexOf('paul ricard') >= 0 || eventNameLc.indexOf('le castellet') >= 0) {
            extraClass += ' lrc-card--paul-ricard';
          }
          if (eventNameLc.indexOf('thompson') >= 0) {
            extraClass += ' lrc-card--thompson';
          }
          if (eventNameLc.indexOf('imola') >= 0) {
            extraClass += ' lrc-card--imola';
          }
          if (eventNameLc.indexOf('kansas') >= 0) {
            extraClass += ' lrc-card--kansas';
          }
          if (eventNameLc.indexOf('autopolis') >= 0) {
            extraClass += ' lrc-card--autopolis';
          }
          if (eventNameLc.indexOf('talladega') >= 0) {
            extraClass += ' lrc-card--talladega';
          }
          if (eventNameLc.indexOf('texas') >= 0 || eventNameLc.indexOf('fort worth') >= 0) {
            extraClass += ' lrc-card--texas';
          }
          if (eventNameLc.indexOf('brands hatch') >= 0) {
            extraClass += ' lrc-card--brands-hatch';
          }
          if (eventNameLc.indexOf('oxford plains') >= 0 || eventNameLc.indexOf('oxford') >= 0) {
            extraClass += ' lrc-card--oxford-plains';
          }
          if (eventNameLc.indexOf('fuji') >= 0) {
            extraClass += ' lrc-card--fuji';
          }
          if (eventNameLc.indexOf('miami') >= 0) {
            extraClass += ' lrc-card--miami';
          }
          if (eventNameLc.indexOf('gilles villeneuve') >= 0 || eventNameLc.indexOf('montreal') >= 0 || eventNameLc.indexOf('canadian grand prix') >= 0) {
            extraClass += ' lrc-card--montreal';
          }
          if (eventNameLc.indexOf('laguna seca') >= 0 || eventNameLc.indexOf('weathertech raceway') >= 0 || eventNameLc.indexOf('monterey') >= 0) {
            extraClass += ' lrc-card--laguna-seca';
          }
          if (eventNameLc.indexOf('red bull ring') >= 0 || eventNameLc.indexOf('spielberg') >= 0) {
            extraClass += ' lrc-card--red-bull-ring';
          }
          if (eventNameLc.indexOf('long beach') >= 0) {
            extraClass += ' lrc-card--long-beach';
          }
          if (eventNameLc.indexOf('euromarque') >= 0) {
            extraClass += ' lrc-card--euromarque';
          }
          if (trackKey.indexOf('bristol') >= 0) {
            extraClass += ' lrc-card--bristol';
          }
          if (!extraClass) {
            if (eventSlug === 'f1-2026-2') {
              extraClass += ' lrc-card--f1-2026-2';
            } else if (eventSlug === 'nascar-cup-2026-5' || eventSlug === 'cup-2026-5' || eventSlug === 'noaps-2026-5') {
              extraClass += ' lrc-card--cup-2026-3';
            } else if (eventSlug === 'indycar-2026-3') {
              extraClass += ' lrc-card--indycar-2026-3';
            } else if (eventSlug === 'super-formula-2026-1') {
              extraClass += ' lrc-card--motegi';
            } else if (eventSlug === 'elms-2026-prologue') {
              extraClass += ' lrc-card--barcelona';
            } else if (eventSlug.indexOf('taupo') >= 0) {
              extraClass += ' lrc-card--taupo';
            } else if (eventSlug.indexOf('bristol') >= 0) {
              extraClass += ' lrc-card--bristol';
            } else if (eventSlug.indexOf('okayama') >= 0 || eventSlug.indexOf('okoyama') >= 0) {
              extraClass += ' lrc-card--okayama';
            } else if (eventSlug.indexOf('ricard') >= 0 || eventSlug.indexOf('le-castellet') >= 0) {
              extraClass += ' lrc-card--paul-ricard';
            } else if (eventSlug.indexOf('thompson') >= 0) {
              extraClass += ' lrc-card--thompson';
            } else if (eventSlug.indexOf('imola') >= 0) {
              extraClass += ' lrc-card--imola';
            } else if (eventSlug.indexOf('kansas') >= 0) {
              extraClass += ' lrc-card--kansas';
            } else if (eventSlug.indexOf('autopolis') >= 0) {
              extraClass += ' lrc-card--autopolis';
            } else if (eventSlug.indexOf('talladega') >= 0) {
              extraClass += ' lrc-card--talladega';
            } else if (eventSlug.indexOf('texas') >= 0 || eventSlug.indexOf('fort-worth') >= 0 || eventSlug.indexOf('fort_worth') >= 0) {
              extraClass += ' lrc-card--texas';
            } else if (eventSlug.indexOf('brands-hatch') >= 0 || eventSlug.indexOf('brands_hatch') >= 0) {
              extraClass += ' lrc-card--brands-hatch';
            } else if (eventSlug.indexOf('oxford-plains') >= 0 || eventSlug.indexOf('oxford_plains') >= 0 || eventSlug.indexOf('oxford') >= 0) {
              extraClass += ' lrc-card--oxford-plains';
            } else if (eventSlug.indexOf('fuji') >= 0) {
              extraClass += ' lrc-card--fuji';
            } else if (eventSlug.indexOf('miami') >= 0) {
              extraClass += ' lrc-card--miami';
            } else if (eventSlug.indexOf('montreal') >= 0 || eventSlug.indexOf('gilles-villeneuve') >= 0 || eventSlug.indexOf('gilles_villeneuve') >= 0 || eventSlug === 'f2-2026-3' || eventSlug === 'f1-2026-7') {
              extraClass += ' lrc-card--montreal';
            } else if (eventSlug.indexOf('laguna-seca') >= 0 || eventSlug.indexOf('laguna_seca') >= 0 || eventSlug.indexOf('monterey') >= 0) {
              extraClass += ' lrc-card--laguna-seca';
            } else if (eventSlug.indexOf('red-bull-ring') >= 0 || eventSlug.indexOf('red_bull_ring') >= 0 || eventSlug.indexOf('spielberg') >= 0) {
              extraClass += ' lrc-card--red-bull-ring';
            } else if (eventSlug.indexOf('long-beach') >= 0 || eventSlug.indexOf('long_beach') >= 0) {
              extraClass += ' lrc-card--long-beach';
            } else if (eventSlug.indexOf('euromarque') >= 0) {
              extraClass += ' lrc-card--euromarque';
            }
          }

          // Дополнительные классы по серии (для стилизации winners у F2/F3).
          if (seriesIdUpper === 'F2') {
            extraClass += ' lrc-card--f2';
          } else if (seriesIdUpper === 'F3') {
            extraClass += ' lrc-card--f3';
          } else if (seriesIdUpper === 'SUPERCARS') {
            extraClass += ' lrc-card--supercars';
          } else if (seriesIdUpper === 'FREC') {
            extraClass += ' lrc-card--frec';
          } else if (seriesIdUpper === 'IMSA') {
            extraClass += ' lrc-card--imsa';
          } else if (seriesIdUpper === 'WEC') {
            extraClass += ' lrc-card--wec';
          } else if (seriesIdUpper === 'ELMS') {
            extraClass += ' lrc-card--elms';
          } else if (seriesIdUpper === 'GTWCE_END' || seriesIdUpper === 'GTWCE_SPRINT') {
            extraClass += ' lrc-card--gtwce';
          } else if (seriesIdUpper === 'SUPER_GT') {
            extraClass += ' lrc-card--super-gt';
          }

          // Победители: для обычных этапов показываем одну строку,
          // для F2/F3 и Supercars — победителей всех гонок уикенда (в разумном лимите).
          var winnerHtml = '';
          var list = Array.isArray(card.winners) ? card.winners : [];
          if (list.length > 0) {
            if (seriesIdUpper === 'IMSA') {
              // IMSA: show class winners (up to 4 lines).
              winnerHtml = list.slice(0, 4).map(function (w) {
                var line = w.name || '';
                if (w.car) line = '#' + w.car + ' ' + line;
                var label = (w.label || '').trim();
                if (label) line = line + ' — ' + label;
                return esc(line);
              }).join('<br>');
            } else if (seriesIdUpper === 'WEC') {
              // WEC: «класс — экипаж» (Hypercar / LMGT3).
              winnerHtml = list.slice(0, 4).map(function (w) {
                var crew = w.name || '';
                if (w.car) crew = '#' + w.car + ' ' + crew;
                var label = (w.label || '').trim();
                var line = label ? label + ' — ' + crew : crew;
                return esc(line);
              }).join('<br>');
            } else if (seriesIdUpper === 'ELMS' || seriesIdUpper === 'GTWCE_END') {
              // ELMS / GTWCE Endurance: class winners — «Label - Team #no» (.lrc-winner-line — display:block).
              winnerHtml = list.slice(0, 4).map(function (w) {
                var line = w.name || '';
                if (w.car) line = line + ' #' + w.car;
                var label = (w.label || '').trim();
                if (label) line = label + ' - ' + line;
                return '<span class="lrc-winner-line">' + esc(line) + '</span>';
              }).join('');
            } else if (seriesIdUpper === 'GTWCE_SPRINT') {
              // GTWCE Sprint: только абсолютные победители Race 1 / Race 2 — команда и № (без имён пилотов).
              winnerHtml = list.slice(0, 2).map(function (w) {
                var line = w.name || '';
                if (w.car) line = line + ' #' + w.car;
                var label = (w.label || '').trim();
                if (label) line = label + ' - ' + line;
                return '<span class="lrc-winner-line">' + esc(line) + '</span>';
              }).join('');
            } else if (seriesIdUpper === 'FREC') {
              // FREC: compact 3-line format to fit Race 1/2/3 winners.
              winnerHtml = list.slice(0, 3).map(function (w) {
                var line = w.name || '';
                if (w.car) line = '#' + w.car + ' ' + line;
                var label = String(w.label || '').trim();
                var rm = label.match(/race\s*(\d+)/i);
                if (rm && rm[1]) label = 'R' + rm[1];
                if (label) line = label + ': ' + line;
                return esc(line);
              }).join('<br>');
            } else if (seriesIdUpper === 'F1' && card.isF1SprintWeekend) {
              // Только спринт-уикенды F1: «Sprint - #1 …» / «Feature - #12 …».
              winnerHtml = list.slice(0, 4).map(function (w) {
                var label = (w.label || '').trim();
                var line = w.name || '';
                if (w.car) line = '#' + w.car + ' ' + line;
                if (label) line = label + ' - ' + line;
                return esc(line);
              }).join('<br>');
            } else if (seriesIdUpper === 'F1' || seriesIdUpper === 'F2' || seriesIdUpper === 'F3' || seriesIdUpper === 'SUPERCARS' || seriesIdUpper === 'SUPER_FORMULA' || seriesIdUpper === 'SUPER_GT' || seriesIdUpper === 'DTM') {
              // F1/F2/F3: обычно Sprint / Feature / Race. Supercars: несколько гонок (Race 4–7).
              // Super GT: два победителя по классам (GT500 + GT300). DTM: Race 1 + Race 2.
              // Ограничиваемся первыми четырьмя, чтобы не раздувать карточку.
              winnerHtml = list.slice(0, 4).map(function (w) {
                var line = w.name || '';
                if (w.car) {
                  line = '#' + w.car + ' ' + line;
                }
                var label = (w.label || '').trim();
                if (label) {
                  line = line + ' — ' + label;
                }
                return esc(line);
              }).join('<br>');
            } else if (list.length === 1) {
              var w1 = list[0] || {};
              var line1 = w1.name || '';
              if (w1.car) {
                line1 = '#' + w1.car + ' ' + line1;
              }
              winnerHtml = esc(line1);
            }
          }

          var noDataYet = !winnerHtml;
          var eventIdUpper = String(e.id || '').toUpperCase();
          var isPrologueOrPreSeason =
            eventIdUpper.indexOf('PROLOGUE') >= 0 ||
            eventIdUpper.indexOf('PRE_SEASON_TEST') >= 0 ||
            /\bprologue\b/i.test(String(name || ''));
          var pendingHtml = noDataYet
            ? (isPrologueOrPreSeason
              ? ''
              : '<div class="lrc-winner lrc-winner--pending">' + esc(card.raceWasCancelled ? 'Race was cancelled' : (t('home.awaiting_results') || 'Results pending')) + '</div>')
            : '';

          return (
            '<a href="' + href + '" class="lrc-card lrc-card-enter' + ((noDataYet && !isPrologueOrPreSeason) ? ' lrc-card--pending' : '') + extraClass + '" style="animation-delay:' + delayMs + 'ms">' +
              '<div class="lrc-top">' +
                seriesBadge(e._seriesId || e.series_id || '') +
                '<span class="lrc-date">' + esc(window.TGA.formatDateRangeLong ? window.TGA.formatDateRangeLong(rangeStart, rangeEnd) : (window.TGA.formatDateRange ? window.TGA.formatDateRange(rangeStart, rangeEnd) : formatShortDate(rangeStart))) + '</span>' +
              '</div>' +
              '<div class="lrc-name">' + esc(name) + '</div>' +
              (winnerHtml ? '<div class="lrc-winner">' + winnerHtml + '</div>' : pendingHtml) +
            '</a>'
          );
        }).join('') +
        '</div>';

      container.classList.remove('hidden');
    });
  }

  window.TGA.renderLastResultsCards = renderLastResultsCards;
})();

