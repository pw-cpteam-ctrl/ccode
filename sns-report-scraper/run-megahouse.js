/**
 * 전체 실행 스크립트: 계정별 수집(twitter.js/instagram.js) → 취합(aggregate.js) → 엑셀 저장(excel.js)
 *
 * 파일명이 run-megahouse.js인 이유: 항상 메가하우스 자사(PW)/경쟁사(BH) 두 계정을 고정으로
 * 비교하는 스크립트라서, 임의의 계정 하나만 단독으로 보는 collect-account.js와 헷갈리지
 * 않게 이름 자체에 용도를 명시함(예전엔 run.js였음).
 *
 * twitter.js, instagram.js는 실제 계정(megahousestore/megahouse_store)으로 검증 완료
 * (PLAN.md 참고). 아래 CONFIG는 원칙적으로 운용하는 자사/경쟁사 계정 고정 세팅 —
 * 예외적인 계정을 수집해야 할 땐 이 CONFIG를 건드리지 말고 그때그때 따로 요청.
 *
 * 경쟁사 계정도 sessionFile은 자사와 동일한 세션 파일을 씀 — 경쟁사 로그인이 아니라,
 * "내 계정으로 로그인한 상태에서 경쟁사의 공개 게시물을 조회"하는 방식이라서 정상임.
 *
 * 기간은 커맨드라인에서 항상 명시적으로 지정해야 함(필수) — "today" 또는 YYYY-MM-DD 두 개
 * (시작일 종료일). startDate/endDate 둘 다 포함(그 날짜 23:59:59 KST까지) —
 * twitter.js/instagram.js의 실제 필터링 기준(`d >= rangeStart && d <= rangeEnd`)이 그렇게
 * 돼 있음. (예전엔 이 주석에 "endDate 미포함, 하루만 보려면 다음날을 넣으라"고 잘못 적혀
 * 있었음 — 실제 코드와 반대였던 문서 버그. 그 설명대로 다음날 날짜까지 넣어서 돌린 적 있으면
 * 의도한 하루가 아니라 이틀치가 수집됐을 수 있음.)
 *
 * 예전엔 날짜를 안 주면 CONFIG.startDate/endDate 기본값(옛날에 테스트하던 기간)으로 조용히
 * 넘어갔는데, 이게 사용자가 날짜 지정을 깜빡하고 실행했을 때 의도하지 않은 옛날 기간을
 * 통째로 수집해버리는 사고로 이어져서, 날짜를 아예 안 주면 에러 내고 종료하도록 바꿈 —
 * 날짜 지정은 이제 선택이 아니라 필수.
 *
 * 오늘 하루만 보고 싶으면 날짜 두 개 대신 "today"라고만 쓰면 됨(자동으로 오늘 KST 날짜로
 * 시작=종료 지정) — 서버가 어느 시간대에서 돌든 상관없이 한국 시간 기준 오늘로 계산됨.
 *
 * 사용법: node run-megahouse.js today                           — 트위터+인스타, 오늘 하루(KST)
 *        node run-megahouse.js twitter today                   — 트위터만, 오늘 하루(KST)
 *        node run-megahouse.js 2026-07-10 2026-07-10            — 트위터+인스타, 7/10 하루
 *        node run-megahouse.js twitter 2026-07-10 2026-07-11    — 트위터만, 7/10~7/11 이틀
 * 한쪽만 수집해도 캐시(cachePath)에 남아있던 다른 플랫폼 데이터는 보존됨(안 지워짐).
 *
 * 기간 사이에 공백(게시글 없는 날)이 있어서 여러 기간을 따로따로 수집해야 하는 경우엔,
 * 그 기간들로 이 스크립트를 각각 실행해두면(예: 6/10~13, 6/18~22, 6/27~30 각각 실행) 자동으로
 * reports/period-cache/에 기간별로 남고, compare-periods.js로 재수집 없이 나란히 비교 가능.
 *
 * 이 스크립트를 실행할 때마다 재고 스냅샷(naver-stock-snapshot.js)도 자동으로 하나씩 같이
 * 찍어서 reports/_stock-history.json에 쌓임 — SNS와 무관하게 매번 찍히므로, 같은 날 여러 번
 * 돌리면 그만큼 스냅샷도 쌓임(의도된 동작). rebuild-report.js는 캐시만으로 빠르게 재생성하는
 * 용도라 브라우저를 안 켜서, 여기엔 스냅샷 자동 촬영이 없음(그쪽은 기존 스냅샷만 그대로 사용).
 */
