# Series Rendering Templates

Справочник по структуре event-страниц для каждого типа серии.
Используется при создании/проверке JSON-файлов событий.

---

## Общая структура (все серии)

```
Страница события
├── Header: h1 — название гонки
├── Overview
│   ├── Laps / Distance (кроме IMSA, Supercars)
│   ├── Block navigation tiles (навигация по секциям)
│   ├── Track info (h4)
│   ├── Tyre compounds (только F1)
│   ├── Highlights / YouTube (h4)
│   └── Race Statistics (h4): Field | Value
├── Entry List
├── Practice
├── Qualifying
└── Race
```

### Иерархия заголовков

| Уровень | Назначение | CSS-класс |
|---------|-----------|-----------|
| h1 | Название события (заголовок страницы) | `.event-header h1` |
| h2 | Название секции (Entry List, Practice, Qualifying, Race) | `.event-data-section h2` |
| h3 | Заголовок сессии внутри секции (Sprint Results, Race Results, Qualifying) | `.event-pre-season-title` |
| h4 | Заголовок таблицы (Stage 1, Starting Grid, Laps Led, Penalties...) | `.table-section-title` |

---

## 1. NASCAR Cup / NOAPS (Xfinity) / Trucks / Modified / ARCA

**Категория:** `stockcar`
**Series IDs:** `nascar_cup`, `noaps`, `nascar_truck`, `nascar_modified`, `arca`

### Entry List

| # | Driver | Team | Manufacturer | Crew Chief |
|---|--------|------|-------------|------------|

- Без rowspan-объединения
- Сортировка: по номеру

### Practice (1, 2, 3, Final Practice)

Колонки приходят из данных, типичный набор:

| Pos | No. | Driver | Team | Time | Gap | Speed | Laps |
|-----|------|--------|------|------|-----|-------|------|

### Qualifying

Основная таблица квалификации + разделители:
- "Qualified by owner's points" — отдельная подтаблица
- "Failed to qualify" — отдельная подтаблица

Дополнительные таблицы (если есть):
- **Duel 1** (h4) — Daytona
- **Duel 2** (h4) — Daytona
- **Last Chance** (h4)
- **Did Not Qualify** (h4)

### Race

```
Race
├── h4 "Race Results" (основной заголовок, bold)
├── h4 "Stage 1 (N laps)" — таблица stage_1
├── h4 "Stage 2 (N laps)" — таблица stage_2
├── h4 "Stage 3 (N laps)" или "Race Results (N laps)"
├── Race Results table (колонки из данных, auto-ширины)
├── h4 "Penalties" (если есть)
├── h4 "Penalties added after the chequered flag" (если есть)
├── h4 "Race neutralisation" (если есть)
└── h4 "Caution Breakdown" (цветные строки: жёлтые/зелёные)
```

**Stage-таблицы** — CSS-класс `race-stage-table race-stage-table--points`:

| Pos | No. | Driver | Team | Manufacturer | Pts |
|-----|------|--------|------|-------------|-----|

**Ключи таблиц stage:** `stage_1`, `stage_2` (не `stage1`/`stage2`).

**Caution Breakdown** — есть колонка "Free Pass" (показывается для NASCAR, скрыта для IndyCar).

**race_statistics** — key-value объект на верхнем уровне JSON (не внутри `tables`).

**starting_lineup** — **не используется** (удалён из всех файлов).

### JSON-шаблон события (NASCAR Cup)

