@echo off
REM SnapPrints Shop Print Agent - double-click to start. Keeps restarting if it ever stops.
title SnapPrints Print Agent
cd /d "%~dp0"
if not exist config.json (
  echo Not set up yet. Running setup first...
  call npm run setup
)
start "" http://localhost:7300
:loop
node src\agent.js
echo.
echo Agent stopped. Restarting in 10 seconds... (close this window to stop it)
timeout /t 10 /nobreak >nul
goto loop
