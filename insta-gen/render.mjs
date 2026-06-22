#!/usr/bin/env node
/**
 * GEM 카드 자동 생성기
 *
 *   node render.mjs <post.json>
 *   예) node render.mjs data/posts/minato.json
 *
 * 흐름: post.json + works.json + types.json 병합 → 템플릿 바인딩
 *       → (선택) 누끼 → Playwright 로 1080x1350 PNG 캡처
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename, extname } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Playwright 를 로컬 → 전역 순으로 해석
function loadChromium() {
  for (const cand of ['playwright', tryGlobal()]) {
    if (!cand) continue;
    try { return require(cand).chromium; } catch {}
  }
  throw new Error('playwright 를 찾을 수 없습니다. `npm i playwright` 후 다시 시도하세요.');
}
function tryGlobal() {
  try {
    const root = execFileSync('npm', ['root', '-g']).toString().trim();
    return join(root, 'playwright');
  } catch { return null; }
}

const W = 1080, H = 1350;
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const fileToDataUri = async (p) => {
  const ext = extname(p).slice(1).toLowerCase();
  const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  return `data:${mime};base64,${(await readFile(p)).toString('base64')}`;
};

async function main() {
  const postPath = process.argv[2];
  if (!postPath) { console.error('사용법: node render.mjs <post.json>'); process.exit(1); }

  const post  = await json(resolve(postPath));
  const works = await json(join(__dirname, 'data/works.json'));
  const types = await json(join(__dirname, 'data/types.json'));

  const work = works[post.work];
  const type = types[post.type];
  if (!work) throw new Error(`알 수 없는 work: ${post.work}`);
  if (!type) throw new Error(`알 수 없는 type: ${post.type}`);

  // ── 피규어 이미지 (선택적 누끼) ──
  let figPath = join(__dirname, 'assets/figures', post.figure.src);
  if (post.figure.nuki) figPath = runNuki(figPath);
  const figureSrc = existsSync(figPath)
    ? await fileToDataUri(figPath)
    : placeholderFigure();      // 이미지 없으면 실루엣 플레이스홀더

  // ── 로고 (있으면 img, 없으면 작품명 텍스트) ──
  const logoPath = join(__dirname, 'assets/logos', work.logo || '');
  const workLogo = (work.logo && existsSync(logoPath))
    ? `<img class="work-logo" src="${await fileToDataUri(logoPath)}">`
    : `<div class="work-logo-text">${work.name_kr}</div>`;

  const fig = post.figure;
  const figureStyle =
    `transform: translateY(${fig.offset_y || 0}px) scale(${fig.scale || 1});`;

  // ── 템플릿 바인딩 ──
  const tpl = await readFile(join(__dirname, 'templates/gem-card.html'), 'utf8');
  const html = fill(tpl, {
    headline: type.headline,
    badge_top: type.badge[0],
    badge_bottom: type.badge[1] || '',
    badge_color: type.badge_color,
    card_theme: work.card_theme,
    copyright: work.copyright,
    work_name_kr: work.name_kr,
    product_kr: post.product_kr,
    work_logo: workLogo,
    figure_src: figureSrc,
    figure_style: figureStyle,
  });

  // ── 캡처 ──
  const chromium = loadChromium();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const outName = `${basename(postPath, '.json')}.png`;
  const outPath = join(__dirname, 'out', outName);
  await page.screenshot({ path: outPath });
  await browser.close();
  console.log(`✓ 생성 완료: out/${outName}`);
}

function fill(tpl, map) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in map ? map[k] : ''));
}

// rembg 로 배경 제거 (없으면 안내 후 원본 사용)
function runNuki(src) {
  const out = src.replace(/\.(\w+)$/, '.nuki.png');
  try {
    execFileSync('rembg', ['i', src, out], { stdio: 'ignore' });
    return out;
  } catch {
    console.warn('⚠ rembg 미설치 — 원본 이미지를 사용합니다 (`pip install rembg`).');
    return src;
  }
}

function placeholderFigure() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600">
    <rect width="400" height="600" fill="none"/>
    <g fill="#b9a98f">
      <circle cx="200" cy="120" r="70"/>
      <rect x="120" y="190" width="160" height="240" rx="40"/>
      <rect x="150" y="430" width="40" height="150" rx="20"/>
      <rect x="210" y="430" width="40" height="150" rx="20"/>
    </g>
    <text x="200" y="320" font-size="22" fill="#7a6c55" text-anchor="middle">FIGURE</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

main().catch((e) => { console.error('✗', e.message); process.exit(1); });
