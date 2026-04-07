# Импорт из Excel отключён. Данные загружаются только из папки data/.
# Редактируйте JSON вручную: data/schedules/, data/events/, data/teams/, data/standings/

$ErrorActionPreference = "Stop"
Write-Host "Excel import is disabled. Data is read from the data/ directory." -ForegroundColor Cyan
Write-Host "  data/schedules/  - calendars" -ForegroundColor Gray
Write-Host "  data/events/     - event details (Stage 1, Race Results, Caution, etc.)" -ForegroundColor Gray
Write-Host "  data/teams/      - teams and technical specs" -ForegroundColor Gray
Write-Host "  data/standings/  - standings" -ForegroundColor Gray
