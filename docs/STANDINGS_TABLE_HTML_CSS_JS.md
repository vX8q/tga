# Таблица Standings: HTML, CSS, JS

Фрагменты кода таблицы турнирной таблицы (в т.ч. Supercars с 7 колонками гонок).

---

## 1. HTML (разметка таблицы)

**Файл:** `web/index.html`

```html
<div id="standings-panel" class="series-panel hidden">
  <section class="standings-section">
    <h3 data-i18n="section.h3.standings">Standings</h3>
    <div class="standings-scroll-container">
      <div class="table-wrap standings-scroll-bottom" id="standings-wrap">
        <table class="data-table" id="standings-table">
          <thead><tr id="standings-thead"></tr></thead>
          <tbody></tbody>
        </table>
      </div>
      <div id="standings-imsa-wrap" class="hidden"></div>
    </div>
    <h4 id="standings-ineligible-title" class="table-section-title hidden" data-i18n="standings.ineligible">Ineligible for driver points</h4>
    <div id="standings-ineligible-scroll-container" class="standings-scroll-container hidden">
      <div id="standings-ineligible-wrap" class="table-wrap standings-scroll-bottom">
        <table class="data-table" id="standings-ineligible-table">
          <thead><tr id="standings-ineligible-thead"></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
    <p id="standings-empty" class="empty-msg hidden">No standings data.</p>
  </section>
</div>
```

Заголовок таблицы и строки заполняются из JS: `#standings-thead` — одна или две строки `<tr>`, `#standings-table tbody` — строки пилотов.

---

## 2. CSS (таблица и standings)

**Файл:** `web/style.css`

### Базовые стили таблицы (.data-table)

```css
.data-table {
  width: 100%;
  table-layout: auto;
  border-collapse: collapse;
  font-size: 0.9rem;
  min-width: 0;
}
.data-table thead,
.data-table tbody,
.data-table tr { vertical-align: middle; }
.data-table th,
.data-table td {
  padding: 0.75rem;
  text-align: left;
  vertical-align: middle;
  border-bottom: 1px solid var(--border);
  overflow: visible;
  text-overflow: clip;
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.data-table th {
  background: var(--border);
  font-weight: 600;
  color: var(--text);
  text-align: center;
  white-space: nowrap;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 0.72rem;
  line-height: 1;
}
.data-table th.sortable { cursor: pointer; user-select: none; }
.data-table th.sortable:hover { background: #333; }
.data-table th.sort-asc::after,
.data-table th.sort-desc::after {
  content: ' ↑';
  color: var(--accent);
  font-size: 0.75em;
  margin-left: 0.2em;
}
.data-table th.sort-desc::after { content: ' ↓'; }
.data-table tbody tr:nth-child(odd) td { background: transparent; }
.data-table tbody tr:nth-child(even) td { background: var(--row-alt); }
.data-table tbody tr:last-child td { border-bottom: none; }
.data-table .col-num { color: var(--text); white-space: nowrap; text-align: center; }
.data-table .col-race { min-width: 2rem; text-align: center; font-size: 0.85rem; }
.data-table .col-pts { font-weight: 600; }
.stage-pts { font-size: 0.6em; color: var(--muted); font-weight: 400; vertical-align: super; }
```

### Секция standings и скролл

```css
.standings-section { margin-bottom: 2rem; }
.standings-section h3 { margin: 0 0 0.75rem; font-size: 1.1rem; font-weight: 600; color: var(--text); }

.standings-scroll-container { display: block; }
.standings-section .standings-scroll-bottom {
  overflow-x: auto;
  scrollbar-gutter: stable;
  scrollbar-color: transparent transparent;
  scrollbar-width: none;
}
.standings-section .standings-scroll-bottom::-webkit-scrollbar { display: none; }
.standings-section .standings-scroll-bottom::-webkit-scrollbar-track { background: transparent; }
.standings-section .data-table {
  table-layout: auto;
  min-width: max-content;
}
.standings-section .data-table th,
.standings-section .data-table td {
  overflow: visible;
  text-overflow: clip;
  white-space: nowrap;
}
.standings-section .data-table thead th {
  padding-top: 0.25rem;
  padding-bottom: 0.25rem;
}
.standings-section .data-table th:nth-child(3),
.standings-section .data-table td:nth-child(3),
.standings-section .data-table th:nth-child(4),
.standings-section .data-table td:nth-child(4) {
  white-space: normal;
}
.standings-section .data-table .col-num { min-width: 2.5rem; width: 2.5rem; }
.standings-section .data-table .col-pts { min-width: 2.5rem; }
.standings-section .data-table .col-race { min-width: 2rem; text-align: center; }
```

### Supercars: двухстрочный заголовок и ссылки на гонки

```css
.col-race-group {
  text-align: center;
  border-bottom: 2px solid #000;
}
.standings-race-link {
  color: inherit;
  text-decoration: none;
}
.standings-race-link:hover {
  text-decoration: underline;
}
```

### Supercars-специфичные (группы, разделители — при использовании .supercars-table)

