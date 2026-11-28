@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
if errorlevel 1 (
    echo.
    echo Knowledge Hub AI beklenmedik bir hata ile kapandi.
    pause
)
endlocal
