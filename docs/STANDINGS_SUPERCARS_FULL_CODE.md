# Весь код для http://localhost:8080/series/supercars/standings

Цепочка: **URL → роутинг → renderDetail → fetch standings → API → ответ → renderStandings.**

---

## 1. Роутинг API (бэкенд)

**cmd/server/main.go** — обработчик для `/api/series/`:
```go
http.HandleFunc("/api/series/", apiWrap(func(w http.ResponseWriter, r *http.Request) {
    handleSeries(w, r, dataDir, st)
}))
```

**cmd/server/handlers_series.go** — разбор пути и вызов standings:
```go
func handleSeries(w http.ResponseWriter, r *http.Request, dataDir string, st store.Store) {
    suffix := strings.TrimPrefix(r.URL.Path, "/api/series/")
    parts := strings.SplitN(suffix, "/", 2)
    seriesID := parts[0]           // "supercars"
    subPath := ""
    if len(parts) == 2 {
        subPath = parts[1]        // "standings"
    }
    dataSeriesID := config.DataSeriesID(seriesID)
    // ...
    switch subPath {
    case "standings":
        handleSeriesStandings(w, r, dataDir, dataSeriesID, st, seasonStr)
    // ...
    }
}
```

---

## 2. Роутинг страницы (фронт)

**web/app.js** — при открытии `/series/supercars/standings`:
```javascript
// route() при path === '/series/supercars/standings'
if (path.indexOf('/series/') === 0) {
  var rest = path.slice('/series/'.length);      // "supercars/standings"
  var slash = rest.indexOf('/');
  var id = (slash >= 0 ? rest.slice(0, slash) : rest).replace(/^\/+|\/+$/g, '');
  id = id.replace(/-/g, '_');                    // "supercars"
  var subPath = slash >= 0 ? rest.slice(slash + 1).replace(/\/.*$/, '') : '';  // "standings"
  if (id) {
    renderDetail(id, subPath);                   // renderDetail('supercars', 'standings')
    return;
  }
}
```

---

## 3. renderDetail и запрос standings (фронт)

**web/app.js** — начало renderDetail и запрос standings (внутри renderDetail):
```javascript
function renderDetail(seriesId, subPath) {
  subPath = subPath || '';
  // ... панели, нав, показ view-detail ...
  // При subPath === 'standings' показывается standings-panel

  // Запрос standings (один из параллельных fetch в renderDetail):
  fetchJSON('/api/series/' + encodeURIComponent((seriesId || '').toLowerCase()) + '/standings?_=' + Date.now())
    .then(function (data) {
      function renderStandings(dataObj) { /* см. ниже */ }
      // ...
      renderStandings(data);   // вызов с ответом API
    })
    .catch(function () { standingsEmpty.classList.remove('hidden'); standingsEmpty.textContent = t('standings.empty') || 'No standings data.'; });
}
```

---

## 4. handleSeriesStandings (бэкенд) — формирование ответа

**cmd/server/handlers_series.go**:
```go
func handleSeriesStandings(w http.ResponseWriter, _ *http.Request, dataDir, dataSeriesID string, st store.Store, season string) {
    if season == "" {
        season = config.CurrentSeason
    }

    // Путь 1: БД — F1, F2, F3, Supercars
    if st != nil && (strings.EqualFold(dataSeriesID, "F1") || ... || strings.EqualFold(dataSeriesID, "SUPERCARS")) {
        seriesID := strings.ToUpper(dataSeriesID)
        data, err = buildStandingsFromStore(ctx, st, seriesID, season)
        if data != nil && len(data.Rows) > 0 {
            if strings.EqualFold(dataSeriesID, "SUPERCARS") {
                schedulefile.NormalizeSupercarsStandingsToSeven(data)
                schedulefile.EnrichSupercarsStandingsWithMelbourne(dataDir, data)
            }
            _ = json.NewEncoder(w).Encode(data)
            return
        }
        data = nil
    }

    // Путь 2: не IMSA — BuildStandingsFromEvents / LoadStandings
    if !IMSA {
        data, err = schedulefile.BuildStandingsFromEvents(dataDir, dataSeriesID)
        if data == nil {
            data, _ = schedulefile.LoadStandings(dataDir, dataSeriesID)
        }
        if Supercars && (data == nil || len(data.Rows) == 0) {
            if built, _ := schedulefile.BuildSupercarsStandingsFromFiles(dataDir); built != nil && len(built.Rows) > 0 {
                data = built
            }
        }
    }

    if data != nil {
        schedulefile.EnsureCompletedRaces(dataDir, dataSeriesID, data)
    }
    if data != nil && len(data.Rows) > 0 && dataSeriesID != "ARCA" {
        schedulefile.EnrichStagesFromEvents(dataDir, dataSeriesID, data)
    }
    // Принудительно 7 колонок для Supercars, если пришли 3
    if data != nil && len(data.Rows) > 0 && strings.EqualFold(dataSeriesID, "SUPERCARS") && len(data.RaceOrder) == 3 {
        schedulefile.NormalizeSupercarsStandingsToSeven(data)
        schedulefile.EnrichSupercarsStandingsWithMelbourne(dataDir, data)
    }
    _ = json.NewEncoder(w).Encode(data)
}
```

