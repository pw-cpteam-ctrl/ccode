# 입고안내 이미지 자동 제작 툴

원본 입고안내 스크린샷(5열 그리드, 사진+구구절절한 상품명)을 업로드하면, 같은 사진을
재사용하되 텍스트만 "IP명 크게 + 라인업 태그 + 가격 작게 + 배송비"로 단순화한 4:5
(1080×1350) 이미지를 순서 지정해서 만들어 주는 셀프서비스 웹 도구다. 기획 배경은
핸드오프 문서(`design_handoff_inbound_image_tool/README.md`) 참고.

## 지금 상태

빌드 없이 `index.html`을 그대로 여는 바닐라 JS + Canvas 앱이다 (이 레포의 다른 도구들과
동일한 구조). 6단계 플로우를 화면 전환으로 분리해서 구현했다 — 중간 단계를 건너뛰고
바로 최종 렌더로 가지 않는다.

1. **업로드 & 그리드 검출** — 원본 1~3장 업로드, 픽셀 스캔으로 그리드 좌표 검출, 빨간
   사각형 디버그 오버레이로 시각 확인 후에만 크롭 확정
2. **표 정리** — 사진별 IP명/태그/가격/배송비 입력, IP명 사전 자동완성 + "사전에 없음"
   경고 (자동 확정 금지)
3. **전체 미리보기(분할 전, 1장)** — 드래그로 순서 변경, 카드 클릭으로 인라인 수정
4. **삭제 확인** — 체크박스 선택 → 삭제 대상 명시 목록 → 확인 버튼을 눌러야만 반영
5. **순서 정렬** — 등급(S/A 사전 자동 판별 + B/C 수동 분류) → 스토어 성향 → 분위기
   클러스터 3단계 자동 정렬, 정렬 후에도 드래그로 미세조정 가능, "순서 확정" 필수
6. **최종 분할 & 내보내기** — 5×4(20개/페이지) 캔버스 렌더, JPEG quality 0.94 내보내기

## 폴더 구조

```
index.html            메인 UI (6단계 화면)
app.js                상태 관리 + 화면 로직
lib/grid-detect.js    reference/grid-detect.js 포팅 (알고리즘/수치 그대로)
lib/render-page.js    reference/render-page.js 포팅 (알고리즘/수치 그대로) + 미리보기용 연속 스트립 렌더 추가
lib/seed-data.js      business-rules.md의 IP명 사전/등급표/클러스터 초기값
lib/github.js         GitHub Contents API 커밋 헬퍼 (insta-gen과 동일 패턴)
api/load-dict.js      사전 데이터 조회 (Vercel 서버리스)
api/save-dict.js      사전 데이터 저장 (Vercel 서버리스, 명시적 저장 버튼에서만 호출)
```

## 데이터 모델

사진과 텍스트는 항상 분리 관리한다 (photoId로 연결) — 순서 재배치 시 재크롭이 필요 없다.

```js
photos: { [photoId]: HTMLCanvasElement }               // 원본 해상도 크롭
items: [{ id, photoId, ip, tag, price, ship, subGrade, pushToEnd }]  // 배열 순서 = 진열 순서
```

## 사전(계속 늘어나는 데이터) 관리

우측 상단 "⚙ 사전 관리"에서 IP명 사전 / 등급표(S·A급만) / 분위기 클러스터 / 스토어
프로필을 편집할 수 있다. 로컬 편집은 즉시 반영되지만, **팀과 공유하려면 각 탭의
"GitHub에 저장" 버튼을 눌러야 한다** (누를 때마다 확인창이 뜬다 — 공유 데이터라 실수
커밋을 막기 위함). 저장 위치는 `main`이 아니라 별도 데이터 브랜치
(`GITHUB_BRANCH`, 기본값 `inbound-image-composer-data`)다 — insta-gen과 같은 이유로,
main에 커밋하면 편집할 때마다 Vercel이 재배포하기 때문이다.

## Vercel 배포 시 필요한 환경변수

| 환경변수 | 용도 | 비고 |
|---|---|---|
| `GITHUB_TOKEN` | 사전 데이터 읽기/쓰기 | 이 레포에 `contents: write` 권한이 있는 fine-grained PAT |
| `GITHUB_OWNER`, `GITHUB_REPO` | 저장 대상 레포 | 예: `pw-cpteam-ctrl`, `ccode` |
| `GITHUB_BRANCH` | 사전 데이터 전용 브랜치 | 기본값 `inbound-image-composer-data` (없으면 자동 사용, 브랜치를 미리 만들어 둬야 함) |

환경변수가 없어도 화면은 `lib/seed-data.js`의 시드값만으로 정상 동작한다(사전 편집 내용만
팀 공유가 안 될 뿐).

## 의도적으로 뺀 것

- **OCR/AI 자동 인식 없음.** IP명·가격은 항상 사용자가 직접 입력한다 (수동 입력 방식으로
  범위를 확정함). 필요해지면 `insta-gen`의 Claude API 연동 패턴을 참고해 추가할 수 있다.
- **B급 이하 등급 자동 분류 없음.** business-rules.md 원칙대로 S/A급만 상시 사전으로
  유지하고, 그 외는 항목별 "등급(수동)" 드롭다운으로 매번 사람이 분류한다.
