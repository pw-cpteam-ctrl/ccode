/**
 * 로그인된 세션으로 GoodSmile B2B 페이지 하나를 열어서 구조를 파악하는 정찰 스크립트.
 * scrape.js를 실제로 짜기 전에 반드시 먼저 실행해서 결과를 확인해야 한다 — 실제 필드 추출
 * 코드는 이 결과(페이지에 __NEXT_DATA__/__PRELOADED_STATE__/__next_f가 있는지, 상품 목록/상세
 * 링크 구조가 어떤지)에 따라 완전히 달라지기 때문.
 *
 * scrape.js와 같은 전용 크롬 프로필(chrome-profile/goodsmile)을 공유한다 — scrape.js를
 * 한 번이라도 실행해서 로그인해뒀다면 이 스크립트는 로그인 없이 바로 정찰 가능. 세션이
 * 없거나 만료됐으면 여기서도 크롬 창이 뜨고 로그인하면 자동으로 이어서 진행된다.
 *
 * 사용법:
 *   node recon.js <오늘 상품 목록 페이지 URL>
 *   node recon.js <상품 상세 페이지 URL 1개>
 *
 * 실행하면 recon-output/ 폴더에 다음이 저장됨:
 *   - <이름>.html   : 페이지 전체 HTML (임베디드 JSON 유무 확인용)
 *   - <이름>.png    : 스크린샷 (레이아웃 확인용)
 * 그리고 터미널에 __NEXT_DATA__ 등 마커 존재 여부 + 눈에 띄는 링크 목록을 출력한다.
 *
 * ⚠️ 이 환경(원격 샌드박스)에서 실행하면 GoodSmile 쪽에서 IP를 막을 수 있어 실패할 수 있다
 * (naver-stock.js에서 실제로 겪은 문제와 같은 종류) — 반드시 로컬 컴퓨터에서 실행해서, 그
 * 결과(터미널 출력 + 필요하면 html/png 파일)를 알려줄 것.
 */
const fs = require('fs');
const path = require('path');
const { openPersistentSession } = require('./browser-stealth');

const PROFILE_DIR = path.join(__dirname, 'chrome-profile', 'goodsmile'); // scrape.js와 동일한 프로필 공유
const OUT_DIR = path.join(__dirname, 'recon-output');

// TODO(recon): 실제 GoodSmile 로그인 페이지 URL 패턴으로 조정할 것.
const LOGIN_URL_PATTERN = /\/login/i;

const MARKERS = ['__NEXT_DATA__', '__PRELOADED_STATE__', '__next_f', '__NUXT__', 'application/json'];

function slugFromUrl(url) {
  return url.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 80);
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('❌ 사용법: node recon.js <상품 목록 또는 상세 페이지 URL>');
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const { context, page } = await openPersistentSession(PROFILE_DIR, {
    startUrl: url,
    loginUrlPattern: LOGIN_URL_PATTERN,
    onWaitingForLogin: () => console.log('▶ 크롬 창에서 GoodSmile에 로그인해주세요. 로그인되면 자동으로 이어서 진행됩니다...'),
  });

  const html = await page.content();
  const slug = slugFromUrl(url);
  const htmlPath = path.join(OUT_DIR, `${slug}.html`);
  const pngPath = path.join(OUT_DIR, `${slug}.png`);
  fs.writeFileSync(htmlPath, html, 'utf-8');
  await page.screenshot({ path: pngPath, fullPage: true }).catch(() => {});

  console.log('\n=== 임베디드 JSON 마커 존재 여부 ===');
  for (const marker of MARKERS) {
    const found = html.includes(marker);
    console.log(`  ${found ? '✅' : '  '} ${marker}`);
  }

  console.log('\n=== 페이지 안의 링크 중 상품/목록/상세로 보이는 것 (최대 25개) ===');
  const links = await page.$$eval('a[href]', as => as.map(a => ({ href: a.href, text: a.textContent.trim().slice(0, 40) })));
  const interesting = links.filter(l => /product|item|detail|goods|catalog/i.test(l.href)).slice(0, 25);
  (interesting.length ? interesting : links.slice(0, 25)).forEach(l => console.log(`  ${l.text || '(텍스트없음)'} -> ${l.href}`));

  console.log('\n=== 이미지 태그 중 상품 사진으로 보이는 것 (최대 15개) ===');
  const imgs = await page.$$eval('img[src]', els => els.map(e => e.src));
  const productish = imgs.filter(u => /product|item|goods|image|photo/i.test(u)).slice(0, 15);
  (productish.length ? productish : imgs.slice(0, 15)).forEach(u => console.log(`  ${u}`));

  console.log(`\n저장됨: ${htmlPath}`);
  console.log(`저장됨: ${pngPath}`);
  console.log('\n👉 위 출력(특히 마커 체크 결과·링크 목록)을 그대로 복사해서 알려주면, 그걸로 scrape.js의');
  console.log('   실제 필드 추출 로직을 마저 작성할게. html 파일 안의 __NEXT_DATA__ 등 구조가 궁금하면');
  console.log(`   ${htmlPath} 파일을 열어서 해당 부분만 잘라 보내줘도 돼.`);

  await context.close();
}

main().catch(err => { console.error('❌ 실패:', err.message); process.exit(1); });
