/**
 * 👤 팔로워 수를 '지금 제대로 읽을 수 있는지'만 30초 안에 확인하는 도구.
 *
 * 왜 따로 만들었나 — 인스타 팔로워가 근사치(≈)로만 찍히는 일이 반복되는데, 그걸 확인하려면
 * 매번 수집 전체(몇 분~십몇 분)를 돌려야 했다. 확인이 비싸면 고치고 나서도 "고쳐졌나"를
 * 안 보게 되고, 결국 추측으로 또 고치게 된다. 프로필만 열고 숫자만 읽고 끝낸다.
 *
 * 정확한 값을 얻는 길이 여럿인데(응답 가로채기 → 직접 물어보기 → 화면에 숨은 수 →
 * 페이지에 실린 데이터 → 화면 글자), 어느 길로 얻었는지와 막힌 길의 이유를 그대로 보여준다.
 *
 * 사용법:
 *   node probe-follower.js                       — 브랜드 설정의 계정 전부
 *   node probe-follower.js megahouse_jp          — 인스타 계정 하나만
 *   node probe-follower.js twitter:MegahouseStore — 플랫폼을 지정해서 하나만
 *   node probe-follower.js show                  — 브라우저 창을 띄운 채로(눈으로 확인할 때)
 *   node probe-follower.js debug                 — 오간 응답을 파일로 남김(원인을 못 짚을 때)
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { watchFollowers } = require('./follower-count');
const { prepareBrand, parseBrandArg } = require('./brand-config');
const { STEALTH_CONTEXT_OPTIONS, applyStealth } = require('./browser-stealth');

const PROFILE_URL = {
  twitter: a => `https://x.com/${a}`,
  instagram: a => `https://www.instagram.com/${a}/`,
};

/** 브랜드 설정에서 '플랫폼+계정+세션파일' 목록을 뽑는다. 자사·경쟁사 가리지 않고 전부. */
function accountsOf(brand) {
  return [...(brand.own || []), ...(brand.competitors || [])]
    .filter(a => a && a.platform && a.account && PROFILE_URL[a.platform])
    .map(a => ({ platform: a.platform, account: a.account, sessionFile: a.sessionFile, side: a.side }));
}

async function probeOne({ platform, account, sessionFile }, headless, debugDir = null) {
  const browser = await chromium.launch({ headless });
  try {
    const ctx = await browser.newContext({
      ...(sessionFile ? { storageState: sessionFile } : {}),
      ...STEALTH_CONTEXT_OPTIONS,
      viewport: { width: 1400, height: 1200 },
    });
    await applyStealth(ctx);
    const page = await ctx.newPage();
    // 가로채기는 반드시 페이지를 열기 '전에' 걸어야 한다 — 뒤에 걸면 이미 지나간 응답을 놓친다.
    const watch = watchFollowers(page, { platform, account });

    // 길이 전부 막혔을 때 추측으로 고치지 않으려면, 실제로 무엇이 오는지를 봐야 한다.
    // '팔로워'라는 말이 들어간 응답만 골라 주소와 본문 일부를 남긴다(본문 전체는 너무 크다).
    // '팔로워'라는 말이 든 응답만 담았다가, 정작 숫자가 없다는 것만 확인하고 끝난 적이 있다.
    // 이번엔 거르지 않고 전부 담는다 — 무엇이 오고 무엇이 안 오는지를 알아야 한다.
    const seen = [];
    if (debugDir) {
      page.on('response', async res => {
        try {
          const ct = res.headers()['content-type'] || '';
          if (!ct.includes('json')) return;
          const body = await res.text();
          // 숫자가 들어있을 만한 응답은 본문째로, 나머지는 주소만 — 파일이 너무 커지지 않게.
          const interesting = /follow|count|user/i.test(body);
          seen.push({
            url: res.url().slice(0, 300), status: res.status(), size: body.length,
            body: interesting ? body.slice(0, 300000) : null,
          });
        } catch { /* 본문이 이미 사라진 응답은 넘어간다 */ }
      });
    }

    await page.goto(PROFILE_URL[platform](account), { waitUntil: 'domcontentloaded' });
    // 기록을 남길 때는 더 기다린다 — 머리말 숫자가 늦게 채워지는 것이라면 3.5초로는 놓친다.
    await page.waitForTimeout(debugDir ? 12000 : 3500);
    const result = await watch.read();

    if (debugDir) {
      // 응답만 남겼다가 정작 숫자가 있는 곳을 못 본 적이 있다(2026-11-09: 인스타는 팔로워
      // 수를 응답이 아니라 첫 HTML에 박아 보냈다). 그래서 화면 쪽도 같이 남긴다.
      const page_ = await page.evaluate(() => ({
        ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => (s.textContent || '').slice(0, 20000)),
        og: document.querySelector('meta[property="og:description"]')?.content || null,
        title: document.title,
        // 팔로워라는 말 주변의 글자만 추려서 — HTML 전체는 수 MB라 너무 크다.
        near: [...document.querySelectorAll('a[href*="/followers"], header section, header li')]
          .map(e => (e.innerText || '').replace(/\s+/g, ' ').slice(0, 300)).slice(0, 10),
        titles: [...document.querySelectorAll('header [title]')]
          .map(e => ({ title: e.getAttribute('title'), shown: (e.innerText || '').trim().slice(0, 30) })).slice(0, 20),
      })).catch(() => null);
      // 로그인하지 않은 채로도 한 번 열어본다. 인스타가 로그인한 사람에게는 줄인 숫자만
      // 보여주면서, 검색 엔진에 보여주려고 로그인 없는 화면에는 정확한 수를 적어두는 경우가
      // 있다. 둘을 같이 남겨두면 어느 쪽에 숫자가 있는지 한 번에 가려진다.
      let anon = null;
      if (platform === 'instagram') {
        try {
          const ctx2 = await browser.newContext({ ...STEALTH_CONTEXT_OPTIONS, viewport: { width: 1400, height: 1200 } });
          await applyStealth(ctx2);
          const p2 = await ctx2.newPage();
          await p2.goto(PROFILE_URL[platform](account), { waitUntil: 'domcontentloaded' });
          await p2.waitForTimeout(5000);
          anon = await p2.evaluate(() => ({
            og: document.querySelector('meta[property="og:description"]')?.content || null,
            desc: document.querySelector('meta[name="description"]')?.content || null,
            ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => (s.textContent || '').slice(0, 20000)),
            title: document.title,
          }));
          await ctx2.close();
        } catch (e) { anon = { error: String(e && e.message) }; }
      }

      // 화면에 그려진 글자 전체도 남긴다(HTML 원본은 수 MB라 글자만). 숫자가 화면 어딘가에
      // 적혀 있다면 여기서 찾을 수 있고, 없다면 '인스타가 아예 안 보여준다'가 확정된다.
      const bodyText = await page.evaluate(() => (document.body.innerText || '').slice(0, 20000)).catch(() => null);

      fs.mkdirSync(debugDir, { recursive: true });
      const out = path.join(debugDir, `_debug-follower-${platform}-${account}.json`);
      fs.writeFileSync(out, JSON.stringify({ account, platform, result: { ...result }, page: page_, anon, bodyText, responses: seen }, null, 2));
      console.log(`\n        💾 응답 ${seen.length}건 + 화면 내용을 남겼습니다: ${out}`);
    }
    return result;
  } finally {
    await browser.close();
  }
}

