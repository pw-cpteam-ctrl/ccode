const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const FIELD_LABELS = { likes: '좋아요', retweets: '리트윗', comments: '댓글' };

function metricLabel(key) {
  if (key === 'postCount') return '게시물 수';
  const [type, field] = key.split('_'); // 'total_likes' -> ['total','likes']
  return `${type === 'total' ? '총' : '평균'} ${FIELD_LABELS[field] || field}`;
}

function ratioText(cmp) {
  if (!cmp || cmp.ratioPercent === null) return 'N/A';
  // label 자체에 비율(%p) 정보가 들어있어 중복 표기하지 않음 (예: "자사 우세 (+12.5%p)")
  return `${cmp.ratioPercent}%, ${cmp.label}`;
}

// 엑셀 시트 이름은 31자 제한 + \/:*?[] 사용 불가
function sanitizeSheetName(name) {
  return name.replace(/[\\/:*?[\]]/g, '-').slice(0, 31);
}

function uniqueSheetName(workbook, baseName) {
  let name = sanitizeSheetName(baseName);
  let suffix = 2;
  while (workbook.getWorksheet(name)) {
    name = sanitizeSheetName(`${baseName} (${suffix})`);
    suffix++;
  }
  return name;
}

function writePlatformSection(sheet, platformKey, data) {
  const platformTitle = { twitter: 'X(트위터)', instagram: '인스타그램' }[platformKey] || platformKey;
  const titleRow = sheet.addRow([`[${platformTitle}] 비교표`]);
  titleRow.font = { bold: true, size: 12 };

  const metricKeys = ['postCount', ...data.fields.flatMap(f => [`total_${f}`, `avg_${f}`])];

  const header = ['지표', '자사'];
  data.competitors.forEach(c => header.push(c.account, '비율'));
  if (data.competitorAverage) header.push('경쟁사 평균', '비율');
  const headerRow = sheet.addRow(header);
  headerRow.font = { bold: true };
  headerRow.eachCell(cell => { cell.border = { bottom: { style: 'thin' } }; });

  metricKeys.forEach(key => {
    const row = [metricLabel(key), data.ownTotals[key]];
    data.perCompetitorComparison.forEach(pc => {
      row.push(pc.metrics[key].competitor, ratioText(pc.metrics[key]));
    });
    if (data.vsAverage) {
      row.push(data.competitorAverage[key], ratioText(data.vsAverage[key]));
    }
    sheet.addRow(row);
  });

  // 파싱 실패 건수가 있으면 투명하게 경고 표시 (특히 instagram 좌표 파싱 미검증 상태 고려)
  const failureNotes = [];
  data.own.forEach(acc => {
    Object.entries(acc.parseFailures).forEach(([field, count]) => {
      if (count > 0) failureNotes.push(`자사(${acc.account}) ${FIELD_LABELS[field] || field} 파싱 실패 ${count}건`);
    });
  });
  data.competitors.forEach(acc => {
    Object.entries(acc.parseFailures).forEach(([field, count]) => {
      if (count > 0) failureNotes.push(`경쟁사(${acc.account}) ${FIELD_LABELS[field] || field} 파싱 실패 ${count}건`);
    });
  });
  if (failureNotes.length > 0) {
    const warnRow = sheet.addRow([`⚠ ${failureNotes.join(' / ')}`]);
    warnRow.font = { italic: true, color: { argb: 'FFCC0000' } };
  }

  sheet.addRow([]); // 섹션 구분 공백
}

