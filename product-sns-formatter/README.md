# 상품 SNS 포맷터

상품 정보 텍스트를 붙여넣으면 LLM이 회사 SNS 포맷으로 자동 변환해주는 도구.
FAQ봇이 아니라 **단발성 텍스트 변환기**이며, 대화를 기억하지 않는 stateless
설계다. 기획 배경은 [`PLAN.md`](./PLAN.md) 참고.

## 지금 상태 (설정 완료, 배포됨)

- **화면(`index.html`)**: 상품정보/추가지시 입력, 메모장 저장(브라우저
  `localStorage`)까지 동작한다.
- **변환 기능(`api/format.js`)**: Claude API(Anthropic)로 변환한다. Vercel
  환경변수 `ANTHROPIC_API_KEY`와 `rules/format-rules.js`의 실제 회사 SNS
  포맷 규칙 문서가 채워져 있어야 동작한다.
  - 원래 Gemini 무료 티어로 시작했으나, 무료 티어 등급 판별 문제로 결제
    연결이 필요해졌고 선불 충전 최소 금액이 부담스러워서 Claude API로
    전환함.
- **메모/로그의 깃허브 저장(`api/save-memo.js`, `api/save-log.js`)**:
  `GITHUB_TOKEN` 등 환경변수로 이 레포에 커밋한다.

## 사용법

1. `index.html`에서 상품정보(본문)와 추가지시(선택, 이번 건 한정)를 각각 입력
2. **변환하기** → 결과가 나오면 **결과 복사**로 그대로 SNS에 붙여넣기
3. 포맷이 아쉬우면 **개선사항 메모장**에 남기기 (LLM에는 전송되지 않고, 나중에
   사람이 훑어보고 규칙 파일에 반영할지 판단하는 용도)

## Vercel 배포 시 참고

- 이 저장소는 다른 도구들과 같이 쓰고 있어서, Vercel 프로젝트를 만들 때
  **Root Directory를 `product-sns-formatter`로 지정**해야 한다 (레포 전체가
  아니라 이 폴더만 배포).
- 배포 후 아래 환경변수를 등록해야 각 기능이 동작한다.

| 환경변수 | 용도 | 비고 |
|---|---|---|
| `ANTHROPIC_API_KEY` | `api/format.js`의 LLM 호출 | [console.anthropic.com](https://console.anthropic.com)에서 발급 (결제 필요) |
| `GITHUB_TOKEN` | `api/save-memo.js`, `api/save-log.js`의 깃허브 커밋 | fine-grained PAT, 이 레포에 Contents 쓰기 권한 |
| `GITHUB_OWNER`, `GITHUB_REPO` | 메모 + 입력 로그 저장 대상 (둘 다 이 레포) | `GITHUB_BRANCH` 생략 시 `main` |
| `GITHUB_LOG_OWNER`, `GITHUB_LOG_REPO` | (선택) 입력 로그를 다른 레포에 저장하고 싶을 때만 | 지금은 로그도 공개 정보로 판단해서 별도 비공개 레포 없이 이 레포에 같이 저장하기로 결정 — 필요해지면 이 두 값만 채우면 됨 |

## 규칙 문서 갱신

실제 회사 SNS 포맷 규칙이 바뀌면 `rules/format-rules.js`의 `FORMAT_RULES`
내용만 그 문서로 교체하면 된다. AI에게 "기억해"라고 요청해도 반영 안 되는
구조 — 반드시 이 파일을 직접 수정해야 한다 (PLAN.md의 stateless 설계 원칙
참고).
