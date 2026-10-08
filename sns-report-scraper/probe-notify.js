/**
 * 알림받기 수가 스토어 페이지 어디에 들어있는지 찾아보는 "확인용" 스크립트.
 * 수집 기능이 아니라, 수집 코드를 쓰기 전에 한 번 돌려보는 조사 도구다.
 *
 * 왜 바로 수집 코드를 안 쓰고 이걸 먼저 돌리나 —
 * 개발 환경에서는 네이버가 이쪽 IP를 통째로 막아서(nfront 429) 실제 페이지를 열어볼 수가
 * 없다. 그 상태로 "아마 이런 이름이겠지" 하고 키 이름을 찍으면, 못 읽었는데도 조용히
 * 0이 들어가서 "알림받기가 0명으로 줄었다" 같은 거짓 추이가 만들어진다. 숫자를 못 읽는
 * 것보다 틀린 숫자가 쌓이는 쪽이 훨씬 위험해서, 실물을 먼저 확인하고 코드를 쓴다.
 *
 * 사용법: node probe-notify.js
 *        node probe-notify.js brand=goodsmile
 *
 * 창이 하나 뜬다. 알림받기 수가 로그인해야 보이면 그 창에서 네이버에 로그인한 다음,
 * 이 검은 창으로 돌아와 엔터를 치면 된다(로그인이 필요 없으면 그냥 엔터).
 * 끝나면 찾은 후보들을 쭉 찍어준다 — 그 출력을 그대로 전달해주면 된다.
 */
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');
const { sanitizeJsonLiteral, extractAssignedJson, reconstructNextFlight } = require('./naver-stock');
const { prepareBrand, parseBrandArg } = require('./brand-config');

// 알림받기가 데이터 안에서 쓸 법한 이름들. 네이버가 어느 걸 쓰는지 모르니 넓게 훑는다 —
// 이 조사의 목적 자체가 "실제로 어떤 이름인지"를 알아내는 것이라 일부러 느슨하게 잡았다.
const NAME_HINT = /(notify|notification|interest|follow|subscrib|favorit|wish|zzim|bookmark|agree|member)/i;

/** 중첩된 객체를 전부 훑으면서 "이름이 수상하고 값이 숫자"인 것만 모은다. */
function collectCandidates(root, label, out, maxNodes = 400000) {
  let n = 0;
  const stack = [{ node: root, path: label }];
  const seen = new WeakSet();
  while (stack.length) {
    const { node, path: p } = stack.pop();
    if (++n > maxNodes) break;
    if (!node || typeof node !== 'object') continue;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const [k, v] of Object.entries(node)) {
      const childPath = `${p}.${k}`;
      if (typeof v === 'number' && Number.isFinite(v) && NAME_HINT.test(k)) {
        out.push({ where: childPath, key: k, value: v });
      } else if (typeof v === 'string' && NAME_HINT.test(k) && /^\d[\d,]*$/.test(v.trim())) {
        out.push({ where: childPath, key: k, value: Number(v.replaceAll(',', '')) });
      } else if (v && typeof v === 'object') {
        stack.push({ node: v, path: childPath });
      }
    }
  }
}

/** 페이지 HTML에 박힌 데이터 덩어리들을 전부 꺼내서 후보를 모은다. */
function candidatesFromHtml(html) {
  const out = [];

  const preloaded = extractAssignedJson(html, '__PRELOADED_STATE__');
  if (preloaded) {
    try { collectCandidates(JSON.parse(sanitizeJsonLiteral(preloaded)), '__PRELOADED_STATE__', out); }
    catch (e) { console.warn('  (PRELOADED_STATE 파싱 실패:', e.message, ')'); }
  }

  const flight = reconstructNextFlight(html);
  if (flight) {
    flight.split('\n').forEach((line, i) => {
      const colon = line.indexOf(':');
      if (colon === -1) return;
      const body = line.slice(colon + 1).trim();
      if (!body.startsWith('{') && !body.startsWith('[')) return;
      try { collectCandidates(JSON.parse(body), `flight[${i}]`, out); } catch { /* 조각난 행은 건너뜀 */ }
    });
  }

  return out;
}

async function main() {
  const { brandKey } = parseBrandArg(process.argv.slice(2));
  const brand = prepareBrand(brandKey);
  const stores = brand.stockStores || [];
  if (stores.length === 0) {
    console.error(`❌ [${brand.label}] 볼 스토어가 설정돼 있지 않습니다.`);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ locale: 'ko-KR' });
  const dumpDir = path.join(__dirname, 'verify-output');
  fs.mkdirSync(dumpDir, { recursive: true });

  for (const store of stores) {
    console.log(`\n================ ${store.label} ================`);
    console.log(`여는 중: ${store.url}`);
    const page = await context.newPage();
    try {
      await page.goto(store.url, { waitUntil: 'domcontentloaded', timeout: 40000 });
      await page.waitForTimeout(2500);

      console.log('\n창에서 알림받기 수가 보이는지 확인해주세요.');
      console.log('로그인해야 보이면 지금 그 창에서 로그인한 뒤, 여기로 돌아와 엔터를 치세요.');
      console.log('(로그인이 필요 없으면 그냥 엔터)');
      await new Promise(resolve => process.stdin.once('data', resolve));
      await page.waitForTimeout(800);

      const html = await page.content();
      const dumpPath = path.join(dumpDir, `notify-probe-${store.label}.html`);
      fs.writeFileSync(dumpPath, html);
      console.log(`\n📄 페이지 원본 저장: ${dumpPath} (여기서 못 찾으면 이 파일을 보고 찾습니다)`);

      // 1) 페이지에 박힌 데이터에서 찾기 — 이쪽에서 잡히면 정확한 숫자라 제일 좋다.
      const cands = candidatesFromHtml(html);
      const uniq = [...new Map(cands.map(c => [`${c.key}=${c.value}`, c])).values()]
        .sort((a, b) => b.value - a.value);
      console.log(`\n[1] 페이지 데이터에서 찾은 숫자 후보 ${uniq.length}건:`);
      if (uniq.length === 0) console.log('  (없음)');
      uniq.slice(0, 40).forEach(c => console.log(`  ${String(c.value).padStart(9)}  ← ${c.key}   (${c.where})`));

      // 2) 화면 글자에서 '알림받기' 주변 숫자 찾기 — 1번이 비면 이쪽이라도 써야 한다.
      //    다만 화면 글자는 '16만'처럼 줄어 나올 수 있어서 추이 추적엔 불리하다.
      const domHits = await page.evaluate(() => {
        const hits = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const t = (node.textContent || '').trim();
          if (!/알림받기|알림 받기/.test(t)) continue;
          const box = node.parentElement?.closest('div,section,header,li') || node.parentElement;
          hits.push({ text: t.slice(0, 60), around: (box?.innerText || '').replace(/\s+/g, ' ').slice(0, 160) });
        }
        return hits.slice(0, 10);
      });
      console.log(`\n[2] 화면에서 '알림받기' 글자가 보인 곳 ${domHits.length}건:`);
      if (domHits.length === 0) console.log('  (없음 — 로그인이 필요하거나 이 페이지엔 안 나오는 위치일 수 있습니다)');
      domHits.forEach(h => console.log(`  "${h.text}"  →  주변 글자: ${h.around}`));
    } catch (e) {
      console.error(`❌ ${store.label} 열기 실패: ${e.message}`);
    } finally {
      await page.close();
    }
  }

  await browser.close();
  console.log('\n끝났습니다. 위 [1] [2] 출력을 그대로 복사해서 전달해주세요.');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ 실패:', err);
  process.exit(1);
});
