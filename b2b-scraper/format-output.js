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
  if (f.copyright) lines.push(`저작권: ${f.copyright}`);
  if (f.wholesalePrice || f.retailPrice) {
    lines.push(`가격: 도매 ${f.wholesalePrice || '-'} / 소매 ${f.retailPrice || '-'}`);
  }
  if (f.qtyPerCarton) lines.push(`카톤당 수량: ${f.qtyPerCarton}`);
  return lines.join('\n');
}

// f: { id, title, work, releaseDate, rerelease, size, manufacturer, copyright,
//      wholesalePrice, retailPrice, qtyPerCarton, photoFilenames: string[] }
function buildOutputProduct(f) {
  return {
    id: f.id,
    title: f.title || '',
    work: f.work || '',
    releaseDate: f.releaseDate || '',
    rerelease: !!f.rerelease,
    size: f.size || '',
    manufacturer: f.manufacturer || '',
    copyright: f.copyright || '',
    wholesalePrice: f.wholesalePrice || '',
    retailPrice: f.retailPrice || '',
    qtyPerCarton: f.qtyPerCarton || '',
    officialText: buildOfficialText(f),
    photos: f.photoFilenames || [],
  };
}

// outDir 안에 output.json + photos/ 폴더를 만든다. product-sns-formatter의 "B2B 가져오기"는
// 이 output.json과 photos/ 안의 파일들을 함께 선택해서 가져온다(파일명으로 매칭).
function writeOutputFile(products, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'output.json');
  fs.writeFileSync(outPath, JSON.stringify({ scrapedAt: new Date().toISOString(), products }, null, 1), 'utf-8');
  return outPath;
}

module.exports = { buildOfficialText, buildOutputProduct, writeOutputFile };