```json
{
  "event_id": "NASCAR_CUP_2026_7",
  "series": "NASCAR Cup Series",
  "race": "Cook Out 400",
  "date": "Sunday, March 29, 2026",
  "track": "Martinsville Speedway",
  "location": "Ridgeway, Virginia",
  "laps": "400",
  "distance": "210.4 miles (338.6 km)",
  "stage1_laps": "80",
  "stage2_laps": "160",
  "stage3_laps": "160",
  "event_preview": "...",
  "youtube_id": "...",
  "race_statistics": {
    "Lead changes": "...",
    "Cautions / Laps": "...",
    "Red flags": "...",
    "Time of race": "...",
    "Average speed": "..."
  },
  "entry_list": [
    {"number": "1", "driver": "...", "team": "...", "manufacturer": "...", "crew_chief": "..."}
  ],
  "tables": {
    "practice": {"headers": [...], "rows": [...]},
    "qualifying": {"headers": [...], "rows": [...]},
    "stage_1": {"headers": [...], "rows": [...]},
    "stage_2": {"headers": [...], "rows": [...]},
    "race_results": {"headers": [...], "rows": [...]},
    "caution_breakdown": {"headers": [...], "rows": [...]}
  }
}
```

---

## 2. Formula 1

**Категория:** `openwheel`
**Series ID:** `f1`

### Entry List

| # | Driver | Constructor | Chassis |
|---|--------|-------------|---------|

- Rowspan на Constructor + Chassis (гонщики одной команды объединяются)
- Для F1 2025: Chassis маппится из `F1_2025_ENTRY_CHASSIS`
- `entry_list` содержит поля: `number`, `driver`, `team`, `constructor`, `manufacturer`

### Practice (1, 2, 3)

**Формат 2026:** `sessions[]` — массив сессий внутри `practice`:
```json
"practice": {
  "sessions": [
    {"title": "Practice 1", "headers": [...], "rows": [...]},
    {"title": "Practice 2", "headers": [...], "rows": [...]},
    {"title": "Practice 3", "headers": [...], "rows": [...]}
  ]
}
```

**Формат 2025:** отдельные ключи `practice`, `practice2`, `practice3` внутри `tables`.

### Qualifying

**Формат 2026:** `sessions[]` — массив сессий:
```json
"qualifying": {
  "sessions": [
    {"title": "Qualifying", "headers": [...], "rows": [...]}
  ]
}
```

Мульти-сессионный формат:
```
Qualifying
├── h3 "Sprint Qualifying" (если есть)
│   ├── h4 "Session info" — мета-таблица (Date, Session, Length...)
│   └── Таблица результатов (БЕЗ доп. h4 "Results")
└── h3 "Qualifying"
    ├── h4 "Session info"
    └── Таблица результатов
```

### Race

Мульти-сессионный формат:
```
Race
├── h3 "Sprint Results" (если спринт-уикенд)
│   ├── h4 "Session info"
│   ├── Таблица результатов
│   └── Penalties / VSC
├── h3 "Race Results"
│   ├── h4 "Session info"
│   ├── Таблица результатов (10 колонок, фиксированные ширины)
│   ├── h4 "Pit Stops" — визуальный стинт-чарт с цветами шин
│   ├── h4 "Penalties during the race"
│   ├── h4 "Penalties added after the chequered flag"
│   └── h4 "Race neutralisation / VSC"
```

**Race Results — 10 колонок с фиксированными ширинами:**

| Pos | No. | Driver | Team | Laps | Time | Grid | Laps Led | Best Lap | Pts |
|-----|------|--------|------|------|------|------|----------|----------|-----|
| 6%  | 6%   | 4%     | 18%  | 24%  | 10%  | 6%   | 6%       | 12%      | 6%  |

- **Pit Stops** — стинт-чарт: H=white, M=yellow, S=red, I=green, W=blue
- **starting_lineup** — не используется
- **laps_led / best_laps** — не используются как отдельные таблицы (данные встроены в race_results)
- **race_statistics** — не используется для F1
- Формат названия гонки: `"YYYY Grand Prix Name"` (напр. `"2026 Japanese Grand Prix"`)

### JSON-шаблон события (F1 2026)

