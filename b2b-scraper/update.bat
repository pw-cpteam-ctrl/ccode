@echo off
chcp 65001 >nul
cd /d "%~dp0"
title GoodSmile Product Fetcher - Update

REM Thin launcher on purpose. CMD reads a .bat line by line while running it, so a
REM batch file that overwrites itself mid-run misbehaves - that is why the real
REM update logic lives in update.js (node loads a script fully and closes the file,
REM so it can safely be replaced by the very update it is applying).
REM Keep this file unchanged: it is the only file a teammate must replace by hand.
REM (ASCII only in .bat files - see the README design notes. Korean messages are
REM  printed by update.js, which runs under node/UTF-8.)

where node >nul 2>nul
if errorlevel 1 (
  echo [Node.js not found]
  echo Install Node.js LTS from https://nodejs.org then double-click this again.
  pause
  exit /b
)

REM First-time switch guard: this launcher needs update.js + update-source.js next to it.
REM They arrive with every later update, but on the very first switch they must be copied
REM in by hand together with this file. Without this check the failure would be a cryptic
REM "Cannot find module" and nobody could tell what was missing.
if not exist "update.js" goto :missing
if not exist "update-source.js" goto :missing

node update.js

echo.
pause
exit /b

:missing
echo.
echo [Setup incomplete]
echo This updater needs 3 files together: update.bat, update.js, update-source.js
echo Please ask the administrator for the missing files.
echo Meanwhile you can keep using the tool as usual (run.bat).
echo.
pause
exit /b 1
