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
];
