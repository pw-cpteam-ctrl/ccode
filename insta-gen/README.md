# G.E.M. 인스타 카드 자동 생성기 (프로토타입)

메가하우스 G.E.M. 시리즈 신상품 공개용 인스타그램 카드(1080×1350)를
**JSON 입력 한 개**로 자동 생성합니다. HTML/CSS 템플릿을 Playwright(헤드리스 크롬)로
캡처하는 방식이라 그라데이션·그림자·라운드·한/일 혼용 폰트가 깔끔하게 나옵니다.

## 구조

```
insta-gen/
├─ templates/gem-card.html   # 디자인 템플릿 ({{placeholder}} 바인딩)
├─ data/
│  ├─ works.json             # 작품 마스터 (로고·저작권·배경테마)  ← 1회 등록
│  ├─ types.json             # 공개 타입 (헤드라인 ↔ 배지)         ← 1회 등록
│  └─ posts/minato.json      # 포스트별 입력                       ← 매번 작성
├─ assets/
│  ├─ logos/                 # 작품 로고 PNG (없으면 작품명 텍스트로 대체)
│  └─ figures/               # 피규어 이미지 (누끼 PNG 권장)
├─ out/                      # 결과 PNG
└─ render.mjs                # 생성 스크립트
```

## 사용법

```bash
# (최초 1회) 의존성
npm install            # playwright. 브라우저는 환경에 이미 설치됨

# 생성
node render.mjs data/posts/minato.json
# → out/minato.png
```

## 입력 규칙 (이것만 알면 됨)

포스트를 만들 때 작성하는 `data/posts/*.json` 은 사실상 4개 값만 채웁니다.

| 필드 | 설명 | 값 |
|---|---|---|
| `work` | 작품 | `works.json` 의 key (`naruto`, `aot`, `gintama` …) |
| `type` | 공개 타입 | `types.json` 의 key (아래 표) |
| `product_kr` | 한글 제품명 | 자유 입력 |
| `figure.src` | 피규어 파일명 | `assets/figures/` 기준 |

### 헤드라인 ↔ 배지 매핑 (핵심 규칙, `types.json`)

| type | 상단 헤드라인 | 배지 |
|---|---|---|
| `prototype_reveal` | 원형 최초공개 | 原型公開 |
| `painted_reveal` | 채색원형 최초공개 | 彩色初公開 |
| `resale` | 재판매 결정 | 再販決定 |
| `limited_resale` | 재판매 결정 | 限定復刻決定 |

작품을 추가하려면 `works.json` 에, 새 공개 타입은 `types.json` 에 한 줄 추가하면 끝입니다.

## 피규어 누끼(배경 제거)

`figure.nuki` 로 분기합니다.

- `false` (기본): 넣은 이미지를 그대로 배치. **이미 누끼된 투명 PNG**를 권장 — 품질이 일정합니다.
- `true`: 원본 사진을 넣으면 `rembg` 로 자동 배경 제거. 편하지만 결과 검수가 가끔 필요합니다.
  - 사용하려면 `pip install rembg` (미설치 시 원본을 그대로 사용하고 경고만 출력).

`figure.scale` / `figure.offset_y` 로 크기·세로 위치를 미세 조정할 수 있습니다.

## 자동화 범위

- ✅ 레이아웃·텍스트·로고·색상·헤드라인/배지 매핑 → **완전 자동**
- ⚠️ 누끼 품질·피규어 위치 → 자동이지만 가끔 사람이 확인/미세조정

## 다음 단계 (확장 아이디어)

1. 실제 브랜드 로고 PNG를 `assets/logos/` 에 투입 (현재는 텍스트 대체)
2. 디자인 픽셀 단위 정합 (폰트 크기·여백·배경 패턴을 원본과 1:1 매칭)
3. 폴더 일괄 처리: `data/posts/*.json` 전체를 한 번에 렌더
4. 웹 UI / 슬랙봇 / 노션 연동으로 비개발자도 입력만 하면 생성
