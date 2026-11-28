#Requires -Version 5.1
<#
.SYNOPSIS
    Knowledge Hub AI Windows kurulum scripti.
.DESCRIPTION
    Python 3.11+ kontrolü yapar, .venv sanal ortamını oluşturur, paketleri kurar,
    FFmpeg durumunu denetler ve outputs/ klasörünü hazırlar.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -Path $RepoRoot

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Knowledge Hub AI - Windows Kurulumu" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

function Find-Python311 {
    $candidates = @(
        @{ Cmd = "py"; Args = @("-3.12") },
        @{ Cmd = "py"; Args = @("-3.11") },
        @{ Cmd = "py"; Args = @("-3.13") },
        @{ Cmd = "py"; Args = @("-3") },
        @{ Cmd = "python"; Args = @() },
        @{ Cmd = "python3"; Args = @() }
    )

    foreach ($cand in $candidates) {
        $cmdInfo = Get-Command $cand.Cmd -ErrorAction SilentlyContinue
        if (-not $cmdInfo) { continue }
        try {
            $verArgs = $cand.Args + @("-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')")
            $verText = (& $cand.Cmd @verArgs 2>$null | Select-Object -First 1)
            if (-not $verText) { continue }
            $ver = [Version]$verText.Trim()
            if ($ver.Major -gt 3 -or ($ver.Major -eq 3 -and $ver.Minor -ge 11)) {
                return @{
                    Cmd     = $cand.Cmd
                    Args    = $cand.Args
                    Version = $ver.ToString()
                }
            }
        } catch {
            continue
        }
    }
    return $null
}

# 1. Python 3.11+ kontrolü
Write-Host "[1/5] Python 3.11+ kontrol ediliyor..." -ForegroundColor Yellow
$py = Find-Python311
if (-not $py) {
    Write-Host "HATA: Python 3.11 veya daha yeni bir sürüm bulunamadı." -ForegroundColor Red
    Write-Host "Lütfen https://www.python.org/downloads/ adresinden Python 3.11+ kurun" -ForegroundColor Red
    Write-Host "ve kurulum sırasında 'Add python.exe to PATH' seçeneğini işaretleyin." -ForegroundColor Red
    exit 1
}
Write-Host "  Bulunan Python sürümü: $($py.Version) ($($py.Cmd))" -ForegroundColor Green

# 2. .venv oluşturma ve aktive etme
Write-Host "[2/5] Sanal ortam (.venv) hazırlanıyor..." -ForegroundColor Yellow
$venvDir = Join-Path $RepoRoot ".venv"
$venvPython = Join-Path $venvDir "Scripts\python.exe"
$venvActivate = Join-Path $venvDir "Scripts\Activate.ps1"

if (-not (Test-Path $venvPython)) {
    Write-Host "  .venv oluşturuluyor..."
    $venvArgs = $py.Args + @("-m", "venv", $venvDir)
    & $py.Cmd @venvArgs
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $venvPython)) {
        Write-Host "HATA: .venv sanal ortamı oluşturulamadı." -ForegroundColor Red
        exit 1
    }
    Write-Host "  .venv başarıyla oluşturuldu." -ForegroundColor Green
} else {
    Write-Host "  Mevcut .venv bulundu, kullanılıyor." -ForegroundColor Green
}

if (Test-Path $venvActivate) {
    . $venvActivate
    Write-Host "  .venv aktive edildi." -ForegroundColor Green
}

# 3. Bağımlılıkların kurulumu
Write-Host "[3/5] Python paketleri kuruluyor..." -ForegroundColor Yellow
try {
    & $venvPython -m pip install --upgrade pip
} catch {
    Write-Host "  Uyarı: pip güncellenemedi, mevcut pip ile devam ediliyor." -ForegroundColor DarkYellow
}

$fullInstallOk = $false
Write-Host "  Tam paket seti kuruluyor: pip install -e "".[test,tts,media,ai]"""
& $venvPython -m pip install -e ".[test,tts,media,ai]"
if ($LASTEXITCODE -eq 0) {
    $fullInstallOk = $true
    Write-Host "  Tam kurulum (test, tts, media, ai) başarıyla tamamlandı." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "UYARI: Tam kurulum (.[test,tts,media,ai]) sırasında bir hata oluştu." -ForegroundColor DarkYellow
    Write-Host "  (Örneğin Faster-Whisper, Supertonic veya medya bileşenleri için ek sistem araçları gerekebilir.)" -ForegroundColor DarkYellow
    Write-Host "  Temel kurulum ile devam ediliyor: pip install -e "".[test]""" -ForegroundColor Yellow
    & $venvPython -m pip install -e ".[test]"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "HATA: Temel kurulum (.[test]) başarısız oldu. İnternet bağlantınızı ve Python ortamınızı kontrol edin." -ForegroundColor Red
        exit 1
    }
    Write-Host "  Temel kurulum (.[test]) başarıyla tamamlandı." -ForegroundColor Green
    Write-Host "  Not: Daha sonra TTS/medya/AI paketlerini eklemek için '.\.venv\Scripts\python.exe -m pip install -e "".[tts,media,ai]""' komutunu çalıştırabilirsiniz." -ForegroundColor DarkYellow
}

# 4. FFmpeg kontrolü (kurulumu durdurmaz)
Write-Host "[4/5] FFmpeg kontrol ediliyor..." -ForegroundColor Yellow
$ffmpeg = Get-Command "ffmpeg" -ErrorAction SilentlyContinue
if ($ffmpeg) {
    Write-Host "  FFmpeg bulundu: $($ffmpeg.Source)" -ForegroundColor Green
} else {
    Write-Host "UYARI: Sistemde FFmpeg bulunamadı." -ForegroundColor DarkYellow
    Write-Host "  Metin okuma, çeviri ve kütüphane özellikleri FFmpeg olmadan da çalışır;" -ForegroundColor DarkYellow
    Write-Host "  ancak yerel ses transkripsiyonu (Faster-Whisper) ve ses birleştirme için FFmpeg önerilir." -ForegroundColor DarkYellow
    Write-Host "  Kurmak için yeni bir PowerShell penceresinde şu komutu çalıştırabilirsiniz:" -ForegroundColor Cyan
    Write-Host "    winget install Gyan.FFmpeg" -ForegroundColor White
    Write-Host "  Kurulum sonrasında terminali kapatıp yeniden açmanız gerekir." -ForegroundColor DarkYellow
}

# 5. outputs/ klasörü
Write-Host "[5/5] outputs/ çalışma klasörü kontrol ediliyor..." -ForegroundColor Yellow
$outputsDir = Join-Path $RepoRoot "outputs"
if (-not (Test-Path $outputsDir)) {
    New-Item -ItemType Directory -Path $outputsDir -Force | Out-Null
    Write-Host "  outputs/ klasörü oluşturuldu." -ForegroundColor Green
} else {
    Write-Host "  outputs/ klasörü zaten mevcut." -ForegroundColor Green
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
if ($fullInstallOk) {
    Write-Host "  Kurulum başarıyla tamamlandı!" -ForegroundColor Green
} else {
    Write-Host "  Temel kurulum tamamlandı (medya/AI ek paketleri atlandı)." -ForegroundColor Yellow
}
Write-Host "========================================" -ForegroundColor Green
Write-Host "Uygulamayı başlatmak için 'start.bat' dosyasına çift tıklayabilir" -ForegroundColor White
Write-Host "veya PowerShell'de '.\start.ps1' komutunu çalıştırabilirsiniz." -ForegroundColor White
Write-Host ""
