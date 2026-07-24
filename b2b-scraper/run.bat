@echo off
chcp 65001 >nul
cd /d "%~dp0"
title GoodSmile Product Fetcher

REM Check Node.js
where node >nul 2>nul
if errorlevel 1 (
  echo [Node.js not found]
  echo Install Node.js LTS from https://nodejs.org then double-click this again.
  pause
  exit /b
)

REM First-time only: install dependencies
if not exist "node_modules" (
  echo First-time setup - installing dependencies, please wait 1-2 minutes...
  call npm install
)

REM Run the scraper (Korean progress messages are printed by scrape.js, not here)
node scrape.js

echo.
echo Done. You can close this window.
pause