```json
{
  "event_id": "F1_2026_3",
  "series": "Formula 1",
  "race": "2026 Japanese Grand Prix",
  "date": "29 March 2026",
  "track": "Suzuka Circuit",
  "location": "Suzuka",
  "laps": "53",
  "distance": "307.471 km",
  "event_preview": "...",
  "tyre_compounds": "Hard: C2, Medium: C3, Soft: C4",
  "youtube_id": "...",
  "entry_list": [
    {"number": "1", "driver": "...", "constructor": "Red Bull Racing", "manufacturer": "Red Bull Racing-Honda RBPT", "team": "Red Bull"}
  ],
  "tables": {
    "practice": {
      "sessions": [
        {"title": "Practice 1", "headers": [...], "rows": [...]},
        {"title": "Practice 2", "headers": [...], "rows": [...]},
        {"title": "Practice 3", "headers": [...], "rows": [...]}
      ]
    },
    "qualifying": {
      "sessions": [
        {"title": "Qualifying", "headers": [...], "rows": [...]}
      ]
    },
    "race_results": {"headers": [...], "rows": [...]},
    "pit_stops": {"headers": [...], "rows": [...]},
    "penalties": {"headers": [...], "rows": [...]},
    "vsc": {"headers": [...], "rows": [...]}
  }
}
```

---

## 3. F2 / F3

**Категория:** `openwheel`
**Series IDs:** `f2`, `f3`

### Entry List

| # | Team | Driver |
|---|------|--------|

- Rowspan на Team (2 гонщика на команду)
- **Порядок колонок**: Team ПЕРЕД Driver (отличие от всех остальных серий)

### Qualifying / Race

Структура как у F1 (мульти-сессионная), но:
- Колонка "Manufacturer" переименовывается → "Team"
- Колонка "Chassis" — удаляется
- Сессии: Sprint + Feature Race

---

## 4. IndyCar

**Категория:** `openwheel`
**Series ID:** `indycar`

### Entry List

| # | Driver | Team | Engine |
|---|--------|------|--------|

- Rowspan на Team + Engine
- Engine = `entry.manufacturer` или `entry.engine`

### Practice

Стандартный формат (flat, не sessions[]):
```json
"practice": {
  "title": "Practice 1",
  "headers": ["Rank", "Car", "Driver Name", "C/E/T", "Time", "Speed", "Diff", "Gap", "Best Lap", "Laps"],
  "rows": [["1", "3", "McLaughlin, Scott", "D/C/F", "01:01.1020", "106.052", "--.----", "--.----", "24", "27"], ...]
}
```

- **Driver Name** — формат `"Имя Фамилия"` (First Last)
- **C/E/T** — `D/{C|H}/F` (Dallara / Chevrolet или Honda / Firestone)
- Дополнительные сессии: `practice2`, `final_practice`

### Qualifying

Как у F1 — мульти-сессионная, без доп. h4 "Results".
- **Driver Name** (в таблице qualifying) — формат `"Имя Фамилия"` (First Last)

### Race

```
Race
├── Race Results table (колонки из данных, auto-ширины)
├── h4 "Penalties"
├── h4 "Race neutralisation"
└── h4 "Caution Breakdown" (колонка "Free Pass" СКРЫТА)
```

- **Нет stage-таблиц**
- **Нет фиксированных ширин колонок**
- **starting_lineup** — не используется
- **race_statistics** — не используется
- В Caution Breakdown удалена последняя колонка "Free Pass"
- Формат даты: `"1 March 2026"` (день месяц год)
- Нулевые laps_led: `"0"` (не `"--"` или `"–"`)
- **Формат distance (важно)**: `"214.200 miles (344.700 km)"` — строго `miles (km)` как в IndyCar 2026 (`indycar_2026_2/3`), без `mi / km`
- **Driver** (в `race_results`) — формат `"Имя Фамилия"` (First Last), например `"Alex Palou"` (в отличие от practice/qualifying)

### JSON-шаблон события (IndyCar)

