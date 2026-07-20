; ============================================================================
;  SNS 성과 리포트 대시보드 - Inno Setup 설치 스크립트
; ----------------------------------------------------------------------------
;  이 파일은 팀원에게 나눠줄 "installer.exe"를 만들기 위한 레시피입니다.
;
;  [빌드하는 법] (윈도우에서, 배포 담당자만)
;   1. https://jrsoftware.org/isdl.php  에서 Inno Setup 설치 (무료, 처음 한 번만)
;   2. 이 파일(installer.iss)을 더블클릭해서 Inno Setup 으로 열기
;   3. 상단 메뉴 Build > Compile  (또는 F9) 클릭
;   4. 잠시 후 이 폴더 안에 "SNS리포트-설치.exe" 가 생깁니다  → 이게 팀원에게 줄 파일
;
;  ⚠️ 컴파일 전에 이 폴더 안에 node\, node_modules\ 가 준비돼 있어야 합니다
;     (배포-패키지-만들기.md 의 "준비물" 단계를 먼저 끝내둘 것)
; ============================================================================

#define AppName "SNS 성과 리포트 대시보드"
#define AppVersion "1.0"

[Setup]
; AppId 는 "이 프로그램의 고유 번호". 절대 바꾸지 마세요 -
; 이 값이 같아야 다음 버전을 깔 때 "새로 까는 것"이 아니라 "업데이트"로 인식됩니다.
AppId={{A7F3E1C2-5B9D-4E6A-8C1F-2D3B4A5E6F70}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Presence World

; ★ 핵심: 관리자 전용 구역(Program Files)이 아니라 개인 서랍에 설치
;   → 세션파일/리포트 저장이 권한에 막히지 않음
DefaultDirName={localappdata}\SNSReport
PrivilegesRequired=lowest

; 설치 마법사에서 "어느 폴더에 깔지" 물어보는 화면을 건너뜀 (경로 고정)
DisableDirPage=yes
DisableProgramGroupPage=yes

; 만들어질 설치파일 이름과 위치 (이 .iss 와 같은 폴더에 생김)
OutputDir=.
OutputBaseFilename=SNS리포트-설치

Compression=lzma2
SolidCompression=yes
WizardStyle=modern

; 아이콘을 넣고 싶으면 이 폴더에 icon.ico 를 두고 아래 줄의 맨 앞 세미콜론(;)을 지우세요
;SetupIconFile=icon.ico

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[Files]
; 이 폴더 전체를 설치 대상에 담되, 아래 것들은 제외:
;  - *.md            : 내부 문서 (팀원에게 불필요)
;  - *.iss           : 이 스크립트 자신
;  - SNS리포트-설치.exe : 빌드 결과물 자신
;  - *-session.json  : 개인 로그인 세션 (넘기면 안 됨)
;  - reports\*       : 내가 뽑은 리포트
;  - .git, .gitignore, PLAN/WORKLOG 등 개발용 파일
Source: "*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion; \
  Excludes: "*.md,*.iss,SNS리포트-설치.exe,x-session.json,instagram-session.json,*-session.json,\reports\*,\.git\*,.gitignore,\verify-output\*"

[Icons]
; 바탕화면 바로가기 2개
Name: "{autodesktop}\SNS 리포트 실행";   Filename: "{app}\start-dashboard.bat"; WorkingDir: "{app}"; Comment: "대시보드를 켭니다"
Name: "{autodesktop}\SNS 리포트 업데이트"; Filename: "{app}\update.bat";          WorkingDir: "{app}"; Comment: "최신 버전으로 업데이트합니다"
; 시작 메뉴에도 동일하게 등록
Name: "{autoprograms}\SNS 리포트 실행";   Filename: "{app}\start-dashboard.bat"; WorkingDir: "{app}"
Name: "{autoprograms}\SNS 리포트 업데이트"; Filename: "{app}\update.bat";          WorkingDir: "{app}"

[Run]
; 설치가 끝나면 "지금 바로 실행" 체크박스를 보여줌 (선택사항)
Filename: "{app}\start-dashboard.bat"; Description: "지금 바로 대시보드 실행"; \
  WorkingDir: "{app}"; Flags: postinstall shellexec nowait skipifsilent
