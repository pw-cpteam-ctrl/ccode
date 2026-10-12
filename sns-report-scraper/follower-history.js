/**
 * 팔로워·관심고객수를 시점마다 쌓는 기록 파일을 다루는 곳.
 *
 * 왜 따로 뺐나 — 쌓는 쪽이 두 군데가 됐다. SNS 수집(run-megahouse)은 팔로워를, 재고 촬영
 * (naver-stock-snapshot)은 관심고객수를 쌓는다. 같은 파일에 같은 모양으로 적어야 리포트가
 * 한 줄로 읽는데, 두 곳에 같은 코드를 복사해두면 한쪽만 고치는 날 모양이 어긋난다.
 *
 * 한 번 수집할 때 줄이 두 개 생겨도 괜찮다 — 리포트는 계정별로 '그 시점에 값이 있는 줄'만
 * 모아서 선을 그린다. 그래서 X·인스타는 SNS 수집 때마다, 관심고객수는 재고 찍을 때마다
 * 각자의 간격으로 쌓여도 추이가 어긋나지 않는다. 오히려 재고를 자주 찍으면 관심고객수
 * 추이가 그만큼 촘촘해진다.
 */
const fs = require('fs');
const path = require('path');

/**
 * 기록 파일에 한 줄 추가.
 * @param {string} historyPath 쌓을 파일 경로
 * @param {Array} accounts [{platform, account, side, followers, from, approx, label?}]
 *        followers가 null이면 '그때 못 쟀다'는 뜻 — 빼지 말고 그대로 남긴다. 빼버리면
 *        나중에 "그날은 안 쟀다"와 "그날은 0명이었다"가 구분이 안 된다.
 * @returns {number|null} 누적 줄 수(저장 안 했으면 null)
 */
function appendFollowerSnapshot(historyPath, accounts) {
  if (!historyPath || !Array.isArray(accounts) || accounts.length === 0) return null;
  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  let history = { snapshots: [] };
  if (fs.existsSync(historyPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
      if (Array.isArray(parsed?.snapshots)) history = parsed;
    } catch (e) {
      // 파일이 깨졌다고 이번 기록까지 버리면 안 되지만, 쌓아둔 걸 말없이 날려서도 안 된다.
      // 원본을 옆에 치워두고 새로 시작한다 — 되돌릴 길은 남겨둔다.
      const backup = `${historyPath}.broken-${Date.now()}`;
      fs.renameSync(historyPath, backup);
      console.warn(`⚠️ 기록 파일이 깨져 있어서 ${path.basename(backup)} 로 옮기고 새로 시작합니다: ${e.message}`);
    }
  }
  history.snapshots.push({ takenAt: new Date().toISOString(), accounts });
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
  return history.snapshots.length;
}

module.exports = { appendFollowerSnapshot };
