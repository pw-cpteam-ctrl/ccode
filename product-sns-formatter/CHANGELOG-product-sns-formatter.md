# CHANGELOG — 상품 SNS 포맷터 (product-sns-formatter)

> 작성 규칙은 루트 [`CHANGELOG-작성-규칙.md`](../CHANGELOG-작성-규칙.md) 참고.

---

<details open>
<summary>2026-07-28 ~ 07-29 (V2.1 일괄 원고 생성 + 캐러셀 개편 + B2B 배포 준비)</summary>

## 2026-07-28 ~ 07-29 (V2.1 일괄 원고 생성 + 캐러셀 개편 + B2B 배포 준비)

- **원고 (신규 기능 + 버그 수정)**
  - 여러 상품 원고를 한 번에 생성하는 **일괄 원고 생성** 버튼 추가
    (기술: 동시 5개 제한 병렬 처리, `runBatchGenerate`/`generateDraftCore` 공용화)
  - 고유명사를 뜻으로 창작해 바꿔치기하던 문제 수정 (예: "하츠네 미쿠"→"초음속 미쿠")
    (기술: 소리 나는 대로만 옮기라는 규칙 추가 + `rules/proper-nouns.js` 프롬프트 주입)
  - 제목(【】) 안 영문 고유명사가 한글로 안 바뀌던 규칙 충돌 수정, "Umamusume" 등 사전 보강
    (기술: `format-rules.js` 제목 보존 규칙에 예외 조항 추가, `proper-nouns.js` 항목 추가)
  - 이상 감지 로그 저장 실패 시 "저장됐다"고 거짓 안내하던 버그 수정
    (기술: `logAnomaly()` 성공/실패 boolean 반환, 안내 문구 분기)

- **캐러셀 이미지**
  - 사진 기본 배치를 중앙 기준에서 위쪽 기준으로 변경 (얼굴 잘림 방지)
    (기술: `addPhotoFileToProduct` 기본 `oy` 계산 변경)
  - 미세한 렌더링 흠집(우측 1px 선, 그라데이션-틀 경계 틈, 뱃지 위치) 수정
    (기술: `COVER_FIT_SLOP`, 그라데이션 `fillRect` 확장, `textBaseline:middle`)
  - 그라데이션/뱃지 자간을 상품별 개별 설정에서 전체 공통 설정으로 변경
    (기술: `GLOBAL_GRAD` 전역 상태로 이전)
  - 틀 off 시 사진 주위에 흰 여백이 남던 문제 수정
    (기술: `fitRectFor(slide)`로 cover-fit 기준 영역 분기)
  - "대표만 남기고 나머지 틀 제거" 버튼을 진짜 토글로 수정 + 대표 전환 시 이전 대표 틀
    복원 안 되던 버그 수정
    (기술: `toggleFrameOnNonMain`, 대표 전환 시 `noFrame` 동기화)
  - 제목 입력창 줄바꿈(Enter) 무시되던 문제 수정
    (기술: `wrapCanvasText` 문단 우선 분리)
  - 미리보기 화면 크기 2배 확대 (저장용 실제 해상도는 그대로)
    (기술: `#composerCanvas` 210x262.5 → 420x525, `composerScale` 자동 재계산)
  - 부제(작은 글자) 소스를 원고의 『작품명』에서 상품정보 기반 **제품 라인**으로 변경
    (기술: `rules/product-lines.js` 신설, officialText 키워드 매칭)
  - 제목/부제 글자크기 조절 슬라이더 각각 추가
    (기술: `GLOBAL_GRAD.titleFontSize`/`subFontSize`)

