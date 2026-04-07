Param(
  [string]$Port = "8080"
)

$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

$env:TGA_RESET_DB_ON_START = "1"

Write-Host "Starting TGA server in DEV mode (DB will be rebuilt)..." -ForegroundColor Cyan
Write-Host "  Port: $Port" -ForegroundColor Gray

 $env:PORT = $Port
.\bin\server.exe

