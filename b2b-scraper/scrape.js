/**
 * GoodSmile B2B에서 오늘 상품을 긁어 product-sns-formatter가 가져올 수 있는
 * output.json + photos/*.jpg로 만드는 메인 스크립트.
 *
 * ⚠️ 이 파일의 TODO(recon) 표시된 부분은 recon.js 실행 결과를 봐야 채울 수 있다 —
 * 목록 페이지 URL, 상품 상세 링크 셀렉터, 임베디드 JSON 안의 실제 필드 경로,
 * 사진 URL 뽑는 방법은 전부 GoodSmile 실제 페이지 구조에 달려있기 때문.
 * 지금은 그 부분만 비워두고, 세션 재사용/이미지 다운로드/출력 조립 등 나머지 배관은
 * 전부 실제로 동작하게 짜여있다.
 *
 * 사용법: node scrape.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { STEALTH_CONTEXT_OPTIONS } = require('./browser-stealth');
const { sanitizeJsonLiteral, extractAssignedJson, reconstructNextFlight, extractNextDataScript } = require('./extract-helpers');
const { downloadImage } = require('./download-image');
const { buildOutputProduct, writeOutputFile } = require('./format-output');

const SESSION_PATH = path.join(__dirname, 'goodsmile-session.json');
const OUT_DIR = path.join(__dirname, 'output', new Date().toISOString().slice(0, 10));

// TODO(recon): recon.js로 확인한 실제 "오늘 상품 목록" 페이지 URL로 바꿀 것.
const TODAY_LIST_URL = 'https://www.goodsmile.com/b2b/en/TODO-오늘상품목록페이지';

async function getTodayDetailUrls(page) {
  await page.goto(TODAY_LIST_URL, { waitUntil: 'networkidle' });
  // TODO(recon): 목록 페이지에서 상품 상세 링크를 뽑는 실제 셀렉터로 교체.
  // recon.js 출력의 "상품/목록/상세로 보이는 링크" 목록을 참고해서 정확한 규칙을 잡을 것.
  const urls = await page.$$eval('a[href*="TODO-상세페이지패턴"]', as => as.map(a => a.href));
  return [...new Set(urls)];
}

async function extractProductFromDetailPage(page, url) {
  await page.goto(url, { waitUntil: 'networkidle' });
  const html = await page.content();

  // TODO(recon): 아래 세 방식 중 recon.js에서 확인된 것 하나를 골라 실제로 파싱할 것.
  // 방식 A) <script id="__NEXT_DATA__" type="application/json"> 안에 그대로 JSON
  const nextDataRaw = extractNextDataScript(html);
  // 방식 B) window.__PRELOADED_STATE__ = {...} 형태
  const preloadedRaw = extractAssignedJson(html, '__PRELOADED_STATE__');
  // 방식 C) self.__next_f.push(...) 스트리밍 (App Router)
  const flightText = reconstructNextFlight(html);

  let pageData = null;
  if (nextDataRaw) pageData = JSON.parse(sanitizeJsonLiteral(nextDataRaw));
  else if (preloadedRaw) pageData = JSON.parse(sanitizeJsonLiteral(preloadedRaw));
  // flightText는 개행으로 구분된 "<hexId>:<json>" 조각들 — 상품 데이터가 든 조각을 찾아 파싱해야 함.
  // (TODO(recon): 어느 조각인지, 필드 경로가 무엇인지는 실제 값을 봐야 확정 가능)

  if (!pageData) {
    console.warn(`⚠️ ${url}: 임베디드 JSON을 못 찾음 — DOM 파싱으로 대체하거나 recon.js 결과를 다시 확인할 것.`);
    // TODO(recon): 임베디드 JSON이 없으면 여기서 page.$eval 등으로 DOM 직접 파싱.
    return null;
  }

  // TODO(recon): pageData 안의 실제 필드 경로로 교체 (아래는 임시 자리표시자).
  return {
    id: 'TODO',
    title: pageData?.props?.pageProps?.product?.name ?? '',
    work: pageData?.props?.pageProps?.product?.series ?? '',
    releaseDate: pageData?.props?.pageProps?.product?.releaseDate ?? '',
    rerelease: !!pageData?.props?.pageProps?.product?.rerelease,
    size: pageData?.props?.pageProps?.product?.specifications ?? '',
    manufacturer: pageData?.props?.pageProps?.product?.manufacturer ?? '',
    copyright: pageData?.props?.pageProps?.product?.copyright ?? '',
    wholesalePrice: pageData?.props?.pageProps?.product?.wholesalePrice ?? '',
    retailPrice: pageData?.props?.pageProps?.product?.retailPrice ?? '',
    qtyPerCarton: pageData?.props?.pageProps?.product?.qtyPerCarton ?? '',
    photoUrls: pageData?.props?.pageProps?.product?.images ?? [],
  };
}

async function main() {
  if (!fs.existsSync(SESSION_PATH)) {
    console.error(`❌ 세션 파일이 없음: ${SESSION_PATH}\n먼저 "node login-session.js"부터 실행해줘.`);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...STEALTH_CONTEXT_OPTIONS, storageState: SESSION_PATH });
  const page = await context.newPage();

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

  await browser.close();
}

main().catch(err => { console.error('❌ 실패:', err.message); process.exit(1); });
