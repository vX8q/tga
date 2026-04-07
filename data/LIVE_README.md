# Live-статус событий (мигающая иконка LIVE)

Список событий «идёт прямо сейчас» хранится в **`data/live.json`**. Его отдаёт API **`GET /api/live-events`**; фронтенд раз в минуту обновляет список и показывает мигающую метку LIVE на карточках в блоке «NEXT RACE».

## Формат `data/live.json`

Допустимы два варианта:

**Массив ID событий:**
```json
["NASCAR_CUP_2026_3", "SUPERCARS_2026_1"]
```

**Объект с полем `live_event_ids`:**
```json
{
  "live_event_ids": ["NASCAR_CUP_2026_3"]
}
```

ID события — тот же, что в расписании и в `data/events/` (например `NASCAR_CUP_2026_3`, `SUPERCARS_2026_4`). Регистр не важен.

## Как обновлять

### Вручную
Во время уик-энда откройте `data/live.json` и добавьте/удалите нужные `event_id`. После сохранения файла интерфейс подхватит изменения в течение ~1 минуты (или при обновлении страницы).

Пример: идёт DuraMAX Grand Prix (NASCAR Cup, 3-й этап 2026) — в расписании это `NASCAR_CUP_2026_3`. Добавьте в массив:
```json
["NASCAR_CUP_2026_3"]
```
Когда гонка закончится — уберите этот ID или очистите массив до `[]`.

### NASCAR — автоматическая синхронизация (официальный API)

Используется **официальный API NASCAR** [feed.nascar.com](https://feed.nascar.com/swagger/ui/index). Утилита `sync-nascar-live` опрашивает Live Feed, определяет текущую гонку (Cup / Xfinity / Truck) и обновляет `data/live.json`.

**Запуск вручную:**
```bash
go run ./cmd/sync-nascar-live -data-dir=./data
```

**По cron (каждые 1–2 минуты в гоночные дни):**
```bash
*/2 * * * * cd /path/to/TGA && go run ./cmd/sync-nascar-live -data-dir=./data
```
Или соберите бинарник и вызывайте его: `go build -o sync-nascar-live ./cmd/sync-nascar-live`.

Поддерживаются серии: **NASCAR Cup** (`nascar_cup`), **Xfinity** (`noaps`), **Truck** (`nascar_truck`). Маппинг NASCAR `race_id` → наш `event_id` идёт по дате гонки из `data/schedules/*.json`. Утилита **объединяет** свой результат с уже записанными в `live.json` (не затирает F1 и др.).

### F1 — OpenF1 (api.openf1.org)

Утилита `sync-openf1-live` опрашивает **OpenF1** (неофициальный, бесплатный API), получает текущую/последнюю сессию (`session_key=latest`), проверяет, что сейчас между `date_start` и `date_end`, и записывает соответствующий `F1_2026_X` в `live.json`. Маппинг по дате сессии на событие из `data/schedules/f1.json` (с учётом одного уик-энда: пт/сб/вс).

**Запуск:**
```bash
go run ./cmd/sync-openf1-live -data-dir=./data
```

**Cron (каждые 1–2 минуты в гоночные уик-энды F1):**
```bash
*/2 * * * * cd /path/to/TGA && go run ./cmd/sync-openf1-live -data-dir=./data
```

Утилита **только обновляет** F1-записи в `live.json`, не трогая NASCAR и ручные id. Можно запускать вместе с `sync-nascar-live`: оба по очереди в cron дадут и NASCAR, и F1 live.

### Остальные чемпионаты

У Supercars, IndyCar и др. публичного API статуса «live» нет. Для них — **ручное** обновление `live.json` или запасной вариант на фронте по времени (start_date/end_date).

## Проверенные источники live timing

| Источник | Серии | Доступ | Примечание |
|----------|--------|--------|------------|
| **NASCAR feed** | Cup, Xfinity, Truck | Бесплатно, публичный API | Уже интегрирован: `sync-nascar-live`. [feed.nascar.com](https://feed.nascar.com/swagger/ui/index). |
| **OpenF1** | Только Formula 1 | Бесплатно, без ключа | Интегрирован: `sync-openf1-live`. [api.openf1.org](https://openf1.org/docs/) — сессии, `session_key=latest`, проверка по date_start/date_end. |
| **Sportradar** | F1, IndyCar, NASCAR, MotoGP, Formula E и др. | Платно (есть trial) | Официальный поставщик данных для многих чемпионатов. Live Data по F1 (gRPC), расписания и результаты IndyCar/NASCAR. Регистрация: [developer.sportradar.com](https://developer.sportradar.com). Для коммерческого использования — контракт. |
| **Ergast** | F1 | Бесплатно | Только исторические данные, без live. [ergast.com](https://ergast.com/mrd/). |

Итого: для **автоматического** LIVE без платных подписок сейчас реалистичны только **NASCAR** (уже есть) и при желании **F1 через OpenF1** (отдельная утилита по аналогии с `sync-nascar-live`). Остальные серии — вручную или по времени из расписания.

## Логика на фронте

- Если **event_id есть в ответе `/api/live-events`** — карточка сразу помечается как LIVE (мигающая иконка и подпись «LIVE»).
- Если **нет** — используется запасной вариант: текущее время попадает в интервал между `start_date`/временем старта и `end_date` события.

То есть при пустом `live.json` LIVE по-прежнему может загораться по расписанию; заполнение `live.json` нужно, когда хотите опираться на внешний источник или вручную указать «сейчас идёт эта гонка».
