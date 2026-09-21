@echo off
cd /d %~dp0

set "OWNER=pw-cpteam-ctrl"
set "REPO=ccode"
rem 2026-09-21: 이 프로젝트가 main으로 옮겨졌는데 여기가 옛 브랜치를 그대로 가리키고 있었다.
rem 그래서 update.bat을 아무리 눌러도 옮기기 전 코드만 내려받았고, 고친 내용이 하나도
rem 반영되지 않았음(고쳤다고 안내했는데 그대로인 일이 실제로 있었음). 브랜치를 늘리지 말 것.
set "BRANCH=main"

echo.
echo Downloading latest version...
curl -L --ssl-no-revoke -o _update.zip "https://codeload.github.com/%OWNER%/%REPO%/zip/refs/heads/%BRANCH%"
if errorlevel 1 (
  echo.
  echo [FAILED] Download failed. Check your internet connection.
  pause
  exit /b 1
)

echo Extracting...
tar -xf _update.zip
if errorlevel 1 (
  echo [FAILED] Extract failed.
  del _update.zip >nul 2>&1
  pause
  exit /b 1
)

echo Applying update...
for /d %%D in (%REPO%-*) do (
  robocopy "%%D\sns-report-scraper" "." /E /XD node node_modules reports /XF update.bat /NFL /NDL /NJH /NJS >nul
  rem 이 파일은 지금 실행 중이라 덮어쓸 수 없어서 robocopy에서 뺐다. 대신 새 버전을 옆에
  rem 받아두고, 내용이 다르면 아래에서 바꾸라고 알려준다 — 안 그러면 이 파일만 영영 옛날
  rem 버전으로 남아서(위 브랜치 사고가 정확히 그랬다) 업데이트가 조용히 헛돈다.
  if exist "%%D\sns-report-scraper\update.bat" copy /y "%%D\sns-report-scraper\update.bat" "_update-new.bat" >nul
  rmdir /s /q "%%D"
)
del _update.zip >nul 2>&1

echo.
echo Checking for new dependencies...
if exist node\node.exe (
  set "PLAYWRIGHT_BROWSERS_PATH=0"
  node\npm.cmd install
) else (
  call npm install
)

if not exist "_update-new.bat" goto :done
fc /b "update.bat" "_update-new.bat" >nul 2>&1
if not errorlevel 1 del "_update-new.bat" >nul 2>&1 & goto :done
echo.
echo ============================================================
echo  [!] 업데이트 도구(update.bat) 자체가 새 버전입니다.
echo.
echo   이 창을 닫은 뒤, 같은 폴더에서
echo     1) update.bat 을 지우고
echo     2) _update-new.bat 의 이름을 update.bat 으로 바꿔주세요.
echo.
echo   안 바꾸면 다음 업데이트가 엉뚱한 곳에서 내려받을 수 있습니다.
echo ============================================================

:done
echo.
echo Done! Run start-dashboard.bat now.
echo.
pause
