@echo off
cd /d %~dp0
if not exist node_modules (
  echo 처음 실행이라 필요한 프로그램을 설치합니다. 몇 분 걸릴 수 있어요...
  call npm install
)
echo 대시보드를 시작합니다. 잠시 후 브라우저가 자동으로 열립니다.
echo 이 창을 닫으면 대시보드도 함께 꺼집니다 - 다 쓸 때까지 이 창은 열어두세요.
start "" cmd /c "timeout /t 2 >nul && start http://localhost:4848"
node web\server.js
pause
