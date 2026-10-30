@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required.
  pause
  exit /b 1
)
start "VECTOR DJ" http://127.0.0.1:4318
node server.mjs
pause