- **좌측 상품 목록**
  - 대표 사진 썸네일 추가 + 레이아웃 개편(패딩·폭·폰트 조정, 줌 기준점 재조정)
    (기술: `.md-thumb-wrap`, `preloadMainThumbnails`, 썸네일 200% 확대 기준 위쪽 25%)
  - 영어→한글 발음 변환기(AI 아님, 미리보기 전용) 오표기 다수 수정
    (기술: L 겹받침 트레일링 클러스터 처리, 하이픈 단어경계 처리)
  - B2B 가져오기 안내문구를 비개발자도 이해할 수 있게 수정
    (기술: 경로 표기 대신 "오늘 날짜 이름의 폴더"로 서술)
  - 상품 초기화 버튼 추가 (사진 캐싱 포함 전체 삭제, 확인창 필수)
    (기술: `resetAllProducts`, IndexedDB+`imgCache`+localStorage 동시 정리)

- **B2B 가져오기**
  - 폴더 선택 없이 드래그앤드롭으로 가져오기 지원
    (기술: `DataTransferItem`/`FileSystemEntry` 재귀 탐색)

- **b2b-scraper (별도 로컬 도구)**
  - 수집 항목에서 가격/카톤수량 제외, 성인 전용 상품 자동 제외
  - 팀원 배포 준비 — 로그인 세션 저장 위치를 도구 폴더 밖으로 분리(보안), 업데이트
    확인/적용 기능, 스크랩 완료 시 결과 폴더 클립보드 복사+탐색기 자동 오픈, 스크랩 전체
    실패 시 팀원용 친절한 오류 메시지, 별도 공개 저장소(`share`)로 배포 경로 결정
    (기술: `profile-dir.js`, `check-update.js`/`update.bat`, `os-helpers.js`,
    `friendly-error.js`)

</details>

<details>
<summary>이전 기록 (2026-07-24 이전)</summary>

## 2026-07-24 (V2.0 다중 상품 작업대 + 캐러셀 이미지 도구)

- **화면 구조 전면 개편**
  - 상품 1건씩 처리하던 화면을 **좌측 오늘의 상품 목록 / 우측 작업 화면** 구조로 재구성
    (기술: `PRODUCTS` 배열 + `currentProductId` 기반 master-detail 구조, `localStorage`에
    상품 메타 저장)
  - 상품마다 **상품정보 → 원고 → 캐러셀 이미지** 3단계를 한 화면에서 순서대로 처리
    (기술: 상품 상세 렌더링 함수 `renderDetail()`이 세 단계를 순차 렌더)
  - 참고 DB(실제 게시물 157건)를 상품 상세 화면에서 바로 검색해 캐릭터 메모에 담을 수
    있게 연결 (기술: 기존 `refdb` 검색 로직 재사용, 검색 결과 클릭 시 `memoText`에 추가)

- **원고 (X 기준 + 인스타용 1클릭 변환)**
  - 원고는 실제 판매 링크가 들어간 형태를 기본으로 생성, 기존 원문/결과 비교·교정
    내역·글자수 표시는 그대로 재사용
    (기술: 기존 `computeDiff`/`renderCorrections` 로직을 상품별 상태로 감싸 재사용)
  - **인스타용 복사** 버튼 추가 — 별도 화면 없이 누르면 판매 링크 줄만 안내 문구로 자동
    치환해 바로 클립보드 복사
    (기술: `insVersion()` 정규식으로 `🛒 : <링크>` 줄만 치환)

- **캐러셀 이미지 (신규 기능)**
  - 사진을 올리면 자동으로 1080x1350(4:5) 비율로 꽉 채워 자르고, 실제 주황 틀 이미지를
    얹어 완성본을 만드는 기능 추가
    (기술: canvas 기반 cover-fit 합성, `assets/frame-orange.png` 오버레이)
  - 사진이 틀 위쪽 로고 띠에 가려지는 문제 완화 — 자르는 기준을 캔버스 전체가 아니라
    틀에서 실제로 보이는 영역으로 변경
    (기술: 틀 PNG 알파 채널 실측 후 `FRAME_INNER` 좌표 기준 cover-fit 재계산, 마커
    이미지로 노출 비율 0% → 2.66%로 개선 확인)
  - 여러 장 중 대표 사진에만 그라데이션+글자, 나머지는 틀도 개별로 껐다 켤 수 있음
    (기술: `slide.noFrame` 플래그, 대표 지정 시 강제 해제)
  - 사진 순서를 마우스로 직접 끌어서 재정렬 가능 (화살표 버튼 방식 폐기)
    (기술: mousedown/mousemove/mouseup 기반 드래그, `slide.key` 기준 재정렬로 인덱스
    꼬임 방지)
  - 슬라이드별 PNG 저장, 상품별/하루 전체 ZIP 다운로드 지원
    (기술: JSZip, IndexedDB에 원본 사진 blob 저장)

