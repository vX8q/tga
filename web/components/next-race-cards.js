// Next-race cards: uses window.TGA (t, esc, seriesBadge, formatShortDate, parseEventDate) at call time.
(function () {
  if (typeof window === 'undefined') return;
  window.TGA = window.TGA || {};

  var nrcCards = [];
  var nrcInterval = null;
  var nrcLiveRefresh = null;
  /** Live event IDs from API (data/live.json). Mutated when refetching. */
  var nrcLiveSet = {};

  function stopNextRaceTimers() {
    if (nrcInterval) { clearInterval(nrcInterval); nrcInterval = null; }
    if (nrcLiveRefresh) { clearInterval(nrcLiveRefresh); nrcLiveRefresh = null; }
    nrcCards = [];
  }

  function applyLiveIds(ids) {
    var k;
    for (k in nrcLiveSet) { delete nrcLiveSet[k]; }
    (Array.isArray(ids) ? ids : []).forEach(function (id) {
      var u = (id || '').toUpperCase();
      if (u) nrcLiveSet[u] = true;
    });
  }

  function renderNextRaceCards(allEvents) {
    var t = window.TGA.t;
    var esc = window.TGA.esc;
    var seriesBadge = window.TGA.seriesBadge;
    var formatShortDate = window.TGA.formatShortDate;
    var parseEventDate = window.TGA.parseEventDate;
    if (!t || !esc || !seriesBadge || !formatShortDate || !parseEventDate) return;

    stopNextRaceTimers();
    var container = document.getElementById('next-races-row');
    if (!container) return;
    container.classList.remove('hidden');

    var todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    var windowStart = todayStart.getTime();
    var windowEnd = windowStart + 7 * 24 * 60 * 60 * 1000 - 1;
    var nowTs = Date.now();

    // Окно "LIVE": не весь день, а до 3 часов после старта (гонка уже не идёт).
    function endTsForEvent(e, startTs) {
      var endStr = (e.end_date || e.start_date || e.date || '').slice(0, 10);
      if (!endStr) return startTs ? startTs + 3 * 60 * 60 * 1000 : null;
      var endOfDay = new Date(endStr + 'T23:59:59').getTime();
      var threeHoursAfter = startTs ? startTs + 3 * 60 * 60 * 1000 : endOfDay;
      return threeHoursAfter < endOfDay ? threeHoursAfter : endOfDay;
    }

    function eventSeriesUpper(ev) {
      return String((ev && (ev._seriesId || ev.series_id)) || '').toUpperCase();
    }

    var weekEntries = [];
    allEvents.forEach(function (e) {
      var sid = e._seriesId || e.series_id;
      if (!sid) return;
      var dateStr = e.start_date || e.date;
      var timeStr = (e.time_msk && String(e.time_msk).match(/^\d{1,2}:\d{2}/)) ? e.time_msk : e.time_est;
      var tzOffset = (e.time_msk && String(e.time_msk).match(/^\d{1,2}:\d{2}/)) ? '+03:00' : null;
      var dt = parseEventDate(dateStr, timeStr, tzOffset);
      if (!dt) return;
      var ts = dt.getTime();
      if (ts >= windowStart && ts <= windowEnd) {
        var startTs = dt.getTime();
        var endTs = endTsForEvent(e, startTs);
        if (!endTs) endTs = startTs + 3 * 60 * 60 * 1000;
        // Показываем только события, которые ещё не завершились (старт или окно LIVE не прошло).
        if (endTs >= nowTs) {
          weekEntries.push({ event: e, date: dt, endTs: endTs });
        }
      }
    });

    // NOTE: Keep Next Race cards strictly within the 7‑day window.
    // (Previously we forced NASCAR Cup into the row even when it was >7 days away,
    // which caused "next week" cards to appear unexpectedly.)

    weekEntries.sort(function (a, b) { return a.date - b.date; });

    // Super Formula: один карточный уик-энд при двух гонках на той же трассе в соседние дни.
    // Сначала выделяем только SF и схлопываем среди себя — иначе между днями лезут карточки других серий.
    function collapseSuperFormulaNextRaceWeekEntries(sfEntriesSorted) {
      if (!Array.isArray(sfEntriesSorted) || sfEntriesSorted.length === 0) return sfEntriesSorted;
      var out = [];
      for (var i = 0; i < sfEntriesSorted.length; i++) {
        var entry = sfEntriesSorted[i];
        var e = entry.event;
        var run = [entry];
        var c0 = String(e.circuit_name || '').trim();
        var l0 = String(e.location || '').trim();
        var prevDate = (e.start_date || e.date || '').slice(0, 10);
        var j = i + 1;
        while (j < sfEntriesSorted.length) {
          var e2 = sfEntriesSorted[j].event;
          if (String(e2.circuit_name || '').trim() !== c0 || String(e2.location || '').trim() !== l0) break;
          var dn = (e2.start_date || e2.date || '').slice(0, 10);
          var diff = (new Date(dn + 'T12:00:00').getTime() - new Date(prevDate + 'T12:00:00').getTime()) / 86400000;
          if (diff !== 1) break;
          run.push(sfEntriesSorted[j]);
          prevDate = dn;
          j++;
        }
        if (run.length === 1) {
          out.push(entry);
        } else {
          var first = run[0];
          var last = run[run.length - 1];
          var fe = first.event;
          var le = last.event;
          var d0 = (fe.start_date || fe.date || '').slice(0, 10);
          var d1 = (le.start_date || le.date || '').slice(0, 10);
          var mergedEvent = Object.assign({}, fe, {
            start_date: d0,
            end_date: d1,
            date: d0,
            name: String(fe.circuit_name || fe.name || '').trim(),
            _seriesId: fe._seriesId || fe.series_id || 'SUPER_FORMULA',
            has_detail: false
          });
          out.push({ event: mergedEvent, date: first.date, endTs: last.endTs });
        }
        i = j - 1;
      }
      return out;
    }
    var sfWeek = [];
    var weekRest = [];
    weekEntries.forEach(function (ent) {
      if (eventSeriesUpper(ent.event) === 'SUPER_FORMULA') sfWeek.push(ent);
      else weekRest.push(ent);
    });
    sfWeek.sort(function (a, b) { return a.date - b.date; });
    weekEntries = weekRest.concat(collapseSuperFormulaNextRaceWeekEntries(sfWeek));
    weekEntries.sort(function (a, b) { return a.date - b.date; });

    if (weekEntries.length === 0) {
      container.innerHTML =
        '<div class="nrc-label">' + t('home.next_race') + '</div>' +
        '<div class="nrc-empty">' + t('home.no_upcoming') + '</div>';
      return;
    }

    function pad(n) { return n < 10 ? '0' + n : '' + n; }

    // Рендерим карточки и запускаем отсчёт сразу, не дожидаясь /api/live-events
    function renderWithLiveSet() {
      container.innerHTML =
        '<div class="nrc-label">' + t('home.next_race') + '</div>' +
        '<div class="nrc-cards">' +
        weekEntries.map(function (entry, idx) {
          var e = entry.event;
          var dateStr = (e.start_date || e.date || '').slice(0, 10);
          var endStr = (e.end_date || '').slice(0, 10);
          var formatDateRangeLong = window.TGA && window.TGA.formatDateRangeLong;
          var dateDisplay = (dateStr && endStr && dateStr !== endStr && formatDateRangeLong)
            ? formatDateRangeLong(e.start_date, e.end_date)
            : formatShortDate(dateStr);
          var name = e.name || '—';
          // Всегда убираем титульный спонсор "Java House" из названия этапа,
          // чтобы в UI показывался просто "Grand Prix of Arlington".
          if (name && name.indexOf('Java House') === 0) {
            name = name.replace(/^Java House\s+/i, '');
          }
          var eventSlug = (e.id || '').toLowerCase().replace(/_+/g, '-');
          var seriesSlug = (e._seriesId || e.series_id || '').toLowerCase().replace(/_+/g, '-');
          var href = e.has_detail
            ? '/event/' + encodeURIComponent(eventSlug)
            : '/series/' + encodeURIComponent(seriesSlug);
          var delayMs = idx * 55;
          // Дополнительные классы для фоновых картинок трасс.
          var extraClass = '';
          var circuitName = (e.circuit_name || '').toLowerCase();
          var location = (e.location || '').toLowerCase();
          var trackKey = circuitName || location;
          if (trackKey.indexOf('shanghai international circuit') >= 0) {
            extraClass += ' nrc-card--f1-2026-2';
          }
          if (trackKey.indexOf('las vegas motor speedway') >= 0) {
            extraClass += ' nrc-card--cup-2026-3';
          }
          if (trackKey.indexOf('phoenix raceway') >= 0) {
            // Один и тот же фон для всех серий на Phoenix.
            extraClass += ' nrc-card--phoenix';
          }
          if (trackKey.indexOf('darlington raceway') >= 0) {
            extraClass += ' nrc-card--darlington';
          }
          if (trackKey.indexOf('rockingham speedway') >= 0) {
            extraClass += ' nrc-card--rockingham';
          }
          if (trackKey.indexOf('martinsville speedway') >= 0) {
            extraClass += ' nrc-card--martinsville';
          }
          if (trackKey.indexOf('suzuka circuit') >= 0) {
            extraClass += ' nrc-card--suzuka';
          }
          if (trackKey.indexOf('barber motorsports park') >= 0) {
            extraClass += ' nrc-card--barber';
          }
          if (trackKey.indexOf('sebring international raceway') >= 0) {
            extraClass += ' nrc-card--sebring';
          }
          if (trackKey.indexOf('streets of arlington') >= 0) {
            extraClass += ' nrc-card--indycar-2026-3';
          }
          if (trackKey.indexOf('albert park circuit') >= 0) {
            extraClass += ' nrc-card--albert-park';
          }
          // Fallback по конкретным событиям (на случай старых/особых данных без circuit_name).
          if (!extraClass) {
            if (eventSlug === 'f1-2026-2') {
              extraClass += ' nrc-card--f1-2026-2';
            } else if (eventSlug === 'nascar-cup-2026-5' || eventSlug === 'cup-2026-5' || eventSlug === 'noaps-2026-5') {
              extraClass += ' nrc-card--cup-2026-3';
            } else if (eventSlug === 'indycar-2026-3') {
              extraClass += ' nrc-card--indycar-2026-3';
            }
          }
          return (
            '<a href="' + href + '" class="nrc-card nrc-card-enter' + extraClass + '" style="animation-delay: ' + delayMs + 'ms">' +
              '<div class="nrc-top">' + seriesBadge(e._seriesId || e.series_id || '') +
                '<span class="nrc-date">' + esc(dateDisplay) + '</span>' +
                '<span class="nrc-live" data-nrc-live="' + idx + '" aria-hidden="true">LIVE</span>' +
              '</div>' +
              '<div class="nrc-name">' + esc(name) + '</div>' +
              '<div class="nrc-timer" data-nrc="' + idx + '">—</div>' +
            '</a>'
          );
        }).join('') +
        '</div>';

      // Если название не влезает в карточку — уменьшаем шрифт только у этой карточки
      (function shrinkNameFontToFit() {
        function run() {
          var cardsWrap = container.querySelector('.nrc-cards');
          if (!cardsWrap) return;
          var cards = cardsWrap.querySelectorAll('.nrc-card');
          var minPx = 10;
          cards.forEach(function (card) {
            var nameEl = card.querySelector('.nrc-name');
            if (!nameEl) return;
            var style = nameEl.style;
            while (nameEl.scrollWidth > nameEl.clientWidth && nameEl.clientWidth > 0) {
              var current = parseFloat(window.getComputedStyle(nameEl).fontSize) || 16;
              if (current <= minPx) break;
              var next = Math.max(minPx, current - 2);
              style.fontSize = next + 'px';
            }
          });
        }
        if (typeof requestAnimationFrame !== 'undefined') {
          requestAnimationFrame(function () { requestAnimationFrame(run); });
        } else {
          run();
        }
      })();

      nrcCards = weekEntries.map(function (entry, idx) {
        var e = entry.event;
        return {
          el: container.querySelector('[data-nrc="' + idx + '"]'),
          liveEl: container.querySelector('[data-nrc-live="' + idx + '"]'),
          date: entry.date,
          endTs: entry.endTs,
          eventId: (e.id || '').toUpperCase()
        };
      });

      function tick() {
        var now2 = Date.now();
        nrcCards.forEach(function (c) {
          if (!c.el) return;
          var startTs = c.date.getTime();
          var fromApi = c.eventId && nrcLiveSet[c.eventId];
          var fromTime = now2 >= startTs && now2 <= c.endTs;
          var isLive = fromApi || fromTime;
          if (c.liveEl) {
            if (isLive) {
              c.liveEl.classList.add('nrc-live-visible');
              c.liveEl.setAttribute('aria-hidden', 'false');
            } else {
              c.liveEl.classList.remove('nrc-live-visible');
              c.liveEl.setAttribute('aria-hidden', 'true');
            }
          }
          if (isLive) {
            c.el.textContent = 'LIVE';
            return;
          }
          var diff = startTs - now2;
          if (diff <= 0) { c.el.textContent = '0' + window.TGA.t('cd.secs'); return; }
          var days  = Math.floor(diff / 86400000);
          var hours = Math.floor((diff % 86400000) / 3600000);
          var mins  = Math.floor((diff % 3600000)  / 60000);
          var secs  = Math.floor((diff % 60000)    / 1000);
          c.el.textContent = days > 0
            ? pad(days) + window.TGA.t('cd.days') + ' ' + pad(hours) + window.TGA.t('cd.hours') + ' ' + pad(mins) + window.TGA.t('cd.mins')
            : pad(hours) + ':' + pad(mins) + ':' + pad(secs);
        });
      }

      container.classList.remove('hidden');
      tick();
      nrcInterval = setInterval(tick, 1000);
    }

    renderWithLiveSet();
    var fetchJSON = window.TGA && window.TGA.fetchJSON;
    if (!fetchJSON) fetchJSON = function (url) { return fetch(url).then(function (r) { return r.json(); }); };
    fetchJSON('/api/live-events')
      .then(function (ids) {
        applyLiveIds(ids);
        nrcLiveRefresh = setInterval(function () {
          fetchJSON('/api/live-events').then(applyLiveIds).catch(function () {});
        }, 60000);
      })
      .catch(function () {});
  }

  window.TGA.renderNextRaceCards = renderNextRaceCards;
  window.TGA.stopNextRaceTimers = stopNextRaceTimers;
})();