---

## 5. buildStandingsFromStore (бэкенд) — данные из БД для Supercars

**cmd/server/handlers_series.go** — фрагмент с Supercars:
- Собирает события/гонки/результаты из БД, заполняет `raceOrder` и `byDriver`.
- Для Supercars нормализует до 7 колонок:

```go
if strings.EqualFold(seriesID, "SUPERCARS") && len(raceOrder) > 0 {
    const supercarsCols = 7
    nRacesWithData := len(raceOrder)
    supercarsRaceCodes := []string{"SMP1", "SMP2", "SMP3", "MLB4", "MLB5", "MLB6", "MLB7"}
    newOrder := [7]string с supercarsRaceCodes
    for i, a := range list {
        newRaces := make(map[string]string)
        for j := 0; j < supercarsCols; j++ {
            if j < len(raceOrder) && a.races[raceOrder[j]] != "" {
                newRaces[newOrder[j]] = a.races[raceOrder[j]]
            }
        }
        list[i].races = newRaces
    }
    raceOrder = newOrder
    completedRaces = newOrder[:nRacesWithData]
}
return &StandingsData{RaceOrder: raceOrder, EventNames: eventNames, CompletedRaces: completedRaces, Rows: rows}
```

---

## 6. schedulefile: нормализация и обогащение (бэкенд)

**internal/schedulefile/standings.go**:

- **NormalizeSupercarsStandingsToSeven** — если `len(data.RaceOrder) < 7`, дополняет до SMP1–SMP3, MLB4–MLB7 и переразмечает строки.
- **EnrichSupercarsStandingsWithMelbourne** — читает `data/events/supercars_2026_4.json`, заполняет MLB4–MLB7 только если MLB4 пустой (не перезаписывает БД).
- **BuildSupercarsStandingsFromFiles** — собирает standings только из файлов (Sydney + Melbourne), если БД не дала строк.

(Полные тела функций — в `internal/schedulefile/standings.go`, строки ~439–747.)

---

## 7. Рендер standings на фронте (Supercars)

**web/app.js** — внутри `renderStandings(dataObj)` при `sk === 'supercars'`:

- `raceOrder = (dataObj && dataObj.race_order) ? dataObj.race_order.slice() : [];` (строка ~2785).
- Блок для Supercars (двухстрочный заголовок и строки таблицы), строки ~2873–2965:

```javascript
// Условие двухстрочного заголовка Supercars:
if (theadEl && sk === 'supercars' &&
    raceOrder.length > 0 &&
    raceOrder.every(function (code) { return /^(SMP|MLB)\d+$/i.test(String(code || '')); })) {
  var topRow = '... colspan="' + raceOrder.length + '" ... Races ...';
  var bottomRow = '<tr id="standings-thead">';
  for (var j = 0; j < raceOrder.length; j++) {
    var num = String(raceOrder[j] || '').replace(/^(SMP|MLB)/i, '') || (j + 1);
    bottomRow += '<th class="col-race">' + esc(num) + '</th>';
  }
  theadEl.innerHTML = topRow + bottomRow;
  theadRow = document.getElementById('standings-thead');
} else if (theadRow) {
  theadRow.innerHTML = th;  // одна строка заголовков
}
// Строки таблицы:
for (var j = 0; j < raceOrder.length; j++) {
  var rval = row.races && row.races[raceOrder[j]] ? ... : '';
  td += '<td class="col-race">' + raceCell + '</td>';
}
```

Число колонок гонок на экране = `raceOrder.length` из ответа API.

---

## Проверка после деплоя (completed_races и данные)

**1. Сырой JSON**

```http
GET /api/series/supercars/standings
```

Ожидаемый вид при корректной работе:

```json
{
  "race_order": ["SMP1","SMP2","SMP3","MLB4","MLB5","MLB6","MLB7"],
  "completed_races": ["SMP1","SMP2","SMP3","MLB4","MLB5","MLB6","MLB7"],
  "rows": [
    { "driver": "Broc Feeney", "races": { "MLB4": "3", "MLB5": "1", ... } }
  ]
}
```

