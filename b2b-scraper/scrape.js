/**
 * GoodSmile B2B에서 오늘 상품을 긁어 product-sns-formatter가 가져올 수 있는
 * output.json + photos/*.jpg로 만드는 단일 진입점.
 *
 * 팀원은 이 파일(정확히는 run.bat)만 더블클릭하면 된다:
 *   - 전용 크롬 프로필(chrome-profile/goodsmile)이 로그인을 며칠간 기억하고 있으면 →
 *     로그인 단계 없이 바로 스크래핑.
 *   - 세션이 없거나 만료됐으면 → 크롬 창이 뜨고, 거기서 로그인만 하면(엔터 불필요, URL
 *     변화로 자동 감지) 곧바로 이어서 스크래핑.
 *
 * recon.js로 실제 사이트를 정찰한 결과: GoodSmile B2B는 임베디드 JSON
 * (__NEXT_DATA__ 등)이 전혀 없는 순수 서버 렌더링 HTML이라, 아래 필드 추출은
 * 화면 요소를 직접 읽는 방식(DOM 파싱)으로 되어있다.
 *
 * ⚠️ 반드시 화면 있는 로컬 컴퓨터에서 실행할 것 (README 참고).
 */
const path = require('path');
const { openPersistentSession } = require('./browser-stealth');
const { downloadImage } = require('./download-image');
const { buildOutputProduct, writeOutputFile } = require('./format-output');

const PROFILE_DIR = path.join(__dirname, 'chrome-profile', 'goodsmile'); // 로그인을 기억하는 전용 프로필 폴더
const OUT_DIR = path.join(__dirname, 'output', new Date().toISOString().slice(0, 10));

// "오늘 상품" 목록이 뜨는 고정 홈 화면. 로그인 후 이 페이지 자체 내용이 매일 갱신됨
// (recon.js로 확인: 신상품이 /b2b/en/product/<숫자ID> 링크로 여기 나열됨).
const TODAY_LIST_URL = 'https://www.goodsmile.com/b2b/en';

// 로그인 필요 시 이 사이트가 실제로 튕기는 경로 (recon.js로 확인: response.redirected → /login).
const LOGIN_URL_PATTERN = /\/login/i;

async function getTodayDetailUrls(page) {
  await page.goto(TODAY_LIST_URL, { waitUntil: 'networkidle' });
  // 상품 상세 링크만 정확히 골라냄 (예: /b2b/en/product/1142373) — "List of Products" 메뉴
  // 링크(/b2b/en/product, ID 없음)나 다른 하위 경로는 제외.
  const urls = await page.$$eval('a[href]', as =>
    as
      .map(a => a.href)
      .filter(href => {
        try { return /\/b2b\/en\/product\/\d+$/.test(new URL(href).pathname); }
        catch { return false; }
      })
  );
  return [...new Set(urls)];
}

async function extractProductFromDetailPage(page, url) {
  await page.goto(url, { waitUntil: 'networkidle' });

  const id = (url.match(/\/product\/(\d+)/) || [])[1] || url;

  const title = ((await page.locator('.b-product-info__title').first().textContent().catch(() => '')) || '').trim();

  const labelsText = (await page.locator('.b-product-info__labels').first().textContent().catch(() => '')) || '';
  const rerelease = /rerelease|restock|재판/i.test(labelsText);

  const dateText = (await page.locator('.b-product-info__unit--date').first().textContent().catch(() => '')) || '';
  const releaseDate = (dateText.match(/Release Month:\s*([\d/]+)/) || [])[1] || '';

  const priceText = (await page.locator('.b-product-info__unit--price').first().textContent().catch(() => '')) || '';
  const wholesalePrice = (priceText.match(/Wholesale Price\s*[￥¥]\s*([\d,]+)/) || [])[1] || '';
  const retailPrice = (priceText.match(/Retail price\s*[￥¥]\s*([\d,]+)/i) || [])[1] || '';
  const qtyPerCarton = (priceText.match(/Quantity per carton\s*(\d+)/i) || [])[1] || '';

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
  const copyright = specMap['Copyright'] || '';

  const photoSrcs = await page.locator('.c-photo-variable-grid img').evaluateAll(imgs =>
    [...new Set(imgs.map(img => img.getAttribute('src')).filter(Boolean))]
  );
  const photoUrls = photoSrcs.map(src => new URL(src, url).href);

  return { id, title, work, releaseDate, rerelease, size, manufacturer, copyright, wholesalePrice, retailPrice, qtyPerCarton, photoUrls };
}

async function main() {
  const { context, page } = await openPersistentSession(PROFILE_DIR, {
    startUrl: TODAY_LIST_URL,
    loginUrlPattern: LOGIN_URL_PATTERN,
    onWaitingForLogin: () => console.log('▶ 크롬 창에서 GoodSmile에 로그인해주세요. 로그인되면 자동으로 이어서 진행됩니다...'),
  });

  console.log('▶ 오늘 상품을 가져오는 중...');
  const detailUrls = await getTodayDetailUrls(page);
  console.log(`오늘 상품 상세 페이지 ${detailUrls.length}건 발견`);

  const products = [];
  for (const url of detailUrls) {
    const raw = await extractProductFromDetailPage(page, url);
    if (!raw) continue;

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

    products.push(buildOutputProduct({ ...raw, photoFilenames }));
    console.log(`✅ ${raw.title || raw.id} 처리 완료`);
    await page.waitForTimeout(400); // 하루 10~30건 수준이라 과한 딜레이는 필요 없음 — 상식적인 간격만
  }

  const outPath = writeOutputFile(products, OUT_DIR);
  console.log(`\n완료: ${products.length}건 -> ${outPath}`);
  console.log('product-sns-formatter의 "B2B에서 오늘 상품 가져오기" 버튼에서 이 output.json과');
  console.log(`${path.join(OUT_DIR, 'photos')} 폴더 안의 사진들을 함께 선택해서 가져오면 됨.`);

  await context.close();
}

main().catch(err => { console.error('❌ 실패:', err.message); process.exit(1); });
