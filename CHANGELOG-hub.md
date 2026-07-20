# CHANGELOG — 루트 허브 페이지 (hub, index.html)

> 작성 규칙은 루트 [`CHANGELOG-작성-규칙.md`](CHANGELOG-작성-규칙.md) 참고.

---

<details open>
<summary>2026-07-20 (V1.0 카드 썸네일 연결 및 텍스트 가독성 개선)</summary>

## 2026-07-20 (V1.0 카드 썸네일 연결 및 텍스트 가독성 개선)
- **카드 썸네일**
  - SNS 성과 리포트 대시보드 카드에 썸네일 이미지 연결
    (기술: `assets/thumbs/report.png`, 820×820 정사각형이라 크롭 위치 클래스 불필요)
  - 이벤트 추첨기 카드에 썸네일 이미지 연결
    (기술: `assets/thumbs/raffle.png`, 651×651 정사각형이라 크롭 위치 클래스 불필요)

- **텍스트 가독성 개선**
  - 카드 이름 글자 크기 확대 (14px → 16px)
    (기술: `.name` 클래스 `font-size` 값 변경, 전체 8개 카드가 공유하는 클래스)
  - 확대해도 카드 이름 줄바꿈 늘어나지 않음을 검증
    (기술: Playwright로 900px/420px/375px/320px 폭 렌더링 확인, 16px은 900px·420px에서 전 카드 1줄 유지, 18px은 일부 카드가 2줄로 넘어가 채택하지 않음)

</details>

<details>
<summary>이전 기록 (2026-07-20 이전)</summary>

_아직 이전 기록 없음 (이 문서의 첫 작성일)_

</details>
