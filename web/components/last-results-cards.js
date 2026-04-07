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

    var allPast = [];
    var pastDetailed = [];
    (Array.isArray(allEvents) ? allEvents : []).forEach(function (e) {
      if (!e || !e.id) return;
      var dateStr = (e.end_date || e.start_date || e.date || '').slice(0, 10);
      if (!isIsoYMD(dateStr) || dateStr > todayISO) return;

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
        if (item.dateStr && item.dateStr < todayISO) {
          return Promise.resolve({
            event: e,
            dateStr: item.dateStr,
            winners: [],
            rangeStart: item.dateStr,
            rangeEnd: item.dateStr
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

          // Если есть разбиение на отдельные гонки в tables.race.sessions (Supercars, F2/F3 и т.п.),
          // берём победителей только оттуда.
          if (tables.race && Array.isArray(tables.race.sessions)) {
            tables.race.sessions.forEach(function (sess) {
              var rawLabel = '';
              if (sess.meta && typeof sess.meta.Session === 'string') {
                rawLabel = sess.meta.Session;
              }
              // Если Session слишком общее ("Race"), но в title есть номер гонки — используем title.
              if ((!rawLabel || /^(Race)$/i.test(rawLabel)) && typeof sess.title === 'string') {
                rawLabel = sess.title;
              } else if (!rawLabel && typeof sess.title === 'string') {
                rawLabel = sess.title;
              }
              var label = String(rawLabel || '');
              label = label.replace(/\s*Results?$/i, '');

              // Для Supercars и похожих форматов важно сохранить номер гонки:
              // "2026 Repco Supercars Championship - Race 4" → "Race 4".
              var m = label.match(/(Race\s+\d+)\b/i);
              if (m) {
                label = m[1];
              } else {
                label = label.replace(/\s*Race$/i, '');
              }
              if (sess.meta && typeof sess.meta.Date === 'string') {
                updateRangeFromMetaDate(sess.meta.Date);
              }
              extractWinnerFromTable(sess, label);
            });
          }
          if (tables.race_results) {
            // Главная гонка: всегда добавляем отдельно (даже если есть sessions).
            var mainRaceLabel = (tables.race && Array.isArray(tables.race.sessions)) ? 'Race' : '';
            extractWinnerFromTable(tables.race_results, mainRaceLabel);
          }
          if (winners.length === 0 && tables.race) {
            // Fallback: some series (e.g. IMSA) store results in tables.race without race_results.
            if (String(e._seriesId || '').toUpperCase() === 'IMSA') {
              extractImsaClassWinnersFromTgaRace(tables.race);
            } else {
              extractWinnerFromTgaTable(tables.race, '');
            }
          }

          return {
            event: e,
            dateStr: item.dateStr,
            winners: winners,
            rangeStart: evStart,
            rangeEnd: evEnd
          };
        })
        .catch(function () {
          if (item.dateStr && item.dateStr < todayISO) {
            return {
              event: e,
              dateStr: item.dateStr,
              winners: [],
              rangeStart: item.dateStr,
              rangeEnd: item.dateStr
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

      cards = mergeSuperFormulaLastResultCards(cards);

      // Не показывать в Last Results гонки «сегодня» без результатов: по календарю день уже
      // наступил, но заезд ещё не прошёл (или таблицы пустые). Будущие даты — отсекаются выше.
      cards = cards.filter(function (card) {
        var ds = (card.dateStr || card.rangeEnd || card.rangeStart || '').slice(0, 10);
        if (!isIsoYMD(ds)) return false;
        if (ds > todayISO) return false;
        if (ds === todayISO) {
          var w = card.winners;
          if (!w || w.length === 0) return false;
        }
        return true;
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
          // In "Last Results" we should always open the event page.
          // Even when results are pending, the event overview is still valid.
          var href = eventSlug
            ? '/event/' + encodeURIComponent(eventSlug)
            : '/series/' + encodeURIComponent(seriesSlug);
          var delayMs = idx * 55;

          // Additional classes for background images (to be styled in CSS).
          var extraClass = '';
          var circuitName = (e.circuit_name || '').toLowerCase();
          var location = (e.location || '').toLowerCase();
          var trackKey = circuitName || location;
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
          if (!extraClass) {
            if (eventSlug === 'f1-2026-2') {
              extraClass += ' lrc-card--f1-2026-2';
            } else if (eventSlug === 'nascar-cup-2026-5' || eventSlug === 'cup-2026-5' || eventSlug === 'noaps-2026-5') {
              extraClass += ' lrc-card--cup-2026-3';
            } else if (eventSlug === 'indycar-2026-3') {
              extraClass += ' lrc-card--indycar-2026-3';
            }
          }

          // Дополнительные классы по серии (для стилизации winners у F2/F3).
          if (seriesIdUpper === 'F2') {
            extraClass += ' lrc-card--f2';
          } else if (seriesIdUpper === 'F3') {
            extraClass += ' lrc-card--f3';
          } else if (seriesIdUpper === 'SUPERCARS') {
            extraClass += ' lrc-card--supercars';
          } else if (seriesIdUpper === 'IMSA') {
            extraClass += ' lrc-card--imsa';
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
            } else if (seriesIdUpper === 'F1' || seriesIdUpper === 'F2' || seriesIdUpper === 'F3' || seriesIdUpper === 'SUPERCARS' || seriesIdUpper === 'SUPER_FORMULA') {
              // F1/F2/F3: обычно Sprint / Feature / Race. Supercars: несколько гонок (Race 4–7).
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
          var pendingHtml = noDataYet
            ? '<div class="lrc-winner lrc-winner--pending">' + esc(t('home.awaiting_results') || 'Results pending') + '</div>'
            : '';

          return (
            '<a href="' + href + '" class="lrc-card lrc-card-enter' + (noDataYet ? ' lrc-card--pending' : '') + extraClass + '" style="animation-delay:' + delayMs + 'ms">' +
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

