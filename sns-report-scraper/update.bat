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
rem 옆에 받아둔 것이 '더 새 것일 때만' 바꾼다. 예전 방식이 남겨둔 낡은 _update-new.bat이
rem 그대로 있으면, 아무 검사 없이 바꿨다가 방금 고친 것을 옛 버전으로 되돌려버린다
rem (실제로 그럴 뻔했다). 더 오래된 것이면 쓰지 않고 지운다.
if exist "_update-new.bat" (
  set "SELFNEW="
  for /f %%R in ('powershell -NoProfile -Command "if((Get-Item '_update-new.bat').LastWriteTime -gt (Get-Item 'update.bat').LastWriteTime){'NEW'}else{'OLD'}"') do set "SELFNEW=%%R"
  goto :selfcheck
)
goto :afterself
:selfcheck
if "%SELFNEW%"=="NEW" (
  copy /y "_update-new.bat" "update.bat" >nul
  del "_update-new.bat" >nul 2>&1
  echo 업데이트 도구를 새 버전으로 바꿨습니다. 새 창에서 다시 시작합니다...
  start "" "%~f0"
  exit /b
)
echo 옆에 있던 낡은 업데이트 도구 사본(_update-new.bat)을 지웁니다.
del "_update-new.bat" >nul 2>&1
:afterself

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

rem ── 받은 게 진짜 더 새 것인지 먼저 본다 ──
rem 이걸 안 해서 세 번이나 조용히 옛 코드로 되돌아갔다. 엉뚱한 곳에서 받아도 마지막에
rem "완료!"만 떠서, 받는 쪽이 아니라 엉뚱한 데를 몇 시간씩 뒤졌다. 되돌아가는 일이
rem 생기면 덮어쓰기 전에 여기서 멈춘다 — 조용히 망가지는 것보다 시끄럽게 멈추는 게 낫다.
set "FRESH="
set "GUARD=%REPO%-%BRANCH%\sns-report-scraper\stock-report.js"
if not exist "%GUARD%" (
  echo [실패] 내려받은 꾸러미 안에 코드가 없습니다 — 주소가 잘못됐을 수 있습니다.
  echo         받은 곳: %OWNER%/%REPO%  가지: %BRANCH%
  pause
  exit /b 1
)
for %%F in ("%GUARD%") do echo 받은 코드 날짜: %%~tF   (받은 곳 %OWNER%/%REPO%, 가지 %BRANCH%)
if exist "stock-report.js" (
  for /f %%R in ('powershell -NoProfile -Command "if((Get-Item '%GUARD%').LastWriteTime -lt (Get-Item 'stock-report.js').LastWriteTime){'OLDER'}else{'OK'}"') do set "FRESH=%%R"
)
if "%FRESH%"=="OLDER" (
  echo.
  echo ============================================================
  echo  [멈춤] 지금 가지고 있는 코드보다 더 오래된 것을 받았습니다.
  echo         덮어쓰면 고쳐둔 것이 되돌아가므로 여기서 멈춥니다.
  echo         받은 곳: %OWNER%/%REPO%  가지: %BRANCH%
  echo         이 두 줄을 그대로 전달해주세요.
  echo ============================================================
  rmdir /s /q "%REPO%-%BRANCH%" >nul 2>&1
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
  rem 위에서 update.bat을 뺀 건 지금 실행 중이라 덮어쓸 수 없기 때문이다(아래에서 옆에 받아둔다).
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
