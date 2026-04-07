# Код рендера для standings и event (Supercars)

## 1. `/series/supercars/standings`

### Сервер (отдача HTML + API)

**Роутинг:** все пути вида `/series/...` отдаются одним `index.html` (SPA).

```104:117:cmd/server/main.go
	http.HandleFunc("/event/", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, indexPath)
	})

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// ...
		if p == "/" || strings.HasPrefix(p, "/series") || ... {
			http.ServeFile(w, r, indexPath)
			return
		}
```

**API standings:** `GET /api/series/supercars/standings` → `handleSeries` → `handleSeriesStandings` (и при необходимости `buildStandingsFromStore` + Normalize/Enrich для Supercars).

- Файл: `cmd/server/handlers_series.go`
- Обработчик: `handleSeriesStandings` (примерно стр. 427), вызов из `handleSeries` по `subPath == "standings"`.

### Фронт (запрос и отрисовка)

**Роутинг:** при открытии `/series/supercars/standings` вызывается `renderDetail('supercars', 'standings')`.

```6234:6250:web/app.js
    if (path.indexOf('/series/') === 0) {
      var rest = path.slice('/series/'.length);
      var slash = rest.indexOf('/');
      var id = (slash >= 0 ? rest.slice(0, slash) : rest).replace(/^\/+|\/+$/g, '');
      // ...
      id = id.replace(/-/g, '_');
      var subPath = slash >= 0 ? rest.slice(slash + 1).replace(/\/.*$/, '') : '';
      if (id) {
        renderDetail(id, subPath);
        return;
      }
    }
```

**Запрос standings:** внутри `renderDetail` при открытой панели standings выполняется fetch к API.

```2709:2710:web/app.js
    fetchJSON('/api/series/' + encodeURIComponent((seriesId || '').toLowerCase()) + '/standings?_=' + Date.now())
      .then(function (data) {
```

**Рендер таблицы:** в колбэке вызывается `renderStandings(data)`. Для Supercars используется ветка с `race_order` и двухстрочным заголовком (ссылка на event).

```2711:2720:web/app.js
        function renderStandings(dataObj) {
          var currentSeriesId = seriesId;
          var sk = (currentSeriesId || '').toLowerCase().replace(/-/g, '_');
          // ...
          if (sk === 'supercars' && dataObj && dataObj.race_order) {
            console.log('[Standings] Supercars race_order from API:', dataObj.race_order.length, dataObj.race_order);
          }
```

Заголовок и ячейки по гонкам строятся по `raceOrder` из ответа; для Supercars дополнительно выводится ссылка на `/event/supercars_2026_1/race`:

```2914:2935:web/app.js
          if (theadEl && sk === 'supercars' &&
              raceOrder.length > 0 &&
              raceOrder.every(function (code) { return /^(SMP|MLB)\d+$/i.test(String(code || '')); })) {
            var supercarsEventHref = '/event/supercars_2026_1/race';
            var topRow = '<tr class="standings-header-row-top">';
            // ...
            topRow += '<th class="col-race-group" colspan="' + raceOrder.length + '"><a href="' + supercarsEventHref + '" class="standings-race-link">Races</a></th>';
            // ...
            for (var j = 0; j < raceOrder.length; j++) {
              var code = String(raceOrder[j] || '');
              var num = code.replace(/^(SMP|MLB)/i, '') || (j + 1);
              bottomRow += '<th class="col-race"><a href="' + supercarsEventHref + '" class="standings-race-link">' + esc(num) + '</th>';
            }
```