const FROM_LABEL = {
  api: '페이지가 주고받은 응답에서 — 정확',
  'api-direct': '내부 주소에 직접 물어봄 — 정확',
  'dom-title': '화면에 숨어 있는 정확한 수(title) — 정확',
  'page-data': '페이지에 미리 실려 온 데이터 — 정확',
  dom: '화면에 적힌 글자',
  none: '어디서도 못 읽음',
};

async function main() {
  const { brandKey, rest } = parseBrandArg(process.argv.slice(2));
  const brand = prepareBrand(brandKey);
  const headless = !rest.includes('show');
  const debugDir = rest.includes('debug') ? brand.paths.htmlDir : null;
  const picked = rest.filter(a => a !== 'show' && a !== 'debug');

  let targets = accountsOf(brand);
  if (picked.length > 0) {
    // 'twitter:계정' 또는 '계정'(인스타로 간주) 둘 다 받는다.
    targets = picked.map(raw => {
      const [a, b] = String(raw).split(':');
      const platform = b ? a : (targets.find(t => t.account === a)?.platform || 'instagram');
      const account = b || a;
      const known = targets.find(t => t.platform === platform && t.account === account);
      return known || { platform, account, sessionFile: undefined };
    });
  }

  if (targets.length === 0) {
    console.error(`❌ 볼 계정이 없습니다 — brands/${brand.key}.json 에 계정을 넣거나, 계정을 직접 적어주세요.`);
    console.error('   예: node probe-follower.js megahouse_jp');
    process.exit(1);
  }

  console.log(`🏷️  브랜드: ${brand.label} (${brand.key})`);
  console.log(`👤 팔로워를 제대로 읽을 수 있는지 ${targets.length}개 계정으로 확인합니다 (수집은 하지 않습니다)\n`);

  const rows = [];
  for (const t of targets) {
    process.stdout.write(`   ${t.platform}:${t.account} … `);
    let r;
    try {
      r = await probeOne(t, headless, debugDir);
    } catch (e) {
      console.log(`❌ ${e.message}`);
      rows.push({ ...t, count: null, from: 'error', approx: false, error: e.message });
      continue;
    }
    const exact = r.count !== null && !r.approx;
    console.log(`${exact ? '✅' : r.count === null ? '❌' : '⚠️'} ${r.count === null ? '못 읽음' : r.count.toLocaleString('ko-KR')}`
      + `${r.approx ? ' (근사치)' : ''} — ${FROM_LABEL[r.from] || r.from}`);
    (r.tried || []).forEach(line => console.log(`        ⓘ ${line}`));
    rows.push({ ...t, ...r });
  }

  const bad = rows.filter(r => r.count === null || r.approx);
  console.log('');
  if (bad.length === 0) {
    console.log('✅ 전부 정확한 값으로 읽었습니다 — 팔로워 추이를 그대로 믿어도 됩니다.');
    return;
  }
  console.log(`⚠️ ${bad.length}개 계정이 정확한 값을 못 얻었습니다: ${bad.map(b => `${b.platform}:${b.account}`).join(', ')}`);
  console.log('   근사치는 화면에 줄여 적힌 숫자(2.3만)를 되돌린 값이라, 실제로 늘어도 한동안 같은 수로 찍힙니다.');
  console.log('   위 ⓘ 줄이 어느 길이 왜 막혔는지입니다 — 그대로 복사해서 보내주시면 그 지점을 고칠 수 있습니다.');
  if (!debugDir) {
    console.log('   그래도 안 고쳐지면 오간 응답을 파일로 남겨주세요: node probe-follower.js debug');
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('❌ 실행 중 오류:', err.message);
    process.exit(1);
  });
}

module.exports = { probeOne, accountsOf };
