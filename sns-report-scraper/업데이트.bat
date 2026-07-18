@echo off
chcp 65001 >nul
cd /d %~dp0

REM ================================================================
REM  이 도구를 최신 버전으로 업데이트합니다 (git 설치 필요 없음, 더블클릭만).
REM  요즘 윈도우(10·11)에 기본으로 들어있는 다운로드 기능(curl)만 씁니다.
REM
REM  아래 3줄은 "배포 담당자"만 한 번 확인하면 됩니다. 팀원은 안 건드려도 돼요.
set "OWNER=pw-cpteam-ctrl"
set "REPO=ccode"
set "BRANCH=claude/sns-report-automation-k14iq0"
REM ================================================================

echo.
echo  최신 버전을 받는 중입니다...
curl -L --ssl-no-revoke -o _update.zip "https://codeload.github.com/%OWNER%/%REPO%/zip/refs/heads/%BRANCH%"
if errorlevel 1 (
  echo.
  echo  [실패] 다운로드가 안 됐어요. 인터넷 연결을 확인하고 다시 시도해주세요.
  pause
  exit /b 1
)

echo  압축을 푸는 중입니다...
tar -xf _update.zip
if errorlevel 1 (
  echo  [실패] 압축 해제 오류. 관리자에게 문의해주세요.
  del _update.zip >nul 2>&1
  pause
  exit /b 1
)

echo  최신 소스로 교체하는 중입니다...
REM 받아온 소스 폴더(REPO-브랜치...) 안의 sns-report-scraper 내용만 덮어씀.
REM node(포터블 노드)·node_modules(라이브러리/브라우저)·reports·로그인 세션은 그대로 둠.
for /d %%D in (%REPO%-*) do (
  robocopy "%%D\sns-report-scraper" "." /E /XD node node_modules reports /NFL /NDL /NJH /NJS >nul
  rmdir /s /q "%%D"
)
del _update.zip >nul 2>&1

echo.
echo  ✅ 업데이트 완료! 이제 start-dashboard.bat 을 실행하면 최신 버전으로 열립니다.
echo.
pause
