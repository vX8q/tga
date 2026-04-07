# Пересобрать и запустить сервер (подтягивает все правки: ToLower, логи и т.д.)
# Запуск: .\restart-server.ps1   или   .\restart-server.ps1 -ResetDb
#
# Перед запуском останови текущий сервер в другом терминале (Ctrl+C).

Param(
    [switch]$ResetDb,   # пересоздать БД при старте (bootstrap заново импортирует данные из JSON)
    [string]$Port = "8080"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "Restart: build + run server" -ForegroundColor Cyan

# 1. Сборка
if (-not (Test-Path "bin")) { New-Item -ItemType Directory -Path "bin" | Out-Null }
Write-Host "  Building bin\server.exe ..." -ForegroundColor Gray
go build -trimpath -o bin/server.exe ./cmd/server/
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed." -ForegroundColor Red
    exit $LASTEXITCODE
}
Write-Host "  Build OK." -ForegroundColor Green

# 2. Окружение для запуска
$env:PORT = $Port
if ($ResetDb) {
    $env:TGA_RESET_DB_ON_START = "1"
    Write-Host "  DB will be rebuilt from JSON on start." -ForegroundColor Gray
}

# 3. Запуск
Write-Host "Starting server on port $Port ... (Ctrl+C to stop)" -ForegroundColor Cyan
.\bin\server.exe
