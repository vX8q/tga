# Product Metrics

Ниже перечислены продуктовые и эксплуатационные метрики, которые публикуются через `GET /metrics`.

## Product/API metrics

- `tga_api_series_views_total` - сколько раз читали страницы/эндпоинты серий.
- `tga_api_event_views_total` - сколько раз читали детали этапов.
- `tga_api_driver_views_total` - сколько раз запрашивали профиль пилота.
- `tga_api_live_events_reads_total` - сколько раз читали список live-событий.
- `tga_api_admin_reads_total` - сколько раз запрашивали admin data endpoints.
- `tga_api_errors_total{endpoint,status_class}` - ошибки API, агрегированные по endpoint и классу (`4xx`/`5xx`).
- `tga_api_business_request_duration_seconds{endpoint}` - latency для ключевых продуктовых endpoint.

## Existing platform metric

- `http_request_duration_seconds{method,route,status}` - общая latency HTTP-запросов по нормализованному роуту.

## How to use

- Дашборд бизнес-трафика: `*_views_total` как rate/sum за интервал.
- Контроль качества API: `tga_api_errors_total` + `tga_api_business_request_duration_seconds`.
- Контроль деградации live-функций: `tga_api_live_events_reads_total` и `tga_livesync_*` метрики.