```json
{
  "event_id": "INDYCAR_2026_1",
  "series": "IndyCar Series",
  "race": "Firestone Grand Prix of St. Petersburg",
  "date": "1 March 2026",
  "track": "Streets of St. Petersburg",
  "location": "St. Petersburg, Florida",
  "laps": "100",
  "distance": "180.000 miles (289.682 km)",
  "event_preview": "...",
  "youtube_id": "...",
  "entry_list": [
    {"number": "2", "driver": "Josef Newgarden", "team": "Team Penske", "manufacturer": "Chevrolet"}
  ],
  "tables": {
    "practice": {"title": "Practice 1", "headers": [...], "rows": [...]},
    "practice2": {"title": "Practice 2", "headers": [...], "rows": [...]},
    "final_practice": {"title": "Final Practice", "headers": [...], "rows": [...]},
    "qualifying": {"title": "Qualifying", "headers": [...], "rows": [...]},
    "race_results": {"headers": [...], "rows": [...]},
    "caution_breakdown": {"headers": [...], "rows": [...]}
  }
}
```

---

## 5. IMSA

**Категория:** `endurance`
**Series ID:** `imsa`

### Entry List

| # | Class | Team | Car | Drivers |
|---|-------|------|-----|---------|

- Множество пилотов на экипаж (через `/`)
- Rowspan на Team + Class + Car
- Классы: GTP, LMP2, GTD Pro, GTD

### Practice

Трансформации:
1. TEAM/CAR/SPONSOR → TEAM + CAR (разделение)
2. Колонка ST POS удаляется
3. Колонка CLASS добавляется и заполняется из entry_list

### Qualifying

Трансформации:
1. TEAM/CAR/SPONSOR → TEAM + CAR
2. CLASS добавляется/заполняется из entry_list
3. CLASS POS пересчитывается
4. Колонка POINTS добавляется: 1st→35, 2nd→32, 3rd→30... 29th→2, 30+→1
5. Session meta **скрыт**
6. Для отдельных этапов: merged-таблица Qualifying + Shoot Out

### Race

Трансформации:
1. TEAM/CAR/SPONSOR → TEAM + CAR
2. FASTEST LAP — **удаляется**
3. ST POS заполняется из квалификации
4. CAR NO → #
5. POINTS добавляется: 1st→350, 2nd→320... 30+→10
6. Session meta **скрыт**

### Overview

- **Laps/Distance таблица скрыта**
- BoP секция (Balance of Performance) — только этапы 1-2
- **race_statistics** — не используется

---

## 6. Supercars

**Категория:** `touring`
**Series ID:** `supercars`

### Entry List

| # | Driver | Team | Manufacturer |
|---|--------|------|-------------|

- Rowspan на Team + Manufacturer

### Practice

- Team names применяются по номеру машины
- Sydney-события: #8 → #800

### Qualifying

Для этапов с Shoot Out — **merged двухгрупповая таблица**:

| Pos | No. | Drivers | Team | *Qualifying:* Fastest Lap, Gap, Lap, Laps | *Shoot Out:* Pos, Fastest Lap, Gap |
|-----|------|---------|------|-------------------------------------------|-------------------------------------|

- Топ-10 строк (в Shoot Out) выделены классом `qual-row-in-shootout`
- Строки 11+ показывают "—" в колонках Shoot Out

### Race

Мульти-гоночный формат (несколько гонок за уикенд):

```
Race
├── h4 "Starting Grid 1"
├── h3 "Race 1" → таблица результатов
├── h4 "Starting Grid 2"
├── h3 "Race 2" → таблица результатов
├── ...
└── Penalties / VSC (после спринт-сессий)
```

**Race Results — 7 колонок (колонка Stops удалена):**

| Pos | No. | Driver | Team | Race time | Laps | Pts |
|-----|------|--------|------|-----------|------|-----|

### Overview

