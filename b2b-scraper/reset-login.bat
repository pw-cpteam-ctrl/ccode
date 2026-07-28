@echo off
chcp 65001 >nul
cd /d "%~dp0"
title GoodSmile Login Reset

REM Check Node.js
where node >nul 2>nul
if errorlevel 1 (
  echo [Node.js not found]
  echo Install Node.js LTS from https://nodejs.org then double-click this again.
  pause
  exit /b
)

REM Delete the saved login profile (Korean messages come from reset-login.js, not here)
node reset-login.js

echo.
pause
