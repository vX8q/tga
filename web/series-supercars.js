// Supercars‑specific frontend logic (standings, specs, etc.)
// Загружается до основного /web/app.js и предоставляет расширения через window.TGA / window.tgaSeries.

window.TGA = window.TGA || {};
window.tgaSeries = window.tgaSeries || {};

window.tgaSeries.supercars = window.TGA.seriesSupercars = {
  // Статические Car Specs для Supercars (используются как фолбэк и для принудительной подстановки).
  carModels: [
    { manufacturer: 'Ford',      model: 'Mustang GT' },
    { manufacturer: 'Chevrolet', model: 'Camaro ZL1' },
    { manufacturer: 'Toyota',    model: 'GR Supra' }
  ],

  technicalSpec: [
    { key: 'Competition principle',         value: 'Technical parity' },
    { key: 'Drive layout',                  value: 'Front-engine, rear-wheel drive' },
    { key: 'Engine configuration',          value: 'Naturally aspirated V8' },
    { key: 'Power output',                  value: '~600 hp (≈447 kW)' },
    { key: 'Maximum torque',                value: '690 Nm' },
    { key: 'Body shell',                    value: 'Production-based RHD body, homologated' },
    { key: 'Body materials',                value: 'Steel body, composites/exotics restricted' },
    { key: 'Chassis',                       value: 'Standardised tubular steel frame' },
    { key: 'Aerodynamics',                  value: 'Homologated splitter & rear wing' },
    { key: 'Downforce level',               value: '~170 kg @ 200 km/h (2024+ aero spec)' },
    { key: 'Minimum weight',                value: '1,335 kg (with driver, no fuel)' },
    { key: 'Minimum front axle load',       value: '725 kg' },
    { key: 'Fuel',                          value: 'E75' },
    { key: 'Fuel tank capacity',            value: '~130 L' },
    { key: 'Transmission',                  value: '6-speed sequential transaxle' },
    { key: 'Differential',                  value: 'Spool (locked)' },
    { key: 'Clutch',                        value: 'Triple-plate' },
    { key: 'Front suspension',              value: 'Double wishbone' },
    { key: 'Rear suspension',               value: 'Independent' },
    { key: 'Dampers',                       value: 'Adjustable (not driver-adjustable)' },
    { key: 'Brakes (front)',                value: '395 mm discs, 6-piston calipers' },
    { key: 'Brakes (rear)',                 value: '355 mm discs, 4-piston calipers' },
    { key: 'Wheels',                        value: '18-inch control wheels' },
    { key: 'Tyres',                         value: 'Dunlop (Soft / Supersoft / Hard / Wet)' },
    { key: 'ECU',                           value: 'MoTeC (control)' },
    { key: 'Engine allocation',             value: 'Single builder per model' },
    { key: 'Engines per season',            value: 'Max 2 new engines per car' },
    { key: 'Top speed (historical max)',    value: '300.5 km/h' },
    { key: 'Expected 2026 top speed',       value: '≈290 km/h' },
    { key: 'Relative performance',          value: 'Comparable to Porsche 992 GT3 Cup' },
    { key: 'Target build cost (no engine)', value: '~AUD 250,000' },
    { key: 'Estimated season cost',         value: 'AUD 1.2–3.0 million per car (staff, logistics, tyres, fuel, spares, race ops)' }
  ],

  engines: [
    { model: 'Ford Mustang GT',      spec: '5.4L V8, DOHC, 4 valves per cylinder' },
    { model: 'Chevrolet Camaro ZL1', spec: '5.7L V8, single camshaft, 2 valves per cylinder' },
    { model: 'Toyota GR Supra',      spec: '5.2L V8, DOHC, 4 valves per cylinder' }
  ],

  homologation: [
    { manufacturer: 'Chevrolet', team: 'Triple Eight Race Engineering' },
    { manufacturer: 'Ford',      team: 'Dick Johnson Racing' },
    { manufacturer: 'Toyota',    team: 'Walkinshaw Andretti United' }
  ],

  // Собираем драйверский рейтинг Supercars по гонкам события Sydney 500 (Race 1–3)
  buildStandingsFromEvents: function () {
    var driverDisplayName =
      (window.TGA && window.TGA.driverDisplayName) ||
      function (name) { return name; };

    var eventId = 'SUPERCARS_2026_1';
    var seriesKey = 'supercars';

    var fetchJSON = window.TGA && window.TGA.fetchJSON;
    if (!fetchJSON) fetchJSON = function (url) { return fetch(url).then(function (r) { return r.json(); }); };
    function fetchSupercarsTeamManufacturers() {
      return fetchJSON('/api/series/' + encodeURIComponent(seriesKey.toLowerCase()) + '/teams')
        .catch(function () { return {}; })
        .then(function (data) {
          var teams = data && data.teams ? data.teams : (Array.isArray(data) ? data : []);
          var manufacturerByTeam = {};
          var teamByNumber = {};
          var teamByDriver = {};
          teams.forEach(function (tm) {
            if (!tm) return;
            var teamName = String(tm.team || '').trim();
            var man = String(tm.manufacturer || '').trim();
            var num = String(tm.number || tm.Number || '').trim();
            var drv = String(tm.driver || tm.Driver || '').trim();
            if (teamName && !manufacturerByTeam[teamName]) manufacturerByTeam[teamName] = man;
            if (num) {
              if (!teamByNumber[num]) teamByNumber[num] = teamName;
              var n = parseInt(num, 10);
              if (!isNaN(n)) {
                var nStr = String(n);
                if (!teamByNumber[nStr]) teamByNumber[nStr] = teamName;
                if (n >= 1 && n <= 9) {
                  var z = '0' + n;
                  if (!teamByNumber[z]) teamByNumber[z] = teamName;
                }
              }
            }
            if (drv) {
              var drvNorm = driverDisplayName(drv);
              if (drvNorm && !teamByDriver[drvNorm]) {
                teamByDriver[drvNorm] = teamName;
              }
            }
          });
          return { manufacturerByTeam: manufacturerByTeam, teamByNumber: teamByNumber, teamByDriver: teamByDriver };
        })
        .catch(function () { return {}; });
    }

    return fetchSupercarsTeamManufacturers().then(function (teamInfo) {
      var manufacturerByTeam = teamInfo && teamInfo.manufacturerByTeam ? teamInfo.manufacturerByTeam : {};
      var teamByNumber = teamInfo && teamInfo.teamByNumber ? teamInfo.teamByNumber : {};
      var teamByDriver = teamInfo && teamInfo.teamByDriver ? teamInfo.teamByDriver : {};

      return fetchJSON('/api/events/' + encodeURIComponent(eventId.toLowerCase()))
        .then(function (d) {
          if (!d || typeof d !== 'object') return { rows: [] };
          if (d.data && typeof d.data === 'object') d = d.data;
          if (d.event && typeof d.event === 'object') d = d.event;
          if (Array.isArray(d) && d.length > 0) d = d[0];

          var races = (d.tables && d.tables.race && Array.isArray(d.tables.race.sessions))
            ? d.tables.race.sessions
            : [];

          var raceCodes = [];
          var raceRowsByCode = {};
          for (var i = 0; i < races.length; i++) {
            // Колонки SMP1/SMP2/SMP3 → в заголовке будут отображаться как "SMP"
            var code = 'SMP' + (i + 1);
            raceCodes.push(code);
            raceRowsByCode[code] = races[i].rows || [];
          }

          var byDriver = {};
          raceCodes.forEach(function (code) {
            var rows = raceRowsByCode[code] || [];
            rows.forEach(function (row) {
              var pos = String(row[0] || '').trim();
              var no  = String(row[1] || '').trim();
              var drv = String(row[2] || '').trim();
              var team = String(row[3] || '').trim();
              // Нормализуем название команды по Teams / Entry List (источник истины)
              if (teamByNumber[no]) {
                team = teamByNumber[no];
              } else {
                var drvNorm = driverDisplayName(drv);
                if (drvNorm && teamByDriver[drvNorm]) {
                  team = teamByDriver[drvNorm];
                }
              }
              var pts  = parseInt(String(row[7] || '0').replace('+', ''), 10) || 0;
              if (!drv) return;
              var key = drv + '|' + no;
              if (!byDriver[key]) {
                byDriver[key] = {
                  pos: 0,
                  car: no,
                  driver: drv,
                  team: team,
                  manufacturer: manufacturerByTeam[team] || '',
                  races: {},
                  points: 0,
                  stages: '',
                  wth: '',
                  status: ''
                };
              }
              if (pos) byDriver[key].races[code] = pos;
              byDriver[key].points += pts;
            });
          });

          var rows = Object.keys(byDriver).map(function (k) { return byDriver[k]; });
          rows.sort(function (a, b) { return b.points - a.points; });
          rows.forEach(function (r, idx) { r.pos = idx + 1; });

          return {
            race_order: raceCodes,
            completed_races: raceCodes.slice(),
            rows: rows,
            ineligible: []
          };
        });
    });
  }
};

