// 시드 데이터 — reference/business-rules.md(원본 CLAUDE.md)에서 지금까지 실사용하며
// 확정된 값을 그대로 이관한 것. 여기 있는 값은 "초기값"일 뿐이고, 실제 운영 중 늘어나는
// 변경사항은 UI에서 편집 → GitHub 데이터 브랜치에 커밋되는 학습본(api/load-dict)이 우선한다.
// (이 파일 자체를 고쳐도 되지만, 팀 공유가 필요하면 화면의 "사전 관리" 패널을 쓸 것)

const SEED_IP_NAME_MAP = {
  '밴드림': '뱅드림',
  'Ave Mujica': '뱅드림 Ave Mujica',
  '그 비스크돌은 사랑을 한다': '그비돌',
  '아이돌마스터 신데렐라걸즈': '신데렐라걸즈',
  '어떤 과학의 초전자포': '어과초',
  '하츠네 미쿠': '보컬로이드',
  '니지산지': '룬룬 (니지산지)',
  '마법소녀 마도카☆마기카': '마도마기',
  '가정교사 히트맨 리본': '가히리',
  '학원 아이돌마스터': '학원마스',
  '심성훈': '러브앤딥스페이스',
  '아주르레인': '벽람항로',
  '나의 히어로 아카데미아': '나히아',
  '문호스트레이독스': '문스독',
  '넨도로이드 돌 바디단품': '넨도로이드 소품',
  '패배 히로인이 너무 많아': '패로인',
  '프로젝트 세카이 컬러풀 스테이지': '프로세카',
  '타카라다 릿카': '그리드맨',
  'SSSS.GRIDMAN': '그리드맨',
  '죠죠': '죠죠의 기묘한 모험',
  'MyGO!!!!!': 'MyGO!!!!!',
  '헬로해피월드': '헬로! 해피 월드',
  '소녀 가극 레뷰 스타라이트': '레뷰스타',
};

// VTuber는 매핑이 아니라 규칙(소속사명을 IP로 쓰지 않고 IP=VTuber, 소속=태그)이라
// 별도 플래그로 다룬다. UI에서 "VTuber 소속 표기"로 안내.
const VTUBER_AFFILIATION_HINT =
  '호로라이브 등 VTuber 상품은 IP명을 "VTuber"로 적고, 소속사(예: 홀로라이브)는 라인업 태그처럼 파란 배지로 붙인다.';

// S/A급만 상시 유지 (B급 이하는 매달 그때그때 분류만 하고 저장하지 않음 — 데이터 비대화 방지)
const SEED_GRADE_TABLE = {
  S: ['보컬로이드', '주술회전', '페이트/페그오'],
  A: ['체인소맨', '스파이 패밀리', '장송의 프리렌', '강철의 연금술사', '헌터X헌터', '마도마기', '에반게리온'],
};

const SEED_MOOD_CLUSTERS = [
  {
    name: '게임물 클러스터',
    members: ['파이어 엠블렘', '페르소나', '돌스타브', '별의 커비', '원신', '붕괴 스타레일', '붕괴3rd', '월희'],
    note: '블루아카이브·니케·우마무스메·학원마스는 게임이어도 남성향 성격이 강해 남성향 그룹으로 분류',
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
    tagWhitelist: ['룩업', '테노히라', '메가캣'],
  },
  megahouse: {
    label: '메가하우스 스토어',
    genderPriority: 'female-first',
    tagWhitelist: ['룩업', '테노히라', '메가캣'],
  },
  bushiroad: {
    label: '부시로드 스토어',
    genderPriority: 'male-first',
    tagWhitelist: ['룩업', '테노히라', '메가캣'],
    bandNameAsIs: true, // 뱅드림 밴드명(Ave Mujica, MyGO!!!!! 등)은 그대로 표기
  },
};

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
  window.VTUBER_AFFILIATION_HINT = VTUBER_AFFILIATION_HINT;
  window.DESIGN_TOKENS = DESIGN_TOKENS;
}