Проверить: длина `race_order` и `completed_races` совпадает (7), в `rows[*].races` есть ключи MLB4–MLB7 при наличии данных.

**2. Если `completed_races` = 7, но таблица всё равно показывает 3 колонки**

Значит фронт не использует `completed_races` для числа колонок (он берёт `race_order`). Тогда проблема не в `completed_races`. В консоли браузера смотреть лог:

```
[Standings] Supercars race_order from API: 7 [...]
```

Если там `3` — в ответе API приходит только 3 колонки: в БД по Melbourne ещё нет данных и `EnrichWithMelbourne` не подтягивает их (файл пустой или без результатов).

**3. Если `rows[*].races["MLB4"]` и остальные MLB пустые**

Данных по Melbourne нет ни в БД, ни в файле `supercars_2026_4.json` (или в файле нет результатов). Это не баг кода, а отсутствие внесённых данных.

---

## Как данные попадают в БД

**Кто вызывает UpsertResult / UpsertRace и т.д.:** не ручной скрипт и не POST API, а **bootstrap при каждом запуске сервера**.

**Цепочка (cmd/server/main.go → bootstrap.go):**

1. При старте вызывается `bootstrapStoreFromFiles(st, dataDir)`.
2. Серии — из `config.Championships` (UpsertSeries).
3. События — из `data/schedules/*.json` (LoadEvents → UpsertEvent).
4. Для Supercars дополнительно вызывается **importSupercarsFromRaceSessions**:
   - берёт список событий из расписания (только `season == CurrentSeason`);
   - для каждого события читает файл **`data/events/<eventID>.json`** (например `supercars_2026_4.json`);
   - ожидает в JSON структуру **`tables.race.sessions`** — массив сессий (Race 1, Race 2, …) с `headers` и `rows`;
   - по каждой сессии создаёт запись в `races` (id = `eventID:R1`, `:R2`, …) и строки в `results` из `rows` (Pos, Driver, Team, Points и т.д.).

**Итого:** данные в БД появляются **только** из JSON при старте сервера. Отдельной команды импорта в БД нет (см. `import_all.ps1` — он только напоминает, что данные правятся в `data/`). Редактирование вручную: `data/schedules/`, `data/events/`, затем **перезапуск сервера**.

Если Melbourne (event id в расписании, например `supercars_2026_4`) не попадает в БД:
- в `data/schedules/supercars.json` нет события с таким id на текущий сезон, или
- файл `data/events/supercars_2026_4.json` отсутствует / без `tables.race.sessions` / с пустыми `rows`.

**Проверка: есть ли в БД результаты по гонкам Supercars 2026 (в т.ч. Melbourne):**

```sql
SELECT r.name, COUNT(res.id) AS result_count
FROM races r
LEFT JOIN results res ON res.race_id = r.id
JOIN events e ON r.event_id = e.id
WHERE e.series_id = 'SUPERCARS' AND e.season = '2026'
GROUP BY r.id, r.name;
```

Если у гонок Melbourne `result_count = 0` — в БД их результатов нет; нужно убедиться, что есть нужный event в расписании, файл `data/events/supercars_2026_4.json` с заполненными `tables.race.sessions`, и перезапустить сервер.

---

## Сводка файлов и строк

| Роль | Файл | Строки (приблизительно) |
|------|------|--------------------------|
| Заполнение БД при старте | cmd/server/main.go, bootstrap.go | main 87; bootstrap 19–80, 302–413 (importSupercarsFromRaceSessions) |
| Роутинг API | cmd/server/main.go | 158–160 |
| Роутинг API series/standings | cmd/server/handlers_series.go | 60–117 (handleSeries, case "standings") |
| Обработчик standings | cmd/server/handlers_series.go | 427–519 (handleSeriesStandings) |
| Сбор из БД + нормализация Supercars | cmd/server/handlers_series.go | 255–424 (buildStandingsFromStore) |
| Нормализация/обогащение/сбор из файлов | internal/schedulefile/standings.go | 439–747 (BuildSupercars…, Normalize…, Enrich…) |
| Роутинг страницы | web/app.js | 6234–6251 (path /series/ → renderDetail) |
| renderDetail + fetch standings | web/app.js | 1407–…, 2709–2712, 3111 |
| renderStandings (race_order, Supercars UI) | web/app.js | 2711–2720, 2785, 2873–2965 |

Итог: от URL до таблицы всё завязано на одном ответе `/api/series/supercars/standings`. Количество колонок = `data.race_order.length` в этом ответе; фронт просто рисует по `race_order` и `rows`.