const fs = require('fs');
const path = require('path');
const { collectTwitter } = require('./twitter');
const { collectInstagram } = require('./instagram');
const { buildComparisonReport, applyManualPosts } = require('./aggregate');
const { saveReportToExcel } = require('./excel');
const { saveHtmlReport } = require('./html-report');
const { buildStockComparison } = require('./stock-report');
const { captureSnapshot, HISTORY_PATH: STOCK_HISTORY_PATH } = require('./naver-stock-snapshot');
const { archiveAndGetPath } = require('./report-archive');

const CONFIG = {
  // startDate/endDate는 기본값 없이 커맨드라인에서 항상 받아야 함(main()에서 검증) — 아래
  // main()이 cliDates 파싱 후 채워 넣음.
  outputPath: './reports/sns-report.xlsx',
  // HTML은 매번 새로 만들 때 파일명에 생성 시각을 붙이고, 예전 파일은 reports/old/로 자동
  // 이동함(report-archive.js) — 과거 데이터 보존은 엑셀(outputPath, 시트 누적)이 따로 담당.
  htmlOutputDir: './reports',
  htmlOutputBaseName: 'sns-report',
  // 수집한 원본 게시물을 여기에 캐시해둠 — 리포트 포맷만 고칠 땐 재수집(몇 분) 없이
  // rebuild-report.js로 이 캐시만 다시 읽어서 몇 초 안에 엑셀만 새로 뽑을 수 있음.
  cachePath: './reports/_last-collection.json',
  // compare-periods.js가 읽는 기간별 원본 캐시 저장 위치 (아래 main()에서 매 실행마다
  // "시작일_종료일.json" 파일로 하나씩 남김 — cachePath와 달리 덮어써지지 않음)
  periodCacheDir: './reports/period-cache',
  // 자동 매칭이 놓친 게시물을 수동으로 짝지어주는 목록. "매칭 안 됨" 목록에서 번호(PW #n,
  // BH #n)로 지정해서 { pw: [링크], bh: [링크], label: "표시할 이름" } 형태로 추가하면 됨.
  manualMatchesPath: './manual-matches.json',
  // 상품이 아닌 공지/이벤트/쿠폰 게시물 — "매칭 안 됨" 목록에 안 보이게 걸러내지만, 계정
  // 총계(팔로워/게시물 지표)에는 그대로 포함됨. { twitter: {pw:[], bh:[링크,...]}, ... } 형태.
  ignorePostsPath: './ignore-posts.json',
  // 스크래퍼가 놓친 게시물을 리포트의 "붙여넣기로 게시물 추가" 기능으로 저장해둔 파일.
  // { twitter: { pw: [게시물 객체...], bh: [...] }, instagram: {...} } 형태 — 있으면 실제
  // 수집분에 "(수동 추가)" 계정으로 합쳐진 뒤 평소처럼 자동 매칭이 다시 돌아감.
  manualPostsPath: './manual-posts.json',

  own: [
    { platform: 'twitter', account: 'megahousestore', sessionFile: './x-session.json' },
    { platform: 'instagram', account: 'megahouse_store', sessionFile: './instagram-session.json' },
  ],
  competitors: [
    { platform: 'twitter', account: 'megahouse_BH', sessionFile: './x-session.json' },
    { platform: 'instagram', account: 'megahouse_korea_dt_bh', sessionFile: './instagram-session.json' },
  ],
};

async function collectAll(accounts) {
  const collections = [];
  for (const acc of accounts) {
    const collector = acc.platform === 'twitter' ? collectTwitter : collectInstagram;
    const posts = await collector({
      account: acc.account,
      sessionFile: acc.sessionFile,
      startDate: CONFIG.startDate,
      endDate: CONFIG.endDate,
      headless: acc.headless ?? false,
    });
    collections.push({ platform: acc.platform, account: acc.account, posts });
  }
  return collections;
}

