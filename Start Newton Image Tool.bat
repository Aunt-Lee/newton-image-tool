@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18 or newer is required.
  echo Install it from https://nodejs.org and run this shortcut again.
  pause
  exit /b 1
)
node server.js
pause
