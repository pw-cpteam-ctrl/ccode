@echo off
cd /d %~dp0

set "OWNER=pw-cpteam-ctrl"
set "REPO=ccode"
set "BRANCH=claude/sns-report-automation-k14iq0"

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
  rmdir /s /q "%%D"
)
del _update.zip >nul 2>&1

echo.
echo Done! Run start-dashboard.bat now.
echo.
pause
