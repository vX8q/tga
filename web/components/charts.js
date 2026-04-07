// Lightweight charts for driver stats dashboard (uses global Chart from CDN).
(function () {
  if (typeof window === 'undefined') return;
  window.TGACharts = window.TGACharts || {};

  var driverResultsChart = null;
  var driverQualFinishChart = null;
  var driverPagePointsChart = null;
  var driverPageFinishChart = null;
  var h2hPointsChart = null;
  var h2hQualFinishChart = null;

  function safeNumber(v) {
    if (v == null || v === '' || isNaN(v)) return null;
    var n = typeof v === 'number' ? v : parseFloat(String(v));
    return isFinite(n) ? n : null;
  }

  function destroyCharts() {
    if (driverResultsChart) {
      driverResultsChart.destroy();
      driverResultsChart = null;
    }
    if (driverQualFinishChart) {
      driverQualFinishChart.destroy();
      driverQualFinishChart = null;
    }
  }

  function destroyHeadToHeadCharts() {
    if (h2hPointsChart) {
      h2hPointsChart.destroy();
      h2hPointsChart = null;
    }
    if (h2hQualFinishChart) {
      h2hQualFinishChart.destroy();
      h2hQualFinishChart = null;
    }
  }

  function ensureDashboardVisible() {
    var wrap = document.getElementById('driver-stats-dashboard');
    if (wrap) {
      wrap.classList.remove('hidden');
    }
  }

  function updateDriverDashboard(row, seriesKey, globalAvg) {
    if (!row || typeof Chart === 'undefined') return;
    ensureDashboardVisible();

    var titleEl = document.getElementById('driver-stats-dashboard-title');
    if (titleEl) {
      var label = row.driver || row.team || row.manufacturer || '';
      var races = safeNumber(row.races) || 0;
      titleEl.textContent = label ? (label + ' — ' + races + ' starts') : 'Driver analytics';
    }

    destroyCharts();

    var resultsCtx = document.getElementById('driver-results-chart');
    if (resultsCtx) {
      var dataWins = safeNumber(row.wins) || 0;
      var dataTop5 = safeNumber(row.top5) || 0;
      var dataTop10 = safeNumber(row.top10) || 0;
      var dataTop15 = safeNumber(row.top15) || 0;
      var dataTop20 = safeNumber(row.top20) || 0;
      var dataRaces = safeNumber(row.races) || 0;

      var labels = ['Wins', 'Top 5', 'Top 10', 'Top 15', 'Top 20'];
      var values = [dataWins, dataTop5, dataTop10, dataTop15, dataTop20];

      driverResultsChart = new Chart(resultsCtx.getContext('2d'), {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{
            label: 'Finishes',
            data: values,
            backgroundColor: 'rgba(225,6,0,0.6)',
            borderColor: 'rgba(225,6,0,1)',
            borderWidth: 1
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              ticks: { color: '#aaa', font: { size: 11 } }
            },
            y: {
              beginAtZero: true,
              ticks: { color: '#aaa', stepSize: 1 }
            }
          },
          plugins: {
            legend: { display: false }
          }
        }
      });
    }

    var qualFinishCtx = document.getElementById('driver-qual-finish-chart');
    if (qualFinishCtx) {
      var avgStart = safeNumber(row.avg_start);
      var avgFinish = safeNumber(row.avg_finish);
      if (avgStart != null && avgFinish != null) {
        driverQualFinishChart = new Chart(qualFinishCtx.getContext('2d'), {
          type: 'scatter',
          data: {
            datasets: [{
              label: 'Driver',
              data: [{ x: avgStart, y: avgFinish }],
              backgroundColor: 'rgba(110,168,254,0.9)',
              pointRadius: 5
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              x: {
                title: { display: true, text: 'Avg. Start' },
                reverse: false,
                ticks: { color: '#aaa' }
              },
              y: {
                title: { display: true, text: 'Avg. Finish (lower is better)' },
                reverse: true,
                ticks: { color: '#aaa' }
              }
            },
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: function (ctx) {
                    return 'Start ' + ctx.raw.x.toFixed(2) + ', Finish ' + ctx.raw.y.toFixed(2);
                  }
                }
              }
            }
          }
        });
      }
    }

    var summaryEl = document.getElementById('driver-consistency-summary');
    if (summaryEl) {
      var races = safeNumber(row.races) || 0;
      var wins = safeNumber(row.wins) || 0;
      var poles = safeNumber(row.poles) || 0;
      var top5 = safeNumber(row.top5) || 0;
      var top10 = safeNumber(row.top10) || 0;
      var avgStartNum = safeNumber(row.avg_start);
      var avgFinishNum = safeNumber(row.avg_finish);
      var posDiffNum = safeNumber(row.pos_diff);
      var lapsPctNum = safeNumber(row.laps_completed_pct);

      var g = globalAvg || {};
      var gStarts = safeNumber(g.avgRaces);
      var gWins = safeNumber(g.avgWins);
      var gPoles = safeNumber(g.avgPoles);
      var gTop5 = safeNumber(g.avgTop5);
      var gTop10 = safeNumber(g.avgTop10);
      var gAvgStart = safeNumber(g.avgStart);
      var gAvgFinish = safeNumber(g.avgFinish);
      var gPosDiff = safeNumber(g.avgPosDiff);
      var gLapsPct = safeNumber(g.avgLapsPct);

      function fmt(v, digits) {
        if (v == null) return '—';
        return typeof digits === 'number' ? v.toFixed(digits) : String(v);
      }

      summaryEl.innerHTML =
        '<ul class="stats-summary-list">' +
          '<li><strong>Starts:</strong> ' + races +
            (gStarts != null ? ' (avg ' + fmt(gStarts, 1) + ')' : '') +
            ', <strong>Wins:</strong> ' + wins +
            (gWins != null ? ' (avg ' + fmt(gWins, 2) + ')' : '') +
            ', <strong>Poles:</strong> ' + poles +
            (gPoles != null ? ' (avg ' + fmt(gPoles, 2) + ')' : '') +
          '</li>' +
          '<li><strong>Top 5:</strong> ' + top5 +
            (gTop5 != null ? ' (avg ' + fmt(gTop5, 2) + ')' : '') +
            ', <strong>Top 10:</strong> ' + top10 +
            (gTop10 != null ? ' (avg ' + fmt(gTop10, 2) + ')' : '') +
          '</li>' +
          '<li><strong>Avg. start → finish:</strong> ' + fmt(avgStartNum, 2) + ' → ' + fmt(avgFinishNum, 2) +
            (gAvgStart != null && gAvgFinish != null
              ? ' (avg ' + fmt(gAvgStart, 2) + ' → ' + fmt(gAvgFinish, 2) + ')'
              : '') +
          '</li>' +
          '<li><strong>Avg. pos. change:</strong> ' + (posDiffNum != null ? fmt(posDiffNum, 1) : '—') +
            (gPosDiff != null ? ' (avg ' + fmt(gPosDiff, 2) + ')' : '') +
          '</li>' +
          '<li><strong>Laps completed:</strong> ' + (lapsPctNum != null ? fmt(lapsPctNum, 1) + '%' : '—') +
            (gLapsPct != null ? ' (avg ' + fmt(gLapsPct, 1) + '%)' : '') +
          '</li>' +
        '</ul>';
    }
  }

  function updateHeadToHead(data, driverA, driverB) {
    if (typeof Chart === 'undefined') return;
    var wrap = document.getElementById('h2h-dashboard');
    if (wrap) wrap.classList.remove('hidden');

    destroyHeadToHeadCharts();

    var events = (data && data.events && Array.isArray(data.events)) ? data.events : [];
    var hasData = events.length > 0;
    var emptyEl = document.getElementById('h2h-empty');
    if (emptyEl) {
      emptyEl.classList.toggle('hidden', hasData);
    }
    if (!hasData) return;

    var labels = events.map(function (e) { return e.label || e.event || ''; });
    var ptsA = events.map(function (e) { return safeNumber(e.pointsA) || 0; });
    var ptsB = events.map(function (e) { return safeNumber(e.pointsB) || 0; });

    var pointsCtx = document.getElementById('h2h-points-chart');
    if (pointsCtx) {
      h2hPointsChart = new Chart(pointsCtx.getContext('2d'), {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            {
              label: driverA || 'A',
              data: ptsA,
              backgroundColor: 'rgba(225,6,0,0.7)'
            },
            {
              label: driverB || 'B',
              data: ptsB,
              backgroundColor: 'rgba(110,168,254,0.8)'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { ticks: { color: '#aaa', autoSkip: true, maxRotation: 45, minRotation: 0 } },
            y: { beginAtZero: true, ticks: { color: '#aaa' }, title: { display: true, text: 'Points' } }
          }
        }
      });
    }

    var qualFinishCtx = document.getElementById('h2h-qual-finish-chart');
    if (qualFinishCtx) {
      var dataA = [];
      var dataB = [];
      events.forEach(function (e) {
        var qa = safeNumber(e.qualiA);
        var fa = safeNumber(e.finishA);
        var qb = safeNumber(e.qualiB);
        var fb = safeNumber(e.finishB);
        if (qa != null && fa != null) {
          dataA.push({ x: qa, y: fa, label: e.label || '' });
        }
        if (qb != null && fb != null) {
          dataB.push({ x: qb, y: fb, label: e.label || '' });
        }
      });
      h2hQualFinishChart = new Chart(qualFinishCtx.getContext('2d'), {
        type: 'scatter',
        data: {
          datasets: [
            {
              label: driverA || 'A',
              data: dataA,
              backgroundColor: 'rgba(225,6,0,0.9)'
            },
            {
              label: driverB || 'B',
              data: dataB,
              backgroundColor: 'rgba(110,168,254,0.9)'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              title: { display: true, text: 'Qualifying position' },
              reverse: false,
              ticks: { color: '#aaa' }
            },
            y: {
              title: { display: true, text: 'Finish position (lower is better)' },
              reverse: true,
              ticks: { color: '#aaa' }
            }
          },
          plugins: {
            tooltip: {
              callbacks: {
                label: function (ctx) {
                  var l = ctx.raw && ctx.raw.label ? ctx.raw.label + ': ' : '';
                  return l + 'Q ' + ctx.raw.x + ', F ' + ctx.raw.y;
                }
              }
            }
          }
        }
      });
    }
  }

  function destroyDriverPageCharts() {
    if (driverPagePointsChart) {
      driverPagePointsChart.destroy();
      driverPagePointsChart = null;
    }
    if (driverPageFinishChart) {
      driverPageFinishChart.destroy();
      driverPageFinishChart = null;
    }
  }

  function updateDriverPageDashboard(payload) {
    if (!payload || typeof Chart === 'undefined') return;
    var results = Array.isArray(payload.results) ? payload.results : [];
    var wrap = document.getElementById('driver-page-dashboard');
    if (!results.length || !wrap) {
      if (wrap) wrap.classList.add('hidden');
      destroyDriverPageCharts();
      return;
    }
    wrap.classList.remove('hidden');

    destroyDriverPageCharts();

    var labels = results.map(function (r, idx) {
      if (r.race_name) return r.race_name;
      if (r.event_name) return r.event_name;
      return 'Race ' + (idx + 1);
    });
    var points = results.map(function (r) {
      var n = safeNumber(r.points);
      return n != null ? n : 0;
    });
    var finishes = results.map(function (r) {
      var n = safeNumber(r.position);
      return n != null && n > 0 ? n : null;
    });

    var ptsCtx = document.getElementById('driver-page-points-chart');
    if (ptsCtx) {
      driverPagePointsChart = new Chart(ptsCtx.getContext('2d'), {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: 'Points',
            data: points,
            borderColor: 'rgba(225,6,0,0.9)',
            backgroundColor: 'rgba(225,6,0,0.1)',
            borderWidth: 2,
            tension: 0.35,
            pointRadius: 3,
            pointBackgroundColor: 'rgba(225,6,0,1)'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          },
          scales: {
            x: {
              ticks: { color: '#aaa', autoSkip: true, maxRotation: 45, minRotation: 0 }
            },
            y: {
              beginAtZero: true,
              ticks: { color: '#aaa' },
              title: { display: true, text: 'Points' }
            }
          }
        }
      });
    }

    var finCtx = document.getElementById('driver-page-finish-chart');
    if (finCtx) {
      driverPageFinishChart = new Chart(finCtx.getContext('2d'), {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: 'Finish',
            data: finishes,
            borderColor: 'rgba(110,168,254,0.9)',
            backgroundColor: 'rgba(110,168,254,0.1)',
            borderWidth: 2,
            tension: 0.35,
            pointRadius: 3,
            spanGaps: true,
            pointBackgroundColor: 'rgba(110,168,254,1)'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          },
          scales: {
            x: {
              ticks: { color: '#aaa', autoSkip: true, maxRotation: 45, minRotation: 0 }
            },
            y: {
              reverse: true,
              ticks: { color: '#aaa', precision: 0 },
              title: { display: true, text: 'Finish position (lower is better)' }
            }
          }
        }
      });
    }
  }

  window.TGACharts.updateDriverDashboard = updateDriverDashboard;
  window.TGACharts.updateHeadToHead = updateHeadToHead;
  window.TGACharts.updateDriverPageDashboard = updateDriverPageDashboard;
})();

