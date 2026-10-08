@echo off
chcp 65001 >nul
cd /d %~dp0

rem 2026-10-08: chcp 65001이 없어서 이 파일의 한글이 깨졌다. 깨진 바이트를 cmd가 명령어로
rem 읽어버려서 "'p' is not recognized" 같은 오류가 줄줄이 뜨고, 정작 읽어야 할 안내문을
rem 아무도 못 읽었다. start-dashboard.bat은 이미 chcp를 넣어둬서 멀쩡했는데 여기만 빠져 있었다.

rem 지난번에 받아둔 새 업데이트 도구가 있으면 먼저 자기 자신부터 바꾸고 다시 시작한다.
rem 예전에는 "update.bat을 지우고 _update-new.bat의 이름을 바꿔주세요"라고 사람에게
rem 부탁했는데, 그 안내문이 깨져서 보이지도 않았고 아무도 바꾸지 않아 이 파일만 계속
rem 옛 버전으로 남았다. 사람 손을 빌리지 않고 여기서 끝낸다.
if exist "_update-new.bat" (
  copy /y "_update-new.bat" "update.bat" >nul
  del "_update-new.bat" >nul 2>&1
  echo 업데이트 도구를 새 버전으로 바꿨습니다. 새 창에서 다시 시작합니다...
  start "" "%~f0"
  exit /b
)

set "OWNER=pw-cpteam-ctrl"
set "REPO=ccode"
rem 2026-09-21: 이 프로젝트가 main으로 옮겨졌는데 여기가 옛 브랜치를 그대로 가리키고 있었다.
rem 그래서 update.bat을 아무리 눌러도 옮기기 전 코드만 내려받았고, 고친 내용이 하나도
rem 반영되지 않았음(고쳤다고 안내했는데 그대로인 일이 실제로 있었음). 브랜치를 늘리지 말 것.
set "BRANCH=main"

echo.
echo 최신 버전을 내려받는 중...
curl -L --ssl-no-revoke -o _update.zip "https://codeload.github.com/%OWNER%/%REPO%/zip/refs/heads/%BRANCH%"
if errorlevel 1 (
  echo.
  echo [실패] 내려받기 실패 — 인터넷 연결을 확인해주세요.
  pause
  exit /b 1
)

echo 압축을 푸는 중...
tar -xf _update.zip
if errorlevel 1 (
  echo [실패] 압축 풀기 실패.
  del _update.zip >nul 2>&1
  pause
  exit /b 1
)

echo 파일을 덮어쓰는 중...
set "APPLIED="
for /d %%D in (%REPO%-*) do (
  rem 결과를 >nul로 감추지 않는다 — 예전에 복사가 조용히 실패했는데 "Done!"만 떠서
  rem 업데이트가 된 줄 알고 한참 헤맸다. robocopy는 성공해도 0이 아닌 값을 돌려주므로
  rem errorlevel 8 이상만 실패로 본다.
  robocopy "%%D\sns-report-scraper" "." /E /XD node node_modules reports /XF update.bat /NFL /NDL /NJH /NJS
  if errorlevel 8 (
    echo [실패] 파일 덮어쓰기 실패 — 대시보드 창이 열려 있으면 닫고 다시 실행해주세요.
    pause
    exit /b 1
  )
  set "APPLIED=1"
  rem 이 파일은 지금 실행 중이라 덮어쓸 수 없어서 robocopy에서 뺐다. 옆에 받아두면
  rem 다음 실행 때 맨 위에서 자동으로 교체된다.
  if exist "%%D\sns-report-scraper\update.bat" copy /y "%%D\sns-report-scraper\update.bat" "_update-new.bat" >nul
  rmdir /s /q "%%D"
)
del _update.zip >nul 2>&1

if not defined APPLIED (
  echo [실패] 내려받은 폴더를 찾지 못했습니다 — 압축은 풀렸는데 %REPO%-* 폴더가 없습니다.
  pause
  exit /b 1
)

echo.
echo 새로 필요한 프로그램이 있는지 확인하는 중...
if exist node\node.exe (
  set "PLAYWRIGHT_BROWSERS_PATH=0"
  node\npm.cmd install
) else (
  call npm install
)

if exist "_update-new.bat" (
  fc /b "update.bat" "_update-new.bat" >nul 2>&1
  if not errorlevel 1 del "_update-new.bat" >nul 2>&1
)

echo.
echo 완료! 이제 start-dashboard.bat 을 실행하세요.
echo.
pause
