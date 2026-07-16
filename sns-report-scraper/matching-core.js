/**
 * 상품명/키워드 추출 + 상품 라인(시리즈) 판별 순수 로직. aggregate.js(Node, 실제 수집→비교
 * 파이프라인)와 html-report.js가 리포트 안에 그대로 심어주는 브라우저 스크립트(붙여넣기로
 * 게시물을 표에 수동 추가하는 기능)가 완전히 똑같은 함수를 써야 해서 이 파일로 분리함.
 *
 * ⚠️ Node 전용 API(require/fs/module 등)를 함수 몸통 안에서 쓰면 안 됨 — 이 파일의 내용
 * 자체를 그대로 텍스트로 읽어서 리포트 HTML의 <script> 태그 안에 붙여넣어 브라우저에서
 * 실행하기 때문(html-report.js 참고). 파일 맨 아래 module.exports 블록만 Node 전용이고,
 * 그 위 로직은 순수 함수라 두 환경에서 완전히 동일하게 동작함(로직이 갈라질 일이 없음).
 */

// "1.2만", "3천", "1.2K", "3.4M", "12,345" 등 표기를 숫자로 변환.
// 파싱 실패 시 null (호출 측에서 "파싱 실패 건수"로 투명하게 집계).
function parseCount(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === '') return null;

  const m = s.match(/^([\d,]+(?:\.\d+)?)\s*(만|천|k|m)?$/i);
  if (!m) return null;

  const base = parseFloat(m[1].replace(/,/g, ''));
  if (Number.isNaN(base)) return null;

  const unit = (m[2] || '').toLowerCase();
  switch (unit) {
    case '만': return Math.round(base * 10000);
    case '천': return Math.round(base * 1000);
    case 'k': return Math.round(base * 1000);
    case 'm': return Math.round(base * 1000000);
    default: return Math.round(base);
  }
}

// 당사 템플릿: 본문 첫 줄이 상품명 ("[예약시작] 은혼 GEM 피규어\n\n..." → "은혼 GEM 피규어")
function extractOwnProductName(text) {
  if (!text) return null;
  const firstLine = text.split('\n').map(l => l.trim()).find(Boolean);
  if (!firstLine) return null;
  return firstLine.replace(/^\[[^\]]*\]\s*/, '').trim() || null; // 앞의 "[예약시작]" 등 태그 제거
}

// 구조적 라벨 줄("박스 :", "단품 :" 등) — 경쟁사가 링크를 여러 개 나눠 걸 때 각 링크 위에
// 붙는 짧은 라벨이라 상품명이 아님. 이 줄을 만나면 무시하고 더 위쪽 줄을 찾음.
const STRUCTURAL_LABEL_LINE = /^(박스|단품|특전|특전\s*세트|일반품\s*세트?)\s*:?\s*$/;

// 경쟁사 템플릿: "바로가기"/링크가 있는 줄 바로 위(구조적 라벨 줄은 건너뜀)가 상품명
// ("✔️G.E.M. 시리즈 손바닥 엘런 & 리바이 병장 세트\n\n🛍️바로가기 : https://...")
function extractCompetitorProductName(text) {
  if (!text) return null;
  const lines = text.split('\n').map(l => l.trim());
  const linkIdx = lines.findIndex(l => /바로가기|http/i.test(l));
  if (linkIdx > 0) {
    for (let i = linkIdx - 1; i >= 0; i--) {
      if (!lines[i]) continue;
      if (STRUCTURAL_LABEL_LINE.test(lines[i])) continue;
      return lines[i].replace(/^[✔✅☑️\s]+/, '').trim() || null;
    }
  }
  // 백업: 링크 줄을 못 찾으면 ✔️로 시작하는 줄을 그냥 찾음
  const checkLine = lines.find(l => /^[✔✅☑️]/.test(l));
  return checkLine ? checkLine.replace(/^[✔✅☑️\s]+/, '').trim() || null : null;
}

