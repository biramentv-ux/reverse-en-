@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required.
  pause
  exit /b 1
)
start "ORBIT DJ" http://127.0.0.1:4317
node server.mjs
pause
