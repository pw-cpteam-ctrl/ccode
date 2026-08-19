/**
 * GoodSmile B2B에서 특정 발표일 상품을 긁어 product-sns-formatter가 가져올 수 있는
 * output.json + photos/*.jpg로 만드는 단일 진입점.
 *
 * 팀원은 이 파일(정확히는 run.bat)만 더블클릭하면 된다:
 *   - 전용 크롬 프로필(저장소 밖에 저장 — profile-dir.js 참고)이 로그인을 며칠간 기억하고
 *     있으면 → 로그인 단계 없이 바로 스크래핑.
 *   - 세션이 없거나 만료됐으면 → 크롬 창이 뜨고, 거기서 로그인만 하면(엔터 불필요, URL
 *     변화로 자동 감지) 곧바로 이어서 스크래핑.
 *
 * 어떤 날짜분을 받을지는 PC 시계가 아니라 **사이트에 실제로 올라와 있는 발표일**로 정한다
 * (이 사이트는 전날 18시경에 다음날 발표분을 미리 공개함 — 자세한 이유는 target-date.js 참고).
 *   - 인자 없음  → 가장 최신 발표일 (평소 run.bat이 쓰는 길)
 *   - --pick     → 받을 수 있는 날짜 목록을 보여주고 번호로 고르게 함 (run-pick-date.bat)
 *   - --date=20260730 → 그 날짜를 바로 지정
 *
 * recon.js로 실제 사이트를 정찰한 결과: GoodSmile B2B는 임베디드 JSON
 * (__NEXT_DATA__ 등)이 전혀 없는 순수 서버 렌더링 HTML이라, 아래 필드 추출은
 * 화면 요소를 직접 읽는 방식(DOM 파싱)으로 되어있다.
 *
 * ⚠️ 반드시 화면 있는 로컬 컴퓨터에서 실행할 것 (README 참고).
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { openPersistentSession } = require('./browser-stealth');
const { downloadImage } = require('./download-image');
const { buildOutputProduct, writeOutputFile } = require('./format-output');
const { friendlyErrorMessage } = require('./friendly-error');
const { copyToClipboard, openInExplorer } = require('./os-helpers');
const { toFolderName, formatDateLabel, groupByDate, dateOptionsText, resolveTargetDate } = require('./target-date');

const { GOODSMILE_PROFILE_DIR: PROFILE_DIR } = require('./profile-dir'); // 로그인을 기억하는 전용 프로필 (저장소 밖 — profile-dir.js 참고)

// "오늘 상품" 목록이 뜨는 고정 홈 화면. 로그인 후 이 페이지 자체 내용이 매일 갱신됨
// (recon.js로 확인: 신상품이 /b2b/en/product/<숫자ID> 링크로 여기 나열됨).
const TODAY_LIST_URL = 'https://www.goodsmile.com/b2b/en';

// 로그인 필요 시 이 사이트가 실제로 튕기는 경로 (recon.js로 확인: response.redirected → /login).
const LOGIN_URL_PATTERN = /\/login/i;

// 실행 인자 해석: --pick(목록에서 고르기), --date=20260730(직접 지정)
function parseArgs(argv) {
  const wantPick = argv.includes('--pick');
  const dateArg = (argv.find(a => a.startsWith('--date=')) || '').slice('--date='.length);
  return { wantPick, requestedDate: dateArg || '' };
}

// 홈 화면에 올라와 있는 상품을 발표일별로 묶어서 돌려준다.
// 상품 카드(<li class="p-top__products__item" data-guidance_date="20260728">)에 발표일이
// 이미 데이터로 박혀있어서, 별도 검색 없이 여기서 바로 날짜 목록을 만들 수 있다.
// 홈 화면엔 최근 며칠~몇 주치가 섞여 있으므로, 이 중 한 날짜만 골라 쓴다.
async function collectDateOptions(page) {
  await page.goto(TODAY_LIST_URL, { waitUntil: 'networkidle' });
  const items = await page.$$eval('li.p-top__products__item', els =>
    els
      .map(li => ({
        date: li.getAttribute('data-guidance_date') || '',
        url: li.querySelector('a[href*="/product/"]')?.href || '',
      }))
      .filter(x => x.date && x.url)
  );
  return groupByDate(items);
}

// --pick 모드에서 번호를 입력받는다. 엔터만 치면 1번(가장 최신).
function askDateChoice(dateOptions) {
  console.log('\n받을 수 있는 발표일:');
  console.log(dateOptionsText(dateOptions));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question('\n번호를 고르고 엔터 (엔터만 치면 1번): ', answer => {
      rl.close();
      const n = parseInt(String(answer).trim(), 10);
      // 숫자가 아니거나 범위를 벗어나면 되묻지 않고 가장 최신으로 진행 — 팀원이 창을 껐다
      // 다시 켜는 일 없이 최소한 뭐라도 받아가게 하고, 어느 날짜로 갔는지는 아래에서 출력한다.
      if (!Number.isInteger(n) || n < 1 || n > dateOptions.length) {
        console.log('→ 번호를 못 알아들어서 가장 최신 날짜로 진행합니다.');
        resolve(dateOptions[0].date);
        return;
      }
      resolve(dateOptions[n - 1].date);
    });
  });
}

// 같은 상품의 일본어 페이지에서 상품명·작품명만 더 받아온다.
// 한국 정식 제목은 일본어 원제를 옮긴 것이고 영문판은 아예 다른 작명인 경우가 많아서
// (Demon Slayer ↔ 鬼滅の刃 ↔ 귀멸의 칼날), 사람이 정식 표기를 확인할 때 원제가 있으면
// 훨씬 빠르다. 다만 기준 페이지는 영어판 그대로 두고 여기서는 두 항목만 덧붙인다 —
// 성인 상품 판정처럼 이미 검증된 로직이 일본어 라벨 때문에 조용히 깨지는 걸 막기 위해서다.
async function extractJapaneseNames(page, enUrl) {
  const jaUrl = enUrl.replace('/b2b/en/', '/b2b/ja/');
  if (jaUrl === enUrl) return { titleJa: '', workJa: '' };
  try {
    await page.goto(jaUrl, { waitUntil: 'networkidle', timeout: 20000 });
    const titleJa = ((await page.locator('.b-product-info__title').first().textContent().catch(() => '')) || '').trim();
    const pairs = await page.locator('#section_spec .b-text-group__unit').evaluateAll(units =>
      units.map(u => ({
        label: u.querySelector('h3')?.textContent.trim() || '',
        value: u.querySelector('p')?.textContent.trim() || '',
      }))
    );
    const workJa = ((pairs.find(p => /シリーズ|series/i.test(p.label)) || {}).value || '').trim();
    return { titleJa, workJa };
  } catch (err) {
    // 일본어판이 없거나 느려도 수집 전체를 실패시키지 않는다 — 없으면 없는 대로 진행.
    return { titleJa: '', workJa: '', jaFailed: err.message };
  }
}

async function extractProductFromDetailPage(page, url) {
  await page.goto(url, { waitUntil: 'networkidle' });

  const id = (url.match(/\/product\/(\d+)/) || [])[1] || url;

  const title = ((await page.locator('.b-product-info__title').first().textContent().catch(() => '')) || '').trim();

  const labelsText = (await page.locator('.b-product-info__labels').first().textContent().catch(() => '')) || '';
  const rerelease = /rerelease|restock|재판/i.test(labelsText);

  const dateText = (await page.locator('.b-product-info__unit--date').first().textContent().catch(() => '')) || '';
  const releaseDate = (dateText.match(/Release Month:\s*([\d/]+)/) || [])[1] || '';

  // "Product Specifications" 섹션은 <h3>라벨</h3><p>값</p> 쌍이 상품마다 개수가 다를 수 있어서
  // (예: 재판 상품엔 Sculptor/Production Cooperation이 없을 수 있음) 고정 순서 대신 라벨로 매칭.
  const specPairs = await page.locator('#section_spec .b-text-group__unit').evaluateAll(units =>
    units.map(u => ({
      label: u.querySelector('h3')?.textContent.trim() || '',
      value: u.querySelector('p')?.textContent.trim() || '',
    }))
  );
  const specMap = Object.fromEntries(specPairs.map(({ label, value }) => [label, value]));

  const work = specMap['Series'] || '';
  const size = specMap['Specifications'] || '';
  const manufacturer = specMap['Manufacturer'] || '';
  // 저작권/가격/카톤당 수량은 팀 실사용에 필요 없어서 수집 안 함(요청에 따라 제외).

  // "Notification > About This Product" 목록에 성인 전용 문구가 있으면 성인 상품으로 판단.
  // 회사가 성인 피규어는 취급 안 하므로, 이 경우 사진 다운로드도 시도하지 말고 통째로 건너뛴다.
  const noticeItems = await page.locator('.p-product-detail__section .c-list__item').allTextContents();
  const isAdult = noticeItems.some(t => /adults?\s+18\s+years\s+of\s+age/i.test(t));
  if (isAdult) return { id, title, isAdult: true };

  const photoSrcs = await page.locator('.c-photo-variable-grid img').evaluateAll(imgs =>
    [...new Set(imgs.map(img => img.getAttribute('src')).filter(Boolean))]
  );
  const photoUrls = photoSrcs.map(src => new URL(src, url).href);

  return { id, title, work, releaseDate, rerelease, size, manufacturer, photoUrls };
}

async function main() {
  const { wantPick, requestedDate } = parseArgs(process.argv.slice(2));

  const { context, page } = await openPersistentSession(PROFILE_DIR, {
    startUrl: TODAY_LIST_URL,
    loginUrlPattern: LOGIN_URL_PATTERN,
    onWaitingForLogin: () => console.log('▶ 크롬 창에서 GoodSmile에 로그인해주세요. 로그인되면 자동으로 이어서 진행됩니다...'),
  });

  console.log('▶ 사이트에 올라와 있는 상품 목록을 확인하는 중...');
  const dateOptions = await collectDateOptions(page);

  // --pick이면 목록을 보여주고 고르게, 아니면 지정 날짜 / 지정도 없으면 가장 최신.
  const wanted = wantPick && dateOptions.length ? await askDateChoice(dateOptions) : requestedDate;
  const target = resolveTargetDate(dateOptions, wanted);
  if (!target.ok) {
    console.error(`\n${target.message}`);
    await context.close();
    process.exit(1);
  }

  const OUT_DIR = path.join(__dirname, 'output', toFolderName(target.date));
  const reason = wantPick ? '목록에서 고른 날짜' : target.reason;
  console.log(`\n▶ ${formatDateLabel(target.date)} 발표분을 받습니다 (${reason})`);
  console.log(`상품 ${target.urls.length}건 발견`);
  // 폴더 이름을 "실행한 날"이 아니라 "받는 발표일"로 짓기 때문에, 같은 날짜를 다시 받으면
  // 같은 폴더가 그대로 갱신된다(다른 날짜분과 섞이지 않음). 이미 받은 적이 있으면 알려준다.
  if (fs.existsSync(path.join(OUT_DIR, 'output.json'))) {
    console.log('※ 이 날짜는 전에 받은 적이 있어요 — 같은 폴더 내용을 새로 덮어씁니다.');
  }
  if (dateOptions.length > 1 && !wantPick && !requestedDate) {
    console.log(`※ 다른 날짜분이 필요하면 run-pick-date.bat 을 실행하면 목록에서 고를 수 있어요.`);
  }

  const detailUrls = target.urls;
  const products = [];
  let jaMissing = 0;
  for (const url of detailUrls) {
    const raw = await extractProductFromDetailPage(page, url);
    if (!raw) continue;

    if (raw.isAdult) {
      console.log(`🔞 ${raw.title || raw.id} — 성인 전용 상품이라 건너뜀 (사진/텍스트 수집 안 함)`);
      await page.waitForTimeout(400);
      continue;
    }

    // 성인 상품은 위에서 이미 걸러졌으므로 여기서만 일본어 페이지를 한 번 더 연다.
    const ja = await extractJapaneseNames(page, url);
    if (!ja.titleJa && !ja.workJa) jaMissing += 1;

    const photoFilenames = [];
    for (let i = 0; i < raw.photoUrls.length; i += 1) {
      const filename = `${raw.id}_${i + 1}.jpg`;
      const savePath = path.join(OUT_DIR, 'photos', filename);
      try {
        await downloadImage(context, raw.photoUrls[i], savePath);
        photoFilenames.push(filename);
      } catch (err) {
        console.warn(`⚠️ 사진 다운로드 실패 (${raw.id} #${i + 1}):`, err.message);
      }
    }

    products.push(buildOutputProduct({ ...raw, titleJa: ja.titleJa, workJa: ja.workJa, photoFilenames }));
    console.log(`✅ ${raw.title || raw.id} 처리 완료`);
    await page.waitForTimeout(400); // 하루 10~30건 수준이라 과한 딜레이는 필요 없음 — 상식적인 간격만
  }

  const outPath = writeOutputFile(products, OUT_DIR, { guidanceDate: target.date });
  console.log(`\n완료: ${formatDateLabel(target.date)} 발표분 ${products.length}건 -> ${outPath}`);
  if (jaMissing) {
    // 일본어 원제는 "있으면 좋은" 참고 정보라 없어도 작업은 그대로 된다 — 다만 몇 건이
    // 비었는지는 알려줘야 사이트 구조가 바뀐 걸 눈치챌 수 있다.
    console.log(`※ ${jaMissing}건은 일본어 원제를 못 받았어요 (없어도 원고 작업에는 지장 없어요)`);
  }
  console.log('product-sns-formatter의 "B2B에서 오늘 상품 가져오기" 버튼에서 이 output.json과');
  console.log(`${path.join(OUT_DIR, 'photos')} 폴더 안의 사진들을 함께 선택해서 가져오면 됨.`);

  // 팀원 편의: 결과 폴더 경로를 클립보드에 복사해두고(폴더선택창 주소창에 붙여넣기용),
  // 그 폴더를 탐색기로 바로 띄워준다(웹페이지로 드래그하기 편하게). 둘 다 실패해도 무시.
  copyToClipboard(OUT_DIR);
  openInExplorer(OUT_DIR);

  await context.close();
}

main().catch(err => { console.error(friendlyErrorMessage(err)); process.exit(1); });
