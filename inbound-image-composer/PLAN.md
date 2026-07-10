# 입고안내 이미지 자동 제작 툴 — 기술 설계문서

## 프로젝트 목표

메가하우스 입고안내 스크린샷(5열 그리드)을 업로드하면, 텍스트만 단순화하고 사진은 재사용하는 4:5 카드(1080×1350)를 자동 생성해 주는 셀프서비스 도구. **백엔드 배포 없이 바닐라 JS + Canvas로 로컬 동작 가능.**

## 아키텍처

### 핵심 원칙

1. **로컬 우선** — 배포 없이 `index.html` 더블클릭으로 즉시 작동
2. **단계별 UI** — 5단계 플로우를 화면 분리로 실행 (중간 단계 스킵 불가)
3. **사진·텍스트 분리** — 순서 변경 시 재크롭 불필요
4. **AI는 선택 기능** — 백엔드 없으면 "정상입니다" 안내로 수동 진행
5. **사전은 누적** — localStorage 기본, 선택적으로 GitHub 동기화

### 데이터 흐름

```
Step 1: 업로드 & 그리드 검출
  ├─ 사진 업로드 (1~3장)
  ├─ grid-detect.js: 픽셀 스캔 → 5열 좌표 탐지
  ├─ 빨간 테두리 오버레이로 시각 확인
  └─ [선택] "🤖 AI로 채우기" → parse-image.js 호출

Step 2: 표 정리
  ├─ IP명 / 태그 / 가격 / 배송비 입력
  ├─ IP명 사전 자동완성 (seed-data.js + 누적)
  └─ "사전에 없음" 경고 (자동 확정 금지)

Step 3: 전체 미리보기 (1장, 분할 전)
  ├─ 드래그로 순서 변경 (빈 배경 드래그 = 마퀴 선택으로 여러 카드 묶어서 함께 이동)
  ├─ 클릭으로 인라인 수정
  └─ 체크박스 선택 → "선택 삭제" 클릭 시 확인 화면 없이 즉시 삭제, "실행취소"로 복구

Step 4: 순서 정렬
  ├─ 등급 자동 판별 (S/A: 사전, B/C: 수동)
  ├─ 스토어 성향 및 분위기 클러스터 분류
  ├─ 드래그로 미세조정 가능 (그룹 이동 포함)
  └─ "순서 확정" 필수

Step 5: 최종 분할 & 내보내기
  ├─ render-page.js: 5×4 캔버스(20개/페이지) 렌더
  ├─ JPEG quality 0.94
  └─ ZIP 다운로드 (또는 이미지별 다운로드)
```

## 파일 구조 및 책임

| 파일 | 역할 | 상태 |
|------|------|------|
| **index.html** | 5단계 화면 UI, 상태 바인딩 | ✓ 완성 |
| **app.js** | 상태 관리 (Proxy 기반), 화면 전환 로직 | ✓ 완성 |
| **lib/grid-detect.js** | 픽셀 스캔 → 5열 그리드 좌표 탐지 | ✓ 포팅 완료 |
| **lib/render-page.js** | 카드 렌더(5×4), 미리보기 스트립 | ✓ 포팅 완료 |
| **lib/seed-data.js** | IP명 사전, 등급표, 클러스터, 스토어 프로필 초기값 | ✓ 완성 |
| **lib/github.js** | GitHub Contents API 커밋 (사전 저장용) | ✓ 완성 |
| **api/parse-image.js** | Claude Vision(Haiku) 이미지 인식 | ✓ 배포됨 |
| **api/load-dict.js** | 사전 데이터 조회 (선택) | ✓ 배포됨 |
| **api/save-dict.js** | 사전 데이터 저장 (선택) | ✓ 배포됨 |

## 주요 기술 결정

### 1. 그리드 검출 알고리즘
- **방식**: 픽셀 단위 행 스캔 → 흰색 배경 비율로 분할선 탐지
- **정확도**: 참고 이미지 기준 5열 그리드 100% 정확 (검증 완료)
- **유지**: 참고 알고리즘(reference/grid-detect.js)과 동일 수치 사용

### 2. 카드 렌더링
- **포맷**: JPEG 1080×1350 (인스타그램 권장)
- **레이아웃**: 사진 큰 영역 + 텍스트 영역(IP명 크게, 가격/배송비 작게)
- **품질**: JPEG quality 0.94 (용량 vs 품질 트레이드오프)
- **다중 페이지**: 5×4(20개)씩 묶어서 렌더

### 3. 상태 관리
- **방식**: Proxy 기반 반응형 상태 (Vue/React 없이 구현)
- **저장소**: 메모리(기본) + localStorage(사진은 제외, 텍스트 데이터만)
- **범위**: IP명/태그/가격/배송비/등급/순서 누적 (여러 세션 유지)

