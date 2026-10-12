/**
 * 여러 번에 나눠 수집한 기간들을 합쳐서 리포트 한 장으로 만든다. 재수집 없음.
 *
 * 왜 필요했나 — 리포트가 재활용하는 캐시(_last-collection.json)에는 '가장 최근 수집' 한 번만
 * 남는다. 매번 덮어쓴다. 그래서 하루치만 수집한 직후에 리포트를 다시 만들면 그 하루치만
 * 나오고, 짝이 될 경쟁사 게시물이 그날 없으면 매칭 0건에 합계도 전부 0이 된다
 * (실제로 그래서 "총 리트윗이 사라졌다"는 신고가 있었다).
 *
 * 다행히 수집할 때마다 기간별로 파일을 하나씩 따로 쌓아둔다(period-cache 폴더). 그걸 합치면
 * 다시 긁지 않고도 여러 기간을 한 리포트로 볼 수 있다. 이 스크립트가 하는 일이 그거다.
 *
 * 사용법:
 *   node merge-report.js 2026-10-01 2026-10-12          — 그 기간에 걸친 캐시를 전부 합침
 *   node merge-report.js 2026-10-01 2026-10-12 stock=ratio
 *   node merge-report.js --list                          — 어떤 기간들이 쌓여 있는지만 보여줌
 *
 * 원본 캐시 파일은 건드리지 않는다. 합치는 건 이번 리포트를 만드는 동안 메모리 안에서만
 * 일어나므로, 잘못 합쳤어도 다시 돌리면 그만이고 쌓아둔 기록은 그대로 남는다.
 */
const fs = require('fs');
const path = require('path');
const { buildComparisonReport, applyManualPosts, filterCollectionsByKeyword } = require('./aggregate');
const { saveReportToExcel } = require('./excel');
const { saveHtmlReport } = require('./html-report');
const { buildStockComparison } = require('./stock-report');
const { archiveAndGetPath } = require('./report-archive');
const { prepareBrand, parseBrandArg } = require('./brand-config');

/** 게시 시각(ISO)을 한국 날짜(YYYY-MM-DD)로. 서버 시간대에 안 휘둘리게 시간대를 직접 지정한다. */
function kstDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

/** period-cache 폴더에 쌓인 기간 파일들을 읽어서 최신순으로. */
function loadAllCaches(brand) {
  const dir = brand.paths.periodCacheDir;
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()
    : [];
  const caches = files.map(f => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
      return { file: f, data };
    } catch (e) {
      console.warn(`⚠️ ${f} 를 못 읽어서 건너뜀: ${e.message}`);
      return null;
    }
  }).filter(Boolean);

  // 가장 최근 수집(_last-collection.json)도 같이 본다. 보통은 period-cache에도 같은 내용이
  // 있지만, 예전 버전으로 수집한 기록이라면 거기에만 있을 수 있어서 빠뜨리지 않으려는 것이다.
  // 어차피 아래에서 주소로 중복을 걸러내므로 두 번 들어가도 두 번 세지 않는다.
  if (fs.existsSync(brand.paths.cache)) {
    try {
      caches.push({ file: '(가장 최근 수집)', data: JSON.parse(fs.readFileSync(brand.paths.cache, 'utf-8')) });
    } catch { /* 깨진 파일이면 그냥 건너뛴다 */ }
  }
  return caches;
}

/**
 * 여러 캐시의 게시물을 계정별로 합친다.
 *
 * 같은 게시물이 여러 캐시에 겹쳐 들어있는 일이 흔하다(기간을 겹쳐서 수집했거나, 같은 기간을
 * 다시 수집했거나). 주소가 같으면 같은 글로 보고 한 번만 센다 — 안 그러면 좋아요가 두 배로
 * 부풀어서 리포트 전체가 거짓말이 된다.
 *
 * 겹칠 때는 '나중에 수집한 것'을 쓴다. 지표는 시간이 갈수록 늘어나므로 나중 값이 더 최신이다.
 */
