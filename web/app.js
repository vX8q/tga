(function () {
  var fetchJSON = (window.TGA && window.TGA.fetchJSON) || function (url, opts) {
    return fetch(url, opts || {}).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  };
  var loadedSeriesId = null;
  var eventCache = {};
  /** Увеличивается при каждом вызове renderEventPage; отбрасываем устаревшие ответы fetch при быстром переключении вкладок. */
  var eventPageLoadGeneration = 0;

  // Отображаемое имя пилота (данные могут содержать псевдоним или "Name (N races)")
  var driverDisplayNames = { 'Cleetus Mitchell': 'Garrett Mitchell' };
  function driverDisplayName(name) {
    if (name == null || typeof name !== 'string') return name;
    var trimmed = name.trim();
    // Убираем кол-во гонок в скобках: "Spencer Boyd (22 races)" → "Spencer Boyd"
    var withoutRaces = trimmed.replace(/\s*\(\d+\s+races?\)\s*$/i, '').trim();
    return driverDisplayNames[withoutRaces] || driverDisplayNames[trimmed] || withoutRaces || trimmed;
  }

  // Пустое значение в ячейке → прочерк
  function dash(val) {
    if (val == null || val === '') return '—';
    if (typeof val === 'string' && val.trim() === '') return '—';
    return val;
  }

  // ─── i18n (English-only) ──────────────────────────────────────────────────
  var lang = 'en';
  var theme = (function () {
    try {
      var stored = localStorage.getItem('tga-theme');
      if (stored === 'light' || stored === 'dark') return stored;
    } catch (e) {}
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
    return 'dark';
  })();
  document.documentElement.setAttribute('data-theme', theme);

  var translations = (window.TGA_TRANSLATIONS || {});

  function t(key) {
    var tr = translations[lang];
    return (tr && tr[key] != null) ? tr[key] : (translations.en[key] || key);
  }

  function updateLangUI() {
    document.querySelectorAll('.lang-opt').forEach(function (opt) {
      opt.classList.toggle('active', opt.dataset.lang === lang);
    });
    var footer = document.getElementById('footer-text');
    if (footer) footer.textContent = t('footer');
    translateStaticUI();
  }
  function updateThemeUI() {
    var btn = document.getElementById('themeToggle');
    if (!btn) return;
    var opts = btn.querySelectorAll('.theme-opt');
    [].forEach.call(opts, function (opt) {
      opt.classList.toggle('active', opt.dataset.theme === theme);
    });
  }

  // Перевод ключей статистики гонки (lowercase → русский)
  var raceStatKeysRu = (window.TGA_RU && window.TGA_RU.raceStatKeysRu) || {};

  function localizeStatKey(key) {
    if (lang === 'en' || !key) return key;
    return raceStatKeysRu[key.toLowerCase().trim()] || key;
  }

  // Русские формы числительных: 1 → form1, 2-4 → form2, 5+ → form5
  function pluralRu(n, form1, form2, form5) {
    var abs = Math.abs(n) % 100;
    var n1  = abs % 10;
    if (abs > 10 && abs < 20) return form5;
    if (n1 === 1) return form1;
    if (n1 >= 2 && n1 <= 4) return form2;
    return form5;
  }

  function localizeStatValue(value) {
    if (!value) return value;
    var v = trimTrailingZeros(String(value));
    if (lang === 'en') return v;

    // "7 for 36 laps" → "7 за 36 кругов"
    v = v.replace(/(\d+)\s+for\s+(\d+)\s+laps?/gi, function (_, x, y) {
      return x + '\u00a0за\u00a0' + y + '\u00a0' + pluralRu(+y, 'круг', 'круга', 'кругов');
    });

    // "2 hours, 34 minutes and 21 seconds"
    v = v.replace(/(\d+)\s+hours?,\s*(\d+)\s+minutes?\s+and\s+(\d+)\s+seconds?/gi,
      function (_, h, m, s) {
        return h + '\u00a0' + pluralRu(+h, 'час', 'часа', 'часов') +
               ', ' + m + '\u00a0' + pluralRu(+m, 'минута', 'минуты', 'минут') +
               ' и ' + s + '\u00a0' + pluralRu(+s, 'секунда', 'секунды', 'секунд');
      });

    // "116.618 miles per hour (187.678 km/h)"
    v = v.replace(/([\d.,]+)\s+miles?\s+per\s+hour\s*\(([\d.,]+)\s*km\/h\)/gi,
      function (_, mph, kmh) { return mph + '\u00a0миль/ч\u00a0(' + kmh + '\u00a0км/ч)'; });

    // standalone "X miles per hour"
    v = v.replace(/([\d.,]+)\s+miles?\s+per\s+hour/gi,
      function (_, mph) { return mph + '\u00a0миль/ч'; });

    // "X.XXX miles" distance
    v = v.replace(/([\d.,]+)\s+miles?\b/gi,
      function (_, n) { return n + '\u00a0миль'; });

    // "X laps" remaining
    v = v.replace(/\b(\d+)\s+laps?/gi, function (_, n) {
      return n + '\u00a0' + pluralRu(+n, 'круг', 'круга', 'кругов');
    });

    return v;
  }

  // Ключи, которые нужно скрыть (служебные строки из Excel)
  var specKeySkip = { 'series': true, 'season': true };

  // ─── F1 static history (1950–2025) для /series/f1/history ─────────────────
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

  // "Generation / Chassis" → "Chassis" (убираем "Generation")
  function normalizeSpecKey(key) {
    if (!key) return key;
    return key.replace(/^generation\s*\/\s*chassis\b/i, 'Chassis')
              .replace(/^generation\s*\/\s*шасси\b/i,   'Шасси');
  }

  // Перевод ключей технических характеристик (lowercase → русский)
  var specKeyRu = (window.TGA_RU && window.TGA_RU.specKeyRu) || {};

  function localizeSpecKey(key) {
    if (!key) return key;
    var norm = normalizeSpecKey(key);
    if (lang === 'en') return norm;
    return specKeyRu[norm.toLowerCase().trim()] || norm;
  }

  // Перевод значений технических характеристик (паттерн-замены)
  function localizeSpecValue(val) {
    if (lang === 'en' || !val) return val;
    var v = String(val);

    // ── Единицы: сначала составные, затем одиночные ─────────────────────────
    v = v.replace(/\bcu\s+ft\/min\b/gi,           'куб.\u00a0футов/мин');
    v = v.replace(/\bft[\-]lb\b/gi,               'фунт-фут');
    v = v.replace(/\bN[\u00b7·]m\b/g,             'Н\u00b7м');
    v = v.replace(/\b(~?\d[\d.,\-]*)\s*Nm\b/g,    function (_, n) { return n + '\u00a0Н\u00b7м'; });
    v = v.replace(/\b(~?\d[\d.,\-]*)\s*kW\b/g,    function (_, n) { return n + '\u00a0кВт'; });
    v = v.replace(/\b(~?\d[\d.,\-]*)\s*hp\b/gi,   function (_, n) { return n + '\u00a0л.с.'; });
    v = v.replace(/\bUS\s+gal\b/gi,               'американских галлонов');
    v = v.replace(/\b(~?\d[\d.,\-]*)\s*gal\b/gi,  function (_, n) { return n + '\u00a0галл.'; });
    v = v.replace(/\bcu\s*in\b/gi,                'куб.\u00a0дюймов');
    v = v.replace(/\b(~?\d[\d.,\-]*)\s*mm\b/gi,   function (_, n) { return n + '\u00a0мм'; });
    v = v.replace(/\b(~?\d[\d.,\-]*)\s*in\b/gi,   function (_, n) { return n + '\u00a0дюймов'; });
    v = v.replace(/\b(~?\d[\d.,\-]*)\s*lbs?\b/gi, function (_, n) { return n + '\u00a0фунтов'; });
    v = v.replace(/\b(~?\d[\d.,\-]*)\s*kg\b/gi,   function (_, n) { return n + '\u00a0кг'; });
    v = v.replace(/\b(~?\d[\d.,\-]*)\s*L\b/g,     function (_, n) { return n + '\u00a0л'; });

    // ── Двигатель ─────────────────────────────────────────────────────────────
    v = v.replace(/\bnaturally\s+aspirated\b/gi,  'атмосферный');
    v = v.replace(/\bturbocharged\b/gi,           'турбированный');
    v = v.replace(/\bsupercharged\b/gi,           'компрессорный');
    v = v.replace(/\bpushrod\s+V8\b/gi,           'V8 с толкателями');
    v = v.replace(/\bpushrod\b/gi,                'с толкателями');
    v = v.replace(/\bcarbureted\b/gi,             'карбюраторный');
    v = v.replace(/\bcarburetor\b/gi,             'карбюратор');
    v = v.replace(/\bthrottle\s+body\b/gi,        'дроссельная заслонка');
    v = v.replace(/\bno\s+EFI\b/gi,              'без системы впрыска');
    v = v.replace(/\bEFI\s+not\s+permitted\b/gi, 'EFI не разрешён');
    v = v.replace(/\bwith\s+driver\b/gi,          'с водителем');
    v = v.replace(/\bunrestricted\b/gi,           'без ограничений');
    v = v.replace(/\brestricted\b/gi,             'с ограничением мощности');
    v = v.replace(/\brestricted\s+packages?\b/gi, 'пакеты с ограничением мощности');
    v = v.replace(/\b85%\s+unleaded\s+blend\s*\+\s*15%\s+ethanol\b/gi,
                  '85% неэтилированная смесь + 15% этанол');
    v = v.replace(/\bapprox\.?\b/gi,             '≈');

    // ── Привод ────────────────────────────────────────────────────────────────
    v = v.replace(/\brear[\-\s]wheel\s+drive\b/gi,        'задний');
    v = v.replace(/\bstandard\s+NASCAR\s+layout\b/gi,     'стандартная компоновка NASCAR');
    v = v.replace(/\bfront[\-\s]wheel\s+drive\b/gi,       'передний');
    v = v.replace(/\ball[\-\s]wheel\s+drive\b/gi,         'полный');
    v = v.replace(/\bfour[\-\s]wheel\s+drive\b/gi,        'полный');

    // ── Трансмиссия ───────────────────────────────────────────────────────────
    v = v.replace(/\bsequential\s+manual\b/gi,             'секвентальная механическая');
    v = v.replace(/\bno\s+sequential\s+gearbox\b/gi,      'отсутствие секвентальной КПП');
    v = v.replace(/\bsequential\b/gi,                     'секвентальная');
    v = v.replace(/\bH[\-]pattern\s+manual\s+gearbox\b/gi,'механическая КПП с H-образной схемой');
    v = v.replace(/\bH[\-]pattern\b/gi,                   'H-образная схема');
    v = v.replace(/\bmanual\s+gearbox\b/gi,               'механическая коробка передач');
    v = v.replace(/\bmanual\b/gi,                         'механическая');
    v = v.replace(/\bautomatic\b/gi,                      'автоматическая');
    v = v.replace(/\b(\d+)[\-\s]speed\b/gi,              '$1-ступенчатая');
    v = v.replace(/\bgearbox\b/gi,                        'коробка передач');
    v = v.replace(/\bseries\s+spec\b/gi,                  'спецификации серии');
    v = v.replace(/\bseries[\-\u2011]specific\b/gi,       'специализированная для серии');

    // ── Подвеска ──────────────────────────────────────────────────────────────
    v = v.replace(/\bindependent\s+double\s+wishbone\b/gi,  'независимая на двойных поперечных рычагах');
    v = v.replace(/\bdouble\s+wishbone\b/gi,                'двойные поперечные рычаги');
    v = v.replace(/\bshort[\-]long\s+arm\b/gi,             'рычажная подвеска неравной длины');
    v = v.replace(/\bsolid\s+rear\s+axle\b/gi,             'неразрезной мост');
    v = v.replace(/\blive\s+axle\b/gi,                     'неразрезной мост');
    v = v.replace(/\bindependent\s+front\s+and\s+rear\b/gi,'независимая передняя и задняя');
    v = v.replace(/\bindependent\b/gi,                     'независимая');
    v = v.replace(/\bcoil\/short\b/gi,                     'пружинная / производная от');
    v = v.replace(/\bseries[\-]approved\s+suspension\b/gi, 'одобренная серией подвеска');
    v = v.replace(/\bopen[,]?\s+modified[\-]specific\s+geometry\b/gi,
                  'специальная геометрия для модифицированных автомобилей');
    v = v.replace(/\bopen,\s+modified-specific\b/gi,       'открытая, специализированная');

    // ── Тормоза ───────────────────────────────────────────────────────────────
    v = v.replace(/\bsteel\s+disc\s+brakes?\b/gi,          'стальные дисковые тормоза');
    v = v.replace(/\bdisc\s+brakes?\b/gi,                  'дисковые тормоза');
    v = v.replace(/\bmultiple[\-]piston\s+calipers?\b/gi,  'многопоршневые суппорты');
    v = v.replace(/\b(\d+)[\-]piston\s+calipers?\b/gi,    function (_, n) { return n + '-поршневые суппорты'; });
    v = v.replace(/\bcalipers?\b/gi,                       'суппорты');

    // ── Кузов и шасси ─────────────────────────────────────────────────────────
    v = v.replace(/\bcomposite\/approved\s+truck\s+body\s+panels\b/gi,
                  'композитные/одобренные кузовные панели грузовика');
    v = v.replace(/\bstyled\s+to\s+production\s+pickup\b/gi,
                  'стилизованные под серийный пикап');
    v = v.replace(/\bstyled\s+to\s+manufacturer\s+brand\b/gi,
                  'стилизованные под бренд производителя');
    v = v.replace(/\bcomposite\s*\/\s*steel\s+arca[\-‑]approved\s+stock\s+car\s+body\b/gi,
                  'композитные / стальные одобренные ARCA кузовные панели сток-кара');
    v = v.replace(/\bcomposite\s+body\b/gi,                'композитный кузов');
    v = v.replace(/\bcomposite\b/gi,                       'композитные');
    v = v.replace(/\bsymmetrical\s+body\b/gi,              'симметричный кузов');
    v = v.replace(/\basymmetrical\b/gi,                    'асимметричный');
    v = v.replace(/\bsymmetrical\b/gi,                     'симметричный');
    v = v.replace(/\boffset\b/gi,                          'со смещением');
    v = v.replace(/\bsteel\s+tube\s+frame\b/gi,            'стальная трубчатая рама');
    v = v.replace(/\bsteel\s+tubular\s+chassis\b/gi,       'стальная трубчатая рама');
    v = v.replace(/\btubular\s+steel\s+frame\b/gi,         'стальная трубчатая рама');
    v = v.replace(/\bstandardized\s+tubular\s+steel\s+frame\b/gi,
                  'унифицированная стальная трубчатая рама');
    v = v.replace(/\bfabricator[\-']built\s+tubular\s+steel\s+chassis\b/gi,
                  'стальное трубчатое шасси, построенное производителем');
    v = v.replace(/\bsafety\s+roll\s+cage\b/gi,            'каркас безопасности');
    v = v.replace(/\broll\s+cage\b/gi,                     'каркас безопасности');
    v = v.replace(/\bintegrated\s+safety\s+roll\s+cage\b/gi, 'интегрированный каркас безопасности');
    v = v.replace(/\barca[\-‑]spec\s+chassis\b/gi,         'шасси спецификации ARCA');
    v = v.replace(/\bseries[\-]specific\s+truck\s+chassis\b/gi,
                  'специализированное шасси для грузовиков');
    v = v.replace(/\bopen[\-]wheel\b/gi,                   'открытые колёса');
    v = v.replace(/\bhand[\-]crafted\b/gi,                 'ручной работы');
    v = v.replace(/\bsheet\s+metal\b/gi,                   'листовой металл');
    v = v.replace(/\bonly\s+decal\s+branding\b/gi,         'только наклейки с брендами');
    v = v.replace(/\bno\s+manufacturer\s+chassis\/body\b/gi,
                  'нет шасси/кузова от автопроизводителя');
    v = v.replace(/\bsteel\b/gi,                           'стальные');

    // ── Колёса / Шины ─────────────────────────────────────────────────────────
    v = v.replace(/\bforged\s+aluminum\b/gi,               'кованые алюминиевые');
    v = v.replace(/\bsingle[\-\s]center[\-\s]lock[\-\s]nut\b/gi, 'крепление одной центральной гайкой');
    v = v.replace(/\bsingle[\-]lug\s+wheels?\b/gi,         'диски с одной гайкой');
    v = v.replace(/\bbias[\-]ply\b/gi,                     'диагональные');
    v = v.replace(/\bslicks?;?\s+rain\s+tires?\s+if\s+applicable\b/gi,
                  'слики; дождевые шины при необходимости');
    v = v.replace(/\bslick\b/gi,                           'слик');
    v = v.replace(/\bracing\s+tires?\b/gi,                 'гоночные шины');
    v = v.replace(/\b(\d+)[\-]lug\b/gi,                   function (_, n) { return n + '-шпилечные'; });
    v = v.replace(/\b(\d+)\s+lug\b/gi,                    function (_, n) { return n + '\u00a0шпилек'; });
    v = v.replace(/\bsteel\s+or\s+aluminum\b/gi,           'стальные или алюминиевые');
    v = v.replace(/\bseries[\-]approved\s+racing\s+wheels?\b/gi,
                  'одобренные серией гоночные диски');
    v = v.replace(/\bmodified[\-]spec\b/gi,                'спецификации Modified');

    // ── Аэродинамика / Днище ──────────────────────────────────────────────────
    v = v.replace(/\bfront\s+splitter\s*[,+]\s*rear\s+diffuser\b/gi,
                  'передний сплиттер + задний диффузор');
    v = v.replace(/\bfront\s+splitter\s*[,+]\s*rear\s+spoiler\b/gi,
                  'передний сплиттер, заднее антикрыло');
    v = v.replace(/\bapproved\s+front\s+air\s+dam\b/gi,   'одобренный передний воздушный дефлектор');
    v = v.replace(/\btruck\s+body\s+aero\s+package\b/gi,  'аэродинамический пакет кузова грузовика');
    v = v.replace(/\bseries\s+rules\b/gi,                 'правила серии');
    v = v.replace(/\bfront\s+splitter\b/gi,               'передний сплиттер');
    v = v.replace(/\brear\s+diffuser\b/gi,                'задний диффузор');
    v = v.replace(/\brear\s+spoiler\b/gi,                 'заднее антикрыло');
    v = v.replace(/\bno\s+splitter[,]?\s+no\s+diffuser\b/gi, 'нет сплиттера, нет диффузора');
    v = v.replace(/\bno\s+diffuser\b/gi,                  'без диффузора');
    v = v.replace(/\bflat\s+(bottom|floor)\b/gi,          'плоское дно');
    v = v.replace(/\bflat\s+floor\b/gi,                   'плоский пол');
    v = v.replace(/\bnasca?r[\-]mandated\b/gi,            'предписанные NASCAR');
    v = v.replace(/\bno\s+ground[\-]effect\s+devices\b/gi,'без устройств для создания эффекта земли');
    v = v.replace(/\bminimal\s+body\s+aero\b/gi,          'минимальный аэродинамический обвес кузова');

    // ── Безопасность ──────────────────────────────────────────────────────────
    v = v.replace(/\bHANS\s+device\b/gi,                  'устройство HANS');
    v = v.replace(/\b(\d+)[\-]point\s+harness\b/gi,       function (_, n) { return n + '-точечные ремни'; });
    v = v.replace(/\bonboard\s+fire\s+suppression\b/gi,   'бортовая система пожаротушения');
    v = v.replace(/\bstandard\s+NASCAR\b/gi,              'стандарт NASCAR');
    v = v.replace(/\bfire\s+suppression\b/gi,             'система пожаротушения');

    // ── Ключевые особенности ──────────────────────────────────────────────────
    v = v.replace(/\bcarburetor\s+or\s+series\s+spec\s+injection\s+engine\b/gi,
                  'карбюраторный или с впрыском спецификации серии двигатель');
    v = v.replace(/\bcarburetor\s+engine\b/gi,            'карбюраторный двигатель');
    v = v.replace(/\blive\s+rear\s+axle\b/gi,             'жёсткий задний мост');
    v = v.replace(/\bno\s+sequential\b/gi,                'без секвентальной');
    v = v.replace(/\bindependent\s+rear\s+suspension\b/gi,'независимая задняя подвеска');
    v = v.replace(/\brace\s+pickup\s+body\b/gi,           'кузов гоночного пикапа');
    v = v.replace(/\bstock\s+car\s+aero\b/gi,             'аэродинамика сток-кара');
    v = v.replace(/\blow[\-\s]downforce\b/gi,             'с низкой прижимной силой');

    return v;
  }

  // Перевод заголовков колонок таблиц из данных (lowercase → русский)
  var tableHeaderRu = (window.TGA_RU && window.TGA_RU.tableHeaderRu) || {};

  var carNumHeaders = { '#': true, 'no': true, 'no.': true, 'num': true, 'number': true };

  function localizeTableHeader(h) {
    if (!h) return h;
    var key = h.toLowerCase().trim();
    // Колонки с номером машины всегда показываем как "#"
    if (carNumHeaders[key]) return '#';
    if (lang === 'en') return h;
    return tableHeaderRu[key] || h;
  }

  // Перевод значений ячеек в колонках Notes / Status / Disqualification
  var cellNotesRu = (window.TGA_RU && window.TGA_RU.cellNotesRu) || {};

  function localizeCellNote(value) {
    if (lang === 'en' || !value) return value;
    return cellNotesRu[value.toLowerCase().trim()] || value;
  }

  // Переводы значений в колонке Reason / Free Pass и т.п.
  var raceReasonParts = (window.TGA_RU && window.TGA_RU.raceReasonParts) || [];

  function localizeRaceReason(value) {
    if (lang === 'en' || !value) return value;
    var exact = cellNotesRu[value.toLowerCase().trim()];
    if (exact) return exact;
    var v = value;
    for (var pi = 0; pi < raceReasonParts.length; pi++) {
      v = v.replace(raceReasonParts[pi][0], raceReasonParts[pi][1]);
    }
    return v;
  }

  // Имена колонок, в которых переводим значения ячеек
  var translateValueHeaders  = ['notes', 'note', 'status', 'disqualification', 'дисквалификация'];
  var translateReasonHeaders = ['reason', 'причина'];

  function localizeDate(str) {
    if (!str) return str;
    var s = String(str).trim();
    if (!s) return s;

    // ISO-формат даты YYYY-MM-DD или YYYY-MM-DDTHH:MM → "13 April 2025" / "13 апреля 2025"
    var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
    if (iso) {
      var year = parseInt(iso[1], 10);
      var monthIdx = parseInt(iso[2], 10) - 1;
      var day = parseInt(iso[3], 10);
      var monthsEn = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      var monthsRu = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
      if (monthIdx >= 0 && monthIdx < 12) {
        if (lang === 'ru') {
          return day + ' ' + monthsRu[monthIdx] + ' ' + year;
        }
        return day + ' ' + monthsEn[monthIdx] + ' ' + year;
      }
    }

    // Для уже человекочитаемых дат оставляем текущее поведение для ru, а для en — как есть.
    if (lang === 'en') return s;
    try {
      var d = new Date(s);
      if (isNaN(d.getTime())) return s;
      return d.toLocaleDateString('ru-RU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    } catch (e) { return s; }
  }

  // Убирает лишние нули: "2.500" → "2.5", "300.000" → "300", "4.0" → "4"
  function trimTrailingZeros(str) {
    if (!str) return str;
    return String(str)
      .replace(/\b(\d+)\.(\d*[1-9])0+\b/g, '$1.$2')
      .replace(/\b(\d+)\.0+\b/g, '$1');
  }

  function degRu(n) {
    var v = parseInt(n, 10), t = v % 100, d = v % 10;
    if (t >= 11 && t <= 14) return v + '\u00a0градусов';
    if (d === 1) return v + '\u00a0градус';
    if (d >= 2 && d <= 4) return v + '\u00a0градуса';
    return v + '\u00a0градусов';
  }

  function localizeTrackInfo(text) {
    if (!text || lang !== 'ru') return text;
    var s = text;

    var numTurns = {
      'one': 'одним', 'two': 'двумя', 'three': 'тремя', 'four': 'четырьмя',
      'five': 'пятью', 'six': 'шестью', 'seven': 'семью', 'eight': 'восемью'
    };
    var numCount = {
      'one': 'один', 'two': 'два', 'three': 'три', 'four': 'четыре',
      'five': 'пять', 'six': 'шесть', 'seven': 'семь', 'eight': 'восемь'
    };
    var typeRuMap = {
      'superspeedway': 'суперспидвей', 'speedway': 'спидвей',
      'oval': 'овал', 'track': 'трасса', 'oval track': 'овальный трек',
      'short track': 'короткий трек', 'road course': 'шоссейная трасса',
      'street course': 'уличная трасса'
    };

    function dotToCommaRu(v) { return String(v).replace('.', ','); }

    // ── Sentence-level patterns ──────────────────────────────────────────────

    // "The standard track at X is a N-turn TYPE that is D miles (K km) long."
    s = s.replace(
      /The standard track at (.+?) is a (one|two|three|four|five|six|seven|eight|\d+)-turn (\w+(?:\s+\w+)?) that is ([\d.]+) miles \(([\d.]+) km\) long\./gi,
      function(m, venue, n, type, dist, km) {
        var nRu = numTurns[n.toLowerCase()] || n;
        var typeRu = typeRuMap[type.toLowerCase()] || type;
        return 'Стандартная трасса в\u00a0' + venue + ' представляет собой ' + typeRu +
          ' с\u00a0' + nRu + ' поворотами протяжённостью\u00a0' +
          dotToCommaRu(dist) + '\u00a0мили (' + dotToCommaRu(km) + '\u00a0км).';
      }
    );

    // "The track's turns are banked at N degrees, while the front stretch, the location of the finish line, is banked at M degrees."
    s = s.replace(
      /The track's turns are banked at (\d+) degrees, while the front stretch, the location of the finish line, is banked at (\d+) degrees\./gi,
      function(m, n1, n2) {
        return 'Повороты трассы имеют уклон в\u00a0' + degRu(n1) +
          ', в\u00a0то время как передняя прямая, на\u00a0которой расположена финишная черта, имеет уклон в\u00a0' + degRu(n2) + '.';
      }
    );

    // "X Speedway is a high-banked[,] half-mile oval [race]track located near Y[, Z]."
    s = s.replace(
      /(.+?)\s+is a high-banked,?\s+half-mile oval (?:race)?track located near (.+?)\./gi,
      '$1\u00a0— это овальный трек с\u00a0высокими виражами длиной в\u00a0полмили, расположенный недалеко от\u00a0$2.'
    );

    // "Its asphalt surface is D miles (K km) long with N turns banked at M degrees, making it one of the fastest short tracks in the United States."
    s = s.replace(
      /Its asphalt surface is ([\d.]+) miles \(([\d.]+) km\) long with (one|two|three|four|five|six|seven|eight|\d+) turns banked at (\d+) degrees, making it one of the faster(?:st)? short tracks in the United States\./gi,
      function(m, dist, km, n, deg) {
        var nRu = numCount[n.toLowerCase()] || n;
        return 'Его асфальтовое покрытие длиной\u00a0' + dotToCommaRu(dist) + '\u00a0мили (' +
          dotToCommaRu(km) + '\u00a0км) имеет\u00a0' + nRu + '\u00a0поворота с\u00a0уклоном\u00a0' + degRu(deg) +
          ', что делает его одним из\u00a0самых быстрых коротких треков в\u00a0Соединённых Штатах.';
      }
    );

    // "The D-mile (K km) asphalt surface features N turns with M-degree banking, making it one of the faster[st] short tracks in the United States."
    s = s.replace(
      /The ([\d.]+)-mile \(([\d.]+) km\) asphalt surface features (one|two|three|four|five|six|seven|eight|\d+) turns with (\d+)-degree banking, making it one of the faster(?:st)? short tracks in the United States\./gi,
      function(m, dist, km, n, deg) {
        var nRu = numCount[n.toLowerCase()] || n;
        return 'Его асфальтовое покрытие длиной\u00a0' + dotToCommaRu(dist) + '\u00a0мили (' +
          dotToCommaRu(km) + '\u00a0км) имеет\u00a0' + nRu + '\u00a0поворота с\u00a0уклоном\u00a0' + degRu(deg) +
          ', что делает его одним из\u00a0самых быстрых коротких треков в\u00a0Соединённых Штатах.';
      }
    );

    // "The straightaways are relatively flat compared to the turns/corners, while the [turns'/steep] banking ... promotes close, [side-by-side/competitive] racing."
    s = s.replace(
      /The straightaways are relatively flat compared to the (?:turns|corners), while the turns' steep banking helps maintain speed through(?:out)? each lap and promotes close, competitive racing\./gi,
      'Прямые участки относительно плоские по\u00a0сравнению с\u00a0виражами, в\u00a0то время как крутые уклоны поворотов помогают поддерживать скорость на\u00a0каждом круге и\u00a0способствуют плотной, бескомпромиссной борьбе.'
    );
    s = s.replace(
      /The straightaways are relatively flat compared to the (?:turns|corners), while the steep banking in the turns helps maintain speed through(?:out)? each lap and promotes close, side-by-side racing\./gi,
      'Прямые участки относительно плоские по\u00a0сравнению с\u00a0виражами, в\u00a0то время как крутые уклоны поворотов помогают поддерживать скорость на\u00a0каждом круге и\u00a0способствуют плотной, бескомпромиссной борьбе.'
    );

    // ── General phrase fallbacks ─────────────────────────────────────────────
    s = s.replace(/\bsuperspeedway\b/gi, 'суперспидвей');
    s = s.replace(/\boval track\b/gi, 'овальный трек');
    s = s.replace(/\bshort track\b/gi, 'короткий трек');
    s = s.replace(/\broad course\b/gi, 'шоссейная трасса');
    s = s.replace(/\bstreet course\b/gi, 'уличная трасса');
    s = s.replace(/\bspeedway\b/gi, 'спидвей');
    s = s.replace(/\bhigh-banked\b/gi, 'с\u00a0высокими виражами');
    s = s.replace(/\bhalf-mile\b/gi, 'полумильный');
    s = s.replace(/\bthe finish line\b/gi, 'финишная черта');
    s = s.replace(/\bthe front stretch\b/gi, 'передняя прямая');
    s = s.replace(/\bthe back stretch\b/gi, 'задняя прямая');
    s = s.replace(/\bbanked at (\d+) degrees\b/gi, function(m, n) { return 'с\u00a0уклоном\u00a0' + degRu(n); });
    s = s.replace(/\bis banked at (\d+) degrees\b/gi, function(m, n) { return 'имеет уклон в\u00a0' + degRu(n); });
    s = s.replace(/\b(\d+(?:[\.,]\d+)?) miles \(([\d.,]+) km\)/gi, function(m, mi, km) {
      return dotToCommaRu(mi) + '\u00a0мили\u00a0(' + dotToCommaRu(km) + '\u00a0км)';
    });
    s = s.replace(/\bdegrees\b/gi, 'градусов');
    s = s.replace(/\bbanking\b/gi, 'уклон');
    s = s.replace(/\bstraightaway(s)?\b/gi, function(m, pl) { return pl ? 'прямые участки' : 'прямой участок'; });
    s = s.replace(/\bturns?\b/gi, function(m) { return m === 'turn' ? 'поворот' : 'повороты'; });
    s = s.replace(/\b, while\b/gi, ', в\u00a0то время как');
    s = s.replace(/\bwhile\b/gi, 'в\u00a0то время как');
    s = s.replace(/in the United States\b/gi, 'в\u00a0Соединённых Штатах');
    s = s.replace(/located near\b/gi, 'расположенный недалеко от');
    s = s.replace(/located in\b/gi, 'расположенный в');
    s = s.replace(/\basphalt\b/gi, 'асфальтовое');
    s = s.replace(/\bconcrete\b/gi, 'бетонное');
    s = s.replace(/\bflat\b/gi, 'плоский');
    s = s.replace(/\bsteep\b/gi, 'крутой');

    return s;
  }

  function localizeDistance(str) {
    if (!str) return str;
    var s = trimTrailingZeros(str);
    if (lang === 'en') return s;
    return s
      .replace(/\b([\d,.]+)\s*miles?\b/gi,  function (_, n) { return n + '\u00a0миль'; })
      .replace(/\bpaved\s+track\b/gi,        'асфальтированная трасса')
      .replace(/\bsuperspeedway\b/gi,        'суперспидвей')
      .replace(/\bshort\s+track\b/gi,        'короткая трасса')
      .replace(/\broad\s+course\b/gi,        'шоссейная трасса')
      .replace(/\bstreet\s+course\b/gi,      'уличная трасса')
      .replace(/\boval\b/gi,                 'овал')
      .replace(/\bkm\b/gi,                   'км');
  }

  function translateStaticUI() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      var val = t(key);
      if (val && val !== key) el.textContent = val;
    });
  }

  function setLang(newLang) {
    if (lang === newLang) return;
    lang = newLang;
    localStorage.setItem('tga-lang', lang);
    // Сбрасываем кеши чтобы всё перерисовалось с новым языком
    eventCache = {};
    loadedSeriesId = null;
    var sl = document.getElementById('series-list');
    if (sl) sl._listLoaded = false;
    updateLangUI();
    route();
  }
  // ──────────────────────────────────────────────────────────────────────────

  function setTheme(newTheme) {
    if (newTheme !== 'light' && newTheme !== 'dark') newTheme = 'dark';
    if (theme === newTheme) return;
    theme = newTheme;
    try { localStorage.setItem('tga-theme', theme); } catch (e) {}
    document.documentElement.setAttribute('data-theme', theme);
    updateThemeUI();
  }

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

  window.addEventListener('resize', function () {
    adjustEventPanelPadding();
    adjustDetailPanelPadding();
  });

  function esc(s) {
    if (s == null) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // Статический рендер Car Specs для Supercars (на случай, если API не отвечает)
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
    makeTableSortable(modelsWrap.querySelector('.data-table'), carModels.map(function (c) { return [c.manufacturer, c.model]; }), esc);

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
    makeTableSortable(techWrap.querySelector('.data-table'), techSpec.map(function (s) { return [s.key, s.value]; }), esc);

    // Engines
    if (enginesWrap && enginesTitle) {
      enginesWrap.classList.remove('hidden');
      enginesTitle.classList.remove('hidden');
      enginesWrap.innerHTML =
        '<div class="table-wrap"><table class="data-table"><thead><tr><th>Car model</th><th>Engine specification</th></tr></thead><tbody>' +
        engines.map(function (e) {
          return '<tr><td>' + esc(dash(e.model)) + '</td><td>' + esc(dash(e.spec)) + '</td></tr>';
        }).join('') +
        '</tbody></table></div>';
      makeTableSortable(enginesWrap.querySelector('.data-table'), engines.map(function (e) { return [e.model, e.spec]; }), esc);
    }

    // Homologation
    if (homologWrap && homologTitle) {
      homologWrap.classList.remove('hidden');
      homologTitle.classList.remove('hidden');
      homologWrap.innerHTML =
        '<div class="table-wrap"><table class="data-table"><thead><tr><th>Manufacturer</th><th>Homologating team</th></tr></thead><tbody>' +
        homologation.map(function (h) {
          return '<tr><td>' + esc(dash(h.manufacturer)) + '</td><td>' + esc(dash(h.team)) + '</td></tr>';
        }).join('') +
        '</tbody></table></div>';
      makeTableSortable(homologWrap.querySelector('.data-table'), homologation.map(function (h) { return [h.manufacturer, h.team]; }), esc);
    }
  }

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

  function typeLabel(t) {
    var labels = {
      openwheel: 'Open wheel',
      gt_endurance: 'GT Endurance',
      gt_sprint: 'GT Sprint',
      touring: 'Touring',
      stock_car_racing: 'Stock car',
      single_make: 'Single make'
    };
    return labels[t] || t || '—';
  }

  function countryDisplay(country) {
    if (!country) return { icon: '', label: '—' };
    var c = String(country).toUpperCase();
    if (c === 'USA') return { icon: '\uD83C\uDDFA\uD83C\uDDF8', label: 'USA' };
    if (c === 'ITALY') return { icon: '\uD83C\uDDEE\uD83C\uDDF9', label: 'Italy' };
    if (c === 'FIA') return { icon: '\uD83C\uDF10', label: 'World' };
    if (c === 'EUROPE') return { icon: '', label: 'Europe' };
    return { icon: '', label: country };
  }

  function countryHtml(country) {
    var d = countryDisplay(country);
    return esc(d.label);
  }

  function syncStandingsScrollBars() { /* верхняя полоска удалена */ }

  var categories = [
    { key: 'openwheel', ids: ['F1', 'INDYCAR', 'SUPER_FORMULA', 'F2', 'F3', 'FREC', 'F4_IT', 'SMP_F4_RU'] },
    { key: 'stockcar',  ids: ['NASCAR_CUP', 'NOAPS', 'NASCAR_TRUCK', 'ARCA', 'NASCAR_MODIFIED'] },
    { key: 'endurance', ids: ['WEC', 'ELMS', 'IMSA'] },
    // В Touring сначала показываем Supercars
    { key: 'touring',   ids: ['SUPERCARS', 'GTWCE_END', 'GTWCE_SPRINT', 'PSC', 'DTM', 'SUPER_GT'] }
  ];

  // ── Категория по ID серии ─────────────────────────────────────────────────
  var categoryBySeriesId = {};
  categories.forEach(function (cat) {
    cat.ids.forEach(function (id) {
      categoryBySeriesId[id] = cat.key;
      categoryBySeriesId[id.toLowerCase()] = cat.key;
    });
  });

  var categoryColors = (window.TGA_CATEGORY_COLORS || {});

  // Уникальный цвет для каждой серии (если не задан — берём цвет категории)
  var seriesColors = (window.TGA_SERIES_COLORS || {});

  var seriesShort = (window.TGA_SERIES_SHORT || {});

  // hex → r,g,b для rgba()
  function hexRgb(hex) {
    var r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return r+','+g+','+b;
  }

  function seriesBadge(seriesId) {
    var sid = (seriesId || '').toLowerCase();
    var cat = categoryBySeriesId[sid] || categoryBySeriesId[seriesId] || 'openwheel';
    var color = seriesColors[(seriesId || '').toUpperCase()] || categoryColors[cat] || '#888888';
    var rgb = hexRgb(color);
    var label = seriesShort[seriesId] || seriesShort[(seriesId || '').toUpperCase()] || seriesId;
    return '<span class="series-badge" style="color:' + color + ';background:rgba(' + rgb + ',0.1);border:1px solid rgba(' + rgb + ',0.22)">' + esc(label) + '</span>';
  }

  function formatShortDate(dateStr) {
    if (!dateStr) return '—';
    var d = new Date(dateStr + 'T12:00:00');
    if (isNaN(d.getTime())) return dateStr;
    var months_en = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var months_ru = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
    var day = d.getDate();
    var mon = lang === 'ru' ? months_ru[d.getMonth()] : months_en[d.getMonth()];
    return lang === 'ru' ? day + ' ' + mon : mon + ' ' + day;
  }

  function formatDateRange(startDs, endDs) {
    if (!startDs) return '—';
    var months_en = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var months_ru = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
    var d1 = new Date(startDs + 'T12:00:00');
    if (!endDs || startDs === endDs) {
      var day = d1.getDate();
      var mon = lang === 'ru' ? months_ru[d1.getMonth()] : months_en[d1.getMonth()];
      return lang === 'ru' ? day + ' ' + mon : mon + ' ' + day;
    }
    var d2 = new Date(endDs + 'T12:00:00');
    var d1day = d1.getDate(), d2day = d2.getDate();
    var m1 = lang === 'ru' ? months_ru[d1.getMonth()] : months_en[d1.getMonth()];
    var m2 = lang === 'ru' ? months_ru[d2.getMonth()] : months_en[d2.getMonth()];
    if (d1.getMonth() === d2.getMonth()) {
      return lang === 'ru' ? d1day + '\u2013' + d2day + '\u00a0' + m1 : m1 + '\u00a0' + d1day + '\u2013' + d2day;
    }
    return lang === 'ru'
      ? d1day + '\u00a0' + m1 + '\u2013' + d2day + '\u00a0' + m2
      : m1 + '\u00a0' + d1day + '\u2013' + m2 + '\u00a0' + d2day;
  }

  /** Диапазон дат с полным названием месяца для страницы события: "March 5–8, 2026" */
  function formatDateRangeLong(startDs, endDs) {
    if (!startDs) return '';
    var monthsEn = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    var monthsRu = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    var d1 = new Date((startDs + '').slice(0, 10) + 'T12:00:00');
    var endIso = (endDs || '').slice(0, 10);
    var year = (startDs + '').slice(0, 4);
    if (!endIso || endIso === (startDs + '').slice(0, 10)) {
      var day = d1.getDate();
      var mon = lang === 'ru' ? monthsRu[d1.getMonth()] : monthsEn[d1.getMonth()];
      return lang === 'ru' ? day + ' ' + mon + ' ' + year : mon + ' ' + day + ', ' + year;
    }
    var d2 = new Date(endIso + 'T12:00:00');
    var d1day = d1.getDate(), d2day = d2.getDate();
    var m1 = lang === 'ru' ? monthsRu[d1.getMonth()] : monthsEn[d1.getMonth()];
    var m2 = lang === 'ru' ? monthsRu[d2.getMonth()] : monthsEn[d2.getMonth()];
    if (d1.getMonth() === d2.getMonth()) {
      return lang === 'ru' ? d1day + '\u2013' + d2day + ' ' + m1 + ' ' + year : m1 + ' ' + d1day + '\u2013' + d2day + ', ' + year;
    }
    return lang === 'ru'
      ? d1day + ' ' + m1 + '\u2013' + d2day + ' ' + m2 + ' ' + year
      : m1 + ' ' + d1day + '\u2013' + m2 + ' ' + d2day + ', ' + year;
  }

  /** Парсит дату из meta.Date вида "Thu 05 Mar 2026" в ISO YYYY-MM-DD. */
  function parseMetaDateToISO(str) {
    if (!str || typeof str !== 'string') return null;
    var m = str.match(/(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/);
    if (!m) return null;
    var day = ('0' + parseInt(m[1], 10)).slice(-2);
    var monMap = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
    var monKey = String(m[2] || '').slice(0, 3).toLowerCase();
    var mm = monMap[monKey];
    if (!mm) return null;
    return m[3] + '-' + mm + '-' + day;
  }

  /** Собирает мин/макс даты: d.start_date / d.end_date и сессии в d.tables (meta.Date). */
  function getEventSessionDateRange(d) {
    if (!d || typeof d !== 'object') return null;
    var minIso = null;
    var maxIso = null;
    function addIso(iso) {
      if (!iso) return;
      if (!minIso || iso < minIso) minIso = iso;
      if (!maxIso || iso > maxIso) maxIso = iso;
    }
    function addIsoFromTopLevel(field) {
      if (field == null || field === '') return;
      var s = String(field).trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) addIso(s.slice(0, 10));
    }
    addIsoFromTopLevel(d.start_date);
    addIsoFromTopLevel(d.end_date);
    function collectFromMeta(meta) {
      if (meta && typeof meta.Date === 'string') {
        var iso = parseMetaDateToISO(meta.Date);
        if (iso) addIso(iso);
      }
    }
    if (d.tables && typeof d.tables === 'object') {
      Object.keys(d.tables).forEach(function (key) {
        var tbl = d.tables[key];
        if (!tbl) return;
        collectFromMeta(tbl.meta);
        if (Array.isArray(tbl.sessions)) {
          tbl.sessions.forEach(function (sess) {
            collectFromMeta(sess && sess.meta);
          });
        }
      });
    }
    if (!minIso && !maxIso) return null;
    return { minIso: minIso || maxIso, maxIso: maxIso || minIso };
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

  /** Таблица стейджа: предпочтительно stage_n, иначе legacy stageN. */
  function tgaStageTable(tables, n) {
    if (!tables) return null;
    var u = 'stage_' + n;
    var leg = 'stage' + n;
    var a = tables[u];
    var b = tables[leg];
    if (a && a.headers && a.headers.length) return a;
    if (b && b.headers && b.headers.length) return b;
    return null;
  }

  var renderNextRaceCards = (window.TGA && window.TGA.renderNextRaceCards) || function () {};
  var stopNextRaceTimers = (window.TGA && window.TGA.stopNextRaceTimers) || function () {};

  // ── Global schedule helpers ───────────────────────────────────────────────
  var globalEventsCache = null; // кэш всех событий

  /** События, скрытые из списка и Full Schedule (оставлено на будущее, сейчас не скрываем ничего). */
  function filterVisibleEvents(events) {
    if (!Array.isArray(events)) return events;
    return events;
  }

  var buildScheduleGroups = (window.TGA && window.TGA.buildScheduleGroups) || function () { return []; };
  var buildScheduleHTML = (window.TGA && window.TGA.buildScheduleHTML) || function () {};

  var scheduleHidePast = false;

  function applySchedulePastVisibility() {
    var root = document.getElementById('view-schedule');
    if (!root) return;
    var pastRows = root.querySelectorAll('.weekend-hdr.sched-past, .sched-row.sched-past');
    [].forEach.call(pastRows, function (tr) {
      tr.style.display = scheduleHidePast ? 'none' : '';
    });
  }

  // Expose deps for components (next-race-cards, schedule, list)
  (function () {
    window.TGA = window.TGA || {};
    window.TGA.t = t;
    window.TGA.esc = esc;
    window.TGA.driverDisplayName = driverDisplayName;
    window.TGA.seriesBadge = seriesBadge;
    window.TGA.formatShortDate = formatShortDate;
    window.TGA.formatDateRange = formatDateRange;
    window.TGA.formatDateRangeLong = formatDateRangeLong;
    window.TGA.parseMetaDateToISO = parseMetaDateToISO;
    window.TGA.getEventSessionDateRange = getEventSessionDateRange;
    window.TGA.parseEventDate = parseEventDate;
    window.TGA.applySchedulePastVisibility = applySchedulePastVisibility;
    window.TGA.makeSimpleTableSortable = typeof makeSimpleTableSortable !== 'undefined' ? makeSimpleTableSortable : function () {};
  })();

  // month name + day (e.g. "March 1") → ISO date "2026-03-01"
  function monthDayToISO(md) {
    if (!md) return '';
    md = String(md).trim();
    var m = md.match(/^([A-Za-z]+)\s+(\d+)/);       // "March 8"
    var mRev = !m && md.match(/^(\d+)\s+([A-Za-z]+)/); // "8 March"
    if (!m && !mRev) return '';
    var monthName = (m ? m[1] : mRev[2]).toLowerCase();
    var dayNum = m ? m[2] : mRev[1];
    var day = ('0' + parseInt(dayNum, 10)).slice(-2);
    var months = {
      january: '01', february: '02', march: '03', april: '04',
      may: '05', june: '06', july: '07', august: '08',
      september: '09', october: '10', november: '11', december: '12'
    };
    var mm = months[monthName];
    if (!mm) return '';
    return '2026-' + mm + '-' + day;
  }

  function fetchAllEvents(seriesData) {
    var allIds = [];
    categories.forEach(function (c) { c.ids.forEach(function (id) { allIds.push(id); }); });
    var byId = {};
    seriesData.forEach(function (s) { byId[s.id] = s; });
    var relevant = allIds.map(function (id) { return byId[id]; }).filter(Boolean);

    return Promise.all(relevant.map(function (s) {
      var se = String((s.season != null && s.season !== '') ? s.season : '2026').trim();
      return fetchJSON('/api/series/' + encodeURIComponent((s.id || '').toLowerCase()) + '/events?season=' + encodeURIComponent(se) + '&_=' + Date.now())
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

      // Добавляем статические расписания для F1 / INDYCAR / F2, если у серии нет своих events
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

      // Pre-Season Testing для F1 (отображение в расписании и на странице серии; детали из data/events)
      if (byId['F1']) {
        [
          { start: 'February 11', end: 'February 13', name: 'Pre-Season Testing 1', circuit: 'Bahrain International Circuit', time_est: '10:00–19:00', id: 'F1_2026_PRE_SEASON_TEST_1', has_detail: true },
          { start: 'February 18', end: 'February 20', name: 'Pre-Season Testing 2', circuit: 'Bahrain International Circuit', time_est: '10:00–19:00', id: 'F1_2026_PRE_SEASON_TEST_2', has_detail: true }
        ].forEach(function (e) {
          var isoStart = monthDayToISO(e.start);
          var isoEnd = monthDayToISO(e.end);
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
          { date: 'March 8',  name: 'Australian Grand Prix',          circuit: 'Australia — Albert Park Circuit, Melbourne' },
          { date: 'March 15', name: 'Chinese Grand Prix',             circuit: 'China — Shanghai International Circuit, Shanghai' },
          { date: 'March 29', name: 'Japanese Grand Prix',            circuit: 'Japan — Suzuka Circuit, Suzuka' },
          { date: 'April 12', name: 'Bahrain Grand Prix',             circuit: 'Bahrain — Bahrain International Circuit, Sakhir' },
          { date: 'April 19', name: 'Saudi Arabian Grand Prix',       circuit: 'Saudi Arabia — Jeddah Corniche Circuit, Jeddah' },
          { date: 'May 3',    name: 'Miami Grand Prix',               circuit: 'United States — Miami International Autodrome, Miami Gardens, Florida' },
          { date: 'May 24',   name: 'Canadian Grand Prix',            circuit: 'Canada — Circuit Gilles Villeneuve, Montreal' },
          { date: 'June 7',   name: 'Monaco Grand Prix',              circuit: 'Monaco — Circuit de Monaco, Monaco' },
          { date: 'June 14',  name: 'Barcelona-Catalunya Grand Prix', circuit: 'Spain — Circuit de Barcelona-Catalunya, Montmeló' },
          { date: 'June 28',  name: 'Austrian Grand Prix',            circuit: 'Austria — Red Bull Ring, Spielberg' },
          { date: 'July 5',   name: 'British Grand Prix',             circuit: 'United Kingdom — Silverstone Circuit, Silverstone' },
          { date: 'July 19',  name: 'Belgian Grand Prix',             circuit: 'Belgium — Circuit de Spa-Francorchamps, Stavelot' },
          { date: 'July 26',  name: 'Hungarian Grand Prix',           circuit: 'Hungary — Hungaroring, Mogyoród' },
          { date: 'August 23',name: 'Dutch Grand Prix',               circuit: 'Netherlands — Circuit Zandvoort, Zandvoort' },
          { date: 'September 6', name: 'Italian Grand Prix',          circuit: 'Italy — Monza Circuit, Monza' },
          { date: 'September 13', name: 'Spanish Grand Prix',         circuit: 'Spain — Madring, Madrid' },
          { date: 'September 26', name: 'Azerbaijan Grand Prix',      circuit: 'Azerbaijan — Baku City Circuit, Baku' },
          { date: 'October 11', name: 'Singapore Grand Prix',         circuit: 'Singapore — Marina Bay Street Circuit, Singapore' },
          { date: 'October 25', name: 'United States Grand Prix',    circuit: 'United States — Circuit of the Americas, Austin, Texas' },
          { date: 'November 1', name: 'Mexico City Grand Prix',      circuit: 'Mexico — Autódromo Hermanos Rodríguez, Mexico City' },
          { date: 'November 8', name: 'São Paulo Grand Prix',        circuit: 'Brazil — Interlagos Circuit, São Paulo' },
          { date: 'November 21', name: 'Las Vegas Grand Prix',       circuit: 'United States — Las Vegas Strip Circuit, Paradise, Nevada' },
          { date: 'November 29', name: 'Qatar Grand Prix',           circuit: 'Qatar — Lusail International Circuit, Lusail' },
          { date: 'December 6', name: 'Abu Dhabi Grand Prix',        circuit: 'United Arab Emirates — Yas Marina Circuit, Abu Dhabi' }
        ];
        f1Stat.forEach(function (e) {
          var iso = monthDayToISO(e.date);
          // По умолчанию: знаем только локальное время Австралии (Round 1).
          var timeLocal = '';
          var timeMsk = '';
          if (e.name === 'Australian Grand Prix') {
            // Local 15:00 → MSK 07:00 (UTC+3, −8 часов)
            timeLocal = '15:00';
            timeMsk = '07:00';
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

      if (!haveF2 && byId['F2']) {
        var f2Stat = [
          { round: 1,  sprint: '7 March',      feature: '8 March',      circuit: 'Australia — Albert Park Circuit, Melbourne' },
          { round: 2,  sprint: '11 April',     feature: '12 April',     circuit: 'Bahrain — Bahrain International Circuit, Sakhir' },
          { round: 3,  sprint: '18 April',     feature: '19 April',     circuit: 'Saudi Arabia — Jeddah Corniche Circuit, Jeddah' },
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
          var isoSprint = monthDayToISO(e.sprint);
          var isoFeature = monthDayToISO(e.feature);

          // Отдельная строка для Sprint Race
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

          // Отдельная строка для Feature Race
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

      if (!haveF3 && byId['F3']) {
        var f3Stat = [
          { round: 1,  sprint: '7 March',      feature: '8 March',      circuit: 'Australia — Albert Park Circuit, Melbourne' },
          { round: 2,  sprint: '11 April',     feature: '12 April',     circuit: 'Bahrain — Bahrain International Circuit, Sakhir' },
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
          var isoSprint = monthDayToISO(e.sprint);
          var isoFeature = monthDayToISO(e.feature);

          // Отдельная строка для Sprint Race
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

          // Отдельная строка для Feature Race
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
        var da = a.start_date || a.date || '', db = b.start_date || b.date || '';
        return da < db ? -1 : da > db ? 1 : 0;
      });
      return all;
    });
  }

  function loadGlobalSchedule(seriesData) {
    var nrRow = document.getElementById('next-races-row');
    if (nrRow) nrRow.classList.add('hidden');

    fetchAllEvents(seriesData).then(function (all) {
      var visible = filterVisibleEvents(all);
      globalEventsCache = visible;
      if (window.TGA && typeof window.TGA.setGlobalEventsCache === 'function') {
        window.TGA.setGlobalEventsCache(visible);
      }
      renderNextRaceCards(visible);
      if (window.TGA && typeof window.TGA.renderLastResultsCards === 'function') {
        window.TGA.renderLastResultsCards(all);
      }
    });
  }

  window.TGA.categories = categories;
  window.TGA.countryHtml = countryHtml;
  window.TGA.loadGlobalSchedule = loadGlobalSchedule;

  // ── Schedule page ─────────────────────────────────────────────────────────
  function renderSchedulePage() {
    showView('view-schedule');
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

    // Обновить заголовки (одна колонка Time)
    var ths = document.querySelectorAll('#view-schedule thead th[data-col]');
    [].forEach.call(ths, function (th) {
      var map = {
        series: t('home.series_col'),
        race: t('th.race_col'),
        date: 'Date',
        location: t('th.location'),
        time: t('th.time')
      };
      var v = map[th.getAttribute('data-col')];
      if (v) th.textContent = v;
    });

    // Переключатель времени: при смене — обновить настройки и перерисовать полное расписание
    var timeZoneSelect = document.getElementById('time-zone-select');
    if (timeZoneSelect && !timeZoneSelect._bound) {
      timeZoneSelect._bound = true;
      // Синхронизируем начальное значение с сохранёнными настройками (localStorage),
      // чтобы подпись соответствовала фактическому режиму времени в расписании.
      var getTimeSettings = (window.TGA && window.TGA.getTimeSettings) || null;
      if (getTimeSettings) {
        try {
          var ts = getTimeSettings();
          if (ts && ts.timeZone) timeZoneSelect.value = ts.timeZone;
        } catch (e) {}
      }
      timeZoneSelect.addEventListener('change', function () {
        var setTimeSettings = (window.TGA && window.TGA.setTimeSettings) || function () {};
        setTimeSettings({ timeZone: timeZoneSelect.value === 'track' ? 'track' : 'my' });
        if (globalEventsCache && (window.TGA.buildScheduleHTML)) {
          window.TGA.buildScheduleHTML(globalEventsCache, 'sched-page-body');
        }
      });
    }

    // Инициализация переключателя "Hide past races"
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
        var visible = filterVisibleEvents(all);
        globalEventsCache = visible;
        if (window.TGA && typeof window.TGA.setGlobalEventsCache === 'function') {
          window.TGA.setGlobalEventsCache(visible);
        }
        buildScheduleHTML(visible, 'sched-page-body');
      })
      .catch(function () {
        if (body) body.innerHTML = '<tr><td colspan="5">' + t('error.no_data') + '</td></tr>';
      });
  }

  var renderList = (window.TGA && window.TGA.renderList) || function () {};

  function renderDetail(seriesId, subPath) {
    subPath = subPath || '';
    // IMSA: в URL может быть /specs, в приложении вкладка называется "classes"
    if ((seriesId || '').toLowerCase() === 'imsa' && subPath === 'specs') subPath = 'classes';
    var detailTitle = document.getElementById('detail-title');
    var detailMeta = document.getElementById('detail-meta');
    var detailBreadcrumb = document.getElementById('detail-breadcrumb');
    var seriesNav = document.getElementById('series-nav');
    var schedulePanel = document.getElementById('schedule-panel');
    var standingsPanel = document.getElementById('standings-panel');
    var teamsPanel = document.getElementById('teams-panel');
    var specsPanel = document.getElementById('specs-panel');
    var statsPanel = document.getElementById('stats-panel');
    var historyPanel = document.getElementById('history-panel');
    var teamsBody = document.querySelector('#teams-table tbody');
    var teamsFulltimeBody = document.querySelector('#teams-fulltime-table tbody');
    var teamsParttimeBody = document.querySelector('#teams-parttime-table tbody');
    var teamsNoncharteredBody = document.querySelector('#teams-nonchartered-table tbody');
    var teamsEnduranceBody = document.querySelector('#teams-endurance-table tbody');
    var teamsWildcardBody = document.querySelector('#teams-wildcard-table tbody');
    var standingsBody = document.querySelector('#standings-table tbody');
    var scheduleBody = document.querySelector('#schedule-table tbody');
    var scheduleEmpty = document.getElementById('schedule-empty');
    var teamsEmpty = document.getElementById('teams-empty');
    var standingsEmpty = document.getElementById('standings-empty');
    var specsEmpty = document.getElementById('specs-empty');
    var statsEmpty = document.getElementById('stats-empty');

    // Переключатель Track time / My time на странице серии: при смене — обновить настройки и перерисовать таблицу расписания
    var timeZoneSelectDetail = document.getElementById('time-zone-select-detail');
    if (timeZoneSelectDetail && !timeZoneSelectDetail._bound) {
      timeZoneSelectDetail._bound = true;
      // И здесь тоже подтягиваем сохранённый выбор (Track/My),
      // чтобы он совпадал с реальным режимом отображения времени.
      var getTimeSettingsDetail = (window.TGA && window.TGA.getTimeSettings) || null;
      if (getTimeSettingsDetail) {
        try {
          var tsDetail = getTimeSettingsDetail();
          if (tsDetail && tsDetail.timeZone) timeZoneSelectDetail.value = tsDetail.timeZone;
        } catch (e) {}
      }
      timeZoneSelectDetail.addEventListener('change', function () {
        var setTimeSettings = (window.TGA && window.TGA.setTimeSettings) || function () {};
        setTimeSettings({ timeZone: timeZoneSelectDetail.value === 'track' ? 'track' : 'my' });
        if (window.TGA && typeof window.TGA.refreshScheduleDetail === 'function') {
          window.TGA.refreshScheduleDetail();
        }
      });
    }

    showView('view-detail');
    adjustDetailPanelPadding();

    // Обновляем класс категории на <body> для контекстных стилей (в т.ч. сток-кар таблиц)
    var bodyEl = document.body;
    var seriesIdUpper = (seriesId || '').toUpperCase();
    var seriesIdLower = (seriesId || '').toLowerCase();
    var isF1SeasonSlug = seriesIdLower.indexOf('f1-') === 0;
    var isF1 = seriesIdLower === 'f1' || isF1SeasonSlug;
    var catKey = categoryBySeriesId[seriesIdUpper] || (isF1SeasonSlug ? 'openwheel' : null);
    if (bodyEl) {
      bodyEl.classList.remove('cat-openwheel', 'cat-stockcar', 'cat-endurance', 'cat-touring');
      if (catKey) bodyEl.classList.add('cat-' + catKey);
      Array.from(bodyEl.classList).forEach(function (cls) {
        if (cls.indexOf('series-') === 0) bodyEl.classList.remove(cls);
      });
      if (seriesIdLower) bodyEl.classList.add('series-' + (isF1 ? 'f1' : seriesIdLower));
    }
    var isStockCarSeries = catKey === 'stockcar';
    var isIndyCarSeries = seriesIdUpper === 'INDYCAR';
    var isSupercarsSeries = seriesIdUpper === 'SUPERCARS';
    var hasStats = isStockCarSeries || isIndyCarSeries || isSupercarsSeries || isF1;

    function teamLink(name) {
      return name ? '<a href="/team/' + encodeURIComponent(slugify(name)) + '" class="track-link">' + esc(name) + '</a>' : '—';
    }
    function driverLink(name) {
      var display = driverDisplayName(name);
      return display ? '<a href="/driver/' + encodeURIComponent(slugify(display)) + '" class="track-link">' + esc(display) + '</a>' : '—';
    }

    // Специальные подписи для некоторых серий
    var teamsHeaderEl = document.querySelector('.teams-section h3');
    if (teamsHeaderEl) {
      var sidLower = (seriesId || '').toLowerCase();
      if (sidLower === 'supercars') {
        teamsHeaderEl.textContent = 'Championship entries';
      } else if (sidLower === 'imsa') {
        teamsHeaderEl.textContent = t('nav.classes');
      } else {
        teamsHeaderEl.textContent = t('section.h3.teams');
      }
    }

    // Та же серия — только переключаем вкладки. Не делаем early return, если открыта вкладка Schedule и таблица пустая (тогда делаем полную перезагрузку).
    var sameSeries = (loadedSeriesId === seriesId);
    var scheduleEmptyNeedReload = (subPath === '' && scheduleBody && !scheduleBody.querySelector('tr'));
    if (sameSeries && !scheduleEmptyNeedReload && subPath !== 'stats') {
      var isImsaSeriesSame = (seriesId || '').toLowerCase() === 'imsa';
      var specsPathSame = isImsaSeriesSame ? 'classes' : 'specs';
      var navIdx = 0;
      if (subPath === 'standings') navIdx = 1;
      else if (subPath === 'teams') navIdx = 2;
      else if (subPath === specsPathSame) navIdx = 3;
      else if (subPath === 'stats') navIdx = hasStats ? 4 : 0;
      else if (subPath === 'history') navIdx = isF1 ? (hasStats ? 5 : 4) : 0;
      seriesNav.querySelectorAll('.nav-link').forEach(function (link, i) {
        link.classList.toggle('active', i === navIdx);
      });
      schedulePanel.classList.toggle('hidden', subPath !== '');
      standingsPanel.classList.toggle('hidden', subPath !== 'standings');
      teamsPanel.classList.toggle('hidden', subPath !== 'teams');
      specsPanel.classList.toggle('hidden', subPath !== specsPathSame);
      if (statsPanel) statsPanel.classList.toggle('hidden', subPath !== 'stats');
      if (historyPanel) historyPanel.classList.toggle('hidden', subPath !== 'history');
      // IMSA: при переключении вкладок без полной перезагрузки тоже нужно
      // вовремя показывать / скрывать блок Classes vs обычные Car Specs.
      if (isImsaSeriesSame) {
        var imsaClassesSame = document.getElementById('imsa-classes-static');
        var carSpecSame = document.getElementById('car-spec-wrap');
        if (subPath === 'classes') {
          if (carSpecSame) carSpecSame.classList.add('hidden');
          if (imsaClassesSame) imsaClassesSame.classList.remove('hidden');
        } else {
          if (imsaClassesSame) imsaClassesSame.classList.add('hidden');
          if (carSpecSame) carSpecSame.classList.remove('hidden');
        }
      }
      // Для F1: при переключении вкладки на Specs без полной перезагрузки
      // нужно применить статический регламент (иначе таблица остаётся пустой).
      if (!isImsaSeriesSame && subPath === 'specs' && typeof renderF1StaticSpecsIfNeeded === 'function') {
        renderF1StaticSpecsIfNeeded();
      }
      return;
    }

    detailTitle.textContent = '—';
    detailMeta.textContent = '';
    detailBreadcrumb.textContent = '';
    var detailHomeLink = document.createElement('a');
    detailHomeLink.href = '/';
    detailHomeLink.textContent = t('breadcrumb.all');
    detailBreadcrumb.appendChild(detailHomeLink);
    var seriesSlugForUrl = (seriesId || '').toLowerCase().replace(/_/g, '-');
    var base = isF1SeasonSlug ? ('/season/' + encodeURIComponent(seriesIdLower)) : ('/series/' + encodeURIComponent(seriesSlugForUrl));
    if (isF1SeasonSlug) {
      var seasonYear = seriesIdLower.replace(/^f1[-_]/, '') || seriesIdLower.slice(4);
      var seasonTitle = 'Formula 1 ' + seasonYear;
      detailTitle.textContent = seasonTitle;
      detailMeta.textContent = 'World';
      document.title = seasonTitle + ' — The Grid Archive (TGA)';
      detailBreadcrumb.innerHTML =
        '<a href="/">' + esc(t('breadcrumb.all')) + '</a>' +
        '<span class="breadcrumb-sep">/</span>' +
        '<a href="/series/f1/history">Formula 1</a>' +
        '<span class="breadcrumb-sep">/</span>' +
        '<span>' + esc('F1 ' + seasonYear) + '</span>';
    }
    var isImsaSeries = (seriesId || '').toLowerCase() === 'imsa';
    var navPages = [
      { path: '',          labelKey: 'nav.schedule'  },
      { path: 'standings', labelKey: 'nav.standings' },
      { path: 'teams',     labelKey: 'nav.teams'     },
      { path: isImsaSeries ? 'classes' : 'specs', labelKey: isImsaSeries ? 'nav.classes' : 'nav.carspecs'  }
    ];
    if (hasStats) {
      navPages.push({ path: 'stats', labelKey: 'nav.stats' });
    }
    if (isF1 && !isF1SeasonSlug) {
      navPages.push({ path: 'history', labelKey: 'nav.history' });
    }
    seriesNav.innerHTML = navPages.map(function (p) {
      var href = p.path ? base + '/' + p.path : base;
      var active = (subPath === p.path) ? ' nav-link active' : ' nav-link';
      return '<a href="' + href + '" class="' + active.trim() + '">' + esc(t(p.labelKey)) + '</a>';
    }).join('');
    // Для IMSA: вкладка Classes использует статический блок с классами,
    // заголовок внутри панели скрываем.
    if (isImsaSeries) {
      var specsTitleElInit = document.querySelector('#specs-panel h3[data-i18n="section.h3.specs"]');
      if (specsTitleElInit) specsTitleElInit.classList.add('hidden');
      var imsaClassesBlock = document.getElementById('imsa-classes-static');
      var carSpecBlock = document.getElementById('car-spec-wrap');
      if (subPath === 'classes') {
        if (carSpecBlock) carSpecBlock.classList.add('hidden');
        if (imsaClassesBlock) imsaClassesBlock.classList.remove('hidden');
      } else {
        if (imsaClassesBlock) imsaClassesBlock.classList.add('hidden');
      }
    }
    if (schedulePanel) schedulePanel.classList.toggle('hidden', subPath !== '');
    if (standingsPanel) standingsPanel.classList.toggle('hidden', subPath !== 'standings');
    if (teamsPanel) teamsPanel.classList.toggle('hidden', subPath !== 'teams');
    if (specsPanel) specsPanel.classList.toggle('hidden', subPath !== (isImsaSeries ? 'classes' : 'specs'));
    if (statsPanel) statsPanel.classList.toggle('hidden', subPath !== 'stats');
    if (historyPanel) historyPanel.classList.toggle('hidden', subPath !== 'history');
    // После переключения панели пробуем применить статический F1‑регламент (для /series/f1/specs и /season/f1-2025/specs).
    if (typeof renderF1StaticSpecsIfNeeded === 'function') {
      renderF1StaticSpecsIfNeeded();
    }
    if (teamsBody) teamsBody.innerHTML = '';
    if (teamsFulltimeBody) teamsFulltimeBody.innerHTML = '';
    if (teamsParttimeBody) teamsParttimeBody.innerHTML = '';
    if (teamsNoncharteredBody) teamsNoncharteredBody.innerHTML = '';
    if (teamsEnduranceBody) teamsEnduranceBody.innerHTML = '';
    if (teamsWildcardBody) teamsWildcardBody.innerHTML = '';
    if (standingsBody) standingsBody.innerHTML = '';
    var standingsIneligibleWrap = document.getElementById('standings-ineligible-wrap');
    var standingsIneligibleBody = document.querySelector('#standings-ineligible-table tbody');
    var ineligibleScrollContainerInit = document.getElementById('standings-ineligible-scroll-container');
    if (ineligibleScrollContainerInit) ineligibleScrollContainerInit.classList.add('hidden');
    if (document.getElementById('standings-ineligible-title')) document.getElementById('standings-ineligible-title').classList.add('hidden');
    if (standingsIneligibleBody) standingsIneligibleBody.innerHTML = '';
    if (scheduleBody) scheduleBody.innerHTML = '';
    if (scheduleEmpty) scheduleEmpty.classList.add('hidden');
    if (teamsEmpty) teamsEmpty.classList.add('hidden');
    if (standingsEmpty) standingsEmpty.classList.add('hidden');
    if (specsEmpty) specsEmpty.classList.add('hidden');
    if (statsEmpty) statsEmpty.classList.add('hidden');
    var statsBody = document.querySelector('#stats-table tbody');
    if (statsBody) statsBody.innerHTML = '';

    fetchJSON('/api/series/' + encodeURIComponent((seriesId || '').toLowerCase()))
      .then(function (s) {
        loadedSeriesId = seriesId;
        if (!isF1SeasonSlug) {
          detailTitle.textContent = s.name;
          document.title = s.name + ' — The Grid Archive (TGA)';
          var metaText = esc(s.season) + ' · ' + countryHtml((seriesId || '').toLowerCase() === 'psc' ? 'Europe' : s.country);
          detailMeta.textContent = metaText;
          detailBreadcrumb.textContent = '';
          var homeLink = document.createElement('a');
          homeLink.href = '/';
          homeLink.textContent = t('breadcrumb.all');
          detailBreadcrumb.appendChild(homeLink);
        }

        // Time zone selector only for current season (2026), hide for historical seasons
        if (timeZoneSelectDetail && s && String(s.season) !== '2026') {
          var tzDetailWrap = timeZoneSelectDetail.parentElement;
          if (tzDetailWrap) tzDetailWrap.classList.add('hidden');
        }

        adjustDetailPanelPadding();
      })
      .catch(function () {
        if (!isF1SeasonSlug) detailTitle.textContent = 'Series not found';
        adjustDetailPanelPadding();
      });

    // Обновляем live‑баннер серии по данным /api/live-events.
    (function updateSeriesLiveBanner() {
      var liveBanner = document.getElementById('series-live-banner');
      if (!liveBanner) return;
      var fetchJSONLocal = window.TGA && window.TGA.fetchJSON ? window.TGA.fetchJSON : fetchJSON;
      fetchJSONLocal('/api/live-events')
        .then(function (ids) {
          var list = Array.isArray(ids) ? ids : [];
          var targetPrefix = String(seriesId || '').toUpperCase() + '_';
          var hasLive = list.some(function (id) {
            return typeof id === 'string' && id.toUpperCase().indexOf(targetPrefix) === 0;
          });
          liveBanner.classList.toggle('hidden', !hasLive);
          liveBanner.setAttribute('aria-hidden', hasLive ? 'false' : 'true');
        })
        .catch(function () {
          // В случае ошибки сети просто скрываем баннер.
          liveBanner.classList.add('hidden');
          liveBanner.setAttribute('aria-hidden', 'true');
        });
    })();

    fetchJSON('/api/series/' + encodeURIComponent((seriesId || '').toLowerCase()) + '/teams')
      .catch(function (err) {
        // Фолбэк для Supercars, если бекенд ещё не отдаёт Car Specs
        if ((seriesId || '').toLowerCase() === 'supercars') {
          var sc = window.tgaSeries && window.tgaSeries.supercars;
          return { teams: [], car_models: sc && sc.carModels ? sc.carModels.slice() : [], technical_spec: sc && sc.technicalSpec ? sc.technicalSpec.slice() : [] };
        }
        return {};
      })
      .then(function (data) {
        var seriesKeyTeams = (seriesId || '').toLowerCase();
        // Старый формат для некоторых серий: backend может вернуть просто массив команд.
        if (Array.isArray(data)) {
          data = { teams: data };
        }
        var teams = data && data.teams ? data.teams : [];
        var hasSpec = data && ((data.car_models && data.car_models.length > 0) || (data.technical_spec && data.technical_spec.length > 0));

        // После IMSA в teams-table-wrap остаётся разметка GTP/LMP2 — таблица #teams-table пропадает.
        // Для не-IMSA восстанавливаем дефолтную структуру, чтобы Supercars/IndyCar и др. могли рендерить.
        if (seriesKeyTeams !== 'imsa') {
          var wrapReset = document.getElementById('teams-table-wrap');
          var tableReset = document.getElementById('teams-table');
          if (wrapReset && !(tableReset && wrapReset.contains(tableReset))) {
            wrapReset.classList.add('table-wrap');
            wrapReset.innerHTML = '<table class="data-table" id="teams-table"><thead><tr><th>#</th><th data-i18n="th.manufacturer">Manufacturer</th><th data-i18n="th.team">Team</th><th data-i18n="th.no">No.</th><th data-i18n="th.driver">Driver</th><th data-i18n="th.crew_chief">Crew Chief</th></tr></thead><tbody></tbody></table>';
          }
        }

        // Для Supercars всегда жёстко задаём Car Specs, независимо от данных бэкенда.
        if (seriesKeyTeams === 'supercars') {
          var sc = window.tgaSeries && window.tgaSeries.supercars;
          data.car_models = sc && sc.carModels ? sc.carModels.slice() : [];
          data.technical_spec = sc && sc.technicalSpec ? sc.technicalSpec.slice() : [];
          hasSpec = !!((data.car_models && data.car_models.length) || (data.technical_spec && data.technical_spec.length));
        }
        if (seriesKeyTeams === 'f1-2025' && window.F1_2025_TECH_SPEC) {
          data.technical_spec = window.F1_2025_TECH_SPEC;
          hasSpec = true;
        }
        if (seriesKeyTeams === 'f1-2026' && window.F1_2026_TECH_SPEC) {
          data.technical_spec = window.F1_2026_TECH_SPEC;
          hasSpec = true;
        }
        if (seriesKeyTeams === 'f1' && window.F1_2026_TECH_SPEC) {
          data.technical_spec = window.F1_2026_TECH_SPEC;
          hasSpec = true;
        }
        // Car Specs для F3: только технические характеристики машины (без очковых правил).
        if (seriesKeyTeams === 'f3') {
          data.car_models = [];
          data.technical_spec = [
            { key: 'Chassis', value: 'Carbon fibre kevlar monocoque with honeycomb structure' },
            { key: 'Suspension', value: 'Double steel wishbones, pushrod operated, twin dampers, helicoidally spring suspension' },
            { key: 'Length', value: '4,965 mm (195 in)' },
            { key: 'Width', value: '1,885 mm (74 in)' },
            { key: 'Height', value: '1,043 mm (41 in)' },
            { key: 'Engine', value: 'Mecachrome V634 3,396 cubic centimetres (207 cubic inches) V6 95° naturally aspirated, rear-mounted, rear-wheel-drive' },
            { key: 'Transmission', value: '3Mo 6-speed sequential paddle-shift' },
            { key: 'Power', value: '380 horsepower (283 kilowatts) @8,000 rpm\n420 newton-metres (310 pound force-feet)' },
            { key: 'Weight', value: '673 kg (1,484 lb) (including driver)' },
            { key: 'Fuel', value: 'Aramco Advanced 100% sustainable fuel' },
            { key: 'Lubricants', value: 'Aramco Orizon' },
            { key: 'Tyres', value: 'Pirelli P Zero (dry) and Pirelli Cinturato (wet) tyres' }
          ];
          hasSpec = true;
        }
        // Car Specs для F2: только технические характеристики шасси/двигателя (без спортивных правил по очкам).
        if (seriesKeyTeams === 'f2') {
          data.car_models = [];
          data.technical_spec = [
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
          hasSpec = true;
        }

        // Всегда сбрасываем секцию Car Specs перед применением новых данных,
        // чтобы не "залипали" спецификации другой серии.
        var carWrapReset = document.getElementById('car-spec-wrap');
        var carModelsWrapReset = document.getElementById('car-models-table-wrap');
        var techSpecWrapReset = document.getElementById('technical-spec-table-wrap');
        var enginesTitleReset = document.getElementById('engines-spec-title');
        var enginesWrapReset = document.getElementById('engines-spec-table-wrap');
        var homologationTitleReset = document.getElementById('homologation-spec-title');
        var homologationWrapReset = document.getElementById('homologation-spec-table-wrap');

        if (carWrapReset) carWrapReset.classList.add('hidden');
        if (carModelsWrapReset) carModelsWrapReset.innerHTML = '';
        if (techSpecWrapReset) techSpecWrapReset.innerHTML = '';
        if (enginesWrapReset) {
          enginesWrapReset.innerHTML = '';
          enginesWrapReset.classList.add('hidden');
        }
        if (enginesTitleReset) enginesTitleReset.classList.add('hidden');
        if (homologationWrapReset) {
          homologationWrapReset.innerHTML = '';
          homologationWrapReset.classList.add('hidden');
        }
        if (homologationTitleReset) homologationTitleReset.classList.add('hidden');
        if (specsEmpty) specsEmpty.classList.add('hidden');

        if (teams.length === 0) {
          teamsEmpty.classList.remove('hidden');
        } else {
          teamsEmpty.classList.add('hidden');
        }

        // Для серий без Car Specs (кроме Supercars и IMSA со статикой) показываем
        // понятное сообщение, а содержимое панели оставляем скрытым.
        if (!hasSpec && seriesKeyTeams !== 'supercars' && seriesKeyTeams !== 'imsa') {
          if (specsEmpty) specsEmpty.classList.remove('hidden');
        }

        // Статический Car Specs для IndyCar: игнорируем наличие/отсутствие данных с бэкенда
        if (seriesKeyTeams === 'indycar') {
          var carWrapIndy = document.getElementById('car-spec-wrap');
          var techSpecWrapIndy = document.getElementById('technical-spec-table-wrap');
          var carModelsTitleIndy = carWrapIndy && carWrapIndy.querySelector('h4[data-i18n="specs.car_models"]');
          var carModelsWrapIndy = document.getElementById('car-models-table-wrap');
          if (carModelsTitleIndy) carModelsTitleIndy.classList.add('hidden');
          if (carModelsWrapIndy) carModelsWrapIndy.innerHTML = '';
          if (carWrapIndy && techSpecWrapIndy) {
            carWrapIndy.classList.remove('hidden');
            var indySpec = [
              { key: 'Chassis', value: 'Dallara DW12 Safety Cell (IR-18 / UAK-18 specification)' },
              { key: 'Aero Kit Introduction', value: '2018 season' },
              { key: 'Aerodynamic Concept', value: 'Increased ground-effect downforce, reduced wing dependency' },
              { key: 'Design Inspiration', value: '1980s–1990s Indy car styling' },
              { key: 'Removed Components (2018 redesign)', value: 'Airbox, rear-wheel guards, auxiliary winglets' },
              { key: 'Track Compatibility', value: 'One base chassis for road, street, short oval, and superspeedways' },
              { key: 'Steering Wheel', value: 'Cosworth CCW Mk2' },
              { key: 'Display System', value: 'Configurable Display Unit 4.3' },
              { key: 'Cockpit Modifications', value: 'Enlarged cockpit dimensions, improved seat ergonomics' },
              { key: 'Cockpit Protection (2019)', value: 'Advanced Frontal Protection (AFP)' },
              { key: 'Aeroscreen (2020–present)', value: 'Developed by Red Bull Advanced Technologies' },
              { key: 'Engine (2018–2023)', value: '2.2L V6 twin-turbocharged (Chevrolet / Honda)' },
              { key: 'Hybrid Powertrain (2024–present)', value: '2.4L V6 with 100 bhp ERS hybrid unit (Mahle)' },
              { key: 'Current Chassis Status', value: 'Successor confirmed from 2028 season onward' },
              { key: 'Tire Supplier', value: 'Firestone (exclusive supplier)' },
              { key: 'Tire Types – Road/Street', value: 'Primary (black), Alternate (red, softer compound)' },
              { key: 'Tire Types – Ovals', value: 'Single primary compound' },
              { key: 'Rain Tires', value: 'Available for road and street circuits' },
              { key: 'Tire Construction', value: 'Firestone Firehawk racing slicks' }
            ];
            techSpecWrapIndy.innerHTML =
              '<table class="data-table"><thead><tr><th>' + t('th.field') + '</th><th>' + t('th.value') + '</th></tr></thead><tbody>' +
              indySpec.map(function (s) {
                return '<tr><td class="col-field">' + esc(dash(s.key)) + '</td><td>' + esc(dash(s.value)) + '</td></tr>';
              }).join('') +
              '</tbody></table>';
          }
        }
        function crewChiefLink(name) {
          return name ? '<a href="/crew-chief/' + encodeURIComponent(slugify(name)) + '" class="track-link">' + esc(name) + '</a>' : '—';
        }
        function chassisLink(name) {
          if (!name) return '—';
          var trimmed = String(name).trim();
          if (!trimmed || trimmed === '—') return '—';
          var isImsaBase = (seriesId || '').toLowerCase() === 'imsa';
          var hrefBase = isImsaBase ? (base.replace(/\/specs$/i, '') || base) : base;
          var href = hrefBase + (isImsaBase ? '/classes#' : '/specs#') + encodeURIComponent(slugify(trimmed));
          return '<a href="' + href + '" class="track-link">' + esc(trimmed) + '</a>';
        }
        function teamRow(tm, i) {
          return '<tr><td class="col-num">' + (i + 1) + '</td><td>' + esc(dash(tm.manufacturer)) + '</td><td>' + teamLink(tm.team) + '</td><td>' + esc(dash(tm.number)) + '</td><td>' + driverLink(tm.driver) + '</td><td>' + crewChiefLink(tm.crew_chief) + '</td></tr>';
        }
        // F1 / open-wheel: объединение ячеек по производителю и команде (rowspan)
        function buildOpenWheelTeamsBody(teamsArr) {
          if (!teamsArr || teamsArr.length === 0) return '';
          var rows = [];
          var ord = 0;
          var i = 0;
          while (i < teamsArr.length) {
            var tm = teamsArr[i];
            var man = String(tm.manufacturer || '').trim();
            var teamName = String(tm.team || '').trim();
            var span = 1;
            for (var j = i + 1; j < teamsArr.length; j++) {
              if (String(teamsArr[j].manufacturer || '').trim() !== man || String(teamsArr[j].team || '').trim() !== teamName) break;
              span++;
            }
            for (var k = 0; k < span; k++) {
              var t = teamsArr[i + k];
              ord++;
              var cells = '<td class="col-num">' + ord + '</td>';
              if (k === 0) {
                cells += '<td rowspan="' + span + '" class="manufacturer-cell">' + esc(dash(man)) + '</td>' +
                  '<td rowspan="' + span + '" class="team-cell">' + teamLink(teamName) + '</td>';
              }
              cells += '<td class="col-num">' + esc(dash(t.number)) + '</td><td>' + driverLink(t.driver) + '</td><td>' + crewChiefLink(t.crew_chief) + '</td>';
              rows.push('<tr>' + cells + '</tr>');
            }
            i += span;
          }
          return rows.join('');
        }
        /** F1: Team | Constructor | Chassis | Engine | No. | Driver */
        function buildF1TeamsBody(teamsArr) {
          if (!teamsArr || teamsArr.length === 0) return '';
          var rows = [];
          var ord = 0;
          var i = 0;
          while (i < teamsArr.length) {
            var tm = teamsArr[i];
            var teamName = String(tm.team || '').trim();
            var man = String(tm.manufacturer || '').trim();
            var chassis = String(tm.chassis || '').trim();
            var powerUnit = String(tm.power_unit || '').trim();
            var span = 1;
            for (var j = i + 1; j < teamsArr.length; j++) {
              if (String(teamsArr[j].team || '').trim() !== teamName) break;
              span++;
            }
            for (var k = 0; k < span; k++) {
              var t = teamsArr[i + k];
              ord++;
              var cells = '<td class="col-num">' + ord + '</td>';
              if (k === 0) {
                var engineVal = (t.power_unit || t.engine || '').trim();
                cells += '<td rowspan="' + span + '" class="team-cell">' + teamLink(teamName) + '</td>' +
                  '<td rowspan="' + span + '" class="manufacturer-cell">' + esc(dash(man)) + '</td>' +
                  '<td rowspan="' + span + '">' + esc(dash(t.chassis)) + '</td>' +
                  '<td rowspan="' + span + '">' + esc(dash(engineVal)) + '</td>';
              }
              cells += '<td class="col-num">' + esc(dash(t.number)) + '</td><td>' + driverLink(t.driver) + '</td>';
              rows.push('<tr>' + cells + '</tr>');
            }
            i += span;
          }
          return rows.join('');
        }
        /** Historical F1 seasons: Entrant/Team | Constructor | Chassis | Power unit | No. | Driver | Rounds. */
        function buildF1SeasonTeamsTableHTML(teamsArr, seriesKeyTeams) {
          if (!teamsArr || teamsArr.length === 0) return '';
          var rows = [];
          var ord = 0;
          var i = 0;
          while (i < teamsArr.length) {
            var base = teamsArr[i];
            var teamName = String(base.team || '').trim();
            var span = 1;
            for (var j = i + 1; j < teamsArr.length; j++) {
              if (String(teamsArr[j].team || '').trim() !== teamName) break;
              span++;
            }
            for (var k = 0; k < span; k++) {
              var tm = teamsArr[i + k];
              ord++;
              var cells = '';
              var constructorVal = (tm.manufacturer || '').trim();
              var chassisVal = (tm.chassis || '').trim();
              var powerUnitVal = (tm.power_unit || tm.engine || '').trim();
              if (k === 0) {
                cells += '<td class="col-num">' + ord + '</td>' +
                  '<td rowspan="' + span + '">' + teamLink(teamName) + '</td>' +
                  '<td rowspan="' + span + '">' + esc(dash(constructorVal)) + '</td>' +
                  '<td rowspan="' + span + '">' + esc(dash(chassisVal)) + '</td>' +
                  '<td rowspan="' + span + '">' + esc(dash(powerUnitVal)) + '</td>';
              } else {
                cells += '<td class="col-num">' + ord + '</td>';
              }
              var roundsRaw = String(tm.rounds || '').trim();
              var roundsDisplay = roundsRaw;
              if (seriesKeyTeams && seriesKeyTeams.toLowerCase().indexOf('f1-') === 0 && roundsRaw.toLowerCase() === 'all') {
                roundsDisplay = '1–24';
              }
              cells += '<td class="col-num">' + esc(dash(tm.number)) + '</td>' +
                '<td>' + driverLink(tm.driver) + '</td>' +
                '<td>' + esc(dash(roundsDisplay)) + '</td>';
              rows.push('<tr>' + cells + '</tr>');
            }
            i += span;
          }
          var header =
            '<thead><tr>' +
              '<th>#</th>' +
              '<th>' + esc(t('th.team')) + '</th>' +
              '<th>Constructor</th>' +
              '<th>Chassis</th>' +
              '<th>Power unit</th>' +
              '<th>' + esc(t('th.no')) + '</th>' +
              '<th>' + esc(t('th.driver')) + '</th>' +
              '<th>' + esc(t('th.rounds')) + '</th>' +
            '</tr></thead>';
          return '<table class="data-table f1-teams-table">' + header + '<tbody>' + rows.join('') + '</tbody></table>';
        }
        /** Entry-list (F2, F3): Entrant/Team | No. | Driver name | Rounds, grouped by team (no country). */
        function buildEntryListTeamsTableHTML(teamsArr, seriesKeyTeams) {
          if (!teamsArr || teamsArr.length === 0) return '';
          var isF3 = (seriesKeyTeams || '').toLowerCase() === 'f3';
          var col1Header = isF3 ? t('th.entrant') : t('th.team');
          var col3Header = isF3 ? t('th.driver_name') : t('th.driver');
          var rows = [];
          var i = 0;
          while (i < teamsArr.length) {
            var base = teamsArr[i];
            var teamName = String(base.team || '').trim();
            var teamCellText = teamLink(teamName);
            var span = 1;
            for (var j = i + 1; j < teamsArr.length; j++) {
              if (String(teamsArr[j].team || '').trim() !== teamName) break;
              span++;
            }
            for (var k = 0; k < span; k++) {
              var tm = teamsArr[i + k];
              var cells = k === 0 ? '<td rowspan="' + span + '">' + teamCellText + '</td>' : '';
              var roundsRaw = String(tm.rounds || '').trim();
              var roundsDisplay = roundsRaw;
              // Для исторических сезонов F1 показываем 1–24 вместо All
              if (seriesKeyTeams && seriesKeyTeams.toLowerCase().indexOf('f1-') === 0 && roundsRaw.toLowerCase() === 'all') {
                roundsDisplay = '1–24';
              }
              cells += '<td class="col-num">' + esc(dash(tm.number)) + '</td><td>' + driverLink(tm.driver) + '</td><td>' + esc(dash(roundsDisplay)) + '</td>';
              rows.push('<tr>' + cells + '</tr>');
            }
            i += span;
          }
          var header = '<thead><tr><th>' + esc(col1Header) + '</th><th>' + esc(t('th.no')) + '</th><th>' + esc(col3Header) + '</th><th>' + esc(t('th.rounds')) + '</th></tr></thead>';
          return '<table class="data-table">' + header + '<tbody>' + rows.join('') + '</tbody></table>';
        }
        function partTimeRow(tm, i) {
          return '<tr><td class="col-num">' + (i + 1) + '</td><td>' + esc(dash(tm.manufacturer)) + '</td><td>' + teamLink(tm.team) + '</td><td>' + esc(dash(tm.number)) + '</td><td>' + driverLink(tm.driver) + '</td><td>' + crewChiefLink(tm.crew_chief) + '</td></tr>';
        }
        function teamNonCharteredRow(tm, i) {
          return '<tr><td class="col-num">' + (i + 1) + '</td><td>' + esc(dash(tm.manufacturer)) + '</td><td>' + teamLink(tm.team) + '</td><td>' + esc(dash(tm.number)) + '</td><td>' + driverLink(tm.driver) + '</td><td>' + crewChiefLink(tm.crew_chief) + '</td></tr>';
        }
        // Сток-кары: объединение ячеек по команде/номеру/Crew Chief + группировка по командам в <tbody> для полосатости
        function buildStockCarTeamsBody(teamsArr) {
          if (!teamsArr || teamsArr.length === 0) return '';
          var teamRowSpan = [];
          var numberRowSpan = [];
          for (var i = 0; i < teamsArr.length; i++) {
            teamRowSpan[i] = 0;
            numberRowSpan[i] = 0;
          }
          for (var i = 0; i < teamsArr.length; i++) {
            if (teamRowSpan[i] === -1) continue;
            var teamVal = String(teamsArr[i].team || '').trim();
            var spanTeam = 1;
            for (var j = i + 1; j < teamsArr.length; j++) {
              if (String(teamsArr[j].team || '').trim() !== teamVal) break;
              spanTeam++;
              teamRowSpan[j] = -1;
            }
            teamRowSpan[i] = spanTeam;
          }
          for (var i = 0; i < teamsArr.length; i++) {
            if (numberRowSpan[i] === -1) continue;
            var teamVal = String(teamsArr[i].team || '').trim();
            var numVal = String(teamsArr[i].number || '').trim();
            var spanNum = 1;
            for (var j = i + 1; j < teamsArr.length; j++) {
              if (String(teamsArr[j].team || '').trim() !== teamVal || String(teamsArr[j].number || '').trim() !== numVal) break;
              spanNum++;
              numberRowSpan[j] = -1;
            }
            numberRowSpan[i] = spanNum;
          }
          var rows = [];
          for (var i = 0; i < teamsArr.length; i++) {
            var tm = teamsArr[i];
            var teamCell = teamRowSpan[i] === -1 ? '' : (teamRowSpan[i] > 0 ? '<td rowspan="' + teamRowSpan[i] + '" class="stockcar-team-cell">' + teamLink(tm.team) + '</td>' : '');
            var numberCell = numberRowSpan[i] === -1 ? '' : (numberRowSpan[i] > 0 ? '<td rowspan="' + numberRowSpan[i] + '" class="stockcar-number-cell">' + esc(dash(tm.number)) + '</td>' : '');
            var crewChiefCell = numberRowSpan[i] === -1 ? '' : (numberRowSpan[i] > 0 ? '<td rowspan="' + numberRowSpan[i] + '" class="stockcar-crewchief-cell">' + crewChiefLink(tm.crew_chief) + '</td>' : '');
            rows.push('<tr><td class="col-num">' + (i + 1) + '</td><td>' + esc(dash(tm.manufacturer)) + '</td>' + teamCell + numberCell + '<td>' + driverLink(tm.driver) + '</td>' + crewChiefCell + '</tr>');
          }
          // Группировка по командам в отдельные <tbody> для чередования фона по группам
          var groupStart = 0;
          var groupIndex = 0;
          var tbodyParts = [];
          while (groupStart < teamsArr.length) {
            var teamVal = String(teamsArr[groupStart].team || '').trim();
            var groupEnd = groupStart + 1;
            while (groupEnd < teamsArr.length && String(teamsArr[groupEnd].team || '').trim() === teamVal) groupEnd++;
            var groupClass = groupIndex % 2 === 0 ? 'group-odd' : 'group-even';
            tbodyParts.push('<tbody class="' + groupClass + '">' + rows.slice(groupStart, groupEnd).join('') + '</tbody>');
            groupStart = groupEnd;
            groupIndex++;
          }
          return tbodyParts.join('');
        }
        var seriesKeyTeams = (seriesId || '').toLowerCase();
        var isStockCarSeriesTeams = ['nascar_cup', 'noaps', 'nascar_xfinity', 'nascar_truck', 'arca', 'nascar_modified'].indexOf(seriesKeyTeams) >= 0;

        // Специальный рендерер для IMSA: отдельные таблицы по классам (GTP / LMP2 / GTD Pro / GTD)
        if (seriesKeyTeams === 'imsa') {
          ['teams-fulltime-wrap', 'teams-fulltime-title', 'teams-parttime-wrap', 'teams-parttime-title', 'teams-nonchartered-wrap',
           'teams-endurance-wrap', 'teams-wildcard-wrap'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.classList.add('hidden');
          });

          var tableWrapImsa = document.getElementById('teams-table-wrap');
          if (!tableWrapImsa) return;
          // Для IMSA внешний wrap не должен иметь фон/бордер одной общей "карточкой"
          tableWrapImsa.classList.remove('table-wrap');

          var imsaTeams = teams.slice().map(function (t, idx) {
            // данные для IMSA приходят как произвольные поля (class, chassis, drivers, rounds)
            return {
              idx: idx,
              className: String(t.class || '').trim(),
              team: String(t.team || '').trim(),
              chassis: String(t.chassis || '').trim(),
              number: String(t.number || '').trim(),
              drivers: Array.isArray(t.drivers) ? t.drivers.slice() : (t.driver ? [String(t.driver)] : []),
              rounds: String(t.rounds || t.races || '').trim()
            };
          });

          imsaTeams.sort(function (a, b) {
            var ca = a.className, cb = b.className;
            if (ca !== cb) return ca < cb ? -1 : 1;
            var ta = a.team, tb = b.team;
            if (ta !== tb) return ta < tb ? -1 : 1;
            var na = a.number, nb = b.number;
            return na < nb ? -1 : na > nb ? 1 : 0;
          });

          // Группируем по классу
          var groupsByClass = {};
          imsaTeams.forEach(function (tm) {
            var cls = tm.className || '—';
            if (!groupsByClass[cls]) groupsByClass[cls] = [];
            groupsByClass[cls].push(tm);
          });

          function buildImsaTeamsBody(arr) {
            var bodyParts = [];
            var rowIdx = 0;
            var useAltBand = false;
            for (var gi = 0; gi < arr.length;) {
              var start = gi;
              var base = arr[start];
              var size = 1;
              while (start + size < arr.length) {
                var next = arr[start + size];
                if (!next || next.team !== base.team || next.chassis !== base.chassis) break;
                size++;
              }

              useAltBand = !useAltBand;
              var bandClass = useAltBand ? ' imsa-band-alt' : '';

              for (var j = 0; j < size; j++) {
                var tm = arr[start + j];
                rowIdx++;

                var driversLabel = '—';
                if (tm.drivers && tm.drivers.length) {
                  driversLabel = tm.drivers.map(function (d) {
                    return driverLink(d);
                  }).join('<br>');
                }

                // Rounds: по одной "ячейке-строке" на каждого пилота, но внутри одной ячейки,
                // чтобы экипаж считался один раз (как раньше).
                var rawRounds = tm.rounds ? String(tm.rounds).trim() : '';
                var lowerRounds = rawRounds.toLowerCase();
                var driverRounds = [];
                var driverCount = (tm.drivers && tm.drivers.length) ? tm.drivers.length : 0;
                if (!rawRounds || driverCount === 0) {
                  driverRounds = ['—'];
                } else if (lowerRounds === 'rolex 24' || rawRounds === '1') {
                  for (var dr1 = 0; dr1 < driverCount; dr1++) driverRounds.push('1');
                } else if (lowerRounds === 'tbc') {
                  if (tm.team === 'Tower Motorsports' && tm.number === '8' && driverCount > 1) {
                    for (var dr2 = 0; dr2 < driverCount - 1; dr2++) driverRounds.push('1');
                    driverRounds.push('TBC');
                  } else {
                    for (var dr3 = 0; dr3 < driverCount; dr3++) driverRounds.push('TBC');
                  }
                } else {
                  for (var dr4 = 0; dr4 < driverCount; dr4++) driverRounds.push(rawRounds);
                }
                var roundsLabelHtml = driverRounds.map(function (v) { return esc(v); }).join('<br>');

                var rowHtml = '<tr class="imsa-teams-row' + bandClass + '">' +
                  '<td class="col-num">' + rowIdx + '</td>';
                if (j === 0) {
                  rowHtml +=
                    '<td rowspan="' + size + '">' + teamLink(tm.team) + '</td>' +
                    '<td rowspan="' + size + '">' + chassisLink(tm.chassis) + '</td>';
                }
                rowHtml +=
                  '<td>' + esc(dash(tm.number)) + '</td>' +
                  '<td>' + driversLabel + '</td>' +
                  '<td>' + roundsLabelHtml + '</td>' +
                  '</tr>';
                bodyParts.push(rowHtml);
              }
              gi = start + size;
            }
            return bodyParts.join('');
          }

          function attachImsaTeamsSort(tableEl, baseRows) {
            var tbody = tableEl.querySelector('tbody');
            var headerRow = tableEl.querySelector('thead tr');
            if (!tbody || !headerRow) return;
            var ths = headerRow.querySelectorAll('th');
            var rowsForSort = baseRows.slice();
            var dirByCol = {};

            function render() {
              tbody.innerHTML = buildImsaTeamsBody(rowsForSort);
            }

            function getSortValue(tm, colIndex) {
              switch (colIndex) {
                case 0: return typeof tm.idx === 'number' ? tm.idx : 0;
                case 1: return tm.team || '';
                case 2: return tm.chassis || '';
                case 3: return tm.number || '';
                case 4: return (tm.drivers && tm.drivers.length ? tm.drivers[0] : '');
                case 5: return tm.rounds || '';
                default: return '';
              }
            }

            [].forEach.call(ths, function (th, colIndex) {
              th.classList.add('sortable');
              th.addEventListener('click', function () {
                var dir = dirByCol[colIndex] || 1; // первая сортировка — по возрастанию
                dirByCol[colIndex] = -dir;
                [].forEach.call(ths, function (th2) { th2.classList.remove('sort-asc', 'sort-desc'); });
                th.classList.add(dir === 1 ? 'sort-asc' : 'sort-desc');

                var numeric = (colIndex === 0 || colIndex === 3 || colIndex === 5);
                rowsForSort = rowsForSort.slice().sort(function (a, b) {
                  var va = getSortValue(a, colIndex);
                  var vb = getSortValue(b, colIndex);
                  if (numeric) {
                    var na = parseFloat(va) || 0;
                    var nb = parseFloat(vb) || 0;
                    return dir * (na - nb);
                  }
                  return dir * String(va).localeCompare(String(vb), undefined, { numeric: true });
                });

                render();
              });
            });
          }

          var classOrder = ['GTP', 'LMP2', 'GTD Pro', 'GTD'];
          var imsaSortMeta = [];
          var sectionsHtml = classOrder.map(function (cls) {
            var arr = groupsByClass[cls];
            if (!arr || !arr.length) return '';
            imsaSortMeta.push({ className: cls, rows: arr.slice() });
            var body = buildImsaTeamsBody(arr);
            return ''
              + '<h4 class="table-section-title">' + esc(cls) + '</h4>'
              + '<div class="table-wrap">'
              +   '<table class="data-table imsa-teams-table">'
              +     '<thead><tr>'
              +       '<th class="col-num">#</th>'
              +       '<th>' + esc(t('th.team')) + '</th>'
              +       '<th>Chassis</th>'
              +       '<th>' + esc(t('th.no')) + '</th>'
              +       '<th>' + esc(t('th.driver')) + '</th>'
              +       '<th>Rounds</th>'
              +     '</tr></thead>'
              +     '<tbody>' + body + '</tbody>'
              +   '</table>'
              + '</div>';
          }).join('');

          tableWrapImsa.innerHTML = sectionsHtml || '<p class="empty-msg">No IMSA teams data.</p>';
          if (sectionsHtml) {
            var tablesImsa = tableWrapImsa.querySelectorAll('.imsa-teams-table');
            [].forEach.call(tablesImsa, function (tbl, idx) {
              var meta = imsaSortMeta[idx];
              if (meta && meta.rows && meta.rows.length) {
                attachImsaTeamsSort(tbl, meta.rows);
              }
            });
          }
          return;
        }

        // IndyCar: таблица Team | Engine | No. | Driver(s) | Round(s), команды объединены (rowspan)
        if (seriesKeyTeams === 'indycar' && teams.length > 0) {
          ['teams-fulltime-wrap', 'teams-fulltime-title', 'teams-parttime-wrap', 'teams-parttime-title',
           'teams-nonchartered-wrap', 'teams-nonchartered-title',
           'teams-endurance-wrap', 'teams-wildcard-wrap'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.classList.add('hidden');
          });
          var tableWrap = document.getElementById('teams-table-wrap');
          if (!tableWrap) return;
          tableWrap.classList.remove('hidden');
          function indyCarDriverCell(tm) {
            var nameHtml = driverLink(tm.driver || '');
            if (tm.rookie) {
              // Формат: Имя-R, где R — белая метка новичка.
              return nameHtml + '-<span class="rookie-tag" title="Rookie">R</span>';
            }
            return nameHtml;
          }
          // Группы подряд идущих строк с одинаковой командой и двигателем
          var groups = [];
          for (var g = 0; g < teams.length;) {
            var teamName = teams[g].team || '';
            var engine = teams[g].manufacturer || '';
            var count = 0;
            while (g + count < teams.length &&
                   (teams[g + count].team || '') === teamName &&
                   (teams[g + count].manufacturer || '') === engine) {
              count++;
            }
            groups.push({ team: teamName, engine: engine, rows: teams.slice(g, g + count) });
            g += count;
          }
          var indyRows = [];
          groups.forEach(function (gr) {
            var teamCell = '<td rowspan="' + gr.rows.length + '" class="team-cell">' + teamLink(gr.team) + '</td>';
            var engineCell = '<td rowspan="' + gr.rows.length + '">' + esc(gr.engine) + '</td>';
            gr.rows.forEach(function (tm, i) {
              var cells = (i === 0 ? teamCell + engineCell : '') +
                '<td class="col-num">' + esc(tm.number || '') + '</td>' +
                '<td>' + indyCarDriverCell(tm) + '</td>' +
                '<td>' + esc(tm.rounds || '') + '</td>';
              indyRows.push('<tr>' + cells + '</tr>');
            });
          });
          tableWrap.innerHTML =
            '<table class="data-table indycar-teams-table">' +
            '<thead><tr>' +
            '<th>Team</th><th>Engine</th><th>' + t('th.no') + '</th><th>' + t('th.driver') + '</th><th>' + t('th.rounds') + '</th>' +
            '</tr></thead><tbody>' + indyRows.join('') + '</tbody></table>';
          return;
        }

        // Специальный рендерер для Supercars: одна таблица с Championship / Endurance / Wildcard
        if (seriesKeyTeams === 'supercars') {
          // Скрываем все вспомогательные обёртки для других серий
          ['teams-fulltime-wrap', 'teams-fulltime-title', 'teams-parttime-wrap', 'teams-parttime-title',
           'teams-nonchartered-wrap', 'teams-nonchartered-title',
           'teams-endurance-wrap', 'teams-wildcard-wrap'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.classList.add('hidden');
          });

          var tableWrap = document.getElementById('teams-table-wrap');
          var baseTable = document.getElementById('teams-table');
          if (!tableWrap || !baseTable) return;

          // Карта: производитель → модель из Car Specs
          var modelByMan = {};
          if (data && data.car_models && data.car_models.length) {
            data.car_models.forEach(function (cm) {
              if (cm && cm.manufacturer) modelByMan[cm.manufacturer] = cm.model || '';
            });
          }

          var champTeams = teams.filter(function (t) { return t.full_time === true; });
          var wildcardTeams = teams.filter(function (t) { return t.full_time !== true; });

          // Сортировка чемпионатных записей
          champTeams.sort(function (a, b) {
            var ma = (a.manufacturer || ''), mb = (b.manufacturer || '');
            if (ma !== mb) return ma < mb ? -1 : 1;
            var ta = (a.team || ''), tb = (b.team || '');
            if (ta !== tb) return ta < tb ? -1 : 1;
            var na = (a.number || ''), nb = (b.number || '');
            return na < nb ? -1 : na > nb ? 1 : 0;
          });

          // Группировка по производителю и команде, расчёт rowspan
          var manGroups = []; // [{ man, model, teams:[{name, rows:[] }], totalRows }]
          champTeams.forEach(function (driver) {
            var man = driver.manufacturer || '';
            var model = modelByMan[man] || driver.model || '';
            var teamName = driver.team || '';

            var lastGroup = manGroups.length ? manGroups[manGroups.length - 1] : null;
            var mg = lastGroup && lastGroup.man === man ? lastGroup : null;
            if (!mg) {
              mg = { man: man, model: model, teams: [], totalRows: 0 };
              manGroups.push(mg);
            }

            var teamsArr = mg.teams;
            var lastTeam = teamsArr.length ? teamsArr[teamsArr.length - 1] : null;
            var tg = lastTeam && lastTeam.name === teamName ? lastTeam : null;
            if (!tg) {
              tg = { name: teamName, rows: [] };
              teamsArr.push(tg);
            }

            tg.rows.push(driver);
            mg.totalRows++;
          });

          // Заголовок таблицы: только колонки (без надписи Championship/Endurance entries)
          var theadHtml =
            '<tr>' +
              '<th>' + t('th.manufacturer') + '</th>' +
              '<th>' + t('th.model') + '</th>' +
              '<th>' + t('th.team') + '</th>' +
              '<th>' + t('th.no') + '</th>' +
              '<th>' + t('th.driver') + '</th>' +
              '<th>' + t('th.rounds') + '</th>' +
              '<th class="supercars-col-divider"></th>' +
              '<th>Co-driver</th>' +
              '<th>' + t('th.rounds') + '</th>' +
            '</tr>';

          var bodyRows = [];

          manGroups.forEach(function (mg) {
            var manFirstRow = true;
            mg.teams.forEach(function (tg) {
              var teamFirstRow = true;
              tg.rows.forEach(function (driverRow) {
                var cells = '';

                // Manufacturer + Model — rowspan по всей группе производителя
                if (manFirstRow) {
                  cells += '<td rowspan="' + mg.totalRows + '" class="manufacturer-cell">' +
                    esc(dash(mg.man || '')) + '</td>' +
                    '<td rowspan="' + mg.totalRows + '">' + esc(dash(mg.model || '')) + '</td>';
                  manFirstRow = false;
                }

                // Team — rowspan по группе команды
                if (teamFirstRow) {
                  cells += '<td rowspan="' + tg.rows.length + '">' + teamLink(tg.name || '') + '</td>';
                  teamFirstRow = false;
                }

                cells +=
                  '<td class="col-num">' + esc(dash(driverRow.number)) + '</td>' +
                  '<td>' + driverLink(driverRow.driver) + '</td>' +
                  '<td>' + esc(dash(driverRow.rounds || '1')) + '</td>' +
                  '<td class="supercars-col-divider"></td>' +
                  '<td>' + (driverRow.co_driver ? driverLink(driverRow.co_driver) : '—') + '</td>' +
                  '<td>' + esc(dash(driverRow.co_rounds || '—')) + '</td>';

                bodyRows.push('<tr>' + cells + '</tr>');
              });
            });
          });

          // Wildcard entries секция
          if (wildcardTeams.length > 0) {
            bodyRows.push(
              '<tr class="table-separator-row">' +
                '<td colspan="9">Wildcard entries</td>' +
              '</tr>'
            );
            wildcardTeams.forEach(function (w) {
              var man = w.manufacturer || '';
              var model = modelByMan[man] || w.model || '';
              bodyRows.push(
                '<tr>' +
                  '<td class="manufacturer-cell">' + esc(dash(man)) + '</td>' +
                  '<td>' + esc(dash(model)) + '</td>' +
                  '<td>' + teamLink(w.team || '') + '</td>' +
                  '<td class="col-num">' + esc(dash(w.number)) + '</td>' +
                  '<td>' + driverLink(w.driver || '') + '</td>' +
                  '<td>' + esc(dash(w.rounds || 'TBD')) + '</td>' +
                  '<td class="supercars-col-divider"></td>' +
                  '<td>' + (w.co_driver ? driverLink(w.co_driver) : '—') + '</td>' +
                  '<td>' + esc(dash(w.co_rounds || '—')) + '</td>' +
                '</tr>'
              );
            });
          }

          baseTable.classList.add('supercars-table');
          var theadEl = baseTable.querySelector('thead');
          var tbodyEl = baseTable.querySelector('tbody');
          if (theadEl) theadEl.innerHTML = theadHtml;
          if (tbodyEl) tbodyEl.innerHTML = bodyRows.join('');
          tableWrap.classList.remove('hidden');
          // Также всегда показываем статический блок Car Specs для Supercars
          renderSupercarsStaticSpecs();
          return;
        }

        // F1: своя таблица (Team | Constructor | Chassis | Engine | No. | Driver), не сток-кар/общая логика
        // F1 current season: detailed tech table; historical F1 seasons: entry list with Rounds.
        if (seriesKeyTeams === 'f1' && teams.length > 0) {
          ['teams-fulltime-wrap', 'teams-fulltime-title', 'teams-parttime-wrap', 'teams-parttime-title',
           'teams-nonchartered-wrap', 'teams-nonchartered-title',
           'teams-endurance-wrap', 'teams-wildcard-wrap'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.classList.add('hidden');
          });
          var wrapF1 = document.getElementById('teams-table-wrap');
          if (wrapF1) {
            wrapF1.classList.remove('hidden');
            wrapF1.innerHTML = '<table class="data-table f1-teams-table" id="teams-table">' +
              '<thead><tr><th>#</th><th>Team</th><th>Constructor</th><th>Chassis</th><th>Engine</th><th data-i18n="th.no">No.</th><th data-i18n="th.driver">Driver</th></tr></thead>' +
              '<tbody>' + buildF1TeamsBody(teams) + '</tbody></table>';
            addObjectTableSort(
              wrapF1.querySelector('.data-table'),
              teams,
              null,
              [null, 'team', 'manufacturer', 'chassis', 'power_unit', 'number', 'driver'],
              function (dataCopy) { return buildF1TeamsBody(dataCopy); }
            );
          }
          return;
        }
        if (seriesKeyTeams.indexOf('f1-') === 0 && teams.length > 0) {
          // Historical F1 seasons (e.g. f1-2025): Entrant/Team | Constructor | Chassis | Power unit | No. | Driver | Rounds.
          ['teams-fulltime-wrap', 'teams-fulltime-title', 'teams-parttime-wrap', 'teams-parttime-title',
           'teams-nonchartered-wrap', 'teams-nonchartered-title',
           'teams-endurance-wrap', 'teams-wildcard-wrap'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.classList.add('hidden');
          });
          var wrapF1Season = document.getElementById('teams-table-wrap');
          if (wrapF1Season) {
            wrapF1Season.classList.remove('hidden');
            wrapF1Season.innerHTML = buildF1SeasonTeamsTableHTML(teams, seriesKeyTeams);
          }
          return;
        }

        var hasFullTimeFlag = teams.some(function (t) { return t.hasOwnProperty('full_time'); });
        if (seriesKeyTeams === 'f2' || seriesKeyTeams === 'f3' || seriesKeyTeams === 'f1') hasFullTimeFlag = false;
        var fulltimeWrap = document.getElementById('teams-fulltime-wrap');
        var parttimeWrap = document.getElementById('teams-parttime-wrap');
        var noncharteredWrap = document.getElementById('teams-nonchartered-wrap');
        var noncharteredTitle = document.getElementById('teams-nonchartered-title');
        var isCupWithNonChartered = (seriesId || '').toLowerCase() === 'nascar_cup' && data.teams_non_chartered && data.teams_non_chartered.length > 0;
        if (noncharteredWrap) noncharteredWrap.classList.add('hidden');
        if (noncharteredTitle) noncharteredTitle.classList.add('hidden');
        if (isCupWithNonChartered) {
          fulltimeWrap.classList.remove('hidden');
          if (document.getElementById('teams-fulltime-title')) {
            document.getElementById('teams-fulltime-title').classList.remove('hidden');
            document.getElementById('teams-fulltime-title').textContent = t('teams.chartered');
          }
          parttimeWrap.classList.add('hidden');
          var parttimeTitleCup = document.getElementById('teams-parttime-title');
          if (parttimeTitleCup) parttimeTitleCup.classList.add('hidden');
          document.getElementById('teams-table-wrap').classList.add('hidden');
          if (teamsFulltimeBody && teams.length > 0) {
            if (isStockCarSeriesTeams) {
              var tableFt = fulltimeWrap.querySelector('.data-table');
              var theadHtmlFt = tableFt && tableFt.querySelector('thead') ? tableFt.querySelector('thead').outerHTML : '';
              tableFt.innerHTML = theadHtmlFt + buildStockCarTeamsBody(teams);
              tableFt.classList.add('stockcar-teams-table');
              addObjectTableSort(tableFt, teams, null, [null, 'manufacturer', 'team', 'number', 'driver', 'crew_chief'], function (dataCopy) { return theadHtmlFt + buildStockCarTeamsBody(dataCopy); });
            } else {
              teamsFulltimeBody.innerHTML = teams.map(teamRow).join('');
              addObjectTableSort(fulltimeWrap.querySelector('.data-table'), teams, teamRow, [null, 'manufacturer', 'team', 'number', 'driver', 'crew_chief']);
            }
          }
          noncharteredTitle.classList.remove('hidden');
          noncharteredWrap.classList.remove('hidden');
          if (teamsNoncharteredBody) {
            if (isStockCarSeriesTeams) {
              var tableNc = noncharteredWrap.querySelector('.data-table');
              var theadHtmlNc = tableNc && tableNc.querySelector('thead') ? tableNc.querySelector('thead').outerHTML : '';
              tableNc.innerHTML = theadHtmlNc + buildStockCarTeamsBody(data.teams_non_chartered);
              tableNc.classList.add('stockcar-teams-table');
              addObjectTableSort(tableNc, data.teams_non_chartered, null, [null, 'manufacturer', 'team', 'number', 'driver', 'crew_chief'], function (dataCopy) { return theadHtmlNc + buildStockCarTeamsBody(dataCopy); });
            } else {
              teamsNoncharteredBody.innerHTML = data.teams_non_chartered.map(teamNonCharteredRow).join('');
              addObjectTableSort(noncharteredWrap.querySelector('.data-table'), data.teams_non_chartered, teamNonCharteredRow, [null, 'manufacturer', 'team', 'number', 'driver', 'crew_chief']);
            }
          }
        } else if (hasFullTimeFlag && fulltimeWrap && parttimeWrap) {
          var fullTime = teams.filter(function (t) { return t.full_time === true; });
          var partTime = teams.filter(function (t) { return t.full_time !== true; });
          var fulltimeTitle = document.getElementById('teams-fulltime-title');
          var parttimeTitle = document.getElementById('teams-parttime-title');
          fulltimeWrap.classList.toggle('hidden', fullTime.length === 0);
          if (fulltimeTitle) {
            fulltimeTitle.classList.toggle('hidden', fullTime.length === 0);
            fulltimeTitle.textContent = (seriesId || '').toLowerCase() === 'arca' ? t('teams.fullschedule') : t('teams.fulltime');
          }
          parttimeWrap.classList.toggle('hidden', partTime.length === 0);
          if (parttimeTitle) {
            parttimeTitle.classList.toggle('hidden', partTime.length === 0);
            parttimeTitle.textContent = t('teams.parttime');
          }
          document.getElementById('teams-table-wrap').classList.add('hidden');
          if (teamsFulltimeBody && fullTime.length > 0) {
            if (isStockCarSeriesTeams) {
              var tableFt2 = fulltimeWrap.querySelector('.data-table');
              var theadHtmlFt2 = tableFt2 && tableFt2.querySelector('thead') ? tableFt2.querySelector('thead').outerHTML : '';
              tableFt2.innerHTML = theadHtmlFt2 + buildStockCarTeamsBody(fullTime);
              tableFt2.classList.add('stockcar-teams-table');
              addObjectTableSort(tableFt2, fullTime, null, [null, 'manufacturer', 'team', 'number', 'driver', 'crew_chief'], function (dataCopy) { return theadHtmlFt2 + buildStockCarTeamsBody(dataCopy); });
            } else {
              if (seriesKeyTeams === 'f1') {
                teamsFulltimeBody.innerHTML = buildOpenWheelTeamsBody(fullTime);
              } else {
                teamsFulltimeBody.innerHTML = fullTime.map(teamRow).join('');
              }
              addObjectTableSort(fulltimeWrap.querySelector('.data-table'), fullTime, seriesKeyTeams === 'f1' ? null : teamRow, [null, 'manufacturer', 'team', 'number', 'driver', 'crew_chief'], seriesKeyTeams === 'f1' ? function (dataCopy) { return buildOpenWheelTeamsBody(dataCopy); } : null);
            }
          }
          if (teamsParttimeBody && partTime.length > 0) {
            if (isStockCarSeriesTeams) {
              var tablePt = parttimeWrap.querySelector('.data-table');
              var theadHtmlPt = tablePt && tablePt.querySelector('thead') ? tablePt.querySelector('thead').outerHTML : '';
              tablePt.innerHTML = theadHtmlPt + buildStockCarTeamsBody(partTime);
              tablePt.classList.add('stockcar-teams-table');
              addObjectTableSort(tablePt, partTime, null, [null, 'manufacturer', 'team', 'number', 'driver', 'crew_chief'], function (dataCopy) { return theadHtmlPt + buildStockCarTeamsBody(dataCopy); });
            } else {
              if (seriesKeyTeams === 'f1') {
                teamsParttimeBody.innerHTML = buildOpenWheelTeamsBody(partTime);
              } else {
                teamsParttimeBody.innerHTML = partTime.map(partTimeRow).join('');
              }
              addObjectTableSort(parttimeWrap.querySelector('.data-table'), partTime, seriesKeyTeams === 'f1' ? null : partTimeRow, [null, 'manufacturer', 'team', 'number', 'driver', 'crew_chief'], seriesKeyTeams === 'f1' ? function (dataCopy) { return buildOpenWheelTeamsBody(dataCopy); } : null);
            }
          }
        } else {
          if (fulltimeWrap) fulltimeWrap.classList.add('hidden');
          if (parttimeWrap) parttimeWrap.classList.add('hidden');
          var parttimeTitleElse = document.getElementById('teams-parttime-title');
          if (parttimeTitleElse) parttimeTitleElse.classList.add('hidden');
          var fulltimeTitleElse = document.getElementById('teams-fulltime-title');
          if (fulltimeTitleElse) fulltimeTitleElse.classList.add('hidden');
          document.getElementById('teams-table-wrap').classList.toggle('hidden', teams.length === 0);
          if (teams.length > 0) {
            var teamsTableBody = document.querySelector('#teams-table tbody');
            if (isStockCarSeriesTeams) {
              var tableSingle = document.getElementById('teams-table-wrap').querySelector('.data-table');
              var theadHtmlSingle = tableSingle && tableSingle.querySelector('thead') ? tableSingle.querySelector('thead').outerHTML : '';
              tableSingle.innerHTML = theadHtmlSingle + buildStockCarTeamsBody(teams);
              tableSingle.classList.add('stockcar-teams-table');
              addObjectTableSort(tableSingle, teams, null, [null, 'manufacturer', 'team', 'number', 'driver', 'crew_chief'], function (dataCopy) { return theadHtmlSingle + buildStockCarTeamsBody(dataCopy); });
            } else if (seriesKeyTeams === 'f2' || seriesKeyTeams === 'f3') {
              var wrapEl = document.getElementById('teams-table-wrap');
              if (wrapEl) {
                wrapEl.innerHTML = buildEntryListTeamsTableHTML(teams, seriesKeyTeams);
                if (typeof makeSimpleTableSortable === 'function') makeSimpleTableSortable(wrapEl.querySelector('.data-table'));
              }
            } else if (seriesKeyTeams === 'f1') {
              var wrapF1 = document.getElementById('teams-table-wrap');
              if (wrapF1) {
                wrapF1.innerHTML = '<table class="data-table f1-teams-table" id="teams-table">' +
                  '<thead><tr><th>#</th><th>Team</th><th>Constructor</th><th>Chassis</th><th>Engine</th><th data-i18n="th.no">No.</th><th data-i18n="th.driver">Driver</th></tr></thead>' +
                  '<tbody>' + buildF1TeamsBody(teams) + '</tbody></table>';
                addObjectTableSort(wrapF1.querySelector('.data-table'), teams, null, [null, 'team', 'manufacturer', 'chassis', 'power_unit', 'number', 'driver'], function (dataCopy) { return buildF1TeamsBody(dataCopy); });
              }
            } else {
              if (teamsTableBody) teamsTableBody.innerHTML = teams.map(teamRow).join('');
              addObjectTableSort(document.getElementById('teams-table-wrap').querySelector('.data-table'), teams, teamRow, [null, 'manufacturer', 'team', 'number', 'driver', 'crew_chief']);
            }
          }
        }
        var carWrap = document.getElementById('car-spec-wrap');
        var carModelsWrap = document.getElementById('car-models-table-wrap');
        var carModelsTitle = carWrap && carWrap.querySelector('h4[data-i18n="specs.car_models"]');
        var techSpecWrap = document.getElementById('technical-spec-table-wrap');
        var enginesTitle = document.getElementById('engines-spec-title');
        var enginesWrap = document.getElementById('engines-spec-table-wrap');
        var homologationTitle = document.getElementById('homologation-spec-title');
        var homologationWrap = document.getElementById('homologation-spec-table-wrap');

        // F1: статическая таблица Car Specs, не зависящая от ответа /teams
        var seriesIdLowerForSpecs = (seriesId || '').toLowerCase();
        if (seriesIdLowerForSpecs === 'f1' && carWrap && techSpecWrap && window.F1_2026_TECH_SPEC) {
          carWrap.classList.remove('hidden');
          if (carModelsTitle) carModelsTitle.classList.add('hidden');
          if (carModelsWrap) carModelsWrap.innerHTML = '';

          var specsPanelStatic = document.getElementById('specs-panel');
          if (specsPanelStatic) {
            var specsTitleStatic = specsPanelStatic.querySelector('h3[data-i18n="section.h3.specs"]');
            if (specsTitleStatic) specsTitleStatic.textContent = 'Technical regulations 2026';
          }
          var techSpecTitleStatic = carWrap.querySelector('h4[data-i18n="specs.tech_spec"]');
          if (techSpecTitleStatic) techSpecTitleStatic.classList.add('hidden');

          var f1SpecRows = window.F1_2026_TECH_SPEC.slice();
          var f1Sections = [];
          var currentTitleF1 = '';
          var currentRowsF1 = [];
          f1SpecRows.forEach(function (s) {
            if ((s.key || '') === '__SECTION__') {
              if (currentRowsF1.length > 0) f1Sections.push({ title: currentTitleF1, rows: currentRowsF1 });
              currentTitleF1 = s.value || '';
              currentRowsF1 = [];
            } else {
              currentRowsF1.push(s);
            }
          });
          if (currentRowsF1.length > 0) f1Sections.push({ title: currentTitleF1, rows: currentRowsF1 });

          techSpecWrap.className = 'table-wrap tech-spec-by-section';
          techSpecWrap.innerHTML = f1Sections.map(function (sec) {
            var body = sec.rows.map(function (s) {
              var key = localizeSpecKey(s.key);
              var val = localizeSpecValue(s.value);
              var cellVal = (val || '').indexOf('\n') >= 0
                ? (val || '').split('\n').map(function (p) { return esc(p); }).join('<br>')
                : esc(dash(val));
              return '<tr><td class="col-field">' + esc(dash(key)) + '</td><td class="col-spec-value">' + cellVal + '</td></tr>';
            }).join('');
            return '<h4 class="table-section-title">' + esc(sec.title) + '</h4>' +
                   '<div class="table-wrap tech-spec-section-table">' +
                     '<table class="data-table table-field-value"><tbody>' + body + '</tbody></table>' +
                   '</div>';
          }).join('');

          // Секция Engines / Homologation не используется для F1
          if (enginesWrap) {
            enginesWrap.innerHTML = '';
            enginesWrap.classList.add('hidden');
          }
          if (enginesTitle) enginesTitle.classList.add('hidden');
          if (homologationWrap) {
            homologationWrap.innerHTML = '';
            homologationWrap.classList.add('hidden');
          }
          if (homologationTitle) homologationTitle.classList.add('hidden');

          return;
        }
        if (carWrap && data.car_models && data.car_models.length > 0) {
          carWrap.classList.remove('hidden');
          if (carModelsTitle) carModelsTitle.classList.remove('hidden');
          if (carModelsWrap) carModelsWrap.classList.add('table-wrap');
          var hasTruckBrand = data.car_models[0] && data.car_models[0].truck_brand;
          var carTable = hasTruckBrand
            ? '<table class="data-table"><thead><tr><th>' + t('th.manufacturer') + '</th><th>' + esc(t((seriesId || '').toLowerCase() === 'arca' ? 'th.car_brand' : 'th.truck_brand')) + '</th><th>' + t('th.model') + '</th></tr></thead><tbody>' + data.car_models.map(function (c) { return '<tr><td>' + esc(dash(c.manufacturer)) + '</td><td>' + esc(dash(c.truck_brand)) + '</td><td>' + esc(dash(c.model)) + '</td></tr>'; }).join('') + '</tbody></table>'
            : '<table class="data-table"><thead><tr><th>' + t('th.manufacturer') + '</th><th>' + t('th.model') + '</th></tr></thead><tbody>' + data.car_models.map(function (c) { return '<tr><td>' + esc(dash(c.manufacturer)) + '</td><td>' + esc(dash(c.model)) + '</td></tr>'; }).join('') + '</tbody></table>';
          if (carModelsWrap) {
            carModelsWrap.innerHTML = carTable;
            var carRows = hasTruckBrand
              ? data.car_models.map(function (c) { return [c.manufacturer, c.truck_brand || '', c.model]; })
              : data.car_models.map(function (c) { return [c.manufacturer, c.model]; });
            var carTbl = carModelsWrap.querySelector('.data-table');
            if (carTbl) makeTableSortable(carTbl, carRows, esc);
          }
        } else {
          if (carModelsWrap) carModelsWrap.innerHTML = '';
          if (carModelsTitle) carModelsTitle.classList.add('hidden');
        }
        if ((seriesKeyTeams === 'f3' || seriesKeyTeams === 'f2') && carWrap && carModelsWrap) {
          if (carModelsTitle) carModelsTitle.classList.add('hidden');
          carModelsWrap.classList.remove('table-wrap');
          carModelsWrap.innerHTML = seriesKeyTeams === 'f3'
            ? '<p class="specs-chassis-line">Chassis Dallara F3 2025</p>'
            : '<p class="specs-chassis-line">Chassis Dallara F2 2024</p>';
          carWrap.classList.remove('hidden');
        }
        if (carWrap && data.technical_spec && data.technical_spec.length > 0) {
          carWrap.classList.remove('hidden');
          var specHeaderFirst = ((seriesId || '').toLowerCase() === 'arca' || (seriesId || '').toLowerCase() === 'nascar_modified') ? t('th.characteristic') : t('th.field');
          var specRows = data.technical_spec.filter(function (s) {
            var keyLc = (s.key || '').toLowerCase().trim();
            if ((seriesId || '').toLowerCase() === 'supercars' &&
                (keyLc === 'engines (2026 homologation)' || keyLc === 'homologation teams (2026)')) {
              return false;
            }
            return !specKeySkip[keyLc];
          });
          var hasSpecSections = specRows.some(function (s) { return (s.key || '') === '__SECTION__'; });
          if (techSpecWrap) {
            function specCellVal(s, val) {
              if (s.key && s.key.toLowerCase().trim() === 'power output') {
                return esc(dash(val)) + '<br>' + esc('750 hp at tracks under 1.5 miles and road courses.');
              }
              return (val || '').indexOf('\n') >= 0
                ? (val || '').split('\n').map(function (p) { return esc(p); }).join('<br>')
                : esc(dash(val));
            }
            if (hasSpecSections) {
              var sections = [];
              var currentTitle = '';
              var currentRows = [];
              specRows.forEach(function (s) {
                if ((s.key || '') === '__SECTION__') {
                  if (currentRows.length > 0) sections.push({ title: currentTitle, rows: currentRows });
                  currentTitle = s.value || '';
                  currentRows = [];
                } else {
                  currentRows.push(s);
                }
              });
              if (currentRows.length > 0) sections.push({ title: currentTitle, rows: currentRows });
              techSpecWrap.className = 'table-wrap tech-spec-by-section';
              techSpecWrap.innerHTML = sections.map(function (sec) {
                var body = sec.rows.map(function (s) {
                  var key = localizeSpecKey(s.key);
                  var val = localizeSpecValue(s.value);
                  var cellVal = specCellVal(s, val);
                  return '<tr><td class="col-field">' + esc(dash(key)) + '</td><td class="col-spec-value">' + cellVal + '</td></tr>';
                }).join('');
                return '<h4 class="table-section-title">' + esc(sec.title) + '</h4><div class="table-wrap tech-spec-section-table"><table class="data-table"><thead><tr><th>' + specHeaderFirst + '</th><th>' + t('th.value') + '</th></tr></thead><tbody>' + body + '</tbody></table></div>';
              }).join('');
            } else {
              techSpecWrap.className = 'table-wrap';
              techSpecWrap.innerHTML = '<table class="data-table"><thead><tr><th>' + specHeaderFirst + '</th><th>' + t('th.value') + '</th></tr></thead><tbody>' + specRows.map(function (s) {
                var key = localizeSpecKey(s.key);
                var val = localizeSpecValue(s.value);
                var cellVal = specCellVal(s, val);
                return '<tr><td class="col-field">' + esc(dash(key)) + '</td><td>' + cellVal + '</td></tr>';
              }).join('') + '</tbody></table>';
            }
          }
          var specTbl = techSpecWrap && techSpecWrap.querySelector('.data-table');
          var specRowsForSort = hasSpecSections ? specRows.filter(function (s) { return (s.key || '') !== '__SECTION__'; }) : specRows;
          if (specTbl && specRowsForSort.length > 0 && !hasSpecSections) makeTableSortable(specTbl, specRowsForSort.map(function (s) {
            var val = localizeSpecValue(s.value);
            if (s.key && s.key.toLowerCase().trim() === 'power output') val += '\n750 hp at tracks under 1.5 miles and road courses.';
            return [localizeSpecKey(s.key), val];
          }), esc);
          if (hasSpecSections && techSpecWrap) {
            var sectionTables = techSpecWrap.querySelectorAll('.tech-spec-section-table .data-table');
            sectionTables.forEach(function (tbl, idx) {
              var start = 0;
              for (var i = 0; i < idx; i++) start += sections[i].rows.length;
              var rowsSlice = specRowsForSort.slice(start, start + (sections[idx] ? sections[idx].rows.length : 0));
              if (tbl && rowsSlice.length > 0) makeTableSortable(tbl, rowsSlice.map(function (s) {
                var val = localizeSpecValue(s.value);
                if (s.key && s.key.toLowerCase().trim() === 'power output') val += '\n750 hp at tracks under 1.5 miles and road courses.';
                return [localizeSpecKey(s.key), val];
              }), esc);
            });
          }

          // Дополнительные таблицы Engines и Homologation только для Supercars
          if ((seriesId || '').toLowerCase() === 'supercars') {
            // Engines table
            if (enginesWrap) {
              enginesWrap.innerHTML = '';
              enginesWrap.classList.add('hidden');
            }
            if (enginesTitle) enginesTitle.classList.add('hidden');
            var scSpec = window.tgaSeries && window.tgaSeries.supercars;
            var scEngines = scSpec && scSpec.engines ? scSpec.engines : [];
            if (scEngines.length > 0 && enginesWrap) {
              var enginesTableHtml = '<div class="table-wrap"><table class="data-table"><thead><tr><th>Car model</th><th>Engine specification</th></tr></thead><tbody>' +
                scEngines.map(function (e) {
                  return '<tr><td>' + esc(dash(e.model)) + '</td><td>' + esc(dash(e.spec)) + '</td></tr>';
                }).join('') +
                '</tbody></table></div>';
              enginesWrap.innerHTML = enginesTableHtml;
              enginesWrap.classList.remove('hidden');
              if (enginesTitle) enginesTitle.classList.remove('hidden');
            }

            // Homologation table
            if (homologationWrap) {
              homologationWrap.innerHTML = '';
              homologationWrap.classList.add('hidden');
            }
            if (homologationTitle) homologationTitle.classList.add('hidden');
            var scHomolog = scSpec && scSpec.homologation ? scSpec.homologation : [];
            if (scHomolog.length > 0 && homologationWrap) {
              var homologTableHtml = '<div class="table-wrap"><table class="data-table"><thead><tr><th>Manufacturer</th><th>Homologating team</th></tr></thead><tbody>' +
                scHomolog.map(function (h) {
                  return '<tr><td>' + esc(dash(h.manufacturer)) + '</td><td>' + esc(dash(h.team)) + '</td></tr>';
                }).join('') +
                '</tbody></table></div>';
              homologationWrap.innerHTML = homologTableHtml;
              homologationWrap.classList.remove('hidden');
              if (homologationTitle) homologationTitle.classList.remove('hidden');
            }
          } else {
            // Для остальных серий чистим дополнительные секции, если они есть
            if (enginesWrap) {
              enginesWrap.innerHTML = '';
              enginesWrap.classList.add('hidden');
            }
            if (enginesTitle) enginesTitle.classList.add('hidden');
            if (homologationWrap) {
              homologationWrap.innerHTML = '';
              homologationWrap.classList.add('hidden');
            }
            if (homologationTitle) homologationTitle.classList.add('hidden');
          }
        } else {
          if (techSpecWrap) techSpecWrap.innerHTML = '';
          if (carWrap && !(data.car_models && data.car_models.length > 0)) {
            carWrap.classList.add('hidden');
          }
          if (enginesWrap) {
            enginesWrap.innerHTML = '';
            enginesWrap.classList.add('hidden');
          }
          if (enginesTitle) enginesTitle.classList.add('hidden');
          if (homologationWrap) {
            homologationWrap.innerHTML = '';
            homologationWrap.classList.add('hidden');
          }
          if (homologationTitle) homologationTitle.classList.add('hidden');
        }

        // IMSA: вкладка "Classes" с фиксированным списком классов
        var currentSeriesSlug = (window.location.pathname.split('/')[2] || '').toLowerCase();
        if (currentSeriesSlug === 'imsa') {
          var specsPanelEl = document.getElementById('specs-panel');
          var specsTitleEl = specsPanelEl && specsPanelEl.querySelector('h3[data-i18n="section.h3.specs"]');
          if (specsTitleEl) specsTitleEl.textContent = 'Classes';

          var specsSectionEl = specsPanelEl && specsPanelEl.querySelector('.specs-section');
          // Если секции ещё нет (например, для IMSA без car specs) — создаём её
          if (specsPanelEl && !specsSectionEl) {
            specsSectionEl = document.createElement('div');
            specsSectionEl.className = 'specs-section';
            specsPanelEl.appendChild(specsSectionEl);
          }

          if (specsSectionEl) {
            var imsaWrap = document.getElementById('imsa-classes-wrap');
            var imsaClasses = [
              'Grand Touring Prototype (GTP) (LMDh and LMH)',
              'Le Mans Prototype 2 (LMP2)',
              'GT Daytona Pro (GTD Pro)',
              'GT Daytona (GTD)'
            ];
            var imsaHtml =
              '<h4 class="table-section-title">Classes</h4>' +
              '<div class="table-wrap">' +
                '<table class="data-table">' +
                  '<thead><tr><th>Class</th></tr></thead>' +
                  '<tbody>' +
                    imsaClasses.map(function (name) {
                      return '<tr><td>' + esc(name) + '</td></tr>';
                    }).join('') +
                  '</tbody>' +
                '</table>' +
              '</div>';
            if (!imsaWrap) {
              imsaWrap = document.createElement('div');
              imsaWrap.id = 'imsa-classes-wrap';
              imsaWrap.className = 'car-spec';
              specsSectionEl.appendChild(imsaWrap);
            }
            imsaWrap.innerHTML = imsaHtml;
          }
        }
      })
      .catch(function (err) {
        console.error('Teams fetch failed', err);
        teamsEmpty.classList.remove('hidden');
      });

    fetchJSON('/api/series/' + encodeURIComponent((seriesId || '').toLowerCase()) + '/standings?_=' + Date.now())
      .then(function (data) {
        function renderStandings(dataObj) {
          var currentSeriesId = seriesId;
          var sk = (currentSeriesId || '').toLowerCase().replace(/-/g, '_');
          if (sk === 'nascar_xfinity') sk = 'noaps';
          var rows = dataObj && dataObj.rows ? dataObj.rows : (Array.isArray(dataObj) ? dataObj : []);
          var classes = dataObj && dataObj.classes && Array.isArray(dataObj.classes) ? dataObj.classes : [];

          // ——— IMSA: только эта серия — таблицы по классам ———
          if (sk === 'imsa' && rows.length === 0 && classes.length > 0) {
            var standingsWrapEl = document.getElementById('standings-wrap');
            var standingsImsaWrap = document.getElementById('standings-imsa-wrap');
            if (!standingsWrapEl || !standingsImsaWrap) { standingsEmpty.classList.remove('hidden'); standingsEmpty.textContent = t('standings.empty') || 'No standings data.'; return; }
            var raceOrder = (dataObj && dataObj.race_order) ? dataObj.race_order.slice() : [];
            var completedRacesArr = (dataObj && dataObj.completed_races) ? dataObj.completed_races.slice() : [];
            var completedRacesSet = {};
            for (var cr = 0; cr < completedRacesArr.length; cr++) { completedRacesSet[completedRacesArr[cr]] = true; }
            function raceHeaderLabel(code) {
              if (!code || typeof code !== 'string') return code;
              var label = code.replace(/\d+$/, '') || code;
              if (lang === 'ru') label = label.replace(/^R(\d*)$/i, 'Р$1');
              return label;
            }
            var html = '<div class="imsa-standings-by-class">';
            classes.forEach(function (cls) {
              var classRows = cls.rows || [];
              if (classRows.length === 0) return;
              var hasCar = classRows.some(function (r) { return r.car; });
              var th = '<th class="col-num">' + t('th.pos') + '</th>';
              if (hasCar) th += '<th class="col-car">' + t('th.no') + '</th>';
              th += '<th>' + t('th.driver') + '</th><th>' + t('th.team') + '</th><th>' + t('th.manufacturer') + '</th>';
              for (var i = 0; i < raceOrder.length; i++) {
                th += '<th class="col-race">' + esc(raceHeaderLabel(raceOrder[i])) + '</th>';
              }
              th += '<th class="col-pts">' + t('th.pts') + '</th>';
              var body = classRows.map(function (row) {
                var posDisplay = (row.pos === 0 || row.pos === null || row.pos === undefined) ? '—' : row.pos;
                var td = '<td class="col-num">' + posDisplay + '</td>';
                if (hasCar) td += '<td class="col-car">' + esc(row.car || '—') + '</td>';
                td += '<td>' + esc(dash(driverDisplayName(row.driver))) + '</td><td>' + esc(dash(row.team)) + '</td><td>' + esc(dash(row.manufacturer)) + '</td>';
                for (var j = 0; j < raceOrder.length; j++) {
                  var rval = row.races && row.races[raceOrder[j]] ? String(row.races[raceOrder[j]]).trim() : '';
                  var raceCode = raceOrder[j];
                  var isCompleted = completedRacesSet[raceCode];
                  var raceCell = rval ? esc(rval) : (isCompleted ? '—' : '');
                  td += '<td class="col-race">' + raceCell + '</td>';
                }
                td += '<td class="col-pts">' + esc(dash(row.points)) + '</td>';
                return '<tr>' + td + '</tr>';
              }).join('');
              html += '<h4 class="table-section-title">' + esc(cls.name || cls.id || '') + '</h4>';
              html += '<div class="table-wrap"><table class="data-table standings-class-table">';
              html += '<thead><tr>' + th + '</tr></thead><tbody>' + body + '</tbody></table></div>';
            });
            html += '</div>';
            standingsImsaWrap.innerHTML = html;
            standingsImsaWrap.classList.remove('hidden');
            standingsWrapEl.classList.add('hidden');
            standingsEmpty.classList.add('hidden');
            syncStandingsScrollBars();
            return;
          }
          var standingsImsaWrapReset = document.getElementById('standings-imsa-wrap');
          if (standingsImsaWrapReset) {
            standingsImsaWrapReset.innerHTML = '';
            standingsImsaWrapReset.classList.add('hidden');
          }
          document.getElementById('standings-wrap').classList.remove('hidden');
          if (rows.length === 0) {
            standingsEmpty.classList.remove('hidden');
            standingsEmpty.textContent = t('standings.empty') || 'No standings data.';
            return;
          }
          var raceOrder = (dataObj && dataObj.race_order) ? dataObj.race_order.slice() : [];
          var completedRacesArr = (dataObj && dataObj.completed_races) ? dataObj.completed_races.slice() : [];

          // ——— NASCAR Cup: только эта серия — фильтр Clash ———
          if (sk === 'nascar_cup') {
            raceOrder = raceOrder.filter(function (code) { return String(code || '').toLowerCase() !== 'clash'; });
            completedRacesArr = completedRacesArr.filter(function (code) { return String(code || '').toLowerCase() !== 'clash'; });
          }
          var completedRacesSet = {};
          for (var cr = 0; cr < completedRacesArr.length; cr++) { completedRacesSet[completedRacesArr[cr]] = true; }

          // ——— F1 / F2 / F3: таблица с названиями этапов сверху, колонки гонок, Pts — последний ———
          if (sk === 'f1' || sk === 'f2' || sk === 'f3' || String(currentSeriesId || '').toLowerCase().indexOf('f1-') === 0) {
            var eventNames = (dataObj && dataObj.event_names && Array.isArray(dataObj.event_names)) ? dataObj.event_names : [];
            var theadElF1 = document.getElementById('standings-thead') && document.getElementById('standings-thead').parentNode;
            var hasRaceCols = raceOrder && raceOrder.length > 0;
            var isF1SeasonView = String(currentSeriesId || '').toLowerCase().indexOf('f1-') === 0;
            if (hasRaceCols && eventNames.length >= raceOrder.length && theadElF1) {
              // Для исторических сезонных страниц F1 (например /season/f1-2025/standings)
              // используем однострочный заголовок: Pos | # | Driver | [этапы] | Pts.
              if (isF1SeasonView) {
                var headerRow = '<tr id="standings-thead">';
                headerRow += '<th class="col-num">' + t('th.pos') + '</th>';
                headerRow += '<th class="col-car">#</th>';
                headerRow += '<th>' + t('th.driver') + '</th>';
                for (var i = 0; i < raceOrder.length; i++) {
                  var en = eventNames[i] || '';
                  var compact = en.replace(/Grand Prix/gi, '').trim();
                  if (compact.length >= 3) {
                    en = compact.slice(0, 3).toUpperCase();
                  } else {
                    en = en.slice(0, 3).toUpperCase();
                  }
                  var rc = raceOrder[i] || '';
                  var suffix = rc.slice(-1) === 'S' ? '\u00b7S' : (rc.slice(-1) === 'F' ? '\u00b7F' : '');
                  headerRow += '<th class="col-race">' + esc(en + suffix) + '</th>';
                }
                headerRow += '<th class="col-pts">' + t('th.pts') + '</th></tr>';
                theadElF1.innerHTML = headerRow;
              } else if (sk === 'f1') {
                // Текущий сезон F1: однострочная шапка с трёхбуквенными кодами этапов,
                // для спринт‑уикендов добавляем суффиксы *S / *F по коду из raceOrder (RnS / RnF).
                var headerRowCurrentF1 = '<tr id="standings-thead">';
                headerRowCurrentF1 += '<th class="col-num">' + t('th.pos') + '</th>';
                headerRowCurrentF1 += '<th class="col-car">#</th>';
                headerRowCurrentF1 += '<th>' + t('th.driver') + '</th>';
                for (var ci = 0; ci < raceOrder.length; ci++) {
                  var enCur = eventNames[ci] || '';
                  var compactCur = enCur.replace(/Grand Prix/gi, '').trim();
                  if (compactCur.length >= 3) {
                    enCur = compactCur.slice(0, 3).toUpperCase();
                  } else {
                    enCur = enCur.slice(0, 3).toUpperCase();
                  }
                  var rcCode = String(raceOrder[ci] || '');
                  var spSuffix = rcCode.slice(-1) === 'S'
                    ? '*S'
                    : (rcCode.slice(-1) === 'F' ? '*F' : '');
                  headerRowCurrentF1 += '<th class="col-race">' + esc(enCur + spSuffix) + '</th>';
                }
                headerRowCurrentF1 += '<th class="col-pts">' + t('th.pts') + '</th></tr>';
                theadElF1.innerHTML = headerRowCurrentF1;
              } else {
                // Формулы F2/F3 — двухстрочная шапка с группировкой этапов.
                var eventRow = '';
                var prevName = null;
                var colSpan = 0;
                for (var i = 0; i < raceOrder.length; i++) {
                  var en = eventNames[i] || '';
                  if (en === prevName) {
                    colSpan++;
                  } else {
                    if (prevName != null) eventRow += '<th class="col-race-group" colspan="' + colSpan + '">' + esc(prevName) + '</th>';
                    prevName = en;
                    colSpan = 1;
                  }
                }
                if (prevName != null) eventRow += '<th class="col-race-group" colspan="' + colSpan + '">' + esc(prevName) + '</th>';
                var topRowF1 = '<tr class="standings-header-row-top">' +
                  '<th class="col-num" rowspan="2">' + t('th.pos') + '</th>' +
                  '<th class="col-car" rowspan="2">#</th>' +
                  '<th rowspan="2">' + t('th.driver') + '</th>' +
                  eventRow +
                  '<th class="col-pts" rowspan="2">' + t('th.pts') + '</th></tr>';
                var bottomRowF1 = '<tr id="standings-thead">';
                var useSprintFeature = (sk === 'f2' || sk === 'f3');
                for (var j = 0; j < raceOrder.length; j++) {
                  var sub = (raceOrder[j] != null && raceOrder[j] !== undefined) ? String(raceOrder[j]).replace(/<nil>|^null$/gi, '').trim() : '';
                  var subLabel;
                  if (useSprintFeature) {
                    subLabel = (j % 2 === 0 ? (t('standings.sprint') || 'Sprint') : (t('standings.feature') || 'Feature'));
                  } else {
                    subLabel = (sub || 'Race');
                  }
                  bottomRowF1 += '<th class="col-race">' + esc(subLabel) + '</th>';
                }
                bottomRowF1 += '</tr>';
                theadElF1.innerHTML = topRowF1 + bottomRowF1;
              }
              standingsBody.innerHTML = rows.map(function (row) {
                var posDisplay = (row.pos === 0 || row.pos === null || row.pos === undefined) ? '—' : row.pos;
                var td = '<td class="col-num">' + posDisplay + '</td><td class="col-car">' + esc(dash(row.car || '—')) + '</td><td>' + esc(dash(driverDisplayName(row.driver))) + '</td>';
                for (var k = 0; k < raceOrder.length; k++) {
                  var rv = (row.races && row.races[raceOrder[k]] != null) ? row.races[raceOrder[k]] : '—';
                  td += '<td class="col-race">' + esc(dash(rv)) + '</td>';
                }
                td += '<td class="col-pts">' + esc(dash(row.points)) + '</td>';
                return '<tr>' + td + '</tr>';
              }).join('');
            } else {
              var thSimple = '<th class="col-num">' + t('th.pos') + '</th><th class="col-car">#</th><th>' + t('th.driver') + '</th><th class="col-pts">' + t('th.pts') + '</th>';
              if (document.getElementById('standings-thead')) document.getElementById('standings-thead').innerHTML = thSimple;
              standingsBody.innerHTML = rows.map(function (row) {
                var posDisplay = (row.pos === 0 || row.pos === null || row.pos === undefined) ? '—' : row.pos;
                return '<tr><td class="col-num">' + posDisplay + '</td><td class="col-car">' + esc(dash(row.car || '—')) + '</td><td>' + esc(dash(driverDisplayName(row.driver))) + '</td><td class="col-pts">' + esc(dash(row.points)) + '</td></tr>';
              }).join('');
            }
            syncStandingsScrollBars();
            var inel = dataObj && dataObj.ineligible && Array.isArray(dataObj.ineligible) ? dataObj.ineligible : [];
            if (inel.length > 0 && document.getElementById('standings-ineligible-title') && (standingsIneligibleWrap || document.getElementById('standings-ineligible-scroll-container'))) {
              document.getElementById('standings-ineligible-title').classList.remove('hidden');
              document.getElementById('standings-ineligible-title').textContent = t('standings.ineligible');
              var inelTh = document.getElementById('standings-ineligible-thead');
              if (inelTh) {
                if (hasRaceCols && eventNames.length >= raceOrder.length) {
                  var inelH = '<th class="col-num">' + t('th.pos') + '</th><th class="col-car">#</th><th>' + t('th.driver') + '</th>';
                  for (var qi = 0; qi < raceOrder.length; qi++) {
                    var rq = (raceOrder[qi] != null && raceOrder[qi] !== undefined) ? String(raceOrder[qi]).replace(/<nil>|^null$/gi, '').trim() : '';
                    // Для сезонных страниц F1 скрываем текст в заголовках колонок гонок и в таблице ineligible.
                    var rqLabel = isF1SeasonView ? '' : (rq || 'Race');
                    inelH += '<th class="col-race">' + esc(rqLabel) + '</th>';
                  }
                  inelH += '<th class="col-pts">' + t('th.pts') + '</th>';
                  inelTh.innerHTML = inelH;
                } else {
                  inelTh.innerHTML = '<th class="col-num">' + t('th.pos') + '</th><th class="col-car">#</th><th>' + t('th.driver') + '</th><th class="col-pts">' + t('th.pts') + '</th>';
                }
              }
              if (standingsIneligibleBody) {
                standingsIneligibleBody.innerHTML = inel.map(function (row) {
                  var posDisplay = (row.pos === 0 || row.pos === null || row.pos === undefined) ? '—' : row.pos;
                  var td = '<td class="col-num">' + posDisplay + '</td><td class="col-car">' + esc(dash(row.car || '—')) + '</td><td>' + esc(dash(driverDisplayName(row.driver))) + '</td>';
                  if (hasRaceCols && row.races) for (var k = 0; k < raceOrder.length; k++) td += '<td class="col-race">' + esc(dash(row.races[raceOrder[k]] || '—')) + '</td>';
                  td += '<td class="col-pts">' + esc(dash(row.points)) + '</td>';
                  return '<tr>' + td + '</tr>';
                }).join('');
              }
            }
            return;
          }

          // ——— NASCAR Cup, NOAPS, Truck, ARCA, Modified, IndyCar, Supercars — полная таблица (Pos, #, Driver, Team, Manufacturer, гонки, Pts, Stage и т.д.) ———
          var theadRow = document.getElementById('standings-thead');
          var theadEl  = theadRow && theadRow.parentNode ? theadRow.parentNode : null;
          function raceHeaderLabel(code) {
            if (!code || typeof code !== 'string') return code;
            var label = code.replace(/\d+$/, '') || code;
            if (lang === 'ru') label = label.replace(/^R(\d*)$/i, 'Р$1');
            return label;
          }
          var manufacturerLabel = sk === 'nascar_modified'
            ? t('th.chassis')
            : (sk === 'indycar' ? t('th.engine') : t('th.manufacturer'));
          var hasCar    = rows.some(function (r) { return r.car; });
          var hasWth    = rows.some(function (r) { return r.wth; });
          var hasStatus = rows.some(function (r) { return r.status; });
          var supportsStages = (sk === 'nascar_cup' || sk === 'noaps' || sk === 'nascar_truck');
          var hasStages = supportsStages && rows.some(function (r) {
            if (r.stages == null) return false;
            var s = String(r.stages).trim();
            return s !== '' && s !== '0' && s !== '—';
          });
          // carOff = смещение индекса колонки из-за наличия колонки Car
          var carOff = hasCar ? 1 : 0;
          var th = '<th class="col-num">' + t('th.pos') + '</th>';
          if (hasCar) th += '<th class="col-car">' + t('th.no') + '</th>';
          th += '<th>' + t('th.driver') + '</th><th>' + t('th.team') + '</th><th>' + esc(manufacturerLabel) + '</th>';
          for (var i = 0; i < raceOrder.length; i++) {
            th += '<th class="col-race">' + esc(raceHeaderLabel(raceOrder[i])) + '</th>';
          }
          if (hasStages) th += '<th>' + t('th.stage_col') + '</th>';
          if (hasWth)    th += '<th>' + t('th.wth') + '</th>';
          if (hasStatus) th += '<th>' + t('th.status') + '</th>';
          th += '<th class="col-pts">' + t('th.pts') + '</th>';

          // Supercars: двухстрочный заголовок с этапами Sydney (1–3) и Melbourne (4–7)
          if (theadEl && sk === 'supercars' &&
              raceOrder.length > 0 &&
              raceOrder.every(function (code) { return /^(SMP|MLB)\d+$/i.test(String(code || '')); })) {
            var supercarsEventHref = '/event/supercars-2026-1/race';
            var sydneyCount = 3;
            var melbourneCount = raceOrder.length - sydneyCount;
            if (melbourneCount < 1) melbourneCount = 0;
            sydneyCount = Math.min(sydneyCount, raceOrder.length);

            var topRow = '<tr class="standings-header-row-top">';
            topRow += '<th class="col-num" rowspan="2">' + t('th.pos') + '</th>';
            if (hasCar) topRow += '<th class="col-car" rowspan="2">' + t('th.no') + '</th>';
            topRow += '<th rowspan="2">' + t('th.driver') + '</th>';
            topRow += '<th rowspan="2">' + t('th.team') + '</th>';
            topRow += '<th rowspan="2">' + esc(manufacturerLabel) + '</th>';
            if (sydneyCount > 0) topRow += '<th class="col-race-group" colspan="' + sydneyCount + '">Sydney</th>';
            if (melbourneCount > 0) topRow += '<th class="col-race-group supercars-stage-divider" colspan="' + melbourneCount + '">Melbourne</th>';
            if (hasStages) topRow += '<th rowspan="2">' + t('th.stage_col') + '</th>';
            if (hasWth)    topRow += '<th rowspan="2">' + t('th.wth') + '</th>';
            if (hasStatus) topRow += '<th rowspan="2">' + t('th.status') + '</th>';
            topRow += '<th class="col-pts" rowspan="2">' + t('th.pts') + '</th></tr>';

            var bottomRow = '<tr id="standings-thead">';
            for (var j = 0; j < raceOrder.length; j++) {
              var code = String(raceOrder[j] || '');
              var num = code.replace(/^(SMP|MLB)/i, '') || (j + 1);
              var divClass = (j === sydneyCount && melbourneCount > 0) ? ' col-race supercars-stage-divider' : ' col-race';
              bottomRow += '<th class="' + divClass.trim() + '"><a href="' + supercarsEventHref + '" class="standings-race-link">' + esc(num) + '</a></th>';
            }
            bottomRow += '</tr>';

            theadEl.innerHTML = topRow + bottomRow;
            theadRow = document.getElementById('standings-thead');
          } else if (theadEl) {
            // Для всех остальных серий всегда сбрасываем thead к одному ряду,
            // чтобы не оставались суперкаровские групповые заголовки (Sydney/Melbourne).
            theadEl.innerHTML = '<tr id="standings-thead"></tr>';
            theadRow = document.getElementById('standings-thead');
            theadRow.innerHTML = th;
          }
        function renderStandingsRows(list) {
          standingsBody.innerHTML = list.map(function (row) {
            var posDisplay = (row.pos === 0 || row.pos === null || row.pos === undefined) ? '—' : row.pos;
              var td = '<td class="col-num">' + posDisplay + '</td>';
              if (hasCar) td += '<td class="col-car">' + esc(dash(row.car)) + '</td>';
              td += '<td>' + esc(dash(driverDisplayName(row.driver))) + '</td><td>' + esc(dash(row.team)) + '</td><td>' + esc(dash(row.manufacturer)) + '</td>';
            for (var j = 0; j < raceOrder.length; j++) {
                var rval = row.races && row.races[raceOrder[j]] ? String(row.races[raceOrder[j]]).trim() : '';
                var emptyStage = !rval || rval === '—' || rval === '-';
                var raceCode = raceOrder[j];
                var isCompleted = completedRacesSet[raceCode];
                var raceCell = !emptyStage ? (rval.indexOf('*') >= 0
                  ? esc(rval.slice(0, rval.indexOf('*'))) + '<sup class="stage-pts">' + esc(rval.slice(rval.indexOf('*'))) + '</sup>'
                  : esc(rval)) : (isCompleted ? '—' : '');
                td += '<td class="col-race">' + raceCell + '</td>';
              }
              if (hasStages) td += '<td>' + esc(dash(row.stages)) + '</td>';
              if (hasWth)    td += '<td>' + esc(dash(row.wth)) + '</td>';
              if (hasStatus) td += '<td>' + esc(dash(row.status)) + '</td>';
              td += '<td class="col-pts">' + esc(dash(row.points)) + '</td>';
            return '<tr>' + td + '</tr>';
          }).join('');
        }
        renderStandingsRows(rows);
        var rowsCopy = rows.slice();
        var stThs = theadRow ? theadRow.querySelectorAll('th') : [];

          // Порядок колонок: pos, [car], driver, team, manufacturer, races..., stage?, wth?, status?, pts (последний)
          var stageOff = hasStages ? 1 : 0;
          var wthOff = hasWth ? 1 : 0;
          var statusOff = hasStatus ? 1 : 0;
          var baseAfterRaces = 4 + carOff + raceOrder.length;
          var ptsColIndex = baseAfterRaces + stageOff + wthOff + statusOff;
          function getStandingVal(row, colIndex) {
            var raceIdx = colIndex - 4 - carOff;
            if (colIndex === 0)                               return row.pos || 0;
            if (hasCar && colIndex === 1)                     return row.car || '';
            if (colIndex === 1 + carOff)                      return row.driver || '';
            if (colIndex === 2 + carOff)                      return row.team || '';
            if (colIndex === 3 + carOff)                      return row.manufacturer || '';
            if (raceIdx >= 0 && raceIdx < raceOrder.length)  return (row.races && row.races[raceOrder[raceIdx]]) || '';
            if (hasStages && colIndex === baseAfterRaces)     return row.stages || '';
            if (hasWth && colIndex === baseAfterRaces + stageOff) return row.wth || '';
            if (hasStatus && colIndex === baseAfterRaces + stageOff + wthOff) return row.status || '';
            if (colIndex === ptsColIndex)                     return row.points || '';
            return '';
          }

          function isEmpty(v) { return v === '' || v === '—' || v == null || v === 0; }

          // Числовое значение для колонок с позициями/очками (убираем аннотацию *N)
          function numVal(v) {
            if (v == null || v === '' || v === '—') return null;
            var s = String(v).replace(/\*.*$/, '').trim();
            var n = parseFloat(s);
            return isNaN(n) ? null : n;
          }

          // Числовые колонки: pos, race results, points (последняя колонка)
          function isNumericCol(colIndex) {
            if (colIndex === 0) return true;
            var raceIdx = colIndex - 4 - carOff;
            if (raceIdx >= 0 && raceIdx < raceOrder.length) return true;
            if (colIndex === ptsColIndex) return true;
            return false;
          }

        for (var c = 0; c < stThs.length; c++) {
          (function (colIndex) {
            var dir = 1;
            stThs[colIndex].classList.add('sortable');
            stThs[colIndex].addEventListener('click', function () {
                var numeric = isNumericCol(colIndex);
              rowsCopy.sort(function (a, b) {
                  var va = getStandingVal(a, colIndex);
                  var vb = getStandingVal(b, colIndex);
                  // Пустые/прочерки — всегда в конец (независимо от направления)
                  var ae = isEmpty(va), be = isEmpty(vb);
                  if (ae && be) return 0;
                  if (ae) return 1;
                  if (be) return -1;
                  if (numeric) {
                    var na = numVal(va), nb = numVal(vb);
                    if (na !== null && nb !== null) return dir * (na - nb);
                  }
                return dir * String(va).localeCompare(String(vb), undefined, { numeric: true });
              });
                [].forEach.call(stThs, function (th) { th.classList.remove('sort-asc', 'sort-desc'); });
                stThs[colIndex].classList.add(dir === 1 ? 'sort-asc' : 'sort-desc');
              dir = -dir;
              renderStandingsRows(rowsCopy);
            });
          })(c);
        }
        syncStandingsScrollBars();
          var ineligible = dataObj && dataObj.ineligible && Array.isArray(dataObj.ineligible) ? dataObj.ineligible : [];
          var ineligibleFullFormat = ineligible.length > 0 && ineligible[0] && ineligible[0].driver !== undefined && ineligible[0].races !== undefined;
          var ineligibleScrollContainer = document.getElementById('standings-ineligible-scroll-container');
          if ((standingsIneligibleWrap || ineligibleScrollContainer) && document.getElementById('standings-ineligible-title')) {
            if (ineligible.length > 0) {
              document.getElementById('standings-ineligible-title').classList.remove('hidden');
              document.getElementById('standings-ineligible-title').textContent = t('standings.ineligible');
              if (ineligibleScrollContainer) ineligibleScrollContainer.classList.remove('hidden');
              if (ineligibleFullFormat) {
                var ineligibleThead = document.getElementById('standings-ineligible-thead');
                if (ineligibleThead) ineligibleThead.innerHTML = th;
                if (standingsIneligibleBody) {
                  standingsIneligibleBody.innerHTML = ineligible.map(function (row) {
                    var posDisplay = (row.pos === 0 || row.pos === null || row.pos === undefined) ? '—' : row.pos;
                    var td = '<td class="col-num">' + posDisplay + '</td>';
                    if (hasCar) td += '<td class="col-car">' + esc(dash(row.car)) + '</td>';
                    td += '<td>' + esc(dash(driverDisplayName(row.driver))) + '</td><td>' + esc(dash(row.team)) + '</td><td>' + esc(dash(row.manufacturer)) + '</td>';
                    for (var j = 0; j < raceOrder.length; j++) {
                      var rval = row.races && row.races[raceOrder[j]] ? String(row.races[raceOrder[j]]).trim() : '';
                      var emptyStage = !rval || rval === '—' || rval === '-';
                      var raceCode = raceOrder[j];
                      var isCompleted = completedRacesSet[raceCode];
                      var raceCell = !emptyStage ? (rval.indexOf('*') >= 0 ? esc(rval.slice(0, rval.indexOf('*'))) + '<sup class="stage-pts">' + esc(rval.slice(rval.indexOf('*'))) + '</sup>' : esc(rval)) : (isCompleted ? '—' : '');
                      td += '<td class="col-race">' + raceCell + '</td>';
                    }
                    td += '<td class="col-pts">' + esc(dash(row.points)) + '</td>';
                    if (hasStages) td += '<td>' + esc(dash(row.stages)) + '</td>';
                    if (hasWth) td += '<td>' + esc(dash(row.wth)) + '</td>';
                    if (hasStatus) td += '<td>' + esc(dash(row.status)) + '</td>';
                    return '<tr>' + td + '</tr>';
                  }).join('');
                }
              } else if (standingsIneligibleBody) {
                standingsIneligibleBody.innerHTML = ineligible.map(function (row) {
                  return '<tr><td>' + esc(dash(row.team)) + '</td><td>' + esc(dash(row.manufacturer)) + '</td><td>' + esc(dash(row.status)) + '</td></tr>';
                }).join('');
                var ineligibleThead = document.getElementById('standings-ineligible-thead');
                if (ineligibleThead) ineligibleThead.innerHTML = '<th data-i18n="th.team">Team</th><th data-i18n="th.manufacturer">Manufacturer</th><th data-i18n="th.status">Status</th>';
              }
            } else {
              document.getElementById('standings-ineligible-title').classList.add('hidden');
              if (ineligibleScrollContainer) ineligibleScrollContainer.classList.add('hidden');
              if (standingsIneligibleBody) standingsIneligibleBody.innerHTML = '';
            }
          }
        }

        var seriesKey = (seriesId || '').toLowerCase();

        // Для NASCAR Cup — колонка DAY не должна учитывать Clash.
        if (seriesKey === 'nascar_cup') {
          return rebuildNascarCupDayFromDaytona(data).then(function (customData) {
            renderStandings(customData || { rows: [] });
          }).catch(function () {
            renderStandings(data);
          });
        }

        // Supercars: обогащаем team и manufacturer из /series/supercars/teams
        if (seriesKey === 'supercars') {
          fetchJSON('/api/series/supercars/teams').then(function (teamsResp) {
            var teams = (teamsResp && teamsResp.teams) ? teamsResp.teams : [];
            var byCar = {};
            teams.forEach(function (t) {
              if (t.number != null) byCar[String(t.number)] = { team: t.team, manufacturer: t.manufacturer };
            });
            (data.rows || []).forEach(function (row) {
              var m = byCar[String(row.car)];
              if (m) {
                if (m.team) row.team = m.team;
                if (m.manufacturer) row.manufacturer = m.manufacturer;
              }
            });
            renderStandings(data);
          }).catch(function () {
            renderStandings(data);
          });
          return;
        }

        renderStandings(data);
      })
      .catch(function () { standingsEmpty.classList.remove('hidden'); standingsEmpty.textContent = t('standings.empty') || 'No standings data.'; });

    if (statsPanel && hasStats && subPath === 'stats') {
      var statsUrl = '/api/series/' + encodeURIComponent((seriesId || '').toLowerCase()) + '/stats';
      var teamStatsWrap = document.getElementById('team-stats-wrap');

      // ─── Упрощённый рендер для F1 (обходит сложный старый рендер) ────────────────
      var sidLowerForStats = (seriesId || '').toLowerCase();
      var isF1LikeStats = sidLowerForStats === 'f1' || sidLowerForStats.indexOf('f1-') === 0;
      if (isF1LikeStats) {
        if (teamStatsWrap) teamStatsWrap.classList.add('hidden');
        function fmtNumF1(v, digits) {
          if (v == null || v === '') return '—';
          var num = typeof v === 'number' ? v : parseFloat(String(v));
          if (!isFinite(num)) return String(v);
          return typeof digits === 'number' ? num.toFixed(digits) : String(num);
        }

        function escHtmlF1(s) {
          return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        }

        fetchJSON(statsUrl)
          .then(function (data) {
            var rows = data && data.rows ? data.rows : (Array.isArray(data) ? data : []);
            var table = document.getElementById('stats-table');
            if (!table) return;
            var thead = table.querySelector('thead tr');
            var tbody = table.querySelector('tbody');
            if (!thead || !tbody) return;

            if (!rows || rows.length === 0) {
              tbody.innerHTML = '';
              if (statsEmpty) statsEmpty.classList.remove('hidden');
              return;
            }

            // Для сезонной страницы F1 2025 используем корректные шасси 2025 года:
            // маппинг по имени пилота → шасси берём из F1_2025_CHASSIS_BY_DRIVER.
            var isF12025SeasonStats =
              sidLowerForStats === 'f1-2025' ||
              (sidLowerForStats === 'f1' && window.location && window.location.pathname.indexOf('/season/f1-2025') >= 0);
            if (isF12025SeasonStats &&
                window.TGA &&
                typeof window.TGA.F1_2025_CHASSIS_BY_DRIVER === 'object' &&
                window.TGA.F1_2025_CHASSIS_BY_DRIVER) {
              var chassisByDriver = window.TGA.F1_2025_CHASSIS_BY_DRIVER;
              rows.forEach(function (row) {
                var drv = String(row.driver || '').trim();
                if (!drv) return;
                var ch = chassisByDriver[drv];
                if (ch) {
                  row.chassis = ch;
                }
                // Нормализуем название команды Alpine → Alpine-Renault для F1 2025.
                if (String(row.team || '').trim() === 'Alpine') {
                  row.team = 'Alpine-Renault';
                }
              });
            }

            if (statsEmpty) statsEmpty.classList.add('hidden');

            thead.innerHTML =
              '<th>Pos</th>' +
              '<th>#</th>' +
              '<th>Driver</th>' +
              '<th>Team</th>' +
              '<th>Starts</th>' +
              '<th>Wins</th>' +
              '<th>Top-2</th>' +
              '<th>Top-3</th>' +
              '<th>Podiums</th>' +
              '<th>Top-5</th>' +
              '<th>Top-10</th>' +
              '<th>Avg. Start</th>' +
              '<th>Avg. Qualifying</th>' +
              '<th>Poles</th>' +
              '<th>Avg. Finish</th>' +
              '<th>Q2</th>' +
              '<th>Q3</th>' +
              '<th>Laps Led</th>' +
              '<th>Laps Completed</th>';

            var html = rows.map(function (row, idx) {
              var pos = idx + 1;
              var car = row.car || '';
              var driver = row.driver || '';
              var team = row.team || '';
              var races = row.races || 0;
              var wins = row.wins || 0;
              var podiums = row.podiums || 0;
              var top5 = row.top5 || 0;
              var top10 = row.top10 || 0;
              // Avg. Start / Avg. Finish: прочерк, если данных нет (null/пусто/0).
              var hasStart = row.avg_start != null && row.avg_start !== '' && row.avg_start !== 0;
              var avgStart = hasStart ? fmtNumF1(row.avg_start, 2) : '—';
              var hasFinish = row.avg_finish != null && row.avg_finish !== '' && row.avg_finish !== 0;
              var avgFinish = hasFinish ? fmtNumF1(row.avg_finish, 2) : '—';
              // Avg. Qualifying: показываем число для всех, у кого есть квалификация;
              // прочерк только если пилот вообще не участвовал (null/пусто).
              var hasQual = row.avg_qualifying != null && row.avg_qualifying !== '';
              var avgQual = hasQual ? fmtNumF1(row.avg_qualifying, 2) : '—';
              var poles = row.poles != null ? row.poles : 0;
              var q2 = row.q2_passes || 0;
              var q3 = row.q3_passes || 0;
              var lapsLed = row.laps_led || 0;
              var lapsCompleted = row.laps_completed != null ? row.laps_completed : '—';
              var top2 = row.top2 || 0;
              var top3 = row.top3 || 0;

              return '' +
                '<tr>' +
                  '<td class="col-num">' + pos + '</td>' +
                  '<td class="col-car">' + escHtmlF1(car) + '</td>' +
                  '<td>' + driverLink(driver) + '</td>' +
                  '<td>' + teamLink(team) + '</td>' +
                  '<td>' + races + '</td>' +
                  '<td>' + wins + '</td>' +
                  '<td>' + top2 + '</td>' +
                  '<td>' + top3 + '</td>' +
                  '<td>' + podiums + '</td>' +
                  '<td>' + top5 + '</td>' +
                  '<td>' + top10 + '</td>' +
                  '<td>' + avgStart + '</td>' +
                  '<td>' + avgQual + '</td>' +
                  '<td>' + poles + '</td>' +
                  '<td>' + avgFinish + '</td>' +
                  '<td>' + q2 + '</td>' +
                  '<td>' + q3 + '</td>' +
                  '<td>' + lapsLed + '</td>' +
                  '<td>' + lapsCompleted + '</td>' +
                '</tr>';
            }).join('');

            tbody.innerHTML = html;
            // Enable simple column sorting for F1 driver stats.
            if (typeof makeSimpleTableSortable === 'function') {
              makeSimpleTableSortable(table);
            }

            // Manufacturer Stats для F1: заполняем из data.manufacturers.
            var manRows = data && data.manufacturers ? data.manufacturers : [];
            var manTable = document.getElementById('manufacturer-stats-table');
            var manEmpty = document.getElementById('manufacturer-stats-empty');
            var manWrap = document.getElementById('manufacturer-stats-wrap');
            if (manWrap) manWrap.classList.remove('hidden');
            if (manTable && manRows.length > 0) {
              var manTbody = manTable.querySelector('tbody');
              if (manTbody) {
                if (manEmpty) manEmpty.classList.add('hidden');
                manTbody.innerHTML = manRows.map(function (row, idx) {
                  var avgStart = (row.avg_start == null || row.avg_start === 0) ? '—' : fmtNumF1(row.avg_start, 2);
                  var avgQual = (row.avg_qualifying == null || row.avg_qualifying === 0 || row.avg_qualifying === '') ? '—' : fmtNumF1(row.avg_qualifying, 2);
                  var avgFinish = (row.avg_finish == null || row.avg_finish === 0) ? '—' : fmtNumF1(row.avg_finish, 2);
                  return '<tr>' +
                    '<td class="col-num">' + (idx + 1) + '</td>' +
                    '<td>' + escHtmlF1(row.manufacturer || '') + '</td>' +
                    '<td>' + (row.races || 0) + '</td>' +
                    '<td>' + (row.wins || 0) + '</td>' +
                    '<td>' + (row.top2 || 0) + '</td>' +
                    '<td>' + (row.top3 || 0) + '</td>' +
                    '<td>' + (row.podiums != null ? row.podiums : (row.wins || 0) + (row.top2 || 0) + (row.top3 || 0)) + '</td>' +
                    '<td>' + (row.top5 || 0) + '</td>' +
                    '<td>' + (row.top10 || 0) + '</td>' +
                    '<td>' + avgStart + '</td>' +
                    '<td>' + avgQual + '</td>' +
                    '<td>' + avgFinish + '</td>' +
                    '<td>' + (row.q2_passes != null ? row.q2_passes : 0) + '</td>' +
                    '<td>' + (row.q3_passes != null ? row.q3_passes : 0) + '</td>' +
                    '<td>' + (row.laps_led || 0) + '</td>' +
                    '<td>' + (row.laps_completed != null ? row.laps_completed : '—') + '</td>' +
                    '</tr>';
                }).join('');
                // Enable simple column sorting for F1 manufacturer stats.
                if (typeof makeSimpleTableSortable === 'function') {
                  makeSimpleTableSortable(manTable);
                }
              }
            } else {
              if (manEmpty) manEmpty.classList.remove('hidden');
              if (manTable) {
                var mt = manTable.querySelector('tbody');
                if (mt) mt.innerHTML = '';
              }
            }
          })
          .catch(function (err) {
            if (window.console && console.error) console.error('F1 stats render failed', err);
            if (statsEmpty) statsEmpty.classList.remove('hidden');
          });

        // Для F1 выходим, чтобы не запускать старый сложный рендер ниже.
        return;
      }

      // Делаем более терпеливый ретрай: до ~10 секунд ожидания (для остальных серий).
      var maxStatsAttempts = 10;
      var statsRetryDelayMs = 1000;

      function loadStats(attempt) {
        if (teamStatsWrap) teamStatsWrap.classList.remove('hidden');
        fetchJSON(statsUrl)
        .then(function (data) {
          var rows = data && data.rows ? data.rows : (Array.isArray(data) ? data : []);
          var tbody = document.querySelector('#stats-table tbody');
          if (!rows || rows.length === 0) {
            if (tbody) tbody.innerHTML = '';
            // Если статистика ещё не готова (импорт/агрегация не успели) —
            // пробуем ещё пару раз с небольшой задержкой, прежде чем показать "нет данных".
            if (attempt + 1 < maxStatsAttempts) {
              setTimeout(function () { loadStats(attempt + 1); }, statsRetryDelayMs);
            } else if (statsEmpty) {
              statsEmpty.classList.remove('hidden');
            }
            return;
          }
          if (!statsPanel) return;
          if (!tbody) return;
          if (statsEmpty) statsEmpty.classList.add('hidden');

          var seriesKeyStats = (seriesId || '').toLowerCase();

          // Supercars: подставляем команды и производителя из /series/supercars/teams
          if (seriesKeyStats === 'supercars') {
            fetchJSON('/api/series/supercars/teams').then(function (teamsResp) {
              var teams = (teamsResp && teamsResp.teams) ? teamsResp.teams : [];
              var byCar = {};
              teams.forEach(function (t) {
                if (t.number != null) byCar[String(t.number)] = { team: t.team, manufacturer: t.manufacturer };
              });
              rows.forEach(function (row) {
                var m = byCar[String(row.car)];
                if (m) {
                  if (m.team) row.team = m.team;
                  if (m.manufacturer) row.manufacturer = m.manufacturer;
                }
              });
              renderStatsInner();
            }).catch(function () { renderStatsInner(); });
            return;
          }
          renderStatsInner();

          function renderStatsInner() {
          function setupMinStartsSelect(selectEl, kind) {
            if (!selectEl) return;

            var config = null;
            if (seriesKeyStats === 'nascar_cup' || seriesKeyStats === 'noaps') {
              config = [5, 10, 20, 30];
            } else if (seriesKeyStats === 'nascar_truck') {
              config = [5, 10, 20];
            } else if (seriesKeyStats === 'arca' || seriesKeyStats === 'nascar_modified') {
              config = [5, 10];
            }

            if (!config) {
              // Для остальных серий временно скрываем фильтр по минимальному количеству стартов.
              var labelEl = selectEl.parentNode;
              if (selectEl.closest) {
                var closestLabel = selectEl.closest('label');
                if (closestLabel) labelEl = closestLabel;
              }
              if (labelEl && labelEl.style) {
                labelEl.style.display = 'none';
              }
              return;
            }

            var allLabel = 'All starts';

            var optionsHtml = '<option value="0">' + allLabel + '</option>' +
              config.map(function (v) {
                return '<option value="' + v + '">' + v + '+ starts</option>';
              }).join('');
            selectEl.innerHTML = optionsHtml;
          }

          function fmtNum(v, digits) {
            if (v == null) return '—';
            var num = typeof v === 'number' ? v : parseFloat(String(v));
            if (!isFinite(num)) return String(v);
            if (typeof digits === 'number') return num.toFixed(digits);
            return String(num);
          }

          // Подготовим массив объектов для сортировки и рендера.
          // Для F1 используем единый шаблон и для текущего сезона, и для исторических сезонов (f1-YYYY).
          var isF1Stats = (seriesKeyStats === 'f1' || seriesKeyStats.indexOf('f1-') === 0);
          // На всякий случай принудительно включаем F1-шаблон для сезонной страницы f1-2025.
          if (!isF1Stats && window.location && window.location.pathname.indexOf('/season/f1-2025/') === 0) {
            isF1Stats = true;
          }
          var statsRows = rows.map(function (row, idx) {
            var r = {
              pos: idx + 1,
              car: row.car || '',
              driver: row.driver || '',
              team: row.team || '',
              manufacturer: row.manufacturer || '',
              chassis: row.chassis || '',
              races: row.races || 0,
              wins: row.wins || 0,
              top2: row.top2 || 0,
              top3: row.top3 || 0,
              podiums: row.podiums != null ? row.podiums : (row.wins || 0) + (row.top2 || 0) + (row.top3 || 0),
              poles: row.poles || 0,
              top5: row.top5 || 0,
              top10: row.top10 || 0,
              top15: row.top15 || 0,
              top20: row.top20 || 0,
              fastest_laps: row.fastest_laps || 0,
              avg_start: row.avg_start,
              avg_qualifying: row.avg_qualifying,
              avg_finish: row.avg_finish,
              q2_passes: row.q2_passes != null ? row.q2_passes : 0,
              q3_passes: row.q3_passes != null ? row.q3_passes : 0,
              stage_wins: row.stage_wins || 0,
              stage_points: row.stage_points || 0,
              avg_stage_points: row.avg_stage_points,
              laps_led: row.laps_led || 0,
              laps_completed: row.laps_completed != null ? row.laps_completed : 0,
              laps_completed_pct: row.laps_completed_pct,
              pos_diff: row.pos_diff
            };
            return r;
          });

          var statsFilterInput = document.getElementById('stats-filter');
          var statsMinStartsSelect = document.getElementById('stats-min-starts');
          setupMinStartsSelect(statsMinStartsSelect, 'driver');

          function passesStatsFilter(row) {
            var minStarts = 0;
            if (statsMinStartsSelect && statsMinStartsSelect.value) {
              var parsed = parseInt(statsMinStartsSelect.value, 10);
              if (!isNaN(parsed) && parsed > 0) minStarts = parsed;
            }
            if (minStarts && (row.races || 0) < minStarts) return false;
            var q = statsFilterInput && statsFilterInput.value
              ? statsFilterInput.value.trim().toLowerCase()
              : '';
            if (!q) return true;
            var haystack = [
              row.driver || '',
              row.team || '',
              row.manufacturer || ''
            ].join(' ').toLowerCase();
            return haystack.indexOf(q) !== -1;
          }

          function renderStatsTable(dataArray) {
            var filtered = dataArray.filter(passesStatsFilter);
            var avgStartFmt = function (row) {
              return (row.avg_start == null || row.avg_start === 0 || row.avg_start === '0') ? '—' : fmtNum(row.avg_start, 2);
            };
            var avgFinishFmt = function (row) { return fmtNum(row.avg_finish, 2); };
            var lapsPct = function (row) { return row.laps_completed_pct != null ? fmtNum(row.laps_completed_pct, 1) + '%' : '—'; };
            var posDiff = function (row) { return row.pos_diff != null ? fmtNum(row.pos_diff, 1) : '—'; };
            var avgStagePts = function (row) { return (row.avg_stage_points == null || row.avg_stage_points === 0 || row.avg_stage_points === '0') ? '—' : fmtNum(row.avg_stage_points, 2); };
            tbody.innerHTML = filtered.map(function (row) {
              var td = '';
              td += '<td class="col-num">' + row.pos + '</td>';
              td += '<td class="col-car">' + esc(dash(row.car)) + '</td>';
              td += '<td>' + driverLink(row.driver) + '</td>';
              td += '<td>' + teamLink(row.team) + '</td>';
              td += '<td>' + esc(dash(row.manufacturer || '')) + '</td>';
              td += '<td>' + row.races + '</td>';
              td += '<td>' + row.wins + '</td>';
              td += '<td>' + row.poles + '</td>';
              td += '<td>' + row.top5 + '</td>';
              td += '<td>' + row.top10 + '</td>';
              td += '<td>' + row.top15 + '</td>';
              td += '<td>' + row.top20 + '</td>';
              td += '<td>' + avgStartFmt(row) + '</td>';
              td += '<td>' + avgFinishFmt(row) + '</td>';
              td += '<td>' + row.stage_wins + '</td>';
              td += '<td>' + row.stage_points + '</td>';
              td += '<td>' + avgStagePts(row) + '</td>';
              td += '<td>' + row.laps_led + '</td>';
              td += '<td>' + lapsPct(row) + '</td>';
              td += '<td>' + posDiff(row) + '</td>';
              return '<tr>' + td + '</tr>';
            }).join('');
          }

          // Инициализируем сортировку по клику по заголовкам таблицы.
          var statsTable = document.getElementById('stats-table');
          if (statsTable) {
            var headRow = statsTable.querySelector('thead tr');
            if (headRow) {
              var ths = headRow.querySelectorAll('th');
              var sidLowerStats = (seriesId || '').toLowerCase();
                var manWrap = document.getElementById('manufacturer-stats-wrap');
                if (manWrap) manWrap.classList.remove('hidden');
              if (sidLowerStats === 'indycar' && ths.length > 4 && !isF1Stats) {
                ths[4].textContent = t('th.engine');
              }
              if (sidLowerStats === 'supercars' && ths.length > 10) {
                ths[10].textContent = 'Avg. Qualifying';
              }
              var keys = ['pos', 'car', 'driver', 'team', 'manufacturer', 'races', 'wins', 'poles', 'top5', 'top10', 'top15', 'top20', 'avg_start', 'avg_finish', 'stage_wins', 'stage_points', 'avg_stage_points', 'laps_led', 'laps_completed_pct', 'pos_diff'];
              function isNumericKey(k) {
                return ['pos', 'car', 'races', 'wins', 'poles', 'top5', 'top10', 'top15', 'top20', 'avg_start', 'avg_finish', 'stage_wins', 'stage_points', 'avg_stage_points', 'laps_led', 'laps_completed_pct', 'pos_diff'].indexOf(k) >= 0;
              }
              for (var c = 0; c < ths.length; c++) {
                (function (colIndex) {
                  var key = keys[colIndex];
                  if (!key) return;
                  ths[colIndex].classList.add('sortable');
                  ths[colIndex].addEventListener('click', function () {
                    var dir = ths[colIndex].dataset.sortDir === 'asc' ? -1 : 1;
                    statsRows.sort(function (a, b) {
                      var va = a[key];
                      var vb = b[key];
                      var ae = (va === null || va === undefined || va === '');
                      var be = (vb === null || vb === undefined || vb === '');
                      if (ae && be) return 0;
                      if (ae) return 1;
                      if (be) return -1;
                      if (isNumericKey(key)) {
                        var na = parseFloat(va);
                        var nb = parseFloat(vb);
                        if (!isNaN(na) && !isNaN(nb)) return dir * (na - nb);
                      }
                      return dir * String(va).localeCompare(String(vb), undefined, { numeric: true });
                    });
                    [].forEach.call(ths, function (th) { th.classList.remove('sort-asc', 'sort-desc'); th.removeAttribute('data-sort-dir'); });
                    ths[colIndex].classList.add(dir === 1 ? 'sort-asc' : 'sort-desc');
                    ths[colIndex].dataset.sortDir = (dir === 1 ? 'asc' : 'desc');
                    renderStatsTable(statsRows);
                  });
                })(c);
              }
            }
          }

          if (statsFilterInput) {
            statsFilterInput.addEventListener('input', function () {
              renderStatsTable(statsRows);
            });
          }
          if (statsMinStartsSelect) {
            statsMinStartsSelect.addEventListener('change', function () {
              renderStatsTable(statsRows);
            });
          }

          renderStatsTable(statsRows);

          // Team stats (по данным backend: data.teams).
          var teamRowsRaw = data && data.teams ? data.teams : [];
          var teamTable = document.getElementById('team-stats-table');
          var teamEmpty = document.getElementById('team-stats-empty');
          var teamStatsFilterInput = document.getElementById('team-stats-filter');
          var teamStatsMinStartsSelect = document.getElementById('team-stats-min-starts');
          setupMinStartsSelect(teamStatsMinStartsSelect, 'team');
          if (teamTable) {
            var teamTbody = teamTable.querySelector('tbody');
            if (teamRowsRaw && teamRowsRaw.length > 0 && teamTbody) {
              if (teamEmpty) teamEmpty.classList.add('hidden');
              var teamData = teamRowsRaw.map(function (row, idx) {
                return {
                  pos: idx + 1,
                  team: row.team || '',
                  races: row.races || 0,
                  wins: row.wins || 0,
                poles: row.poles || 0,
                  top5: row.top5 || 0,
                  top10: row.top10 || 0,
                  top15: row.top15 || 0,
                  top20: row.top20 || 0,
                  avg_start: row.avg_start,
                  avg_finish: row.avg_finish,
                  stage_wins: row.stage_wins || 0,
                  stage_points: row.stage_points || 0,
                  avg_stage_points: row.avg_stage_points,
                  laps_led: row.laps_led || 0,
                  laps_completed_pct: row.laps_completed_pct,
                  pos_diff: row.pos_diff
                };
              });
              function teamPassesFilter(row) {
                var minStarts = 0;
                if (teamStatsMinStartsSelect && teamStatsMinStartsSelect.value) {
                  var parsed = parseInt(teamStatsMinStartsSelect.value, 10);
                  if (!isNaN(parsed) && parsed > 0) minStarts = parsed;
                }
                if (minStarts && (row.races || 0) < minStarts) return false;
                var q = teamStatsFilterInput && teamStatsFilterInput.value
                  ? teamStatsFilterInput.value.trim().toLowerCase()
                  : '';
                if (!q) return true;
                var haystack = (row.team || '').toLowerCase();
                return haystack.indexOf(q) !== -1;
              }

              function renderTeamTable(list) {
                var filtered = list.filter(teamPassesFilter);
                teamTbody.innerHTML = filtered.map(function (row) {
                  var lapsPct = row.laps_completed_pct != null ? fmtNum(row.laps_completed_pct, 1) + '%' : '—';
                  var posDiff = row.pos_diff != null ? fmtNum(row.pos_diff, 1) : '—';
                  var avgStart = (row.avg_start == null || row.avg_start === 0 || row.avg_start === '0') ? '—' : fmtNum(row.avg_start, 2);
                  var avgFinish = fmtNum(row.avg_finish, 2);
                  var avgStagePts = (row.avg_stage_points == null || row.avg_stage_points === 0 || row.avg_stage_points === '0') ? '—' : fmtNum(row.avg_stage_points, 2);
                  var td = '';
                  td += '<td class="col-num">' + row.pos + '</td>';
                  td += '<td>' + (row.team === '—' ? '—' : teamLink(row.team)) + '</td>';
                  td += '<td>' + row.races + '</td>';
                  td += '<td>' + row.wins + '</td>';
                  td += '<td>' + row.poles + '</td>';
                  td += '<td>' + row.top5 + '</td>';
                  td += '<td>' + row.top10 + '</td>';
                  td += '<td>' + row.top15 + '</td>';
                  td += '<td>' + row.top20 + '</td>';
                  td += '<td>' + avgStart + '</td>';
                  td += '<td>' + avgFinish + '</td>';
                  td += '<td>' + row.stage_wins + '</td>';
                  td += '<td>' + row.stage_points + '</td>';
                  td += '<td>' + avgStagePts + '</td>';
                  td += '<td>' + row.laps_led + '</td>';
                  td += '<td>' + lapsPct + '</td>';
                  td += '<td>' + posDiff + '</td>';
                  return '<tr>' + td + '</tr>';
                }).join('');
              }

              var teamHeadRow = teamTable.querySelector('thead tr');
              if (teamHeadRow) {
                var teamThs = teamHeadRow.querySelectorAll('th');
                var teamKeys = [
                  'pos', 'team', 'races', 'wins', 'poles', 'top5', 'top10', 'top15', 'top20',
                  'avg_start', 'avg_finish', 'stage_wins', 'stage_points', 'avg_stage_points', 'laps_led', 'laps_completed_pct', 'pos_diff'
                ];
                // Для Supercars колонка Avg. Start на самом деле Avg. Qualifying.
                var sidLowerTeam = (seriesId || '').toLowerCase();
                if (sidLowerTeam === 'supercars' && teamThs.length > 7) {
                  teamThs[7].textContent = 'Avg. Qualifying';
                }
                function isTeamNumeric(k) {
                  return ['pos', 'races', 'wins', 'poles', 'top5', 'top10', 'top15', 'top20', 'avg_start', 'avg_finish', 'stage_wins', 'stage_points', 'avg_stage_points', 'laps_led', 'laps_completed_pct', 'pos_diff'].indexOf(k) >= 0;
                }
                for (var tc = 0; tc < teamThs.length; tc++) {
                  (function (colIndex) {
                    var key = teamKeys[colIndex];
                    if (!key) return;
                    teamThs[colIndex].classList.add('sortable');
                    teamThs[colIndex].addEventListener('click', function () {
                      var dir = teamThs[colIndex].dataset.sortDir === 'asc' ? -1 : 1;
                      teamData.sort(function (a, b) {
                        var va = a[key];
                        var vb = b[key];
                        var ae = (va === null || va === undefined || va === '');
                        var be = (vb === null || vb === undefined || vb === '');
                        if (ae && be) return 0;
                        if (ae) return 1;
                        if (be) return -1;
                        if (isTeamNumeric(key)) {
                          var na = parseFloat(va);
                          var nb = parseFloat(vb);
                          if (!isNaN(na) && !isNaN(nb)) return dir * (na - nb);
                        }
                        return dir * String(va).localeCompare(String(vb), undefined, { numeric: true });
                      });
                      [].forEach.call(teamThs, function (th) { th.classList.remove('sort-asc', 'sort-desc'); th.removeAttribute('data-sort-dir'); });
                      teamThs[colIndex].classList.add(dir === 1 ? 'sort-asc' : 'sort-desc');
                      teamThs[colIndex].dataset.sortDir = (dir === 1 ? 'asc' : 'desc');
                      renderTeamTable(teamData);
                    });
                  })(tc);
                }
              }

              renderTeamTable(teamData);
              if (teamStatsFilterInput) {
                teamStatsFilterInput.addEventListener('input', function () {
                  renderTeamTable(teamData);
                });
              }
              if (teamStatsMinStartsSelect) {
                teamStatsMinStartsSelect.addEventListener('change', function () {
                  renderTeamTable(teamData);
                });
              }
            } else if (teamEmpty) {
              teamEmpty.classList.remove('hidden');
            }
          }

          // Manufacturer stats (по данным backend: data.manufacturers).
          var manRowsRaw = data && data.manufacturers ? data.manufacturers : [];
          var manTable = document.getElementById('manufacturer-stats-table');
          var manEmpty = document.getElementById('manufacturer-stats-empty');
          var manStatsFilterInput = document.getElementById('manufacturer-stats-filter');
          var manStatsMinStartsSelect = document.getElementById('manufacturer-stats-min-starts');
          setupMinStartsSelect(manStatsMinStartsSelect, 'manufacturer');
          if (manTable) {
            var manTbody = manTable.querySelector('tbody');
            if (manRowsRaw && manRowsRaw.length > 0 && manTbody) {
              if (manEmpty) manEmpty.classList.add('hidden');
              var manData = manRowsRaw.map(function (row, idx) {
                return {
                  pos: idx + 1,
                  manufacturer: row.manufacturer || '',
                  races: row.races || 0,
                  wins: row.wins || 0,
                  top2: row.top2 || 0,
                  top3: row.top3 || 0,
                  podiums: row.podiums != null ? row.podiums : (row.wins || 0) + (row.top2 || 0) + (row.top3 || 0),
                  top5: row.top5 || 0,
                  top10: row.top10 || 0,
                  avg_start: row.avg_start,
                  avg_qualifying: row.avg_qualifying,
                  avg_finish: row.avg_finish,
                  q2_passes: row.q2_passes != null ? row.q2_passes : 0,
                  q3_passes: row.q3_passes != null ? row.q3_passes : 0,
                  laps_led: row.laps_led || 0,
                  laps_completed: row.laps_completed != null ? row.laps_completed : 0
                };
              });
              function manPassesFilter(row) {
                var minStarts = 0;
                if (manStatsMinStartsSelect && manStatsMinStartsSelect.value) {
                  var parsed = parseInt(manStatsMinStartsSelect.value, 10);
                  if (!isNaN(parsed) && parsed > 0) minStarts = parsed;
                }
                if (minStarts && (row.races || 0) < minStarts) return false;
                var q = manStatsFilterInput && manStatsFilterInput.value
                  ? manStatsFilterInput.value.trim().toLowerCase()
                  : '';
                if (!q) return true;
                var haystack = (row.manufacturer || '').toLowerCase();
                return haystack.indexOf(q) !== -1;
              }

              function renderManTable(list) {
                var filtered = list.filter(manPassesFilter);
                manTbody.innerHTML = filtered.map(function (row) {
                  var avgStart = (row.avg_start == null || row.avg_start === 0 || row.avg_start === '0') ? '—' : fmtNum(row.avg_start, 2);
                  var avgQual = (row.avg_qualifying == null || row.avg_qualifying === 0 || row.avg_qualifying === '') ? '—' : fmtNum(row.avg_qualifying, 2);
                  var avgFinish = fmtNum(row.avg_finish, 2);
                  var td = '';
                  td += '<td class="col-num">' + row.pos + '</td>';
                  td += '<td>' + esc(dash(row.manufacturer || '')) + '</td>';
                  td += '<td>' + row.races + '</td>';
                  td += '<td>' + row.wins + '</td>';
                  td += '<td>' + row.top2 + '</td>';
                  td += '<td>' + row.top3 + '</td>';
                  td += '<td>' + row.podiums + '</td>';
                  td += '<td>' + row.top5 + '</td>';
                  td += '<td>' + row.top10 + '</td>';
                  td += '<td>' + avgStart + '</td>';
                  td += '<td>' + avgQual + '</td>';
                  td += '<td>' + avgFinish + '</td>';
                  td += '<td>' + (row.q2_passes != null ? row.q2_passes : 0) + '</td>';
                  td += '<td>' + (row.q3_passes != null ? row.q3_passes : 0) + '</td>';
                  td += '<td>' + row.laps_led + '</td>';
                  td += '<td>' + (row.laps_completed != null ? row.laps_completed : '—') + '</td>';
                  return '<tr>' + td + '</tr>';
                }).join('');
              }

              var manHeadRow = manTable.querySelector('thead tr');
              if (manHeadRow) {
                var manThs = manHeadRow.querySelectorAll('th');
                var manKeys = [
                  'pos', 'manufacturer', 'races', 'wins', 'top2', 'top3', 'podiums', 'top5', 'top10',
                  'avg_start', 'avg_qualifying', 'avg_finish', 'q2_passes', 'q3_passes',
                  'laps_led', 'laps_completed'
                ];
                function isManNumeric(k) {
                  return ['pos', 'races', 'wins', 'top2', 'top3', 'podiums', 'top5', 'top10',
                    'avg_start', 'avg_qualifying', 'avg_finish', 'q2_passes', 'q3_passes',
                    'laps_led', 'laps_completed'].indexOf(k) >= 0;
                }
                for (var mc = 0; mc < manThs.length; mc++) {
                  (function (colIndex) {
                    var key = manKeys[colIndex];
                    if (!key) return;
                    manThs[colIndex].classList.add('sortable');
                    manThs[colIndex].addEventListener('click', function () {
                      var dir = manThs[colIndex].dataset.sortDir === 'asc' ? -1 : 1;
                      manData.sort(function (a, b) {
                        var va = a[key];
                        var vb = b[key];
                        var ae = (va === null || va === undefined || va === '');
                        var be = (vb === null || vb === undefined || vb === '');
                        if (ae && be) return 0;
                        if (ae) return 1;
                        if (be) return -1;
                        if (isManNumeric(key)) {
                          var na = parseFloat(va);
                          var nb = parseFloat(vb);
                          if (!isNaN(na) && !isNaN(nb)) return dir * (na - nb);
                        }
                        return dir * String(va).localeCompare(String(vb), undefined, { numeric: true });
                      });
                      [].forEach.call(manThs, function (th) { th.classList.remove('sort-asc', 'sort-desc'); th.removeAttribute('data-sort-dir'); });
                      manThs[colIndex].classList.add(dir === 1 ? 'sort-asc' : 'sort-desc');
                      manThs[colIndex].dataset.sortDir = (dir === 1 ? 'asc' : 'desc');
                      renderManTable(manData);
                    });
                  })(mc);
                }
              }

              renderManTable(manData);
              if (manStatsFilterInput) {
                manStatsFilterInput.addEventListener('input', function () {
                  renderManTable(manData);
                });
              }
              if (manStatsMinStartsSelect) {
                manStatsMinStartsSelect.addEventListener('change', function () {
                  renderManTable(manData);
                });
              }
            } else if (manEmpty) {
              manEmpty.classList.remove('hidden');
            }
          }
          }

        })
        .catch(function () {
          if (attempt + 1 < maxStatsAttempts) {
            setTimeout(function () { loadStats(attempt + 1); }, statsRetryDelayMs);
          } else if (statsEmpty) {
            statsEmpty.classList.remove('hidden');
          }
        });
      }

      if (statsEmpty) statsEmpty.classList.add('hidden');
      loadStats(0);
    }

    fetchJSON('/api/series/' + encodeURIComponent((seriesId || '').toLowerCase()) + '/events')
      .catch(function () { return []; })
      .then(function (events) {
        var seriesKeyEvents = (seriesId || '').toLowerCase();
        // Pre-Season Testing для F1 (только отображение, не в БД)
        if (seriesKeyEvents === 'f1') {
          var f1PreSeason = [
            { _seriesId: 'F1', id: 'F1_2026_PRE_SEASON_TEST_1', name: 'Pre-Season Testing 1', start_date: '2026-02-11', end_date: '2026-02-13', date: '2026-02-11', circuit_name: 'Bahrain International Circuit', location: '', time_est: '10:00–19:00', time_msk: '', has_detail: true },
            { _seriesId: 'F1', id: 'F1_2026_PRE_SEASON_TEST_2', name: 'Pre-Season Testing 2', start_date: '2026-02-18', end_date: '2026-02-20', date: '2026-02-18', circuit_name: 'Bahrain International Circuit', location: '', time_est: '10:00–19:00', time_msk: '', has_detail: true }
          ];
          events = f1PreSeason.concat(Array.isArray(events) ? events : []);
        }
        // Вспомогательная функция для сортировки времени: AM всегда перед PM.
        function parseTimeToMinutes(t) {
          if (!t) return 24 * 60 + 1;
          var m = String(t).trim().match(/(\d{1,2}):(\d{2})\s*([ap]\.?m\.?|AM|PM)/i);
          if (!m) return 24 * 60 + 1;
          var h = parseInt(m[1], 10);
          var mins = parseInt(m[2], 10);
          if (isNaN(h) || isNaN(mins)) return 24 * 60 + 1;
          var ampm = m[3].replace(/\./g, '').toUpperCase();
          h = h % 12;
          if (ampm === 'PM') h += 12;
          return h * 60 + mins;
        }

        var getScheduleTimeLabel = (window.TGA && window.TGA.getScheduleTimeLabel) || function (e) { return e.time_est || e.time_msk || '—'; };

        function renderScheduleRows(list, opts) {
          opts = opts || {};
          window.TGA._lastScheduleEvents = list;
          window.TGA._lastScheduleStaticType = opts.staticType || null;
          window.TGA._lastScheduleSeriesId = seriesId;
          window.TGA.refreshScheduleDetail = function () {
            var ev = window.TGA._lastScheduleEvents;
            var st = window.TGA._lastScheduleStaticType;
            renderScheduleRows(ev || [], st ? { staticType: st } : {});
          };
          var schedTable = document.getElementById('schedule-table');
          var schedWrap = schedTable && schedTable.closest('.table-wrap');
          var schedBody = document.querySelector('#schedule-table tbody');
          var regularBanner = '<tr class="schedule-section-banner"><td colspan="5">' + esc(t('schedule.regular_season')) + '</td></tr>';
          var inSeasonBanner = '<tr class="schedule-section-banner"><td colspan="5">' + esc(t('schedule.in_season_challenge')) + '</td></tr>';
          var playoffsBanner = '<tr class="schedule-section-banner"><td colspan="5">' + esc(t('schedule.playoffs')) + '</td></tr>';
          var cupChaseBanner = '<tr class="schedule-section-banner"><td colspan="5">' + esc(t('schedule.cup_series_chase')) + '</td></tr>';
          var theChaseBanner = '<tr class="schedule-section-banner"><td colspan="5">' + esc(t('schedule.the_chase')) + '</td></tr>';
          var supercarsSprintBanner = '<tr class="schedule-section-banner"><td colspan="7">Sprint Cup</td></tr>';
          var supercarsEnduroBanner  = '<tr class="schedule-section-banner"><td colspan="7">Enduro Cup</td></tr>';
          var supercarsFinalsBanner  = '<tr class="schedule-section-banner"><td colspan="7">Finals Series</td></tr>';
          var seriesKeySched = (seriesId || '').toLowerCase();
          var pathSeriesSlug = (window.location.pathname.split('/')[2] || '').toLowerCase();
          var isCup = (seriesKeySched === 'nascar_cup');
          var isSupercars = (seriesKeySched === 'supercars');
          var isIndycar = (seriesKeySched === 'indycar' || pathSeriesSlug === 'indycar');
          var isSuperFormula = (seriesKeySched === 'super_formula' || pathSeriesSlug === 'super_formula');
          var isF1 = (seriesKeySched === 'f1' || pathSeriesSlug === 'f1');
          // Исторические F1‑сезоны: /season/f1-2025 и т.п.
          var isF1Season = (seriesKeySched.indexOf('f1-') === 0 || pathSeriesSlug.indexOf('f1-') === 0);
          var isF2 = (seriesKeySched === 'f2' || pathSeriesSlug === 'f2');
          var isF3 = (seriesKeySched === 'f3' || pathSeriesSlug === 'f3');
          var isStockCarSeries = ['nascar_cup', 'noaps', 'nascar_truck', 'arca', 'nascar_modified'].indexOf(seriesKeySched) >= 0;
          var schedColspan = isStockCarSeries ? 6 : 5;
          var regularBannerStock = '<tr class="schedule-section-banner"><td colspan="' + schedColspan + '">' + esc(t('schedule.regular_season')) + '</td></tr>';
          var inSeasonBannerStock = '<tr class="schedule-section-banner"><td colspan="' + schedColspan + '">' + esc(t('schedule.in_season_challenge')) + '</td></tr>';
          var playoffsBannerStock = '<tr class="schedule-section-banner"><td colspan="' + schedColspan + '">' + esc(t('schedule.playoffs')) + '</td></tr>';
          var cupChaseBannerStock = '<tr class="schedule-section-banner"><td colspan="' + schedColspan + '">' + esc(t('schedule.cup_series_chase')) + '</td></tr>';
          var theChaseBannerStock = '<tr class="schedule-section-banner"><td colspan="' + schedColspan + '">' + esc(t('schedule.the_chase')) + '</td></tr>';
          if (schedWrap) {
            schedWrap.classList.toggle('schedule-wrap--stockcar', isStockCarSeries && !isSupercars);
          }
          if (schedTable) {
            schedTable.classList.toggle('schedule-table--supercars', isSupercars);
            schedTable.classList.toggle('schedule-table--stockcar', isStockCarSeries);
            schedTable.classList.toggle('schedule-table--super-formula', isSuperFormula);
          }
          var unnumberedIds = {
            'NASCAR_CUP_2026_0': true,
            'NASCAR_CUP_2026_ALLSTAR_OPEN': true,
            'NASCAR_CUP_2026_ALLSTAR_RACE': true,
            'IMSA_2026_PRE_SEASON_TEST': true
          };
          var continuationId = 'NASCAR_CUP_2026_ALLSTAR_RACE';
          // Настроить заголовок таблицы под конкретную серию
          var schedHeadRow = document.querySelector('#schedule-table thead tr');
          if (schedHeadRow) {
            var seriesKey = seriesKeySched;
            if (isSupercars) {
              schedHeadRow.innerHTML =
                '<th>' + esc(t('th.round')) + '</th>' +
                '<th>' + esc(t('th.race_num')) + '</th>' +
                '<th>' + esc(t('th.event')) + '</th>' +
                '<th>' + esc(t('th.circuit')) + '</th>' +
                '<th>' + esc(t('th.location')) + '</th>' +
                '<th>date</th>' +
                '<th>' + esc(t('th.time')) + '</th>';
            } else if (seriesKey === 'imsa') {
              // IMSA: Rnd. | Race | Length | Classes | Circuit | Location | Date
              schedHeadRow.innerHTML =
                '<th>' + esc(t('th.round')) + '</th>' +
                '<th>' + esc(t('th.race_col')) + '</th>' +
                '<th>Length</th>' +
                '<th>Classes</th>' +
                '<th>' + esc(t('th.circuit')) + '</th>' +
                '<th>' + esc(t('th.location')) + '</th>' +
                '<th>date</th>';
            } else if (isIndycar) {
              schedHeadRow.innerHTML =
                '<th>Rd.</th>' +
                '<th>Date</th>' +
                '<th>Race name</th>' +
                '<th>Track</th>' +
                '<th>' + esc(t('th.location')) + '</th>' +
                '<th>' + esc(t('th.time')) + '</th>';
            } else if (isSuperFormula) {
              schedHeadRow.innerHTML =
                '<th>Rd.</th>' +
                '<th>Date</th>' +
                '<th>Venue</th>' +
                '<th>' + esc(t('th.time')) + '</th>';
            } else if (isF1) {
              // F1 (текущий сезон): Round | Grand Prix | Circuit | Date | Time
              schedHeadRow.innerHTML =
                '<th>' + esc(t('th.round')) + '</th>' +
                '<th>Grand Prix</th>' +
                '<th>' + esc(t('th.circuit')) + '</th>' +
                '<th>date</th>' +
                '<th>' + esc(t('th.time')) + '</th>';
            } else if (isF1Season) {
              // Исторические сезоны F1: Round | Grand Prix | Circuit | Race date (без колонки Time)
              schedHeadRow.innerHTML =
                '<th>' + esc(t('th.round')) + '</th>' +
                '<th>Grand Prix</th>' +
                '<th>' + esc(t('th.circuit')) + '</th>' +
                '<th>Race date</th>';
            } else if (isF2 && window.TGA_STATIC_SCHEDULES && window.TGA_STATIC_SCHEDULES.f2) {
              schedHeadRow.innerHTML =
                '<th>' + esc(t('th.round')) + '</th>' +
                '<th>' + esc(t('th.circuit')) + '</th>' +
                '<th>Sprint race</th>' +
                '<th>' + esc(t('th.time')) + '</th>' +
                '<th>Feature race</th>' +
                '<th>' + esc(t('th.time')) + '</th>';
            } else if (isF3 && window.TGA_STATIC_SCHEDULES && window.TGA_STATIC_SCHEDULES.f3) {
              schedHeadRow.innerHTML =
                '<th>' + esc(t('th.round')) + '</th>' +
                '<th>' + esc(t('th.circuit')) + '</th>' +
                '<th>Sprint race</th>' +
                '<th>' + esc(t('th.time')) + '</th>' +
                '<th>Feature race</th>' +
                '<th>' + esc(t('th.time')) + '</th>';
            } else if (isStockCarSeries) {
              schedHeadRow.innerHTML =
                '<th>#</th>' +
                '<th>' + esc(t('th.race_col')) + '</th>' +
                '<th>' + esc(t('th.track')) + '</th>' +
                '<th>' + esc(t('th.location')) + '</th>' +
                '<th>date</th>' +
                '<th>' + esc(t('th.time')) + '</th>';
            } else {
              schedHeadRow.innerHTML =
                '<th>#</th>' +
                '<th>date</th>' +
                '<th>' + esc(t('th.race_col')) + '</th>' +
                '<th class="col-location">' + esc(t('th.location')) + '</th>' +
                '<th>' + esc(t('th.time')) + '</th>';
            }
          }

          // Если нет данных и нет спец-таблицы — показываем пустое сообщение
          if (!isIndycar && !isSuperFormula && !isF1 && !isF2 && !isF3 && (!list || !list.length)) {
          scheduleEmpty.classList.remove('hidden');
          scheduleEmpty.textContent = t('schedule.empty') || 'No schedule data yet.';
          return;
        }

          // Специальное статическое расписание для IndyCar (только если API не вернул события)
          if (isIndycar && (!list || !list.length)) {
            if (schedBody) {
              var indySched = (window.TGA_STATIC_SCHEDULES && window.TGA_STATIC_SCHEDULES.indycarTable) || [];
              window.TGA._lastScheduleEvents = indySched;
              window.TGA._lastScheduleStaticType = 'indycar';
              schedBody.innerHTML = indySched.map(function (r) {
                var synthetic = { date: r.date, time_est: r.time_et, time_msk: r.time_msk };
                var timeLabel = getScheduleTimeLabel(synthetic, 'indycar');
                var raceCell = r.event_id
                  ? '<a href="/event/' + encodeURIComponent((r.event_id + '').toLowerCase().replace(/_/g, '-')) + '" class="event-link">' + esc(r.race) + '</a>'
                  : esc(r.race);
                return '<tr>' +
                  '<td>' + r.rd + '</td>' +
                  '<td>' + esc(r.date) + '</td>' +
                  '<td>' + raceCell + '</td>' +
                  '<td>' + esc(r.track) + '</td>' +
                  '<td>' + esc(r.location) + '</td>' +
                  '<td class="col-time">' + esc(timeLabel) + '</td>' +
                  '</tr>';
              }).join('');
              if (schedTable) makeSimpleTableSortable(schedTable);
            }
          return;
        }

          // Специальное статическое расписание для Formula 1 (только если API не вернул события)
          if (isF1 && (!list || !list.length)) {
            if (schedBody) {
              var f1Sched = (window.TGA_STATIC_SCHEDULES && window.TGA_STATIC_SCHEDULES.f1) || [];
              schedBody.innerHTML = f1Sched.map(function (r) {
                return '<tr>' +
                  '<td class="col-num">' + r.rd + '</td>' +
                  '<td>' + esc(r.grand_prix) + '</td>' +
                  '<td>' + esc(r.circuit) + '</td>' +
                  '<td>' + esc(r.date) + '</td>' +
                  '</tr>';
              }).join('');
              if (schedTable) makeSimpleTableSortable(schedTable);
            }
            return;
          }

          if (isF1Season && (!list || !list.length)) {
            if (schedBody) {
              var f1SeasonSched = (window.TGA_STATIC_SCHEDULES && window.TGA_STATIC_SCHEDULES.f1_2025) || [];
              schedBody.innerHTML = f1SeasonSched.map(function (r) {
                return '<tr>' +
                  '<td class="col-num">' + r.rd + '</td>' +
                  '<td>' + esc(r.grand_prix) + '</td>' +
                  '<td>' + esc(r.circuit) + '</td>' +
                  '<td>' + esc(r.date) + '</td>' +
                  '</tr>';
              }).join('');
              if (schedTable) makeSimpleTableSortable(schedTable);
            }
            return;
          }

          // Formula 2: расписание с временами из статики (Sprint/Feature, одна колонка Time на каждую сессию)
          if (isF2 && window.TGA_STATIC_SCHEDULES && window.TGA_STATIC_SCHEDULES.f2) {
            if (schedBody) {
              var f2Sched = window.TGA_STATIC_SCHEDULES.f2;
              window.TGA._lastScheduleEvents = f2Sched;
              window.TGA._lastScheduleStaticType = 'f2';
              schedBody.innerHTML = f2Sched.map(function (r) {
                var eventId = (r.event_id || 'f2_2026_' + r.rd).toLowerCase().replace(/_/g, '-');
                var circuitCell = '<a href="/event/' + encodeURIComponent(eventId) + '" class="event-link">' + esc(r.circuit) + '</a>';
                var sprintLabel = getScheduleTimeLabel({ time_est: r.sprintLocal, time_msk: r.sprintMsk }, 'f2');
                var featureLabel = getScheduleTimeLabel({ time_est: r.featureLocal, time_msk: r.featureMsk }, 'f2');
                return '<tr>' +
                  '<td class="col-num">' + r.rd + '</td>' +
                  '<td>' + circuitCell + '</td>' +
                  '<td>' + esc(r.sprint) + '</td>' +
                  '<td class="col-time">' + esc(sprintLabel || '—') + '</td>' +
                  '<td>' + esc(r.feature) + '</td>' +
                  '<td class="col-time">' + esc(featureLabel || '—') + '</td>' +
                  '</tr>';
              }).join('');
              if (schedTable) makeSimpleTableSortable(schedTable);
            }
            return;
          }

          // Formula 3: расписание с временами из статики
          if (isF3 && window.TGA_STATIC_SCHEDULES && window.TGA_STATIC_SCHEDULES.f3) {
            if (schedBody) {
              var f3Sched = window.TGA_STATIC_SCHEDULES.f3;
              window.TGA._lastScheduleEvents = f3Sched;
              window.TGA._lastScheduleStaticType = 'f3';
              schedBody.innerHTML = f3Sched.map(function (r) {
                var eventId = (r.event_id || 'f3_2026_' + r.rd).toLowerCase().replace(/_/g, '-');
                var circuitCell = '<a href="/event/' + encodeURIComponent(eventId) + '" class="event-link">' + esc(r.circuit) + '</a>';
                var sprintLabel = getScheduleTimeLabel({ time_est: r.sprintLocal, time_msk: r.sprintMsk }, 'f3');
                var featureLabel = getScheduleTimeLabel({ time_est: r.featureLocal, time_msk: r.featureMsk }, 'f3');
                return '<tr>' +
                  '<td class="col-num">' + r.rd + '</td>' +
                  '<td>' + circuitCell + '</td>' +
                  '<td>' + esc(r.sprint) + '</td>' +
                  '<td class="col-time">' + esc(sprintLabel || '—') + '</td>' +
                  '<td>' + esc(r.feature) + '</td>' +
                  '<td class="col-time">' + esc(featureLabel || '—') + '</td>' +
                  '</tr>';
              }).join('');
              if (schedTable) makeSimpleTableSortable(schedTable);
            }
            return;
          }

          function eventRow(e, num, opts) {
            opts = opts || {};
            var showNum = (opts.unnumbered || unnumberedIds[e.id]) ? '—' : String(num);
            var formatDateRangeLong = window.TGA && window.TGA.formatDateRangeLong;
            var formatShortDate = window.TGA && window.TGA.formatShortDate;
            var startIso = (e.start_date || e.date || '').slice(0, 10);
            var endIso = (e.end_date || '').slice(0, 10);
            var date = (startIso && endIso && startIso !== endIso && formatDateRangeLong)
              ? formatDateRangeLong(e.start_date, e.end_date)
              : (formatShortDate ? formatShortDate(startIso) : startIso);
            var eventName = e.name || '—';
            if (isSupercars) {
              // У Supercars в таблице Event всегда отображаем название без суффикса "Race N"
              eventName = eventName.replace(/\s+Race\s+\d+$/i, '');
            }
            var link = e.has_detail
              ? '<a href="/event/' + encodeURIComponent((e.id || '').toLowerCase().replace(/_/g, '-')) + '" class="event-link">' + esc(eventName) + '</a>'
              : '<span class="event-no-data">' + esc(eventName) + '</span>';
            var dateCell;
            if (isSupercars) {
              if (opts.dateContinuation) {
                dateCell = '';
              } else if (opts.dateFirst && opts.dateRowSpan && opts.dateRowSpan > 1) {
                dateCell = '<td rowspan="' + opts.dateRowSpan + '" class="col-date-span">' + esc(date || '—') + '</td>';
              } else {
                dateCell = '<td>' + esc(date || '—') + '</td>';
              }
            } else {
              if (opts.continuation || opts.groupContinuation) {
                dateCell = '';
              } else if (opts.groupFirst) {
                var span = opts.groupRowSpan || 2;
                dateCell = '<td rowspan="' + span + '" class="col-date-span">' + esc(date) + '</td>';
              } else {
                dateCell = '<td>' + esc(date) + '</td>';
              }
            }
            var trackName = e.circuit_name || e.location || '—';
            if (isStockCarSeries && trackName !== '—' && trackName.indexOf(', ') >= 0) {
              trackName = trackName.split(', ')[0];
            }
            var trackSlug = slugify(e.circuit_name || e.location || trackName);
            var trackCell;
            var seriesKeyRow = (seriesId || '').toLowerCase();
            if (seriesKeyRow === 'wec') {
              // Для WEC объединяем только ячейку трассы (без даты) для Пролога и первого раунда.
              if (opts.circuitContinuation) {
                trackCell = '';
              } else if (opts.circuitFirst && opts.circuitRowSpan && opts.circuitRowSpan > 1 && trackName !== '—') {
                trackCell = '<td rowspan="' + opts.circuitRowSpan + '" class="col-circuit-span"><a href="/track/' + encodeURIComponent(trackSlug) + '" class="track-link" data-track-name="' + esc(trackName) + '">' + esc(trackName) + '</a></td>';
              } else if (opts.circuitFirst && opts.circuitRowSpan && opts.circuitRowSpan > 1 && trackName === '—') {
                trackCell = '<td rowspan="' + opts.circuitRowSpan + '" class="col-circuit-span">' + esc(trackName) + '</td>';
              } else if (trackName === '—') {
                trackCell = '<td>' + esc(trackName) + '</td>';
              } else {
                trackCell = '<td><a href="/track/' + encodeURIComponent(trackSlug) + '" class="track-link" data-track-name="' + esc(trackName) + '">' + esc(trackName) + '</a></td>';
              }
            } else {
              if (opts.continuation || opts.groupContinuation) {
                trackCell = '';
              } else if (opts.groupFirst && opts.groupRowSpan > 1 && trackName !== '—') {
                trackCell = '<td rowspan="' + opts.groupRowSpan + '" class="col-circuit-span"><a href="/track/' + encodeURIComponent(trackSlug) + '" class="track-link" data-track-name="' + esc(trackName) + '">' + esc(trackName) + '</a></td>';
              } else if (opts.groupFirst && opts.groupRowSpan > 1 && trackName === '—') {
                trackCell = '<td rowspan="' + opts.groupRowSpan + '" class="col-circuit-span">' + esc(trackName) + '</td>';
              } else if (trackName === '—') {
                trackCell = '<td>' + esc(trackName) + '</td>';
              } else {
                trackCell = '<td><a href="/track/' + encodeURIComponent(trackSlug) + '" class="track-link" data-track-name="' + esc(trackName) + '">' + esc(trackName) + '</a></td>';
              }
            }
            var numCell;
            if (isSupercars) {
              // Для Supercars показываем номер раунда, объединённый по нескольким гонкам.
              if (opts.roundContinuation) {
                numCell = '';
              } else if (opts.roundFirst && opts.roundRowSpan && opts.roundRowSpan > 1) {
                numCell = '<td class="col-num" rowspan="' + opts.roundRowSpan + '">' + esc(String(opts.round)) + '</td>';
              } else {
                numCell = '<td class="col-num">' + esc(String(opts.round || showNum)) + '</td>';
              }
            } else if ((seriesKeyRow === 'f1' || seriesKeyRow === 'wec') && opts.roundDisplay != null) {
              numCell = '<td class="col-num">' + esc(opts.roundDisplay) + '</td>';
            } else {
              numCell = '<td class="col-num">' + esc(showNum) + '</td>';
            }
            if (seriesKeyRow === 'super_formula' && e._sfRdLabel) {
              numCell = '<td class="col-num">' + esc(String(e._sfRdLabel)) + '</td>';
            }
            var eventCell;
            if (opts.continuation || opts.groupContinuation) {
              eventCell = '';
            } else if (opts.groupFirst && opts.groupRowSpan && opts.groupRowSpan > 1) {
              eventCell = '<td rowspan="' + opts.groupRowSpan + '" class="col-event-span">' + link + '</td>';
            } else {
              eventCell = '<td>' + link + '</td>';
            }

            if (isSupercars) {
              // Специальный вид для Supercars: Round / Race (1..37) / Event / Circuit / Location / Date / LT / MSK (объединённые ячейки для повторов)
              var raceCell = '<td>' + esc(String(opts.globalRaceNum != null ? opts.globalRaceNum : (opts.raceInRound || ''))) + '</td>';
              var locText = e.location || '—';
              var locationCell;
              if (opts.groupContinuation) {
                locationCell = '';
              } else if (opts.groupFirst && opts.groupRowSpan && opts.groupRowSpan > 1) {
                locationCell = '<td rowspan="' + opts.groupRowSpan + '" class="col-location-span">' + esc(locText) + '</td>';
              } else {
                locationCell = '<td>' + esc(locText) + '</td>';
              }
              var timeCell = '<td class="col-time">' + esc(getScheduleTimeLabel(e, seriesKeyRow) || '—') + '</td>';
            return (
              '<tr>' +
                  numCell +
                  raceCell +
                  eventCell +
                  trackCell +
                  locationCell +
                  dateCell +
                  timeCell +
                '</tr>'
              );
            }

            if (seriesKeyRow === 'imsa') {
              // IMSA: Rnd. | Race | Length | Classes | Circuit | Location | Date
              // Дополнительные данные по длине гонки и классам задаём на клиенте.
              var imsaMeta = {
                'IMSA_2026_PRE_SEASON_TEST': { classes: 'All' },
                'IMSA_2026_1': { length: '24 hours', classes: 'All' },
                'IMSA_2026_2': { length: '12 hours', classes: 'All' },
                'IMSA_2026_3': { length: '100 minutes', classes: 'GTP, GTD' },
                'IMSA_2026_4': { length: '160 minutes', classes: 'GTP, GTD Pro, GTD' },
                'IMSA_2026_5': { length: '100 minutes', classes: 'GTP, GTD Pro' },
                'IMSA_2026_6': { length: '6 hours', classes: 'All' },
                'IMSA_2026_7': { length: '160 minutes', classes: 'LMP2, GTD Pro, GTD' },
                'IMSA_2026_8': { length: '6 hours', classes: 'All' },
                'IMSA_2026_9': { length: '160 minutes', classes: 'GTD Pro, GTD' },
                'IMSA_2026_10': { length: '160 minutes', classes: 'All' },
                'IMSA_2026_11': { length: '10 hours', classes: 'All' }
              };
              var meta = imsaMeta[e.id] || {};
              var lengthCell = '<td>' + esc(meta.length || '—') + '</td>';
              var classesCell = '<td>' + esc(meta.classes || '—') + '</td>';
              var locTextImsa = e.location || '—';
              var locationCellImsa = '<td>' + esc(locTextImsa) + '</td>';
              var dateLabelImsa = (startIso && endIso && startIso !== endIso && formatDateRangeLong)
                ? formatDateRangeLong(e.start_date, e.end_date)
                : (formatShortDate ? formatShortDate(startIso) : startIso);
              var dateCellImsa = '<td>' + esc(dateLabelImsa || '—') + '</td>';
              return (
                '<tr>' +
                  numCell +
                '<td>' + link + '</td>' +
                  lengthCell +
                  classesCell +
                  trackCell +
                  locationCellImsa +
                  dateCellImsa +
                '</tr>'
              );
            }

            if (seriesKeyRow === 'f1') {
              // F1 (текущий сезон) из API: # | Grand Prix | Circuit | Date | Time
              var timeLabelF1 = getScheduleTimeLabel(e, seriesKeyRow);
              return (
                '<tr>' +
                  numCell +
                  eventCell +
                  trackCell +
                  dateCell +
                  '<td class="col-time">' + esc(timeLabelF1 || '—') + '</td>' +
                '</tr>'
              );
            }

            if (seriesKeyRow.indexOf('f1-') === 0) {
              // Исторические сезоны F1: # | Grand Prix | Circuit | Date (без Time)
              return (
                '<tr>' +
                  numCell +
                  eventCell +
                  trackCell +
                  dateCell +
                '</tr>'
              );
            }

            if (seriesKeyRow === 'indycar') {
              var locCellIndy = '<td>' + esc(e.location || '—') + '</td>';
              var timeLabelIndy = getScheduleTimeLabel(e, seriesKeyRow);
              return (
                '<tr>' +
                  numCell +
                  dateCell +
                  eventCell +
                  trackCell +
                  locCellIndy +
                  '<td class="col-time">' + esc(timeLabelIndy || '—') + '</td>' +
                '</tr>'
              );
            }

            if (seriesKeyRow === 'super_formula') {
              var venueSf = (window.TGA && window.TGA.superFormulaVenueLine)
                ? window.TGA.superFormulaVenueLine(e)
                : ((e.circuit_name || '') + (e.location ? ' — ' + e.location : '') || '—');
              var trackSlugSf = slugify(e.circuit_name || e.location || venueSf);
              var venueCellSf = trackSlugSf && trackSlugSf !== '—'
                ? '<td><a href="/track/' + encodeURIComponent(trackSlugSf) + '" class="track-link" data-track-name="' + esc(e.circuit_name || venueSf) + '">' + esc(venueSf) + '</a></td>'
                : '<td>' + esc(venueSf) + '</td>';
              var timeLabelSf = getScheduleTimeLabel(e, seriesKeyRow);
              return (
                '<tr>' +
                  numCell +
                  dateCell +
                  venueCellSf +
                  '<td class="col-time">' + esc(timeLabelSf || '—') + '</td>' +
                '</tr>'
              );
            }

            if (isStockCarSeries) {
              // NASCAR: # | Race | Track | Location | Date | Local (date + time) | MSK (date + time)
              // Track — только название трека; Location — только город/штат, без дублирования
              var raceCellStock = '<td>' + link + '</td>';
              var locTextStock = (e.circuit_name && e.circuit_name.indexOf(', ') >= 0)
                ? e.circuit_name.slice(e.circuit_name.indexOf(', ') + 2).trim()
                : (e.location || '—');
              var locationCellStock;
              if (opts.continuation || opts.groupContinuation) {
                locationCellStock = '';
              } else if (opts.groupFirst && opts.groupRowSpan && opts.groupRowSpan > 1) {
                locationCellStock = '<td rowspan="' + opts.groupRowSpan + '" class="col-location-span">' + esc(locTextStock) + '</td>';
              } else {
                locationCellStock = '<td>' + esc(locTextStock) + '</td>';
              }
              var timeLabelStock = getScheduleTimeLabel(e, seriesKeyRow);
              return (
                '<tr>' +
                  numCell +
                  raceCellStock +
                  trackCell +
                  locationCellStock +
                  dateCell +
                  '<td class="col-time">' + esc(timeLabelStock || '—') + '</td>' +
                '</tr>'
              );
            }

            var timeLabelDefault = getScheduleTimeLabel(e, seriesKeyRow);
            return (
              '<tr' + (opts.continuation ? ' class="schedule-row-continuation"' : '') + '>' +
                numCell +
                dateCell +
                eventCell +
                trackCell +
                '<td class="col-time">' + esc(timeLabelDefault || '—') + '</td>' +
              '</tr>'
            );
          }

          // WEC: Пролог без номера раунда, начиная с 6 Hours of Imola считаем Rnd 1, 2, ...
          if (seriesKeySched === 'wec') {
            var rowsWec = [];
            if (Array.isArray(list) && list.length > 0) {
              for (var wi = 0; wi < list.length; wi++) {
                var evW = list[wi];
                if (!evW) continue;
                var optsW = {};
                if (wi === 0) {
                  // Пролог: прочерк в колонке номера и начало rowspan по трассе, если следующий этап на том же треке.
                  optsW.roundDisplay = '—';
                  if (list[1] && (list[1].circuit_name || list[1].location) === (evW.circuit_name || evW.location)) {
                    optsW.circuitFirst = true;
                    optsW.circuitRowSpan = 2;
                  }
                } else {
                  // Раунды начинаются с 1 для 6 Hours of Imola.
                  optsW.roundDisplay = String(wi);
                  if (wi === 1 && (list[0].circuit_name || list[0].location) === (evW.circuit_name || evW.location)) {
                    optsW.circuitContinuation = true;
                  }
                }
                rowsWec.push(eventRow(evW, wi + 1, optsW));
              }
            }
            if (schedBody) {
              schedBody.innerHTML = rowsWec.join('');
              if (schedTable) makeSimpleTableSortable(schedTable);
            }
            return;
          }

            var rows = [];
          if (isCup) rows.push(isStockCarSeries ? regularBannerStock : regularBanner);
          if (isSupercars) {
            // Группируем подряд идущие гонки Supercars по названию события (без "Race N") и
            // отображаем номер раунда в одной объединённой ячейке.
            // Защита от бесконечного цикла: лимит итераций и гарантированное продвижение idx.
            var round = 0;
            var maxLoops = Array.isArray(list) ? list.length : 0;
            var loopCount = 0;
            for (var idx = 0; idx < list.length;) {
              if (++loopCount > maxLoops) {
                console.error('Supercars schedule: loop guard hit, breaking');
                break;
              }
              var e0 = list[idx];
              if (!e0) {
                idx++;
                continue;
              }
              var baseName = ((e0.name || '')).replace(/\s+Race\s+\d+$/i, '').trim();
              round++;
              // Вставляем секционные баннеры для Supercars:
              // перед 1‑м этапом — Sprint Cup; между 9/10 — Enduro Cup; между 11/12 — Finals Series.
              if (round === 1) {
                rows.push(supercarsSprintBanner);
              } else if (round === 10) {
                rows.push(supercarsEnduroBanner);
              } else if (round === 12) {
                rows.push(supercarsFinalsBanner);
              }
              var start = idx;
              var size = 1;
              while (start + size < list.length) {
                var eNext = list[start + size];
                var baseNext = ((eNext && (eNext.name || '')) || '').replace(/\s+Race\s+\d+$/i, '').trim();
                if (baseNext !== baseName) break;
                size++;
              }
              if (size < 1) size = 1;
              try {
                for (var j = 0; j < size; j++) {
                  var ev = list[start + j];
                  if (!ev) continue;
                  var globalRaceNum = start + j + 1;
                  var evDate = (ev.start_date || ev.date || '').slice(0, 10);
                  var dateRowSpan = 1;
                  for (var k = j + 1; k < size; k++) {
                    var nextDate = (list[start + k].start_date || list[start + k].date || '').slice(0, 10);
                    if (nextDate !== evDate) break;
                    dateRowSpan++;
                  }
                  var prevDate = j > 0 ? (list[start + j - 1].start_date || list[start + j - 1].date || '').slice(0, 10) : '';
                  var dateFirst = (j === 0 || prevDate !== evDate);
                  var dateContinuation = (j > 0 && prevDate === evDate);
                  rows.push(eventRow(ev, globalRaceNum, {
                    round: round,
                    roundFirst: j === 0,
                    roundRowSpan: size,
                    roundContinuation: j > 0,
                    groupFirst: j === 0,
                    groupRowSpan: size,
                    groupContinuation: j > 0,
                    raceInRound: j + 1,
                    globalRaceNum: globalRaceNum,
                    dateFirst: dateFirst,
                    dateRowSpan: dateRowSpan,
                    dateContinuation: dateContinuation
                  }));
                }
              } catch (rowErr) {
                console.error('Supercars schedule row error', rowErr);
              }
              idx = start + size;
            }
          } else if ((seriesId || '').toLowerCase() === 'f1') {
            // F1: предсезонные тесты — прочерк в колонке Round, отсчёт раундов с первой гонки (Австралия).
            var f1RoundCounter = 0;
            for (var i = 0; i < list.length; i++) {
              var e = list[i];
              var isF1PreSeason = e.id === 'F1_2026_PRE_SEASON_TEST_1' || e.id === 'F1_2026_PRE_SEASON_TEST_2';
              var roundDisplay = isF1PreSeason ? '—' : String(++f1RoundCounter);
              rows.push(eventRow(e, roundDisplay, { roundDisplay: roundDisplay }));
            }
          } else {
            // Все серии, кроме Supercars и F1: стандартная нумерация этапов.
            // Для NASCAR‑серий этапы, отмеченные как unnumbered (Cook Out Clash, All‑Star),
            // не увеличивают счётчик — следующий полноценный этап получает номер 1, 2, 3...
            var raceCounter = 0;
            for (var i = 0; i < list.length; i++) {
              var e = list[i];
              var isUnnumbered = !!unnumberedIds[e.id];
              var currentNum = raceCounter;
              if (!isUnnumbered) currentNum = ++raceCounter;
              if (isCup && currentNum === 18) rows.push(isStockCarSeries ? inSeasonBannerStock : inSeasonBanner);
              if (isCup && currentNum === 23) rows.push(isStockCarSeries ? regularBannerStock : regularBanner);
              if (isCup && currentNum === 27) rows.push(isStockCarSeries ? theChaseBannerStock : theChaseBanner);
              if ((seriesId || '').toLowerCase() === 'noaps' && i === 24) rows.push(isStockCarSeries ? theChaseBannerStock : theChaseBanner);
              if ((seriesId || '').toLowerCase() === 'nascar_truck' && i === 18) rows.push(isStockCarSeries ? theChaseBannerStock : theChaseBanner);
              if (e.id === continuationId || e.id === 'NASCAR_CUP_2026_ALLSTAR_OPEN') {
                rows.push(eventRow(e, currentNum, { unnumbered: true }));
              } else {
                rows.push(eventRow(e, currentNum, {}));
              }
            }
          }
          scheduleBody.innerHTML = rows.join('');

          // Допояснение для IMSA: All Classes → этапы Michelin Endurance Cup
          if ((seriesId || '').toLowerCase() === 'imsa') {
            var schedSection = document.querySelector('.schedule-section');
            if (schedSection) {
              var note = document.getElementById('imsa-endurance-note');
              if (!note) {
                note = document.createElement('p');
                note.id = 'imsa-endurance-note';
                note.className = 'schedule-note';
                schedSection.appendChild(note);
              }
              note.textContent = 'All classes: races that are part of the Michelin Endurance Cup.';
            }
          }
        }
        var seriesKeyEvents = (seriesId || '').toLowerCase();
        if (!Array.isArray(events) || events.length === 0) {
          // Для IndyCar, F1, F2, F3 используем статические расписания
          if (seriesKeyEvents === 'indycar' || seriesKeyEvents === 'f1' || seriesKeyEvents === 'f2' || seriesKeyEvents === 'f3') {
            renderScheduleRows([]);
            return;
          }
          // Для WEC 2026 — статический календарь (Prologue + 8 этапов), если API не вернул события.
          if (seriesKeyEvents === 'wec') {
            var wecStatic = [
              { id: 'WEC_2026_PROLOGUE', name: 'WEC Prologue',         circuit_name: 'Imola Circuit',                location: 'Imola',            start_date: '2026-04-14', end_date: '2026-04-14' },
              { id: 'WEC_2026_1',        name: '6 Hours of Imola',     circuit_name: 'Imola Circuit',                location: 'Imola',            start_date: '2026-04-19', end_date: '2026-04-19' },
              { id: 'WEC_2026_2',        name: '6 Hours of Spa-Francorchamps', circuit_name: 'Circuit de Spa-Francorchamps', location: 'Stavelot',        start_date: '2026-05-09', end_date: '2026-05-09' },
              { id: 'WEC_2026_3',        name: '24 Hours of Le Mans',  circuit_name: 'Circuit de la Sarthe',         location: 'Le Mans',          start_date: '2026-06-13', end_date: '2026-06-14' },
              { id: 'WEC_2026_4',        name: '6 Hours of São Paulo', circuit_name: 'Interlagos Circuit',           location: 'São Paulo',        start_date: '2026-07-12', end_date: '2026-07-12' },
              { id: 'WEC_2026_5',        name: 'Lone Star Le Mans',    circuit_name: 'Circuit of the Americas',      location: 'Austin, Texas',    start_date: '2026-09-06', end_date: '2026-09-06' },
              { id: 'WEC_2026_6',        name: '6 Hours of Fuji',      circuit_name: 'Fuji Speedway',                location: 'Oyama, Shizuoka',  start_date: '2026-09-27', end_date: '2026-09-27' },
              { id: 'WEC_2026_7',        name: 'Qatar 1812 km',        circuit_name: 'Losail International Circuit', location: 'Qatar Lusail',     start_date: '2026-10-24', end_date: '2026-10-24' },
              { id: 'WEC_2026_8',        name: '8 Hours of Bahrain',   circuit_name: 'Bahrain International Circuit', location: 'Bahrain Sakhir',  start_date: '2026-11-07', end_date: '2026-11-07' }
            ];
            renderScheduleRows(wecStatic);
            return;
          }
          scheduleEmpty.classList.remove('hidden');
          scheduleEmpty.textContent = t('schedule.empty') || 'No schedule data yet.';
          return;
        }
        // Базовый порядок: сортируем по дате, затем по времени (AM раньше PM).
        events.sort(function (a, b) {
          var da = (a.start_date || a.date || '');
          var db = (b.start_date || b.date || '');
          if (da < db) return -1;
          if (da > db) return 1;
          var ta = parseTimeToMinutes(a.time_est || a.time_msk || '');
          var tb = parseTimeToMinutes(b.time_est || b.time_msk || '');
          return ta - tb;
        });

        // Защита от смешивания серий: оставляем только события нужной серии.
        var expectedKey = (seriesId || '').toLowerCase();
        if (Array.isArray(events)) {
          events = events.filter(function (e) {
            var sid = (e && (e._seriesId || e.series_id || '')).toLowerCase();
            // Для старых данных, где _seriesId может быть пустым, допускаем всё.
            return !sid || sid === expectedKey;
          });
          events = filterVisibleEvents(events);
        }

        if (expectedKey === 'super_formula' && window.TGA && typeof window.TGA.collapseSuperFormulaScheduleEvents === 'function') {
          events = window.TGA.collapseSuperFormulaScheduleEvents(events);
        }

        renderScheduleRows(events);
        var scheduleTable = document.getElementById('schedule-table');
        if (scheduleTable) {
          var schThs = scheduleTable.querySelectorAll('thead th');
          var eventsCopy = events.slice();
          var numCols = schThs.length;
          [].forEach.call(schThs, function (th, col) {
            th.classList.add('sortable');
            var dir = 1;
            th.addEventListener('click', function () {
              eventsCopy.sort(function (a, b) {
                var va, vb;
                if (expectedKey === 'super_formula' && numCols === 4) {
                  function sfRdSortKey(ev) {
                    var lab = ev && ev._sfRdLabel;
                    if (lab) {
                      var m = String(lab).match(/^(\d+)/);
                      if (m) return parseInt(m[1], 10);
                    }
                    var idm = String((ev && ev.id) || '').match(/_(\d+)$/);
                    return idm ? parseInt(idm[1], 10) : 0;
                  }
                  if (col === 0) {
                    return dir * (sfRdSortKey(a) - sfRdSortKey(b));
                  }
                  if (col === 1) {
                    va = (a.start_date || a.date || '');
                    vb = (b.start_date || b.date || '');
                    return dir * (va < vb ? -1 : va > vb ? 1 : 0);
                  }
                  if (col === 3) {
                    var taa2 = parseTimeToMinutes(a.time_est || a.time_msk || '');
                    var tbb2 = parseTimeToMinutes(b.time_est || b.time_msk || '');
                    return dir * (taa2 - tbb2);
                  }
                  if (col === 2) {
                    var fa = (window.TGA && window.TGA.superFormulaVenueLine) ? window.TGA.superFormulaVenueLine(a) : ((a.circuit_name || '') + (a.location || ''));
                    var fb = (window.TGA && window.TGA.superFormulaVenueLine) ? window.TGA.superFormulaVenueLine(b) : ((b.circuit_name || '') + (b.location || ''));
                    return dir * (fa < fb ? -1 : fa > fb ? 1 : 0);
                  }
                  return 0;
                }
                var dateCol = numCols === 7 ? 5 : (numCols === 6 ? 4 : 1);
                var timeCol = numCols - 1;
                if (col === dateCol) {
                  va = (a.start_date || a.date || '');
                  vb = (b.start_date || b.date || '');
                  return dir * (va < vb ? -1 : va > vb ? 1 : 0);
                }
                if (col === timeCol) {
                  var ta = parseTimeToMinutes(a.time_est || a.time_msk || '');
                  var tb = parseTimeToMinutes(b.time_est || b.time_msk || '');
                  return dir * (ta - tb);
                }
                var nameCol = numCols === 7 ? 1 : (numCols === 6 ? 2 : 2);
                var circuitCol = numCols === 7 ? 2 : (numCols === 6 ? 3 : 3);
                var locationCol = numCols === 7 ? 3 : (numCols === 6 ? 3 : 2);
                va = col === 0 ? 0
                  : col === nameCol ? (a.name || '')
                  : col === circuitCol ? (a.circuit_name || a.location || '')
                  : col === locationCol ? (a.location || '')
                  : '';
                vb = col === 0 ? 0
                  : col === nameCol ? (b.name || '')
                  : col === circuitCol ? (b.circuit_name || b.location || '')
                  : col === locationCol ? (b.location || '')
                  : '';
                return dir * (va < vb ? -1 : va > vb ? 1 : 0);
              });
              [].forEach.call(schThs, function (t) { t.classList.remove('sort-asc', 'sort-desc'); });
              th.classList.add(dir === 1 ? 'sort-asc' : 'sort-desc');
              dir = -dir;
              renderScheduleRows(eventsCopy);
            });
          });
        }
      })
      .catch(function () {
        scheduleEmpty.classList.remove('hidden');
        scheduleEmpty.textContent = t('schedule.empty') || 'No schedule data yet.';
      });

    if (isF1) {
      renderF1HistoryFromStatic();
    }
  }

  function renderF1HistoryFromStatic() {
    var historyTable = document.getElementById('history-table');
    var historyBody = document.querySelector('#history-table tbody');
    if (!historyTable || !historyBody) return;
    var earliestSeason = 1950;
    var lastCompletedSeason = Math.min(new Date().getFullYear() - 1, 2025);
    if (lastCompletedSeason < earliestSeason) return;
    var thead = historyTable.querySelector('thead tr');
    if (thead) {
      thead.innerHTML = '<th>Season</th><th>Races</th><th>Driver champion</th><th>Pts</th><th>Team</th><th>Chassis</th><th>Engine</th><th>Constructors champion</th><th>Pts</th>';
    }
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
    historyBody.innerHTML = rowsHtml;
    if (typeof makeSimpleTableSortable === 'function') makeSimpleTableSortable(historyTable);
  }


  function eventSeriesId(eventId) {
    if (!eventId) return '';
    var u = String(eventId).toUpperCase();
    // nascar_cup_2026_6 → NASCAR_CUP (apiEventId lowercased; split('_')[0]==='NASCAR' was false)
    if (u.indexOf('NASCAR_') === 0) {
      return u.replace(/_\d+.*$/, '');
    }
    var parts = String(eventId).split('_');
    return (parts[0] || '').toUpperCase();
  }

  // ── Event page (blocks navigation) ──────────────────────────────────────
  var eventBlockDefs = [
    {
      id: 'bop', icon: '⚖',
      check: function (d) {
        var ev = ((d.event_id || '') + '').toLowerCase().replace(/\s+/g, '_');
        return ev === 'imsa_2026_1' || ev === 'imsa_2026_2';
      },
      meta: function (d) { return ''; }
    },
    {
      id: 'pre_season_tests', icon: '🔧',
      check: function (d) { return !!(d.tables && d.tables.pre_season_tests); },
      meta: function (d) { return d.tables && d.tables.pre_season_tests ? '' : ''; }
    },
    {
      id: 'entry-list', icon: '📋',
      check: function (d) { return !!(d.entry_list) || (d.event_id && (eventSeriesId(d.event_id) || '').toLowerCase() === 'supercars'); },
      meta:  function (d) {
        var n = (d.entry_list && d.entry_list.length) ? d.entry_list.length : 0;
        return n + ' ' + (n === 1 ? t('meta.drivers.one') : t('meta.drivers.many'));
      }
    },
    {
      id: 'practice', icon: '⏱',
      check: function (d) { return !!(d.tables && (d.tables.practice || d.tables.practice2 || d.tables.practice3 || d.tables.final_practice)) || (d.event_id && (eventSeriesId(d.event_id) || '').toLowerCase() === 'supercars'); },
      meta:  function (d) {
        var s = [];
        var tables = d.tables || {};
        if (tables.practice)       s.push(t('meta.practice1'));
        if (tables.practice2)      s.push(t('meta.practice2'));
        if (tables.practice3)      s.push(t('meta.practice3'));
        if (tables.final_practice) s.push(t('meta.final_practice'));
        return s.join(' · ');
      }
    },
    {
      id: 'qualifying', icon: '⚡',
      check: function (d) { return !!(d.tables && (d.tables.qualifying || d.tables.duel1 || d.tables.duel2 || d.tables.last_chance || d.tables.did_not_qualify)) || (d.event_id && (eventSeriesId(d.event_id) || '').toLowerCase() === 'supercars'); },
      meta:  function (d) {
        var s = [];
        var tables = d.tables || {};
        if (tables.duel1)           s.push(t('meta.duel1'));
        if (tables.duel2)           s.push(t('meta.duel2'));
        if (tables.last_chance)     s.push(t('meta.last_chance'));
        if (tables.qualifying)      s.push(t('meta.qualifying'));
        if (tables.did_not_qualify) s.push(t('meta.dnq'));
        return s.join(' · ');
      }
    },
    {
      id: 'race', icon: '🏁',
      check: function (d) {
        var series = (d.event_id && eventSeriesId(d.event_id)) ? (eventSeriesId(d.event_id) || '').toLowerCase() : '';
        var isStockCar = ['nascar_cup', 'noaps', 'nascar_truck', 'arca', 'nascar_modified'].indexOf(series) >= 0;
        if (series === 'supercars') return true;
        if (d.tables && (d.tables.starting_lineup || tgaStageTable(d.tables, 1) || tgaStageTable(d.tables, 2) || tgaStageTable(d.tables, 3) || d.tables.race_results || d.tables.caution_breakdown || d.tables.race)) return true;
        if (d.race_statistics && Object.keys(d.race_statistics).length > 0) return true;
        if (isStockCar && d.tables && (d.tables.practice || d.tables.qualifying)) return true;
        return false;
      },
      meta: function (d) {
        var s = [];
        var seriesMeta = (d.event_id && eventSeriesId(d.event_id)) ? (eventSeriesId(d.event_id) || '').toLowerCase() : '';
        var isStockCarMeta = ['nascar_cup', 'noaps', 'nascar_truck', 'arca', 'nascar_modified'].indexOf(seriesMeta) >= 0;
        var raceResultsFirstMeta = isStockCarMeta && d.tables && d.tables.race_results && Array.isArray(d.tables.race_results.rows) && d.tables.race_results.rows.length > 0;
        if (d.tables && d.tables.starting_lineup) s.push(t('meta.starting_grid'));
        if (raceResultsFirstMeta && d.tables.race_results) s.push(t('meta.race_results'));
        if (d.tables && tgaStageTable(d.tables, 1)) s.push(t('meta.stage1'));
        if (d.tables && tgaStageTable(d.tables, 2)) s.push(t('meta.stage2'));
        if (d.tables && tgaStageTable(d.tables, 3)) s.push(t('meta.stage3'));
        if (!raceResultsFirstMeta && d.tables && d.tables.race_results) s.push(t('meta.race_results'));
        return s.join(' · ');
      }
    }
  ];

  // Общая логика Race Statistics: разбор "Поле: значение" и сбор из race_statistics / race_results
  function parseStatRow(row) {
    var first = row[0] != null ? String(row[0]).trim() : '';
    var second = row[1] != null ? String(row[1]).trim() : '';
    if (!first) return null;
    var colonIdx = first.indexOf(':');
    if (colonIdx >= 0) {
      return { key: first.slice(0, colonIdx).trim(), val: (first.slice(colonIdx + 1).trim() || second) };
    }
    return { key: first, val: second };
  }
  function getEventRaceStats(d) {
    var stats = d.race_statistics && Object.keys(d.race_statistics).length > 0 ? d.race_statistics : null;
    if (!stats && d.tables && d.tables.race_statistics && d.tables.race_statistics.rows) {
      stats = {};
      d.tables.race_statistics.rows.forEach(function (row) {
        var p = parseStatRow(row);
        if (p && p.key) stats[p.key] = p.val;
      });
    }
    if ((!stats || Object.keys(stats).length === 0) && d.tables && d.tables.race_results && d.tables.race_results.rows) {
      var statKeys = ['Lead changes', 'Cautions / Laps', 'Red flags', 'Time of race', 'Average speed'];
      stats = {};
      d.tables.race_results.rows.forEach(function (row) {
        var p = parseStatRow(row);
        if (!p || !p.key) return;
        var nk = p.key.replace(/\s*\/\s*/g, ' / ').trim();
        if (statKeys.indexOf(nk) >= 0) stats[nk] = p.val;
      });
    }
    return stats && Object.keys(stats).length > 0 ? stats : null;
  }
  /** Matches stock-car event JSON (e.g. NOAPS): consistent row order regardless of object key order. */
  var RACE_STAT_DISPLAY_ORDER = ['Average speed', 'Cautions / Laps', 'Lead changes', 'Red flags', 'Time of race'];
  function orderedRaceStatKeys(stats) {
    var keys = Object.keys(stats);
    var ordered = [];
    RACE_STAT_DISPLAY_ORDER.forEach(function (k) {
      if (keys.indexOf(k) >= 0) ordered.push(k);
    });
    keys.forEach(function (k) {
      if (RACE_STAT_DISPLAY_ORDER.indexOf(k) < 0) ordered.push(k);
    });
    return ordered;
  }
  function renderRaceStatsTable(stats) {
    return '<h4 class="table-section-title">' + t('section.race_statistics') + '</h4>' +
      '<div class="table-wrap"><table class="data-table table-field-value"><thead><tr><th>' + t('th.field') + '</th><th>' + t('th.value') + '</th></tr></thead><tbody>' +
      orderedRaceStatKeys(stats).map(function (k) { return '<tr><td class="col-field">' + esc(dash(localizeStatKey(k))) + '</td><td>' + esc(dash(localizeStatValue(stats[k]))) + '</td></tr>'; }).join('') +
      '</tbody></table></div>';
  }

  function buildTableSection(title, tableData, extraClass, getRowClass, colWidths, subtitle, titleClass, mergeTeamCells) {
    if (!tableData || typeof tableData !== 'object') return null;
    var rows = Array.isArray(tableData.rows) ? tableData.rows : [];
    var headers = Array.isArray(tableData.headers) ? tableData.headers : [];
    if (headers.length === 0 && rows.length > 0 && rows[0] && rows[0].length > 0) {
      for (var hi = 0; hi < rows[0].length; hi++) headers.push('');
    }
    var cls = 'data-table' + (extraClass ? ' ' + extraClass : '');
    var noteColIndices   = {};
    var reasonColIndices = {};
    var noColIndices     = {};
    var driverColIndices = {};
    var driversColIndices = {};
    var teamColIndices   = {};
    headers.forEach(function (h, idx) {
      var lh = (h || '').toLowerCase().trim();
      if (translateValueHeaders.indexOf(lh)  >= 0) noteColIndices[idx]   = true;
      if (translateReasonHeaders.indexOf(lh) >= 0) reasonColIndices[idx] = true;
      if (lh === 'no' || lh === 'no.') noColIndices[idx] = true;
      if (lh === 'driver' || lh === 'driver name' || (lh.indexOf('driver') === 0 && lh.length <= 12)) driverColIndices[idx] = true;
      if (lh === 'drivers') driversColIndices[idx] = true;
      if (lh === 'team') teamColIndices[idx] = true;
    });
    var teamColIdx = -1;
    for (var ti = 0; ti < headers.length; ti++) { if (teamColIndices[ti]) { teamColIdx = ti; break; } }
    function isSeparatorRow(row) {
      if (!row || row.length === 0) return false;
      var first = (row[0] != null && String(row[0]).trim() !== '');
      if (!first) return false;
      for (var i = 1; i < row.length; i++) { if (row[i] != null && String(row[i]).trim() !== '') return false; }
      return true;
    }
    var teamRowSpan = [];
    if (mergeTeamCells && teamColIdx >= 0 && rows.length > 0) {
      for (var i = 0; i < rows.length; i++) teamRowSpan[i] = 0;
      for (var i = 0; i < rows.length; i++) {
        if (teamRowSpan[i] === -1) continue;
        if (isSeparatorRow(rows[i])) continue;
        var teamVal = (rows[i][teamColIdx] != null ? String(rows[i][teamColIdx]).trim() : '');
        var span = 1;
        for (var j = i + 1; j < rows.length; j++) {
          if (isSeparatorRow(rows[j])) break;
          var nextVal = (rows[j][teamColIdx] != null ? String(rows[j][teamColIdx]).trim() : '');
          if (nextVal === teamVal) { span++; teamRowSpan[j] = -1; } else break;
        }
        teamRowSpan[i] = span;
      }
    }
    function stripNumberPrefix(s) {
      if (s == null) return s;
      return String(s).replace(/^[\*\+]+/, '').trim();
    }
    var colgroup = '';
    if (colWidths && Array.isArray(colWidths) && colWidths.length === headers.length) {
      colgroup = '<colgroup>' + colWidths.map(function (w) { return '<col style="width:' + (w || '') + '">'; }).join('') + '</colgroup>';
    }
    var isPreSeasonTable = extraClass && extraClass.indexOf('pre-season-results-table') >= 0;
    var theadStyle = isPreSeasonTable ? ' style="display:table-header-group !important;visibility:visible !important"' : '';
    var theadTrStyle = isPreSeasonTable ? ' style="display:table-row !important;visibility:visible !important"' : '';
    var thStyle = isPreSeasonTable ? ' style="display:table-cell !important;visibility:visible !important"' : '';
    var thead = '<thead' + theadStyle + '><tr' + theadTrStyle + '>' + headers.map(function (h) { return '<th' + thStyle + '>' + esc(localizeTableHeader(h || '')) + '</th>'; }).join('') + '</tr></thead>';
    var tbodyRows = rows.length
      ? rows.map(function (row, rowIndex) {
          if (isSeparatorRow(row)) {
            var text = (row[0] != null ? String(row[0]).trim() : '');
            return '<tr class="table-separator-row"><td colspan="' + Math.max(1, headers.length) + '">' + esc(text) + '</td></tr>';
          }
          var rc = getRowClass ? getRowClass(row) : '';
          var emptyCell = (extraClass && extraClass.indexOf('caution-breakdown') >= 0) ? '' : '—';
          return '<tr' + (rc ? ' class="' + rc + '"' : '') + '>' + row.map(function (cell, ci) {
            if (mergeTeamCells && ci === teamColIdx && teamColIdx >= 0) {
              if (teamRowSpan[rowIndex] === -1) return '';
              if (teamRowSpan[rowIndex] > 0) {
                var teamVal = (cell != null && String(cell).trim() !== '') ? '<a href="/team/' + encodeURIComponent(slugify(String(cell).trim())) + '" class="track-link">' + esc(String(cell).trim()) + '</a>' : emptyCell;
                return '<td rowspan="' + teamRowSpan[rowIndex] + '" class="stockcar-team-cell">' + teamVal + '</td>';
              }
            }
            var val;
            if (teamColIndices[ci]) {
              val = (cell != null && String(cell).trim() !== '') ? '<a href="/team/' + encodeURIComponent(slugify(String(cell).trim())) + '" class="track-link">' + esc(String(cell).trim()) + '</a>' : emptyCell;
            } else if (driverColIndices[ci]) {
              var d = (cell != null && String(cell).trim() !== '') ? driverDisplayName(String(cell).trim()) : '';
              if (d && /^[^,]+\s*,\s*[^,]+$/.test(d)) {
                var parts = d.split(/\s*,\s*/);
                d = (parts[1] + ' ' + parts[0]).trim();
              }
              val = d ? '<a href="/driver/' + encodeURIComponent(slugify(d)) + '" class="track-link">' + esc(d) + '</a>' : emptyCell;
            } else if (driversColIndices[ci]) {
              var raw = (cell != null ? String(cell) : '').trim();
              val = raw ? String(raw).split(/\s*;\s*/).map(function (p) {
                var t = p.trim();
                if (!t) return '';
                var d = driverDisplayName(t);
                return '<a href="/driver/' + encodeURIComponent(slugify(d)) + '" class="track-link">' + esc(d) + '</a>';
              }).filter(Boolean).join('<br>') : emptyCell;
            } else {
              val = noteColIndices[ci]   ? localizeCellNote(cell)
                  : reasonColIndices[ci] ? localizeRaceReason(cell)
                  : noColIndices[ci]     ? stripNumberPrefix(String(cell != null ? cell : ''))
                  : cell;
            }
            var displayVal = (val == null || val === '' || (typeof val === 'string' && val.trim() === '')) ? emptyCell : val;
            var isHtml = typeof displayVal === 'string' && (displayVal.indexOf('<span') >= 0 || displayVal.indexOf('<a') >= 0);
            return '<td>' + (isHtml ? displayVal : esc(displayVal)) + '</td>';
          }).join('') + '</tr>';
        }).join('')
      : '<tr><td class="empty-row" colspan="' + Math.max(1, headers.length) + '">' + esc(t('error.no_section_data')) + '</td></tr>';
    var tbody = '<tbody>' + tbodyRows + '</tbody>';
    var titleCls = 'table-section-title' + (titleClass ? ' ' + titleClass : '');
    var titleBlock = (title ? '<h4 class="' + titleCls + '">' + esc(title) + '</h4>' : '');
    var subtitleBlock = (subtitle ? '<p class="table-section-subtitle">' + esc(subtitle) + '</p>' : '');
    var html = titleBlock + subtitleBlock +
      '<div class="table-wrap"><table class="' + cls + '">' + colgroup + thead + tbody + '</table></div>';
    return { html: html, rows: rows.slice(), getRowClass: getRowClass };
  }

  // Попытка заполнить заголовок события по данным расписания (если нет полного JSON события).
  // Работает в два шага:
  // 1) Пытаемся найти событие в уже загруженном глобальном кэше (Next Events / Schedule).
  // 2) Если там нет — лениво подтягиваем события серии с /api/series/{series}/events и ищем там.
  function applyScheduleHeaderFallback(apiEventId, titleEl, metaEl) {
    try {
      if (!apiEventId) return;
      var upperId = String(apiEventId).toUpperCase();
      var seriesIdFromEvent = typeof eventSeriesId === 'function' ? eventSeriesId(upperId) : (upperId.split('_')[0] || '');

      function fillFromEventLike(match) {
        if (!match) return;
        var name = match.name || match.race || match.id || apiEventId || '';
        if (titleEl && name && (!titleEl.textContent || titleEl.textContent === '—')) {
          titleEl.textContent = name;
        }
        if (!metaEl) return;
        if (metaEl.textContent && metaEl.textContent.trim()) return;

        var formatDateRangeLongFn = (window.TGA && window.TGA.formatDateRangeLong) || (typeof formatDateRangeLong === 'function' ? formatDateRangeLong : null);
        var localizeDateFn = (typeof localizeDate === 'function' ? localizeDate : (window.TGA && window.TGA.localizeDate)) || null;
        var startIso = (match.start_date || '').slice(0, 10) || (match.date || '').slice(0, 10);
        var endIso = (match.end_date || '').slice(0, 10);
        var datePart = '';
        if (startIso && endIso && startIso !== endIso && typeof formatDateRangeLongFn === 'function') {
          datePart = formatDateRangeLongFn(startIso, endIso);
        } else if (startIso) {
          datePart = typeof localizeDateFn === 'function' ? localizeDateFn(startIso) : startIso;
        } else if (match.date) {
          datePart = typeof localizeDateFn === 'function' ? localizeDateFn(match.date) : match.date;
        }
        var circuit = match.circuit_name || match.track || '';
        var location = match.location || '';
        if (circuit) {
          datePart += (datePart ? ' · ' : '') + circuit;
        }
        if (location) {
          var locTrim = String(location).trim();
          var circTrim = String(circuit).trim();
          // Не дублируем, если location совпадает с circuit_name/track или содержит его полностью.
          if (!circTrim ||
              (locTrim !== circTrim &&
               locTrim.indexOf(circTrim) === -1 &&
               circTrim.indexOf(locTrim) === -1)) {
            datePart += (datePart ? ', ' : '') + location;
          }
        }
        if (datePart) metaEl.textContent = datePart;
      }

      var getGlobalEventsCache = window.TGA && window.TGA.getGlobalEventsCache;
      var cache = getGlobalEventsCache ? getGlobalEventsCache() : null;
      if (Array.isArray(cache) && cache.length > 0) {
        var target = upperId;
        for (var i = 0; i < cache.length; i++) {
          var ev = cache[i];
          if ((ev && String(ev.id || '').toUpperCase()) === target) {
            fillFromEventLike(ev);
            return;
          }
        }
      }

      // Если глобальный кэш пуст (прямой заход по URL), пробуем подгрузить
      // события конкретной серии и взять заголовок оттуда.
      var fetchJSON = window.TGA && window.TGA.fetchJSON;
      if (!fetchJSON || !seriesIdFromEvent) return;
      var seriesSlug = seriesIdFromEvent.toLowerCase();
      fetchJSON('/api/series/' + encodeURIComponent(seriesSlug) + '/events')
        .then(function (events) {
          if (!Array.isArray(events)) return;
          var i;
          for (i = 0; i < events.length; i++) {
            var e = events[i];
            if ((e && String(e.id || '').toUpperCase()) === upperId) {
              fillFromEventLike(e);
              break;
            }
          }
        })
        .catch(function () {});
    } catch (e) {
      // Fallback must be safe; в случае ошибки просто ничего не делаем.
    }
  }

  function renderEventPage(eventId, section) {
    var loadGen = ++eventPageLoadGeneration;
    showView('view-event');
    loadedSeriesId = null;
    window.scrollTo(0, 0);
    var apiEventId = (eventId || '').toLowerCase().replace(/-/g, '_');
    var titleEl      = document.getElementById('event-title');
    var metaEl       = document.getElementById('event-meta');
    var crumbEl      = document.getElementById('event-breadcrumb');
    var sectionNavEl = document.getElementById('event-section-nav');
    var contentEl    = document.getElementById('event-content');
    titleEl.textContent = '—';
    metaEl.textContent  = '';
    if (crumbEl) {
      var sid0 = eventSeriesId(apiEventId);
      var seriesSlug0 = (sid0 || '').toLowerCase().replace(/_/g, '-');
      var seriesLabel0 = (sid0 || '').replace(/_/g, ' ');
      var evSlug0 = (eventId || '').toLowerCase();
      crumbEl.innerHTML =
        '<a href="/">' + t('breadcrumb.all') + '</a><span class="breadcrumb-sep">/</span>' +
        (sid0 ? '<a href="/series/' + encodeURIComponent(seriesSlug0) + '">' + esc(seriesLabel0) + '</a>' : '<span>' + esc(seriesLabel0 || '—') + '</span>') +
        '<span class="breadcrumb-sep">/</span>' +
        '<span>' + esc(evSlug0 || '—') + '</span>';
    }
    if (sectionNavEl) sectionNavEl.innerHTML = '';
    contentEl.innerHTML = '<p class="loading">' + t('loading') + '</p>';
    adjustEventPanelPadding();

    // Если полных данных события ещё нет, попробуем хотя бы подтянуть
    // название и дату из глобального расписания (Next Events / Schedule).
    applyScheduleHeaderFallback(apiEventId.toUpperCase(), titleEl, metaEl);

    function renderWithData(d) {
      var rawName = d.race || d.event_id || 'Event';
      var seriesIdForName = eventSeriesId(d.event_id || apiEventId);
      // Для F1: убираем префикс "F1 — " / "F1 - " из названия этапа.
      if (seriesIdForName && seriesIdForName.toUpperCase() === 'F1' && typeof rawName === 'string') {
        rawName = rawName.replace(/^F1\s*[—-]\s*/i, '');
      }
      var eventName   = rawName;
      var seriesId    = eventSeriesId(d.event_id || apiEventId);
      var seriesLabel = seriesId.replace(/_/g, ' ');

      // Обновляем класс категории на <body> для контекстных стилей (в т.ч. сток-кар таблиц на странице события)
      var bodyEl = document.body;
      if (bodyEl) {
        var seriesIdUpper = (seriesId || '').toUpperCase();
        var seriesIdLower = (seriesId || '').toLowerCase();
        bodyEl.classList.remove('cat-openwheel', 'cat-stockcar', 'cat-endurance', 'cat-touring');
        var catKey = categoryBySeriesId[seriesIdUpper];
        if (catKey) bodyEl.classList.add('cat-' + catKey);
        Array.from(bodyEl.classList).forEach(function (cls) {
          if (cls.indexOf('series-') === 0) bodyEl.classList.remove(cls);
        });
        if (seriesIdLower) bodyEl.classList.add('series-' + seriesIdLower);
      }
      var blockDef    = null;
      for (var bi = 0; bi < eventBlockDefs.length; bi++) {
        if (eventBlockDefs[bi].id === section) { blockDef = eventBlockDefs[bi]; break; }
      }
      var sectionLabel = blockDef ? t('block.' + blockDef.id) : '';
      titleEl.textContent = section ? sectionLabel : eventName;
      // На подразделах (Race, Entry list и т.д.) не дублируем название события — оно уже в хлебных крошках и title
      var datePart = '';
        if (section) {
          datePart = '';
        } else {
          var sessionRange = typeof getEventSessionDateRange === 'function' ? getEventSessionDateRange(d) : null;
          var startIso, endIso;
          if (sessionRange && sessionRange.minIso) {
            startIso = sessionRange.minIso;
            endIso = sessionRange.maxIso || startIso;
          } else {
            startIso = (d.start_date || '').slice(0, 10);
            endIso = (d.end_date || '').slice(0, 10);
          }
          if (startIso && endIso && startIso !== endIso && typeof formatDateRangeLong === 'function') {
            datePart = formatDateRangeLong(startIso, endIso);
          } else {
            datePart = startIso ? (typeof localizeDate === 'function' ? localizeDate(startIso) : startIso) : localizeDate(d.date || '');
          }
          if (d.track) datePart += ' · ' + d.track;
          if (d.location) datePart += ', ' + d.location;
        }
        metaEl.textContent = datePart;
      document.title = (section ? sectionLabel + ' — ' : '') + eventName + ' — The Grid Archive (TGA)';
      var eventSlugForUrl = (d.event_id || eventId || '').toLowerCase().replace(/_/g, '-');

      // Хлебные крошки: All series / F1 / (опционально F1 20XX) / Event / Section
      var crumb = '<a href="/">' + t('breadcrumb.all') + '</a><span class="breadcrumb-sep">/</span>' +
        '<a href="/series/' + encodeURIComponent((seriesId || '').toLowerCase().replace(/_/g, '-')) + '">' + esc(seriesLabel) + '</a>';

      // Для F1 пытаемся вытащить год сезона из event_id (F1_2025_1) или из slug в URL (f1-2025-1)
      var isF1Series = ((seriesId || '').toUpperCase() === 'F1');
      if (isF1Series) {
        var evIdRaw = String(d.event_id || eventId || '');
        var evIdUpper = evIdRaw.toUpperCase();
        var seasonYear = null;
        var mId = evIdUpper.match(/^F1_(\d{4})_/);
        if (mId && mId[1]) {
          seasonYear = mId[1];
        } else {
          var mSlug = evIdRaw.match(/f1-(\d{4})-/i);
          if (mSlug && mSlug[1]) seasonYear = mSlug[1];
        }
        if (seasonYear) {
          var seasonSlug = 'f1-' + seasonYear;
          crumb += '<span class="breadcrumb-sep">/</span>' +
            '<a href="/season/' + seasonSlug + '">F1 ' + seasonYear + '</a>';
        }
      }

      crumb += '<span class="breadcrumb-sep">/</span>';
      if (section) {
        crumb += '<a href="/event/' + encodeURIComponent(eventSlugForUrl) + '">' + esc(eventName) + '</a>' +
          '<span class="breadcrumb-sep">/</span><span>' + esc(sectionLabel) + '</span>';
      } else {
        crumb += '<span>' + esc(eventName) + '</span>';
      }
      crumbEl.innerHTML = crumb;

      // Section nav — только внутри подраздела
      if (sectionNavEl) {
        if (section) {
          var visibleBlocks = [];
          for (var bj = 0; bj < eventBlockDefs.length; bj++) {
            if (eventBlockDefs[bj].check(d)) visibleBlocks.push(eventBlockDefs[bj]);
          }
          var base = '/event/' + encodeURIComponent(eventSlugForUrl);
          sectionNavEl.innerHTML = visibleBlocks.map(function (b) {
            var active = section === b.id ? ' active' : '';
            return '<a href="' + base + '/' + b.id + '" class="nav-link' + active + '">' + esc(t('block.' + b.id)) + '</a>';
        }).join('');
        } else {
          sectionNavEl.innerHTML = '';
        }
      }

      if (section) {
        renderEventSectionContent(d, section, contentEl, apiEventId);
      } else {
        if (contentEl) contentEl.removeAttribute('data-event-section');
        renderEventOverviewContent(d, apiEventId, contentEl);
      }
      adjustEventPanelPadding();
    }

    // Если событие уже есть в кэше, сразу показываем его,
    // но всё равно запрашиваем свежие данные с сервера (кэш не должен скрывать правки JSON).
    if (eventCache[apiEventId]) {
      renderWithData(eventCache[apiEventId]);
    }

    function normalizeEventPayload(d) {
      if (!d || typeof d !== 'object') return d;
      if (d.data && typeof d.data === 'object') d = d.data;
      if (d.event && typeof d.event === 'object') d = d.event;
      if (Array.isArray(d) && d.length > 0) d = d[0];
      return d;
    }

    function hasDetailedEventPayload(d) {
      if (!d || typeof d !== 'object') return false;
      var tables = d.tables && typeof d.tables === 'object' ? d.tables : null;
      if (tables && Object.keys(tables).length > 0) return true;
      if (Array.isArray(d.entry_list) && d.entry_list.length > 0) return true;
      if (d.track_info && String(d.track_info).trim()) return true;
      if (d.track_info_ru && String(d.track_info_ru).trim()) return true;
      if (d.laps != null && String(d.laps).trim() !== '') return true;
      if (d.distance != null && String(d.distance).trim() !== '') return true;
      if (Array.isArray(d.youtube_highlights) && d.youtube_highlights.length > 0) return true;
      if (d.youtube_id && String(d.youtube_id).trim()) return true;
      if (d.highlights_url && String(d.highlights_url).trim()) return true;
      return false;
    }

    function fetchEventPayloadOnce() {
      return fetchJSON('/api/events/' + encodeURIComponent(apiEventId) + '?_=' + Date.now())
        .then(normalizeEventPayload);
    }

    fetchEventPayloadOnce()
      .then(function (d) {
        if (loadGen !== eventPageLoadGeneration) return null;
        if (!d || typeof d !== 'object') throw new Error('Invalid response');
        // Иногда при SPA-навигации прилетает краткий payload без tables.
        // Делаем второй запрос и предпочитаем более подробный ответ.
        if (!hasDetailedEventPayload(d)) {
          return fetchEventPayloadOnce()
            .then(function (d2) {
              if (loadGen !== eventPageLoadGeneration) return null;
              if (d2 && hasDetailedEventPayload(d2)) return d2;
              return d;
            })
            .catch(function () {
              return d;
            });
        }
        return d;
      })
      .then(function (d) {
        if (loadGen !== eventPageLoadGeneration || !d) return;
        eventCache[apiEventId] = d;
        try {
          renderWithData(d);
        } catch (err) {
          console.error('renderEventPage render error', err);
          contentEl.innerHTML = '<p class="empty-msg">' + (t('error.no_section_data') || 'Error displaying content') + '.</p>';
          adjustEventPanelPadding();
        }
      })
      .catch(function (err) {
        if (loadGen !== eventPageLoadGeneration) return;
        var msg = (err && err.message) ? String(err.message) : '';
        var isNotFound = msg === 'Not found' || msg.indexOf('404') >= 0;
        titleEl.textContent = isNotFound ? t('error.event_not_found') : '—';
        if (sectionNavEl) sectionNavEl.innerHTML = '';
        contentEl.innerHTML = '<p class="empty-msg">' + (isNotFound ? t('error.event_not_found') : (t('error.no_section_data') || 'Error loading event')) + '.</p>';
        adjustEventPanelPadding();
      });
  }

  function renderEventOverviewContent(d, eventId, contentEl) {
    if (!d || typeof d !== 'object') {
      contentEl.innerHTML = '<p class="empty-msg">' + t('error.no_section_data') + '</p>';
        return;
      }
    // Специальный случай: для IMSA 2026 Pre Season Test сразу показываем Pre‑Season Tests,
    // без плитки-блока на overview.
    var evKeyOverview = ((d.event_id || eventId || '') + '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_');
    var eventName = d.race || d.name || d.event_id || eventId || 'Event';
    var datePart = d.date || d.start_date || d.startDate || '';
    if (evKeyOverview === 'IMSA_2026_PRE_SEASON_TEST' || evKeyOverview === 'F1_2026_PRE_SEASON_TEST_1' || evKeyOverview === 'F1_2026_PRE_SEASON_TEST_2') {
      renderEventSectionContent(d, 'pre_season_tests', contentEl, null);
      return;
    }
    var html = '';
    try {
    var tablesOverview = (d && d.tables && typeof d.tables === 'object') ? d.tables
      : (d && d.Tables && typeof d.Tables === 'object') ? d.Tables
      : {};
    // Laps/Distance и блоки — для Supercars и IMSA таблицу Laps/Distance не показываем
    var infoItems = [];
    var seriesLc = (eventSeriesId(eventId) || '').toLowerCase();
    if (seriesLc !== 'supercars' && seriesLc !== 'imsa') {
      if (d.laps != null && d.laps !== '') infoItems.push([t('section.laps'), trimTrailingZeros(String(d.laps))]);
      if (d.distance != null && d.distance !== '') infoItems.push([t('section.distance'), localizeDistance(String(d.distance))]);
    }
    var visibleBlocks = [];
    for (var bi = 0; bi < eventBlockDefs.length; bi++) {
      if (eventBlockDefs[bi].check(d)) visibleBlocks.push(eventBlockDefs[bi]);
    }
    if (infoItems.length > 0 || visibleBlocks.length > 0) {
      html += '<div class="event-overview-laps-and-blocks">';
      if (infoItems.length > 0) {
        html += '<div class="table-wrap"><table class="data-table table-field-value"><thead><tr><th>' + t('th.field') + '</th><th>' + t('th.value') + '</th></tr></thead><tbody>' +
          infoItems.map(function (p) { return '<tr><td class="col-field">' + esc(dash(p[0])) + '</td><td>' + esc(dash(p[1])) + '</td></tr>'; }).join('') +
          '</tbody></table></div>';
      }
      if (visibleBlocks.length > 0) {
        var blocksClass = 'event-blocks ' + ((eventSeriesId(eventId) || '').toLowerCase() === 'supercars' ? 'event-blocks--row' : 'event-blocks--2x2');
        var evKeyBlocks = ((eventId || '') + '').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
        var blocksToShow = visibleBlocks;
        if (blocksToShow.length > 0) {
          html += '<div class="' + blocksClass + '">' +
            blocksToShow.map(function (b) {
              var blockLabel = t('block.' + b.id) || b.id;
              return '' +
                '<a href="/event/' + encodeURIComponent((eventId || '').toLowerCase().replace(/_/g, '-')) + '/' + b.id + '" class="event-block">' +
                  '<span class="event-block-label">' + esc(blockLabel) + '</span>' +
                '</a>';
            }).join('') + '</div>';
        }
      }
      html += '</div>';
    }

    // Track info — выбираем русскую версию если lang === 'ru' и она есть
    var trackInfoRu = (d.track_info_ru != null && typeof d.track_info_ru === 'string') ? d.track_info_ru.trim() : '';
    var trackInfoEn = (d.track_info != null && typeof d.track_info === 'string') ? d.track_info : '';
    var trackInfoText = (lang === 'ru' && trackInfoRu) ? trackInfoRu : trackInfoEn;
    if (trackInfoText && trackInfoText.length > 0) {
      var trackText = trackInfoText
        .replace(/\s*\[\d+\]\s*/g, ' ')
        .replace(/—/g, '-')
        .replace(/\s+/g, ' ')
        .trim();
      if (lang === 'ru' && !(d.track_info_ru && d.track_info_ru.trim())) {
        trackText = localizeTrackInfo(trackText);
      }
      html += '<h4 class="table-section-title">' + t('section.track_info') + '</h4><p class="track-info-text">' + esc(trackText) + '</p>';
    }
    if (d.tyre_compounds && typeof d.tyre_compounds === 'string' && d.tyre_compounds.trim()) {
      html += '<p class="track-info-text tyre-compounds-text">' + esc(d.tyre_compounds.trim()) + '</p>';
    }

    // Highlights — YouTube (предпочтительно) или внешняя ссылка.
    var highlightsList = Array.isArray(d.youtube_highlights) && d.youtube_highlights.length > 0
      ? d.youtube_highlights
      : (d.youtube_id && typeof d.youtube_id === 'string' && d.youtube_id.trim().length > 0)
        ? [{ id: d.youtube_id.trim(), title: t('section.highlights') }]
        : (d.highlights_url && typeof d.highlights_url === 'string' && d.highlights_url.trim().length > 0)
          ? [{ url: d.highlights_url.trim(), title: t('section.highlights') }]
          : [];
    if (highlightsList.length > 0) {
      var hasSingleRaceSession = false;
      if (tablesOverview && tablesOverview.race && Array.isArray(tablesOverview.race.sessions)) {
        hasSingleRaceSession = tablesOverview.race.sessions.length === 1;
      } else if (tablesOverview && tablesOverview.race_results &&
                 !tgaStageTable(tablesOverview, 1) && !tgaStageTable(tablesOverview, 2) && !tgaStageTable(tablesOverview, 3)) {
        hasSingleRaceSession = true;
      }
      var videoWrapCls = 'video-embed-wrap' + ((highlightsList.length === 1 && hasSingleRaceSession) ? ' video-embed-wrap--single' : '');
      html += '<div class="' + videoWrapCls + '">';
      if (highlightsList.length === 1) {
        html += '<h4 class="table-section-title">' + esc(highlightsList[0].title || t('section.highlights')) + '</h4>';
      } else {
        html += '<h4 class="table-section-title">' + t('section.highlights') + '</h4>';
      }
      highlightsList.forEach(function (item, idx) {
        var rawId = (item.id || item.youtube_id || '').toString().trim();
        var hasYoutubeId = rawId.length > 0;
        if (hasYoutubeId) {
          var yid = rawId.replace(/[^a-zA-Z0-9_\-]/g, '');
          if (!yid) return;
          // Подпись под превью убираем, если это единственное видео (заголовок уже есть сверху).
          var showLabel = (highlightsList.length > 1);
          var label = (showLabel && item.title)
            ? '<p class="video-facade-label">' + esc(item.title) + '</p>'
            : '';
          var thumbBase = 'https://img.youtube.com/vi/' + yid + '/';
          var thumbFallback = 'onerror="var s=this.src;if(s.indexOf(\'maxresdefault\')!==-1){this.src=s.replace(\'maxresdefault\',\'sddefault\');this.onerror=function(){this.src=s.replace(\'maxresdefault\',\'hqdefault\');this.onerror=null;};}else if(s.indexOf(\'sddefault\')!==-1){this.src=s.replace(\'sddefault\',\'hqdefault\');this.onerror=null;}"';
          html += '<div class="video-facade-wrap">' +
            '<div class="video-facade" data-ytid="' + yid + '">' +
              '<img src="' + thumbBase + 'maxresdefault.jpg" ' + thumbFallback + ' ' +
                'alt="' + esc(item.title || 'Highlights') + '" loading="lazy" decoding="async">' +
              '<button class="video-play-btn" aria-label="Play video"></button>' +
            '</div>' + label +
          '</div>';
        } else {
          // Внешний источник (например, официальное видео на formula1.com).
          var url = (item && (item.url || item.href || item.link)) || (d && d.highlights_url);
          if (!url) return;
          var extLabel = item.title || t('section.highlights') || 'Highlights';
          var thumbAttr = '';
          if (item.thumb) {
            var thumbUrl = String(item.thumb || '').trim();
            if (thumbUrl) {
              thumbAttr = '<img class="video-external-thumb" src="' + esc(thumbUrl) + '" alt="' + esc(extLabel) + '" loading="lazy" decoding="async">';
            }
          }
          html += '<div class="video-facade-wrap">' +
            '<a class="video-external-link" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' +
              thumbAttr +
              '<span class="video-external-label">' + esc(extLabel) + '</span>' +
            '</a>' +
          '</div>';
        }
      });
      html += '</div>';
    }

    // Fallback: если по какой-то причине список highlights пустой,
    // но в событии есть highlights_url, показываем простую внешнюю ссылку.
    if ((!highlightsList || highlightsList.length === 0) &&
        d.highlights_url && typeof d.highlights_url === 'string' &&
        d.highlights_url.trim().length > 0) {
      var hlUrl = d.highlights_url.trim();
      html += '<p class="track-info-text"><a class="video-external-inline-link" href="' +
        esc(hlUrl) + '" target="_blank" rel="noopener noreferrer">' +
        esc(t('section.highlights') || 'Highlights') + '</a></p>';
    }

    // Race statistics — одна и та же таблица (FIELD / VALUE, разбор по двоеточию) для всех серий
    var stats = getEventRaceStats(d);
    if (stats && Object.keys(stats).length > 0) {
      html += renderRaceStatsTable(stats);
    }

    if (infoItems.length === 0 && visibleBlocks.length === 0) {
      html += '<p class="empty-msg">' + t('error.no_data') + '</p>';
    }

    } catch (err) {
      console.error('renderEventOverviewContent', err);
      contentEl.innerHTML = '<p class="empty-msg">' + t('error.no_section_data') + '</p>';
      return;
    }

    contentEl.innerHTML = html || ('<p class="empty-msg">' + t('error.no_section_data') + '</p>');

    // Клик по превью — заменяем на iframe с autoplay
    var facades = contentEl.querySelectorAll('.video-facade');
    [].forEach.call(facades, function (facade) {
      facade.addEventListener('click', function () {
        var ytid = facade.dataset.ytid;
        if (!ytid) return;
        facade.style.cursor = 'default';
        facade.innerHTML = '<iframe src="https://www.youtube.com/embed/' + ytid +
          '?autoplay=1&rel=0" title="Race Highlights" ' +
          'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>';
      });
    });
  }

  // Session meta: горизонтальная таблица — Date, опционально Race day, Length, Session, Start
  function buildSessionMetaTable(meta) {
    if (!meta || typeof meta !== 'object') return '';
    var order = ['Date', 'Race day', 'Length', 'Session', 'Start'];
    var keys = order.filter(function (k) { return meta.hasOwnProperty(k) && meta[k] != null && String(meta[k]).trim() !== ''; });
    if (!keys.length) keys = Object.keys(meta).filter(function (k) { return k !== 'Championship' && meta[k] != null && String(meta[k]).trim() !== ''; });
    if (!keys.length) return '';
    var head = keys.map(function (k) { return '<th>' + esc(k) + '</th>'; }).join('');
    var vals = keys.map(function (k) { return '<td>' + esc(String(meta[k]).trim()) + '</td>'; }).join('');
    return '<h4 class="table-section-title">Session info</h4>' +
      '<div class="table-wrap event-pre-season-meta-wrap">' +
      '<table class="data-table table-field-value session-meta-table session-meta-table--horizontal">' +
      '<thead><tr>' + head + '</tr></thead><tbody><tr>' + vals + '</tr></tbody></table></div>';
  }

  function renderRaceContent(d, contentEl) {
    var tables = (d && d.tables && typeof d.tables === 'object') ? d.tables
      : (d && d.Tables && typeof d.Tables === 'object') ? d.Tables
      : {};
    var html = '';
    var sortQueue = [];

    var seriesId = eventSeriesId(d.event_id || '');
    var seriesIdLower = (seriesId || '').toLowerCase();
    var isSupercars = seriesIdLower === 'supercars';
    var isStockCarSeriesRace = ['nascar_cup', 'noaps', 'nascar_truck', 'arca', 'nascar_modified'].indexOf(seriesIdLower) >= 0;
    var evKeyEvent = ((d.event_id || '') + '').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
    var byNumber = (isStockCarSeriesRace && d.entry_list && d.entry_list.length)
      ? buildTeamNamesByNumberFromEntryList(d.entry_list)
      : (d.team_names_by_number && typeof d.team_names_by_number === 'object' ? d.team_names_by_number : null);
    function applyTeamNameByNumber(rows, numberColIdx, teamColIdx) {
      if (!byNumber) return rows;
      return rows.map(function (row) {
        var r = row.slice();
        if (r.length > Math.max(numberColIdx, teamColIdx) && r[numberColIdx] != null) {
          var num = String(r[numberColIdx]).trim();
          var teamFromTeams = byNumber[num] || byNumber[String(parseInt(num, 10))];
          if (teamFromTeams == null && num === '800') teamFromTeams = byNumber['8'];
          if (teamFromTeams != null) r[teamColIdx] = teamFromTeams;
        }
        return r;
      });
    }
    // Временно отключаем спец-колонки Grid/Pos (стрелочки) в гонках
    var enableGridDelta = false;

    // Карты стартовых позиций (Starting Grid) по гонкам Supercars: raceIndex -> { carNo -> gridPos }
    var supercarsGridByRace = {};
    if (isSupercars && tables && tables.starting_lineup) {
      var sl = tables.starting_lineup;
      function buildGridFromStartingSession(sess, raceIndex) {
        if (!sess || !Array.isArray(sess.rows)) return;
        var grid = {};
        (sess.rows || []).forEach(function (row, idx) {
          var num = String(row[1] || '').trim();
          var pos = parseInt(row[0], 10);
          if (!num) return;
          if (isNaN(pos)) pos = idx + 1;
          grid[num] = pos;
        });
        if (Object.keys(grid).length > 0) supercarsGridByRace[raceIndex] = grid;
      }
      if (Array.isArray(sl.sessions) && sl.sessions.length > 0) {
        sl.sessions.forEach(function (sess, idx) { buildGridFromStartingSession(sess, idx + 1); });
      } else {
        buildGridFromStartingSession(sl, 1);
      }
    }

    function renderOneRaceSession(sess, eventData) {
      var out = '';
      var titleText = sess && sess.title ? String(sess.title) : '';
      // Для всех F1‑этапов выводим человекочитаемые заголовки сессий.
      // "Sprint" → "Sprint Results", "Race" / "Race classification" → "Race Results" (без отдельного "Results").
      if (evKeyEvent && evKeyEvent.indexOf('F1_') === 0) {
        var baseTitle = titleText.trim();
        if (/^sprint$/i.test(baseTitle)) {
          titleText = 'Sprint Results';
        } else if (/^race$/i.test(baseTitle) || /^race\s+classification$/i.test(baseTitle)) {
          titleText = 'Race Results';
        }
      }
      if (titleText) out += '<h3 class="event-pre-season-title">' + esc(titleText) + '</h3>';
      if (sess.subtitle) out += '<p class="event-pre-season-subtitle">' + esc(sess.subtitle) + '</p>';
      if (evKeyEvent !== 'IMSA_2026_1' && evKeyEvent !== 'IMSA_2026_2') {
        out += buildSessionMetaTable(sess.meta);
      }
      if (sess.headers && Array.isArray(sess.rows)) {
        var h = sess.headers;
        var raceRows;
        var raceHeaders;

        if (isSupercars && Array.isArray(h) && h.length >= 8) {
          // Supercars: убираем колонку Stops, оставляем структуру Pos, No., Driver, Team, Race time, Laps, Pts
          raceRows = applyTeamNameByNumber((sess.rows || []), 1, 3).map(function (r) {
            // [Pos, No, Driver, Team, Race time, Laps, Pts]
            return [
              r[0],
              r[1],
              r[2],
              r[3],
              r[5],
              r[6],
              r[7]
            ];
          });
          raceHeaders = [
            h[0],   // Pos
            h[1],   // No.
            h[2],   // Driver
            h[3],   // Team
            h[5],   // Race time
            h[6],   // Laps
            h[7]    // Pts
          ];
        } else {
          // Остальные серии/гонки — только подстановка команды по номеру
          raceRows = applyTeamNameByNumber((sess.rows || []), 1, 3);
          raceHeaders = (sess.headers || []).slice();
          // IMSA: разделить TEAM/CAR/SPONSOR на TEAM и CAR, sponsor убрать
          if ((evKeyEvent === 'IMSA_2026_1' || evKeyEvent === 'IMSA_2026_2') && raceHeaders.length > 0) {
            var teamCarColIdx = -1;
            for (var hi = 0; hi < raceHeaders.length; hi++) {
              var hText = (raceHeaders[hi] || '').toLowerCase().trim();
              if (hText === 'team/car/sponsor' || hText.indexOf('team/car') === 0) {
                teamCarColIdx = hi;
                break;
              }
            }
            if (teamCarColIdx >= 0) {
              raceHeaders = raceHeaders.slice(0, teamCarColIdx).concat(['TEAM', 'CAR'], raceHeaders.slice(teamCarColIdx + 1));
              raceRows = raceRows.map(function (r) {
                var cell = r[teamCarColIdx] != null ? String(r[teamCarColIdx]) : '';
                var parts = cell.split(/\s*\/\s*/);
                var team = (parts[0] || '').trim();
                var car = (parts.slice(1, 2).join(' / ') || '').trim();
                return r.slice(0, teamCarColIdx).concat([team, car], r.slice(teamCarColIdx + 1));
              });
            }
            // IMSA: убрать столбец FASTEST LAP
            var fastestLapIdx = -1;
            for (var fl = 0; fl < raceHeaders.length; fl++) {
              if ((raceHeaders[fl] || '').toLowerCase().trim() === 'fastest lap') {
                fastestLapIdx = fl;
                break;
              }
            }
            if (fastestLapIdx >= 0) {
              raceHeaders = raceHeaders.slice(0, fastestLapIdx).concat(raceHeaders.slice(fastestLapIdx + 1));
              raceRows = raceRows.map(function (r) {
                return r.slice(0, fastestLapIdx).concat(r.slice(fastestLapIdx + 1));
              });
            }
            // IMSA: ST POS из квалификации (позиция в квали = стартовая позиция)
            if (eventData && eventData.tables && eventData.tables.qualifying && Array.isArray(eventData.tables.qualifying.rows) && eventData.tables.qualifying.rows.length > 0) {
              var qualRows = eventData.tables.qualifying.rows;
              var qualPosByCar = {};
              qualRows.forEach(function (qRow) {
                var carNo = qRow[1] != null ? String(qRow[1]).trim() : '';
                var pos = qRow[0] != null ? String(qRow[0]).trim() : '';
                if (carNo) qualPosByCar[carNo] = pos;
              });
              var stPosColIdx = -1;
              for (var si = 0; si < raceHeaders.length; si++) {
                if ((raceHeaders[si] || '').toUpperCase().trim() === 'ST POS') { stPosColIdx = si; break; }
              }
              if (stPosColIdx >= 0) {
                raceRows = raceRows.map(function (r) {
                  var row = r.slice();
                  var carNo = row[1] != null ? String(row[1]).trim() : '';
                  var startPos = qualPosByCar[carNo];
                  if (startPos != null && row.length > stPosColIdx) row[stPosColIdx] = startPos;
                  return row;
                });
              }
            }
            // IMSA: для CAR NO показываем классический заголовок номера машины
            for (var cn = 0; cn < raceHeaders.length; cn++) {
              if ((raceHeaders[cn] || '').toUpperCase().trim() === 'CAR NO') {
                raceHeaders = raceHeaders.slice();
                raceHeaders[cn] = '#';
                break;
              }
            }
            // IMSA: очки за гонку по позиции в классе (CLASS POS)
            // 1..30 => 350,320,300,280,260,250,240,230,220,210,200,190,180,170,160,150,140,130,120,110,100,90,80,70,60,50,40,30,20,10
            // 30+ => 10
            var classPosIdx = -1;
            var pointsIdx = -1;
            for (var ci = 0; ci < raceHeaders.length; ci++) {
              var ch = (raceHeaders[ci] || '').toUpperCase().trim();
              if (ch === 'CLASS POS') classPosIdx = ci;
              if (ch === 'POINTS') pointsIdx = ci;
            }
            if (classPosIdx >= 0) {
              if (pointsIdx < 0) {
                pointsIdx = raceHeaders.length;
                raceHeaders = raceHeaders.slice();
                raceHeaders.push('POINTS');
              }
              function racePointsByClassPos(classPos) {
                var n = parseInt(classPos, 10);
                if (isNaN(n) || n < 1) return 0;
                if (n === 1) return 350;
                if (n === 2) return 320;
                if (n === 3) return 300;
                if (n === 4) return 280;
                if (n === 5) return 260;
                if (n === 6) return 250;
                if (n === 7) return 240;
                if (n === 8) return 230;
                if (n === 9) return 220;
                if (n === 10) return 210;
                if (n === 11) return 200;
                if (n === 12) return 190;
                if (n === 13) return 180;
                if (n === 14) return 170;
                if (n === 15) return 160;
                if (n === 16) return 150;
                if (n === 17) return 140;
                if (n === 18) return 130;
                if (n === 19) return 120;
                if (n === 20) return 110;
                if (n === 21) return 100;
                if (n === 22) return 90;
                if (n === 23) return 80;
                if (n === 24) return 70;
                if (n === 25) return 60;
                if (n === 26) return 50;
                if (n === 27) return 40;
                if (n === 28) return 30;
                if (n === 29) return 20;
                return 10;
              }
              raceRows = raceRows.map(function (r) {
                var row = r.slice();
                while (row.length <= pointsIdx) row.push('');
                row[pointsIdx] = String(racePointsByClassPos(row[classPosIdx]));
                return row;
              });
            }
          }
        }

        // F1_2025_2 … F1_2025_11: добавляем колонки Laps Led и Best Lap прямо в таблицы результатов.
        // Одновременно нормализуем очки и круги лидирования: если пилот не набрал очков или не лидировал ни круга, показываем 0.
        if ((evKeyEvent === 'F1_2025_2' || evKeyEvent === 'F1_2025_3' || evKeyEvent === 'F1_2025_4' || evKeyEvent === 'F1_2025_5' || evKeyEvent === 'F1_2025_6' || evKeyEvent === 'F1_2025_7' || evKeyEvent === 'F1_2025_8' || evKeyEvent === 'F1_2025_9' || evKeyEvent === 'F1_2025_10' || evKeyEvent === 'F1_2025_11') && eventData && eventData.tables) {
          var isSprintSession = /^sprint/i.test(String(sess.title || ''));
          var lapsLedByDriver = {};
          var bestLapByNo = {};
          var ptsColIdx = -1;
          for (var pi = 0; pi < raceHeaders.length; pi++) {
            var ph = (raceHeaders[pi] || '').toLowerCase();
            if (ph.indexOf('pts') >= 0 || ph.indexOf('points') >= 0) {
              ptsColIdx = pi;
              break;
            }
          }

          // Laps led: спринт или гонка.
          if (isSprintSession && eventData.tables.laps_led_sprint && Array.isArray(eventData.tables.laps_led_sprint.rows)) {
            eventData.tables.laps_led_sprint.rows.forEach(function (row) {
              var drv = row[1] != null ? String(row[1]).trim() : '';
              var total = row[3] != null ? String(row[3]).trim() : '';
              if (drv && total) lapsLedByDriver[drv] = total;
            });
          } else if (!isSprintSession && eventData.tables.laps_led && Array.isArray(eventData.tables.laps_led.rows)) {
            eventData.tables.laps_led.rows.forEach(function (row) {
              var range = row[0] != null ? String(row[0]).trim() : '';
              var drv = row[1] != null ? String(row[1]).trim() : '';
              if (!drv || !range) return;
              var count = 0;
              var mRange = range.match(/^(\d+)\s*[\u2013\u2014\-]\s*(\d+)$/);
              if (mRange) {
                var a = parseInt(mRange[1], 10);
                var b = parseInt(mRange[2], 10);
                if (!isNaN(a) && !isNaN(b) && b >= a) count = (b - a + 1);
              } else if (/^\d+$/.test(range)) {
                count = 1;
              }
              if (count > 0) {
                lapsLedByDriver[drv] = (lapsLedByDriver[drv] || 0) + count;
              }
            });
          }

          // Особые случаи (круги лидирования только суммарно, без диапазонов в данных):
          // Монако 2025 (F1_2025_8), Испания 2025 (F1_2025_9), Канада 2025 (F1_2025_10), Австрия 2025 (F1_2025_11).
          if (!isSprintSession) {
            if (evKeyEvent === 'F1_2025_8') {
              lapsLedByDriver = {
                'Lando Norris': 42,
                'Charles Leclerc': 3,
                'Max Verstappen': 33
              };
            } else if (evKeyEvent === 'F1_2025_9') {
              lapsLedByDriver = {
                'Oscar Piastri': 60,
                'Max Verstappen': 6
              };
            } else if (evKeyEvent === 'F1_2025_10') {
              lapsLedByDriver = {
                'George Russell': 43,
                'Kimi Antonelli': 1,
                'Oscar Piastri': 5,
                'Lando Norris': 15,
                'Charles Leclerc': 6
              };
            } else if (evKeyEvent === 'F1_2025_11') {
              lapsLedByDriver = {
                'Lando Norris': 62,
                'Oscar Piastri': 7,
                'Lewis Hamilton': 1
              };
            }
          }

          // Fastest laps.
          if (isSprintSession && eventData.tables.best_laps_sprint && Array.isArray(eventData.tables.best_laps_sprint.rows)) {
            eventData.tables.best_laps_sprint.rows.forEach(function (row) {
              var no = row[1] != null ? String(row[1]).trim() : '';
              var time = row[6] != null ? String(row[6]).trim() : '';
              if (no && time) bestLapByNo[no] = time;
            });
          } else if (!isSprintSession && eventData.tables.best_laps && Array.isArray(eventData.tables.best_laps.rows)) {
            eventData.tables.best_laps.rows.forEach(function (row) {
              var no = row[1] != null ? String(row[1]).trim() : '';
              var time = row[6] != null ? String(row[6]).trim() : '';
              if (no && time) bestLapByNo[no] = time;
            });
          }

          // Расширяем заголовки и строки.
          if (ptsColIdx >= 0) {
            // Для F1_2025_2 и F1_2025_3 вставляем Laps Led и Best Lap ПЕРЕД колонкой Pts.,
            // чтобы порядок совпадал с шаблоном F1_2025_1: ... Grid, Laps Led, Best Lap, Pts.
            var newHeaders = [];
            for (var hi2 = 0; hi2 < raceHeaders.length; hi2++) {
              if (hi2 === ptsColIdx) {
                newHeaders.push('Laps Led', 'Best Lap', raceHeaders[hi2]);
              } else {
                newHeaders.push(raceHeaders[hi2]);
              }
            }
            raceHeaders = newHeaders;
            raceRows = raceRows.map(function (r) {
              var baseRow = r.slice();
              var drv = baseRow[2] != null ? String(baseRow[2]).trim() : '';
              var no = baseRow[1] != null ? String(baseRow[1]).trim() : '';
              var posRaw = baseRow[0] != null ? String(baseRow[0]).trim() : '';
              var lapsRaw = baseRow[4] != null ? String(baseRow[4]).trim() : '';
              var lapsVal = lapsLedByDriver[drv];
              var bestVal = bestLapByNo[no];
              // Для DNS/0‑кругов не показываем лучший круг,
              // даже если он есть в таблице fastest laps.
              var isDns = /^dns/i.test(posRaw);
              var lapsNum = parseInt(lapsRaw, 10);
              if (isNaN(lapsNum)) lapsNum = null;
              if (isDns || lapsNum === 0) bestVal = '';
              var out = [];
              for (var ci2 = 0; ci2 < baseRow.length; ci2++) {
                if (ci2 === ptsColIdx) {
                  // Перед очками добавляем Laps Led и Best Lap.
                  var lapsCell = lapsVal != null ? String(lapsVal) : '0';
                  out.push(lapsCell);
                  out.push(bestVal || '');
                  // Нормализуем очки — если пусто, показываем 0.
                  var rawPts3 = baseRow[ci2];
                  if (rawPts3 == null || String(rawPts3).trim() === '') rawPts3 = '0';
                  out.push(rawPts3);
                } else {
                  out.push(baseRow[ci2]);
                }
              }
              return out;
            });
          } else {
            // Если по каким-то причинам колонка Pts. не найдена — добавляем Laps Led и Best Lap в конец.
            raceHeaders = raceHeaders.slice();
            raceHeaders.push('Laps Led', 'Best Lap');
            raceRows = raceRows.map(function (r) {
              var row = r.slice();
              var drv = row[2] != null ? String(row[2]).trim() : '';
              var no = row[1] != null ? String(row[1]).trim() : '';
              var lapsVal = lapsLedByDriver[drv];
              var bestVal = bestLapByNo[no];
              // Если очков нет или пусто — показываем 0.
              if (ptsColIdx >= 0 && ptsColIdx < row.length) {
                var rawPts = row[ptsColIdx];
                if (rawPts == null || String(rawPts).trim() === '') row[ptsColIdx] = '0';
              }
              // Если пилот не лидировал ни круга — показываем 0.
              var lapsCell2 = lapsVal != null ? String(lapsVal) : '0';
              row.push(lapsCell2);
              row.push(bestVal || '');
              return row;
            });
          }
        }

        // Для всех этапов F1: пустые очки и круги лидирования в таблице гонки показываем как 0.
        if (evKeyEvent && evKeyEvent.indexOf('F1_') === 0 && Array.isArray(raceHeaders) && Array.isArray(raceRows)) {
          var ptsIdx = -1;
          var lapsLedIdx = -1;
          for (var ni = 0; ni < raceHeaders.length; ni++) {
            var nh = String(raceHeaders[ni] || '').toLowerCase();
            if (nh.indexOf('pts') >= 0 || nh.indexOf('points') >= 0) ptsIdx = ni;
            if (nh.indexOf('laps led') >= 0) lapsLedIdx = ni;
          }
          if (ptsIdx >= 0 || lapsLedIdx >= 0) {
            raceRows = raceRows.map(function (row) {
              var r = row.slice();
              if (ptsIdx >= 0 && ptsIdx < r.length && (r[ptsIdx] == null || String(r[ptsIdx]).trim() === '')) r[ptsIdx] = '0';
              if (lapsLedIdx >= 0 && lapsLedIdx < r.length && (r[lapsLedIdx] == null || String(r[lapsLedIdx]).trim() === '')) r[lapsLedIdx] = '0';
              return r;
            });
          }
        }

        // Для всех этапов F1 отдельный заголовок "Results" не показываем (он уже в title сессии).
        if (!evKeyEvent || evKeyEvent.indexOf('F1_') !== 0) {
          out += '<h4 class="table-section-title">Results</h4>';
        }
        var raceTbl = { headers: raceHeaders, rows: raceRows };
        var raceResult = buildTableSection(null, raceTbl, 'pre-season-results-table race-session-results-table', null);
        if (raceResult) { out += raceResult.html; sortQueue.push({ rows: raceResult.rows, getRowClass: raceResult.getRowClass }); }
      }
      return out;
    }

    var stagePointsWidths = ['4%', '4%', '22%', '34%', '16%', '10%'];
    var stageNotesWidths  = ['4%', '4%', '22%', '34%', '14%', '22%'];
    var raceResultsWidths8  = ['5%', '5%', '4%', '22%', '36%', '14%', '8%', '8%'];
    var raceResultsWidths10 = ['6%', '6%', '4%', '18%', '24%', '10%', '6%', '6%', '12%', '6%'];

    function add(title, data, cssClass, getRowClass, colWidths, subtitle, titleClass, mergeTeamCells) {
      var r = buildTableSection(title, data, cssClass, getRowClass, colWidths, subtitle, titleClass, mergeTeamCells);
      if (!r) return;
      html += r.html;
      sortQueue.push(r);
    }

    var slSessions = (tables.starting_lineup && Array.isArray(tables.starting_lineup.sessions)) ? tables.starting_lineup.sessions : [];
    var slFlat = tables.starting_lineup && tables.starting_lineup.headers && Array.isArray(tables.starting_lineup.rows) && tables.starting_lineup.rows.length > 0;

    var raceBlock = tables.race;
    var penaltiesAndVscAddedAfterSprint = false;
    if (raceBlock && Array.isArray(raceBlock.sessions) && raceBlock.sessions.length > 0) {
      html += '<div class="event-pre-season-block">';
      raceBlock.sessions.forEach(function (sess, idx) {
        if (idx > 0) html += '<hr class="event-pre-season-divider">';
        // Starting Grid N перед Race N
        var slSess = slSessions[idx];
        if (slSess && slSess.headers && Array.isArray(slSess.rows) && slSess.rows.length > 0) {
          var raceNo = slSess.meta && slSess.meta.race_no != null ? slSess.meta.race_no : idx + 1;
          var slTitle = t('table.starting_lineup') + ' — Race ' + raceNo;
          var slRows = applyTeamNameByNumber(slSess.rows.slice(), 1, 3);
          add(slTitle, { headers: slSess.headers, rows: slRows }, 'race-starting-lineup-table', null, null, null, null, false);
        }
        html += renderOneRaceSession(sess, d);
        // Таблицы штрафов и нейтрализации — ровно под итоговой таблицей спринта.
        var sessTitleLc = (sess && sess.title && String(sess.title).toLowerCase().trim()) || '';
        if (sessTitleLc.indexOf('sprint') >= 0) {
          // Для спринта сначала пробуем использовать отдельные таблицы *_sprint.
          var sprintPenaltiesTable       = tables.penalties_sprint || null;
          var sprintPenaltiesAfterTable  = tables.penalties_sprint_after || null;
          var sprintVscTable             = tables.vsc_sprint || null;
          var usedSprintSpecificTables   = sprintPenaltiesTable || sprintPenaltiesAfterTable || sprintVscTable;

          if (sprintPenaltiesTable && sprintPenaltiesTable.rows && sprintPenaltiesTable.rows.length > 0) {
            add((typeof t === 'function' && t('table.penalties')) ? t('table.penalties') : 'Penalties during the race', sprintPenaltiesTable, 'penalties-table', null, null, null, null, false);
          }
          if (sprintPenaltiesAfterTable && sprintPenaltiesAfterTable.rows && sprintPenaltiesAfterTable.rows.length > 0) {
            add('Penalties added after the chequered flag', sprintPenaltiesAfterTable, 'penalties-table penalties-table--after', null, null, null, null, false);
          }
          if (sprintVscTable && sprintVscTable.rows && sprintVscTable.rows.length > 0) {
            var vscSprintTitle = (sprintVscTable.title && String(sprintVscTable.title).trim())
              ? sprintVscTable.title
              : ((typeof t === 'function' && t('table.vsc')) ? t('table.vsc') : 'Race neutralisation');
            add(vscSprintTitle, { headers: sprintVscTable.headers || ['Type', 'Laps'], rows: sprintVscTable.rows }, 'vsc-table', null, null, null, null, false);
          }

          // Если спринтовых таблиц нет, по‑прежнему используем общие penalties / penalties_after / vsc
          // и помечаем, что они уже выведены, чтобы не дублировать их под Race Results.
          if (!usedSprintSpecificTables) {
            if (tables.penalties && tables.penalties.headers && tables.penalties.rows && tables.penalties.rows.length > 0) {
              add((typeof t === 'function' && t('table.penalties')) ? t('table.penalties') : 'Penalties during the race', tables.penalties, 'penalties-table', null, null, null, null, false);
            }
            if (tables.penalties_after && tables.penalties_after.rows && tables.penalties_after.rows.length > 0) {
              add('Penalties added after the chequered flag', tables.penalties_after, 'penalties-table penalties-table--after', null, null, null, null, false);
            }
            if (tables.vsc && tables.vsc.rows && tables.vsc.rows.length > 0) {
              var vscTitleSprint = (tables.vsc.title && String(tables.vsc.title).trim()) ? tables.vsc.title : ((typeof t === 'function' && t('table.vsc')) ? t('table.vsc') : 'Race neutralisation');
              add(vscTitleSprint, tables.vsc, 'vsc-table', null, null, null, null, false);
            }
            penaltiesAndVscAddedAfterSprint = true;
          }
        }
      });
      // Решётки без гонки (например Starting Grid 7, если результатов Race 7 ещё нет)
      for (var j = raceBlock.sessions.length; j < slSessions.length; j++) {
        var slSess = slSessions[j];
        if (slSess && slSess.headers && Array.isArray(slSess.rows) && slSess.rows.length > 0) {
          html += '<hr class="event-pre-season-divider">';
          var raceNo = slSess.meta && slSess.meta.race_no != null ? slSess.meta.race_no : j + 1;
          var slTitle = t('table.starting_lineup') + ' — Race ' + raceNo;
          var slRows = applyTeamNameByNumber(slSess.rows.slice(), 1, 3);
          add(slTitle, { headers: slSess.headers, rows: slRows }, 'race-starting-lineup-table', null, null, null, null, false);
        }
      }
      html += '</div>';
    } else if (raceBlock && (raceBlock.title || raceBlock.meta) && raceBlock.headers && Array.isArray(raceBlock.rows)) {
      html += '<div class="event-pre-season-block">';
      if (slFlat) {
        var slRows = applyTeamNameByNumber(tables.starting_lineup.rows.slice(), 1, 3);
        function isStartingLineupSeparator(row) {
          if (!row || row.length === 0) return false;
          if (row[0] == null || String(row[0]).trim() === '') return false;
          for (var i = 1; i < row.length; i++) { if (row[i] != null && String(row[i]).trim() !== '') return false; }
          return true;
        }
        var segments = [], separatorTexts = [], cur = [];
        slRows.forEach(function (row) {
          if (isStartingLineupSeparator(row)) {
            if (cur.length) { segments.push(cur); cur = []; }
            separatorTexts.push(String(row[0]).trim());
          } else { cur.push(row); }
        });
        if (cur.length) segments.push(cur);
        var slHeaders = tables.starting_lineup.headers;
        var timeColIdx = -1;
        for (var hi = 0; hi < slHeaders.length; hi++) {
          if (String(slHeaders[hi] || '').trim().toLowerCase() === 'time') { timeColIdx = hi; break; }
        }
        var slHeadersUse = timeColIdx >= 0 ? slHeaders.slice(0, timeColIdx).concat(slHeaders.slice(timeColIdx + 1)) : slHeaders;
        function dropTimeCol(rows) {
          if (timeColIdx < 0) return rows;
          return rows.map(function (row) { return row.slice(0, timeColIdx).concat(row.slice(timeColIdx + 1)); });
        }
        segments.forEach(function (seg, i) {
          if (i > 0 && separatorTexts[i - 1]) html += '<p class="race-starting-lineup-separator">' + esc(separatorTexts[i - 1]) + '</p>';
          add(i === 0 ? t('table.starting_lineup') : '', { headers: slHeadersUse, rows: dropTimeCol(seg) }, 'race-starting-lineup-table', null, null, null, null, false);
        });
      }
      html += renderOneRaceSession(raceBlock, d);
      html += '</div>';
    }

    // Для сток-кар серий не задаём фиксированные colWidths, чтобы ширина подбиралась автоматически.
    // Полная таблица race_results показывается до очковых стейджей (логичный порядок: итог гонки → разбивка по стейджам).
    var raceResultsFirstStock = isStockCarSeriesRace && tables.race_results && Array.isArray(tables.race_results.rows) && tables.race_results.rows.length > 0;

    function appendRaceResultsBlock() {
      var rr = tables.race_results;
      if (rr && rr.rows) {
        var statKeysForFilter = ['Statistic', 'Value', 'Lead changes', 'Cautions / Laps', 'Red flags', 'Time of race', 'Average speed'];
        rr = {
          headers: rr.headers,
          rows: rr.rows.filter(function (row) {
            var p = parseStatRow(row);
            if (!p || !p.key) return true;
            var nk = p.key.replace(/\s*\/\s*/g, ' / ').trim();
            return statKeysForFilter.indexOf(nk) < 0;
          })
        };
        // Для всех F1‑этапов нормализуем пустые очки и круги лидирования
        // в таблице race_results: показываем 0 вместо пустой ячейки.
        var isF1SeriesForResults = (evKeyEvent && evKeyEvent.indexOf('F1_') === 0);
        if (isF1SeriesForResults && Array.isArray(rr.headers) && Array.isArray(rr.rows)) {
          var ptsColIdxRr = -1;
          var lapsLedColIdxRr = -1;
          for (var hri = 0; hri < rr.headers.length; hri++) {
            var hh = String(rr.headers[hri] || '').toLowerCase();
            if (hh.indexOf('pts') >= 0 || hh.indexOf('points') >= 0) ptsColIdxRr = hri;
            if (hh.indexOf('laps led') >= 0) lapsLedColIdxRr = hri;
          }
          if (ptsColIdxRr >= 0 || lapsLedColIdxRr >= 0) {
            rr = {
              headers: rr.headers,
              rows: rr.rows.map(function (row) {
                var r = row.slice();
                if (ptsColIdxRr >= 0 && ptsColIdxRr < r.length) {
                  var rawPts = r[ptsColIdxRr];
                  if (rawPts == null || String(rawPts).trim() === '') r[ptsColIdxRr] = '0';
                }
                if (lapsLedColIdxRr >= 0 && lapsLedColIdxRr < r.length) {
                  var rawLapsLed = r[lapsLedColIdxRr];
                  if (rawLapsLed == null || String(rawLapsLed).trim() === '') r[lapsLedColIdxRr] = '0';
                }
                return r;
              })
            };
          }
        }
      }
      // Не задаём colWidths для race_results — ширина ячеек подбирается автоматически (auto),
      // кроме этапов Formula 1, где нужна фиксированная сетка колонок как на шаблоне.
      var raceResultsSubtitle = (d.stage3_laps ? t('table.stage3') + ' (' + d.stage3_laps + ' ' + t('stage.laps') + ')' : null);
      if (isStockCarSeriesRace) raceResultsSubtitle = null;
      var raceResultsColWidths = null;
      // Для всех F1‑этапов, у которых таблица результатов гонки имеет 10 колонок
      // (Pos | No. | Driver | Team/Constructor | Laps | Time | Grid | Laps Led | Best Lap | Pts/Points),
      // используем единую фиксированную раскладку, как на шаблоне Australian GP 2026.
      var isF1SeriesForResults2 = (evKeyEvent && evKeyEvent.indexOf('F1_') === 0);
      if (isF1SeriesForResults2 && rr && Array.isArray(rr.headers) && rr.headers.length === 10) {
        raceResultsColWidths = raceResultsWidths10;
      }
      // Для большинства F1‑этапов заголовок "Race Results" уже есть выше (в renderOneRaceSession),
      // поэтому внутри секции гонки не дублируем подпись "Results" у таблицы.
      // Исключение: исторические сезоны F1 (например F1_2025_1), где хотим явно показать заголовок.
      var raceResultsTitle;
      if (isF1SeriesForResults2) {
        // Для исторических сезонов 2025 и отдельных этапов (например, China 2026)
        // явно показываем заголовок "Race Results".
        if (evKeyEvent &&
            (evKeyEvent.indexOf('F1_2025_') === 0 ||
             evKeyEvent === 'F1_2026_2' ||
             evKeyEvent === 'F1_2026_1' ||
             evKeyEvent === 'F1_2026_3')) {
          raceResultsTitle = (typeof t === 'function' && t('table.race_results')) ? t('table.race_results') : 'Race Results';
        } else {
          raceResultsTitle = '';
          raceResultsSubtitle = null;
        }
      } else if (raceResultsFirstStock) {
        raceResultsTitle = d.stage3_laps ? t('table.stage3') + ' (' + d.stage3_laps + ' ' + t('stage.laps') + ')' : '';
        raceResultsSubtitle = null;
      } else {
        raceResultsTitle = (typeof t === 'function' && t('table.race_results')) ? t('table.race_results') : 'Race Results';
      }
      var raceResultsTitleClass = null;
      if (raceResultsSubtitle) {
        raceResultsTitleClass = 'table-section-title--main';
      }
      // F1: единый крупный заголовок «Race Results» (как Sprint/Race в Китае 2026)
      // для всех этапов, где заголовок выводится явно.
      if (isF1SeriesForResults2 && raceResultsTitle) {
        raceResultsTitleClass = 'table-section-title--starting-grid';
      }
      add(raceResultsTitle, rr, 'race-results-table', null, raceResultsColWidths, raceResultsSubtitle, raceResultsTitleClass, false);
      if (d.race_results_note) {
        html += esc(String(d.race_results_note || '').trim());
      }
    }

    if (raceResultsFirstStock) {
      html += '<h4 class="table-section-title table-section-title--main">' + esc((typeof t === 'function' && t('table.race_results')) ? t('table.race_results') : 'Race Results') + '</h4>';
    }

    var stageWidthsForUse = isStockCarSeriesRace ? null : stagePointsWidths;
    add((d.stage1_laps ? t('table.stage1') + ' (' + d.stage1_laps + ' ' + t('stage.laps') + ')' : t('table.stage1')), tgaStageTable(tables, 1), 'race-stage-table race-stage-table--points', null, stageWidthsForUse, null, null, false);
    add((d.stage2_laps ? t('table.stage2') + ' (' + d.stage2_laps + ' ' + t('stage.laps') + ')' : t('table.stage2')), tgaStageTable(tables, 2), 'race-stage-table race-stage-table--points', null, stageWidthsForUse, null, null, false);
    var stage3TitleDefault = (d.stage3_laps ? t('table.stage3') + ' (' + d.stage3_laps + ' ' + t('stage.laps') + ')' : t('table.stage3'));
    var stage3Title = stage3TitleDefault;
    if (isStockCarSeriesRace && tgaStageTable(tables, 3) && !tables.race_results) {
      stage3Title = (d.stage3_laps ? t('table.race_results') + ' (' + d.stage3_laps + ' ' + t('stage.laps') + ')' : t('table.race_results'));
    }
    add(stage3Title, tgaStageTable(tables, 3), 'race-stage-table race-stage-table--points', null, stageWidthsForUse, null, null, false);

    appendRaceResultsBlock();
      // Laps led / Best laps как отдельные таблицы показываем только для событий,
      // отличных от F1_2025_1 … F1_2025_11 (для этих F1‑гонок они встроены в таблицу результатов).
      // Дополнительно скрываем отдельную таблицу Laps Led для F1_2026_1 (Australian GP 2026)
      // и F1_2026_2 (Chinese GP 2026), где круги лидирования уже встроены/не нужны отдельно.
      if (evKeyEvent !== 'F1_2025_1' && evKeyEvent !== 'F1_2025_2' && evKeyEvent !== 'F1_2025_3' && evKeyEvent !== 'F1_2025_4' && evKeyEvent !== 'F1_2025_5' && evKeyEvent !== 'F1_2025_6' && evKeyEvent !== 'F1_2025_7' && evKeyEvent !== 'F1_2025_8' && evKeyEvent !== 'F1_2025_9' && evKeyEvent !== 'F1_2025_10' && evKeyEvent !== 'F1_2025_11' && evKeyEvent !== 'F1_2025_12' && evKeyEvent !== 'F1_2025_14' && evKeyEvent !== 'F1_2025_16' && evKeyEvent !== 'F1_2025_18' && evKeyEvent !== 'F1_2025_19' && evKeyEvent !== 'F1_2025_20' && evKeyEvent !== 'F1_2026_1' && evKeyEvent !== 'F1_2026_2' && evKeyEvent !== 'F1_2026_3') {
      if (tables.laps_led && tables.laps_led.rows && tables.laps_led.rows.length > 0) {
        add((typeof t === 'function' && t('table.laps_led')) ? t('table.laps_led') : 'Laps Led', tables.laps_led, 'laps-led-table', null, null, null, null, false);
      }
      // Fastest laps tables: sprint and/or race, if present.
      if (tables.best_laps_sprint && tables.best_laps_sprint.rows && tables.best_laps_sprint.rows.length > 0) {
        add('Sprint — ' + ((typeof t === 'function' && t('table.best_laps')) ? t('table.best_laps') : 'Best Laps'), tables.best_laps_sprint, 'best-laps-table', null, null, null, null, false);
      }
      if (tables.best_laps && tables.best_laps.rows && tables.best_laps.rows.length > 0) {
        add((typeof t === 'function' && t('table.best_laps')) ? t('table.best_laps') : 'Best Laps', tables.best_laps, 'best-laps-table', null, null, null, null, false);
      }
    }
    if (!penaltiesAndVscAddedAfterSprint) {
      if (tables.penalties) {
        var penaltiesTitle;
        if (evKeyEvent === 'F1_2025_2') {
          penaltiesTitle = 'Penalties added after the chequered flag';
        } else {
          penaltiesTitle = (typeof t === 'function' && t('table.penalties')) ? t('table.penalties') : 'Penalties during the race';
        }
        add(penaltiesTitle, tables.penalties, 'penalties-table', null, null, null, null, false);
      }
      if (tables.penalties_after && tables.penalties_after.rows && tables.penalties_after.rows.length > 0) {
        var penaltiesAfterTitle = 'Penalties added after the chequered flag';
        add(penaltiesAfterTitle, tables.penalties_after, 'penalties-table penalties-table--after', null, null, null, null, false);
      }
      if (tables.vsc) {
        var vscTitle = (tables.vsc.title && String(tables.vsc.title).trim()) ? tables.vsc.title : ((typeof t === 'function' && t('table.vsc')) ? t('table.vsc') : 'Race neutralisation');
        add(vscTitle, tables.vsc, 'vsc-table', null, null, null, null, false);
      }
    }
    if (tables.pit_stops) {
      var ps = tables.pit_stops;
      var psTitle = (ps.title && String(ps.title).trim())
        ? ps.title
        : ((typeof t === 'function' && t('table.pit_stops')) ? t('table.pit_stops') : 'PIT STOPS');
      var psRows = ps.rows || [];
      function parseStint(str) {
        if (!str || typeof str !== 'string') return null;
        str = str.trim();
        function mapCompound(code) {
          code = String(code || '').toUpperCase();
          if (code === 'C2') return 'H';
          if (code === 'C4') return 'M';
          if (code === 'C5') return 'S';
          if (code === 'C1') return 'H';
          if (code === 'C3') return 'M';
          if (code === 'C6') return 'S';
          return code.charAt(0);
        }
        var m = str.match(/^((?:C[1-6])|[HMSIW])(?:[NU])?\s*(\d+)\s*[\u2013\u2014\-]\s*(\d+)$/i);
        if (m) return { compound: mapCompound(m[1]), from: parseInt(m[2], 10), to: parseInt(m[3], 10) };
        var single = str.match(/^((?:C[1-6])|[HMSIW])(?:[NU])?\s*(\d+)$/i);
        if (single) {
          var n = parseInt(single[2], 10);
          return { compound: mapCompound(single[1]), from: n, to: n };
        }
        if (/^((?:C[1-6])|[HMSIW])(?:[NU])?\s*0\s*\(DNS\)/i.test(str)) return { compound: mapCompound(RegExp.$1), from: 0, to: 0 };
        return null;
      }
      // Максимальное число кругов для нормировки ширины бара.
      // Если у события указан total laps — используем его, иначе запасом 58.
      var maxLaps = 58;
      if (d && d.laps != null && String(d.laps).trim() !== '') {
        var lapsInt = parseInt(String(d.laps).trim(), 10);
        if (!isNaN(lapsInt) && lapsInt > 0) maxLaps = lapsInt;
      }
      html += '<div class="pit-stops-chart-wrap">';
      html += (psTitle ? '<h4 class="pit-stops-chart-title">' + esc(psTitle) + '</h4>' : '');
      html += '<div class="pit-stops-chart">';
      var totalPitStops = 0;
      var usedCompounds = {};
      psRows.forEach(function (row) {
        var driver = (row[0] != null ? String(row[0]) : '').trim();
        var totalLaps = parseInt(row[6], 10) || 0;
        var stints = [];
        for (var s = 1; s <= 5; s++) {
          var seg = parseStint(row[s]);
          if (seg) {
            stints.push(seg);
            usedCompounds[seg.compound] = true;
          }
        }
        if (stints.length === 0 && totalLaps === 0 && row[1]) {
          var first = String(row[1]).trim();
          if (first) {
            var comp = first.charAt(0).toUpperCase();
            stints.push({ compound: comp, from: 0, to: 0 });
            usedCompounds[comp] = true;
          }
        }
        // Пустой сегмент до maxLaps — чтобы правый край бара у всех был на одной вертикали.
        if (totalLaps > 0 && totalLaps < maxLaps) {
          stints.push({ compound: '_', from: totalLaps + 1, to: maxLaps });
        }
        // Подсчёт количества пит-стопов: число стинтов минус один (игнорируя DNS).
        var nonDnsStints = stints.filter(function (seg) {
          return !(totalLaps === 0 && seg.from === 0 && seg.to === 0);
        });
        if (nonDnsStints.length > 1) {
          totalPitStops += (nonDnsStints.length - 1);
        }

        // Бар одной ширины (100% wrap) при totalLaps > 0, чтобы правый край был ровно.
        var barStyle = totalLaps > 0
          ? 'width: 100%;'
          : 'width: 20px; min-width: 20px;';
        html += '<div class="pit-stops-chart-row">';
        html += '<span class="pit-stops-chart-driver">' + esc(driver.toUpperCase()) + '</span>';
        html += '<div class="pit-stops-chart-bar-wrap"><div class="pit-stops-chart-bar pit-stops-chart-bar--overlay" style="' + barStyle + '">';
        stints.forEach(function (seg, i) {
          var laps = seg.to - seg.from + 1;
          var isDns = totalLaps === 0 && seg.to === 0 && seg.from === 0;
          var isEmpty = seg.compound === '_';
          var cls = 'pit-stops-seg';
          if (isEmpty) cls += ' pit-stops-seg-empty';
          else if (seg.compound === 'H') cls += ' pit-stops-seg-hard';
          else if (seg.compound === 'M') cls += ' pit-stops-seg-medium';
          else if (seg.compound === 'S') cls += ' pit-stops-seg-soft';
          else if (seg.compound === 'I') cls += ' pit-stops-seg-intermediate';
          else if (seg.compound === 'W') cls += ' pit-stops-seg-wet';
          if (isDns) cls += ' pit-stops-seg-dns';
          var segStyle;
          if (isDns) {
            segStyle = 'width:20px;min-width:20px;max-width:20px;flex:0 0 auto';
          } else {
            // Доля по шкале 0..maxLaps, чтобы правый край бара совпадал у всех.
            var pct = maxLaps > 0 ? (laps / maxLaps) * 100 : 0;
            var minW = isEmpty ? '0' : '4px';
            segStyle = 'width:' + (Math.round(pct * 100) / 100) + '%;flex:0 0 auto;min-width:' + minW;
          }
          html += '<div class="' + cls + '" style="' + segStyle + '">';
          var nextSeg = stints[i + 1];
          var nextIsEmpty = nextSeg && nextSeg.compound === '_';
          if (i < stints.length - 1 && seg.to > 0 && !isDns && !isEmpty && !nextIsEmpty) {
            // Номер круга пит-стопа: при ранних стинтах (1–2) — пит на этом круге; иначе первый круг выезда (seg.to + 1).
            var pitLap = seg.to <= 2 ? seg.to : seg.to + 1;
            html += '<span class="pit-stops-divider pit-stops-divider--overlay" aria-hidden="true">' +
              '<svg class="pit-stops-divider-svg" width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="10" fill="#0d0d0d"/></svg>' +
              '<span class="pit-stops-divider-lap">' + esc(String(pitLap)) + '</span></span>';
          }
          html += '</div>';
        });
        html += '</div></div>';
        html += '<span class="pit-stops-chart-laps">' + esc(String(totalLaps)) + '</span>';
        html += '</div>';
      });
      html += '</div>';
      html += '<div class="pit-stops-chart-legend">';
      var legendParts = [];
      if (usedCompounds.H) legendParts.push('C3 — Hard (white)');
      if (usedCompounds.M) legendParts.push('C4 — Medium (yellow)');
      if (usedCompounds.S) legendParts.push('C5 — Soft (red)');
      if (usedCompounds.I) legendParts.push('I — Intermediate (green)');
      if (usedCompounds.W) legendParts.push('W — Wet (blue)');
      var legendText = legendParts.length ? legendParts.join(', ') + '.' : '';
      html += '<span class="pit-stops-legend-text">' + esc(legendText) + '</span>';
      html += '<span class="pit-stops-chart-total">Total pit stops: ' + esc(String(totalPitStops)) + '</span>';
      html += '</div></div>';
      sortQueue.push({ rows: psRows, getRowClass: null });
    }
    if (tables.caution_breakdown) {
      var cbData = tables.caution_breakdown;
      if (seriesIdLower === 'indycar' && cbData.headers && Array.isArray(cbData.rows)) {
        var h = cbData.headers;
        var lastIdx = h.length - 1;
        if (lastIdx >= 0 && (h[lastIdx] || '').toLowerCase().indexOf('free pass') >= 0) {
          cbData = {
            headers: h.slice(0, lastIdx),
            rows: cbData.rows.map(function (r) { return r.slice(0, lastIdx); })
          };
        }
      }
      var reasonColIdx = (cbData.headers && cbData.headers.length > 0) ? cbData.headers.length - 1 : 4;
      var cbRowClass = function (row) {
        return (row[reasonColIdx] != null && String(row[reasonColIdx]).trim() !== '') ? 'caution-row caution-row-caution' : 'caution-row caution-row-green';
      };
      add(t('table.caution_breakdown'), cbData, 'caution-breakdown-table', cbRowClass, null);
    }

    var emptyMsg = (t('error.race_no_data') || t('error.no_section_data') || 'Race results will appear here after the event.');
    contentEl.innerHTML = html || ('<p class="empty-msg">' + esc(emptyMsg) + '</p>');
    if (html) {
      var raceTables = contentEl.querySelectorAll('.data-table:not(.table-field-value)');
      [].forEach.call(raceTables, function (table, idx) {
        var q = sortQueue[idx];
        if (q && q.rows) makeTableSortable(table, q.rows, esc, q.getRowClass);
      });
    }
  }

  function renderBopContent(escapeFn) {
    var e = escapeFn || function (s) { return (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
    function row(cells) {
      return '<tr>' + cells.map(function (c) {
        return '<td>' + e(c).replace(/\n/g, '<br>') + '</td>';
      }).join('') + '</tr>';
    }
    function theadRow(cells) { return '<tr>' + cells.map(function (c) { return '<th>' + e(c) + '</th>'; }).join('') + '</tr>'; }
    var gtpCars = [
      ['Acura', 'ARX-06', '1051', '9512', '98.1', '96.3', '230', '240', '898', '22.450', 'R80'],
      ['Aston Martin', 'Valkyrie', '1030', '8400', '100.0', '100.0', '230', '240', '912', '22.800', 'R80'],
      ['BMW', 'M Hybrid V8', '1048', '8000', '97.7', '97.1', '230', '240', '900', '22.500', 'R80'],
      ['Cadillac', 'V-Series.R', '1043', '8800', '98.1', '96.2', '230', '240', '895', '22.375', 'R80'],
      ['Porsche', '963', '1055', '8158', '97.7', '97.1', '230', '240', '902', '22.550', 'R80']
    ];
    var gtpReg = [
      ['PPULimit_BoP', '0', 'kW'],
      ['PPULimitRate_BoP', '1.0', 'kW'],
      ['PPUMaxIntegral_BoP', '10', 'kJ'],
      ['PPURate_BoP', '20', 'kW'],
      ['TDT_LimitRate_BoP', '10', 'Nm*s'],
      ['TDT_MaxIntegral_BoP', '150', 'Nm*s']
    ];
    var gtdCars = [
      ['Aston Martin', 'Vantage GT3 EVO', '1323', '7000', '91.9', '88.2', '190', '200', '5.0', '8.1', '871', '21.775'],
      ['BMW', 'M4 GT3 EVO', '1344', '7500', '91.9', '90.5', '190', '200', '-2.0', '2.1', '867', '21.675'],
      ['Corvette', 'Z06 GT3.R', '1360', '8000', '97.3', '92.3', '190', '200', '-1.8', '2.4', '876', '21.900'],
      ['Ferrari', '296 GT3 EVO', '1335', '7750', '85.9', '85.1', '190', '200', '-1.7', '1.1', '856', '21.400'],
      ['Ford', 'Mustang GT3', '1362', '8250', '97.0', '94.6', '190', '200', '-0.4', '2.8', '877', '21.925'],
      ['Lamborghini', 'Huracan GT3 EVO2', '1370', '8300', '84.6', '84.7', '190', '200', '2.0', '4.4', '862', '21.550'],
      ['Lamborghini', 'Temerario GT3', '1351', '8000', '87.9', '86.6', '190', '200', '1.0', '4.1', '885', '22.125'],
      ['Lexus', 'RC F GT3', '1356', '7200', '95.3', '94.7', '190', '200', '4.0', '7.1', '920', '23.000'],
      ['McLaren', '720S GT3 EVO', '1330', '8100', '94.0', '90.0', '190', '200', '3.1', '7.7', '879', '21.975'],
      ['Mercedes', 'AMG GT3', '1356', '7900', '91.9', '91.8', '190', '200', '0.0', '6.9', '910', '22.750'],
      ['Porsche', '911 GT3 R (992)', '1362', '8950', '94.8', '100.0', '190', '200', '7.3', '9.3', '863', '21.575']
    ];
    var gtdReg = [
      ['PPULimit_BoP', '0', 'kW'],
      ['PPULimitRate_BoP', '1.0', 'kW'],
      ['PPUMaxIntegral_BoP', '10', 'kJ'],
      ['PPURate_BoP', '20', 'kW']
    ];
    var gtpHead = ['Manufacturer', 'Car Model', 'Weight (kg)', 'Nmax (rpm)', 'Power ≤V1 (%)', 'Power ≥V2 (%)', 'V1 (km/h)', 'V2 (km/h)', 'Max Stint Energy (MJ)', 'Replenishment Rate (MJ/s)', 'Fuel'];
    var gtpRegHead = ['Regulatory BoP Parameter', 'GTP', 'Unit'];
    var gtdHead = ['Manufacturer', 'Car Model', 'Weight (kg)', 'Nmax (rpm)', 'Power ≤V1 (%)', 'Power ≥V2 (%)', 'V1 (km/h)', 'V2 (km/h)', 'Wing Min (deg)', 'Wing Max (deg)', 'Max Stint Energy (MJ)', 'Replenishment Rate (MJ/s)'];
    var gtdRegHead = ['Parameter', 'Value', 'Unit'];
    var out = '';
    out += '<div class="bop-content">';
    out += '<h2 class="bop-main-title">Balance of Performance — Daytona ROAR & Rolex 24</h2>';
    out += '<p class="bop-subtitle">Technical Bulletin IWSC #26-12 | Issued: January 8, 2026</p>';
    out += '<hr class="bop-divider">';
    out += '<h3 class="bop-class-title">GTP CLASS</h3>';
    out += '<div class="table-wrap"><table class="data-table bop-table">';
    out += '<thead>' + theadRow(gtpHead) + '</thead><tbody>';
    gtpCars.forEach(function (r) { out += row(r); });
    out += '</tbody></table></div>';
    out += '<p class="bop-notes"><strong>Notes:</strong></p><ul class="bop-notes-list"><li>Linear interpolation used between V1 and V2</li><li>% of High power curve defined in LMDh TR 5.1.2 and LMH TR Appendix 4b</li><li>For N/Nmax &lt; 0.55, maximum power is equal to N/Nmax = 0.55</li></ul>';
    out += '<h4 class="table-section-title">GTP Regulatory BoP Parameters</h4>';
    out += '<div class="table-wrap"><table class="data-table bop-table">';
    out += '<thead>' + theadRow(gtpRegHead) + '</thead><tbody>';
    gtpReg.forEach(function (r) { out += row(r); });
    out += '</tbody></table></div>';
    out += '<hr class="bop-divider">';
    out += '<h3 class="bop-class-title">GTD / GTD PRO CLASS</h3>';
    out += '<div class="table-wrap"><table class="data-table bop-table bop-table--wide">';
    out += '<thead>' + theadRow(gtdHead) + '</thead><tbody>';
    gtdCars.forEach(function (r) { out += row(r); });
    out += '</tbody></table></div>';
    out += '<p class="bop-notes"><strong>Notes:</strong></p><ul class="bop-notes-list"><li>Linear interpolation used between V1 and V2</li><li>For N/Nmax &lt; 0.55, maximum power is equal to N/Nmax = 0.55</li><li>Linear interpolation used between each 0.025 step from 0.55 to 1.025 N/Nmax</li><li>For N/Nmax &gt;= 1.025, maximum power is 0.856 of maximum power at N/Nmax = 1.000</li><li>Declared power varies — comparisons between cars are invalid</li><li>Wing angle at Y=0 using measurement described in ITEF (stated angle includes tolerance)</li></ul>';
    out += '<h4 class="table-section-title">GTD / GTD PRO Regulatory BoP Parameters (all sessions)</h4>';
    out += '<div class="table-wrap"><table class="data-table bop-table">';
    out += '<thead>' + theadRow(gtdRegHead) + '</thead><tbody>';
    gtdReg.forEach(function (r) { out += row(r); });
    out += '</tbody></table></div>';
    out += '</div>';
    return out;
  }

  function buildTeamNamesByNumberFromEntryList(entryList) {
    var map = {};
    if (!entryList || !entryList.length) return map;
    for (var i = 0; i < entryList.length; i++) {
      var e = entryList[i];
      var num = e.number != null ? String(e.number).trim() : '';
      if (num === '') continue;
      var team = (e.team != null && String(e.team).trim() !== '') ? String(e.team).trim() : '';
      map[num] = team;
      var parsed = parseInt(num, 10);
      if (!isNaN(parsed)) map[String(parsed)] = team;
    }
    return map;
  }

  function renderEventSectionContent(d, section, contentEl, eventIdFromRoute) {
    if (contentEl) contentEl.setAttribute('data-event-section', section || '');
    var seriesId  = eventSeriesId(d.event_id || eventIdFromRoute || '');
    var isStockCar = ['nascar_cup', 'noaps', 'nascar_truck', 'arca', 'nascar_modified'].indexOf((seriesId || '').toLowerCase()) >= 0;
    var html = '';
    var sortQueue = [];
    var byNumber = (isStockCar && d.entry_list && d.entry_list.length)
      ? buildTeamNamesByNumberFromEntryList(d.entry_list)
      : (d.team_names_by_number && typeof d.team_names_by_number === 'object' ? d.team_names_by_number : null);
    var evKeyEvent = ((d.event_id || '') + '').toUpperCase().replace(/[^A-Z0-9]+/g, '_');

    function applyTeamNameByNumber(rows, numberColIdx, teamColIdx) {
      if (!byNumber) return rows;
      return rows.map(function (row) {
        var r = row.slice();
        if (r.length > Math.max(numberColIdx, teamColIdx) && r[numberColIdx] != null) {
          var num = String(r[numberColIdx]).trim();
          var teamFromTeams = byNumber[num] || byNumber[String(parseInt(num, 10))];
          if (teamFromTeams != null) r[teamColIdx] = teamFromTeams;
        }
        return r;
      });
    }

    function transformTableDataForF2F3(tableData) {
      if (!tableData || !/^F2_|^F3_/.test(evKeyEvent)) return tableData;
      var headers = Array.isArray(tableData.headers) ? tableData.headers.slice() : [];
      var rows = Array.isArray(tableData.rows) ? tableData.rows.map(function (r) { return r.slice(); }) : [];
      if (headers.length === 0) return tableData;
      var chassisIdx = -1;
      for (var i = 0; i < headers.length; i++) {
        var h = (headers[i] || '').toLowerCase().trim();
        if (h === 'chassis') chassisIdx = i;
        if (h === 'manufacturer') headers[i] = 'Team';
      }
      if (chassisIdx >= 0) {
        headers.splice(chassisIdx, 1);
        rows = rows.map(function (r) {
          if (r.length > chassisIdx) return r.slice(0, chassisIdx).concat(r.slice(chassisIdx + 1));
          return r;
        });
      }
      return { headers: headers, rows: rows };
    }

    function dropStartPosColumn(tableData) {
      if (!tableData || !Array.isArray(tableData.headers) || !Array.isArray(tableData.rows)) return tableData;
      var idx = -1;
      for (var i = 0; i < tableData.headers.length; i++) {
        var n = (tableData.headers[i] || '').toUpperCase().trim();
        if (n === 'ST POS' || n === 'START POS' || n === 'START POSITION') { idx = i; break; }
      }
      if (idx < 0) return tableData;
      return {
        headers: tableData.headers.slice(0, idx).concat(tableData.headers.slice(idx + 1)),
        rows: tableData.rows.map(function (r) { return r.slice(0, idx).concat(r.slice(idx + 1)); })
      };
    }

    function splitTeamCarDropSponsor(tableData) {
      if (!tableData || !Array.isArray(tableData.headers) || !Array.isArray(tableData.rows)) return tableData;
      var idx = -1;
      for (var i = 0; i < tableData.headers.length; i++) {
        var h = (tableData.headers[i] || '').toLowerCase().trim();
        if (h === 'team/car/sponsor' || h.indexOf('team/car') === 0) { idx = i; break; }
      }
      if (idx < 0) return tableData;
      return {
        headers: tableData.headers.slice(0, idx).concat(['TEAM', 'CAR'], tableData.headers.slice(idx + 1)),
        rows: tableData.rows.map(function (r) {
          var cell = r[idx] != null ? String(r[idx]) : '';
          var parts = cell.split(/\s*\/\s*/);
          var team = (parts[0] || '').trim();
          var car = (parts[1] != null ? String(parts[1]).trim() : '');
          return r.slice(0, idx).concat([team, car], r.slice(idx + 1));
        })
      };
    }

    function applyClassFromEntryList(tableData, entryList) {
      if (!tableData || !Array.isArray(tableData.headers) || !Array.isArray(tableData.rows)) return tableData;
      if (!entryList || !entryList.length) return tableData;
      var classByNumber = {};
      entryList.forEach(function (row) {
        var num = row.number != null ? String(row.number).trim() : '';
        if (num) {
          var cls = row.class != null ? String(row.class).trim() : '';
          classByNumber[num] = cls;
          var numNorm = String(parseInt(num, 10));
          if (numNorm !== num) classByNumber[numNorm] = cls;
        }
      });
      var classColIdx = -1;
      var carNoColIdx = -1;
      for (var i = 0; i < tableData.headers.length; i++) {
        var h = (tableData.headers[i] || '').toUpperCase().trim();
        if (h === 'CLASS') classColIdx = i;
        if ((h === 'CAR NO' || h === '#' || h === 'NO') && carNoColIdx < 0) carNoColIdx = i;
      }
      if (carNoColIdx < 0) carNoColIdx = 1;
      if (classColIdx < 0 || classColIdx >= tableData.headers.length) return tableData;
      var rows = tableData.rows.map(function (r) {
        var newRow = r.slice();
        var num = newRow[carNoColIdx] != null ? String(newRow[carNoColIdx]).trim() : '';
        var cls = classByNumber[num] || classByNumber[String(parseInt(num, 10))];
        if (cls !== undefined && newRow.length > classColIdx) newRow[classColIdx] = cls;
        return newRow;
      });
      return { headers: tableData.headers, rows: rows };
    }

    function recomputeClassPos(tableData) {
      if (!tableData || !Array.isArray(tableData.headers) || !Array.isArray(tableData.rows)) return tableData;
      var posColIdx = -1;
      var classColIdx = -1;
      var classPosColIdx = -1;
      for (var i = 0; i < tableData.headers.length; i++) {
        var h = (tableData.headers[i] || '').toUpperCase().trim();
        if (h === 'POS') posColIdx = i;
        if (h === 'CLASS') classColIdx = i;
        if (h === 'CLASS POS') classPosColIdx = i;
      }
      if (posColIdx < 0) posColIdx = 0;
      if (classColIdx < 0 || classPosColIdx < 0 || classPosColIdx >= tableData.headers.length) return tableData;
      var rows = tableData.rows;
      var isSeparator = function (row) {
        if (!row || row.length === 0) return false;
        var first = (row[0] != null && String(row[0]).trim() !== '');
        if (!first) return false;
        for (var j = 1; j < row.length; j++) { if (row[j] != null && String(row[j]).trim() !== '') return false; }
        return true;
      };
      var dataRows = rows.filter(function (r) { return !isSeparator(r); });
      var posNum = function (row) {
        var v = row[posColIdx];
        var n = parseInt(v, 10);
        return isNaN(n) ? 9999 : n;
      };
      var getClass = function (row) {
        return (row[classColIdx] != null ? String(row[classColIdx]).trim() : '') || '\0';
      };
      var rowsWithClassPos = rows.map(function (row) {
        if (isSeparator(row)) return row;
        var cls = getClass(row);
        var myPos = posNum(row);
        var classPos = 1;
        for (var k = 0; k < dataRows.length; k++) {
          if (getClass(dataRows[k]) === cls && posNum(dataRows[k]) < myPos) classPos++;
        }
        var newRow = row.slice();
        if (newRow.length > classPosColIdx) newRow[classPosColIdx] = classPos;
        return newRow;
      });
      return { headers: tableData.headers, rows: rowsWithClassPos };
    }

    function isSupercarsSydneyEvent(evKey) {
      return /^SUPERCARS_2026_[123]$/.test((evKey || '').toUpperCase().replace(/[^A-Z0-9_]/g, '_'));
    }
    function supercarsSydneyCarDisplay(tableData) {
      if (!tableData || !Array.isArray(tableData.headers) || !Array.isArray(tableData.rows)) return tableData;
      var noColIdx = -1;
      for (var i = 0; i < tableData.headers.length; i++) {
        var h = (tableData.headers[i] || '').toLowerCase().trim();
        if (h === 'no' || h === 'no.' || h === '#' || h === 'car') { noColIdx = i; break; }
      }
      if (noColIdx < 0) return tableData;
      return {
        headers: tableData.headers,
        rows: tableData.rows.map(function (row) {
          var r = row.slice();
          if (r.length > noColIdx && String(r[noColIdx] || '').trim() === '8') r[noColIdx] = '800';
          return r;
        })
      };
    }
    function appendTable(title, tableData, extraClass, getRowClass, mergeTeamCells) {
      tableData = transformTableDataForF2F3(tableData);
      if ((seriesId || '').toLowerCase() === 'supercars' && isSupercarsSydneyEvent(evKeyEvent)) {
        tableData = supercarsSydneyCarDisplay(tableData);
      }
      var result = buildTableSection(title, tableData, extraClass, getRowClass, null, null, null, mergeTeamCells);
      if (!result) return;
      html += result.html;
      sortQueue.push({ rows: result.rows, getRowClass: result.getRowClass });
    }

    if (section === 'race') {
      renderRaceContent(d, contentEl);
      return;
    }

    if (section === 'bop') {
      contentEl.innerHTML = renderBopContent(esc);
      return;
    }

    if (section === 'pre_season_tests') {
      var evKeyPst = ((d.event_id || '') + '').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
      var pst = d.tables && d.tables.pre_season_tests;
      function renderOneSession(sess) {
        var out = '';
        if (sess.title) out += '<h3 class="event-pre-season-title">' + esc(sess.title) + '</h3>';
        if (sess.subtitle) out += '<p class="event-pre-season-subtitle">' + esc(sess.subtitle) + '</p>';
        if (sess.caption) out += '<p class="event-pre-season-caption">' + esc(sess.caption) + '</p>';
        if (evKeyPst !== 'IMSA_2026_1' && evKeyPst !== 'IMSA_2026_PRE_SEASON_TEST' && evKeyPst !== 'F1_2026_PRE_SEASON_TEST_1' && evKeyPst !== 'F1_2026_PRE_SEASON_TEST_2') {
          out += buildSessionMetaTable(sess.meta);
        }
        if (sess.headers && Array.isArray(sess.rows)) {
          var rows = sess.rows;
          if (evKeyPst === 'IMSA_2026_PRE_SEASON_TEST' || evKeyPst === 'IMSA_2026_1') {
            var stIdx = sess.headers.indexOf('ST POS');
            if (stIdx >= 0) {
              sess.headers = sess.headers.slice(0, stIdx).concat(sess.headers.slice(stIdx + 1));
              rows = rows.map(function (r) { return r.slice(0, stIdx).concat(r.slice(stIdx + 1)); });
            }
          }
          var teamColIdx = -1;
          for (var hi = 0; hi < sess.headers.length; hi++) {
            var hText = (sess.headers[hi] || '').toLowerCase().trim();
            if (hText === 'team/car/sponsor' || hText.indexOf('team/car') === 0) {
              teamColIdx = hi;
              break;
            }
          }
          if (teamColIdx >= 0) {
            var newHeaders = [];
            for (var hi2 = 0; hi2 < sess.headers.length; hi2++) {
              if (hi2 === teamColIdx) {
                newHeaders.push('TEAM', 'CAR');
              } else {
                newHeaders.push(sess.headers[hi2]);
              }
            }
            sess.headers = newHeaders;
            var dropSponsorInCar = (evKeyPst === 'IMSA_2026_PRE_SEASON_TEST' || evKeyPst === 'IMSA_2026_1');
            rows = rows.map(function (r) {
              var cell = r[teamColIdx] != null ? String(r[teamColIdx]) : '';
              var parts = cell.split(/\s*\/\s*/);
              var team = (parts[0] || '').trim();
              var car = dropSponsorInCar ? (parts[1] != null ? String(parts[1]).trim() : '') : parts.slice(1).join(' / ');
              var before = r.slice(0, teamColIdx);
              var after = r.slice(teamColIdx + 1);
              return before.concat([team, car], after);
            });
          }
          /* Не фильтруем по NO LAPS для IMSA pre_season_tests — иначе Session 1 может оказаться пустым */
          var numberColIdx = sess.headers.indexOf('CAR NO');
          var teamColIdxAfterSplit = sess.headers.indexOf('TEAM');
          if (numberColIdx < 0) numberColIdx = 1;
          if (teamColIdxAfterSplit < 0) teamColIdxAfterSplit = 3;
          if (evKeyPst !== 'F1_2026_PRE_SEASON_TEST_1' && evKeyPst !== 'F1_2026_PRE_SEASON_TEST_2') {
            rows = applyTeamNameByNumber(rows, numberColIdx, teamColIdxAfterSplit);
          }
          var resultsTitle = (evKeyPst === 'F1_2026_PRE_SEASON_TEST_1' || evKeyPst === 'F1_2026_PRE_SEASON_TEST_2') ? '' : '<h4 class="table-section-title">Results</h4>';
          out += resultsTitle;
          var defaultHeaders = ['POS', 'CAR NO', 'DRIVERS', 'TEAM', 'CAR', 'CLASS', 'CLASS POS', 'ST POS', 'NO LAPS', 'FASTEST LAP', 'STATUS'];
          var headersForTable = sess.headers && sess.headers.length > 0 ? sess.headers : defaultHeaders;
          if (rows.length > 0 && headersForTable.length !== rows[0].length) {
            if (headersForTable.length < rows[0].length) {
              while (headersForTable.length < rows[0].length) headersForTable.push(defaultHeaders[headersForTable.length] || '');
            } else {
              headersForTable = headersForTable.slice(0, rows[0].length);
            }
          }
          if ((evKeyPst === 'IMSA_2026_1' || evKeyPst === 'IMSA_2026_PRE_SEASON_TEST') && d.entry_list && d.entry_list.length) {
            var pstData = applyClassFromEntryList({ headers: headersForTable, rows: rows }, d.entry_list);
            pstData = recomputeClassPos(pstData);
            headersForTable = pstData.headers;
            rows = pstData.rows;
          }
          var tbl = { headers: headersForTable, rows: rows };
          var pstTableClass = 'pre-season-results-table pre-season-results-table--session' + (evKeyPst === 'F1_2026_PRE_SEASON_TEST_1' || evKeyPst === 'F1_2026_PRE_SEASON_TEST_2' ? ' pre-season-results-table--fit' : '');
          var result = buildTableSection(null, tbl, pstTableClass);
          if (result) {
            var htmlFrag = result.html;
            if (evKeyPst === 'IMSA_2026_PRE_SEASON_TEST' || evKeyPst === 'IMSA_2026_1') {
              htmlFrag = htmlFrag.replace('<div class="table-wrap">', '<div class="table-wrap table-wrap--no-scroll">');
            }
            out += htmlFrag;
            sortQueue.push({ rows: result.rows, getRowClass: result.getRowClass });
          }
        }
        return out;
      }
      if (pst && Array.isArray(pst.sessions) && pst.sessions.length > 0) {
        html += '<div class="event-pre-season-block">';
        pst.sessions.forEach(function (sess, idx) {
          if (idx > 0) html += '<hr class="event-pre-season-divider">';
          html += renderOneSession(sess);
        });
        html += '</div>';
      } else if (pst && (pst.title || pst.headers)) {
        html += '<div class="event-pre-season-block">';
        html += renderOneSession(pst);
        html += '</div>';
      } else if (pst && pst.headers && Array.isArray(pst.rows)) {
        appendTable(t('block.pre_season_tests'), pst);
      }
      if (!html) contentEl.innerHTML = '<p class="empty-msg">' + (t('error.no_section_data') || 'No data yet') + '</p>';
      else { contentEl.innerHTML = html; var tables = contentEl.querySelectorAll('.data-table'); [].forEach.call(tables, function (table, idx) { var q = sortQueue[idx]; if (q && q.rows) makeTableSortable(table, q.rows, esc, q.getRowClass); }); }
      return;
    }

    if (section === 'entry-list') {
      if (!d.entry_list || d.entry_list.length === 0) {
        contentEl.innerHTML = '<p class="empty-msg">' + t('error.no_entry_list') + '</p>';
        return;
      }
      var entryCopy = d.entry_list.slice();
      var evKeyEntry = ((d.event_id || '') + '').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
      if (evKeyEntry === 'IMSA_2026_1' || evKeyEntry === 'IMSA_2026_2') {
        // Порядок столбцов: #, Class, Team, Car, Drivers. Для одной команды объединяем ячейки Team, Class и Car (rowspan).
        var headImsa = '<th>' + t('th.no') + '</th><th>Class</th><th>' + t('th.team') + '</th><th>Car</th><th>' + t('th.driver') + '</th>';
        function buildImsaEntryTbody(arr, byNum) {
          var teamVals = arr.map(function (row) {
            var tv = row.team;
            if (byNum && row.number != null) tv = byNum[String(row.number).trim()] || byNum[String(parseInt(row.number, 10))] || tv;
            return tv != null ? String(tv) : '';
          });
          var classVals = arr.map(function (row) {
            return row.class != null ? String(row.class) : '';
          });
          var teamRowspan = [];
          for (var i = 0; i < arr.length; i++) {
            if (i === 0 || teamVals[i] !== teamVals[i - 1] || classVals[i] !== classVals[i - 1]) {
              var ts = 1;
              while (i + ts < arr.length && teamVals[i + ts] === teamVals[i] && classVals[i + ts] === classVals[i]) ts++;
              teamRowspan.push(ts);
            } else {
              teamRowspan.push(0);
            }
          }
          return arr.map(function (row, idx) {
            var teamDisplay = teamVals[idx];
            var carDisplay = (row.car != null && String(row.car).trim()) ? String(row.car) : (row.manufacturer != null ? String(row.manufacturer) : '');
            var classDisplay = row.class != null ? String(row.class) : '';
            var driverRaw = row.driver != null ? String(row.driver) : '';
            var driverParts = driverRaw.split(/\s*\/\s*/).map(function (p) { return p.trim(); }).filter(function (p) { return p; });
            var driverCell = driverParts.length
              ? driverParts.map(function (name) {
                  var display = driverDisplayName(name);
                  return display ? '<a href="/driver/' + encodeURIComponent(slugify(display)) + '" class="track-link">' + esc(display) + '</a>' : esc(name);
                }).join(' / ')
              : '—';
            var span = teamRowspan[idx];
            var teamTd = span > 0
              ? '<td rowspan="' + span + '" class="entry-list-team-cell">' + (teamDisplay ? '<a href="/team/' + encodeURIComponent(slugify(teamDisplay)) + '" class="track-link">' + esc(teamDisplay) + '</a>' : '—') + '</td>'
              : '';
            var classTd = span > 0
              ? '<td rowspan="' + span + '" class="entry-list-class-cell">' + esc(dash(classDisplay)) + '</td>'
              : '';
            var carTd = span > 0
              ? '<td rowspan="' + span + '" class="entry-list-car-cell">' + esc(dash(carDisplay)) + '</td>'
              : '';
            return '<tr><td>' + esc(dash(row.number)) + '</td>' + classTd + teamTd + carTd + '<td>' + driverCell + '</td></tr>';
          }).join('');
        }
        contentEl.innerHTML = '<div class="table-wrap"><table class="data-table entry-list-table"><thead><tr>' + headImsa + '</tr></thead><tbody>' + buildImsaEntryTbody(entryCopy, byNumber) + '</tbody></table></div>';
        addObjectTableSort(contentEl.querySelector('.data-table'), entryCopy, null, ['number', 'class', 'team', 'car', 'driver'], function (dataCopy) {
          return buildImsaEntryTbody(dataCopy, byNumber);
        });
        return;
      }
      var eventIdLower = (d.event_id || eventIdFromRoute || '').toLowerCase();
      var isF2OrF3Entry = /^f2_/.test(eventIdLower) || /^f3_/.test(eventIdLower) || (String(d.series || '').toLowerCase().indexOf('formula 2') >= 0) || (String(d.series || '').toLowerCase().indexOf('formula 3') >= 0);
      var hasOnlyNumberTeamDriver = !entryCopy.some(function (e) { return (e.manufacturer != null && String(e.manufacturer).trim() !== '') || (e.constructor != null && String(e.constructor).trim() !== ''); });
      if (isF2OrF3Entry) {
        entryCopy.sort(function (a, b) { var na = parseFloat(a.number); var nb = parseFloat(b.number); if (!isNaN(na) && !isNaN(nb)) return na - nb; return String(a.number || '').localeCompare(String(b.number || '')); });
        function safeTeamStr(r) {
          var v = r && r.team;
          if (v == null) return '';
          if (typeof v === 'string') return v;
          if (typeof v === 'function') return '';
          return String(v);
        }
        function buildF2F3EntryBody(arr) {
          var spans = [];
          for (var ei = 0; ei < arr.length; ei++) {
            var teamVal = safeTeamStr(arr[ei]);
            var ts = 1;
            while (ei + ts < arr.length && safeTeamStr(arr[ei + ts]) === teamVal) ts++;
            spans.push(ts);
          }
          return arr.map(function (row, idx) {
            var driverDisplay = driverDisplayName(row.driver);
            var driverCell = driverDisplay ? '<a href="/driver/' + encodeURIComponent(slugify(driverDisplay)) + '" class="track-link">' + esc(driverDisplay) + '</a>' : '—';
            var teamDisplay = safeTeamStr(row);
            var isFirstInTeam = (idx === 0 || safeTeamStr(arr[idx - 1]) !== teamDisplay);
            var teamCell = (isFirstInTeam && spans[idx] > 0)
              ? '<td rowspan="' + spans[idx] + '" class="entry-list-team-cell">' + (teamDisplay ? '<a href="/team/' + encodeURIComponent(slugify(teamDisplay)) + '" class="track-link">' + esc(teamDisplay) + '</a>' : '—') + '</td>'
              : '';
            return '<tr><td>' + esc(dash(row.number)) + '</td>' + teamCell + '<td>' + driverCell + '</td></tr>';
          }).join('');
        }
        var headF2F3 = '<th>' + t('th.no') + '</th><th>' + t('th.team') + '</th><th>' + t('th.driver') + '</th>';
        contentEl.innerHTML = '<div class="table-wrap"><table class="data-table entry-list-table"><thead><tr>' + headF2F3 + '</tr></thead><tbody>' + buildF2F3EntryBody(entryCopy) + '</tbody></table></div>';
        addObjectTableSort(contentEl.querySelector('.data-table'), entryCopy, null, ['number', 'team', 'driver'], function (dataCopy) {
          return buildF2F3EntryBody(dataCopy);
        });
        return;
      }
      var seriesLower = (seriesId || '').toLowerCase();
      var isIndyCar = seriesLower === 'indycar'
        || (String(d.series || '').toLowerCase().indexOf('indycar') >= 0)
        || /^indycar_/.test((d.event_id || '').toLowerCase());
      var isSupercarsEntry = seriesLower === 'supercars';
      var isF1Entry = seriesLower === 'f1' || (String(d.series || '').toLowerCase().indexOf('formula 1') >= 0);
      // F1 2025, Australian GP: соответствие "конструктор → шасси" для entry list.
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
      // IndyCar: No., Driver, Team, Engine. Supercars / Stock car: No., Driver, Team, Manufacturer. Остальные (F1 и др.): No., Driver, Manufacturer, Chassis.
      var head = isIndyCar
        ? '<th>' + t('th.no') + '</th><th>' + t('th.driver') + '</th><th>' + t('th.team') + '</th><th>' + t('th.engine') + '</th>' + (isStockCar ? '<th>' + t('th.crew_chief') + '</th>' : '')
        : isSupercarsEntry
          ? '<th>' + t('th.no') + '</th><th>' + t('th.driver') + '</th><th>' + t('th.team') + '</th><th>' + t('th.manufacturer') + '</th>' + (isStockCar ? '<th>' + t('th.crew_chief') + '</th>' : '')
          : isStockCar
            ? '<th>' + t('th.no') + '</th><th>' + t('th.driver') + '</th><th>' + t('th.team') + '</th><th>' + t('th.manufacturer') + '</th><th>' + t('th.crew_chief') + '</th>'
            : '<th>' + t('th.no') + '</th><th>' + t('th.driver') + '</th><th>' + t('th.manufacturer') + '</th><th>' + t('th.chassis') + '</th>';
      function safeTeamStr(v) {
        if (v == null) return '';
        if (typeof v === 'string') return v.trim();
        if (typeof v === 'object' && v !== null && typeof v.name === 'string') return v.name.trim();
        return '';
      }
      function getTeamDisplay(r) {
        var t = safeTeamStr(r.team);
        if (byNumber && r.number != null && typeof byNumber === 'object' && byNumber !== null) {
          var num = String(r.number).trim();
          var v = byNumber[num] || (num ? byNumber[String(parseInt(num, 10))] : undefined);
          if (typeof v === 'string' && v.trim()) t = v.trim();
        }
        return t;
      }
      function getManufacturerDisplay(r) {
        var c = r.constructor;
        if (typeof c === 'string' && c.trim() !== '') return c.trim();
        var m = r.manufacturer;
        if (m != null && typeof m === 'string') return m.trim();
        if (m != null) return String(m);
        return '';
      }
      function getChassisDisplay(r) {
        var manu = (r.manufacturer != null ? String(r.manufacturer).trim() : '');
        // F1 2025: для всех этапов сезона подставляем код шасси вместо повторения конструктора.
        if (isF1Entry && evKeyEntry && evKeyEntry.indexOf('F1_2025_') === 0 && manu) {
          var code = F1_2025_ENTRY_CHASSIS[manu];
          if (code) return code;
        }
        return manu || (r.car != null ? String(r.car) : '');
      }
      function getEngineDisplay(r) {
        return (r.manufacturer != null ? String(r.manufacturer) : '') || (r.engine != null ? String(r.engine) : '');
      }
      // F1 и IndyCar: по умолчанию сортируем по команде, затем по номеру
      if (isF1Entry || isIndyCar) {
        entryCopy.sort(function (a, b) {
          var ta = getTeamDisplay(a).toLowerCase();
          var tb = getTeamDisplay(b).toLowerCase();
          if (ta < tb) return -1;
          if (ta > tb) return 1;
          var na = (a.number != null ? String(a.number) : '');
          var nb = (b.number != null ? String(b.number) : '');
          return na.localeCompare(nb, undefined, { numeric: true });
        });
      }

      var entryRowFn = function (row) {
        var driverDisplay = driverDisplayName(row.driver);
        var driverCell = driverDisplay ? '<a href="/driver/' + encodeURIComponent(slugify(driverDisplay)) + '" class="track-link">' + esc(driverDisplay) + '</a>' : '—';
        var teamDisplay = getTeamDisplay(row);
        var teamCell = teamDisplay ? '<a href="/team/' + encodeURIComponent(slugify(teamDisplay)) + '" class="track-link">' + esc(teamDisplay) + '</a>' : '—';
        if (isIndyCar) {
          var engineDisplay = getEngineDisplay(row);
          var cells = '<td>' + esc(dash(row.number)) + '</td><td>' + driverCell + '</td><td>' + teamCell + '</td><td>' + esc(dash(engineDisplay)) + '</td>';
        } else if (isSupercarsEntry) {
          var manufacturerDisplay = getManufacturerDisplay(row);
          var cells = '<td>' + esc(dash(row.number)) + '</td><td>' + driverCell + '</td><td>' + teamCell + '</td><td>' + esc(dash(manufacturerDisplay)) + '</td>';
        } else if (isStockCar) {
          var manufacturerDisplay = getManufacturerDisplay(row);
          var cells = '<td>' + esc(dash(row.number)) + '</td><td>' + driverCell + '</td><td>' + teamCell + '</td><td>' + esc(dash(manufacturerDisplay)) + '</td><td>' + (row.crew_chief ? '<a href="/crew-chief/' + encodeURIComponent(slugify(row.crew_chief)) + '" class="track-link">' + esc(row.crew_chief) + '</a>' : '—') + '</td>';
        } else {
          var manufacturerDisplay = getManufacturerDisplay(row);
          var chassisDisplay = getChassisDisplay(row);
          var cells = '<td>' + esc(dash(row.number)) + '</td><td>' + driverCell + '</td><td>' + esc(dash(manufacturerDisplay)) + '</td><td>' + esc(dash(chassisDisplay)) + '</td>';
        }
        return '<tr>' + cells + '</tr>';
      };
      var manufacturerSpans = [];
      var chassisSpans = [];
      var teamSpans = [];
      var engineSpans = [];
      if (!isStockCar) {
        for (var ei = 0; ei < entryCopy.length; ei++) {
          var r = entryCopy[ei];
          if (isIndyCar) {
            var teamDisp = getTeamDisplay(r);
            var engDisp = getEngineDisplay(r);
            var tSpan = 1;
            while (ei + tSpan < entryCopy.length && getTeamDisplay(entryCopy[ei + tSpan]) === teamDisp) tSpan++;
            teamSpans.push(tSpan);
            // Объединение по двигателю только внутри одной команды
            var eSpan = 1;
            while (ei + eSpan < entryCopy.length && getTeamDisplay(entryCopy[ei + eSpan]) === teamDisp && getEngineDisplay(entryCopy[ei + eSpan]) === engDisp) eSpan++;
            engineSpans.push(eSpan);
          } else if (isSupercarsEntry) {
            var teamDisp = getTeamDisplay(r);
            var manuDisp = getManufacturerDisplay(r);
            var tSpan = 1;
            while (ei + tSpan < entryCopy.length && getTeamDisplay(entryCopy[ei + tSpan]) === teamDisp) tSpan++;
            teamSpans.push(tSpan);
            // объединение по производителю только внутри одной команды
            var manuSpan = 1;
            while (ei + manuSpan < entryCopy.length && getTeamDisplay(entryCopy[ei + manuSpan]) === teamDisp && getManufacturerDisplay(entryCopy[ei + manuSpan]) === manuDisp) manuSpan++;
            manufacturerSpans.push(manuSpan);
          } else {
            var manuDisp = getManufacturerDisplay(r);
            var chDisp = getChassisDisplay(r);
            var manuSpan = 1;
            while (ei + manuSpan < entryCopy.length && getManufacturerDisplay(entryCopy[ei + manuSpan]) === manuDisp) manuSpan++;
            manufacturerSpans.push(manuSpan);
            var chSpan = 1;
            while (ei + chSpan < entryCopy.length && getChassisDisplay(entryCopy[ei + chSpan]) === chDisp) chSpan++;
            chassisSpans.push(chSpan);
          }
        }
      }
      var entryRowDisplayFn = function (row, idx, arr) {
        var driverDisplay = driverDisplayName(row.driver);
        var driverCell = driverDisplay ? '<a href="/driver/' + encodeURIComponent(slugify(driverDisplay)) + '" class="track-link">' + esc(driverDisplay) + '</a>' : '—';
        if (isIndyCar) {
          var teamDisplay = getTeamDisplay(row);
          var engineDisplay = getEngineDisplay(row);
          var tSpan = teamSpans[idx] || 1;
          var eSpan = engineSpans[idx] || 1;
          var isFirstTeam = (idx === 0 || getTeamDisplay(arr[idx - 1]) !== teamDisplay);
          var isFirstEngine = (idx === 0 || getTeamDisplay(arr[idx - 1]) !== teamDisplay || getEngineDisplay(arr[idx - 1]) !== engineDisplay);
          var teamCell = isFirstTeam && tSpan > 0
            ? '<td rowspan="' + tSpan + '" class="entry-list-team-cell">' + (teamDisplay ? '<a href="/team/' + encodeURIComponent(slugify(teamDisplay)) + '" class="track-link">' + esc(teamDisplay) + '</a>' : '—') + '</td>'
            : '';
          var engineCell = isFirstEngine && eSpan > 0
            ? '<td rowspan="' + eSpan + '">' + esc(dash(engineDisplay)) + '</td>'
            : '';
          return '<tr><td>' + esc(dash(row.number)) + '</td><td>' + driverCell + '</td>' + teamCell + engineCell + '</tr>';
        }
        if (isSupercarsEntry) {
          var teamDisplay = getTeamDisplay(row);
          var manufacturerDisplay = getManufacturerDisplay(row);
          var tSpan = teamSpans[idx] || 1;
          var manuSpan = manufacturerSpans[idx] || 1;
          var isFirstTeam = (idx === 0 || getTeamDisplay(arr[idx - 1]) !== teamDisplay);
          var isFirstManu = (idx === 0 || getTeamDisplay(arr[idx - 1]) !== teamDisplay || getManufacturerDisplay(arr[idx - 1]) !== manufacturerDisplay);
          var teamCell = isFirstTeam && tSpan > 0
            ? '<td rowspan="' + tSpan + '" class="entry-list-team-cell">' + (teamDisplay ? '<a href="/team/' + encodeURIComponent(slugify(teamDisplay)) + '" class="track-link">' + esc(teamDisplay) + '</a>' : '—') + '</td>'
            : '';
          var manufacturerCell = isFirstManu && manuSpan > 0
            ? '<td rowspan="' + manuSpan + '" class="entry-list-team-cell">' + esc(dash(manufacturerDisplay)) + '</td>'
            : '';
          return '<tr><td>' + esc(dash(row.number)) + '</td><td>' + driverCell + '</td>' + teamCell + manufacturerCell + '</tr>';
        }
        var manufacturerDisplay = getManufacturerDisplay(row);
        var chassisDisplay = getChassisDisplay(row);
        var manuSpan = manufacturerSpans[idx] || 1;
        var chSpan = chassisSpans[idx] || 1;
        var isFirstManu = (idx === 0 || getManufacturerDisplay(arr[idx - 1]) !== manufacturerDisplay);
        var isFirstChassis = (idx === 0 || getChassisDisplay(arr[idx - 1]) !== chassisDisplay);
        var manufacturerCell = isFirstManu && manuSpan > 0
          ? '<td rowspan="' + manuSpan + '" class="entry-list-team-cell">' + esc(dash(manufacturerDisplay)) + '</td>'
          : '';
        var chassisCell = isFirstChassis && chSpan > 0
          ? '<td rowspan="' + chSpan + '">' + esc(dash(chassisDisplay)) + '</td>'
          : '';
        return '<tr><td>' + esc(dash(row.number)) + '</td><td>' + driverCell + '</td>' + manufacturerCell + chassisCell + '</tr>';
      };
      var bodyHtml = isStockCar
        ? entryCopy.map(entryRowFn).join('')
        : entryCopy.map(function (row, idx, arr) { return entryRowDisplayFn(row, idx, arr); }).join('');
      contentEl.innerHTML = '<div class="table-wrap"><table class="data-table entry-list-table"><thead><tr>' + head + '</tr></thead><tbody>' + bodyHtml + '</tbody></table></div>';
      var entryKeys = isStockCar ? ['number', 'driver', 'team', 'manufacturer', 'crew_chief'] : (isIndyCar || isSupercarsEntry ? ['number', 'driver', 'team', 'manufacturer'] : ['number', 'driver', 'constructor', 'manufacturer']);
      addObjectTableSort(contentEl.querySelector('.data-table'), entryCopy, entryRowFn, entryKeys);
      return;
    }

    if (section === 'practice') {
      var prac = d.tables && d.tables.practice;
      var isSupercarsPractice = (seriesId || '').toLowerCase() === 'supercars';
      function ensureClassColumn(tableData) {
        if (!tableData || !Array.isArray(tableData.headers) || !Array.isArray(tableData.rows)) return tableData;
        var headers = tableData.headers.slice();
        var classIdx = -1;
        var classPosIdx = -1;
        for (var i = 0; i < headers.length; i++) {
          var h = (headers[i] || '').toUpperCase().trim();
          if (h === 'CLASS') classIdx = i;
          if (h === 'CLASS POS') classPosIdx = i;
        }
        if (classIdx >= 0) return tableData;
        if (classPosIdx < 0) return tableData;
        var outHeaders = headers.slice(0, classPosIdx).concat(['CLASS'], headers.slice(classPosIdx));
        var outRows = tableData.rows.map(function (r) {
          return r.slice(0, classPosIdx).concat([''], r.slice(classPosIdx));
        });
        return { headers: outHeaders, rows: outRows };
      }
      function practiceTableData(t) {
        return dropStartPosColumn(splitTeamCarDropSponsor(t));
      }
      function practiceDataWithClass(t) {
        var data = ensureClassColumn(practiceTableData(t));
        return ((evKeyEvent === 'IMSA_2026_1' || evKeyEvent === 'IMSA_2026_2') && d.entry_list && d.entry_list.length)
          ? applyClassFromEntryList(data, d.entry_list)
          : data;
      }
      function practiceDataForSupercars(t) {
        if (!t || !t.headers || !Array.isArray(t.rows)) return t;
        var data = practiceDataWithClass({ headers: t.headers, rows: applyTeamNameByNumber(t.rows, 1, 3) });
        return normalizeSupercarsTableNumberColumn(data, 1);
      }
      // Новый формат: tables.practice.sessions — несколько сессий практик (Practice 1, Practice 2, ...).
      if (prac && Array.isArray(prac.sessions) && prac.sessions.length > 0) {
        prac.sessions.forEach(function (sess, idx) {
          if (!sess || !sess.headers || !Array.isArray(sess.rows)) return;
          var base = { headers: sess.headers, rows: applyTeamNameByNumber(sess.rows, 1, 3) };
          var data = isSupercarsPractice ? practiceDataForSupercars(base) : practiceDataWithClass(base);
          var title;
          if (sess.title && String(sess.title).trim() !== '') {
            title = sess.title;
          } else if (idx === 0) {
            title = t('table.practice');
          } else if (idx === 1) {
            title = t('table.practice2');
          } else if (idx === 2) {
            title = t('table.practice3');
          } else {
            title = (t('table.practice') || 'Practice') + ' ' + String(idx + 1);
          }
          appendTable(title, data);
        });
        if (!html) {
          contentEl.innerHTML = '<p class="empty-msg">' + t('error.no_section_data') + '</p>';
        } else {
          contentEl.innerHTML = html;
          var tablesPractice = contentEl.querySelectorAll('.data-table:not(.table-field-value)');
          [].forEach.call(tablesPractice, function (table, idx) {
            var q = sortQueue[idx];
            if (q && q.rows) makeTableSortable(table, q.rows, esc, q.getRowClass);
          });
        }
        return;
      }
      // Старый формат: отдельные таблицы practice / practice2 / practice3 / final_practice.
      var prac1Data = prac && prac.headers && Array.isArray(prac.rows)
        ? (isSupercarsPractice ? practiceDataForSupercars(prac) : practiceDataWithClass({ headers: prac.headers, rows: applyTeamNameByNumber(prac.rows, 1, 3) }))
        : practiceDataWithClass(prac);
      appendTable(t('table.practice'), prac1Data);
      var prac2Data = isSupercarsPractice && d.tables && d.tables.practice2 ? practiceDataForSupercars(d.tables.practice2) : practiceDataWithClass(d.tables && d.tables.practice2);
      var prac3Data = isSupercarsPractice && d.tables && d.tables.practice3 ? practiceDataForSupercars(d.tables.practice3) : practiceDataWithClass(d.tables && d.tables.practice3);
      var finalPracData = isSupercarsPractice && d.tables && d.tables.final_practice ? practiceDataForSupercars(d.tables.final_practice) : practiceDataWithClass(d.tables && d.tables.final_practice);
      appendTable(t('table.practice2'), prac2Data);
      appendTable(t('table.practice3'), prac3Data);
      appendTable((d.tables.final_practice && d.tables.final_practice.title) ? d.tables.final_practice.title : t('table.final_practice'), finalPracData);
    } else if (section === 'qualifying') {
      appendTable(t('table.duel1'),           d.tables && d.tables.duel1, null, null, false);
      appendTable(t('table.duel2'),           d.tables && d.tables.duel2, null, null, false);
      var q = d.tables && d.tables.qualifying;
      function ensureQualClassColumn(tableData) {
        if (!tableData || !Array.isArray(tableData.headers) || !Array.isArray(tableData.rows)) return tableData;
        var headers = tableData.headers.slice();
        var classIdx = -1;
        var classPosIdx = -1;
        for (var i = 0; i < headers.length; i++) {
          var h = (headers[i] || '').toUpperCase().trim();
          if (h === 'CLASS') classIdx = i;
          if (h === 'CLASS POS') classPosIdx = i;
        }
        if (classIdx >= 0 || classPosIdx < 0) return tableData;
        return {
          headers: headers.slice(0, classPosIdx).concat(['CLASS'], headers.slice(classPosIdx)),
          rows: tableData.rows.map(function (r) { return r.slice(0, classPosIdx).concat([''], r.slice(classPosIdx)); })
        };
      }
      function normalizeImsaQualTable(tableData) {
        if (evKeyEvent !== 'IMSA_2026_1' && evKeyEvent !== 'IMSA_2026_2') return tableData;
        var data = dropStartPosColumn(splitTeamCarDropSponsor(tableData));
        data = ensureQualClassColumn(data);
        if (d.entry_list && d.entry_list.length) data = applyClassFromEntryList(data, d.entry_list);
        data = recomputeClassPos(data);
        if (!data || !Array.isArray(data.headers) || !Array.isArray(data.rows)) return data;
        var headers = data.headers.slice();
        var classPosIdx = -1;
        var pointsIdx = -1;
        for (var i = 0; i < headers.length; i++) {
          var h = (headers[i] || '').toUpperCase().trim();
          if (h === 'CLASS POS') classPosIdx = i;
          if (h === 'POINTS') pointsIdx = i;
        }
        if (classPosIdx < 0) return data;
        if (pointsIdx < 0) {
          pointsIdx = headers.length;
          headers.push('POINTS');
        }
        function qualifyingPointsByClassPos(classPos) {
          var n = parseInt(classPos, 10);
          if (isNaN(n) || n < 1) return 0;
          if (n === 1) return 35;
          if (n === 2) return 32;
          if (n === 3) return 30;
          if (n === 4) return 28;
          if (n === 5) return 26;
          if (n === 6) return 25;
          if (n === 7) return 24;
          if (n === 8) return 23;
          if (n === 9) return 22;
          if (n === 10) return 21;
          if (n === 11) return 20;
          if (n === 12) return 19;
          if (n === 13) return 18;
          if (n === 14) return 17;
          if (n === 15) return 16;
          if (n === 16) return 15;
          if (n === 17) return 14;
          if (n === 18) return 13;
          if (n === 19) return 12;
          if (n === 20) return 11;
          if (n === 21) return 10;
          if (n === 22) return 9;
          if (n === 23) return 8;
          if (n === 24) return 7;
          if (n === 25) return 6;
          if (n === 26) return 5;
          if (n === 27) return 4;
          if (n === 28) return 3;
          if (n === 29) return 2;
          return 1;
        }
        var rows = data.rows.map(function (r) {
          var row = r.slice();
          while (row.length <= pointsIdx) row.push('');
          row[pointsIdx] = String(qualifyingPointsByClassPos(row[classPosIdx]));
          return row;
        });
        data = { headers: headers, rows: rows };
        return data;
      }
      function renderOneQualSession(sess) {
        var out = '';
        if (sess.title) out += '<h3 class="event-pre-season-title">' + esc(sess.title) + '</h3>';
        if (sess.subtitle) out += '<p class="event-pre-season-subtitle">' + esc(sess.subtitle) + '</p>';
        if (evKeyEvent !== 'IMSA_2026_1') {
          out += buildSessionMetaTable(sess.meta);
        }
        if (sess.headers && Array.isArray(sess.rows)) {
          var qualData = normalizeImsaQualTable({ headers: sess.headers, rows: sess.rows });
          var qualHeaders = qualData.headers.slice();
          var qualRows = qualData.rows.map(function (r) { return r.slice(); });
          qualRows = applyTeamNameByNumber(qualRows, 1, 3);
          // CLASS POS и POINTS уже нормализованы в normalizeImsaQualTable().
          // Для IndyCar и F1 не вставляем дополнительный заголовок "Results" перед таблицей,
          // чтобы не дублировать контекст сессии (Sprint Qualifying / Qualifying и т.п.).
          if (!/^INDYCAR_/.test(evKeyEvent) && !/^F1_/.test(evKeyEvent)) {
            out += '<h4 class="table-section-title">Results</h4>';
          }

          // Разбиваем строки на сегменты по разделителю
          var segments = [];
          var segRows = [];
          var segTitle = null;
          qualRows.forEach(function (row) {
            var isSep = row.length > 0 && String(row[0] || '').trim() !== '' &&
              row.slice(1).every(function (c) { return c == null || String(c).trim() === ''; });
            if (isSep) {
              segments.push({ title: segTitle, rows: segRows });
              segRows = [];
              segTitle = String(row[0]).trim();
            } else {
              segRows.push(row);
            }
          });
          segments.push({ title: segTitle, rows: segRows });

          if (segments.length === 2) {
            // Merged table: rows 1–10 by Shoot Out position, rows 11–24 by qualifying position
            var seg0 = segments[0];
            var seg1 = segments[1];
            var h = qualHeaders;

            var seg0ByNum = {};
            seg0.rows.forEach(function (r) {
              var num = String(r[1] || '').trim();
              if (num) seg0ByNum[num] = r;
            });
            var seg1ByNum = {};
            seg1.rows.forEach(function (r) {
              var num = String(r[1] || '').trim();
              if (num) seg1ByNum[num] = r;
            });
            var top10Nums = {};
            seg1.rows.forEach(function (r) {
              var num = String(r[1] || '').trim();
              if (num) top10Nums[num] = true;
            });

            var commonIdx = [0, 1, 2, 3];
            var dataIdx   = [4, 5, 6, 7];
            var soDataIdx = [4, 5]; // Shoot Out: only Fastest Lap, Gap (no Lap, Laps)

            var seg0Label = seg0.title || 'Qualifying';
            var seg1Label = 'Shoot Out Race 2';

            out += '<div class="table-wrap"><table class="data-table pre-season-results-table qualifying-results-table qual-merged-table">';
            out += '<thead>';
            out += '<tr class="qual-group-header-row">';
            out += '<th colspan="' + commonIdx.length + '"></th>';
            out += '<th colspan="' + dataIdx.length + '" class="col-group-header">' + esc(seg0Label) + '</th>';
            out += '<th colspan="' + (soDataIdx.length + 1) + '" class="col-group-header">' + esc(seg1Label) + '</th>';
            out += '</tr>';
            out += '<tr>';
            commonIdx.forEach(function (i) { out += '<th>' + esc(h[i] || '') + '</th>'; });
            dataIdx.forEach(function (i) { out += '<th>' + esc(h[i] || '') + '</th>'; });
            out += '<th>' + esc(h[0] || 'Pos') + '</th>';
            soDataIdx.forEach(function (i) { out += '<th>' + esc(h[i] || '') + '</th>'; });
            out += '</tr>';
            out += '</thead><tbody>';

            var mergedRows = [];
            var displayOrder = [];
            // Rows 1–10: by Shoot Out position (seg1.rows already ordered 1..10)
            seg1.rows.forEach(function (soRow, i) {
              var num = String(soRow[1] || '').trim();
              var qualRow = seg0ByNum[num] || null;
              if (!qualRow) return;
              var pos = i + 1;
              var rowCells = [pos, qualRow[1], qualRow[2], qualRow[3]];
              dataIdx.forEach(function (j) { rowCells.push(qualRow[j] != null ? qualRow[j] : ''); });
              rowCells.push(soRow[0]);
              soDataIdx.forEach(function (j) { rowCells.push(soRow[j] != null ? soRow[j] : '—'); });
              mergedRows.push(rowCells);
              displayOrder.push({ row: qualRow, so: soRow, cells: rowCells });
            });
            // Rows 11–24: by qualifying position (seg0 rows not in top 10)
            var restQual = seg0.rows.filter(function (row) {
              var num = String(row[1] || '').trim();
              return !top10Nums[num];
            });
            restQual.sort(function (a, b) {
              var pa = parseInt(a[0], 10) || 0;
              var pb = parseInt(b[0], 10) || 0;
              return pa - pb;
            });
            restQual.forEach(function (qualRow) {
              var rowCells = [];
              commonIdx.forEach(function (i) { rowCells.push(qualRow[i] != null ? qualRow[i] : ''); });
              dataIdx.forEach(function (i) { rowCells.push(qualRow[i] != null ? qualRow[i] : ''); });
              rowCells.push('—');
              soDataIdx.forEach(function () { rowCells.push('—'); });
              mergedRows.push(rowCells);
              displayOrder.push({ row: qualRow, so: null, cells: rowCells });
            });

            function driversToLinks(s) {
              if (s == null || String(s).trim() === '') return '—';
              return String(s).split(/\s*;\s*/).map(function (p) {
                var t = p.trim();
                if (!t) return '';
                var d = driverDisplayName(t);
                return '<a href="/driver/' + encodeURIComponent(slugify(d)) + '" class="track-link">' + esc(d) + '</a>';
              }).filter(Boolean).join('; ');
            }
            function teamToLink(s) {
              if (s == null || String(s).trim() === '') return '—';
              var t = String(s).trim();
              return '<a href="/team/' + encodeURIComponent(slugify(t)) + '" class="track-link">' + esc(t) + '</a>';
            }
            displayOrder.forEach(function (item) {
              var row = item.row;
              var so = item.so;
              var rowCells = item.cells;
              out += '<tr' + (so ? ' class="qual-row-in-shootout"' : '') + '>';
              out += '<td>' + esc(String(rowCells[0] != null ? rowCells[0] : '')) + '</td>';
              out += '<td>' + esc(String(rowCells[1] != null ? rowCells[1] : '')) + '</td>';
              out += '<td>' + driversToLinks(rowCells[2]) + '</td>';
              out += '<td>' + teamToLink(rowCells[3]) + '</td>';
              dataIdx.forEach(function (_, j) { out += '<td>' + esc(String(rowCells[4 + j] != null ? rowCells[4 + j] : '')) + '</td>'; });
              out += '<td class="' + (so ? 'qual-so-pos' : 'qual-so-empty') + '">' + esc(String(rowCells[8] != null ? rowCells[8] : '—')) + '</td>';
              for (var k = 0; k < soDataIdx.length; k++) {
                var val = rowCells[9 + k];
                out += '<td class="' + (so ? '' : 'qual-so-empty') + '">' + esc(val != null ? String(val) : '—') + '</td>';
              }
              out += '</tr>';
            });

            out += '</tbody></table></div>';
            sortQueue.push({
              rows: mergedRows,
              getRowClass: function (row) {
                var soPos = row[8];
                return (soPos != null && String(soPos).trim() !== '' && String(soPos).trim() !== '—') ? 'qual-row-in-shootout' : '';
              }
          });
        } else {
            var qualTbl = transformTableDataForF2F3({ headers: qualHeaders, rows: qualRows });
            var imsaQualFitClass = (evKeyEvent === 'IMSA_2026_2') ? ' imsa-qual-fit' : '';
            var qualResult = buildTableSection(null, qualTbl, 'pre-season-results-table qualifying-results-table' + imsaQualFitClass);
            if (qualResult) {
              var qualHtml = qualResult.html;
              if (evKeyEvent === 'IMSA_2026_1' || evKeyEvent === 'IMSA_2026_2') {
                qualHtml = qualHtml.replace('<div class="table-wrap">', '<div class="table-wrap table-wrap--no-scroll">');
              }
              out += qualHtml;
              sortQueue.push({ rows: qualResult.rows, getRowClass: qualResult.getRowClass });
            }
          }
        }
        return out;
      }
      if (q && Array.isArray(q.sessions) && q.sessions.length > 0) {
        html += '<div class="event-pre-season-block">';
        q.sessions.forEach(function (sess, idx) {
          if (idx > 0) html += '<hr class="event-pre-season-divider">';
          html += renderOneQualSession(sess);
        });
        html += '</div>';
        if (q.note && typeof q.note === 'string' && q.note.trim()) {
          html += '<p class="race-note">' + esc(q.note.trim()) + '</p>';
        }
      } else if (q && (q.title || q.meta) && q.headers && Array.isArray(q.rows)) {
        html += '<div class="event-pre-season-block">';
        html += renderOneQualSession(q);
        html += '</div>';
      } else if (q && Array.isArray(q.headers) && q.headers.length === 1 && (q.headers[0] || '').toLowerCase().trim() === 'note' && Array.isArray(q.rows) && q.rows.length === 1 && q.rows[0] && q.rows[0].length === 1) {
        html += '<p class="race-note">' + esc(String(q.rows[0][0] || '').trim()) + '</p>';
      } else if (q) {
        // Для некоторых серий (например, NOAPS_2026_3) таблица qualifying содержит
        // строки-разделители ["Qualified by owner's points", "", ...] и ["Failed to qualify", "", ...].
        // Разбиваем её на несколько таблиц: основная квалификация, затем блоки с этими заголовками.
        var qBase = normalizeImsaQualTable(q);
        var rowsQ = Array.isArray(qBase.rows) ? qBase.rows.slice() : [];
        var segmentsQ = [];
        var labelsQ = [];
        var currentSeg = [];
        function isQualSeparatorRow(row) {
          if (!row || row.length === 0) return false;
          var first = String(row[0] || '').trim();
          if (!first) return false;
          var nonEmptyRest = false;
          for (var i = 1; i < row.length; i++) {
            if (row[i] != null && String(row[i]).trim() !== '') { nonEmptyRest = true; break; }
          }
          if (nonEmptyRest) return false;
          var l = first.toLowerCase();
          return l === "qualified by owner's points" || l === 'failed to qualify';
        }
        rowsQ.forEach(function (row) {
          if (isQualSeparatorRow(row)) {
            if (currentSeg.length) {
              segmentsQ.push(currentSeg);
              currentSeg = [];
            }
            labelsQ.push(String(row[0] || '').trim());
          } else {
            currentSeg.push(row);
          }
        });
        if (currentSeg.length) segmentsQ.push(currentSeg);

        function qualRowsWithTeamNames(rows) {
          if (!rows || !rows.length) return rows;
          return (isStockCar && byNumber) ? applyTeamNameByNumber(rows, 1, 3) : rows;
        }
        var qExtraClass = 'pre-season-results-table qualifying-results-table' + (evKeyEvent === 'IMSA_2026_2' ? ' imsa-qual-fit' : '');
        if (segmentsQ.length === 0) {
          appendTable(t('table.qualifying'), { headers: qBase.headers, rows: qualRowsWithTeamNames(qBase.rows) }, qExtraClass, null, false);
        } else {
          // первая таблица — основная квалификация
          appendTable(t('table.qualifying'), { headers: qBase.headers, rows: qualRowsWithTeamNames(segmentsQ[0]) }, qExtraClass, null, false);
          // остальные — по заголовкам из separator-строк
          for (var si = 1; si < segmentsQ.length; si++) {
            var lbl = labelsQ[si - 1] || t('table.qualifying');
            appendTable(lbl, { headers: qBase.headers, rows: qualRowsWithTeamNames(segmentsQ[si]) }, qExtraClass, null, false);
          }
        }
      }
      if (q && q.note && typeof q.note === 'string' && q.note.trim() && !(q.sessions && Array.isArray(q.sessions) && q.sessions.length > 0)) {
        html += '<p class="race-note">' + esc(q.note.trim()) + '</p>';
      }
      appendTable(t('table.last_chance'),     d.tables && d.tables.last_chance, null, null, false);
      appendTable(t('table.did_not_qualify'), d.tables && d.tables.did_not_qualify, null, null, false);
    }

    if (!html) { contentEl.innerHTML = '<p class="empty-msg">' + t('error.no_section_data') + '</p>'; return; }
    contentEl.innerHTML = html;

    // Специальные заметки под квалификацией для отдельных этапов F1.
    if (section === 'qualifying') {
      var qualNoteText = null;
      if (evKeyEvent === 'F1_2025_3') {
        qualNoteText = 'Carlos Sainz Jr. received a three-place grid penalty for impeding Lewis Hamilton in Q2.';
      } else if (evKeyEvent === 'F1_2025_4') {
        qualNoteText = 'George Russell and Kimi Antonelli both received a one-place grid penalty for entering the fast lane in the pit lane before a re-start time was confirmed.';
      }
      if (qualNoteText) {
        var qualNote = document.createElement('p');
        qualNote.className = 'race-note';
        qualNote.textContent = qualNoteText;
        contentEl.appendChild(qualNote);
      }
    }
    // Только таблицы с данными (исключаем Session info field-value), чтобы порядок совпадал с sortQueue
    var tables = contentEl.querySelectorAll('.data-table:not(.table-field-value)');
    [].forEach.call(tables, function (table, idx) {
      var q = sortQueue[idx];
      if (q && q.rows) makeTableSortable(table, q.rows, esc, q.getRowClass);
    });
  }

  function slugify(str) {
    return String(str).toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/ł/g, 'l')
      .replace(/[^a-z0-9\u0400-\u04ff]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  var allViewIds = ['view-list', 'view-detail', 'view-event', 'view-track', 'view-driver', 'view-team', 'view-crew-chief', 'view-schedule'];
  function showView(activeId) {
    if (activeId !== 'view-list') stopNextRaceTimers();
    allViewIds.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList[id === activeId ? 'remove' : 'add']('hidden');
    });
  }

  function renderEntityPage(type, slug, placeholder) {
    showView('view-' + type);
    var name = decodeURIComponent(slug).replace(/-+/g, ' ');
    document.getElementById(type + '-title').textContent = name;
    document.getElementById(type + '-meta').textContent = '';
    document.getElementById(type + '-breadcrumb').innerHTML =
      '<a href="/">' + t('breadcrumb.all') + '</a>' +
      '<span class="breadcrumb-sep">/</span>' +
      '<span>' + esc(name) + '</span>';
    document.getElementById(type + '-content').innerHTML = '<p class="empty-msg">' + placeholder + '</p>';
    document.title = name + ' — The Grid Archive (TGA)';
    loadedSeriesId = null;
  }

  /** Slug (as in /track/…) → hero image under /web/. */
  var trackPagePhotoBySlug = {
    'rockingham-speedway-rockingham-north-carolina': '/web/rockingham-speedway.jpg',
    'rockingham-speedway': '/web/rockingham-speedway.jpg'
  };

  function renderTrackDetail(slug) {
    renderEntityPage('track', slug, t('coming_soon.track'));
    try {
      var dec = decodeURIComponent(String(slug || ''));
      var key = slugify(dec);
      var photoUrl = trackPagePhotoBySlug[key] || trackPagePhotoBySlug[dec.toLowerCase().replace(/^-+|-+$/g, '')];
      if (photoUrl) {
        var trackContent = document.getElementById('track-content');
        if (trackContent) {
          trackContent.innerHTML =
            '<figure class="track-page-photo-wrap"><img class="track-page-photo" src="' + esc(photoUrl) + '" alt=""></figure>' +
            '<p class="empty-msg">' + t('coming_soon.track') + '</p>';
        }
      }
    } catch (err) { /* ignore bad slug */ }
  }
  function renderDriverDetail(slug) {
    showView('view-driver');
    // Защита от out-of-order ответов при быстрых переходах между водителями.
    var reqToken = (window.__tgaDriverReqToken = (window.__tgaDriverReqToken || 0) + 1);
    function titleCaseWords(str) {
      if (!str) return '';
      return String(str)
        .split(/\s+/)
        .filter(Boolean)
        .map(function (w) {
          if (!w) return w;
          return w.charAt(0).toUpperCase() + w.slice(1);
        })
        .join(' ');
    }

    var nameFromSlug = decodeURIComponent(slug).replace(/-+/g, ' ');
    nameFromSlug = titleCaseWords(nameFromSlug);
    document.getElementById('driver-title').textContent = nameFromSlug;
    document.getElementById('driver-meta').textContent = '';
    document.getElementById('driver-breadcrumb').innerHTML =
      '<a href="/">' + t('breadcrumb.all') + '</a>' +
      '<span class="breadcrumb-sep">/</span>' +
      '<span>' + esc(nameFromSlug) + '</span>';
    document.getElementById('driver-content').innerHTML = '<p class="empty-msg">' + t('coming_soon.driver') + '</p>';

    // cache-busting: photo_url из driver_profiles.json может обновляться,
    // а браузер способен закешировать старый JSON-ответ.
    fetchJSON('/api/driver/' + encodeURIComponent(slug) + '?_=' + Date.now())
      .then(function (data) {
        if (reqToken !== window.__tgaDriverReqToken) return;
        if (!data || typeof data !== 'object') return;
        var fullName = (data.name && String(data.name).trim()) ? String(data.name).trim() : '';
        // В заголовке показываем "простое имя" (из slug), чтобы full name был отдельной строкой ниже.
        var metaPartsHtml = [];
        if (fullName) {
          metaPartsHtml.push('Full name: ' + esc(fullName));
        }
        // Driver title comes from slug and may lose diacritics; prefer correct spelling for known cases.
        var titleEl = document.getElementById('driver-title');
        if (titleEl && fullName) {
          if (fullName === 'Nicolas Hülkenberg') {
            titleEl.textContent = 'Nico Hülkenberg';
          } else if (fullName === 'Sergio Michel Pérez Mendoza') {
            // Canonical display for alias slug `sergio-p-rez` (рез вместо Pérez).
            titleEl.textContent = 'Sergio Pérez';
          }
        }
        if (data.citizenship && data.citizenship.trim()) {
          function isoFromCountry(country) {
            if (!country) return '';
            var c = String(country).trim();
            if (!c) return '';
            var lower = c.toLowerCase();
            var iso = '';
            // mapping for the most common variants we use in driver_profiles.json
            if (lower === 'britain' || lower === 'great britain' || lower === 'uk' || lower === 'united kingdom') iso = 'GB';
            else if (lower === 'england') iso = 'GB';
            else if (lower === 'italy' || lower === 'italian republic') iso = 'IT';
            else if (lower === 'monaco' || lower === 'monegasque') iso = 'MC';
            else if (lower === 'spain' || lower === 'españa' || lower === 'kingdom of spain') iso = 'ES';
            else if (lower === 'belgium' || lower === 'kingdom of belgium') iso = 'BE';
            else if (lower === 'france' || lower === 'french republic') iso = 'FR';
            else if (
              lower === 'germany' ||
              lower === 'deutschland' ||
              lower === 'federal republic of germany' ||
              lower === 'german'
            ) iso = 'DE';
            else if (lower === 'new zealand' || lower === 'aotearoa') iso = 'NZ';
            else if (lower === 'australia' || lower === 'commonwealth of australia') iso = 'AU';
            else if (lower === 'canada' || lower === 'canadian') iso = 'CA';
            else if (lower === 'mexico' || lower === 'mexican') iso = 'MX';
            else if (lower === 'argentina' || lower === 'argentine republic' || lower === 'republic of argentina') iso = 'AR';
            else if (lower === 'brazil' || lower === 'brasil' || lower === 'federative republic of brazil' || lower === 'republic of brazil') iso = 'BR';
            else if (lower === 'netherlands' || lower === 'holland' || lower === 'kingdom of the netherlands') iso = 'NL';
            else if (lower === 'thailand' || lower === 'thai' || lower === 'kingdom of thailand') iso = 'TH';
            else if (lower === 'finland' || lower === 'republic of finland') iso = 'FI';
            else if (lower === 'russia' || lower === 'russian federation') iso = 'RU';
            else if (lower === 'usa' || lower === 'united states' || lower === 'united states of america') iso = 'US';
            else if (/^[A-Za-z]{2}$/.test(c)) iso = c.toUpperCase();
            return iso;
          }

          function flagSvgHtmlFromIso(iso) {
            if (!iso) return '';
            iso = String(iso).toUpperCase();
            // Inline SVG to avoid emoji font issues.
            if (iso === 'GB') {
              // Simplified Union Jack (good enough for UI).
              return '<span class="citizenship-flag">' +
                '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">' +
                '<rect width="18" height="12" fill="#012169"/>' +
                '<path d="M0 0 L18 12" stroke="#FFFFFF" stroke-width="4"/>' +
                '<path d="M18 0 L0 12" stroke="#FFFFFF" stroke-width="4"/>' +
                '<path d="M0 0 L18 12" stroke="#C8102E" stroke-width="2"/>' +
                '<path d="M18 0 L0 12" stroke="#C8102E" stroke-width="2"/>' +
                '<rect x="0" y="5" width="18" height="2" fill="#FFFFFF"/>' +
                '<rect x="0" y="5" width="18" height="1" fill="#C8102E"/>' +
                '<rect x="8.5" y="0" width="1" height="12" fill="#FFFFFF"/>' +
                '<rect x="9" y="0" width="0.5" height="12" fill="#C8102E"/>' +
                '</svg>' +
                '</span>';
            }

            if (iso === 'IT') {
              // Italy: vertical tricolor
              return '<span class="citizenship-flag">' +
                '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">' +
                '<rect x="0"  y="0" width="6"  height="12" fill="#009246"/>' +
                '<rect x="6"  y="0" width="6"  height="12" fill="#FFFFFF"/>' +
                '<rect x="12" y="0" width="6"  height="12" fill="#CE2B37"/>' +
                '</svg>' +
                '</span>';
            }

            if (iso === 'FR') {
              // France: vertical tricolor
              return '<span class="citizenship-flag">' +
                '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">' +
                '<rect x="0"  y="0" width="6" height="12" fill="#0055A4"/>' +
                '<rect x="6"  y="0" width="6" height="12" fill="#FFFFFF"/>' +
                '<rect x="12" y="0" width="6" height="12" fill="#EF4135"/>' +
                '</svg>' +
                '</span>';
            }

            if (iso === 'DE') {
              // Germany: black-red-gold horizontal
              return '<span class="citizenship-flag">' +
                '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">' +
                '<rect x="0" y="0" width="18" height="4" fill="#000000"/>' +
                '<rect x="0" y="4" width="18" height="4" fill="#DD0000"/>' +
                '<rect x="0" y="8" width="18" height="4" fill="#FFCE00"/>' +
                '</svg>' +
                '</span>';
            }

            if (iso === 'BE') {
              // Belgium: vertical black-yellow-red
              return '<span class="citizenship-flag">' +
                '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">' +
                '<rect x="0"  y="0" width="6"  height="12" fill="#000000"/>' +
                '<rect x="6"  y="0" width="6"  height="12" fill="#FFD100"/>' +
                '<rect x="12" y="0" width="6"  height="12" fill="#EF3340"/>' +
                '</svg>' +
                '</span>';
            }

            if (iso === 'NZ') {
              // New Zealand: full flag image (PNG from Wikimedia) inside inline SVG.
              var newZealandFlagPng = 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/Flag_of_New_Zealand.svg/960px-Flag_of_New_Zealand.svg.png?_=20260320';
              return '<span class="citizenship-flag">' +
                '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">' +
                '<image href="' + newZealandFlagPng + '" x="0" y="0" width="18" height="12" preserveAspectRatio="none"/>' +
                '</svg>' +
                '</span>';
            }

            if (iso === 'AU') {
              // Australia: full flag image (PNG from Wikimedia) inside inline SVG.
              var australiaFlagPng = 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/Flag_of_Australia.svg/960px-Flag_of_Australia.svg.png?_=20260320';
              return '<span class="citizenship-flag">' +
                '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">' +
                '<image href="' + australiaFlagPng + '" x="0" y="0" width="18" height="12" preserveAspectRatio="none"/>' +
                '</svg>' +
                '</span>';
            }

            if (iso === 'MC') {
              // Monaco: national flag is a simple bicolor (red over white).
              return '<span class="citizenship-flag">' +
                '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">' +
                '<rect width="18" height="6" fill="#D52B1E"/>' +
                '<rect x="0" y="6" width="18" height="6" fill="#FFFFFF"/>' +
                '</svg>' +
                '</span>';
            }

            if (iso === 'ES') {
              // Spain: use the correct flag image (includes coat of arms) inside inline SVG.
              // Note: we embed a PNG to avoid copying huge SVG markup into JS.
              var spainFlagPng = 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9a/Flag_of_Spain.svg/960px-Flag_of_Spain.svg.png?_=20240115205409';
              return '<span class="citizenship-flag">' +
                '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">' +
                '<image href="' + spainFlagPng + '" x="0" y="0" width="18" height="12" preserveAspectRatio="none"/>' +
                '</svg>' +
                '</span>';
            }

            if (iso === 'AR') {
              // Argentina: full flag with sun/escudo, embedded as PNG.
              var argentinaFlagPng = 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Flag_of_Argentina.svg/960px-Flag_of_Argentina.svg.png?_=20260320';
              return '<span class="citizenship-flag">' +
                '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">' +
                '<image href="' + argentinaFlagPng + '" x="0" y="0" width="18" height="12" preserveAspectRatio="none"/>' +
                '</svg>' +
                '</span>';
            }

            if (iso === 'BR') {
              // Brazil: full flag (stars + globe), embedded as PNG.
              var brazilFlagPng = 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Flag_of_Brazil.svg/960px-Flag_of_Brazil.svg.png?_=20260320';
              return '<span class="citizenship-flag">' +
                '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">' +
                '<image href="' + brazilFlagPng + '" x="0" y="0" width="18" height="12" preserveAspectRatio="none"/>' +
                '</svg>' +
                '</span>';
            }

            if (iso === 'MX') {
              // Mexico: full flag embedded as PNG.
              var mexicoFlagPng = 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fc/Flag_of_Mexico.svg/960px-Flag_of_Mexico.svg.png?_=20260320';
              return '<span class="citizenship-flag">' +
                '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">' +
                '<image href="' + mexicoFlagPng + '" x="0" y="0" width="18" height="12" preserveAspectRatio="none"/>' +
                '</svg>' +
                '</span>';
            }

            if (iso === 'NL') {
              // Netherlands: horizontal red-white-blue
              return '<span class="citizenship-flag">' +
                '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">' +
                '<rect x="0" y="0"  width="18" height="4" fill="#AE1C28"/>' +
                '<rect x="0" y="4"  width="18" height="4" fill="#FFFFFF"/>' +
                '<rect x="0" y="8"  width="18" height="4" fill="#21468B"/>' +
                '</svg>' +
                '</span>';
            }

            if (iso === 'TH') {
              // Thailand: full flag with emblem, embedded as PNG.
              var thailandFlagPng = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Flag_of_Thailand.svg/960px-Flag_of_Thailand.svg.png?_=20260320';
              return '<span class="citizenship-flag">' +
                '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">' +
                '<image href="' + thailandFlagPng + '" x="0" y="0" width="18" height="12" preserveAspectRatio="none"/>' +
                '</svg>' +
                '</span>';
            }
            if (iso === 'CA') {
              // Canada: full flag, embedded as PNG.
              var canadaFlagPng = 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cf/Flag_of_Canada.svg/960px-Flag_of_Canada.svg.png?_=20260320';
              return '<span class="citizenship-flag">' +
                '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">' +
                '<image href="' + canadaFlagPng + '" x="0" y="0" width="18" height="12" preserveAspectRatio="none"/>' +
                '</svg>' +
                '</span>';
            }

            if (iso === 'FI') {
              // Finland: embed as PNG to keep exact Nordic cross proportions.
              var finlandFlagPng = 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/Flag_of_Finland.svg/960px-Flag_of_Finland.svg.png?_=20260320';
              return '<span class="citizenship-flag">' +
                '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">' +
                '<image href="' + finlandFlagPng + '" x="0" y="0" width="18" height="12" preserveAspectRatio="none"/>' +
                '</svg>' +
                '</span>';
            }

            return '';
          }

          function splitCitizenships(citizenshipStr) {
            var s = String(citizenshipStr || '').trim();
            if (!s) return [];
            // Normalize common separators to commas.
            s = s
              .replace(/\s*;\s*/g, ',')
              .replace(/\s*,\s*/g, ',')
              .replace(/\s*\+\s*/g, ',')
              .replace(/\s*\/\s*/g, ',')
              .replace(/\s*&\s*/g, ',')
              .replace(/\s+and\s+/gi, ',')
              .replace(/\s+or\s+/gi, ',');
            return s
              .split(',')
              .map(function (x) {
                var v = String(x).trim();
                var lower = v.toLowerCase();
                if (lower === 'britain' || lower === 'uk' || lower === 'united kingdom') return 'Great Britain';
                return v;
              })
              .filter(function (x) { return x; });
          }

          var citizenshipCountries = splitCitizenships(data.citizenship);
          if (citizenshipCountries.length > 0) {
            // "Основное" гражданство для гонок считаем последним элементом в строке.
            // Примеры из driver_profiles.json:
            // - Albon: "Britain, Thailand" => основной Thailand
            // - Verstappen: "Belgium, Netherlands" => основной Netherlands
            var mainCountry = citizenshipCountries[citizenshipCountries.length - 1];

            // Упорядочиваем так: основной сверху, остальные снизу в исходном порядке.
            var orderedCountries = [mainCountry];
            for (var i = 0; i < citizenshipCountries.length - 1; i++) {
              orderedCountries.push(citizenshipCountries[i]);
            }

            var citizenshipPartsHtml = orderedCountries.map(function (country) {
              var iso = isoFromCountry(country);
              var flagHtml = flagSvgHtmlFromIso(iso);
              return (flagHtml ? flagHtml + ' ' : '') + esc(country);
            });

            if (citizenshipCountries.length > 1) {
              metaPartsHtml.push(esc(t('driver.citizenship')) + ':<br>' + citizenshipPartsHtml.join('<br>'));
            } else {
              metaPartsHtml.push(esc(t('driver.citizenship')) + ': ' + citizenshipPartsHtml[0]);
            }
          }
        } else if (data.nationality && data.nationality.trim()) {
          // fallback, если citizenship ещё не заполнен
          metaPartsHtml.push(esc(data.nationality.trim()));
        }
        function formatBirthDate(dateStr) {
          // API обычно отдаёт YYYY-MM-DD. На странице пилота нужен DD-MM-YYYY.
          var s = String(dateStr || '').trim();
          var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
          if (!m) return s;
          return m[3] + '-' + m[2] + '-' + m[1];
        }
        function calcBirthAge(dateStr) {
          // Нужны годы с учётом текущей даты: возраст = разница лет минус, если день рождения ещё не случился в этом году.
          var s = String(dateStr || '').trim();
          var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
          if (!m) return null;
          var y = parseInt(m[1], 10);
          var mo = parseInt(m[2], 10);
          var d = parseInt(m[3], 10);
          if (!y || !mo || !d) return null;
          var birth = new Date(y, mo - 1, d);
          if (isNaN(birth.getTime())) return null;
          var now = new Date();
          var age = now.getFullYear() - birth.getFullYear();
          var monthDiff = now.getMonth() - birth.getMonth();
          if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age--;
          return age;
        }
        if (data.birth_date && data.birth_date.trim()) {
          var birthDateStr = data.birth_date.trim();
          var formattedBirth = formatBirthDate(birthDateStr);
          var birthAge = calcBirthAge(birthDateStr);
          metaPartsHtml.push(
            'Born: ' +
            esc(formattedBirth) +
            (birthAge !== null && birthAge !== undefined ? ' (' + esc(String(birthAge)) + ')' : '')
          );
        }
        if (data.birth_place && data.birth_place.trim()) {
          metaPartsHtml.push('Home town: ' + esc(data.birth_place.trim()));
        }
        // Вертикальный список строк.
        document.getElementById('driver-meta').innerHTML = metaPartsHtml.join('<br>');
        document.title = (data.name || nameFromSlug) + ' — The Grid Archive (TGA)';

        // Driver photo (placeholder when not provided)
        var photoEl = document.getElementById('driver-photo');
        if (photoEl) {
          var photoUrl = (data.photo_url && data.photo_url.trim()) ? data.photo_url.trim() : '';
          if (!photoUrl) {
            var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="14" fill="rgba(125,125,125,0.18)"/><text x="48" y="54" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="14" fill="rgba(125,125,125,0.9)">No Photo</text></svg>';
            photoEl.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
          } else {
            // Cache-buster гарантирует новый запрос при каждом SPA-переходе.
            // Не сбрасываем src в '', чтобы не получить лишний запрос на текущую страницу
            // и не нарваться на "батчинг" двух присвоений подряд.
            var sep = photoUrl.indexOf('?') >= 0 ? '&' : '?';
            var newSrc = photoUrl + sep + '_=' + Date.now();
            // Полный сброс без побочного запроса.
            photoEl.removeAttribute('src');
            // На всякий случай: чтобы браузер не решил отложить загрузку.
            photoEl.loading = 'eager';
            photoEl.src = newSrc;
          }
          photoEl.alt = data.name ? (data.name + ' photo') : 'Driver photo';
        }

        var contentEl = document.getElementById('driver-content');
        var results = data.season_results;
        var season = data.season || '';
        if (Array.isArray(results) && results.length > 0) {
          var hasRaceName = results.some(function (r) {
            return r && r.race_name && String(r.race_name).trim() !== '';
          });
          // Для F1: если в рамках одного event_id есть sprint, то Feature должен
          // обозначаться вторым рядом. Иначе "Feature" не показываем.
          var hasSprintByEvent = {};
          results.forEach(function (r) {
            if (!r) return;
            var seriesIdUpper = String(r.series_id || '').toUpperCase();
            if (seriesIdUpper !== 'F1') return;
            var raw = (r.race_name || '').toString();
            if (/sprint/i.test(raw)) {
              hasSprintByEvent[r.event_id] = true;
            }
          });
          var tableRows = results.map(function (row) {
            var eventName = (row.event_name && row.event_name.trim()) ? esc(row.event_name) : (row.event_id || '—');
            var eventHref = (row.event_id) ? '/event/' + encodeURIComponent((row.event_id + '').toLowerCase().replace(/_/g, '-')) : '#';
            var eventCell = eventHref !== '#' ? '<a href="' + eventHref + '" class="event-link">' + eventName + '</a>' : eventName;
            var raceCell = '';
            if (hasRaceName) {
              var raceLabel = '';
              var rawRaceName = (row.race_name || '').trim();
              if (rawRaceName) {
                var seriesIdUpper = String(row.series_id || '').toUpperCase();
                if (seriesIdUpper === 'F1') {
                  // Для F1 хотим короткий и аккуратный лейбл: "Sprint" вместо "Sprint Results",
                  // а основную гонку можно не подписывать.
                  if (/sprint/i.test(rawRaceName)) {
                    raceLabel = 'Sprint';
                  } else {
                    // Feature показываем только если в этом же event_id есть sprint.
                    raceLabel = hasSprintByEvent[row.event_id] ? 'Feature' : '';
                  }
                } else {
                  raceLabel = rawRaceName;
                }
              }
              raceCell = '<td>' + esc(raceLabel) + '</td>';
            }
            return '<tr data-series-id="' + esc(row.series_id || '') + '" data-event-id="' + esc(row.event_id || '') + '">' +
              '<td>' + esc(row.series_name || row.series_id || '—') + '</td>' +
              '<td>' + eventCell + '</td>' +
              raceCell +
              '<td class="col-num">' + (row.position != null ? row.position : '—') + '</td>' +
              '<td class="col-num">' + (row.points != null ? row.points : '—') + '</td>' +
              (row.car_number ? '<td class="col-num">' + esc(row.car_number) + '</td>' : '') +
              '<td>' + (row.laps != null ? row.laps : '') + '</td>' +
              (row.status ? '<td>' + esc(row.status) + '</td>' : '') +
              '</tr>';
          });
          var carHeader = results.some(function (r) { return r.car_number; }) ? '<th class="col-num">' + t('th.no') + '</th>' : '';
          var statusHeader = results.some(function (r) { return r.status; }) ? '<th>' + t('th.status') + '</th>' : '';
          contentEl.innerHTML =
            '<h4 class="table-section-title">' + esc(t('driver.season_results')) + (season ? ' ' + esc(season) : '') + '</h4>' +
            '<div class="table-wrap"><table class="data-table">' +
            '<thead><tr>' +
            '<th>' + (t('home.series_col') || 'Series') + '</th>' +
            '<th>' + t('th.event') + '</th>' +
            (hasRaceName ? '<th>' + t('th.race_col') + '</th>' : '') +
            '<th class="col-num">' + t('th.pos') + '</th>' +
            '<th class="col-num">' + t('th.pts') + '</th>' +
            carHeader +
            '<th>' + t('section.laps') + '</th>' +
            statusHeader +
            '</tr></thead><tbody>' + tableRows.join('') + '</tbody></table></div>';

          // Объединяем повторяющиеся ячейки в колонках Series/Event
          // для подряд идущих строк с одинаковым event_id.
          var tableEl = contentEl.querySelector('table.data-table');
          if (tableEl && tableEl.tBodies && tableEl.tBodies.length) {
            var tbody = tableEl.tBodies[0];
            var rows = Array.prototype.slice.call(tbody.rows || []);
            if (rows.length > 1) {
              // Колонки: 0 = Series, 1 = Event
              function mergeByKey(colIndex, keyFn) {
                var i = 0;
                while (i < rows.length) {
                  var key = keyFn(rows[i]);
                  var start = i;
                  var end = i + 1;
                  while (end < rows.length && keyFn(rows[end]) === key) {
                    end++;
                  }
                  var span = end - start;
                  if (span > 1 && rows[start].cells[colIndex]) {
                    rows[start].cells[colIndex].rowSpan = span;
                    // прячем ячейки-«дубликаты» на нижних строках
                    for (var k = start + 1; k < end; k++) {
                      if (rows[k].cells[colIndex]) rows[k].cells[colIndex].style.display = 'none';
                    }
                  }
                  i = end;
                }
              }

              mergeByKey(0, function (tr) {
                // Series должно объединяться только внутри одного event
                return (tr.getAttribute('data-series-id') || '') + '|' + (tr.getAttribute('data-event-id') || '');
              });
              mergeByKey(1, function (tr) {
                return tr.getAttribute('data-event-id') || '';
              });
            }
          }
        } else {
          contentEl.innerHTML = '<p class="empty-msg">' + t('driver.no_season_results') + '</p>';
        }
      })
      .catch(function () {
        var contentEl = document.getElementById('driver-content');
        if (contentEl) contentEl.innerHTML = '<p class="empty-msg">' + (t('error.load_failed') || 'Failed to load. Please try again.') + '</p>';
      });
    loadedSeriesId = null;
  }
  function renderTeamDetail(slug) {
    renderEntityPage('team', slug, t('coming_soon.team'));
  }
  function renderCrewChiefDetail(slug) {
    renderEntityPage('crew-chief', slug, t('coming_soon.crew_chief'));
  }

  function route() {
    var path = window.location.pathname;
    var search = window.location.search || '';
    if (path !== path.toLowerCase() && (path.indexOf('/series/') === 0 || path.indexOf('/event/') === 0)) {
      history.replaceState(null, '', path.toLowerCase());
      path = path.toLowerCase();
    }
    var seriesList = document.getElementById('series-list');

    if (path === '/' || path === '') {
      // Отдельный режим: кнопка "Full Schedule" ведёт на /?full_schedule=1
      if (search.indexOf('full_schedule=1') !== -1) {
        loadedSeriesId = null;
        renderSchedulePage();
        return;
      }
      loadedSeriesId = null;
      document.title = 'The Grid Archive (TGA) — 2026';
      showView('view-list');
      renderList(seriesList);
      return;
    }
    if (path === '/schedule') {
      loadedSeriesId = null;
      renderSchedulePage();
        return;
      }
    if (path.indexOf('/event/') === 0) {
      var evRest    = path.slice('/event/'.length);
      var evSlash   = evRest.indexOf('/');
      var evId      = decodeURIComponent(evSlash >= 0 ? evRest.slice(0, evSlash) : evRest);
      var evSection = evSlash >= 0 ? evRest.slice(evSlash + 1).replace(/\/.*$/, '') : '';
      if (evId) { renderEventPage(evId, evSection); return; }
    }
    if (path.indexOf('/track/') === 0) {
      var trackSlug = path.slice('/track/'.length).replace(/\/.*$/, '');
      if (trackSlug) { renderTrackDetail(trackSlug); return; }
    }
    if (path.indexOf('/driver/') === 0) {
      var driverSlug = path.slice('/driver/'.length).replace(/\/.*$/, '');
      // Canonical slug for Hülkenberg:
      // - stored profile uses "nico-h-lkenberg" (ü -> dash)
      // - user-facing URL should use "nico-hulkenberg" (ü -> u)
      // - tables may generate "nicolas-hulkenberg" depending on whether they show "Nico" or "Nicolas"
      var hulkenbergCanonical = null;
      if (driverSlug === 'nico-h-lkenberg' || driverSlug === 'nicolas-hulkenberg' || driverSlug === 'nicolas-h-lkenberg') {
        hulkenbergCanonical = '/driver/nico-hulkenberg';
      }
      if (hulkenbergCanonical && path + search !== hulkenbergCanonical) {
        history.replaceState(null, '', hulkenbergCanonical);
        driverSlug = 'nico-hulkenberg';
      }

      // Canonical slug for Sergio Pérez.
      // DB profile uses "sergio-p-rez" because "é" may turn into '-' during slugification,
      // but user-facing URL should stay "sergio-perez".
      if (driverSlug === 'sergio-p-rez') {
        var perezCanonical = '/driver/sergio-perez';
        if (path + search !== perezCanonical) {
          history.replaceState(null, '', perezCanonical);
          driverSlug = 'sergio-perez';
        }
      }
      if (driverSlug) { renderDriverDetail(driverSlug); return; }
    }
    if (path.indexOf('/team/') === 0) {
      var teamSlug = path.slice('/team/'.length).replace(/\/.*$/, '');
      if (teamSlug) { renderTeamDetail(teamSlug); return; }
    }
    if (path.indexOf('/crew-chief/') === 0) {
      var crewChiefSlug = path.slice('/crew-chief/'.length).replace(/\/.*$/, '');
      if (crewChiefSlug) { renderCrewChiefDetail(crewChiefSlug); return; }
    }
    // Страницы сезона F1: /season/f1-2025, /season/f1-2025/standings и т.д. (1950–2025)
    if (path.indexOf('/season/') === 0) {
      var seasonRest = path.slice('/season/'.length);
      var seasonSlash = seasonRest.indexOf('/');
      var seasonSlug = (seasonSlash >= 0 ? seasonRest.slice(0, seasonSlash) : seasonRest).replace(/^\/+|\/+$/g, '');
      var seasonSubPath = seasonSlash >= 0 ? seasonRest.slice(seasonSlash + 1).replace(/\/.*$/, '') : '';
      try { seasonSlug = decodeURIComponent(seasonSlug); } catch (e) {}
      if (seasonSlug && seasonSlug.indexOf('f1-') === 0) {
        // Для исторических сезонов F1 (в т.ч. f1-2025) убираем переключатель часового пояса.
        var tzDetail = document.getElementById('time-zone-select-detail');
        if (tzDetail && tzDetail.parentElement) {
          tzDetail.parentElement.classList.add('hidden');
        }
        renderDetail(seasonSlug, seasonSubPath);
        return;
      }
    }
    if (path.indexOf('/series/') === 0) {
      var rest = path.slice('/series/'.length);
      var slash = rest.indexOf('/');
      var id = (slash >= 0 ? rest.slice(0, slash) : rest).replace(/^\/+|\/+$/g, '');
      try { id = decodeURIComponent(id); } catch (e) {}
      // URL использует дефисы (nascar-cup); в коде — подчёркивания (nascar_cup)
      id = id.replace(/-/g, '_');
      if (id === 'nascar_xfinity') id = 'noaps';
      var subPath = slash >= 0 ? rest.slice(slash + 1).replace(/\/.*$/, '') : '';
      // IMSA: /specs ведёт на ту же панель, что и /classes — подменяем URL на /classes
      if (id === 'imsa' && subPath === 'specs') {
        history.replaceState(null, '', '/series/imsa/classes');
        subPath = 'classes';
      }
      if (id) {
        renderDetail(id, subPath);
        return;
      }
    }
    loadedSeriesId = null;
    showView('view-list');
    renderList(seriesList);
  }

  // Инициализация статических переводов (без переключателя языка)
  translateStaticUI();
  var footerEl = document.getElementById('footer-text');
  if (footerEl) footerEl.textContent = t('footer');

  window.addEventListener('popstate', route);
  document.addEventListener('click', function (e) {
    var link = e.target && e.target.closest && e.target.closest('a[href]');
    if (!link) return;

    // Уважаем стандартное поведение браузера: новые вкладки, модификаторы, внешние ссылки.
    if (e.defaultPrevented) return;
    if (e.button && e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (link.target && link.target.toLowerCase() === '_blank') return;
    if (link.hasAttribute('download')) return;

    var href = link.getAttribute('href');
    if (!href || href.charAt(0) !== '/' || href.indexOf('/web/') === 0 || href.indexOf('/api/') === 0) return;

    // Series-nav tabs get the panel fade transition
    if (link.closest('#series-nav') && href.indexOf('/series/') === 0) {
      e.preventDefault();
      var wrap = document.getElementById('detail-panels-wrap');
      if (wrap) {
        wrap.style.height = wrap.offsetHeight + 'px';
        wrap.classList.add('detail-panels-fade-out');
      }
      window.scrollTo(0, 0);
      setTimeout(function () {
        history.pushState(null, '', href);
        route();
        requestAnimationFrame(function () {
          if (wrap) {
            wrap.classList.remove('detail-panels-fade-out');
            requestAnimationFrame(function () { if (wrap) wrap.style.height = ''; });
          }
        });
      }, 180);
      return;
    }

    // All other internal links — plain SPA navigation
    e.preventDefault();
    window.scrollTo(0, 0);
    if (href !== window.location.pathname + window.location.search) {
      history.pushState(null, '', href);
    }
    route();
  });
  route();

  // Для NASCAR Cup: колонка DAY должна основываться только на Daytona 500,
  // без учёта выставочного Cook Out Clash (NASCAR_CUP_2026_0).
  function rebuildNascarCupDayFromDaytona(baseData) {
    if (!baseData || typeof baseData !== 'object') return Promise.resolve(baseData);
    var raceOrder = Array.isArray(baseData.race_order) ? baseData.race_order.slice() : [];
    if (raceOrder.indexOf('DAY') < 0) return Promise.resolve(baseData);

    var eventId = 'NASCAR_CUP_2026_1'; // Daytona 500
    return fetchJSON('/api/events/' + encodeURIComponent(eventId.toLowerCase()))
      .then(function (d) {
        if (!d || typeof d !== 'object') return baseData;
        if (d.data && typeof d.data === 'object') d = d.data;
        if (d.event && typeof d.event === 'object') d = d.event;
        if (Array.isArray(d) && d.length > 0) d = d[0];

        var rr = d.tables && d.tables.race_results;
        if (!rr || !Array.isArray(rr.headers) || !Array.isArray(rr.rows)) return baseData;

        var headers = rr.headers;
        var posCol = headers.indexOf('Pos');
        var drvCol = headers.indexOf('Driver');
        if (posCol < 0 || drvCol < 0) return baseData;

        var posByDriver = {};
        rr.rows.forEach(function (row) {
          if (!row || posCol >= row.length || drvCol >= row.length) return;
          var drv = String(row[drvCol] || '').trim();
          var pos = String(row[posCol] || '').trim();
          if (!drv) return;
          if (!pos) pos = 'DNQ';
          posByDriver[drv] = pos;
        });

        var rows = Array.isArray(baseData.rows) ? baseData.rows.slice() : [];
        var newRows = rows.map(function (r) {
          if (!r) return r;
          var drvName = driverDisplayName(String(r.driver || '').trim());
          var val = posByDriver[drvName];
          if (!r.races || typeof r.races !== 'object') r.races = {};
          // Если пилота нет в протоколе Daytona 500 — не трогаем существующее значение
          // (оно может быть DNQ/— из базы standings).
          if (val) {
            r.races.DAY = val;
          }
          return r;
        });

        var out = {};
        for (var k in baseData) if (Object.prototype.hasOwnProperty.call(baseData, k)) out[k] = baseData[k];
        out.rows = newRows;
        return out;
      })
      .catch(function () { return baseData; });
  }

  // ─── F1 static specs fallback (series F1 + season F1-2025) ─────────────────
  function renderF1StaticSpecsIfNeeded() {
    var path = (window.location && window.location.pathname) || '';
    if (path.indexOf('/series/f1/specs') !== 0 && path.indexOf('/season/f1-2025/specs') !== 0) return;

    var carWrap = document.getElementById('car-spec-wrap');
    var techSpecWrap = document.getElementById('technical-spec-table-wrap');
    if (!carWrap || !techSpecWrap) return;

    carWrap.classList.remove('hidden');
    var carModelsTitle = carWrap.querySelector('h4[data-i18n="specs.car_models"]');
    var techSpecTitle = carWrap.querySelector('h4[data-i18n="specs.tech_spec"]');
    if (carModelsTitle) carModelsTitle.classList.add('hidden');
    if (techSpecTitle) techSpecTitle.classList.add('hidden');

    var specsPanel = document.getElementById('specs-panel');
    if (specsPanel) {
      var specsTitle = specsPanel.querySelector('h3[data-i18n="section.h3.specs"]');
      if (specsTitle) {
        specsTitle.textContent = path.indexOf('/season/f1-2025/specs') === 0
          ? 'Technical regulations 2025'
          : 'Technical regulations 2026';
      }
    }

    var rowsSource = null;
    if (path.indexOf('/season/f1-2025/specs') === 0) {
      rowsSource = (window.F1_2025_TECH_SPEC || (window.TGA && window.TGA.F1_2025_TECH_SPEC)) || [];
    } else {
      rowsSource = window.F1_2026_TECH_SPEC || [];
    }
    if (!rowsSource || !rowsSource.length) return;

    var sections = [];
    var curTitle = '';
    var curRows = [];
    rowsSource.forEach(function (s) {
      if ((s.key || '') === '__SECTION__') {
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
  }

  window.addEventListener('load', renderF1StaticSpecsIfNeeded);

})();
