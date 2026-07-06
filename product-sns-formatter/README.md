# 상품 SNS 포맷터

상품 정보 텍스트를 붙여넣으면 LLM이 회사 SNS 포맷으로 자동 변환해주는 도구.
FAQ봇이 아니라 **단발성 텍스트 변환기**이며, 대화를 기억하지 않는 stateless
설계다. 기획 배경은 [`PLAN.md`](./PLAN.md) 참고.

## 지금 상태 (막힌 부분 빼고 뼈대만 완성)

- **화면(`index.html`)은 지금 바로 열어볼 수 있음** — 상품정보/추가지시 입력,
  메모장 저장(브라우저 `localStorage`)까지는 백엔드 없이도 동작한다.
- **변환 기능(`api/format.js`)은 아직 작동 안 함** — 아래 두 가지가 모두 채워져야
  실제로 동작한다.
  1. Vercel 환경변수 `GEMINI_API_KEY`
  2. `rules/format-rules.js`에 실제 회사 SNS 포맷 규칙 문서 내용 (지금은 자리표시자)
- **메모/로그의 깃허브 저장(`api/save-memo.js`, `api/save-log.js`)도 아직 작동
  안 함** — `GITHUB_TOKEN` 등 환경변수가 없어서다. 메모는 그동안 브라우저에만
  임시로 남는다 (새로고침해도 유지됨, 단 다른 컴퓨터로는 인수인계 안 됨).
- **Vercel 배포 자체가 안 됨** — 계정이 아직 없다.

## 사용법 (백엔드 준비 후)

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
| `GEMINI_API_KEY` | `api/format.js`의 LLM 호출 | [ai.google.dev](https://ai.google.dev)에서 무료 발급 |
| `GITHUB_TOKEN` | `api/save-memo.js`, `api/save-log.js`의 깃허브 커밋 | fine-grained PAT, 이 레포에 Contents 쓰기 권한 |
| `GITHUB_OWNER`, `GITHUB_REPO` | 메모 + 입력 로그 저장 대상 (둘 다 이 레포) | `GITHUB_BRANCH` 생략 시 `main` |
| `GITHUB_LOG_OWNER`, `GITHUB_LOG_REPO` | (선택) 입력 로그를 다른 레포에 저장하고 싶을 때만 | 지금은 로그도 공개 정보로 판단해서 별도 비공개 레포 없이 이 레포에 같이 저장하기로 결정 — 필요해지면 이 두 값만 채우면 됨 |

## 막혀서 다음 단계로 못 넘어가는 것 (사용자 준비 필요)

1. **Gemini API 키** — [ai.google.dev](https://ai.google.dev)에서 무료 발급
   (카드 불필요). 채팅에 붙여넣지 말고 Vercel 환경변수로 바로 등록할 것.
2. **Vercel 계정** — 깃허브 레포 연결, Root Directory는 `product-sns-formatter`
3. **깃허브 Personal Access Token** — 이 레포 한정, 쓰기 권한, fine-grained 추천
4. **실제 회사 SNS 포맷 규칙 문서** — 회사 컴퓨터에 이미 만들어둔 문서를 공유받으면
   `rules/format-rules.js`의 `FORMAT_RULES` 내용만 그 문서로 교체하면 된다
