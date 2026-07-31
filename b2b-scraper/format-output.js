// 스크래핑한 필드를 product-sns-formatter가 그대로 가져올 수 있는 형태로 조립한다.
// product-sns-formatter의 상품 상세 ①단계는 officialText(자유 텍스트)를 그대로 쓰므로,
// 여기서 사람이 읽기 좋은 줄글로 미리 조립해둔다 — 가져온 뒤에도 사람이 손으로 다듬을 수 있음.
const fs = require('fs');
const path = require('path');

function buildOfficialText(f) {
  const lines = [];
  if (f.title) lines.push(`상품명: ${f.title}`);
  if (f.work) lines.push(`시리즈: ${f.work}`);
  if (f.releaseDate) lines.push(`발매일: ${f.releaseDate}`);
  lines.push(`재판여부: ${f.rerelease ? '재판' : '신제품'}`);
  if (f.size) lines.push(`사이즈: ${f.size}`);
  if (f.manufacturer) lines.push(`제조사: ${f.manufacturer}`);
  // 저작권/가격/카톤당 수량은 팀 실사용에 필요 없어서 수집 안 함(요청에 따라 제외).
  return lines.join('\n');
}

// f: { id, title, work, releaseDate, rerelease, size, manufacturer, photoFilenames: string[] }
function buildOutputProduct(f) {
  return {
    id: f.id,
    title: f.title || '',
    work: f.work || '',
    releaseDate: f.releaseDate || '',
    rerelease: !!f.rerelease,
    size: f.size || '',
    manufacturer: f.manufacturer || '',
    officialText: buildOfficialText(f),
    photos: f.photoFilenames || [],
  };
}

// outDir 안에 output.json + photos/ 폴더를 만든다. product-sns-formatter의 "B2B 가져오기"는
// 이 output.json과 photos/ 안의 파일들을 함께 선택해서 가져온다(파일명으로 매칭).
// meta.guidanceDate: 이 결과가 어느 발표일분인지(예: '20260730'). 폴더명만으로도 알 수 있지만,
// 파일 하나만 따로 전달받았을 때도 어느 날짜분인지 알 수 있게 같이 적어둔다(있으면 기록, 없으면 생략).
function writeOutputFile(products, outDir, meta = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'output.json');
  const payload = { scrapedAt: new Date().toISOString(), products };
  if (meta.guidanceDate) payload.guidanceDate = meta.guidanceDate;
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 1), 'utf-8');
  return outPath;
}

module.exports = { buildOfficialText, buildOutputProduct, writeOutputFile };
