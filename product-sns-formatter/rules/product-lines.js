// 캐러셀 이미지 부제(작은 글자)용 "제품 라인/카테고리" 매칭 테이블.
// 부제는 원고 텍스트(AI가 만든 『작품명』)가 아니라 상품 원문(제목·상품정보·메모를 합친
// 텍스트)에서 직접 뽑는다 — 『작품명』은 실제 게시될 원고 본문 그 자체라 건드리면 안 되고,
// "이 상품이 어떤 제품군(넨도로이드/피규어/봉제인형 등)인지"는 보통 영문 원문에 그대로
// 박혀있어서 사전 매칭으로 충분히 뽑을 수 있다. (제품명이 상품정보 칸이 아니라 제목 칸에만
// 적혀있는 경우가 있어서, 상품정보 하나만 보면 놓친다 — 호출부 autoFillProductLineSub 참고)
//
// 우선순위: 배열 순서가 위에서부터 우선. 일반형(예: "넨도로이드")보다 그 하위 서브라인
// (예: "넨도로이드 소품")을 먼저 검사해야, 둘 다 걸리는 입력에서 더 구체적인 쪽이 이긴다.
export const PRODUCT_LINES = [
  [/nendoroid\s*more/i, '넨도로이드 소품'],
  [/chocopuni/i, '쵸코푸니 봉제인형'],
  [/punipuni/i, '푸니푸니 봉제인형'],
  [/kuripan|kuri-pan/i, '쿠리팡 봉제인형'], // 영문 원표기 불확실(추정) — 실제 스펙에서 다르면 고쳐주세요
  [/hug good smile/i, '허기 굿스마일'],
  [/noodle stopper/i, '후류 누들스토퍼'],
  [/pop up parade/i, '팝업퍼레이드'],
  [/moderoid/i, '모데로이드'],
  [/framecia|puramatea/i, '프라마테아'], // 영문 원표기 불확실(추정) — 실제 스펙에서 다르면 고쳐주세요
  [/\bfigma\b/i, '피그마'],
  [/\bamp\+/i, 'AMP+ 피규어'],
  [/acrylic\s*key\s*chain/i, '아크릴 키체인'],
  [/trading\s*can\s*badge/i, '트레이딩 캔뱃지'],
  [/acrylic\s*stand/i, '아크릴 스탠드'],
  [/nendoroid/i, '넨도로이드'],
  [/plush/i, '봉제인형'],
];

// 목록에 없으면 일반 스케일 피규어로 취급 — 스케일 표기(1/4, 1/7 등)가 있으면 그대로 살리고,
// 없으면 그냥 "스케일 피규어".
function scaleFallbackLabel(text) {
  const m = (text || '').match(/(\d+\/\d+)\s*scale/i);
  return m ? `${m[1]} 스케일 피규어` : '스케일 피규어';
}

// matchText: 라인명을 찾아볼 텍스트(제목+상품정보+메모를 합쳐 넘김 — 제품명이 제목 칸에만
//            적혀있는 경우가 있어서 상품정보 하나만 보면 놓친다)
// allowScaleFallback: 라인명을 못 찾았을 때 "스케일 피규어"를 기본값으로 붙일지 여부.
//            실제 스펙 정보(상품정보 칸)가 들어온 상품에만 true로 넘긴다 — 캐릭터 메모만
//            적어둔 상품까지 붙이면 봉제인형인데 "스케일 피규어"로 잘못 박힌다.
//            (틀린 부제가 조용히 이미지에 박히는 것보다, 빈칸으로 두고 사람이 채우는 게 안전)
export function matchProductLine(matchText, { allowScaleFallback = true } = {}) {
  const text = (matchText || '').trim();
  if (!text) return '';
  for (const [pattern, label] of PRODUCT_LINES) {
    if (pattern.test(text)) return label;
  }
  return allowScaleFallback ? scaleFallbackLabel(text) : '';
}
