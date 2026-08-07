#!/usr/bin/env node
// 가이드 원본(html + jsx + css + 이미지)을 하나의 HTML 파일로 합친다.
//
// 왜 필요한가:
//   원본 index.html은 styles.css, shared.jsx, assets/*.png 를 각각 따로 불러온다.
//   이걸 그대로 Netlify에 올리거나 메신저로 전달하면 이미지가 깨지거나 파일이
//   빠진다. 이 스크립트는 필요한 걸 전부 한 파일 안에 집어넣어서, 파일 하나만
//   있으면 인터넷 없이도 열리는 배포본을 만든다.
//
// 쓰는 법:
//   node build-standalone.js
//
// 결과물:
//   standalone/크리에이터 협업 가이드.html
//   standalone/크리에이터 협업 가이드 (굿스마일·부시로드).html
//
// 이 결과물은 git에 올리지 않는다(.gitignore). 원본에서 언제든 다시 만들 수
// 있는 파생물이고, 5MB짜리 파일이 커밋마다 쌓이면 저장소가 무거워지기 때문이다.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DIR = __dirname;
const OUT_DIR = path.join(DIR, 'standalone');
const CACHE_DIR = path.join(DIR, '.vendor-cache');

// 만들 대상: [원본 HTML, 결과 파일명]
const TARGETS = [
  ['index.html', '크리에이터 협업 가이드.html'],
  ['brand2.html', '크리에이터 협업 가이드 (굿스마일·부시로드).html'],
];

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
};

// 외부 파일을 내려받는다. 한 번 받은 건 .vendor-cache에 저장해서 다시 안 받는다.
// node의 fetch는 이 환경의 프록시 설정을 따르지 않아서 curl을 쓴다.
function download(url) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const key = url.replace(/[^a-zA-Z0-9.]/g, '_').slice(-120);
  const cached = path.join(CACHE_DIR, key);
  if (fs.existsSync(cached)) return fs.readFileSync(cached);

  process.stdout.write(`  내려받는 중: ${url.slice(0, 70)}...\n`);
  const buf = execFileSync('curl', ['-fsSL', '--max-time', '60', url], {
    maxBuffer: 64 * 1024 * 1024, encoding: 'buffer',
  });
  fs.writeFileSync(cached, buf);
  return buf;
}

function dataUri(buf, ext) {
  return `data:${MIME[ext] || 'application/octet-stream'};base64,${buf.toString('base64')}`;
}

// CSS 안의 @import(웹폰트)와 url(...)을 전부 파일 내용으로 바꾼다.
function inlineCss(css, baseUrl) {
  // @import url('...') → 그 CSS를 내려받아 자리에 끼워 넣는다 (재귀)
  css = css.replace(/@import\s+url\((['"]?)([^'")]+)\1\)\s*;?/g, (_, q, url) => {
    const abs = url.startsWith('http') ? url : new URL(url, baseUrl).href;
    try {
      return inlineCss(download(abs).toString('utf-8'), abs);
    } catch (e) {
      console.warn(`  ! 폰트 CSS를 못 받음(건너뜀): ${abs}`);
      return '';
    }
  });

  // url(...) 로 참조된 폰트/이미지 → data URI로 바꾼다
  css = css.replace(/url\((['"]?)([^'")]+)\1\)/g, (whole, q, url) => {
    if (url.startsWith('data:')) return whole;
    const abs = url.startsWith('http') ? url : (baseUrl ? new URL(url, baseUrl).href : null);
    const ext = path.extname(url.split('?')[0]).toLowerCase();
    try {
      const buf = abs && abs.startsWith('http')
        ? download(abs)
        : fs.readFileSync(path.join(DIR, url.split('?')[0]));
      return `url(${dataUri(buf, ext)})`;
    } catch (e) {
      console.warn(`  ! 자원을 못 받음(건너뜀): ${url.slice(0, 60)}`);
      return whole;
    }
  });

  return css;
}

// jsx/js 코드 안의 "assets/xxx.png" 문자열을 data URI로 바꾼다.
function inlineAssetsInCode(code) {
  return code.replace(/(['"`])(assets\/[^'"`]+)\1/g, (whole, q, rel) => {
    const file = path.join(DIR, rel);
    if (!fs.existsSync(file)) {
      console.warn(`  ! 이미지 없음(건너뜀): ${rel}`);
      return whole;
    }
    const uri = dataUri(fs.readFileSync(file), path.extname(rel).toLowerCase());
    return `${q}${uri}${q}`;
  });
}

function build(srcName, outName) {
  console.log(`\n[빌드] ${srcName} → standalone/${outName}`);
  let html = fs.readFileSync(path.join(DIR, srcName), 'utf-8');

  // 1) <link rel="stylesheet" href="styles.css?v=10"> → <style>...</style>
  html = html.replace(
    /<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi,
    (whole, href) => {
      if (href.startsWith('http')) return whole;
      const file = path.join(DIR, href.split('?')[0]);
      const css = inlineCss(fs.readFileSync(file, 'utf-8'), null);
      return `<style>\n${css}\n</style>`;
    }
  );

  // 2) 외부 스크립트(React·Babel) → 내용을 그대로 삽입.
  //    integrity/crossorigin은 원격 파일용 검증이라 내장 후엔 의미가 없어 제거한다.
  html = html.replace(
    /<script\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["'][^>]*><\/script>/gi,
    (whole, url) => `<script>\n${download(url).toString('utf-8')}\n</script>`
  );

  // 3) <script type="text/babel" src="shared.jsx?v=140"> → 코드 삽입 + 이미지 내장
  html = html.replace(
    /<script\b([^>]*\btype=["']text\/babel["'][^>]*)\bsrc=["']([^"']+)["']([^>]*)><\/script>/gi,
    (whole, pre, src, post) => {
      const file = path.join(DIR, src.split('?')[0]);
      const code = inlineAssetsInCode(fs.readFileSync(file, 'utf-8'));
      const attrs = (pre + post).replace(/\s+/g, ' ').trim();
      return `<script ${attrs} data-presets="react">\n${code}\n</script>`;
    }
  );

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, outName);
  fs.writeFileSync(outPath, html, 'utf-8');

  // 검증: 남아 있는 외부 참조가 있으면 경고한다(= 인터넷 없으면 깨진다는 뜻)
  const leftovers = html.match(/(?:src|href)=["']https?:\/\/[^"']+/gi) || [];
  console.log(`  완료 — ${(html.length / 1024 / 1024).toFixed(1)}MB`);
  if (leftovers.length) {
    console.log(`  남은 외부 참조 ${leftovers.length}건:`);
    leftovers.forEach((l) => console.log(`    ${l.slice(0, 90)}`));
  } else {
    console.log('  남은 외부 참조 없음 — 인터넷 없이 열립니다.');
  }
  return outPath;
}

for (const [src, out] of TARGETS) build(src, out);
console.log('\n모두 완료.');
