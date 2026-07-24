@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 굿스마일 상품 가져오기

REM Node 설치 확인
where node >nul 2>nul
if errorlevel 1 (
  echo [설치 필요] Node.js가 없습니다.
  echo https://nodejs.org 에서 LTS 버전을 설치한 뒤, 이 아이콘을 다시 더블클릭해주세요.
  pause
  exit /b
)

REM 최초 1회만 라이브러리 자동 설치
if not exist "node_modules" (
  echo 최초 실행 준비 중입니다... 1~2분 정도 걸려요. 창을 닫지 마세요.
  call npm install
)

REM 실제 스크래퍼 실행 (세션 있으면 바로 진행, 없으면 크롬 로그인 창이 뜸)
node scrape.js

echo.
echo 끝났습니다. 이 창은 닫으셔도 됩니다.
pause