### 4. AI 인식 (선택 기능)
- **모델**: `claude-haiku-4-5` (저렴함, 이미지 인식 충분)
- **호출 시점**: Step 1에서 "AI로 채우기" 버튼 클릭만 (자동 호출 없음)
- **결과**: 항상 "⚠ 추정 - 확인 필요" 배지로만 표시 (자동 확정 금지)
- **배치 방식**: 한 사진당 5~6개씩 나눠서 호출 (정확도 개선)
- **스키마**: JSON Schema로 구조화된 응답 강제 (parsing 안정성)
- **자동 분류 범위**: IP명/가격/배송비/태그(룩업·테노히라·메가캣)뿐 아니라 **4단계 정렬용
  분위기 클러스터까지 AI가 함께 판단**. 기존 클러스터 사전(`state.dict.moodClusters`)을
  프롬프트에 넘겨 "이 IP가 어느 클러스터와 어울리는지" 고르게 하고, `uncertain=false`인
  항목만 `app.js`의 `applyAiClusterResult()`가 실제로 사전에 편입시킨다 — 애매한 판단으로
  정렬 기준(클러스터 사전)을 오염시키지 않기 위함. IP명 사전처럼 이 편입도 누적되어
  다음 이미지 인식부터는 그 IP를 바로 기존 클러스터로 인식한다.

### 5. 사전 관리
- **기본 저장소**: localStorage (즉시 저장, 비용 무료)
- **선택적 동기화**: GitHub Contents API (여러 디바이스/팀원 공유)
- **우선순위**: GitHub 사전 > localStorage > seed-data.js
- **등급 자동 판별**: S/A급은 사전에 있으면 자동, B/C급은 수동

### 6. 배포 전략
- **기본**: 배포 불필요 (바닐라 JS)
- **선택 1 (사전 공유)**: Vercel + GitHub Token (별도 브랜치 `inbound-image-composer-data`)
- **선택 2 (AI 인식)**: Vercel + Anthropic API Key
- **장점**: 배포 없는 선택지 = 비용 0원, 대기 시간 없음

## 개발 상태 및 다음 단계

### ✓ 완료된 작업
- [x] 5단계 화면 UI + 상태 관리
- [x] 그리드 검출 알고리즘 포팅
- [x] 카드 렌더링 구현
- [x] AI 인식 기능 (배치 방식 포함)
- [x] localStorage 저장
- [x] GitHub 동기화 (선택)
- [x] Vercel 배포

### ⏳ 진행 중 / 계획
- [ ] 프론트 모바일 반응형 개선
- [ ] 로컬 테스트 시나리오 (엣지 케이스: 빈 칸 많음, 극단적 상품 수)
- [ ] 문서 정리 (이 PLAN.md, README 세부사항)
- [ ] 실제 사진으로 인식률 재검증 (배치 개선 후)

## 배포 체크리스트

### Vercel 사전 공유 (선택)
```
[ ] Vercel 프로젝트 생성 (Root: inbound-image-composer)
[ ] GitHub 브랜치 inbound-image-composer-data 생성
[ ] env: GITHUB_TOKEN (fine-grained, contents: write)
[ ] env: GITHUB_OWNER, GITHUB_REPO
[ ] env: GITHUB_BRANCH (기본값 inbound-image-composer-data)
[ ] 배포 확인 (API 호출 테스트)
```

### Claude Vision 인식 (선택)
```
[ ] Anthropic API 키 발급 (console.anthropic.com)
[ ] env: ANTHROPIC_API_KEY (Vercel)
[ ] 배포 확인 (테스트 사진으로 인식 테스트)
```

### Vercel ignore 설정
```
vercel.json: ignoreCommand = "git diff --quiet HEAD^ HEAD ./"
→ 실제 코드 변경이 있을 때만 빌드 실행 (불필요한 재배포 방지)
```

## 참고 자료

- 기획 배경: `/design_handoff_inbound_image_tool/README.md`
- 비즈니스 규칙: `/design_handoff_inbound_image_tool/business-rules.md`
- 참고 구현: `/design_handoff_inbound_image_tool/reference/`
  - `grid-detect.js`: 픽셀 스캔 알고리즘
  - `render-page.js`: 카드 렌더링

## 트러블슈팅

### "AI로 채우기"가 동작하지 않음
→ `api/parse-image.js` 백엔드가 배포되지 않음. 배포하거나 수동 입력으로 진행.

### 사전 저장이 안 됨
→ GitHub 백엔드 미배포. localStorage는 정상 저장됨. 필요하면 배포 단계 실행.

### 그리드 검출이 틀림
→ 사진이 극단적으로 어둡거나 밝으면 실패할 수 있음. 분할선(흰 배경)이 명확한 사진 권장.

### 순서 정렬이 이상함
→ 등급/클러스터 사전이 비어 있을 수 있음. "⚙ 사전 관리"에서 확인/추가.
