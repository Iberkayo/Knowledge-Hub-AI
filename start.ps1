#Requires -Version 5.1
<#
.SYNOPSIS
    Knowledge Hub AI yerel sunucusunu başlatır.
.DESCRIPTION
    Varsa .venv içindeki Python'u kullanarak uvicorn sunucusunu 127.0.0.1:8000 üzerinde
    başlatır ve kısa bir gecikme sonrasında varsayılan tarayıcıyı açar.
#>

[CmdletBinding()]
param(
    [int]$Port = 8000,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -Path $RepoRoot

$url = "http://127.0.0.1:$Port"

# 1. Python yolunu belirle
$venvPython = Join-Path $RepoRoot ".venv\Scripts\python.exe"
$pythonExe = $null

if (Test-Path $venvPython) {
    $pythonExe = $venvPython
    Write-Host "Sanal ortam kullanılıyor: $venvPython" -ForegroundColor Green
} else {
    Write-Host "UYARI: .venv sanal ortamı bulunamadı. İlk kurulum için '.\setup.ps1' çalıştırmanız önerilir." -ForegroundColor DarkYellow
    $sysPy = Get-Command "python" -ErrorAction SilentlyContinue
    if ($sysPy) {
        $pythonExe = $sysPy.Source
        Write-Host "Sistem Python'u ile devam ediliyor: $pythonExe" -ForegroundColor Yellow
    } else {
        Write-Host "HATA: Python bulunamadı. Lütfen önce '.\setup.ps1' kurulum scriptini çalıştırın." -ForegroundColor Red
        exit 1
    }
}

# 2. outputs/ klasörünü garantile
$outputsDir = Join-Path $RepoRoot "outputs"
if (-not (Test-Path $outputsDir)) {
    New-Item -ItemType Directory -Path $outputsDir -Force | Out-Null
}

# 3. Tarayıcıyı kısa gecikmeyle açan arka plan işi
$browserJob = $null
if (-not $NoBrowser) {
    $browserJob = Start-Job -ScriptBlock {
        param($targetUrl)
        Start-Sleep -Seconds 2
        try {
            Start-Process $targetUrl | Out-Null
        } catch {
            # Tarayıcı otomatik açılamazsa kullanıcı konsoldaki adresten açabilir
        }
    } -ArgumentList $url
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Knowledge Hub AI Başlatılıyor" -ForegroundColor Cyan
Write-Host "  Adres: $url" -ForegroundColor White
Write-Host "  Durdurmak için: Ctrl+C" -ForegroundColor DarkGray
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

try {
    & $pythonExe -m uvicorn knowledge_hub.server:create_app --factory --host 127.0.0.1 --port $Port
    exit $LASTEXITCODE
} finally {
    if ($browserJob) {
        Remove-Job -Job $browserJob -Force -ErrorAction SilentlyContinue
    }
}