- **Laps/Distance таблица скрыта**
- Видео-сетка: `minmax(260px, 1fr)` (уже, чем у других серий — 380px)
- Все блоки (entry-list, practice, qualifying, race) всегда показываются

---

## 7. Super Formula

**Категория:** `openwheel`
**Series ID:** `super_formula`

### Практика / квалификация

Flat-формат, одна таблица (`practice`, `practice2`, `qualifying`).

### Race — многогоночный уикенд

Один event-файл может содержать **несколько гонок** в формате `race.sessions[]`
(Motegi double-header и аналогичные этапы):

```json
"race": {
  "sessions": [
    { "title": "Race 1", "headers": [...], "rows": [...] },
    { "title": "Race 2", "headers": [...], "rows": [...] }
  ]
}
```

- При сборе standings каждая сессия раскладывается в свою колонку `race_order`
  (`R1`, `R2`, …) по порядку. Заголовок в шапке таблицы строится с учётом
  названия трассы (Motegi → `MOT1`, `MOT2`; Suzuka → `SUZ1`; Fuji → `FUJ1`; …).
- Очки допускают дробные значения (например, половинные очки за укороченную
  гонку) — хранятся как `"2.5"` в исходных данных.

---

## 8. Super GT

**Категория:** `endurance`
**Series ID:** `super_gt`

### Entry List

| # | Class | Team | Make | Car | Drivers | Tire |
|---|-------|------|------|-----|---------|------|

- Два класса: `GT500` и `GT300` (обе группы в одной таблице, с пустой строкой-разделителем между ними в `entry_list`).
- В колонке `Drivers` — несколько пилотов через `; ` (формат для endurance-разделения).

### Race

Один проход, многоклассовый:

| Pos. | Class | Car | No. | Team | Drivers | Laps | Gap | Interval | Avg. (km/h) | Time of the day | DP | TP |
|------|-------|-----|-----|------|---------|------|-----|----------|-------------|-----------------|----|----|

- **DP** — очки пилотам (используется для standings)
- **TP** — очки команде
- В колонке `Drivers` — несколько пилотов через `; ` (сборщик standings автоматически их разобьёт)

---

## 9. WEC / ELMS / GT World Challenge Europe Endurance

**Категория:** `endurance`
**Series IDs:** `wec`, `elms`, `gtwce_end`

### Entry List

| # | Class | Team | Drivers | Car |
|---|-------|------|---------|-----|

- Колонка `Drivers` содержит 2–4 пилотов, разделённых `/` либо `; `.
- Классы: WEC — Hypercar / LMGT3; ELMS — LMP2 / LMP2 Pro/Am / LMP3 / LMGT3; GTWCE-End — Pro / Gold / Silver / Bronze / Pro-Am.

### Race

- В большинстве этапов единичная таблица `race` с колонками `Pos / Class / Drivers / Team / Points` (ELMS/GTWC также включают `Cup pts` + `Overall pts`).
- Сборщик standings автоматически разбивает `Drivers` по `;` / `/` и начисляет очки каждому пилоту из колонки `Points` (или `DP` для Super GT).

### Классовые standings (ручные)

Для IMSA (и при необходимости для WEC/ELMS/GTWCE-End) стандартная автосборка может давать
«flat» таблицу всех пилотов без разбиения по классам. Если требуется отображение
строго по классам (как в `data/standings/imsa.json`), нужен ручной
standings JSON со структурой `classes[]` — см. раздел "Классовый standings JSON"
ниже.

---

## 10. Короткие серии без текущих данных

**DTM, FREC, F4 Italian, SMP F4, Porsche Supercup, GT World Challenge Europe Sprint:**

- Используют стандартные шаблоны своей категории (openwheel / touring / GT3).
- Как только в `data/events/<series>/<season>/<id>.json` появляется файл с
  `tables.race_results` (либо `tables.race` с колонками `Pos + Driver + Points`),
  таблица пилотов строится автоматически — без ручного редактирования
  `data/standings/<series>.json`. См. раздел "Автоматическая сборка standings".

