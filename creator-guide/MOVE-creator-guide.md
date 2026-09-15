# creator-guide 저장소 이동 안내

이 폴더를 공개 저장소(`ccode`)에서 비공개 저장소로 옮길 때 보는 문서다.
**폰에서는 못 한다. PC에서 진행할 것.**

---

## 왜 옮기나

`knowledge-megahouse.md`와 `knowledge-brand2.md`에 협업 조건이 금액까지 적혀
있고, 문서 안에 "대외비, 제3자 공유 금지"라고 쓰여 있다. `ccode`가 공개
저장소라 GitHub 주소를 아는 사람은 그 파일을 읽을 수 있다.

**웹사이트 쪽은 이미 막혔다.** 2026-09-15에 배포 방식을 바꿔서
`pw-creator-guide.vercel.app/knowledge-megahouse.md` 는 404가 된다. 남은 것은
GitHub 저장소 쪽이고, 그건 저장소를 옮겨야만 닫힌다.

## 무엇까지 닫히나 (기대치를 먼저 맞출 것)

옮겨도 **`ccode`의 과거 커밋에는 그 파일이 그대로 남는다.** GitHub는 지워진
파일도 커밋 기록으로 열 수 있다. 즉 이 작업의 효과는
**"앞으로 새 내용이 공개 저장소에 쌓이지 않는다"** 까지다.
과거까지 지우려면 저장소 기록 전체를 다시 쓰는 별도 작업이 필요하다.

---

## ⚠️ 먼저 할 일 — 로그 저장소 분리

**이 단계를 건너뛰면 예전에 겪은 배포 한도 문제가 되살아난다.**

지금 접수 기록과 챗봇 문의 로그는 `ccode-private`에 쌓인다. 문의 한 건마다
커밋이 하나씩 생긴다. 그 저장소에는 Vercel 프로젝트가 없어서 지금은 배포가
돌지 않는다 — 그래서 거기로 옮겼던 것이다.

creator-guide를 **같은** `ccode-private`로 옮기면 그 저장소에 Vercel이 붙는다.
그러면 문의 한 건 = 커밋 한 개 = 배포 시도 한 번이 된다. 폴더가 안 바뀌었으니
"Skipped"로 넘어가지만, **취소된 배포도 하루 100회에 포함된다**
(`TROUBLESHOOTING-creator-guide.md` A-7). 문의가 몰리는 날 배포가 막힌다.

### 순서

1. GitHub에서 로그 전용 비공개 저장소를 새로 만든다 (예: `ccode-logs`).
   **이 저장소에는 Vercel 프로젝트를 절대 연결하지 않는다.**
2. `ccode-private`의 `creator-logs/` 폴더를 새 저장소로 복사한다.
   (파일 3~4개뿐이라 GitHub 웹에서 내용 복사·붙여넣기로도 된다)
3. Vercel 대시보드 → creator-guide 프로젝트 → Settings → Environment Variables
   에서 `GITHUB_REPO` 값을 새 저장소 이름으로 바꾼다.
4. **새 빌드를 한 번 돌린다.** 환경변수는 빌드할 때 서버에 들어가므로, 값만
   바꾸고 배포하지 않으면 서버는 옛 값을 계속 쓴다. 이 폴더의 파일을 한 줄
   고쳐서 push하면 된다.
5. `/reward-view-admin` 을 열어 **기존 접수 기록이 그대로 보이는지** 확인한다.
   안 보이면 2번 복사가 덜 된 것이다. 여기서 멈추고 고칠 것.
6. 가이드에서 실제로 한 건 접수해보고, 새 저장소에 줄이 늘어나는지 확인한다.

여기까지 확인된 뒤에야 아래 폴더 이동으로 넘어간다.

---

## 폴더 이동

### 1. 새 저장소로 복사

`ccode-private`(또는 다른 비공개 저장소)에 `creator-guide/` 폴더를 통째로
넣는다. **폴더 이름을 바꾸지 말 것** — Vercel의 Root Directory 설정이
`creator-guide`로 잡혀 있어서, 이름이 다르면 그 설정도 같이 고쳐야 한다.

폴더 안의 `.gitignore`가 같이 따라가는지 확인한다. 이게 빠지면 빌드 결과물
(`dist/`, `locked/`)이 저장소에 딸려 올라간다.

### 2. Vercel 연결 저장소 바꾸기

Vercel 대시보드 → creator-guide 프로젝트 → Settings → Git →
기존 연결을 끊고(Disconnect) 새 저장소를 연결한다(Connect).

**새 프로젝트를 만들지 말 것.** 기존 프로젝트의 연결만 바꾸면 환경변수
(`GUIDE_PASSWORD`, `ADMIN_PASSWORD`, `ANTHROPIC_API_KEY`, `GITHUB_*`)가 그대로
유지된다. 새로 만들면 전부 다시 등록해야 한다.

연결한 뒤 Root Directory가 `creator-guide` 그대로인지 확인한다.

### 3. 배포가 실제로 뜨는지 확인

`pw-creator-guide.vercel.app` 을 열어서 접속 코드 화면이 나오는지 본다.
그 다음 코드를 넣고 본문이 열리는지, 챗봇이 답하는지까지 확인한다.
챗봇이 답하면 지식 파일이 서버에 제대로 딸려 갔다는 뜻이다.

### 4. 공개 저장소에서 폴더 지우기

**3번이 확인된 뒤에만** `ccode`에서 `creator-guide/` 폴더를 지운다.
허브(`ccode/index.html`)는 건드리지 않아도 된다 — 카드가
`https://pw-creator-guide.vercel.app/reward-view-admin` 절대 주소로 걸려 있어서
폴더가 어디로 가든 안 깨진다.

---

## 옮긴 뒤 확인 목록

- [ ] 접속 코드 화면이 뜬다
- [ ] 코드를 넣으면 본문이 열린다
- [ ] 챗봇이 답한다 (지식 파일이 서버에 딸려 갔다는 뜻)
- [ ] `/reward-view-admin` 에서 기존 접수 기록이 보인다
- [ ] 가이드에서 접수 한 건을 넣으면 로그 저장소에 줄이 늘어난다
- [ ] `knowledge-megahouse.md` 를 GitHub 공개 저장소에서 더는 못 연다
- [ ] 로그 저장소에는 Vercel 프로젝트가 붙어 있지 않다
