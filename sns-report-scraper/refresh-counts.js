/**
 * 🔄 이미 수집한 게시물의 '지금 수치'만 다시 읽어서 리포트를 새로 만든다.
 *
 * 왜 만들었나 — 전체 수집(run-megahouse.js)이 오래 걸리는 이유는 숫자를 읽어서가 아니라
 * '어떤 글이 있는지 찾느라' 프로필을 처음부터 조금씩 내리며 매번 기다리기 때문이다.
 * 그런데 한 번 수집하고 나면 글 주소가 이미 기록에 남아 있다(period-cache 폴더).
 * 그러면 찾는 과정을 통째로 건너뛰고 주소를 바로 열어 숫자만 다시 읽으면 된다.
 * 글 하나당 몇 초라 전체 수집보다 훨씬 빠르다.
 *
 * 무엇이 안 되는지도 분명히 해둔다 — **그 사이 새로 올라온 글은 안 잡힌다.**
 * 이미 아는 주소만 다시 보는 방식이라 그렇다. 새 글까지 챙기려면 전체 수집을 돌려야 한다.
 * ("이벤트 끝나고 최종 수치 확인"처럼 글 목록은 그대로고 숫자만 궁금할 때 쓰라는 뜻이다.)
 *
 * 리포트에 박힌 X·인스타 임베드를 펼쳐 읽는 방법은 쓸 수 없다. 임베드는 그 회사 사이트를
 * 액자처럼 끼워 넣은 것이라, 눈에는 최신 숫자가 보여도 우리 코드가 그 안을 읽지 못하게
 * 브라우저가 막는다(다른 사이트 내용을 훔쳐보지 못하게 하는 규칙). 그래서 주소를 직접 연다.
 *
 * 사용법:
 *   node refresh-counts.js 2026-10-28 2026-11-03           — 그 기간 글의 수치를 다시 읽음
 *   node refresh-counts.js 2026-10-28 2026-11-03 stock     — 재고 탭까지 같이
 *   node refresh-counts.js 2026-10-28 2026-11-03 show      — 브라우저 창을 띄운 채로 진행
 *
 * 원래 기록은 덮어쓰지 않는다. 새로 읽은 값은 별도 파일로 쌓이고, 리포트는 항상 가장
 * 나중에 읽은 값을 쓴다 — 잘못 돌렸어도 예전 기록은 그대로 남아 있다.
 */
const fs = require('fs');
const path = require('path');
const { collectPostsByLink } = require('./collect-by-link');
const { loadAllCaches, mergeCollections, buildAndSaveReport } = require('./merge-report');
const { prepareBrand, parseBrandArg } = require('./brand-config');
const { kstStamp } = require('./report-archive');

/** 글의 주소. 트위터 수집본은 link, 인스타 수집본은 url에 들어있어서 둘 다 본다. */
function postUrl(post) {
  return post.url || post.link || null;
}

/**
 * '1,234'처럼 쉼표가 섞인 글자도 숫자로. 못 읽은 값(null·빈값)은 숫자 0이 아니라 null로 둔다.
 * 0으로 바꿔버리면 "못 읽었다"와 "진짜 0이다"가 섞여서, 증감 계산이 거짓말을 하게 된다.
 */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

const FIELDS = [
  { key: 'likes', label: '좋아요' },
  { key: 'retweets', label: '리트윗' },
  { key: 'quotes', label: '인용' },
  { key: 'comments', label: '댓글' },
  { key: 'views', label: '조회' },
];

/** +262 / -3 / 0 을 보기 좋게. 변화가 없으면 조용히 빈칸(바뀐 것만 눈에 띄게). */
function deltaText(before, after) {
  if (before === null || after === null) return '';
  const d = after - before;
  if (d === 0) return '';
  return d > 0 ? `+${d.toLocaleString('ko-KR')}` : d.toLocaleString('ko-KR');
}

/**
 * 새로 읽은 수치를 기존 글에 덮어쓴다.
 * 못 읽은 항목은 예전 값을 그대로 둔다 — 한 번 못 읽었다고 멀쩡하던 숫자를 지우면
 * 리포트가 갑자기 비어 보이고, 그게 수집 실패인지 진짜 0인지 알 수 없게 된다.
 */
function applyFresh(post, fresh) {
  const changes = [];
  for (const f of FIELDS) {
    const after = num(fresh[f.key]);
    if (after === null) continue;
    const before = num(post[f.key]);
    const t = deltaText(before, after);
    if (t) changes.push(`${f.label} ${before.toLocaleString('ko-KR')}→${after.toLocaleString('ko-KR')} (${t})`);
    post[f.key] = after;
  }
  return changes;
}

