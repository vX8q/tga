# Runbook

## 1) Рост 5xx по API

1. Проверить `/health`.
2. Проверить `/metrics`:
   - `tga_api_errors_total{status_class="5xx"}`
   - `http_request_duration_seconds`
3. Проверить логи сервера (`panic recovered`, `bootstrap failed`, `store health failed`).
4. Если проблема в SQLite, перезапустить сервис и проверить доступность `data/tga.sqlite`.

## 2) Live-события не обновляются

1. Проверить `tga_livesync_errors_total{source="nascar|openf1"}`.
2. Проверить `tga_livesync_last_success_unix`.
3. Проверить актуальность `data/live.json`.
4. Проверить доступ к внешним API (NASCAR Feed/OpenF1).

## 3) Деградация latency

1. Проверить `http_request_duration_seconds` и `tga_api_business_request_duration_seconds`.
2. Проверить нагрузку CPU/RAM и наличие I/O bottleneck на `data/` и SQLite.
3. При необходимости временно снизить RPS извне или включить более жёсткий лимит.

## 4) Rollback (3 шага)

1. Откатить деплой к предыдущему коммиту/образу.
2. Перезапустить сервис.
3. Проверить `/health` и базовые endpoint (`/api/series`, `/api/events/{id}`).