- **B2B 가져오기 (신규 기능, 부분 완료)**
  - "B2B에서 오늘 상품 가져오기" 버튼을 안내문 alert에서 실제 동작으로 교체 — 결과
    파일(JSON+사진)을 선택하면 상품 목록에 자동 반영
    (기술: 파일명 매칭 기반 import, `addPhotoFileToProduct` 헬퍼를 수동 업로드와 공유)
  - 실제 사이트 로그인·자동 수집은 별도 프로젝트(`b2b-scraper`)로 착수, 로그인 세션
    저장/사이트 구조 정찰/사진 다운로드 뼈대까지 작성 (실제 사이트 연동은 로컬 환경에서
    로그인 진행 후 이어서 완성 예정)
    (기술: Playwright 기반, `recon.js`+`scrape.js`)
  - 비개발자 팀원이 실제로 쓸 실행 방식 정리 — 더블클릭 런처(`run.bat`/`run.command`)로
    Node 설치 확인부터 실행까지 자동화, 로그인 세션을 전용 크롬 프로필로 기억시켜 로그인
    스크립트 없이 스크래핑 스크립트 하나가 로그인 필요 여부를 자동 판단
    (기술: `playwright-core`+`channel:'chrome'`+`launchPersistentContext`, URL 변화 기반
    로그인 완료 자동 감지로 터미널 입력 없앰)

## 2026-07-13 (V1.6 실제 게시물 데이터 기반 규칙 재정비 + 진단 도구)

- **규칙 재정비**
  - 실제 계정 게시물 157건을 받아 굿스마일 브랜드 규칙을 추측 기반에서 실측 기반으로
    전면 재작성 (글자수 제한, 해시태그 개수, 발표 전용 양식, 대사·일본어·조사 반복 등
    세부 규칙 다수 보강)
    (기술: `rules/format-rules.js` GOODSMILE_RULES 전면 개정)
  - 결과에 없던 일본어가 섞여 나오는 경우를 자동으로 감지해 차단하는 안전장치 추가
    (기술: `detectAnomaly()`, 히라가나/가타카나 유니코드 범위로 신규 문자 검출)

- **화면 (진단 도구)**
  - 원문/결과 좌우 비교(빠진 것 빨강, 추가된 것 초록) 화면 추가, 색 on/off 토글 지원
    (기술: LCS 기반 단어 단위 diff, `computeDiff`/`renderDiffView`)
  - 교정 내역 중 "무엇을 무엇으로" 부분만 자동 볼드 처리
    (기술: `boldKeyParts()`, 따옴표/괄호 구간 정규식 매칭)
  - 브랜드 선택 버튼을 독립된 박스형 3버튼으로 변경, 굿스마일 기본 선택
    (기술: `.brand-toggle`/`.brand-opt` 스타일 개편)
  - AI가 규칙을 어겨 자동 차단된 경우 원인을 기록하고 화면에서 확인할 수 있는 "이상 감지
    로그" 접이식 패널 추가
    (기술: `api/anomaly-log.js`, 깃허브 커밋 기반 로그 저장·조회)
  - 실제 게시물 157건을 작품/캐릭터로 검색할 수 있는 "참고 DB" 접이식 패널 추가
    (기술: `data/goodsmile-reference.json` 정적 데이터, 클라이언트 검색)

