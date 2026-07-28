// 스크랩 완료 직후 팀원 편의를 위한 자잘한 OS 연동 두 가지 — 둘 다 "되면 좋고 안 되면 그만"인
// 편의 기능이라, 실패해도 절대 스크랩 자체를 실패로 만들면 안 된다(그래서 항상 조용히 무시).
const { execSync } = require('child_process');

function copyToClipboard(text) {
  try {
    if (process.platform === 'win32') execSync('clip', { input: text });
  } catch { /* 클립보드 복사는 편의 기능 — 실패해도 무시 */ }
}

function openInExplorer(dirPath) {
  try {
    if (process.platform === 'win32') execSync(`start "" "${dirPath}"`, { shell: 'cmd.exe' });
  } catch { /* 탐색기 자동 오픈도 편의 기능 — 실패해도 무시 */ }
}

module.exports = { copyToClipboard, openInExplorer };