async function main() {
  const { brandKey, rest } = parseBrandArg(process.argv.slice(2));
  const brand = prepareBrand(brandKey);
  console.log(`🏷️  브랜드: ${brand.label} (${brand.key})`);

  const dates = rest.filter(a => /^\d{4}-\d{2}-\d{2}$/.test(a)).sort();
  if (dates.length !== 2) {
    console.error('❌ 사용법: node refresh-counts.js <시작일> <종료일>');
    console.error('   예:    node refresh-counts.js 2026-10-28 2026-11-03');
    console.error('   어떤 기간이 쌓여 있는지 보려면: node merge-report.js --list');
    process.exit(1);
  }
  const [startDate, endDate] = dates;

  const caches = loadAllCaches(brand);
  if (caches.length === 0) {
    console.error(`❌ 다시 읽을 기록이 없습니다 — ${brand.paths.periodCacheDir} 가 비어 있습니다.`);
    console.error('   이 기능은 "이미 수집한 글"의 숫자만 다시 보는 것이라, 먼저 한 번은 수집해야 합니다:');
    console.error(`   node run-megahouse.js ${startDate} ${endDate}`);
    process.exit(1);
  }

  const ownMerged = mergeCollections(caches, 'own', startDate, endDate);
  const bhMerged = mergeCollections(caches, 'competitors', startDate, endDate);
  const all = [...ownMerged.collections, ...bhMerged.collections];

  // 주소가 없는 글은 다시 읽을 방법이 없다(수동으로 넣은 글 등). 빼지는 않고 예전 값 그대로 둔다.
  const targets = [];
  let noUrl = 0;
  for (const col of all) {
    for (const post of col.posts) {
      const url = postUrl(post);
      if (!url) { noUrl += 1; continue; }
      targets.push({ url, post, account: col.account, platform: col.platform });
    }
  }

  if (targets.length === 0) {
    console.error(`\n❌ ${startDate} ~ ${endDate} 기간에 다시 읽을 글이 없습니다.`);
    console.error('   그 기간은 아직 수집한 적이 없는 것 같습니다 — 쌓여 있는 기간: node merge-report.js --list');
    process.exit(1);
  }

  console.log(`🔄 ${startDate} ~ ${endDate} — 이미 수집한 글 ${targets.length}건의 지금 수치를 다시 읽습니다.`);
  console.log('   (프로필을 훑지 않고 주소를 바로 여는 방식이라 전체 수집보다 훨씬 빠릅니다)');
  if (noUrl > 0) console.log(`   ⓘ 주소가 없어 다시 읽을 수 없는 글 ${noUrl}건은 예전 값을 그대로 씁니다(수동으로 넣은 글 등).`);

  const headless = !rest.includes('show');
  const results = await collectPostsByLink({
    urls: targets.map(t => t.url),
    headless,
    debugDir: brand.paths.htmlDir,
  });

  let updated = 0, failed = 0;
  const lines = [];
  results.forEach((r, i) => {
    const t = targets[i];
    if (!r || !r.ok) {
      failed += 1;
      console.warn(`   ❌ 못 읽음: ${t.url} — ${(r && r.error) || '알 수 없는 이유'} (예전 값을 그대로 둡니다)`);
      return;
    }
    const changes = applyFresh(t.post, r);
    updated += 1;
    if (changes.length) lines.push(`   · ${t.platform} ${t.url}\n     ${changes.join(' · ')}`);
  });

  console.log(`\n✅ 다시 읽기 완료: 성공 ${updated}건 / 실패 ${failed}건`);
  if (lines.length) {
    console.log(`\n📈 지난번보다 달라진 글 ${lines.length}건:`);
    lines.forEach(l => console.log(l));
  } else if (updated > 0) {
    console.log('   (숫자가 달라진 글은 없습니다 — 지난번 수집 이후 변화가 없었다는 뜻입니다)');
  }

  // 새로 읽은 값을 기록으로 남긴다. 원래 기간 파일을 덮어쓰지 않고 옆에 따로 쌓는 이유는,
  // 잘못 읽은 값(예: 로그인이 풀린 채로 돌린 경우)이 예전 기록까지 망치면 되돌릴 방법이
  // 없기 때문이다. 리포트를 만들 때는 파일 이름 순서상 이 파일이 뒤에 와서 최신 값이 쓰인다.
  const savePath = path.join(brand.paths.periodCacheDir, `${startDate}_${endDate}__refreshed-${kstStamp()}.json`);
  fs.mkdirSync(brand.paths.periodCacheDir, { recursive: true });
  fs.writeFileSync(savePath, JSON.stringify({
    startDate, endDate,
    collectedAt: new Date().toISOString(),
    refreshedFrom: '이미 수집한 글의 수치만 다시 읽음(refresh-counts.js) — 새로 올라온 글은 포함되지 않음',
    own: ownMerged.collections,
    competitors: bhMerged.collections,
  }, null, 2));
  console.log(`💾 새로 읽은 수치를 기록에 남겼습니다: ${path.relative(__dirname, savePath)} (예전 기록은 그대로 남아 있습니다)`);

  await buildAndSaveReport(brand, {
    startDate, endDate,
    ownCollections: ownMerged.collections,
    bhCollections: bhMerged.collections,
    rest,
  });

  if (failed > 0) {
    console.log(`\nⓘ ${failed}건은 못 읽어서 예전 값이 그대로 들어갔습니다 — 그 글들만 수치가 지금과 다를 수 있습니다.`);
  }
  console.log('ⓘ 이 리포트에는 지난 수집 이후 새로 올라온 글은 들어있지 않습니다. 새 글까지 보려면:');
  console.log(`   node run-megahouse.js ${startDate} ${endDate}`);
}

if (require.main === module) {
  main().catch(err => {
    console.error('❌ 실행 중 오류:', err);
    process.exit(1);
  });
}

module.exports = { applyFresh, num, deltaText, postUrl };