---

## Классовый standings JSON (опционально)

Структура ручного standings с разделением по классам (пример IMSA):

```json
{
  "race_order": ["DAY24", "SEB12", "LBG"],
  "completed_races": ["DAY24", "SEB12"],
  "classes": [
    {
      "id": "GTP",
      "name": "Grand Touring Prototype (GTP)",
      "rows": [
        {
          "pos": 1,
          "car": "7",
          "driver": "Julien Andlauer / Laurin Heinrich / Felipe Nasr",
          "team": "Porsche Penske Motorsport",
          "manufacturer": "Porsche 963",
          "races": { "DAY24": "1", "SEB12": "1" },
          "points": "755"
        }
      ]
    }
  ]
}
```

- Фронтенд рендерит `classes[]` отдельными таблицами (сейчас только IMSA).
- Если в JSON только `rows`, то отображается одна общая таблица пилотов (flat).

---

## Автоматическая сборка standings

Файл: `internal/schedulefile/standings.go` → `BuildStandingsFromEvents(dataDir, seriesID, season)`.

Таблица пилотов **пересобирается при каждом запросе** `/api/series/{id}/standings`,
поэтому достаточно положить корректный event-JSON в `data/events/<series>/<season>/` — и
ничего править в `data/standings/` вручную не нужно. Это работает для всех серий, кроме:

- **IMSA** — standings загружаются как есть (в т.ч. `classes[]`).
- **Supercars** — приоритетно используется ручной файл, а уже при его отсутствии запускается auto-build.

### Что нужно в event-JSON, чтобы строка standings построилась

Минимальный набор колонок в `tables.race_results` (или `tables.race` с `rows[]`,
или `tables.race.sessions[i]`):

| Колонка | Обязательно? | Варианты названий |
|---------|--------------|-------------------|
| Позиция | да | `Pos`, `Pos.`, `Fin` |
| Пилот   | да | `Driver` (одиночно) **или** `Drivers` (несколько через `;` / `/` / `,`) |
| Очки    | да, чтобы начислять очки | `Points`, `Pts`, `Pts.`, `DP` (Super GT) |
| Номер машины | нет | `No`, `No.`, `#`, `Car` |
| Команда | нет | `Team` |
| Производитель | нет | `Manufacturer`, `Chassis`, `Make` |
| Статус (для DNQ) | нет | `Status`, `Reason`, `Notes` |

### Поддерживаемые варианты таблицы результатов

Сборщик последовательно проверяет:

1. `tables.race_results` (NASCAR / F1 2025 / Supercars / IndyCar / Super Formula / Super GT / ELMS)
2. `tables.stage3` (для стокк-кар серий, где финальный стейдж содержит итоговый финиш без дублирующего race_results)
3. `tables.race` (F1 2026, GTWCE Endurance)
4. `tables.race.sessions[]` (спринт-уикенды F1, Motegi SF double-header, etc.)

### Что происходит автоматически для конкретных серий

| Серия | Особенности авто-сборки |
|-------|-------------------------|
| F1 (2025+) | Для спринт-уикенда race_order расширяется на `RnS` / `RnF`; сессия `Sprint Race` и основная гонка раскладываются в отдельные колонки. `Carlos Sainz` нормализуется в `Carlos Sainz Jr.` |
| Super Formula | `race.sessions[]` разворачивается в отдельные колонки race_order по порядку (`R1`, `R2`, …). Поддержка дробных очков. |
| Super GT / WEC / ELMS / GTWCE-End | Колонка `Drivers` разбивается по `;` / `/`, каждый пилот получает очки из `Points` или `DP`. Классы не разделяются — все пилоты попадают в flat-таблицу. Для per-class отображения — ручной файл с `classes[]`. |
| IndyCar | Производитель берётся из `data/teams/indycar.json` по номеру машины (в результатах его нет). |
| NASCAR Cup / Xfinity / Truck / ARCA / Modified | Очки стейджей (`stage_1`, `stage_2`) добавляются отдельно в колонку `Stages`. DNQ из таблицы `did_not_qualify` создают отдельные строки со статусом `DNQ`. Для NASCAR Cup события `..._0` (Clash) исключаются из зачёта. `NC` в колонке Pos отображается как индекс строки. |
| NOAPS / Modified / ARCA | Эксклюзивно поддерживается fallback на `tables.stage3` как источник финишной таблицы. |

