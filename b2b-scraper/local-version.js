/**
 * "지금 이 폴더에 실제로 깔려 있는 버전"을 파일 내용에서 직접 계산한다.
 *
 * 왜 필요한가 (실제로 겪은 사고):
 *   전에는 .local-version 파일에 적힌 값만 믿었다. 그런데 그 값은 "서버가 알려준 최신
 *   버전"을 그대로 받아 적는 경우가 있었다 — 처음 실행이라 기록이 없을 때 잔소리를
 *   안 하려고 현재 최신값으로 도장을 찍었기 때문이다. 그 결과 7월에 손으로 복사해 넣은
 *   낡은 폴더가 "이미 최신"으로 기록됐고, 두 달 동안 "새 버전이 있습니다" 안내가 한 번도
 *   뜨지 않았다. 팀원은 낡은 도구를 계속 쓰고 있었고 아무도 몰랐다.
 *
 *   적어둔 메모가 아니라 실제 파일을 재면 이런 어긋남이 생길 수 없다. 파일이 낡았으면
 *   계산값이 다르게 나오고, 파일이 아예 없어도 다르게 나온다.
 *
 * 계산 방식은 서버(api/files.js의 versionOf)와 글자 하나까지 같아야 한다 — 다르면
 * 늘 "새 버전 있음"으로 보여서 안내가 양치기 소년이 된다. 그래서 같은 규칙을 쓴다:
 *   이름순 정렬 → 각 파일의 "이름\0내용\0"을 이어붙여 sha256 → 앞 12자.
 *
 * 어떤 파일을 재는지는 서버가 알려준 목록(names)을 그대로 따른다. 이 폴더에만 있는
 * 것들(node_modules, output, package-lock.json 등)을 임의로 포함하면 영원히 값이
 * 달라져서 안내가 멈추지 않는다.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * @param {string} dir   재볼 폴더 (보통 __dirname)
 * @param {string[]} names 서버가 내려보내는 파일 이름 목록
 * @returns {string|null} 12자리 버전. 목록이 비었으면 null(= 비교 불가).
 */
function computeLocalVersion(dir, names) {
  if (!Array.isArray(names) || !names.length) return null;
  const h = crypto.createHash('sha256');
  for (const name of [...names].sort((a, b) => a.localeCompare(b))) {
    // 없는 파일은 빈 내용으로 친다 — 파일이 통째로 빠진 상태도 "다른 버전"으로
    // 잡혀야 한다. 이번 사고에서 빠져 있던 run-pick-date.bat이 바로 이 경우다.
    let content = '';
    try { content = fs.readFileSync(path.join(dir, name), 'utf-8'); } catch { content = ''; }
    h.update(name).update('\0').update(content).update('\0');
  }
  return h.digest('hex').slice(0, 12);
}

module.exports = { computeLocalVersion };
