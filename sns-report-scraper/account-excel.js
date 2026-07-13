/**
 * collect-account.js가 쓰는 단독 계정 성과 엑셀 저장. excel.js의 시트 정책(같은 계정+같은
 * 수집 기간이면 그 시트만 최신 내용으로 교체, 다른 기간은 새 시트로 누적)과 EPERM 재시도
 * 로직을 그대로 재사용 — PW/BH 비교 리포트와 별개 파일(account-report.xlsx)에 저장됨.
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { parseCount, formatKstTime } = require('./aggregate');
const { sanitizeSheetName, replaceWorksheet, renameWithRetry } = require('./excel');

async function saveAccountReportToExcel({ handle, startDate, endDate, posts }, outputPath) {
  const workbook = new ExcelJS.Workbook();
  if (fs.existsSync(outputPath)) {
    await workbook.xlsx.readFile(outputPath);
  }

  const sheetName = sanitizeSheetName(`${handle}_${startDate}_${endDate}`.replace(/-/g, ''));
  const sheet = replaceWorksheet(workbook, sheetName);

  sheet.addRow([`계정: @${handle}`]);
  sheet.addRow([`수집 기간: ${startDate} ~ ${endDate}`]);
  sheet.addRow([`생성 시각: ${new Date().toISOString()}`]);
  sheet.addRow([]);
  const headerRow = sheet.addRow(['순위', '게시 시각', '링크', '좋아요', '리트윗', '본문']);
  headerRow.font = { bold: true };

  const score = p => (parseCount(p.likes) || 0) + (parseCount(p.retweets) || 0);
  const ranked = [...posts].sort((a, b) => score(b) - score(a));
  ranked.forEach((p, i) => {
    const text = p.text || '';
    // 줄바꿈을 공백으로 지우지 않고 그대로 둠 — wrapText를 켜야 엑셀이 셀 안에서
    // \n 기준으로 실제 줄바꿈해서 보여줌(안 켜면 줄바꿈 문자가 있어도 한 줄로 뭉개져 보임).
    const row = sheet.addRow([i + 1, formatKstTime(p.datetime), p.link, parseCount(p.likes), parseCount(p.retweets), text]);
    row.getCell(6).alignment = { wrapText: true, vertical: 'top' };
    const lineCount = text.split('\n').length;
    if (lineCount > 1) row.height = lineCount * 15; // 줄 수만큼 행 높이를 넉넉히 잡아서 잘림 방지
  });

  sheet.columns.forEach(col => { col.width = 18; });
  sheet.getColumn(3).width = 40;
  sheet.getColumn(6).width = 60;

  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${outputPath}.tmp-${process.pid}`;
  await workbook.xlsx.writeFile(tmpPath);
  await renameWithRetry(tmpPath, outputPath);

  return sheetName;
}

module.exports = { saveAccountReportToExcel };
