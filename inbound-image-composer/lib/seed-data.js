// 시드 데이터 — reference/business-rules.md(원본 CLAUDE.md)에서 지금까지 실사용하며
// 확정된 값을 그대로 이관한 것. 여기 있는 값은 "초기값"일 뿐이고, 실제 운영 중 늘어나는
// 변경사항은 UI에서 편집 → GitHub 데이터 브랜치에 커밋되는 학습본(api/load-dict)이 우선한다.
// (이 파일 자체를 고쳐도 되지만, 팀 공유가 필요하면 화면의 "사전 관리" 패널을 쓸 것)

const SEED_IP_NAME_MAP = {
  '밴드림': '뱅드림',
  '하츠네 미쿠': '보컬로이드',
  '심성훈': '러브앤딥스페이스',
  '아주르레인': '벽람항로',
  '넨도로이드 돌 바디단품': '넨도로이드 소품',
  '타카라다 릿카': 'SSSS 그리드맨',
  'SSSS.GRIDMAN': 'SSSS 그리드맨',
  '죠죠': '죠죠의 기묘한 모험',
  '쇼쿠다이키리 미츠타다': '도검난무',
  '키노모토 사쿠라': '카드캡터 체리',
  // "|" 구분자 없이 캐릭터명만 있을 때 작품명(풀네임)으로 역추론하는 항목들. 이름이
  // 흔해서 다른 작품과 헷갈릴 수 있는 캐릭터명(예: 그냥 "카에데")은 반드시 풀네임으로
  // 등록한다(성만 같은 다른 캐릭터를 오분류하지 않도록).
  '타카가키 카에데': '아이돌마스터 신데렐라걸즈',
  '미사카 미코토': '어떤 과학의 초전자포',
  '세이버 릴리': '페이트/스테이 나이트',
  '양귀비': '페이트/그랜드오더', // 등급표 S급 표기('페이트/그랜드오더')와 정확히 일치시켜야 자동 등급 분류가 적용됨
  '아니스': '니케',
  '미카 계열': '블루아카이브',
  '시나노': '벽람항로',
  '듀랜달': '벽람항로',
  '츠나군': '가정교사 히트맨 리본',
  '리본': '가정교사 히트맨 리본',
  '히바리씨': '가정교사 히트맨 리본',
  '히버드': '가정교사 히트맨 리본',
  '즈나군': '가정교사 히트맨 리본',
  // 캐릭터명/오표기 → IP명 (누락돼 있던 표기 확정 항목)
  '토미에': '이토 준지',
  '마토이 류코': '킬라킬',
  '오스칼 프랑소와 드 자르제': '베르사이유의 장미',
  '원조 뱅드림장': '원조! 뱅드림짱',
  '버디코레': '춘하추동 대행자',
};

// S/A급만 상시 유지 (B급 이하는 매달 그때그때 분류만 하고 저장하지 않음 — 데이터 비대화 방지)
const SEED_GRADE_TABLE = {
  S: ['보컬로이드', '주술회전', '페이트/그랜드오더'],
  A: ['체인소맨', '스파이 패밀리', '장송의 프리렌', '강철의 연금술사', '헌터X헌터', '마법소녀 마도카☆마기카', '에반게리온'],
};

const SEED_MOOD_CLUSTERS = [
  {
    name: '게임물 클러스터',
    members: ['파이어 엠블렘', '페르소나', '돌스타브', '별의 커비', '원신', '붕괴 스타레일', '붕괴3rd', '월희'],
    note: '블루아카이브·니케·우마무스메·학원 아이돌마스터는 게임이어도 남성향 성격이 강해 남성향 그룹으로 분류',
  },
  {
    name: '걸즈밴드물 클러스터',
    members: ['뱅드림', '뱅드림 Ave Mujica', '봇치 더 록', '케이온', '신도 아마네'],
    note: '이 순서(뱅드림 → Ave Mujica → 봇치 더 록 → 케이온 → 신도 아마네)로 붙여서 배치',
  },
  {
    name: '대중 소년만화 클러스터',
    members: ['체인소맨', '스파이 패밀리', '장송의 프리렌', '강철의 연금술사', '블랙라군', '헌터X헌터'],
  },
];

const SEED_STORE_PROFILES = {
  goodsmile: {
    label: '굿스마일 스토어',
    genderPriority: 'male-first',
    tagWhitelist: [], // 굿스마일은 라인업 태그를 아예 안 씀
  },
  megahouse: {
    label: '메가하우스 스토어',
    genderPriority: 'female-first',
    tagWhitelist: ['테노히라', '메가캣', 'GEM'], // 룩업은 폐지, GEM 신설
  },
  bushiroad: {
    label: '부시로드 스토어',
    genderPriority: 'male-first',
    tagWhitelist: [], // 부시로드도 라인업 태그를 아예 안 씀
    bandNameAsIs: true, // 뱅드림 밴드명(Ave Mujica, MyGO!!!!! 등)은 그대로 표기
  },
};

// AI로 채우기가 이 단어들을 IP명으로 착각하지 않도록 걸러주는 목록. "⚙ 사전 관리 →
// 상품 라인명" 탭에서 계속 늘려나간다 (새 상품 라인이 나올 때마다 이 목록에 추가).
const SEED_PRODUCT_LINE_NAMES = [
  '넨도로이드', '넨도로이드 돌', '피그마', '팝업퍼레이드', '팝업퍼레이드SP', '스케일 피규어',
  '프라모델', '굿스마일아츠상하이', '시크릿 굿스마일', '헬로 굿스마일', '허기 굿스마일',
  'DMM택토리', '쿠리탕', '쵸코링', '블라인드박스', '트레이딩 피규어', '프라이즈 피규어',
  '컬러즈', 'One Seventh', '1/7', 'Phat!컴퍼니', '모데로이드', '조코푸니', 'System서비스',
  'GEM', '룩업', '테노히라', '메가캣', '하이퍼바디', '크로니클', '아카타입',
  '유니온크리에이티브', '루크레아', '애니플렉스', '아니플렉스', '맥스팩토리', '굿스마일컴퍼니',
];

const DESIGN_TOKENS = {
  ipColor: '#1b1b1f',
  tagBg: '#2f7bff',
  priceColor: '#3b3b3b',
  shipColor: '#9aa0a8',
  font: '"Paperlogy","Apple SD Gothic Neo",sans-serif',
  pageW: 1080,
  pageH: 1350,
  scale: 2,
  cols: 5,
  rows: 4,
};

if (typeof window !== 'undefined') {
  window.SEED_IP_NAME_MAP = SEED_IP_NAME_MAP;
  window.SEED_GRADE_TABLE = SEED_GRADE_TABLE;
  window.SEED_MOOD_CLUSTERS = SEED_MOOD_CLUSTERS;
  window.SEED_STORE_PROFILES = SEED_STORE_PROFILES;
  window.SEED_PRODUCT_LINE_NAMES = SEED_PRODUCT_LINE_NAMES;
  window.DESIGN_TOKENS = DESIGN_TOKENS;
}
