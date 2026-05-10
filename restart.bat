@echo off
title SOC Dashboard - Restarting...
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1

echo Stopping old server...
for /f "tokens=5" %%a in ('netstat -aon ^| find ":5000" ^| find "LISTENING"') do taskkill /F /PID %%a >nul 2>&1

timeout /t 1 /nobreak >nul

echo Starting fresh...
cd /d "%~dp0"
start "" "http://127.0.0.1:5000"
python app.py
pause