// 서버가 어느 시간대에서 돌든(UTC 컨테이너 등) 상관없이 "오늘"을 항상 한국 시간(KST)
// 기준으로 계산 — new Date()에 수동으로 +9시간 더하는 방식은 서버 시간대에 따라 날짜
// 경계 계산이 꼬일 수 있어서, Intl.DateTimeFormat에 timeZone을 직접 지정하는 방식을 씀.
function todayKst() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function main() {
  const args = process.argv.slice(2);
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  let platformFilter;
  const cliDates = [];
  for (const arg of args) {
    if (arg === 'twitter' || arg === 'instagram') platformFilter = arg;
    else if (arg === 'today') {
      if (cliDates.length > 0) {
        console.error('❌ "today"는 다른 날짜 인자와 같이 못 씀 (단독으로: node run-megahouse.js today)');
        process.exit(1);
      }
      const t = todayKst();
      cliDates.push(t, t);
    } else if (DATE_RE.test(arg)) {
      if (cliDates.length >= 2) {
        console.error('❌ 날짜는 시작일/종료일 2개까지만 줄 수 있음');
        process.exit(1);
      }
      cliDates.push(arg);
    } else {
      console.error(`❌ 사용법: node run-megahouse.js [twitter|instagram] [today | 시작일 종료일 (YYYY-MM-DD YYYY-MM-DD)]`);
      process.exit(1);
    }
  }
  if (cliDates.length === 0) {
    console.error(
      '❌ 날짜 지정은 필수임 — 안 주면 예전 테스트용 기본 기간으로 조용히 실행돼서 의도치 않은 ' +
      '기간을 수집하는 사고가 있었음(재발 방지로 막아둠).\n' +
      '   오늘 하루면: node run-megahouse.js today\n' +
      '   특정 기간이면: node run-megahouse.js 2026-07-10 2026-07-11'
    );
    process.exit(1);
  }
  if (cliDates.length === 1) {
    console.error('❌ 시작일/종료일 둘 다 줘야 함 (예: node run-megahouse.js 2026-07-10 2026-07-11, 오늘 하루만이면 node run-megahouse.js today)');
    process.exit(1);
  }
  if (cliDates.length === 2) {
    [CONFIG.startDate, CONFIG.endDate] = cliDates;
    console.log(`📅 커맨드라인 기간 지정: ${CONFIG.startDate} ~ ${CONFIG.endDate} (둘 다 포함, KST 기준)`);
  }

  const ownToCollect = platformFilter ? CONFIG.own.filter(a => a.platform === platformFilter) : CONFIG.own;
  const competitorsToCollect = platformFilter ? CONFIG.competitors.filter(a => a.platform === platformFilter) : CONFIG.competitors;

  const ownFresh = await collectAll(ownToCollect);
  const competitorsFresh = await collectAll(competitorsToCollect);

  // 특정 플랫폼만 다시 수집했으면, 캐시에 남아있던 다른 플랫폼 데이터는 그대로 보존 —
  // 안 그러면 예전에 수집해둔 트위터/인스타 데이터가 통째로 사라짐(데이터 손실 방지 우선).
  const prevCache = fs.existsSync(CONFIG.cachePath) ? JSON.parse(fs.readFileSync(CONFIG.cachePath, 'utf-8')) : null;
  const mergeWithCache = (fresh, prevList) => {
    if (!platformFilter) return fresh;
    const kept = (prevList || []).filter(c => c.platform !== platformFilter);
    return [...kept, ...fresh];
  };
  const own = mergeWithCache(ownFresh, prevCache?.own);
  const competitors = mergeWithCache(competitorsFresh, prevCache?.competitors);

  // 원본 게시물 캐시 저장 — 재수집 없이 rebuild-report.js로 리포트만 다시 만들 수 있게
  fs.mkdirSync(path.dirname(CONFIG.cachePath), { recursive: true });
  const cacheData = {
    startDate: CONFIG.startDate,
    endDate: CONFIG.endDate,
    collectedAt: new Date().toISOString(),
    own,
    competitors,
  };
  fs.writeFileSync(CONFIG.cachePath, JSON.stringify(cacheData, null, 2));
  console.log(`💾 원본 수집 데이터 캐시 저장: ${CONFIG.cachePath}`);

  // 위 cachePath는 "가장 최근 수집"만 남기고 매번 덮어써져서, 기간을 나눠서 여러 번 수집하면
  // (예: 6/10~13, 6/18~22, 6/27~30을 각각 실행) 예전 기간의 원본은 사라짐 — 나중에 여러 기간을
  // 나란히 비교(compare-periods.js)하려면 기간별로 따로 남아있어야 해서, 이 파일과 별개로
  // 기간(시작일_종료일)마다 파일을 하나씩 쌓아둠(같은 기간으로 재실행하면 그 파일만 갱신).
  fs.mkdirSync(CONFIG.periodCacheDir, { recursive: true });
  const periodCachePath = path.join(CONFIG.periodCacheDir, `${CONFIG.startDate}_${CONFIG.endDate}.json`);
  fs.writeFileSync(periodCachePath, JSON.stringify(cacheData, null, 2));
  console.log(`💾 기간별 원본 캐시 저장(나중에 여러 기간 비교용): ${periodCachePath}`);

  const manualMatches = fs.existsSync(CONFIG.manualMatchesPath)
    ? JSON.parse(fs.readFileSync(CONFIG.manualMatchesPath, 'utf-8'))
    : {};
  const ignorePosts = fs.existsSync(CONFIG.ignorePostsPath)
    ? JSON.parse(fs.readFileSync(CONFIG.ignorePostsPath, 'utf-8'))
    : {};
  const manualPosts = fs.existsSync(CONFIG.manualPostsPath)
    ? JSON.parse(fs.readFileSync(CONFIG.manualPostsPath, 'utf-8'))
    : {};
  const { own: ownWithManual, competitors: competitorsWithManual } = applyManualPosts(own, competitors, manualPosts);

  const report = buildComparisonReport({
    startDate: CONFIG.startDate,
    endDate: CONFIG.endDate,
    own: ownWithManual,
    competitors: competitorsWithManual,
    manualMatches,
    ignorePosts,
  });

  const sheetName = await saveReportToExcel(report, CONFIG.outputPath);
  console.log(`✅ 엑셀 저장 완료: ${CONFIG.outputPath} (시트: ${sheetName})`);

  // SNS 수집과 별개로, 이 스크립트를 돌릴 때마다 재고 스냅샷도 하나 같이 찍어서 쌓아둠 —
  // 예전엔 naver-stock-snapshot.js를 사용자가 따로 기억해서 실행해야만 스냅샷이 쌓였는데,
  // 그러다 보니 며칠씩 안 찍혀서 추이 그래프가 마지막으로 찍은 날짜에서 멈춰있는 문제가
  // 있었음. 재고 사이트 접속이 실패해도(구조 변경 등) SNS 리포트 저장까지 막으면 안 되므로
  // 실패해도 여기서 삼키고 경고만 남김 — 데이터 유실 방지가 우선.
  try {
    await captureSnapshot();
  } catch (e) {
    console.warn(`⚠️ 재고 스냅샷 촬영 실패(SNS 리포트는 정상 진행): ${e.message}`);
  }

  const stockHistory = fs.existsSync(STOCK_HISTORY_PATH)
    ? JSON.parse(fs.readFileSync(STOCK_HISTORY_PATH, 'utf-8'))
    : null;
  const stockComparison = stockHistory ? buildStockComparison(stockHistory) : null;

  const htmlOutputPath = archiveAndGetPath(CONFIG.htmlOutputDir, CONFIG.htmlOutputBaseName, 'html');
  saveHtmlReport(report, htmlOutputPath, stockComparison);
  console.log(`✅ HTML 저장 완료: ${htmlOutputPath} (브라우저로 열어서 확인, 이전 파일은 reports/old/로 이동됨)`);
}

main().catch(err => {
  console.error('❌ 실행 중 오류:', err);
  process.exit(1);
});