### Completed races

`CompletedRaces` вычисляется автоматически на основании того, в каких колонках
race_order реально появились непустые значения. Пустая ячейка → раунд считается
несостоявшимся. Дополнительно `EnsureCompletedRaces` сверяется с наличием таблиц
`race_results` / `race` / `race.sessions` в каждом event-файле.

---

## Сводная таблица различий

| Признак | Stock car | F1 | F2/F3 | IndyCar | IMSA | Supercars | Super Formula | Super GT | Endurance (WEC/ELMS/GTWCE) |
|---------|-----------|-----|-------|---------|------|-----------|---------------|----------|----------------------------|
| Entry list колонки | #, Driver, Team, Mfr, Crew Chief | #, Driver, Constructor, Chassis | #, Team, Driver | #, Driver, Team, Engine | #, Class, Team, Car, Drivers | #, Driver, Team, Mfr | #, Driver, Team, Engine | #, Class, Team, Make, Car, Drivers, Tire | #, Class, Team, Drivers, Car |
| Driver column в race | `Driver` (1) | `Driver` (1) | `Driver` (1) | `Driver` (1) | `Drivers` (multi) | `Driver` (1) | `Driver` (1) | `Drivers` (multi) | `Drivers` (multi) |
| Stage-таблицы | Да (stage_1, stage_2) | Нет | Нет | Нет | Нет | Нет | Нет | Нет | Нет |
| Sprint + Race | Нет | Да | Да (Sprint+Feature) | Нет | Нет | Да (Race 1-4) | Да (2 гонки за уикенд) | Нет | Нет |
| Race фикс. ширины | Нет (auto) | Да (10 колонок) | Нет | Нет | Нет | Нет | Нет | Нет | Нет |
| Pit Stops чарт | Нет | Да | Нет | Нет | Нет | Нет | Нет | Нет | Нет |
| Caution Breakdown | Да (+Free Pass) | Нет | Нет | Да (−Free Pass) | Нет | Нет | Нет | Нет | Нет |
| Laps/Distance | Показан | Показан | Показан | Показан | Скрыт | Скрыт | Показан | Показан | Скрыт |
| POINTS колонка | Pts/Points | Points | Pts | Points | Points | Pts | Points | DP (driver) / TP (team) | Points / Cup pts / Overall pts |
| CLASS колонка | Нет | Нет | Нет | Нет | Да | Нет | Нет | Да (GT500 / GT300) | Да |
| Merged qual | Нет | Нет | Нет | Нет | Shoot Out | Shoot Out | Нет | Нет | Нет |
| Множество гонок/уик. | Нет | Sprint+Race | Sprint+Feature | Нет | Нет | Race 1-4 | Race 1-2 | Нет | Нет |
| Practice формат | Flat | sessions[] (2026) / flat (2025) | sessions[] | Flat | Flat | Flat | Flat | sessions[] (per-class) | sessions[] |
| Auto-standings | ✅ flat | ✅ sprint-aware | ✅ flat | ✅ flat | ❌ ручной (classes[]) | ⚠️ приоритетно ручной | ✅ multi-race | ✅ flat (multi-driver) | ✅ flat (multi-driver) |
| laps_led/best_laps | Нет | Нет (встроены в race_results) | Нет | Нет | Нет | Нет | Нет | Нет | Нет |
