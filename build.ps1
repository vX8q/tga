# Сборка всех команд проекта motorsport
# Запуск: .\build.ps1  (из корня проекта)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
Set-Location $root

Write-Host "Building motorsport..." -ForegroundColor Cyan
if (-not (Test-Path "bin")) { New-Item -ItemType Directory -Path "bin" | Out-Null }

$commands = @(
    @{ Name = "server"; Path = "./cmd/server" }
)

foreach ($c in $commands) {
    $exe = "bin/$($c.Name).exe"
    Write-Host "  $($c.Path) -> $exe"
    go build -o $exe $c.Path
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host "Done. Run server: .\bin\server.exe" -ForegroundColor Green
Write-Host "  Then open http://localhost:8080" -ForegroundColor Gray