function writeProductPlatformSection(sheet, platformKey, data) {
  const platformTitle = { twitter: 'X(트위터)', instagram: '인스타그램' }[platformKey] || platformKey;
  const titleRow = sheet.addRow([`[${platformTitle}] 상품별 비교 (PW=자사, BH=경쟁사)`]);
  titleRow.font = { bold: true, size: 12 };

  const { products, ownUnmatched, competitorUnmatched, displayFields } = data.productComparison;

  const header = ['IP', '시리즈'];
  displayFields.forEach(f => header.push(`PW ${FIELD_LABELS[f] || f}`, `BH ${FIELD_LABELS[f] || f}`));
  header.push('PW 시각', 'BH 시각');
  displayFields.forEach(f => header.push(`${FIELD_LABELS[f] || f}차이`));
  header.push('시각차이', '결과');
  const headerRow = sheet.addRow(header);
  headerRow.font = { bold: true };
  headerRow.eachCell(cell => { cell.border = { bottom: { style: 'thin' } }; });

  if (products.length === 0) {
    sheet.addRow(['매칭된 상품 없음 (자사/경쟁사 게시물에서 공통 키워드를 찾지 못함)']);
  }
  products.forEach(p => {
    const row = [p.ip || '(미분류)', p.line || '-'];
    displayFields.forEach(f => row.push(p.own[`total_${f}`], p.competitor[`total_${f}`]));
    row.push(p.pwTime, p.bhTime);
    displayFields.forEach(f => row.push(p.diffText[f]));
    row.push(`${p.timeDiffMinutes}분`, p.verdict);
    sheet.addRow(row);
  });

  // 합계("계") 행 — 시각/결과는 상품마다 달라서 총합 의미가 없어 비워둠
  if (products.length > 0) {
    const totalRow = ['계', '계'];
    displayFields.forEach(f => {
      const pwSum = products.reduce((s, p) => s + p.own[`total_${f}`], 0);
      const bhSum = products.reduce((s, p) => s + p.competitor[`total_${f}`], 0);
      totalRow.push(pwSum, bhSum);
    });
    totalRow.push('', '');
    displayFields.forEach(f => {
      const pwSum = products.reduce((s, p) => s + p.own[`total_${f}`], 0);
      const bhSum = products.reduce((s, p) => s + p.competitor[`total_${f}`], 0);
      totalRow.push(pwSum - bhSum);
    });
    totalRow.push('', '');
    const totalRowObj = sheet.addRow(totalRow);
    totalRowObj.font = { bold: true };
  }
  sheet.addRow([]);

  // 매칭 안 된 게시물도 숨기지 않고 그대로 노출 (상품명 추출 실패/양쪽 표현이 달라 매칭 실패)
  const textField = { twitter: 'text', instagram: 'caption' }[platformKey];
  const writeUnmatchedTable = (label, posts) => {
    const noteRow = sheet.addRow([`▸ 매칭 안 된 ${label} 게시물 (${posts.length}건) — 상품명을 못 뽑았거나 상대측과 겹치는 키워드가 없어서 매칭 안 됨`]);
    noteRow.font = { italic: true };
    if (posts.length === 0) return;
    sheet.addRow(['링크', '날짜', ...data.fields.map(f => FIELD_LABELS[f] || f), '본문 일부']);
    posts.forEach(post => {
      const link = post.link || post.url || '';
      const preview = (post[textField] || '').replace(/\n/g, ' ').slice(0, 60);
      sheet.addRow([link, post.datetime, ...data.fields.map(f => post[f]), preview]);
    });
  };
  writeUnmatchedTable('자사', ownUnmatched);
  writeUnmatchedTable('경쟁사', competitorUnmatched);

  sheet.addRow([]);
}

/**
 * 취합 리포트를 엑셀 파일에 저장. 기존 시트는 절대 지우지 않고 새 시트를 추가만 함(히스토리 누적).
 * 쓰기 중 프로세스가 죽어도 원본이 깨지지 않도록 임시 파일에 쓴 뒤 교체(원자적 교체)한다.
 *
 * @param {object} report   aggregate.js의 buildComparisonReport() 결과
 * @param {string} outputPath  저장할 xlsx 경로
 * @returns {Promise<string>} 실제로 추가된 시트 이름
 */
async function saveReportToExcel(report, outputPath) {
  const workbook = new ExcelJS.Workbook();

  if (fs.existsSync(outputPath)) {
    await workbook.xlsx.readFile(outputPath);
  }

  const baseName = `${report.startDate}_${report.endDate}`.replace(/-/g, '');
  const sheetName = uniqueSheetName(workbook, baseName);
  const sheet = workbook.addWorksheet(sheetName);

  sheet.addRow([`수집 기간: ${report.startDate} ~ ${report.endDate}`]);
  sheet.addRow([`생성 시각: ${report.generatedAt}`]);
  sheet.addRow([]);

  Object.entries(report.platforms).forEach(([platformKey, data]) => {
    writePlatformSection(sheet, platformKey, data);
  });

  sheet.columns.forEach(col => { col.width = 20; });

  const productSheetName = uniqueSheetName(workbook, `${baseName}-상품별`);
  const productSheet = workbook.addWorksheet(productSheetName);
  Object.entries(report.platforms).forEach(([platformKey, data]) => {
    writeProductPlatformSection(productSheet, platformKey, data);
  });
  productSheet.columns.forEach(col => { col.width = 22; });

  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${outputPath}.tmp-${process.pid}`;
  await workbook.xlsx.writeFile(tmpPath);
  fs.renameSync(tmpPath, outputPath); // 같은 파일시스템 내 rename은 원자적 교체

  return sheetName;
}

module.exports = { saveReportToExcel, sanitizeSheetName, uniqueSheetName };
