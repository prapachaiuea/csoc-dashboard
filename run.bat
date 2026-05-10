@echo off
title SOC Operations Center
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1

for /f "tokens=5" %%a in ('netstat -aon ^| find ":5000" ^| find "LISTENING"') do taskkill /F /PID %%a >nul 2>&1

start "" "http://127.0.0.1:5000"
python app.py
pause