// 매칭에 쓰기엔 너무 흔한 단어(브랜드/시리즈/판매/공지/URL 관련 상용구) — 이 단어들만
// 겹쳐서는 같은 상품으로 보지 않음. **부분 포함(substring)으로 걸러냄** — 한국어는
// 띄어쓰기 없이 붙여 쓰는 경우가 많아서("예약시작", "정보공개") 정확히 일치하는 단어만
// 걸러내면 놓치는 경우가 많았음. 실제 매칭 결과 보고 계속 추가해나가면 됨.
// ⚠️ KNOWN_PRODUCT_LINES(룩업/GEM/컬렉션 등)도 매칭 단계에서는 반드시 같이 제외해야 함 —
// 여러 프랜차이즈가 같은 상품 라인을 공유해서, 안 그러면 그걸로 전부 하나로 묶여버림.
const GENERIC_KEYWORDS = [
  '메가하우스', '프레젠스월드', '프레젠스', '월드', '베스트하비', 'GEM', 'G.E.M', '시리즈', '피규어',
  '액션', '세트', '예약', '판매', '할인', '혜택', '마감', '발매', '캠페인', '공식', '스토어',
  '신제품', '특가', '한정', '재입고', '정품', '구매', '바로가기', '이벤트', '사전', '오픈', '입고',
  '정보', '공개', '쿠폰', '발급', '안내', '참여', '당첨', '감사', '진행', '완료', '확인', '전체',
  '구경', '클릭', '링크', '프로필', '알림', '세컨드', '재판', '리뉴얼', '복간', '한정판', '개시',
  '시작', '기간', '예정', '상품', '제품', '품절', '가격', '박스', '단품', '특전', '일반품',
  '버전', 'Ver',
  // "컬렉션"(Collection)은 실제로는 특정 라인 브랜드명이 아니라 그냥 "~모음/시리즈"라는 뜻의
  // 흔한 일반 단어인데, KNOWN_PRODUCT_LINES에 있으면 detectProductLine이 이걸 GEM/G.M.G/룩업
  // 같은 진짜 구분되는 라인 이름과 똑같이 취급해버려서, 경쟁사가 "G.M.G 컬렉션"이라고 쓰면
  // (G.M.G보다 먼저 걸려서) line="컬렉션"으로 잘못 잡히고 당사(line="G.M.G" 또는 null)와
  // 라인이 다르다고 판단해 매칭이 막히는 문제가 있었음 → 일반 단어로 재분류.
  '컬렉션', 'Collection',
  // 팔로우 유도 등 반복 상용구(여러 프랜차이즈 게시물에 그대로 재사용돼서 매칭 오염됨)
  '팔로우하고', '기다리는', '굿즈의', '후속', '가장', '빠르게', '받아보세요',
  // 인스타 "구매는 프로필 링크를 참고해 주세요!" 등 반복 CTA 문구
  '참고해', '참조', '참고', '주세요', '해주세요', '하단', '구성', '자세한', '내용',
  'mkt', 'shopping', 'naver', 'com', 'link', 'https', 'site',
  // BH(경쟁사)가 "신제품 원형/색채 조형 최초 공개" 발표 게시물마다 똑같이 쓰는 고정 템플릿
  // 문구("OO 원형 첫 공개... 룩업 시리즈 신제품 OO 최초 공개! 추가 정보 추후 공개 예정") —
  // 이 단어들을 안 걸러내면 서로 다른 캐릭터를 발표하는 게시물끼리도 이 상용구 하나로
  // 전부 연결돼버림(실제 사례: PW+BH 발표 게시물 10건이 이 상용구 때문에 하나로 뭉침).
  '원형', '최초', '추가', '추후', '색채', '조형',
  // 게시물 상세페이지를 통째로 복사(붙여넣기로 수동 추가 기능용)했을 때 딸려오는 사진 첨부
  // 표시 — 상품명과 무관한데, 사진 여러 장 붙은 게시물끼리 이 단어 하나로 우연히 묶이면
  // 안 되니 상용구 취급.
  '이미지',
];

