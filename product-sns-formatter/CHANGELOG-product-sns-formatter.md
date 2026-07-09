# CHANGELOG — 상품 SNS 포맷터 (product-sns-formatter)

> 작성 규칙은 루트 [`CHANGELOG-작성-규칙.md`](../CHANGELOG-작성-규칙.md) 참고.

---

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
