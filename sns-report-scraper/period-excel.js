/**
 * compare-periods.js가 쓰는 기간별 비교 엑셀 저장. excel.js의 시트 정책(같은 기간 조합이면
 * 그 시트만 최신 내용으로 교체, 다른 조합은 새 시트로 누적)과 EPERM 재시도 로직을 그대로
 * 재사용 — PW/BH 단일 기간 리포트와 별개 파일(period-comparison.xlsx)에 저장됨.
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { sanitizeSheetName, replaceWorksheet, renameWithRetry } = require('./excel');
const { buildPeriodSummary } = require('./period-comparison');

const PLATFORM_TITLES = { twitter: 'X(트위터)', instagram: '인스타그램' };

// 엑셀 시트 이름은 31자 제한이라(sanitizeSheetName), 기간 라벨을 그대로("2026-06-10~2026-06-13")
// 이어붙이면 기간이 2~3개만 돼도 뒤쪽 기간이 잘려서, 3번째 기간만 다른 조합끼리 시트 이름이
// 똑같아져 버리는(서로 다른 조합인데 같은 시트로 갱신돼버리는) 문제가 있었음 — 연도/구분선을
// 빼고 "월일-월일" 형태로 압축해서 웬만한 조합(3~4개 기간)까지는 안 잘리게 함.
function compactPeriodId(label) {
  const [start, end] = label.split('~');
  const shorten = d => d.slice(5).replace('-', ''); // "2026-06-10" -> "0610"
  return `${shorten(start)}-${shorten(end)}`;
}

async function savePeriodComparisonToExcel(periods, outputPath) {
  const workbook = new ExcelJS.Workbook();
  if (fs.existsSync(outputPath)) {
    await workbook.xlsx.readFile(outputPath);
  }

  const sheetName = sanitizeSheetName(periods.map(p => compactPeriodId(p.label)).join('_'));
  const sheet = replaceWorksheet(workbook, sheetName);

  sheet.addRow([`비교 기간: ${periods.map(p => p.label).join(' / ')}`]);
  sheet.addRow([`생성 시각: ${new Date().toISOString()}`]);
  sheet.addRow([]);

  buildPeriodSummary(periods).forEach(({ platform, rows }) => {
    const title = PLATFORM_TITLES[platform] || platform;
    const titleRow = sheet.addRow([`[${title}] 기간별 비교`]);
    titleRow.font = { bold: true, size: 12 };

    const header = ['지표'];
    periods.forEach(p => header.push(`${p.label} 자사`, `${p.label} 경쟁사`));
    const headerRow = sheet.addRow(header);
    headerRow.font = { bold: true };
    headerRow.eachCell(cell => { cell.border = { bottom: { style: 'thin' } }; });

    rows.forEach(r => {
      const row = [r.label];
      r.cells.forEach(c => row.push(c.own ?? '-', c.competitor ?? '-'));
      sheet.addRow(row);
    });
    sheet.addRow([]);
  });

  sheet.columns.forEach(col => { col.width = 18; });
  sheet.getColumn(1).width = 22;

  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${outputPath}.tmp-${process.pid}`;
  await workbook.xlsx.writeFile(tmpPath);
  await renameWithRetry(tmpPath, outputPath);

  return sheetName;
}

module.exports = { savePeriodComparisonToExcel };
