# logs/ — 서버가 자동으로 쌓는 기록 폴더

이 폴더의 파일은 **사람이 직접 만들지 않는다.** 배포된 서버(Vercel)가 GitHub에
직접 커밋해서 쌓는다.

## creator-guide 문의 로그

- 파일: `creator-guide-questions-YYYY-MM.jsonl` (월별로 새 파일)
- 쌓는 곳: `creator-guide/api/log-question.js`
- 한 줄 = 문의 1건. 형식:

```json
{"at":"2026-08-09T05:12:33.000Z","brand":"megahouse","kind":"preset","question":"...","answer":"...","unanswered":false}
```

| 항목 | 뜻 |
| --- | --- |
| `at` | 시각 (UTC 기준) |
| `brand` | `megahouse` / `brand2` |
| `kind` | `preset` = 자주 묻는 질문 버튼(AI 호출 없음) / `llm` = 직접 입력한 질문 |
| `question` | 크리에이터가 물어본 내용 |
| `answer` | 챗봇이 보여준 답변 |
| `unanswered` | `true`면 챗봇이 답하지 못한 질문 = **가이드에서 빠진 내용** |

`unanswered: true`인 줄만 모아 보면 가이드에 무엇을 추가해야 하는지 바로 나온다.

## 왜 `creator-guide/` 폴더 안이 아니라 여기인가

`creator-guide/vercel.json`은 **그 폴더가 바뀔 때만** 재배포하도록 설정돼 있다.
로그를 폴더 안에 쌓으면 문의가 한 건 들어올 때마다 사이트가 통째로 재배포된다.
그래서 일부러 폴더 바깥에 둔다. 위치를 옮기지 말 것.

## 개인정보

저장 직전에 이메일·휴대폰번호·`@아이디`·6자리 이상 숫자를 자동으로 가린다
(`api/log-question.js`의 `scrub()`). 다만 완벽한 차단은 불가능하므로,
이 저장소가 공개 상태인 동안에는 기록에 민감한 내용이 섞이지 않았는지
가끔 확인하는 편이 안전하다.
