@echo off
cd /d %~dp0

REM ===== Distribution source (edit here if repo/branch/subfolder changes) =====
set "OWNER=pw-cpteam-ctrl"
set "REPO=share"
set "BRANCH=main"
set "SUBDIR=b2b-scraper"
REM ===========================================================================

echo.
echo Downloading latest version...
curl -L --ssl-no-revoke -o _update.zip "https://codeload.github.com/%OWNER%/%REPO%/zip/refs/heads/%BRANCH%"
if errorlevel 1 (
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
REM /XD, /XF : do NOT overwrite/remove the teammate's local login profile,
REM            saved session, installed deps, or the running update.bat itself.
for /d %%D in (%REPO%-*) do (
  robocopy "%%D\%SUBDIR%" "." /E /XD node_modules output recon-output /XF update.bat .local-version /NFL /NDL /NJH /NJS >nul
  rmdir /s /q "%%D"
)
del _update.zip >nul 2>&1

echo Checking for new dependencies...
call npm install

REM Record the version we just applied, so run.bat stops showing the update notice.
node check-update.js --save

echo.
echo Update complete. You can run the tool now (run.bat).
pause
