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

/**
 * 리포트를 다 만든 뒤, 그 파일이 선택된 상태로 탐색기를 띄우고 경로를 클립보드에 넣는다.
 * 터미널에 찍힌 경로를 손으로 긁어 복사하던 걸 없애려는 것 — 쌓인 파일 중 방금 만든 게
 * 어느 것인지도 눈으로 바로 찾게 된다.
 *
 * 이 둘은 '편의 기능'이라 실패해도 절대 작업을 망치면 안 된다. 리포트는 이미 저장이 끝난
 * 뒤이므로, 여기서 오류가 나서 프로그램이 멈추면 멀쩡히 만들어진 결과물을 두고 실패한
 * 것처럼 보이게 된다. 그래서 전부 조용히 넘어간다.
 * (윈도우 전용 명령이라 다른 운영체제에서는 아무 일도 하지 않는다.)
 */
function revealAndCopyPath(filePath) {
  if (process.platform !== 'win32') return { revealed: false, copied: false };
  const { spawnSync } = require('child_process');
  let copied = false;
  try {
    // clip은 '표준입력으로 받은 글자'를 클립보드에 넣는 윈도우 기본 프로그램.
    const r = spawnSync('clip', { input: filePath, shell: true });
    copied = !r.error && r.status === 0;
  } catch { /* 클립보드는 없어도 그만 */ }
  let revealed = false;
  try {
    // /select, 뒤에 경로를 붙이면 그 파일이 선택된 채로 폴더가 열린다. 쉼표 뒤에 공백이
    // 들어가면 동작하지 않으므로 한 덩어리로 넘긴다.
    // explorer는 성공해도 0이 아닌 값을 돌려주는 일이 잦아서 status로 성공을 판단하지 않는다.
    const r = spawnSync('explorer', [`/select,${filePath}`]);
    revealed = !r.error;
  } catch { /* 탐색기도 없어도 그만 */ }
  return { revealed, copied };
}

/** 위 결과를 사람이 읽을 한 줄로. 아무것도 안 됐으면 빈 문자열(괜히 줄만 늘리지 않음). */
function revealMessage({ revealed, copied }) {
  const done = [];
  if (revealed) done.push('폴더를 열었습니다');
  if (copied) done.push('경로를 복사했습니다(Ctrl+V로 붙여넣기)');
  return done.length ? `📂 ${done.join(' · ')}` : '';
}

module.exports = { archiveAndGetPath, kstStamp, revealAndCopyPath, revealMessage };
