@echo off
chcp 65001 >nul
cd /d %~dp0

REM ── 포터블 패키지(팀원 배포용)면 폴더 안의 node와 브라우저를 사용 ──
if exist node\node.exe (
  set "NODE=node\node.exe"
  set "PLAYWRIGHT_BROWSERS_PATH=0"
) else (
  set "NODE=node"
  if not exist node_modules (
    echo 처음 실행이라 필요한 프로그램을 설치합니다. 몇 분 걸릴 수 있어요...
    call npm install
    echo 브라우저를 내려받는 중입니다...
    call npx playwright install chromium
  )
)

echo 추첨기를 시작합니다. 잠시 후 브라우저가 자동으로 열립니다.
echo 이 창을 닫으면 추첨기도 함께 꺼집니다 - 다 쓸 때까지 이 창은 열어두세요.
start "" cmd /c "timeout /t 2 >nul && start http://localhost:4850"
%NODE% server.js
pause
