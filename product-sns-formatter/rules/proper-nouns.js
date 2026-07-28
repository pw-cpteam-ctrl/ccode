// 상품 시리즈명·캐릭터명·업계 고정 용어의 단일 사전. 프론트(index.html의 좌측 목록 음역
// 미리보기)와 백엔드(api/format.js의 원고 생성 프롬프트)가 이 파일 하나를 같이 읽는다 —
// 새 고유명사가 발견되면 여기 한 곳에만 추가하면 양쪽에 다 반영된다.
// 발음 추측(규칙 기반 음역)이 오히려 표기를 망가뜨리는 경우가 많아서, 사전에 있으면
// 그걸 우선 쓰고 사전에 없는 나머지만 규칙 기반 음역으로 넘긴다. 긴 구문부터 매칭되도록
// 양쪽에서 각자 정렬해서 쓴다(이 파일 자체의 순서는 상관없음).
export const PROPER_NOUNS = [
  ['pop up parade', '팝업 퍼레이드'],
  ['scale figure', '스케일 피규어'],
  ['complete figure', '컴플리트 피규어'],
  ['prize figure', '프라이즈 피규어'],
  ['non-scale', '논스케일'], ['non scale', '논스케일'],
  ['good smile company', '굿스마일 컴퍼니'], ['good smile', '굿스마일'],
  ['nendoroid', '넨도로이드'],
  ['figma', '피그마'],
  ['punipuni', '푸니푸니'],
  ['blythe', '블라이스'],
  ['figure', '피규어'],
  ['plushie', '플러시'],
  ['deluxe', '디럭스'],
  ['renewal', '리뉴얼'],
  ['edition', '에디션'],
  ['original', '오리지널'],
  ['standard', '스탠다드'],
  ['special', '스페셜'],
  ['bonus', '보너스'],
  ['series', '시리즈'],
  ['scale', '스케일'],
  ['ver.', '버전'], ['ver', '버전'],
  ['set', '세트'],
  ['multi', '멀티'],
  ['vanilla', '바닐라'],
  ['lollipop', '롤리팝'],
  ['hatsune miku', '하츠네 미쿠'],
  ['chocopuni', '쵸코푸니'],
  ['kaguya', '카구야'],

  // inbound-image-composer 프로젝트의 PRODUCT_LINE_NAMES(굿스마일류 상품 라인명/제조사명
  // 사전)를 참고해서 이 프로젝트에 없던 항목을 추가함. 그 프로젝트는 "이미 한글로 적힌
  // 텍스트가 IP명으로 오분류되지 않게 걸러주는" 화이트리스트라 목적이 다르지만, 여기선
  // 그 한글 표기를 그대로 정답으로 삼아 영문 상품정보 음역용 [en, ko] 쌍으로 옮겼다.
  ['nendoroid doll', '넨도로이드 돌'],
  ['pop up parade sp', '팝업 퍼레이드 SP'],
  ['blind box', '블라인드박스'],
  ['trading figure', '트레이딩 피규어'],
  ['secret good smile', '시크릿 굿스마일'],
  ['hello good smile', '헬로 굿스마일'],
  ['good smile arts shanghai', '굿스마일아츠상하이'],
  ['aniplex', '애니플렉스'],
  ['max factory', '맥스팩토리'],
  ['union creative', '유니온크리에이티브'],
  ['tenohira', '테노히라'],
  ['mega cat', '메가캣'],
  ['moderoid', '모데로이드'],
  ['lucrea', '루크레아'],
  ['choco ring', '쵸코링'],
  ['plastic model', '프라모델'],
  ['dmm tactory', 'DMM택토리'],
  ['colors.', '컬러즈'],
  ['system service', 'System서비스'],
  ['look up', '룩업'],
  ['hyper body', '하이퍼바디'],
  ['chronicle', '크로니클'],
  ['phat', 'Phat'], // 원문의 "!"는 정규식이 안 건드리고 그대로 남으니 여기선 느낌표 안 붙임(붙이면 "Phat!!"처럼 겹침)
  ['company', '컴퍼니'],
  ['one seventh', 'One Seventh'], // 이 라인은 관행상 한글화 안 하고 영문 그대로 씀
  ['g.s.', 'G.S.'], // "G.S. Collection"의 약어 — 길이 체크(2글자 약어 패스스루)에 안 걸려서 별도 등록
  ['mcqueen', '맥퀸'], // 엔진이 "qu"의 w 발음을 놓쳐서 맥킨으로 깨짐(퀸이 킨이 됨) — 자주 나오는 이름이라 사전으로 우회
  ['hug good smile', '허기 굿스마일'], // 영문 원표기 불확실(추정) — 실제 스펙에서 다르면 알려주세요
  // 확신 없어서 뺀 항목: 쿠리탕(영문 소스 불명), 아카타입(archetype이면 발음상 "아키타입"이
  // 맞아 "아카타입"과 안 맞음 — 실제 영문 표기 확인되면 추가)

  // 아래부터는 순수 영어 단어(고유명사가 아님)인데도 규칙 기반 음역 엔진(영어 발음 추정
  // 로직)이 완전히 다른 소리로 깨뜨리는 것들. 이 엔진은 원래 일본어 로마자 이름을 영어식
  // 발음으로 잘못 읽는 문제 때문에 만든 보조 장치였는데, 정작 진짜 영어 단어에는 발음
  // 규칙 자체가 안 맞아서 (Surprise->섭리스, Basic->바식, Exercise->에어키스 같은 식으로)
  // 실사용 데이터에서 반복적으로 터짐. 일반 영어 사전을 통째로 넣을 수는 없으니, 상품
  // 제목에 실제로 반복해서 나오는 단어부터 여기 사전으로 하드코딩해서 우회한다.
  ['collection', '컬렉션'],
  ['release', '릴리즈'],
  ['tyrant', '타이런트'],
  ['female', '피메일'],
  ['basic', '베이직'],
  ['surprise', '서프라이즈'],
  ['shadow', '섀도우'],
  ['generations', '제너레이션즈'], ['generation', '제너레이션'],
  ['motored', '모터드'],
  ['cyborg', '사이보그'],
  ['runner', '러너'],
  ['pop', '팝'],
  ['tracker', '트래커'],
  ['post', '포스트'],
  ['shower', '샤워'],
  ['moment', '모먼트'],
  ['bare', '베어'],
  ['bunny', '버니'],
  ['animal', '애니멀'],
  ['ears', '이어즈'], ['ear', '이어'],
  ['school', '스쿨'],
  ['uniform', '유니폼'],
  ['cops', '캅스'], ['cop', '캅'],
  ['exercise', '엑서사이즈'],
  ['private', '프라이빗'],
  ['quarters', '쿼터스'], ['quarter', '쿼터'],
  ['magic', '매직'],
  ['knight', '나이트'],
  ['rayearth', '레이어스'], // "Magic Knight Rayearth"의 국내 정발 표기: 매직나이트 레이어스
  ['cheerleader', '치어리더'],
  ['gremory', '그레모리'],

  // 상품명 뒤 "[June 2027 Release]" 같은 발매월 표기 패턴에서 반복되는 월 이름.
  // 주의: "May"는 캐릭터 이름(사람 이름 "메이")과 겹칠 수 있음 — 발매월 표기가 훨씬 자주
  // 나오는 패턴이라 이걸 기본값으로 두되, 실제로 캐릭터명 "May"가 오역되는 사례가 나오면
  // 이 항목만 다시 빼는 것도 고려.
  ['january', '1월'], ['february', '2월'], ['march', '3월'], ['april', '4월'],
  ['may', '5월'], ['june', '6월'], ['july', '7월'], ['august', '8월'],
  ['september', '9월'], ['october', '10월'], ['november', '11월'], ['december', '12월'],
];
