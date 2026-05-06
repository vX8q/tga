// tga-series.js — Series detail page: schedule, standings, teams, specs, stats, history.
// Depends: tga-config.js, tga-i18n.js, tga-utils.js, fetch-json.js (window.TGA.*). Load before app.js.

(function () {
  'use strict';
  window.TGA = window.TGA || {};

  var state = window.TGA._state;
  var fetchJSON = window.TGA.fetchJSON;
  var logger = window.TGA.logger;
  var t = function (k) { return window.TGA.t(k); };
  var getLang = function () { return window.TGA.getLang(); };
  var esc = function (s) { return window.TGA.esc(s); };
  var dash = function (v) { return window.TGA.dash(v); };
  var isSeriesId = function (id, name) { return window.TGA.isSeriesId(id, name); };
  var driverDisplayName = function (n) { return window.TGA.driverDisplayName(n); };
  var addObjectTableSort = function (a, b, c, d, e) { return window.TGA.addObjectTableSort(a, b, c, d, e); };
  var trimTrailingZeros = function (s) { return window.TGA.trimTrailingZeros(s); };
  var specKeySkip = window.TGA.specKeySkip;
  var normalizeSpecKey = function (k) { return window.TGA.normalizeSpecKey(k); };
  var localizeSpecKey = function (k) { return window.TGA.localizeSpecKey(k); };
  var localizeSpecValue = function (v) { return window.TGA.localizeSpecValue(v); };
  var formatTimeForDisplay = function (r) { return window.TGA.formatTimeForDisplay(r); };
  var getTimeSettings = function () { return window.TGA.getTimeSettings(); };
  var parseTimeStringToParts = function (s) { return window.TGA.parseTimeStringToParts(s); };
  var formatDateRange = function (a, b) { return window.TGA.formatDateRange(a, b); };
  var formatDateRangeLong = function (a, b) { return window.TGA.formatDateRangeLong ? window.TGA.formatDateRangeLong(a, b) : (window.TGA.formatDateRange ? window.TGA.formatDateRange(a, b) : (a || '')); };
  var formatShortDate = function (s) { return window.TGA.formatShortDate ? window.TGA.formatShortDate(s) : (s || '').slice(0, 10); };
  var getScheduleTimeLabel = function (e, seriesId) { return (window.TGA.getScheduleTimeLabel && window.TGA.getScheduleTimeLabel(e, seriesId)) || (e.time_est || e.time_msk || '—'); };
  var countryHtml = function (c) { return window.TGA.countryHtml(c); };
  var syncStandingsScrollBars = function () { return window.TGA.syncStandingsScrollBars(); };
  var categoryBySeriesId = window.TGA.categoryBySeriesId;
  var renderSupercarsStaticSpecs = function () { return window.TGA.renderSupercarsStaticSpecs(); };
  var adjustDetailPanelPadding = function () { return window.TGA.adjustDetailPanelPadding(); };
  var adjustSeasonPanelPadding = function () { return window.TGA.adjustSeasonPanelPadding(); };

  function showView(id) {
    if (window.TGA.showView) window.TGA.showView(id);
  }
  function slugify(s) {
    return window.TGA.slugify ? window.TGA.slugify(s) : (s != null ? String(s).toLowerCase().replace(/[^a-z0-9\u0400-\u04ff]+/g, '-').replace(/^-+|-+$/g, '') : '');
  }
  function seriesIdToSlug(id) {
    return window.TGA.seriesIdToSlug ? window.TGA.seriesIdToSlug(id) : (id != null ? slugify(String(id).replace(/_/g, ' ')) : '');
  }

  var rebuildNascarCupDayFromDaytona = function (d) {
    return window.TGA.rebuildNascarCupDayFromDaytona ? window.TGA.rebuildNascarCupDayFromDaytona(d) : Promise.resolve(d);
  };

  // ─── F1 static data (keyed by season year where applicable) ─────────────────
  var F1_DRIVER_CHAMPIONS = {
    '1950': 'Giuseppe Farina', '1951': 'Juan Manuel Fangio', '1952': 'Alberto Ascari', '1953': 'Alberto Ascari',
    '1954': 'Juan Manuel Fangio', '1955': 'Juan Manuel Fangio', '1956': 'Juan Manuel Fangio', '1957': 'Juan Manuel Fangio',
    '1958': 'Mike Hawthorn', '1959': 'Jack Brabham', '1960': 'Jack Brabham', '1961': 'Phil Hill', '1962': 'Graham Hill',
    '1963': 'Jim Clark', '1964': 'John Surtees', '1965': 'Jim Clark', '1966': 'Jack Brabham', '1967': 'Denny Hulme',
    '1968': 'Graham Hill', '1969': 'Jackie Stewart', '1970': 'Jochen Rindt', '1971': 'Jackie Stewart', '1972': 'Emerson Fittipaldi',
    '1973': 'Jackie Stewart', '1974': 'Emerson Fittipaldi', '1975': 'Niki Lauda', '1976': 'James Hunt', '1977': 'Niki Lauda',
    '1978': 'Mario Andretti', '1979': 'Jody Scheckter', '1980': 'Alan Jones', '1981': 'Nelson Piquet', '1982': 'Keke Rosberg',
    '1983': 'Nelson Piquet', '1984': 'Niki Lauda', '1985': 'Alain Prost', '1986': 'Alain Prost', '1987': 'Nelson Piquet',
    '1988': 'Ayrton Senna', '1989': 'Alain Prost', '1990': 'Ayrton Senna', '1991': 'Ayrton Senna', '1992': 'Nigel Mansell',
    '1993': 'Alain Prost', '1994': 'Michael Schumacher', '1995': 'Michael Schumacher', '1996': 'Damon Hill',
    '1997': 'Jacques Villeneuve', '1998': 'Mika Häkkinen', '1999': 'Mika Häkkinen', '2000': 'Michael Schumacher',
    '2001': 'Michael Schumacher', '2002': 'Michael Schumacher', '2003': 'Michael Schumacher', '2004': 'Michael Schumacher',
    '2005': 'Fernando Alonso', '2006': 'Fernando Alonso', '2007': 'Kimi Räikkönen', '2008': 'Lewis Hamilton',
    '2009': 'Jenson Button', '2010': 'Sebastian Vettel', '2011': 'Sebastian Vettel', '2012': 'Sebastian Vettel',
    '2013': 'Sebastian Vettel', '2014': 'Lewis Hamilton', '2015': 'Lewis Hamilton', '2016': 'Nico Rosberg',
    '2017': 'Lewis Hamilton', '2018': 'Lewis Hamilton', '2019': 'Lewis Hamilton', '2020': 'Lewis Hamilton',
    '2021': 'Max Verstappen', '2022': 'Max Verstappen', '2023': 'Max Verstappen', '2024': 'Max Verstappen', '2025': 'Lando Norris'
  };
  var F1_DRIVER_POINTS = {
    '1950': 30, '1951': 31, '1952': 36, '1953': 34, '1954': 42, '1955': 40, '1956': 30, '1957': 40, '1958': 42, '1959': 31,
    '1960': 43, '1961': 34, '1962': 42, '1963': 54, '1964': 40, '1965': 54, '1966': 42, '1967': 51, '1968': 48, '1969': 63,
    '1970': 45, '1971': 62, '1972': 61, '1973': 71, '1974': 55, '1975': 64, '1976': 69, '1977': 72, '1978': 64, '1979': 51,
    '1980': 67, '1981': 50, '1982': 44, '1983': 59, '1984': 72, '1985': 73, '1986': 72, '1987': 73, '1988': 94, '1989': 76,
    '1990': 78, '1991': 96, '1992': 108, '1993': 99, '1994': 92, '1995': 102, '1996': 97, '1997': 81, '1998': 100, '1999': 76,
    '2000': 108, '2001': 123, '2002': 144, '2003': 93, '2004': 148, '2005': 133, '2006': 134, '2007': 110, '2008': 98, '2009': 95,
    '2010': 256, '2011': 392, '2012': 281, '2013': 397, '2014': 384, '2015': 381, '2016': 385, '2017': 363, '2018': 408, '2019': 413,
    '2020': 347, '2021': 395, '2022': 454, '2023': 575, '2024': 437, '2025': 423
  };
  var F1_RACES_PER_SEASON = {
    '1950': 7, '1951': 8, '1952': 8, '1953': 9, '1954': 9, '1955': 7, '1956': 8, '1957': 8, '1958': 11, '1959': 9,
    '1960': 10, '1961': 8, '1962': 9, '1963': 10, '1964': 10, '1965': 10, '1966': 9, '1967': 11, '1968': 12, '1969': 11,
    '1970': 13, '1971': 11, '1972': 12, '1973': 15, '1974': 15, '1975': 14, '1976': 16, '1977': 17, '1978': 16, '1979': 15,
    '1980': 14, '1981': 15, '1982': 16, '1983': 15, '1984': 16, '1985': 16, '1986': 16, '1987': 16, '1988': 16, '1989': 16,
    '1990': 16, '1991': 16, '1992': 16, '1993': 16, '1994': 16, '1995': 17, '1996': 16, '1997': 17, '1998': 16, '1999': 16,
    '2000': 17, '2001': 17, '2002': 17, '2003': 16, '2004': 18, '2005': 19, '2006': 18, '2007': 17, '2008': 18, '2009': 17,
    '2010': 19, '2011': 19, '2012': 20, '2013': 19, '2014': 19, '2015': 19, '2016': 21, '2017': 20, '2018': 21, '2019': 21,
    '2020': 17, '2021': 22, '2022': 22, '2023': 22, '2024': 24, '2025': 24
  };
  var F1_CONSTRUCTOR_CHAMPIONS = {
    '1958': 'Vanwall', '1959': 'Cooper', '1960': 'Cooper', '1961': 'Ferrari', '1962': 'BRM', '1963': 'Lotus', '1964': 'Ferrari',
    '1965': 'Lotus', '1966': 'Brabham', '1967': 'Brabham', '1968': 'Lotus', '1969': 'Matra', '1970': 'Lotus', '1971': 'Tyrrell',
    '1972': 'Lotus', '1973': 'Lotus', '1974': 'McLaren', '1975': 'Ferrari', '1976': 'Ferrari', '1977': 'Ferrari', '1978': 'Lotus',
    '1979': 'Ferrari', '1980': 'Williams', '1981': 'Williams', '1982': 'Ferrari', '1983': 'Ferrari', '1984': 'McLaren', '1985': 'McLaren',
    '1986': 'Williams', '1987': 'Williams', '1988': 'McLaren', '1989': 'McLaren', '1990': 'McLaren', '1991': 'McLaren', '1992': 'Williams',
    '1993': 'Williams', '1994': 'Williams', '1995': 'Benetton', '1996': 'Williams', '1997': 'Williams', '1998': 'McLaren', '1999': 'Ferrari',
    '2000': 'Ferrari', '2001': 'Ferrari', '2002': 'Ferrari', '2003': 'Ferrari', '2004': 'Ferrari', '2005': 'Renault', '2006': 'Renault',
    '2007': 'Ferrari', '2008': 'Ferrari', '2009': 'Brawn GP', '2010': 'Red Bull', '2011': 'Red Bull', '2012': 'Red Bull', '2013': 'Red Bull',
    '2014': 'Mercedes', '2015': 'Mercedes', '2016': 'Mercedes', '2017': 'Mercedes', '2018': 'Mercedes', '2019': 'Mercedes', '2020': 'Mercedes',
    '2021': 'Mercedes', '2022': 'Red Bull', '2023': 'Red Bull', '2024': 'McLaren', '2025': 'McLaren'
  };
  var F1_CONSTRUCTOR_POINTS = {
    '1958': 48, '1959': 40, '1960': 48, '1961': 45, '1962': 42, '1963': 54, '1964': 45, '1965': 54, '1966': 42, '1967': 63,
    '1968': 62, '1969': 66, '1970': 59, '1971': 73, '1972': 61, '1973': 92, '1974': 73, '1975': 72, '1976': 83, '1977': 95,
    '1978': 86, '1979': 113, '1980': 120, '1981': 95, '1982': 74, '1983': 89, '1984': 143, '1985': 90, '1986': 141, '1987': 137,
    '1988': 199, '1989': 141, '1990': 121, '1991': 139, '1992': 164, '1993': 168, '1994': 118, '1995': 137, '1996': 175, '1997': 123,
    '1998': 156, '1999': 128, '2000': 170, '2001': 179, '2002': 221, '2003': 158, '2004': 262, '2005': 191, '2006': 206, '2007': 204,
    '2008': 172, '2009': 172, '2010': 498, '2011': 650, '2012': 460, '2013': 596, '2014': 701, '2015': 703, '2016': 765, '2017': 668,
    '2018': 655, '2019': 739, '2020': 573, '2021': 613, '2022': 759, '2023': 860, '2024': 666, '2025': 833
  };
  var F1_CHASSIS_ENGINE = {
    '1950': { team: 'Alfa Romeo', chassis: 'Alfa Romeo 158', engine: 'Alfa Romeo 158 1.5 L8 s' },
    '1951': { team: 'Alfa Romeo', chassis: 'Alfa Romeo 159', engine: 'Alfa Romeo 158 1.5 L8 s' },
    '1952': { team: 'Ferrari', chassis: '500', engine: 'Ferrari 500 2.0 L4' },
    '1953': { team: 'Ferrari', chassis: '500', engine: 'Ferrari 500 2.0 L4' },
    '1954': { team: 'Mercedes', chassis: 'W196', engine: 'Mercedes M196 2.5 L8' },
    '1955': { team: 'Mercedes', chassis: 'W196', engine: 'Mercedes M196 2.5 L8' },
    '1956': { team: 'Ferrari', chassis: 'D50', engine: 'Ferrari DS50 2.5 V8' },
    '1957': { team: 'Maserati', chassis: '250F', engine: 'Maserati 250F1 2.5 L6' },
    '1958': { team: 'Ferrari', chassis: '246', engine: 'Ferrari 143 2.4 V6' },
    '1959': { team: 'Cooper', chassis: 'T51', engine: 'Climax FPF 2.5 L4' },
    '1960': { team: 'Cooper', chassis: 'T53', engine: 'Climax FPF 2.5 L4' },
    '1961': { team: 'Ferrari', chassis: '156', engine: 'Ferrari 178 1.5 V6' },
    '1962': { team: 'BRM', chassis: 'P57', engine: 'BRM P56 1.5 V8' },
    '1963': { team: 'Lotus', chassis: '25', engine: 'Climax FWMV 1.5 V8' },
    '1964': { team: 'Ferrari', chassis: '158', engine: 'Ferrari 205B 1.5 V8' },
    '1965': { team: 'Lotus', chassis: '33', engine: 'Climax FWMV 1.5 V8' },
    '1966': { team: 'Brabham', chassis: 'BT20', engine: 'Repco 620 3.0 V8' },
    '1967': { team: 'Brabham', chassis: 'BT24', engine: 'Repco 740 3.0 V8' },
    '1968': { team: 'Lotus', chassis: '49B', engine: 'Ford Cosworth DFV 3.0 V8' },
    '1969': { team: 'Matra', chassis: 'MS80', engine: 'Ford Cosworth DFV 3.0 V8' },
    '1970': { team: 'Lotus', chassis: '72C', engine: 'Ford Cosworth DFV 3.0 V8' },
    '1971': { team: 'Tyrrell', chassis: '003', engine: 'Ford Cosworth DFV 3.0 V8' },
    '1972': { team: 'Lotus', chassis: '72D', engine: 'Ford Cosworth DFV 3.0 V8' },
    '1973': { team: 'Tyrrell', chassis: '006', engine: 'Ford Cosworth DFV 3.0 V8' },
    '1974': { team: 'McLaren', chassis: 'M23B', engine: 'Ford Cosworth DFV 3.0 V8' },
    '1975': { team: 'Ferrari', chassis: '312T', engine: 'Ferrari 015 3.0 F12' },
    '1976': { team: 'McLaren', chassis: 'M23D', engine: 'Ford Cosworth DFV 3.0 V8' },
    '1977': { team: 'Ferrari', chassis: '312T2B', engine: 'Ferrari 015 3.0 F12' },
    '1978': { team: 'Lotus', chassis: '79', engine: 'Ford Cosworth DFV 3.0 V8' },
    '1979': { team: 'Ferrari', chassis: '312T4B', engine: 'Ferrari 015 3.0 F12' },
    '1980': { team: 'Williams', chassis: 'FW07B', engine: 'Ford Cosworth DFV 3.0 V8' },
    '1981': { team: 'Brabham', chassis: 'BT49C', engine: 'Ford Cosworth DFV 3.0 V8' },
    '1982': { team: 'Williams', chassis: 'FW08', engine: 'Ford Cosworth DFV 3.0 V8' },
    '1983': { team: 'Brabham', chassis: 'BT52B', engine: 'BMW M12/13 1.5 L4 t' },
    '1984': { team: 'McLaren', chassis: 'MP4/2', engine: 'TAG-Porsche TTE PO1 1.5 V6 t' },
    '1985': { team: 'McLaren', chassis: 'MP4/2B', engine: 'TAG-Porsche TTE PO1 1.5 V6 t' },
    '1986': { team: 'McLaren', chassis: 'MP4/2C', engine: 'TAG-Porsche TTE PO1 1.5 V6 t' },
    '1987': { team: 'Williams', chassis: 'FW11B', engine: 'Honda RA167E 1.5 V6 t' },
    '1988': { team: 'McLaren', chassis: 'MP4/4', engine: 'Honda RA168E 1.5 V6 t' },
    '1989': { team: 'McLaren', chassis: 'MP4/5', engine: 'Honda RA109E V10' },
    '1990': { team: 'McLaren', chassis: 'MP4/5B', engine: 'Honda RA100E 3.5 V10' },
    '1991': { team: 'McLaren', chassis: 'MP4/6', engine: 'Honda RA121E 3.5 V12' },
    '1992': { team: 'Williams', chassis: 'FW14B', engine: 'Renault RS4 3.5 V10' },
    '1993': { team: 'Williams', chassis: 'FW15C', engine: 'Renault RS5 3.5 V10' },
    '1994': { team: 'Benetton', chassis: 'B194', engine: 'Ford EC Zetec-R 3.5 V8' },
    '1995': { team: 'Benetton', chassis: 'B195', engine: 'Renault RS7 3.0 V10' },
    '1996': { team: 'Williams', chassis: 'FW18', engine: 'Renault RS8 3.0 V10' },
    '1997': { team: 'Williams', chassis: 'FW19', engine: 'Renault RS9B 3.0 V10' },
    '1998': { team: 'McLaren', chassis: 'MP4/13', engine: 'Mercedes FO110G' },
    '1999': { team: 'McLaren', chassis: 'MP4/14', engine: 'Mercedes FO110H' },
    '2000': { team: 'Ferrari', chassis: 'F1-2000', engine: 'Ferrari Tipo 049' },
    '2001': { team: 'Ferrari', chassis: 'F2001', engine: 'Ferrari Tipo 050' },
    '2002': { team: 'Ferrari', chassis: 'F2002', engine: 'Ferrari Tipo 051' },
    '2003': { team: 'Ferrari', chassis: 'F2003-GA', engine: 'Ferrari Tipo 052' },
    '2004': { team: 'Ferrari', chassis: 'F2004', engine: 'Ferrari Tipo 053' },
    '2005': { team: 'Renault', chassis: 'R25', engine: 'Renault RS25' },
    '2006': { team: 'Renault', chassis: 'R26', engine: 'Renault RS26 2.4 V8' },
    '2007': { team: 'Ferrari', chassis: 'F2007', engine: 'Ferrari 056' },
    '2008': { team: 'McLaren', chassis: 'MP4-23', engine: 'Mercedes FO108V' },
    '2009': { team: 'Brawn GP', chassis: 'BGP 001', engine: 'Mercedes FO 108W' },
    '2010': { team: 'Red Bull', chassis: 'RB6', engine: 'Renault RS27-2010' },
    '2011': { team: 'Red Bull', chassis: 'RB7', engine: 'Renault RS27-2011' },
    '2012': { team: 'Red Bull', chassis: 'RB8', engine: 'Renault RS27-2012' },
    '2013': { team: 'Red Bull', chassis: 'RB9', engine: 'Renault RS27-2013' },
    '2014': { team: 'Mercedes', chassis: 'F1 W05 Hybrid', engine: 'Mercedes PU106A Hybrid' },
    '2015': { team: 'Mercedes', chassis: 'F1 W06 Hybrid', engine: 'Mercedes PU106B Hybrid' },
    '2016': { team: 'Mercedes', chassis: 'F1 W07 Hybrid', engine: 'Mercedes PU106C Hybrid' },
    '2017': { team: 'Mercedes', chassis: 'F1 W08 EQ Power+', engine: 'Mercedes M08 EQ Power+' },
    '2018': { team: 'Mercedes', chassis: 'F1 W09 EQ Power+', engine: 'Mercedes M09 EQ Power+' },
    '2019': { team: 'Mercedes', chassis: 'F1 W10 EQ Power+', engine: 'Mercedes M10 EQ Power+' },
    '2020': { team: 'Mercedes', chassis: 'F1 W11', engine: 'Mercedes-AMG F1 M11' },
    '2021': { team: 'Red Bull', chassis: 'RB16B', engine: 'Honda RA621H' },
    '2022': { team: 'Red Bull', chassis: 'RB18', engine: 'Red Bull RBPTH001' },
    '2023': { team: 'Red Bull', chassis: 'RB19', engine: 'Honda RBPTH001' },
    '2024': { team: 'Red Bull', chassis: 'RB20', engine: 'Honda RBPTH002' },
    '2025': { team: 'McLaren', chassis: 'MCL39', engine: 'Mercedes-AMG F1 M16' }
  };

  // F1 2025 teams: canonical data for /season/f1-2025/teams (used when API returns wrong/2026 data)
  var F1_2025_TEAMS = [
    { manufacturer: 'Alpine-Renault', team: 'BWT Alpine F1 Team', number: '7', driver: 'Jack Doohan', rounds: '1–6' },
    { manufacturer: 'Alpine-Renault', team: 'BWT Alpine F1 Team', number: '43', driver: 'Franco Colapinto', rounds: '7–24' },
    { manufacturer: 'Alpine-Renault', team: 'BWT Alpine F1 Team', number: '10', driver: 'Pierre Gasly', rounds: 'All' },
    { manufacturer: 'Aston Martin Aramco-Mercedes', team: 'Aston Martin Aramco F1 Team', number: '14', driver: 'Fernando Alonso', rounds: 'All' },
    { manufacturer: 'Aston Martin Aramco-Mercedes', team: 'Aston Martin Aramco F1 Team', number: '18', driver: 'Lance Stroll', rounds: 'All' },
    { manufacturer: 'Ferrari', team: 'Scuderia Ferrari HP', number: '16', driver: 'Charles Leclerc', rounds: 'All' },
    { manufacturer: 'Ferrari', team: 'Scuderia Ferrari HP', number: '44', driver: 'Lewis Hamilton', rounds: 'All' },
    { manufacturer: 'Haas-Ferrari', team: 'MoneyGram Haas F1 Team', number: '31', driver: 'Esteban Ocon', rounds: 'All' },
    { manufacturer: 'Haas-Ferrari', team: 'MoneyGram Haas F1 Team', number: '87', driver: 'Oliver Bearman', rounds: 'All' },
    { manufacturer: 'Kick Sauber-Ferrari', team: 'Stake F1 Team Kick Sauber', number: '5', driver: 'Gabriel Bortoleto', rounds: 'All' },
    { manufacturer: 'Kick Sauber-Ferrari', team: 'Stake F1 Team Kick Sauber', number: '27', driver: 'Nico Hülkenberg', rounds: 'All' },
    { manufacturer: 'McLaren-Mercedes', team: 'McLaren Formula 1 Team', number: '4', driver: 'Lando Norris', rounds: 'All' },
    { manufacturer: 'McLaren-Mercedes', team: 'McLaren Formula 1 Team', number: '81', driver: 'Oscar Piastri', rounds: 'All' },
    { manufacturer: 'Mercedes', team: 'Mercedes-AMG Petronas F1 Team', number: '12', driver: 'Kimi Antonelli', rounds: 'All' },
    { manufacturer: 'Mercedes', team: 'Mercedes-AMG Petronas F1 Team', number: '63', driver: 'George Russell', rounds: 'All' },
    { manufacturer: 'Racing Bulls-Honda RBPT', team: 'Visa Cash App Racing Bulls F1 Team', number: '6', driver: 'Isack Hadjar', rounds: 'All' },
    { manufacturer: 'Racing Bulls-Honda RBPT', team: 'Visa Cash App Racing Bulls F1 Team', number: '22', driver: 'Yuki Tsunoda', rounds: '1–2' },
    { manufacturer: 'Racing Bulls-Honda RBPT', team: 'Visa Cash App Racing Bulls F1 Team', number: '30', driver: 'Liam Lawson', rounds: '3–24' },
    { manufacturer: 'Red Bull Racing-Honda RBPT', team: 'Oracle Red Bull Racing', number: '1', driver: 'Max Verstappen', rounds: 'All' },
    { manufacturer: 'Red Bull Racing-Honda RBPT', team: 'Oracle Red Bull Racing', number: '30', driver: 'Liam Lawson', rounds: '1–2' },
    { manufacturer: 'Red Bull Racing-Honda RBPT', team: 'Oracle Red Bull Racing', number: '22', driver: 'Yuki Tsunoda', rounds: '3–24' },
    { manufacturer: 'Williams-Mercedes', team: 'Atlassian Williams Racing', number: '23', driver: 'Alexander Albon', rounds: 'All' },
    { manufacturer: 'Williams-Mercedes', team: 'Atlassian Williams Racing', number: '55', driver: 'Carlos Sainz Jr.', rounds: 'All' }
  ];

  // F1 2025 teams: chassis и двигатель по названию конструктора (manufacturer)
  // Используются для /season/f1-2025/teams и F1_2025_1 entry list.
  var F1_2025_CHASSIS = {
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
  var F1_2025_ENGINE = {
    'Alpine-Renault': 'Renault E-Tech RE25',
    'Aston Martin Aramco-Mercedes': 'Mercedes-AMG F1 M16',
    'Ferrari': 'Ferrari 066/15',
    'Haas-Ferrari': 'Ferrari 066/15',
    'Kick Sauber-Ferrari': 'Ferrari 066/15',
    'McLaren-Mercedes': 'Mercedes-AMG F1 M16',
    'Mercedes': 'Mercedes-AMG F1 M16',
    'Racing Bulls-Honda RBPT': 'Honda RBPTH003',
    'Red Bull Racing-Honda RBPT': 'Honda RBPTH003',
    'Williams-Mercedes': 'Mercedes-AMG F1 M16'
  };

  // Карта шасси по имени пилота для F1 2025 (используется на /season/f1-2025/stats).
  var F1_2025_CHASSIS_BY_DRIVER = {};
  F1_2025_TEAMS.forEach(function (t) {
    var man = t.manufacturer;
    var drv = t.driver;
    if (!man || !drv) return;
    var ch = F1_2025_CHASSIS[man];
    if (!ch) return;
    // Если один пилот фигурирует в нескольких строках (доп. номера/раунды),
    // оставляем первое ненулевое значение.
    if (!F1_2025_CHASSIS_BY_DRIVER[drv]) {
      F1_2025_CHASSIS_BY_DRIVER[drv] = ch;
    }
  });

  var F1_2025_TECH_SPEC = [
    { key: '__SECTION__', value: 'Dimensions' },
    { key: 'Maximum car width (excluding tyres, rims and wheel covers)', value: '≤ 1000 mm from plane Y=0 (total width ≤ 2000 mm)' },
    { key: 'Wheelbase', value: '≤ 3600 mm' },
    { key: 'Front axle plane (XF=0)', value: 'No further back than XA=100 mm' },
    { key: 'Minimum car mass (without fuel, including driver and tyres)', value: '800 kg (+ Heat Hazard Mass Increase if applicable)' },
    { key: 'Engine / Power Unit (ICE)', value: '4-stroke V6 1600 cc' },
    { key: 'ERS type', value: 'MGU-K + MGU-H (dual motor-generator system)' },
    { key: 'Number of forward gears', value: '8 (CVT prohibited)' },
    { key: 'Tyre supplier', value: 'Single FIA-appointed supplier (Pirelli)' },
    { key: 'Fuel', value: 'E10' }
  ];

  function buildF1TeamsTableHTML(teamsArr, chassisMeta, engineMeta) {
    if (!teamsArr || teamsArr.length === 0) return '';
    function teamLink(name) {
      return name ? '<a href="/team/' + encodeURIComponent(slugify(name)) + '" class="track-link">' + esc(name) + '</a>' : '—';
    }
    function driverLink(name) {
      var display = driverDisplayName(name);
      return display ? '<a href="/driver/' + encodeURIComponent(slugify(display)) + '" class="track-link">' + esc(display) + '</a>' : '—';
    }
    var len = teamsArr.length;
    var rows = [];
    var i = 0;
    while (i < len) {
      var base = teamsArr[i];
      var man = String(base.manufacturer || '').trim();
      var teamName = String(base.team || '').trim();
      var chassis = (chassisMeta && chassisMeta[man]) || '';
      var engine = (engineMeta && engineMeta[man]) || '';
      var span = 1;
      for (var j = i + 1; j < len; j++) {
        var t2 = teamsArr[j];
        if (String(t2.manufacturer || '').trim() !== man || String(t2.team || '').trim() !== teamName) break;
        span++;
      }
      for (var k = 0; k < span; k++) {
        var tm = teamsArr[i + k];
        var cells = '';
        if (k === 0) {
          cells += '<td rowspan="' + span + '">' + esc(dash(man)) + '</td>' +
                   '<td rowspan="' + span + '">' + esc(dash(chassis)) + '</td>' +
                   '<td rowspan="' + span + '">' + esc(dash(engine)) + '</td>' +
                   '<td rowspan="' + span + '">' + teamLink(teamName) + '</td>';
        }
        cells += '<td class="col-num">' + esc(dash(tm.number)) + '</td>' +
                 '<td>' + driverLink(tm.driver) + '</td>' +
                 '<td>' + esc(dash(tm.rounds)) + '</td>';
        rows.push('<tr>' + cells + '</tr>');
      }
      i += span;
    }
    var header = '<thead><tr>' +
      '<th data-i18n="th.manufacturer">' + t('th.manufacturer') + '</th>' +
      '<th data-i18n="th.chassis">' + t('th.chassis') + '</th>' +
      '<th data-i18n="th.engine">' + t('th.engine') + '</th>' +
      '<th data-i18n="th.team">' + t('th.team') + '</th>' +
      '<th data-i18n="th.no">' + t('th.no') + '</th>' +
      '<th data-i18n="th.driver">' + t('th.driver') + '</th>' +
      '<th data-i18n="th.rounds">' + t('th.rounds') + '</th></tr></thead>';
    return '<table class="data-table">' + header + '<tbody>' + rows.join('') + '</tbody></table>';
  }

  /** Entry-list format (F2, F3): Entrant/Team | No. | Driver name | Rounds, grouped by team (no country). */
  function buildEntryListTeamsTableHTML(teamsArr, seriesSlug) {
    if (!teamsArr || teamsArr.length === 0) return '';
    var isF3 = (seriesSlug || '').toLowerCase() === 'f3';
    var col1Header = isF3 ? t('th.entrant') : t('th.team');
    var col3Header = isF3 ? t('th.driver_name') : t('th.driver');
    function teamLink(name) {
      return name ? '<a href="/team/' + encodeURIComponent(slugify(name)) + '" class="track-link">' + esc(name) + '</a>' : '—';
    }
    function driverLink(name) {
      var display = driverDisplayName(name);
      return display ? '<a href="/driver/' + encodeURIComponent(slugify(display)) + '" class="track-link">' + esc(display) + '</a>' : '—';
    }
    var len = teamsArr.length;
    var rows = [];
    var i = 0;
    while (i < len) {
      var base = teamsArr[i];
      var teamName = String(base.team || '').trim();
      var teamCellText = teamLink(teamName);
      var span = 1;
      for (var j = i + 1; j < len; j++) {
        if (String(teamsArr[j].team || '').trim() !== teamName) break;
        span++;
      }
      for (var k = 0; k < span; k++) {
        var tm = teamsArr[i + k];
        var cells = k === 0 ? '<td rowspan="' + span + '">' + teamCellText + '</td>' : '';
        cells += '<td class="col-num">' + esc(dash(tm.number)) + '</td><td>' + driverLink(tm.driver) + '</td><td>' + esc(dash(tm.rounds)) + '</td>';
        rows.push('<tr>' + cells + '</tr>');
      }
      i += span;
    }
    var header = '<thead><tr><th>' + esc(col1Header) + '</th><th>' + esc(t('th.no')) + '</th><th>' + esc(col3Header) + '</th><th>' + esc(t('th.rounds')) + '</th></tr></thead>';
    return '<table class="data-table">' + header + '<tbody>' + rows.join('') + '</tbody></table>';
  }

  function eventRow(e, roundNum, seriesId) {
    if (isSeriesId(seriesId, 'super_formula')) {
      var startIsoSf = (e.start_date || e.date || '').slice(0, 10);
      var endIsoSf = (e.end_date || '').slice(0, 10);
      var dateLabelSf = (startIsoSf && endIsoSf && startIsoSf !== endIsoSf && formatDateRangeLong)
        ? formatDateRangeLong(e.start_date || e.date, e.end_date)
        : (formatShortDate ? formatShortDate(startIsoSf) : startIsoSf);
      var rdSf = e._sfRdLabel ? String(e._sfRdLabel) : String(roundNum);
      var venueSf = (window.TGA && window.TGA.superFormulaVenueLine)
        ? window.TGA.superFormulaVenueLine(e)
        : ((e.circuit_name || '') + (e.location ? ' — ' + e.location : '') || '—');
      var timeLabelSf = getScheduleTimeLabel(e, seriesId);
      return '<tr><td class="col-num">' + esc(rdSf) + '</td><td>' + esc(dateLabelSf || '—') + '</td><td class="col-location">' + esc(venueSf) + '</td><td class="col-time">' + esc(timeLabelSf || '—') + '</td></tr>';
    }
    var startIso = (e.start_date || e.date || '').slice(0, 10);
    var endIso = (e.end_date || '').slice(0, 10);
    var dateLabel = (startIso && endIso && startIso !== endIso && formatDateRangeLong)
      ? formatDateRangeLong(e.start_date || e.date, e.end_date)
      : (formatShortDate ? formatShortDate(startIso) : startIso);
    var name = e.name || '—';
    var eventSlug = (e.id || '').toLowerCase().replace(/_+/g, '-');
    var link = e.has_detail
      ? '<a href="/event/' + encodeURIComponent(eventSlug) + '" class="event-link">' + esc(name) + '</a>'
      : '<span class="event-no-data">' + esc(name) + '</span>';
    var loc = e.circuit_name || e.location || '—';
    var timeLabel = getScheduleTimeLabel(e, seriesId);
    return '<tr><td class="col-num">' + esc(String(roundNum)) + '</td><td>' + esc(dateLabel || '—') + '</td><td>' +
      link + '</td><td class="col-location">' + esc(loc) + '</td><td class="col-time">' + esc(timeLabel || '—') + '</td></tr>';
  }

  function renderSeriesHeaderAndNav(seriesId, name, meta, subPath) {
    var titleEl = document.getElementById('detail-title');
    var metaEl = document.getElementById('detail-meta');
    var breadcrumbEl = document.getElementById('detail-breadcrumb');
    var navEl = document.getElementById('series-nav');
    if (titleEl) titleEl.textContent = name || '—';
    if (metaEl) metaEl.textContent = meta || '';
    if (breadcrumbEl) {
      var slug = seriesIdToSlug(seriesId);
      breadcrumbEl.innerHTML = '<a href="/">← ' + esc(t('breadcrumb.all') || 'All series') + '</a><span class="breadcrumb-sep">/</span><span>' + esc(name || seriesId) + '</span>';
    }
    var base = '/series/' + encodeURIComponent(seriesIdToSlug(seriesId));
    var navItems = [
      { path: '', labelKey: 'nav.schedule' },
      { path: 'standings', labelKey: 'nav.standings' },
      { path: 'teams', labelKey: 'nav.teams' },
      { path: 'specs', labelKey: 'nav.carspecs' },
      { path: 'stats', labelKey: 'section.h3.stats' },
      { path: 'history', labelKey: 'nav.history' }
    ];
    var isF1 = isSeriesId(seriesId, 'f1');
    var showStats = isSeriesId(seriesId, 'nascar_cup') || isSeriesId(seriesId, 'noaps') || isSeriesId(seriesId, 'nascar_truck') || isSeriesId(seriesId, 'arca') || isSeriesId(seriesId, 'nascar_modified') || isSeriesId(seriesId, 'indycar') || isSeriesId(seriesId, 'supercars');
    var showHistory = isF1;
    if (navEl) {
      var items = navItems.filter(function (p) {
        if (p.path === 'stats') return showStats;
        if (p.path === 'history') return showHistory;
        return true;
      });
      navEl.innerHTML = items.map(function (p) {
        var href = p.path ? base + '/' + p.path : base;
        var active = (subPath === p.path) ? ' nav-link active' : ' nav-link';
        return '<a href="' + href + '" class="' + active.trim() + '">' + esc(t(p.labelKey) || p.path) + '</a>';
      }).join('');
    }
  }

  function renderSeriesScheduleView(seriesId, events, scheduleTableEl, scheduleEmptyEl) {
    if (!scheduleTableEl) return;
    var list = Array.isArray(events) ? events : [];
    if (isSeriesId(seriesId, 'super_formula') && window.TGA && typeof window.TGA.collapseSuperFormulaScheduleEvents === 'function') {
      list = list.map(function (ev) {
        return Object.assign({}, ev, { _seriesId: ev._seriesId || ev.series_id || 'SUPER_FORMULA' });
      });
      list = window.TGA.collapseSuperFormulaScheduleEvents(list);
      var theadTr = scheduleTableEl.querySelector('thead tr');
      if (theadTr) {
        theadTr.innerHTML =
          '<th>Rd.</th><th>Date</th><th>Venue</th><th>' + esc(t('th.time') || 'Time') + '</th>';
      }
    }
    if (list.length === 0) {
      scheduleTableEl.querySelector('tbody').innerHTML = '';
      if (scheduleEmptyEl) { scheduleEmptyEl.classList.remove('hidden'); scheduleEmptyEl.textContent = t('schedule.empty') || 'No schedule data yet.'; }
      return;
    }
    if (scheduleEmptyEl) scheduleEmptyEl.classList.add('hidden');
    var raceCounter = 0;
    var rows = list.map(function (e, i) {
      var eid = (e && e.id) || '';
      var isUnnumbered = eid.indexOf('PRE_SEASON_TEST') >= 0 ||
        /_\d{4}_PROLOGUE$/i.test(String(eid));
      if (!isUnnumbered) raceCounter += 1;
      var num = isUnnumbered ? '—' : String(raceCounter);
      return eventRow(e, num, seriesId);
    }).join('');
    scheduleTableEl.querySelector('tbody').innerHTML = rows;
    if (typeof makeSimpleTableSortable === 'function') makeSimpleTableSortable(scheduleTableEl);
  }

  function renderSeriesStandingsAndStats(seriesId, data, standingsWrap, standingsEmpty, rebuildFn) {
    if (!standingsWrap) return;
    var rows = (data && data.rows) ? data.rows : (Array.isArray(data) ? data : []);
    var raceOrder = (data && data.race_order) ? data.race_order : [];
    var classes = (data && data.classes) ? data.classes : [];
    var ineligible = (data && data.ineligible) ? data.ineligible : [];

    var sidMulti = (seriesId || '').toLowerCase().replace(/-/g, '_');
    if (window.TGA && window.TGA.buildImsaGtwceClassStandingsHtml && classes.length > 0) {
      if ((sidMulti === 'imsa' && rows.length === 0) || sidMulti === 'gtwce_end' || sidMulti === 'gtwce_sprint') {
        var multiH = window.TGA.buildImsaGtwceClassStandingsHtml(data, sidMulti);
        if (multiH) {
          var imsaW = document.getElementById('standings-imsa-wrap');
          if (imsaW) {
            imsaW.innerHTML = multiH;
            imsaW.classList.remove('hidden');
            standingsWrap.classList.add('hidden');
            if (standingsEmpty) standingsEmpty.classList.add('hidden');
            syncStandingsScrollBars();
            return;
          }
        }
      }
    }

    var applyData = function (d) {
      if (!d || !d.rows || d.rows.length === 0) {
        var tb = standingsWrap && standingsWrap.querySelector('table tbody');
        if (tb) tb.innerHTML = '';
        var th = standingsWrap && standingsWrap.querySelector('#standings-thead');
        if (th) th.innerHTML = '<th>Pos</th><th>' + esc(t('th.driver')) + '</th><th>' + esc(t('th.team')) + '</th><th>' + esc(t('th.pts')) + '</th>';
        if (standingsEmpty) { standingsEmpty.classList.remove('hidden'); standingsEmpty.textContent = t('standings.empty') || 'No standings data.'; }
        return;
      }
      if (standingsEmpty) standingsEmpty.classList.add('hidden');
      var simpleStandings = isSeriesId(seriesId, 'f3') || isSeriesId(seriesId, 'f2') || isSeriesId(seriesId, 'f1');
      var eventNames = (d.event_names && Array.isArray(d.event_names)) ? d.event_names : [];
      var headers, body, thHtml;
      if (simpleStandings) {
        var hasRaceCols = raceOrder && raceOrder.length > 0 && eventNames.length >= raceOrder.length;
        var theadTr = standingsWrap.querySelector('#standings-thead');
        var theadEl = theadTr && theadTr.parentNode;
        if (hasRaceCols && theadEl) {
          var isF1Series = isSeriesId(seriesId, 'f1');
          if (isF1Series) {
            // F1: всегда одна строка заголовков. Для этапов со спринтом:
            // две колонки с подписями CHI*S / CHI*F (base = 3 буквы названия этапа).
            var headerRowF1 = '<tr class="standings-header-row-top">' +
              '<th class="col-num">' + esc(t('th.pos') || 'Pos') + '</th>' +
              '<th>' + esc(t('th.driver') || 'Driver') + '</th>' +
              '<th class="col-car">#</th>' +
              '<th>' + esc(t('th.team') || 'Team') + '</th>';
            var perEventCountF1 = {};
            raceOrder.forEach(function (_code, j) {
              var en = String(eventNames[j] || '');
              perEventCountF1[en] = (perEventCountF1[en] || 0) + 1;
            });
            var perEventSeenF1 = {};
            raceOrder.forEach(function (_code, j) {
              var en = String(eventNames[j] || '');
              var base = en ? en.slice(0, 3).toUpperCase() : String(j + 1);
              var totalForEvent = perEventCountF1[en] || 1;
              perEventSeenF1[en] = (perEventSeenF1[en] || 0) + 1;
              var idxForEvent = perEventSeenF1[en] - 1;
              var suffix = '';
              if (totalForEvent === 2) {
                suffix = (idxForEvent === 0) ? '*S' : '*F';
              }
              headerRowF1 += '<th class="col-race">' + esc(base + suffix) + '</th>';
            });
            headerRowF1 += '<th class="col-pts">' + esc(t('th.pts') || 'Pts') + '</th></tr>';
            theadEl.innerHTML = headerRowF1;
          } else {
            // F2/F3 и другие формульные серии: группируем этапы и показываем подзаголовки по гонкам.
            var prevName = null, colSpan = 0, eventRow = '';
            for (var i = 0; i < raceOrder.length; i++) {
              var en = eventNames[i] || '';
              if (en === prevName) { colSpan++; } else {
                if (prevName != null) {
                  eventRow += '<th class="col-race-group" colspan="' + colSpan + '">' + esc(prevName) + '</th>';
                }
                prevName = en; colSpan = 1;
              }
            }
            if (prevName != null) {
              eventRow += '<th class="col-race-group" colspan="' + colSpan + '">' + esc(prevName) + '</th>';
            }
            var topRow = '<tr class="standings-header-row-top">' +
              '<th class="col-num" rowspan="2">' + esc(t('th.pos') || 'Pos') + '</th>' +
              '<th rowspan="2">' + esc(t('th.driver') || 'Driver') + '</th>' +
              '<th class="col-car" rowspan="2">#</th>' +
              '<th rowspan="2">' + esc(t('th.team') || 'Team') + '</th>' +
              eventRow +
              '<th class="col-pts" rowspan="2">' + esc(t('th.pts') || 'Pts') + '</th></tr>';
            var bottomRow = '<tr id="standings-thead">';
            var useSprintFeature = isSeriesId(seriesId, 'f2') || isSeriesId(seriesId, 'f3');
            var isSupercarsSMPMLB = isSeriesId(seriesId, 'supercars') && raceOrder.every(function (c) { return /^(SMP|MLB)\d+$/i.test(String(c || '')); });
            var perEventCount = {};
            var perEventSeen = {};
            if (useSprintFeature) {
              eventNames.forEach(function (name) {
                var key = String(name || '');
                perEventCount[key] = (perEventCount[key] || 0) + 1;
              });
            }
            raceOrder.forEach(function (code, j) {
              var subLabel;
              if (useSprintFeature) {
                var eventKey = String(eventNames[j] || '');
                perEventSeen[eventKey] = (perEventSeen[eventKey] || 0) + 1;
                if ((perEventCount[eventKey] || 0) === 2) {
                  subLabel = (perEventSeen[eventKey] === 1 ? (t('standings.sprint') || 'Sprint') : (t('standings.feature') || 'Feature'));
                } else {
                  subLabel = (code || '');
                }
              }
              else if (isSupercarsSMPMLB) subLabel = String(code || '').replace(/^(SMP|MLB)/i, '') || (j + 1);
              else subLabel = (code || '');
              bottomRow += '<th class="col-race">' + esc(subLabel) + '</th>';
            });
            bottomRow += '</tr>';
            theadEl.innerHTML = topRow + bottomRow;
          }
          body = d.rows.map(function (r) {
            var td = '<td class="col-num">' + esc(dash(r.pos)) + '</td><td>' + esc(dash(driverDisplayName(r.driver || ''))) + '</td><td class="col-car">' + esc(dash(r.car || '—')) + '</td><td>' + esc(dash(r.team || '')) + '</td>';
            raceOrder.forEach(function (code) { td += '<td class="col-race">' + esc(dash(r.races && r.races[code] != null ? r.races[code] : '—')) + '</td>'; });
            td += '<td class="col-pts">' + esc(dash(r.points)) + '</td>';
            return '<tr>' + td + '</tr>';
          }).join('');
        } else {
          headers = ['Pos', t('th.driver') || 'Driver', '#', t('th.team') || 'Team', t('th.pts') || 'Pts'];
          thHtml = headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('');
          if (theadTr) theadTr.innerHTML = thHtml;
          body = d.rows.map(function (r) {
            var cells = [r.pos, driverDisplayName(r.driver || ''), r.car || '—', r.team || '', r.points || ''];
            return '<tr>' + cells.map(function (c) { return '<td class="col-num">' + esc(dash(c)) + '</td>'; }).join('') + '</tr>';
          }).join('');
        }
      } else {
        headers = ['Pos', t('th.driver') || 'Driver', t('th.team') || 'Team'];
        if (raceOrder && raceOrder.length > 0) headers = headers.concat(raceOrder);
        headers.push(t('th.pts') || 'Pts');
        thHtml = headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('');
        standingsWrap.querySelector('#standings-thead').innerHTML = thHtml;
        body = d.rows.map(function (r) {
          var cells = [r.pos, driverDisplayName(r.driver || ''), r.team || ''];
          if (raceOrder && r.races) raceOrder.forEach(function (code) { cells.push(r.races && r.races[code] != null ? r.races[code] : '—'); });
          cells.push(r.points || '');
          return '<tr>' + cells.map(function (c) { return '<td class="col-num">' + esc(dash(c)) + '</td>'; }).join('') + '</tr>';
        }).join('');
      }
      standingsWrap.querySelector('table tbody').innerHTML = body;
      syncStandingsScrollBars();
    };

    if (isSeriesId(seriesId, 'nascar_cup') && raceOrder && raceOrder.indexOf('DAY') >= 0 && rebuildFn) {
      rebuildFn(data).then(applyData);
    } else {
      applyData(data);
    }

    if (classes && classes.length > 0 && isSeriesId(seriesId, 'imsa')) {
      var wrap = standingsWrap.parentElement;
      classes.forEach(function (cls) {
        var title = document.createElement('h4');
        title.className = 'table-section-title';
        title.textContent = cls.name || cls.id || '';
        var div = document.createElement('div');
        div.className = 'table-wrap standings-scroll-bottom';
        var tbl = '<table class="data-table"><thead><tr><th>Pos</th><th>' + esc(t('th.driver')) + '</th><th>' + esc(t('th.team')) + '</th><th>Pts</th></tr></thead><tbody>';
        (cls.rows || []).forEach(function (r) {
          tbl += '<tr><td class="col-num">' + esc(r.pos) + '</td><td>' + esc(driverDisplayName(r.driver || '')) + '</td><td>' + esc(r.team || '') + '</td><td>' + esc(dash(r.points)) + '</td></tr>';
        });
        tbl += '</tbody></table>';
        div.innerHTML = tbl;
        wrap.appendChild(title);
        wrap.appendChild(div);
      });
    }

    if (ineligible && ineligible.length > 0) {
      var inelTitle = document.getElementById('standings-ineligible-title');
      var inelWrap = document.getElementById('standings-ineligible-wrap');
      var inelContainer = document.getElementById('standings-ineligible-scroll-container');
      if (inelTitle && inelWrap && inelContainer) {
        inelTitle.classList.remove('hidden');
        inelContainer.classList.remove('hidden');
        var inelThead = document.getElementById('standings-ineligible-thead');
        if (inelThead) inelThead.innerHTML = '<th>Pos</th><th>' + esc(t('th.driver')) + '</th><th>' + esc(t('th.team')) + '</th><th>Pts</th>';
        inelWrap.querySelector('tbody').innerHTML = ineligible.map(function (r) {
          return '<tr><td class="col-num">' + esc(r.pos) + '</td><td>' + esc(driverDisplayName(r.driver || '')) + '</td><td>' + esc(r.team || '') + '</td><td>' + esc(dash(r.points)) + '</td></tr>';
        }).join('');
      }
    }
  }

  function renderSeriesTeamsAndSpecs(seriesId, teamsData, specsPanel, teamsPanel, teamsWrap, teamsEmpty, specsEmpty) {
    var slug = seriesIdToSlug(seriesId);
    var seriesSlug = slug.toLowerCase();
    var teams = (teamsData && teamsData.teams) || (Array.isArray(teamsData) ? teamsData : []);
    if (teamsPanel) teamsPanel.classList.remove('hidden');
    if (specsPanel) specsPanel.classList.remove('hidden');

    if (seriesSlug === 'f1-2025') {
      if (teamsWrap) {
        teamsWrap.innerHTML = buildF1TeamsTableHTML(F1_2025_TEAMS, F1_2025_CHASSIS, F1_2025_ENGINE);
        if (teamsEmpty) teamsEmpty.classList.add('hidden');
      }
    } else if (teams.length > 0 && teamsWrap) {
      teamsEmpty.classList.add('hidden');
      var isEntryList = teams.every(function (tm) {
        return (tm.team != null || tm.team === '') && (tm.number != null || tm.driver != null);
      }) && teams.some(function (tm) { return tm.driver != null && String(tm.driver).trim() !== ''; });
      var hasNoManufacturer = !teams.some(function (tm) { return tm.manufacturer != null && String(tm.manufacturer).trim() !== ''; });
      var html = (isEntryList && hasNoManufacturer)
        ? buildEntryListTeamsTableHTML(teams, seriesSlug)
        : (function () {
            var h = '<table class="data-table"><thead><tr><th>#</th><th>' + esc(t('th.manufacturer')) + '</th><th>' + esc(t('th.team')) + '</th><th>' + esc(t('th.no')) + '</th><th>' + esc(t('th.driver')) + '</th></tr></thead><tbody>';
            teams.forEach(function (tm, i) {
              var dr = tm.driver || (tm.drivers && tm.drivers[0]) || '—';
              h += '<tr><td class="col-num">' + (i + 1) + '</td><td>' + esc(tm.manufacturer || '—') + '</td><td>' + esc(tm.team || '—') + '</td><td>' + esc(tm.number || '—') + '</td><td>' + esc(dr) + '</td></tr>';
            });
            return h + '</tbody></table>';
          })();
      teamsWrap.innerHTML = html;
      if (typeof makeSimpleTableSortable === 'function') makeSimpleTableSortable(teamsWrap.querySelector('table'));
    } else {
      if (teamsEmpty) teamsEmpty.classList.remove('hidden');
    }

    var carSpecWrap = document.getElementById('car-spec-wrap');
    var carModelsWrap = document.getElementById('car-models-table-wrap');
    var techSpecWrap = document.getElementById('technical-spec-table-wrap');
    var carModels = (teamsData && teamsData.car_models) || [];
    var techSpec = seriesSlug === 'f1-2025' && F1_2025_TECH_SPEC
      ? F1_2025_TECH_SPEC
      : ((teamsData && teamsData.technical_spec) || []);
    if (seriesSlug === 'f3') {
      carModels = [];
      techSpec = [
        { key: 'Chassis', value: 'Carbon fibre kevlar monocoque with honeycomb structure' },
        { key: 'Suspension', value: 'Double steel wishbones, pushrod operated, twin dampers, helicoidally spring suspension' },
        { key: 'Length', value: '4,965 mm (195 in)' },
        { key: 'Width', value: '1,885 mm (74 in)' },
        { key: 'Height', value: '1,043 mm (41 in)' },
        { key: 'Engine', value: 'Mecachrome V634 3,396 cubic centimetres (207 cubic inches) V6 95° naturally aspirated, rear-mounted, rear-wheel-drive' },
        { key: 'Transmission', value: '3Mo 6-speed sequential paddle-shift' },
        { key: 'Power', value: '380 horsepower (283 kilowatts) @8,000 rpm, 420 newton-metres (310 pound force-feet)' },
        { key: 'Weight', value: '673 kg (1,484 lb) (including driver)' },
        { key: 'Fuel', value: 'Aramco Advanced 100% sustainable fuel' },
        { key: 'Lubricants', value: 'Aramco Orizon' },
        { key: 'Tyres', value: 'Pirelli P Zero (dry) and Pirelli Cinturato (wet) tyres' }
      ];
    }
    if (seriesSlug === 'f2') {
      carModels = [];
      techSpec = [
        { key: 'Chassis', value: 'Sandwich Carbon fibre/Aluminium monocoque with honeycomb structure' },
        { key: 'Suspension (front)', value: 'Pushrod operated double steel wishbones with twin dampers and torsion bars suspension' },
        { key: 'Suspension (rear)', value: 'Pushrod operated double steel wishbones with twin dampers and spring suspension' },
        { key: 'Length', value: '5,284 mm (208 in)' },
        { key: 'Width', value: '1,900 mm (75 in)' },
        { key: 'Height', value: '1,097 mm (43 in)' },
        { key: 'Wheelbase', value: '3,135 mm (123 in)' },
        { key: 'Engine', value: 'Mecachrome V634T 3.4 L (207 cu in) V6 single-turbo charged longitudinally mounted in a rear-engined, rear-wheel drive format' },
        { key: 'Transmission', value: 'Hewland 6-speed + 1 reverse sequential semi-automatic paddle-shift limited-slip differential' },
        { key: 'Power', value: '620 hp (462 kW) @ 8,750 rpm, 583 N⋅m (430 ft⋅lbf) torque' },
        { key: 'Weight', value: '795 kg (1,753 lb) including driver and fuel' },
        { key: 'Fuel', value: 'Aramco Advanced 55% sustainable fuel' },
        { key: 'Lubricants', value: 'Aramco Orizon' },
        { key: 'Brakes', value: 'Carbone Industrie carbon brake discs and pads' },
        { key: 'Tyres', value: 'Pirelli P Zero (dry) and Pirelli Cinturato (wet) tyres' }
      ];
    }
    if (carModels.length === 0 && techSpec.length === 0 && seriesSlug !== 'f3' && seriesSlug !== 'f2') {
      if (carSpecWrap) carSpecWrap.classList.add('hidden');
      if (carModelsWrap) carModelsWrap.innerHTML = '';
      if (techSpecWrap) techSpecWrap.innerHTML = '';
      if (specsEmpty) specsEmpty.classList.remove('hidden');
    } else {
      if (carSpecWrap) carSpecWrap.classList.remove('hidden');
      if (specsEmpty) specsEmpty.classList.add('hidden');
      if ((seriesSlug === 'f3' || seriesSlug === 'f2') && carModelsWrap) {
        var carModelsTitleF2F3 = carSpecWrap && carSpecWrap.querySelector('h4[data-i18n="specs.car_models"]');
        if (carModelsTitleF2F3) carModelsTitleF2F3.classList.add('hidden');
        carModelsWrap.classList.remove('table-wrap');
        carModelsWrap.innerHTML = seriesSlug === 'f3' ? '<p class="specs-chassis-line">Chassis Dallara F3 2025</p>' : '<p class="specs-chassis-line">Chassis Dallara F2 2024</p>';
      } else if (carModels.length > 0 && carModelsWrap) {
        carModelsWrap.classList.add('table-wrap');
        carModelsWrap.innerHTML = '<table class="data-table"><thead><tr><th>' + esc(t('th.manufacturer')) + '</th><th>Model</th></tr></thead><tbody>' +
          carModels.map(function (m) { return '<tr><td>' + esc(m.manufacturer || '—') + '</td><td>' + esc(m.model || '—') + '</td></tr>'; }).join('') +
          '</tbody></table>';
        if (typeof makeTableSortable === 'function') makeTableSortable(carModelsWrap.querySelector('table'), carModels.map(function (c) { return [c.manufacturer, c.model]; }), esc);
      }
      if (techSpec.length > 0 && techSpecWrap) {
        var hasSection = techSpec.some(function (s) { return s.key === '__SECTION__'; });
        if (hasSection) {
          var sections = [];
          var curTitle = '';
          var curRows = [];
          techSpec.forEach(function (s) {
            if (s.key === '__SECTION__') {
              if (curRows.length > 0) sections.push({ title: curTitle, rows: curRows });
              curTitle = s.value || '';
              curRows = [];
            } else {
              curRows.push(s);
            }
          });
          if (curRows.length > 0) sections.push({ title: curTitle, rows: curRows });

          techSpecWrap.className = 'table-wrap tech-spec-by-section';
          techSpecWrap.innerHTML = sections.map(function (sec) {
            var body = sec.rows.map(function (s) {
              var key = (typeof localizeSpecKey === 'function') ? localizeSpecKey(s.key) : s.key;
              var val = (typeof localizeSpecValue === 'function') ? localizeSpecValue(s.value) : s.value;
              var cellVal = (val || '').indexOf('\n') >= 0
                ? (val || '').split('\n').map(function (p) { return esc(p); }).join('<br>')
                : esc(val || '—');
              return '<tr><td class="col-field">' + esc(key || '—') + '</td>' +
                     '<td class="col-spec-value">' + cellVal + '</td></tr>';
            }).join('');
            return '<h4 class="table-section-title">' + esc(sec.title) + '</h4>' +
                   '<div class="table-wrap tech-spec-section-table">' +
                     '<table class="data-table table-field-value"><tbody>' + body + '</tbody></table>' +
                   '</div>';
          }).join('');
        } else {
          techSpecWrap.innerHTML = '<table class="data-table"><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody>' +
            techSpec.filter(function (s) { return !specKeySkip || !specKeySkip[normalizeSpecKey(s.key)]; }).map(function (s) {
              return '<tr><td>' + esc(localizeSpecKey(s.key) || s.key || '—') + '</td><td>' + esc(localizeSpecValue(s.value) || s.value || '—') + '</td></tr>';
            }).join('') +
            '</tbody></table>';
          if (typeof makeTableSortable === 'function') {
            makeTableSortable(
              techSpecWrap.querySelector('table'),
              techSpec.map(function (s) { return [s.key, s.value]; }),
              esc
            );
          }
        }
      }
    }

    if (isSeriesId(seriesId, 'supercars') && renderSupercarsStaticSpecs) renderSupercarsStaticSpecs();
  }

  function renderSeriesHistory(seriesId, historyData) {
    var historyBody = document.querySelector('#history-table tbody');
    if (!historyBody || !isSeriesId(seriesId, 'f1')) return;

    function buildRows() {
      var now = new Date();
      var currentYear = now.getFullYear();
      var earliestSeason = 1950;
      var lastCompletedSeason = Math.min(currentYear - 1, 2025);
      if (lastCompletedSeason < earliestSeason) return '';

      var rowsHtml = '';
      for (var season = lastCompletedSeason; season >= earliestSeason; season--) {
        var key = String(season);
        var racesVal = F1_RACES_PER_SEASON[key];
        var races = racesVal != null ? String(racesVal) : '—';
        var driver = F1_DRIVER_CHAMPIONS[key] || '—';
        var driverPts = F1_DRIVER_POINTS[key];
        var driverPtsCell = (driverPts != null ? String(driverPts) : '—');
        var constructor = F1_CONSTRUCTOR_CHAMPIONS[key] || '—';
        var ce = F1_CHASSIS_ENGINE[key] || null;
        var team = ce && ce.team ? ce.team : '—';
        var chassis = ce && ce.chassis ? ce.chassis : '—';
        var engine = ce && ce.engine ? ce.engine : '—';
        var constructorPts = F1_CONSTRUCTOR_POINTS[key];
        var constructorPtsCell = (constructorPts != null ? String(constructorPts) : '—');
        var seasonSlug = 'f1-' + season;
        var seasonLink = '<a href="/season/' + seasonSlug + '" class="season-link">' + season + '</a>';
        rowsHtml += '<tr>' +
          '<td>' + seasonLink + '</td>' +
          '<td>' + races + '</td>' +
          '<td>' + esc(driver) + '</td>' +
          '<td>' + driverPtsCell + '</td>' +
          '<td>' + esc(team) + '</td>' +
          '<td>' + esc(chassis) + '</td>' +
          '<td>' + esc(engine) + '</td>' +
          '<td>' + esc(constructor) + '</td>' +
          '<td>' + constructorPtsCell + '</td>' +
          '</tr>';
      }
      return rowsHtml;
    }

    historyBody.innerHTML = buildRows();
    if (typeof makeSimpleTableSortable === 'function') {
      var historyTable = document.getElementById('history-table');
      if (historyTable) makeSimpleTableSortable(historyTable);
    }
  }

  function renderDetail(seriesId, subPath) {
    subPath = (subPath || '').replace(/\/.*$/, '');
    showView('view-detail');
    adjustDetailPanelPadding();
    if (document.body) {
      document.body.classList.remove('series-f1', 'series-f2', 'series-f3', 'series-nascar_cup', 'series-indycar', 'series-supercars', 'series-imsa');
      var cat = categoryBySeriesId && categoryBySeriesId[seriesId];
      if (cat) document.body.classList.add('series-' + cat);
      var sid = (seriesId || '').toLowerCase().replace(/\s+/g, '-');
      if (sid) document.body.classList.add('series-' + sid.replace(/_/g, '-'));
    }

    var slug = seriesIdToSlug(seriesId);
    var apiBase = '/api/series/' + encodeURIComponent(slug);
    var schedulePanel = document.getElementById('schedule-panel');
    var standingsPanel = document.getElementById('standings-panel');
    var teamsPanel = document.getElementById('teams-panel');
    var specsPanel = document.getElementById('specs-panel');
    var statsPanel = document.getElementById('stats-panel');
    var historyPanel = document.getElementById('history-panel');
    var scheduleTable = document.getElementById('schedule-table');
    var scheduleEmpty = document.getElementById('schedule-empty');
    var standingsWrap = document.getElementById('standings-wrap');
    var standingsEmpty = document.getElementById('standings-empty');
    var teamsTableWrap = document.getElementById('teams-table-wrap');
    var teamsEmpty = document.getElementById('teams-empty');
    var specsEmpty = document.getElementById('specs-empty');

    [schedulePanel, standingsPanel, teamsPanel, specsPanel, statsPanel, historyPanel].forEach(function (panel) {
      if (panel) panel.classList.add('hidden');
    });
    if (subPath === '') schedulePanel && schedulePanel.classList.remove('hidden');
    if (subPath === 'standings') standingsPanel && standingsPanel.classList.remove('hidden');
    if (subPath === 'teams') teamsPanel && teamsPanel.classList.remove('hidden');
    if (subPath === 'specs') specsPanel && specsPanel.classList.remove('hidden');
    if (subPath === 'stats') statsPanel && statsPanel.classList.remove('hidden');
    if (subPath === 'history') historyPanel && historyPanel.classList.remove('hidden');

    state.loadedSeriesId = seriesId;
    document.title = (seriesId || 'Series') + ' — The Grid Archive (TGA)';

    fetchJSON(apiBase)
      .then(function (meta) {
        var name = (meta && meta.name) ? meta.name : seriesId;
        var metaStr = (meta && meta.season) ? meta.season + ' · ' + (meta.country || '') : (meta && meta.country) || '';
        document.title = name + ' — The Grid Archive (TGA)';
        renderSeriesHeaderAndNav(seriesId, name, metaStr, subPath);
      })
      .catch(function () {
        renderSeriesHeaderAndNav(seriesId, seriesId, '', subPath);
      });

    var teamsWrap = document.getElementById('teams-table-wrap');
    if (!teamsWrap) teamsWrap = teamsTableWrap;

    fetchJSON(apiBase + '/teams')
      .then(function (teamsData) {
        renderSeriesTeamsAndSpecs(seriesId, teamsData, specsPanel, teamsPanel, teamsWrap, teamsEmpty, specsEmpty);
      })
      .catch(function () {
        renderSeriesTeamsAndSpecs(seriesId, null, specsPanel, teamsPanel, teamsWrap, teamsEmpty, specsEmpty);
      });

    fetchJSON(apiBase + '/standings')
      .then(function (standingsData) {
        // Supercars: приоритет — ответ API. Если API вернул 7 колонок (SMP1–SMP3, MLB4–MLB7), не подменять данными только по Sydney (3 гонки).
        var raceOrder = standingsData && Array.isArray(standingsData.race_order) ? standingsData.race_order : [];
        var apiHasSevenCols = raceOrder.length === 7 && /^(SMP|MLB)\d+$/i.test(String(raceOrder[0] || '')) && /^(SMP|MLB)\d+$/i.test(String(raceOrder[6] || ''));
        if (isSeriesId(seriesId, 'supercars') && standingsData && (standingsData.rows && standingsData.rows.length > 0 || apiHasSevenCols)) {
          return standingsData;
        }
        if (isSeriesId(seriesId, 'supercars') && window.tgaSeries && window.tgaSeries.supercars && window.tgaSeries.supercars.buildStandingsFromEvents) {
          return window.tgaSeries.supercars.buildStandingsFromEvents().then(function (built) { return built || standingsData; });
        }
        return standingsData;
      })
      .then(function (standingsData) {
        var wrap = document.getElementById('standings-wrap');
        var empty = document.getElementById('standings-empty');
        renderSeriesStandingsAndStats(seriesId, standingsData, wrap, empty, rebuildNascarCupDayFromDaytona);
      })
      .catch(function () {
        var wrap = document.getElementById('standings-wrap');
        var empty = document.getElementById('standings-empty');
        if (wrap) wrap.querySelector('tbody').innerHTML = '';
        if (empty) { empty.classList.remove('hidden'); empty.textContent = t('standings.empty') || 'No standings data.'; }
      });

    fetchJSON(apiBase + '/events')
      .then(function (events) {
        var list = Array.isArray(events) ? events : [];
        if (list.length === 0 && isSeriesId(seriesId, 'f1') && window.TGA_STATIC_SCHEDULES && window.TGA_STATIC_SCHEDULES.f1) {
          var f1Stat = window.TGA_STATIC_SCHEDULES.f1;
          list = f1Stat.map(function (e) {
            return { id: '', name: e.grand_prix, start_date: '', end_date: '', circuit_name: e.circuit, location: '', date: e.date, has_detail: false };
          });
        }
        if (list.length === 0 && isSeriesId(seriesId, 'indycar') && window.TGA_STATIC_SCHEDULES && window.TGA_STATIC_SCHEDULES.indycarEvents) {
          var indyStat = window.TGA_STATIC_SCHEDULES.indycarEvents;
          list = indyStat.map(function (e) {
            var iso = (e.date && window.TGA && window.TGA.monthDayToISO) ? window.TGA.monthDayToISO(e.date) : '';
            return { id: e.event_id || '', name: e.name, start_date: iso, date: iso, circuit_name: e.track, location: e.location || '', time_est: e.est, has_detail: false };
          });
        }
        if (list.length === 0 && (isSeriesId(seriesId, 'f2') || isSeriesId(seriesId, 'f3')) && window.TGA_STATIC_SCHEDULES) {
          var key = isSeriesId(seriesId, 'f2') ? 'f2' : 'f3';
          var arr = window.TGA_STATIC_SCHEDULES[key];
          if (Array.isArray(arr)) {
            list = arr.map(function (e) {
              return { id: e.event_id || '', name: e.circuit || '', start_date: (e.sprint || e.feature || '').slice(0, 10), circuit_name: e.circuit, location: '', has_detail: false };
            });
          }
        }
        renderSeriesScheduleView(seriesId, list, scheduleTable, scheduleEmpty);
      })
      .catch(function () {
        renderSeriesScheduleView(seriesId, [], scheduleTable, scheduleEmpty);
      });

    if (isSeriesId(seriesId, 'f1')) {
      fetchJSON(apiBase + '/history')
        .then(function (historyData) {
          renderSeriesHistory(seriesId, Array.isArray(historyData) ? historyData : []);
        })
        .catch(function () {
          renderSeriesHistory(seriesId, []);
        });
    }
  }

  window.TGA.buildF1TeamsTableHTML = buildF1TeamsTableHTML;
  window.TGA.renderDetail = renderDetail;
  window.TGA.F1_2025_TEAMS = F1_2025_TEAMS;
  window.TGA.F1_2025_CHASSIS = F1_2025_CHASSIS;
  window.TGA.F1_2025_CHASSIS_BY_DRIVER = F1_2025_CHASSIS_BY_DRIVER;
  window.TGA.F1_2025_ENGINE = F1_2025_ENGINE;
  window.TGA.F1_2025_TECH_SPEC = F1_2025_TECH_SPEC;
})();