## 2026-07-04 (V1.0 초기 뼈대)
- **화면(index.html)**
  - 상품정보(본문) / 추가지시(선택, 이번 건 한정) 입력창을 칸부터 분리해서 구현.
  - 변환 버튼 → 결과 표시 → 결과 복사 버튼까지 화면 흐름 완성.
  - 개선사항 메모장 추가 — LLM에 전송되지 않는 별도 영역, `localStorage`로 새로고침해도 안 날아가게 처리 (깃허브 연동 전 임시 저장소).

- **백엔드 뼈대**
  - `api/format.js`: LLM 호출 서버리스 함수 뼈대 추가 (최초엔 Gemini). Stateless 설계 — 매 요청마다 새 프롬프트 구성, 본문은 순수 데이터로만 취급하고 추가지시는 "이번 요청 1건 한정"으로 명시해 프롬프트 인젝션 방지.
  - `api/save-memo.js`, `api/save-log.js`, `lib/github.js`: 깃허브 Contents API로 메모/로그를 커밋하는 헬퍼 추가.
  - `rules/format-rules.js`: 시스템 프롬프트에 매번 통째로 넣을 회사 SNS 포맷 규칙 파일 자리 신설 (자리표시자 상태로 시작).

- **배포 준비**
  - `package.json`에 `{"type": "module"}` 추가 — Vercel Node 런타임 ESM 대응.

---

## 2026-07-06 (V1.1 ~ V1.4 실사용 전환: 배포·규칙 반영·Claude API 전환·허브 연동)

- **배포**
  - Vercel 프로젝트 연결 및 배포 완료 (Root Directory: `product-sns-formatter`).
  - `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO` 등 환경변수 등록 → 메모/로그 깃허브 저장 기능 실사용 가능해짐.
  - 입력 로그 저장 대상을 별도 비공개 레포 대신 이 레포(`GITHUB_REPO`)로 통합하기로 결정 — 공개돼도 무방한 정보로 판단.

- **규칙 문서 반영**
  - `rules/format-rules.js`의 자리표시자를 실제 회사 SNS 작성 규칙(굿스마일 v2.1, 부시로드 260706, 메가하우스)으로 전면 교체.
  - 브랜드별 글자 수 제한, 해시태그 우선순위, 스펙 라인 압축, 종결 어미 규칙 등 반영.

- **LLM 전환 (Gemini → Claude)**
  - Gemini 무료 티어 사용 중 등급 판별이 "limit: 0"으로 막혀 결제 계정 연결이 강제됐고, 선불 충전 최소 금액이 부담스러워 **Claude API(Anthropic)로 전환**.
  - `api/format.js`를 `@anthropic-ai/sdk` 기반 `claude-haiku-4-5` 호출로 재작성, `package.json`에 SDK 의존성 추가.
  - 환경변수를 `GEMINI_API_KEY` → `ANTHROPIC_API_KEY`로 변경.

- **허브 연동 및 안내 문서**
  - 루트 허브 페이지(`index.html`)에 "상품 SNS 포맷터" 카드 추가 (Vercel 배포 주소로 외부 링크 연결).
  - 화면 상단에 처음 쓰는 팀원을 위한 "📌 필독!" 안내 박스 추가 — 펼쳐진 상태로 고정, 사용법 3단계 + 주의사항(대화 기억 없음, 추가지시는 1회성, 메모장 용도)을 쉬운 말로 설명.
  - 화면에 남아있던 오래된 `GEMINI_API_KEY` 에러 문구를 `ANTHROPIC_API_KEY` 기준으로 수정.

---

## 2026-07-09 (V1.5 배포 최적화)
- **배포**
  - `vercel.json`에 `ignoreCommand` 추가 — 모노레포 내 다른 도구(insta-gen, text-gradient 등) 폴더만 바뀐 커밋에는 이 프로젝트가 재배포를 스킵하도록 처리, Vercel Hobby 플랜 하루 배포 한도 낭비 방지.

</details>