function mergeCollections(caches, side, startDate, endDate) {
  const byAccount = new Map();
  let kept = 0, skippedByDate = 0, duplicated = 0, noDate = 0;

  for (const { data } of caches) {
    for (const col of data[side] || []) {
      const key = `${col.platform}|${col.account}`;
      if (!byAccount.has(key)) {
        byAccount.set(key, { platform: col.platform, account: col.account, posts: new Map() });
      }
      const bucket = byAccount.get(key).posts;
      for (const post of col.posts || []) {
        const day = kstDate(post.datetime);
        if (day === null) {
          // 날짜를 모르는 글은 버리지 않는다 — 수동으로 넣은 글 등은 날짜가 빌 수 있고,
          // 조용히 빼버리면 "왜 그 글이 없지"를 아무도 모르게 된다.
          noDate += 1;
        } else if (day < startDate || day > endDate) {
          skippedByDate += 1;
          continue;
        }
        const id = post.url || post.link || `${col.account}|${post.datetime}|${(post.text || post.caption || '').slice(0, 40)}`;
        if (bucket.has(id)) duplicated += 1; else kept += 1;
        bucket.set(id, post);   // 나중에 읽은 것(= 나중에 수집한 것)으로 덮어쓴다
      }
    }
  }

  const collections = [...byAccount.values()]
    .map(c => ({ platform: c.platform, account: c.account, posts: [...c.posts.values()] }))
    .filter(c => c.posts.length > 0);

  return { collections, stats: { kept, skippedByDate, duplicated, noDate } };
}

function printList(brand, caches) {
  console.log(`\n쌓여 있는 기간 캐시 (${brand.paths.periodCacheDir}):`);
  if (caches.length === 0) {
    console.log('  (없음 — 아직 한 번도 수집하지 않았거나 예전 버전으로만 수집했습니다)');
    return;
  }
  caches.forEach(({ file, data }) => {
    const n = ['own', 'competitors']
      .reduce((s, k) => s + (data[k] || []).reduce((t, c) => t + (c.posts || []).length, 0), 0);
    console.log(`  ${file.padEnd(34)} ${data.startDate}~${data.endDate}  게시물 ${n}건  (수집 ${String(data.collectedAt).slice(0, 16).replace('T', ' ')})`);
  });
}

