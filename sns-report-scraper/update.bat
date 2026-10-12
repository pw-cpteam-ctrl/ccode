@echo off
chcp 65001 >nul
cd /d %~dp0

rem 2026-10-08: chcp 65001이 없어서 이 파일의 한글이 깨졌다. 깨진 바이트를 cmd가 명령어로
rem 읽어버려서 "'p' is not recognized" 같은 오류가 줄줄이 뜨고, 정작 읽어야 할 안내문을
rem 아무도 못 읽었다. start-dashboard.bat은 이미 chcp를 넣어뒀는데 여기만 빠져 있었다.

rem 2026-10-12: 새 업데이트 도구를 날짜로 비교해서 적용하던 방식을 걷어냈다.
rem   _update-new.bat은 copy로 만들어져서 'GitHub 압축파일 안의 날짜'(= 코드를 고친 날)를
rem   물려받는데, 쓰는 사람의 update.bat에는 '마지막으로 받은 날'이 찍힌다. 그래서 받은 쪽이
rem   항상 더 오래된 것으로 보여서, 매번 새 버전을 버리고 지웠다가 다음 실행 때 또 만들고를
rem   끝없이 반복했다. 폴더에 _update-new.bat이 계속 남아 있던 게 그 증상이었다.
rem   날짜는 애초에 믿을 게 못 되니 내용이 다른지만 보고, 교체도 다음 실행으로 미루지 말고
rem   이번 실행 안에서 끝낸다. 그래야 폴더에 찌꺼기가 안 남는다.

rem 지난 실행이 중간에 끊겨서 남은 찌꺼기 — 어차피 아래에서 새로 받으니 묻지 말고 지운다.
del "_update-new.bat" >nul 2>&1
del "_finish-update.bat" >nul 2>&1

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
  rem 위에서 update.bat을 뺀 건 지금 실행 중이라 덮어쓸 수 없기 때문이다(맨 아래에서 처리).
  if errorlevel 8 (
    echo [실패] 파일 덮어쓰기 실패 — 대시보드 창이 열려 있으면 닫고 다시 실행해주세요.
    pause
    exit /b 1
  )
  set "APPLIED=1"
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

rem ── 업데이트 도구 자신 교체 ──
rem 이 파일은 지금 실행 중이라 덮어쓸 수 없다(덮어쓰면 cmd가 읽던 위치가 어긋나 깨진다).
rem 그래서 바꿔주는 역할만 하는 작은 파일을 만들어 띄우고, 이쪽은 바로 빠져나간다.
rem 그 파일은 제 할 일을 마치면 자기 자신까지 지우므로 폴더에 아무것도 안 남는다.
if not exist "_update-new.bat" goto :done
fc /b "update.bat" "_update-new.bat" >nul 2>&1
if errorlevel 1 goto :selfswap
rem 내용이 같다 = 업데이트 도구는 그대로여도 된다.
del "_update-new.bat" >nul 2>&1
goto :done

:selfswap
echo.
echo 업데이트 도구 자신도 바뀌었습니다 — 바꾸는 중...
>"_finish-update.bat" (
  echo @echo off
  echo chcp 65001 ^>nul
  rem 경로 끝 역슬래시가 따옴표를 잡아먹는 일이 있어 점 하나를 붙여둔다(폴더명에 띄어쓰기가 있어도 안전).
  echo cd /d "%~dp0."
  echo rem update.bat이 완전히 끝나기를 잠깐 기다린다 — 실행 중에는 못 덮어쓴다.
  echo ping -n 3 127.0.0.1 ^>nul
  echo copy /y "_update-new.bat" "update.bat" ^>nul
  echo if errorlevel 1 ^(
  echo   echo [실패] 업데이트 도구 교체 실패 — update.bat을 쓰는 창이 아직 열려 있을 수 있습니다.
  echo   pause
  echo   exit /b 1
  echo ^)
  echo del "_update-new.bat" ^>nul 2^>^&1
  echo echo.
  echo echo 업데이트 도구 자신도 새 버전으로 바꿨습니다.
  echo echo 완료! 이제 start-dashboard.bat 을 실행하세요.
  echo echo.
  echo pause
  echo rem 제 할 일을 마쳤으니 자기 자신을 지운다 — 폴더에 찌꺼기를 남기지 않기 위해서다.
  echo del "%%~f0"
)
start "" "_finish-update.bat"
exit /b

:done
echo.
echo 완료! 이제 start-dashboard.bat 을 실행하세요.
echo.
pause
