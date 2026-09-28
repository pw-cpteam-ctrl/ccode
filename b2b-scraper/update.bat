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
REM ASCII only here (see the note above). The Korean version of this warning is printed
REM by check-update.js on every run.bat launch, which is where a teammate actually sees it -
REM nobody opens update.bat unless something already looks broken.
echo.
echo ===============================================================
echo  CANNOT UPDATE - required files are missing
echo.
echo  update.js and/or update-source.js are not in this folder.
echo  These 3 files must always be together:
echo      update.bat / update.js / update-source.js
echo.
echo  ^>^> Tell the administrator: "update files are missing"  ^<^<
echo     Until then this tool can NEVER receive any update.
echo.
echo  You can keep working as usual with run.bat.
echo ===============================================================
echo.
pause
exit /b 1
