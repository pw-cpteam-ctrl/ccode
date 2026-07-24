@echo off
cd /d "%~dp0"
title Goodsmile Import

where node >nul 2>nul
if errorlevel 1 goto nonode

if not exist "node_modules" goto install
goto run

:install
echo 최초 실행 준비 중입니다... 1~2분 정도 걸려요. 창을 닫지 마세요.
call npm install
goto run

:run
node scrape.js
echo.
echo 끝났습니다. 이 창은 닫으셔도 됩니다.
pause
exit /b

:nonode
echo [설치 필요] Node.js가 없습니다.
echo nodejs.org 에서 LTS 버전을 설치한 뒤, 이 아이콘을 다시 더블클릭해주세요.
pause
exit /b