Строки таблицы (Pos, #, Driver, Team, Manufacturer, колонки гонок по `raceOrder`, Pts) собираются в `renderStandingsRows(list)` и выводятся в `#standings-table tbody` (примерно 2943–2960).

---

## 2. `/event/supercars_2026_1` и `/event/supercars_2026_4`

### Сервер

**Роутинг:** путь `/event/...` отдаёт тот же `index.html` (SPA).

```104:106:cmd/server/main.go
	http.HandleFunc("/event/", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, indexPath)
	})
```

**API события:** `GET /api/events/{eventId}` (например `supercars_2026_1`, `supercars_2026_4`) обрабатывается в `handleEvent`: читается файл из `data/events/`, при необходимости обогащается (Supercars, team names), ответ отдаётся как JSON.

```17:55:cmd/server/handlers_events.go
func handleEvent(w http.ResponseWriter, r *http.Request, dataDir string, _ *cache.TTL) {
	eventID := strings.TrimPrefix(r.URL.Path, "/api/events/")
	eventID = strings.TrimRight(eventID, "/")
	eventID = strings.TrimSpace(eventID)
	// ...
	cacheKey := strings.ToLower(eventID)
	path := filepath.Join(dataDir, "events", cacheKey+".json")
	body, err := os.ReadFile(path)
	// ...
	seriesID := strings.Split(eventID, "_")[0]
	if enriched, err := schedulefile.EnrichSupercarsEvent(body, dataDir, seriesID); err == nil {
		body = enriched
	}
	// ...
	_, _ = w.Write(body)
}
```

То есть данные для `supercars_2026_1` и `supercars_2026_4` берутся из `data/events/supercars_2026_1.json` и `data/events/supercars_2026_4.json`.

### Фронт

**Роутинг:** при открытии `/event/supercars_2026_1` или `/event/supercars_2026_1/race` (и аналогично для `supercars_2026_4`) вызывается `renderEventPage(eventId, section)`.

```6199:6204:web/app.js
    if (path.indexOf('/event/') === 0) {
      var evRest    = path.slice('/event/'.length);
      var evSlash   = evRest.indexOf('/');
      var evId      = decodeURIComponent(evSlash >= 0 ? evRest.slice(0, evSlash) : evRest);
      var evSection = evSlash >= 0 ? evRest.slice(evSlash + 1).replace(/\/.*$/, '') : '';
      if (evId) { renderEventPage(evId, evSection); return; }
    }
```

**Запрос события:** в `renderEventPage` данные забираются с `/api/events/{eventId}`.

```4651:4665:web/app.js
    fetchJSON('/api/events/' + encodeURIComponent((eventId || '').toLowerCase()) + '?_=' + Date.now())
      .then(function (d) {
        if (!d || typeof d !== 'object') throw new Error('Invalid response');
        // нормализация d (d.data, d.event, массив)
        eventCache[eventId] = d;
        try {
          renderWithData(d);
        } catch (err) {
          console.error('renderEventPage render error', err);
          // ...
        }
      })
```

**Рендер:** `renderWithData(d)` выставляет заголовок/крошки, навигацию по блокам (Overview, Race, Practice, Qualifying и т.д.) и вызывает либо `renderEventOverviewContent(d, eventId, contentEl)`, либо `renderEventSectionContent(d, section, contentEl, eventId)` в зависимости от `section` (пусто = overview, иначе например `race`). Контент блоков (таблицы, плитки) строится по полям `d` (в т.ч. `d.tables`, `d.entry_list` и т.д.).

- Функция: `renderEventPage` — `web/app.js` (около 4567).
- Внутри: `renderWithData`, `renderEventOverviewContent`, `renderEventSectionContent` — там же.

---

## Сводка

| URL | Сервер (отдача страницы) | API | Фронт: запрос | Фронт: рендер |
|-----|---------------------------|-----|----------------|----------------|
| `/series/supercars/standings` | `main.go`: ServeFile index.html | `handlers_series.go` → handleSeriesStandings | `app.js`: fetch `/api/series/supercars/standings` | `renderStandings()` в колбэке fetch, ветка Supercars (race_order, ссылка `/event/supercars_2026_1/race`) |
| `/event/supercars_2026_1`, `/event/supercars_2026_4` | `main.go`: ServeFile index.html | `handlers_events.go` → handleEvent, чтение `data/events/{id}.json` | `app.js`: fetch `/api/events/supercars_2026_1` или `supercars_2026_4` | `renderEventPage` → `renderWithData` → overview или `renderEventSectionContent` (race/practice/qualifying и т.д.) |
