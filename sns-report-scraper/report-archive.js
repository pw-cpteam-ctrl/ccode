/**
 * HTML 리포트 파일명에 생성 시각을 붙이고, 새로 만들 때 기존 파일(예전 타임스탬프 파일 +
 * 예전 고정 이름 파일 둘 다)을 자동으로 old/ 폴더로 옮겨주는 유틸.
 *
 * 엑셀(xlsx)은 대상 아님 — 엑셀은 이미 재실행해도 같은 파일 안에 시트를 쌓아서 히스토리를
 * 관리하는 방식이 있고(excel.js), 그건 그대로 유지. 이건 히스토리 기능이 없던 HTML 전용.
 */
const fs = require('fs');
const path = require('path');

function kstStamp() {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${kst.getUTCFullYear()}${pad(kst.getUTCMonth() + 1)}${pad(kst.getUTCDate())}_${pad(kst.getUTCHours())}${pad(kst.getUTCMinutes())}`;
}

// dir 안의 기존 "baseName*.ext" 파일(타임스탬프 붙은 것 + 예전 고정이름 파일 전부)을
// dir/old/로 옮기고, 이번에 새로 쓸 타임스탬프 파일 경로를 돌려줌.
function archiveAndGetPath(dir, baseName, ext) {
  const oldDir = path.join(dir, 'old');
  fs.mkdirSync(oldDir, { recursive: true });

  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  for (const file of files) {
    const full = path.join(dir, file);
    if (file.startsWith(baseName) && file.endsWith(`.${ext}`) && fs.statSync(full).isFile()) {
      fs.renameSync(full, path.join(oldDir, file));
    }
  }

  return path.join(dir, `${baseName}_${kstStamp()}.${ext}`);
}

module.exports = { archiveAndGetPath, kstStamp };
