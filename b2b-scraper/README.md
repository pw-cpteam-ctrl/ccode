# B2B 스크래퍼 (GoodSmile)

`product-sns-formatter`의 "① B2B에서 오늘 상품 가져오기" 버튼이 실제로 쓸 결과물
(`output.json` + 사진 파일들)을 만드는 도구.

## ⚠️ 반드시 로컬(화면 있는) 컴퓨터에서 실행할 것

이 원격 개발 환경(화면 없는 샌드박스)에서는 실행할 수 없다 — 로그인 단계가 진짜 브라우저
창을 띄워서 사람이 직접 로그인해야 하고(`headless:false`), 정찰/스크래핑 단계도 GoodSmile
쪽에서 이 환경의 IP를 막을 가능성이 있다. **아래 명령은 전부 각자 컴퓨터(Node.js 설치된
곳)에서 실행.**

## 준비

```bash
cd b2b-scraper
npm install
```

## 1단계 — 로그인 세션 저장 (한 번만, 세션 만료되면 다시)

```bash
node login-session.js
```

크롬 창이 뜨면 그 창에서 GoodSmile B2B 아이디/비밀번호로 직접 로그인 (2단계인증 있으면
그것도 그대로 진행). 로그인 다 되면 터미널로 돌아와서 엔터. `goodsmile-session.json`이
생성됨.

## 2단계 — 페이지 구조 정찰 (scrape.js 완성 전 필수)

```bash
node recon.js <오늘 상품 목록 페이지 URL>
```

로그인 후 브라우저 주소창에서 "오늘 상품 목록"이 보이는 페이지 URL을 복사해서 위 명령에
넣는다. 실행하면:
- `recon-output/`에 그 페이지의 HTML 전체와 스크린샷이 저장됨
- 터미널에 `__NEXT_DATA__` / `__PRELOADED_STATE__` / `__next_f` 마커가 있는지, 상품
  상세로 보이는 링크·이미지 URL 목록이 출력됨

**이 터미널 출력을 그대로 복사해서 알려주면**, 그걸 보고 `scrape.js`의 TODO(recon) 표시된
부분(목록→상세 URL 뽑는 법, 임베디드 JSON 안의 실제 필드 경로, 사진 URL 추출법)을 마저
완성할 수 있다. 상세 페이지 URL 하나도 같은 방식으로 한 번 더 정찰해두면 더 좋음:

```bash
node recon.js <상품 상세 페이지 URL 1개>
```

## 3단계 — 실제 스크래핑 (2단계 정찰 결과 반영 후)

```bash
node scrape.js
```

`output/<날짜>/output.json` + `output/<날짜>/photos/*.jpg`가 생성됨.

## 4단계 — product-sns-formatter에 가져오기

product-sns-formatter 페이지의 "🔄 B2B에서 오늘 상품 가져오기" 버튼을 누르고, 방금
만들어진 `output.json` 파일과 `photos/` 폴더 안의 사진 파일들을 **함께 선택**하면
(Ctrl/Cmd+클릭으로 다중 선택, 또는 폴더째 드래그) 상품 목록에 자동으로 채워진다.

## 파일 구성

| 파일 | 역할 |
|---|---|
| `login-session.js` | 로그인 세션 저장 (1단계) |
| `browser-stealth.js` | 로그인용 브라우저 실행 도우미 |
| `recon.js` | 페이지 구조 정찰 (2단계) |
| `extract-helpers.js` | 페이지에 박힌 JSON 추출 헬퍼 (sns-report-scraper 재사용) |
| `download-image.js` | 로그인 세션으로 사진 다운로드 |
| `format-output.js` | 필드를 output.json 형태로 조립 |
| `scrape.js` | 메인 스크립트 — TODO(recon) 부분은 2단계 결과 필요 |
