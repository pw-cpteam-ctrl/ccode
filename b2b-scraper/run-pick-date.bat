@echo off
chcp 65001 >nul
cd /d "%~dp0"
title GoodSmile Product Fetcher (pick a date)

REM Same tool as run.bat, except it lists the announcement dates available on the
REM site and lets you pick one by number, instead of auto-taking the newest.
REM Use run.bat for daily work; use this only when you need an older date.
REM (ASCII only in .bat files - see the README design notes. Korean messages
REM  are printed by scrape.js, which runs under node/UTF-8.)

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

REM Run the scraper in date-picking mode
node scrape.js --pick

echo.
echo Done. You can close this window.
pause
