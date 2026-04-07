# Код фронта: Standings Supercars (откуда берутся колонки гонок)

Страница `/series/supercars/standings` рендерится в **app.js** (функция `renderDetail` → fetch standings → `renderStandings(data)`).  
`tga-series.js` в index.html не подключается, используется только app.js.

---

## 1. Запрос standings (app.js)

- **Строки ~2709–2712:** запрос API и начало обработки ответа.
- Добавлен cache-buster `?_=' + Date.now()` и `console.log` для Supercars: в консоли браузера (F12 → Console) при открытии Standings будет строка вида  
  `[Standings] Supercars race_order from API: 7 ["SMP1","SMP2",...]`  
  Если там `3` и три кода — ответ API приходит с тремя колонками (или кэш). Если `7` — проблема в разметке/условиях ниже.

```javascript
fetchJSON('/api/series/' + encodeURIComponent((seriesId || '').toLowerCase()) + '/standings?_=' + Date.now())
  .then(function (data) {
    function renderStandings(dataObj) {
      var sk = ...;
      if (sk === 'supercars' && dataObj && dataObj.race_order) {
        console.log('[Standings] Supercars race_order from API:', dataObj.race_order.length, dataObj.race_order);
      }
      // ...
    }
    renderStandings(data);
    // ...
  });
```

---

## 2. Откуда берётся race_order для отрисовки (app.js)

- **Строка ~2783:**  
  `var raceOrder = (dataObj && dataObj.race_order) ? dataObj.race_order.slice() : [];`  
  Все заголовки и ячейки гонок строятся по этому `raceOrder` (его длина = число колонок гонок).

---

## 3. Ветка для Supercars: двухстрочный заголовок и тело таблицы (app.js)

- **Строки ~2873–2936:** общая таблица (Pos, #, Driver, Team, Manufacturer, гонки, Pts…).
- **Строки ~2910–2936:** условие для Supercars и подмена заголовка на два ряда (Races + номера 1–7):

  - Условие:  
    `theadEl && sk === 'supercars' && raceOrder.length > 0 && raceOrder.every(function (code) { return /^(SMP|MLB)\d+$/i.test(String(code || '')); })`
  - Если оно true: в thead пишутся две строки, во второй — по одному `<th>` на каждый элемент `raceOrder` (т.е. колонок столько, сколько в `raceOrder`).
  - Если false: используется одна строка заголовка `th`, тоже по одному `<th>` на каждый элемент `raceOrder` (строка ~2902–2904).

- **Строки ~2938–2960:** тело таблицы — цикл по `raceOrder` для каждой строки:

  - `for (var j = 0; j < raceOrder.length; j++)` и ячейки `row.races[raceOrder[j]]`.

Итого: число колонок гонок на фронте = `raceOrder.length` из ответа API. Если в консоли видно 7, а на экране 3 — значит, либо отрисовывается не этот блок (другая ветка), либо один и тот же `#standings-thead`/tbody перезаписывается позже другим кодом.

---

## 4. Где ещё может участвовать standings (на всякий случай)

- **tga-series.js** в этом проекте в index.html не подключён, поэтому для `/series/supercars/standings` он не используется.
- **series-supercars.js** — только хелперы (например, buildStandingsFromEvents для другого контекста); на рендер таблицы Standings в app.js не влияет.

---

## 5. Что проверить в браузере

1. Открыть `/series/supercars/standings`, F12 → Console.  
   Должна появиться строка:  
   `[Standings] Supercars race_order from API: 7 ["SMP1", "SMP2", "SMP3", "MLB4", "MLB5", "MLB6", "MLB7"]`
2. Если там `3` — проблема в ответе API или кэше (уже добавлен cache-buster).
3. Если там `7`, а колонок на экране всё равно 3 — смотреть в Elements, кто последним меняет `#standings-thead` и tbody таблицы standings (нет ли второго скрипта/обработчика, перезаписывающего таблицу).

Файлы и диапазоны строк:

| Файл       | Строки   | Назначение |
|-----------|----------|------------|
| web/app.js | 2709–2718 | Fetch standings + console.log для Supercars |
| web/app.js | 2782–2784 | race_order из dataObj |
| web/app.js | 2873–2908 | Заголовки (общие + manufacturer и т.д.) |
| web/app.js | 2910–2936 | Supercars: двухстрочный заголовок (Races + 1…7) |
| web/app.js | 2938–2960 | Отрисовка строк таблицы по raceOrder |
