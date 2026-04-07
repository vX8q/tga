# TGA — The Grid Archive

Автоспортивный веб-ресурс и API на Go: расписания, результаты гонок, турнирные таблицы, статистика пилотов и live-данные по 20+ чемпионатам мира. Актуальный сезон — **2026**.

## Возможности

- Единая база данных по всем основным автоспортивным сериям мира
- Расписания этапов, результаты гонок и квалификаций, сессии
- Турнирные таблицы (личный и командный зачёт)
- Статистика пилотов, команд, трасс и Head-to-Head сравнения
- Live-данные из NASCAR Feed и OpenF1 API (автосинхронизация каждые 2 минуты)
- История F1 (чемпионы 1950–2025, очки, шасси, моторы)
- Prometheus-метрики и admin-эндпоинты для мониторинга
- Интернационализация (EN / RU), тёмная и светлая тема

## Чемпионаты

| Категория | Серии |
|-----------|-------|
| **Formula** | Formula 1, Formula 2, Formula 3, FREC, Italian F4, SMP F4 Russia, Porsche Supercup |
| **Stock Car** | NASCAR Cup, NASCAR Xfinity (O'Reilly), NASCAR Truck (Craftsman), ARCA Menards, Whelen Modified Tour |
| **Open-Wheel** | IndyCar, Super Formula |
| **Touring** | Supercars, DTM, Super GT |
| **Endurance** | WEC, ELMS, IMSA |
| **GT** | GT World Challenge Europe (Endurance & Sprint) |

## Технологии

| Компонент | Стек |
|-----------|------|
| Бэкенд | Go 1.24, `net/http`, `slog` |
| БД | SQLite через `modernc.org/sqlite` (pure Go, без CGO) |
| Фронтенд | Vanilla JS SPA, CSS, клиентская маршрутизация |
| Метрики | Prometheus (`prometheus/client_golang`) |
| Rate Limiting | `golang.org/x/time/rate` |
| CI | GitHub Actions (тесты + golangci-lint) |
| Деплой | Docker + Cloudflare Tunnel |

## Структура проекта

```
TGA/
├── cmd/
│   ├── server/                  # HTTP-сервер: API, статика, admin, middleware
│   ├── sync-openf1-live/        # CLI: синхронизация OpenF1 → data/live.json
│   ├── sync-nascar-live/        # CLI: синхронизация NASCAR → data/live.json
│   └── fetch-driver-wikidata/   # Утилита: данные пилотов из Wikidata
├── config/                      # Определения чемпионатов (один файл на серию)
├── models/                      # Доменные модели: Series, Event, Race, Result, Driver, Team
├── internal/
│   ├── store/                   # Интерфейс Store + SQLite-реализация
│   ├── schedulefile/            # Загрузка JSON-данных: расписания, результаты, standings
│   ├── livesync/                # Live-синхронизация NASCAR + OpenF1 с Prometheus-метриками
│   ├── driverutil/              # Slug-генерация для пилотов
│   ├── tableutil/               # Вспомогательные функции для таблиц
│   ├── appenv/                  # Определение data-директории
│   └── cache/                   # TTL-кэш
├── web/                         # Фронтенд: index.html, style.css, app.js, компоненты
├── data/
│   ├── schedules/               # Расписания серий (JSON)
│   ├── events/                  # Детали этапов: сессии, результаты, таблицы
│   ├── teams/                   # Составы команд
│   ├── standings/               # Турнирные таблицы
│   ├── live.json                # Live-данные (обновляются автоматически)
│   └── driver_profiles.json     # Профили пилотов
├── scripts/                     # Node.js-скрипты для подготовки/нормализации данных
├── docs/                        # Заметки по архитектуре и данным
├── .github/workflows/           # CI: тесты + линтер
├── Dockerfile                   # Multi-stage build (alpine)
├── docker-compose.yml           # app + Cloudflare Tunnel
├── Makefile                     # build, dev, test, lint, ci, docker
└── go.mod
```

## Быстрый старт

### Требования

- **Go 1.24+**
- (Опционально) **Docker** и **Docker Compose** для контейнерного запуска
- (Опционально) **Make** для удобных команд

### Локальный запуск

```bash
git clone https://github.com/vX8q/tga.git
cd tga
go run ./cmd/server
```

Сервер запустится на **http://localhost:8080**.

### Сборка и запуск бинарника

```bash
make build          # собирает server.exe + fetch-wikidata.exe
./server.exe        # запуск
```

### Смена порта

```bash
PORT=3000 go run ./cmd/server
```

PowerShell:

```powershell
$env:PORT="3000"; go run ./cmd/server
```

## Docker

### Сборка и запуск вручную

```bash
docker build -t tga:latest .
docker run --rm -p 8080:8080 -v "$(pwd)/data:/app/data" tga:latest
```

### Docker Compose (с Cloudflare Tunnel)

```bash
# Укажи токен туннеля в .env
echo "CLOUDFLARE_TUNNEL_TOKEN=your-token" > .env
docker compose up -d
```

Compose запускает два сервиса:
- **app** — TGA-сервер (порт не публикуется, доступ только через туннель)
- **cloudflared** — Cloudflare Tunnel для внешнего доступа

## Переменные окружения

| Переменная | По умолчанию | Описание |
|------------|-------------|----------|
| `PORT` | `8080` | Порт HTTP-сервера |
| `TGA_DATA` | `data/` | Путь к директории с данными |
| `TGA_WEB` | `web/` | Путь к статике фронтенда |
| `TGA_RESET_DB_ON_START` | — | `1` = пересоздать SQLite при старте |
| `TGA_ENABLE_ADMIN` | — | `1` = включить admin-эндпоинты |
| `TGA_ADMIN_TOKEN` | — | Токен для admin и pprof (обязателен при `ENABLE_ADMIN=1`) |
| `TGA_RATE_LIMIT_RPS` | `0` | Лимит запросов/сек на IP (`0` = выключен) |
| `TGA_ENABLE_PPROF` | — | `1` = включить `/debug/pprof/*` (требуется admin-токен) |
| `LOG_LEVEL` | `info` | Уровень логирования (`debug`, `info`, `warn`, `error`) |
| `CLOUDFLARE_TUNNEL_TOKEN` | — | Токен Cloudflare Tunnel (для docker-compose) |

## API

### Публичные эндпоинты

| Метод | Путь | Описание |
|-------|------|----------|
| `GET` | `/health` | Статус сервера (503 при деградации) |
| `GET` | `/metrics` | Prometheus-метрики |
| `GET` | `/api/series` | Список всех серий |
| `GET` | `/api/series/{id}` | Метаданные серии (`?season=` опционально) |
| `GET` | `/api/series/{id}/events` | Этапы серии |
| `GET` | `/api/series/{id}/teams` | Команды и составы |
| `GET` | `/api/series/{id}/standings` | Турнирная таблица |
| `GET` | `/api/series/{id}/stats` | Статистика серии |
| `GET` | `/api/series/{id}/headtohead` | H2H-сравнения пилотов |
| `GET` | `/api/series/f1/history` | История F1 (1950–2025) |
| `GET` | `/api/events/{eventID}` | Детали этапа (сессии, результаты) |
| `GET` | `/api/live-events` | Текущие/ближайшие live-события |
| `GET` | `/api/driver/{slug}` | Профиль пилота + результаты сезона |

### Admin-эндпоинты

Требуют `TGA_ENABLE_ADMIN=1` и заголовок `X-Admin-Token` или `Authorization: Bearer <token>`.

| Метод | Путь | Описание |
|-------|------|----------|
| `GET` | `/api/admin/data-health` | Проверка целостности данных по сериям |
| `GET` | `/api/admin/data-diff` | Diff данных |
| `POST` | `/api/admin/reimport-stockcar` | Реимпорт stock-car данных |

### SPA-маршруты

Все следующие пути возвращают `index.html` для клиентской маршрутизации:

`/`, `/series/*`, `/season/*`, `/track/*`, `/driver/*`, `/team/*`, `/crew-chief/*`, `/event/*`

## Архитектура

```
┌─────────────────────────────────────────────────────────┐
│                     web/ (SPA)                          │
│  Vanilla JS · Client-side routing · i18n (EN/RU)       │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP
┌────────────────────────▼────────────────────────────────┐
│                  cmd/server (Go)                        │
│  net/http · middleware (CORS, rate limit, trace ID,     │
│  panic recovery) · handlers · static file server        │
├─────────────────────┬──────────────────┬────────────────┤
│  internal/store     │  schedulefile    │  livesync      │
│  SQLite (R/W)       │  JSON files (RO) │  NASCAR+OpenF1 │
└─────────┬───────────┴────────┬─────────┴────────┬───────┘
          │                    │                   │
    ┌─────▼──────┐    ┌───────▼────────┐   ┌──────▼──────┐
    │ tga.sqlite │    │  data/*.json   │   │  live.json  │
    └────────────┘    └────────────────┘   └─────────────┘
```

**Источник правды** — JSON-файлы в `data/`. SQLite (`data/tga.sqlite`) — материализованное представление, заполняется при старте через `bootstrapStoreFromFiles`. Live-данные обновляются из внешних API каждые 2 минуты внутри серверного процесса.

## Данные

Данные хранятся в JSON-файлах и редактируются напрямую:

- `data/schedules/{seriesID}.json` — расписания этапов
- `data/events/{eventID}.json` — детали этапов (результаты, сессии, таблицы)
- `data/teams/{seriesID}.json` — составы команд
- `data/standings/{seriesID}.json` — турнирные таблицы
- `data/driver_profiles.json` — профили пилотов
- `data/live.json` — live-данные (генерируется автоматически)

## Мониторинг

### Prometheus-метрики (`GET /metrics`)

Помимо стандартных Go-метрик, доступны:

| Метрика | Описание |
|---------|----------|
| `tga_livesync_errors_total{source,reason}` | Счётчик ошибок live-синхронизации |
| `tga_livesync_last_success_unix{source}` | Unix-время последней успешной синхронизации |

Где `source` — `nascar` или `openf1`, `reason` — тип ошибки (`live_feed`, `no_events`, `write_live_json` и т.д.).

### Health-check

`GET /health` возвращает JSON со статусом и информацией о БД. Код **503** при отсутствии SQLite или ошибке.

### Admin: проверка данных

`GET /api/admin/data-health` — JSON с полями по каждой серии: `ok`, `missing`, `events`, `has_db`, `db_degraded`.

## Makefile

| Команда | Описание |
|---------|----------|
| `make build` | Сборка `server.exe` + `fetch-wikidata.exe` |
| `make dev` | Запуск в dev-режиме (`go run ./cmd/server`) |
| `make test` | Тесты с `-race` (с fallback) |
| `make lint` | golangci-lint (с fallback на `go vet`) |
| `make ci` | `test` + `lint` |
| `make docker` | Сборка образа + запуск контейнера |

## Hot Reload (Air)

Проект настроен для [Air](https://github.com/air-verse/air). Конфигурация в `.air.toml`:

```bash
# Установка Air
go install github.com/air-verse/air@latest

# Запуск с hot reload
air
```

Air отслеживает `.go`-файлы, пересобирает бинарник во `./tmp/server.exe` и перезапускает при изменениях.

## CI/CD

GitHub Actions (`.github/workflows/ci.yml`) запускаются на push/PR в `main`/`master`:

- **test** — `go test ./... -count=1 -v`
- **lint** — `golangci-lint` (govet, staticcheck, gosimple, ineffassign, gosec, misspell, errcheck, revive)

## PowerShell-скрипты (Windows)

| Скрипт | Описание |
|--------|----------|
| `build.ps1` | Сборка `bin/server.exe` |
| `run-dev.ps1` | Запуск собранного сервера с `TGA_RESET_DB_ON_START=1` |
| `restart-server.ps1` | Сборка + запуск (опционально `-ResetDb`) |
| `import_all.ps1` | Справка по работе с данными |

## Лицензия

Проект пока не имеет открытой лицензии. Все права защищены.