// naver.com 등 상품 링크 줄을 통째로 제거. 이 링크 뒤에 붙는 해시값(예: "6a44b667b")은
// 16진수라 a~f 알파벳 6개뿐이라, 숫자만 지우고 남기면 무관한 게시물끼리도 "ca", "ef" 같은
// 조각이 우연히 겹쳐서 전부 하나로 잘못 뭉쳐지는 문제가 있었음 — 그래서 낱말 단위 제외가
// 아니라 그 줄 자체를 통째로 지워야 함.
function stripUrlNoise(text) {
  return text.split('\n').filter(line => {
    const t = line.trim();
    if (!t) return true; // 빈 줄은 무해하니 유지
    if (/^https?:\/\//i.test(t)) return false;
    if (/naver\.com|\.com\//i.test(t)) return false;
    if (/^[a-f0-9]{8,}$/i.test(t)) return false; // 순수 16진수 해시 줄
    if (/^[.…]+$/.test(t)) return false; // "…" / "..."
    return true;
  }).join('\n');
}

// 상품명 매칭용 키워드 추출. **본문 전체**를 대상으로 함 — 자사/경쟁사 둘 다 실제
// 프랜차이즈명이 제목 한 줄이 아니라 본문 여기저기(본문 중간 줄 + 해시태그)에 흩어져
// 있어서, 좁은 "제목 한 줄"만 보면 진짜 식별 정보를 놓치는 경우가 많았음.
// (예: 경쟁사는 "원피스 #ワンピース" 프랜차이즈 줄과 "토비마스 원피스 (재판)" 상품 줄이
// 따로 떨어져 있고, 자사는 첫 줄엔 라인명만 있고 구체적 상품명은 3~4줄 아래에 있음)
// 상용구/라인명 제거는 토큰을 통째로 버리지 않고 **문자열에서 부분 제거**하는 방식 —
// "배리어블액션"처럼 붙여 쓴 단어에서 "액션"만 지우고 "배리어블"은 남기기 위함.
// 토큰은 한글/영문 글자만 인정(숫자 제외) — "26년", "7월" 같은 날짜가 자동으로 안 걸림.
function extractKeywords(text) {
  if (!text) return [];
  let cleaned = stripUrlNoise(text)
    .replace(/×/g, 'x') // "헌터×헌터"(곱셈 기호)와 "헌터x헌터"(영문 x)가 서로 다른 토큰으로
                        // 갈라져서 같은 프랜차이즈인데도 겹치는 키워드가 0개로 나오던 문제 —
                        // 곱셈 기호는 글자(\p{L})가 아니라서 토큰이 "헌터"+"헌터"로 끊겨버림.
                        // 자사/경쟁사가 표기를 다르게 써도 같은 걸로 보이게 통일.
    .replace(/(?<=[A-Za-z])\.(?=[A-Za-z])/g, '') // "G.E.M." → "GEM"
    .replace(/\[[^\]]*\]/g, ' '); // "[예약시작]", "[채색원형 최초공개]" 같은 브라켓 태그는 통째로
                                  // 제거 — 안 지우면 서로 다른 상품 게시물에 반복돼서 그 브라켓
                                  // 안 문구(예: "채색원형", "최초") 하나로 무관한 상품들이 엮임
  [...GENERIC_KEYWORDS, ...KNOWN_PRODUCT_LINES].forEach(g => {
    cleaned = cleaned.replace(new RegExp(g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
  });
  const tokens = cleaned.match(/[\p{L}]+/gu) || [];
  return [...new Set(tokens.filter(t => t.length >= 2))];
}

// 알려진 메가하우스 상품 라인명 — 본문에서 이 중 하나를 찾으면 "시리즈"로 분리하고
// 나머지를 "IP"(캐릭터/작품명)로 봄. 지금까지 실제로 나온 것들만 채워뒀으니, 새로운
// 라인명이 나오면 계속 추가해야 함(예: 여기 없는 라인명은 시리즈 칸이 빈 채로 나감).
// "컬렉션"/"Collection"은 여기 없음 — 특정 라인 브랜드명이 아니라 일반 단어라 GENERIC_KEYWORDS로
// 옮김(위 참고). 여기 있으면 GEM/G.M.G 같은 진짜 라인명보다 먼저 매칭돼서 오탐이 났었음.
const KNOWN_PRODUCT_LINES = [
  '룩업', 'Look Up', 'GEM', 'G.E.M', '메가캣', 'MegaCat', '테노히라',
  'GGG', 'G.M.G', 'GMG', '쁘띠라마', 'INSIDE FANTASY', '인사이드 판타지', '스케일', 'POP', 'P.O.P',
];

// 같은 상품 라인을 자사/경쟁사가 다른 말로 부르는 경우 — 매칭 시엔 같은 걸로 취급.
// 예: 당사는 "원피스 스케일 피규어"(스케일)라고 쓰고 경쟁사는 "P.O.P 시리즈"(POP)라고 씀 —
// 둘 다 같은 라인인데 문자열이 달라서 자동으로 분리돼버렸던 걸 여기서 통일.
// "인사이드 판타지"(당사는 영문 "INSIDE FANTASY"로 씀)도 같은 이유로 추가.
const LINE_ALIASES = { '스케일': 'POP', 'P.O.P': 'POP', 'Look Up': '룩업', 'MegaCat': '메가캣', 'G.E.M': 'GEM', 'GMG': 'G.M.G', '인사이드 판타지': 'INSIDE FANTASY' };
function canonicalLine(rawLine) {
  return rawLine ? (LINE_ALIASES[rawLine] || rawLine) : null;
}

// 본문 텍스트에서 알려진 상품 라인명을 찾아 "정식 명칭"(canonicalLine)으로 반환. 같은 IP라도
// 라인이 다르면 상품별 표에서 분리해야 해서(예: "원피스 룩업" vs "원피스 POP/스케일") 매칭
// 단계에서도 씀.
function detectProductLine(text) {
  if (!text) return null;
  const normalized = text.replace(/(?<=[A-Za-z])\.(?=[A-Za-z])/g, '');
  for (const candidate of KNOWN_PRODUCT_LINES) {
    if (normalized.toLowerCase().includes(candidate.toLowerCase())) return canonicalLine(candidate);
  }
  return null;
}

// 상품명 문자열에서 "시리즈"(알려진 상품 라인)를 분리해내고, 남은 부분을 "IP"로 정리.
// lineOverride(정식 명칭)를 주면, 그 라인의 별칭(예: POP → 스케일/P.O.P) 중 title에 실제로
// 있는 걸 찾아서 지우고, line은 항상 정식 명칭(lineOverride)으로 확정.
function splitIpAndLine(title, lineOverride) {
  if (!title) return { ip: null, line: lineOverride || null };
  let remaining = title.replace(/(?<=[A-Za-z])\.(?=[A-Za-z])/g, ''); // "G.E.M." → "GEM"

  let line = null;
  const candidates = lineOverride
    ? KNOWN_PRODUCT_LINES.filter(c => canonicalLine(c) === lineOverride)
    : KNOWN_PRODUCT_LINES;
  for (const candidate of candidates) {
    const idx = remaining.toLowerCase().indexOf(candidate.toLowerCase());
    if (idx !== -1) {
      line = canonicalLine(candidate);
      remaining = remaining.slice(0, idx) + remaining.slice(idx + candidate.length);
      break;
    }
  }
  if (lineOverride && !line) line = lineOverride; // title엔 안 나와도 그룹 차원에서 확정된 라인은 유지

  GENERIC_KEYWORDS.forEach(g => {
    remaining = remaining.replace(new RegExp(g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
  });
  remaining = remaining
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\d+\s*(년|월|일)?/g, ' ') // "26년", "7월" 등 날짜 표현 통째로 제거
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''); // 앞뒤에 남은 이모지/기호("📢", "!") 제거

  return { ip: remaining || null, line };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseCount,
    extractOwnProductName,
    extractCompetitorProductName,
    extractKeywords,
    detectProductLine,
    splitIpAndLine,
    stripUrlNoise,
    canonicalLine,
    STRUCTURAL_LABEL_LINE,
    GENERIC_KEYWORDS,
    KNOWN_PRODUCT_LINES,
    LINE_ALIASES,
  };
}
