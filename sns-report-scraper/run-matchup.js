/**
 * ⚔️ 게시글 맞대결 — 링크만 받아서 비교 리포트 하나를 만드는 실행 스크립트.
 *
 * 기간 수집(run-megahouse.js)과 달리 프로필을 스크롤하지 않고 넣어준 주소만 직접 열기 때문에,
 * 몇 주 전 글이어도 링크 개수만큼만 걸림. 날짜 입력도 없음(양쪽 게시일이 다른 게 정상).
 *
 * 사용법:
 *   node run-matchup.js input=matchup.json [brand=goodsmile] [show]
 *
 * input JSON 형식:
 *   {
 *     "title": "이 맞대결의 이름",
 *     "pairs": [ { "label": "쌍마다 다른 이름(생략 가능)", "pw": "https://x.com/…", "bh": "https://x.com/…" } ]
 *   }
 *   label은 없어도 됨(없으면 title을 씀). 한쪽만 있어도 되고(경쟁사 글이 아직 없을 때),
 *   pairs를 여러 개 넣으면 한 리포트에 여러 맞대결이 순서대로 들어감.
 *
 * show를 붙이면 브라우저 창을 띄운 채로 진행 — 세션이 풀렸는지 눈으로 확인할 때만 사용.
 */
const fs = require('fs');
const path = require('path');
const { collectPostsByLink } = require('./collect-by-link');
const { saveMatchupReport } = require('./matchup-report');
const { archiveAndGetPath } = require('./report-archive');
const { prepareBrand, parseBrandArg } = require('./brand-config');


/**
 * 링크 목록 파일을 읽는다. 문법이 틀렸을 때 "어디가 왜 틀렸는지"까지 알려준다.
 *
 * 왜 따로 만들었나 — 쉼표 하나 빠졌을 때 나오는 기본 오류가
 *   SyntaxError: Expected ',' or ']' after array element in JSON at position 330 (line 7 column 5)
 * 뒤에 호출 흔적 열 줄이 딸려 나오는 모양이라, 정작 "7번째 줄 끝에 쉼표를 찍으면 된다"는 걸
 * 읽어내기 어렵다. 실제로 이 오류를 받고 파일명이 잘못된 줄 알았던 일이 있었다.
 * 파일을 못 찾은 것과 내용이 틀린 것부터 분명히 갈라준다.
 */
function readInputJson(inputPath) {
  const text = fs.readFileSync(inputPath, 'utf-8');

  // 메모장에서 한글 입력 상태로 치면 따옴표가 " " ' ' 같은 모양으로 바뀌는데, 눈으로는
  // 거의 구분이 안 되면서 JSON은 통째로 깨진다. 흔한 사고라 먼저 짚어준다.
  const curly = text.match(/[“”‘’]/);
  if (curly) {
    const upto = text.slice(0, text.indexOf(curly[0]));
    console.error(`❌ 파일 안의 따옴표 모양이 잘못됐습니다 (${upto.split('\n').length}번째 줄의 ${curly[0]}).`);
    console.error('   한글 입력 상태로 친 따옴표라 생긴 문제입니다 — 곧은 따옴표(")로 바꿔주세요.');
    process.exit(1);
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    const at = /at position (\d+)/.exec(err.message);
    const lineNo = at ? text.slice(0, Number(at[1])).split('\n').length : null;
    console.error(`❌ 파일은 찾았지만 안의 내용이 JSON 문법에 안 맞습니다: ${path.basename(inputPath)}`);
    if (lineNo) {
      const lines = text.split('\n');
      console.error(`   ${lineNo}번째 줄 근처입니다:`);
      for (let i = Math.max(0, lineNo - 2); i < Math.min(lines.length, lineNo + 1); i += 1) {
        console.error(`   ${String(i + 1).padStart(3)} | ${lines[i]}`);
      }
    }
    console.error('   가장 흔한 원인은 줄 끝 쉼표입니다 — 각 줄 끝에 쉼표를 찍되, 마지막 한 줄만 안 찍습니다.');
    console.error('   올바른 모양:');
    console.error('     {');
    console.error('       "title": "당사 이벤트 추이",');
    console.error('       "pairs": [');
    console.error('         { "label": "04-03 고죠 구매인증", "pw": "https://x.com/..." },');
    console.error('         { "label": "04-30 5월 알림받기", "pw": "https://x.com/..." }');
    console.error('       ]');
    console.error('     }');
    process.exit(1);
  }
}