async function main() {
  const { brandKey, rest } = parseBrandArg(process.argv.slice(2));
  const brand = prepareBrand(brandKey);
  console.log(`🏷️  브랜드: ${brand.label} (${brand.key})`);

  const caches = loadAllCaches(brand);
  if (rest.includes('--list') || rest.includes('list')) {
    printList(brand, caches);
    return;
  }

  const dates = rest.filter(a => /^\d{4}-\d{2}-\d{2}$/.test(a)).sort();
  if (dates.length !== 2) {
    console.error('❌ 사용법: node merge-report.js <시작일> <종료일>');
    console.error('   예:    node merge-report.js 2026-10-01 2026-10-12');
    console.error('   어떤 기간이 쌓여 있는지 보려면: node merge-report.js --list');
    printList(brand, caches);
    process.exit(1);
  }
  const [startDate, endDate] = dates;

  if (caches.length === 0) {
    console.error(`❌ 합칠 캐시가 없습니다 — ${brand.paths.periodCacheDir} 가 비어 있습니다.`);
    process.exit(1);
  }
  console.log(`📂 캐시 ${caches.length}개를 읽어서 ${startDate} ~ ${endDate} 로 합칩니다.`);
  caches.forEach(({ file, data }) => console.log(`   · ${file} (${data.startDate}~${data.endDate})`));

  const ownMerged = mergeCollections(caches, 'own', startDate, endDate);
  const bhMerged = mergeCollections(caches, 'competitors', startDate, endDate);
  const sum = s => s.kept;
  console.log(`\n🔗 합친 결과: 당사 ${sum(ownMerged.stats)}건 · 경쟁사 ${sum(bhMerged.stats)}건`);
  console.log(`   (기간 밖이라 뺀 글 ${ownMerged.stats.skippedByDate + bhMerged.stats.skippedByDate}건 · ` +
    `여러 캐시에 겹쳐 있어 한 번만 센 글 ${ownMerged.stats.duplicated + bhMerged.stats.duplicated}건 · ` +
    `날짜를 모르지만 그대로 넣은 글 ${ownMerged.stats.noDate + bhMerged.stats.noDate}건)`);

  if (sum(ownMerged.stats) === 0 && sum(bhMerged.stats) === 0) {
    console.error('\n❌ 그 기간에 해당하는 게시물이 캐시에 하나도 없습니다 — 그 기간은 아직 수집한 적이 없는 것 같습니다.');
    console.error('   쌓여 있는 기간을 확인해보세요: node merge-report.js --list');
    process.exit(1);
  }

  const readJson = p => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : {});
  const manualMatches = readJson(brand.paths.manualMatches);
  const ignorePosts = readJson(brand.paths.ignorePosts);
  const manualPosts = readJson(brand.paths.manualPosts);

  const { own, competitors } = applyManualPosts(ownMerged.collections, bhMerged.collections, manualPosts);
  const keywordArg = rest.find(a => /^--?keyword=/.test(a) || /^keyword=/.test(a));
  const keyword = keywordArg ? keywordArg.slice(keywordArg.indexOf('=') + 1).trim() : '';
  const ownFiltered = filterCollectionsByKeyword(own, keyword);
  const bhFiltered = filterCollectionsByKeyword(competitors, keyword);

  const report = buildComparisonReport({
    startDate, endDate,
    own: ownFiltered.collections,
    competitors: bhFiltered.collections,
    manualMatches, ignorePosts,
  });

  const sheetName = await saveReportToExcel(report, brand.paths.excel);
  console.log(`✅ 엑셀 저장 완료: ${brand.paths.excel} (시트: ${sheetName})`);

  const stockArg = rest.find(a => /^--?stock=(none|ratio)$/.test(a) || /^stock=(none|ratio)$/.test(a));
  const stockMode = stockArg ? stockArg.split('=')[1] : brand.defaultStockMode;
  const stockHistory = stockMode !== 'none' && fs.existsSync(brand.paths.stockHistory)
    ? JSON.parse(fs.readFileSync(brand.paths.stockHistory, 'utf-8'))
    : null;
  const stockComparison = stockHistory ? buildStockComparison(stockHistory) : null;

  // 재고가 리포트에 들어갔는지, 안 들어갔으면 왜인지 화면에 적는다.
  // #stock을 쳤는데 아무 반응이 없어 한참 헤맨 적이 있다. 그때 파일에는 재고 섹션 자체가
  // 없었는데(그래서 보여줄 게 없었는데), 실행 화면만 봐서는 그걸 알 길이 없었다.
  if (stockComparison && stockMode !== 'none') {
    console.log(`📦 재고 포함 — 리포트 주소 끝에 #stock 을 붙이면 재고 탭이 열립니다(스냅샷 ${stockComparison.snapshotCount}개).`);
  } else if (stockMode === 'none') {
    console.log('📦 재고 미포함(설정이 none) — 넣으려면 끝에 stock=ratio 를 붙여서 다시 돌리세요.');
  } else {
    console.log(`📦 재고 미포함 — 재고 기록이 없습니다(${path.relative(__dirname, brand.paths.stockHistory)}). 먼저 node naver-stock-snapshot.js 를 돌리세요.`);
  }
  const followerHistory = fs.existsSync(brand.paths.followerHistory)
    ? JSON.parse(fs.readFileSync(brand.paths.followerHistory, 'utf-8'))
    : null;

  const htmlOutputPath = archiveAndGetPath(brand.paths.htmlDir, brand.paths.htmlBaseName, 'html');
  saveHtmlReport(report, htmlOutputPath, stockComparison, {
    brandLabel: brand.label, stockMode, followerHistory,
    keyword, keywordExcluded: { pw: ownFiltered.excluded, bh: bhFiltered.excluded },
  });
  console.log(`✅ HTML 저장 완료: ${htmlOutputPath}`);
}

main().catch(err => {
  console.error('❌ 실행 중 오류:', err);
  process.exit(1);
});
