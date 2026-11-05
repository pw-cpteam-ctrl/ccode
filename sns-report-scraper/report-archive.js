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
//
// markFinal이 참이면 밀려나는 파일 이름 끝에 _final을 붙인다 — 스토어 상품 구성이 바뀌어
// "여기까지가 그 구성 기준의 마지막 리포트"가 된 경우다. old/ 폴더에 수십 개가 쌓이면
// 어느 것이 한 시기의 마지막인지 알 길이 없어서, 그 경계를 이름으로 남긴다.
function archiveAndGetPath(dir, baseName, ext, { markFinal = false } = {}) {
  const oldDir = path.join(dir, 'old');
  fs.mkdirSync(oldDir, { recursive: true });

  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  for (const file of files) {
    const full = path.join(dir, file);
    if (file.startsWith(baseName) && file.endsWith(`.${ext}`) && fs.statSync(full).isFile()) {
      // 이미 _final이 붙은 파일에 또 붙이지 않는다(두 번 밀려나는 경우).
      const name = markFinal && !file.includes('_final.')
        ? `${file.slice(0, -(ext.length + 1))}_final.${ext}`
        : file;
      fs.renameSync(full, path.join(oldDir, name));
    }
  }

  return path.join(dir, `${baseName}_${kstStamp()}.${ext}`);
}

/**
 * "이번 리포트부터는 스토어 상품 구성이 바뀐 새 시기인가"를 판단한다.
 *
 * 두 조건을 **둘 다** 만족해야 참이다.
 *   ① 상품 목록이 절반 이상 갈렸을 것
 *   ② 지난 리포트로부터 30일 넘게 지났을 것
 *
 * 왜 둘 다인가 — 메가하우스는 보통 30~35일 주기로 상품이 바뀐다. 날짜만 보면,
 * 교체 직전(30일차)에 재고를 찍으려고 돌린 리포트에까지 _final이 붙어서 경계가 두 번
 * 생긴다. 정작 진짜 경계인 31일차 것과 구분이 안 되므로, 표시의 의미가 사라진다.
 *
 * @param {object|null} marker 지난번 기록 { items: string[], madeAt: ISO 날짜 }
 * @param {string[]} items 이번에 본 상품 이름들
 */
function isNewEra(marker, items, now = new Date(), { changeRatio = 0.5, minDays = 30 } = {}) {
  // 비교할 지난 기록이 없으면(처음 돌리는 경우) 경계가 아니다 — 비교 대상이 없을 뿐이다.
  if (!marker || !Array.isArray(marker.items) || marker.items.length === 0) return false;
  if (!Array.isArray(items) || items.length === 0) return false;

  const before = new Set(marker.items);
  const after = new Set(items);
  // 예전 목록 기준으로 몇 %가 사라졌는지 본다. 새 상품이 추가만 된 경우(예전 것은 그대로)는
  // 세대교체가 아니라 라인업이 늘어난 것이므로 경계로 보지 않는다.
  let gone = 0;
  before.forEach(n => { if (!after.has(n)) gone += 1; });
  const ratio = gone / before.size;

  const days = (now.getTime() - new Date(marker.madeAt).getTime()) / 86400000;
  return ratio >= changeRatio && days >= minDays;
}

/** 지난 리포트 시점의 상품 구성 기록을 읽는다. 없거나 깨졌으면 null(처음인 것과 같게 다룬다). */
function readEraMarker(markerPath) {
  try {
    return JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
  } catch {
    return null;
  }
}

/** 이번 리포트 시점의 상품 구성을 기록해둔다. 다음 번에 이것과 비교한다. */
function writeEraMarker(markerPath, items) {
  try {
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(markerPath, JSON.stringify({ madeAt: new Date().toISOString(), items }, null, 2));
  } catch (e) {
    // 기록이 실패해도 리포트는 이미 멀쩡히 만들어진 뒤다 — 다음 판단만 한 번 못 할 뿐이라
    // 여기서 멈추지 않는다.
    console.warn(`⚠️ 상품 구성 기록을 남기지 못했습니다(리포트는 정상): ${e.message}`);
  }
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

module.exports = { archiveAndGetPath, kstStamp, revealAndCopyPath, revealMessage, isNewEra, readEraMarker, writeEraMarker };