async function main() {
  const { brandKey, rest } = parseBrandArg(process.argv.slice(2));
  const brand = prepareBrand(brandKey);
  const inputArg = rest.find(a => /^--?input=/.test(a) || /^input=/.test(a));
  const headless = !rest.includes('show');
  if (!inputArg) {
    console.error('❌ 사용법: node run-matchup.js input=matchup.json [brand=goodsmile] [show]');
    process.exit(1);
  }

  const inputPath = path.resolve(inputArg.slice(inputArg.indexOf('=') + 1));
  if (!fs.existsSync(inputPath)) {
    console.error(`❌ 입력 파일이 없음: ${inputPath}`);
    process.exit(1);
  }
  const input = readInputJson(inputPath);
  const title = (input.title || '').trim();
  const pairsIn = Array.isArray(input.pairs) ? input.pairs : [];
  if (pairsIn.length === 0) {
    console.error('❌ 비교할 링크가 없음 — pairs에 최소 한 쌍을 넣어주세요.');
    process.exit(1);
  }

  console.log(`🏷️  브랜드: ${brand.label} (${brand.key})`);
  console.log(`⚔️  맞대결: ${title || '(제목 없음)'} — ${pairsIn.length}쌍`);

  // 한 브라우저로 전부 읽어야 페이지를 매번 새로 띄우지 않아 빠름 — 그래서 링크를 먼저
  // 한 줄로 펴서 한 번에 넘기고, 결과를 원래 쌍 구조로 다시 접음.
  const flat = [];
  const slots = pairsIn.map(p => {
    const slot = { label: (p.label || title || '').trim(), pwIndex: -1, bhIndex: -1 };
    if (p.pw && String(p.pw).trim()) { slot.pwIndex = flat.length; flat.push(String(p.pw).trim()); }
    if (p.bh && String(p.bh).trim()) { slot.bhIndex = flat.length; flat.push(String(p.bh).trim()); }
    return slot;
  });

  const outDir = path.join(brand.paths.htmlDir, 'matchup');
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`🔗 게시물 ${flat.length}건 읽는 중… (프로필 스크롤 없이 주소만 직접 여는 방식)`);
  // debugDir: 인용 수처럼 못 읽은 항목이 생기면 그 페이지를 여기에 파일로 남겨서,
  // 다음에 추측이 아니라 실제 구조를 보고 고칠 수 있게 함.
  const results = await collectPostsByLink({ urls: flat, headless, debugDir: outDir });

  const okCount = results.filter(r => r.ok).length;
  console.log(`✅ 읽기 완료: 성공 ${okCount}건 / 실패 ${results.length - okCount}건`);
  results.filter(r => !r.ok).forEach(r => console.log(`   ❌ ${r.url} — ${r.error}`));

  const pairs = slots.map(s => ({
    label: s.label,
    pw: s.pwIndex >= 0 ? results[s.pwIndex] : null,
    bh: s.bhIndex >= 0 ? results[s.bhIndex] : null,
  }));

  const outPath = archiveAndGetPath(outDir, 'matchup', 'html');
  saveMatchupReport({ title, brandLabel: brand.label, collectedAt: new Date().toISOString(), pairs }, outPath);
  console.log(`✅ HTML 저장 완료: ${outPath}`);

  // 다음에 링크를 몇 개 더 붙여서 다시 볼 수 있게 입력을 그대로 남겨둠 — 리포트만 보면
  // 어떤 주소를 넣었는지 다시 찾아야 해서.
  fs.writeFileSync(path.join(outDir, '_last-input.json'), JSON.stringify(input, null, 2));
}

main().catch(err => {
  console.error('❌ 실행 중 오류:', err);
  process.exit(1);
});