```css
.supercars-table .supercars-group-header {
  text-align: center;
  background: var(--border-2);
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.supercars-table .supercars-group-header-divider,
.supercars-table .supercars-col-divider {
  width: 1px;
  padding: 0;
  background: var(--border-2);
  border-left: 2px solid var(--border-3);
}
.supercars-table .manufacturer-cell {
  font-weight: 700;
  text-align: center;
  vertical-align: middle;
  color: var(--link);
}
```

---

## 3. JavaScript (запрос и рендер таблицы, ветка Supercars)

**Файл:** `web/app.js`

### Запрос standings и вызов рендера

```javascript
fetchJSON('/api/series/' + encodeURIComponent((seriesId || '').toLowerCase()) + '/standings?_=' + Date.now())
  .then(function (data) {
    function renderStandings(dataObj) {
      var currentSeriesId = seriesId;
      var sk = (currentSeriesId || '').toLowerCase().replace(/-/g, '_');
      if (sk === 'nascar_xfinity') sk = 'noaps';
      var rows = dataObj && dataObj.rows ? dataObj.rows : (Array.isArray(dataObj) ? dataObj : []);
      // ...
      var raceOrder = (dataObj && dataObj.race_order) ? dataObj.race_order.slice() : [];
      var completedRacesArr = (dataObj && dataObj.completed_races) ? dataObj.completed_races.slice() : [];
      var completedRacesSet = {};
      for (var cr = 0; cr < completedRacesArr.length; cr++) { completedRacesSet[completedRacesArr[cr]] = true; }
      // ...
      renderStandings(data);
    }
  })
  .catch(function () { standingsEmpty.classList.remove('hidden'); standingsEmpty.textContent = t('standings.empty') || 'No standings data.'; });
```

### Построение заголовка и tbody для Supercars (двухстрочный thead + строки)

Фрагмент внутри `renderStandings`, когда `sk === 'supercars'` и `race_order` из кодов SMP/MLB:

```javascript
var theadRow = document.getElementById('standings-thead');
var theadEl  = theadRow && theadRow.parentNode ? theadRow.parentNode : null;
var manufacturerLabel = t('th.manufacturer');
var hasCar = rows.some(function (r) { return r.car; });
// Supercars: двухстрочный заголовок
if (theadEl && sk === 'supercars' &&
    raceOrder.length > 0 &&
    raceOrder.every(function (code) { return /^(SMP|MLB)\d+$/i.test(String(code || '')); })) {
  var supercarsEventHref = '/event/supercars_2026_1/race';
  var topRow = '<tr class="standings-header-row-top">';
  topRow += '<th class="col-num" rowspan="2">' + t('th.pos') + '</th>';
  if (hasCar) topRow += '<th class="col-car" rowspan="2">' + t('th.no') + '</th>';
  topRow += '<th rowspan="2">' + t('th.driver') + '</th>';
  topRow += '<th rowspan="2">' + t('th.team') + '</th>';
  topRow += '<th rowspan="2">' + esc(manufacturerLabel) + '</th>';
  topRow += '<th class="col-race-group" colspan="' + raceOrder.length + '"><a href="' + supercarsEventHref + '" class="standings-race-link">Races</a></th>';
  topRow += '<th class="col-pts" rowspan="2">' + t('th.pts') + '</th></tr>';

  var bottomRow = '<tr id="standings-thead">';
  for (var j = 0; j < raceOrder.length; j++) {
    var code = String(raceOrder[j] || '');
    var num = code.replace(/^(SMP|MLB)/i, '') || (j + 1);
    bottomRow += '<th class="col-race"><a href="' + supercarsEventHref + '" class="standings-race-link">' + esc(num) + '</a></th>';
  }
  bottomRow += '</tr>';

  theadEl.innerHTML = topRow + bottomRow;
  theadRow = document.getElementById('standings-thead');
}
```

### Построение строк таблицы (одна функция для всех серий с колонками гонок)

```javascript
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
    td += '<td class="col-pts">' + esc(dash(row.points)) + '</td>';
    return '<tr>' + td + '</tr>';
  }).join('');
}
renderStandingsRows(rows);
```

После этого к заголовкам добавляются класс `sortable` и обработчики клика для сортировки по колонке (пересортировка `rowsCopy` и повторный вызов `renderStandingsRows`). Используются `esc()`, `dash()`, `driverDisplayName()`, `t()` из того же `app.js`.

---

## Сводка файлов

| Что | Файл |
|-----|------|
| HTML таблицы standings | `web/index.html` — блок `#standings-panel` с `#standings-wrap`, `#standings-table`, `#standings-thead`, tbody |
| CSS таблицы и standings | `web/style.css` — `.data-table`, `.standings-section`, `.col-race`, `.col-race-group`, `.standings-race-link`, `.supercars-table` |
| JS запрос и рендер | `web/app.js` — fetch `/api/series/.../standings`, функция `renderStandings`, ветка Supercars (двухстрочный thead), `renderStandingsRows`, сортировка по клику |
