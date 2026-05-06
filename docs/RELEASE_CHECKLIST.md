# Release Checklist

## Before merge/push

- [ ] `go test -count=1 ./...`
- [ ] `golangci-lint run --timeout=5m`
- [ ] `git status` clean (или только ожидаемые изменения)

## Before deploy

- [ ] Проверены ключевые endpoint вручную:
  - `/health`
  - `/api/series`
  - `/api/events/{eventID}`
  - `/api/driver/{slug}`
- [ ] Проверены миграции/инициализация SQLite на целевой среде.
- [ ] Обновлены документы при изменениях API/данных.

## After deploy

- [ ] `/health` = 200.
- [ ] Нет всплеска `tga_api_errors_total{status_class="5xx"}`.
- [ ] `tga_livesync_last_success_unix` обновляется.
- [ ] p95 latency в допустимых пределах.
