/**
 * 브랜드(메가하우스 / 굿스마일 …)별 설정을 한곳에서 읽어주는 모듈.
 *
 * 왜 필요한가: 예전엔 수집 계정·저장 경로가 전부 run-megahouse.js 안에 메가하우스 전용으로
 * 하드코딩돼 있었음. 여기에 브랜드를 하나 더(굿스마일) 붙이면 **같은 파일을 두 브랜드가
 * 번갈아 덮어써서** 먼저 수집한 브랜드 데이터가 사라짐(특히 수집 캐시 `_last-collection.json`,
 * 엑셀 `sns-report.xlsx`, 재고 히스토리 `_stock-history.json`). 그래서 브랜드별로
 * 폴더를 갈라서 서로 건드리지 않게 하는 것이 이 모듈의 목적.
 *
 * 브랜드 추가 방법: `brands/<키>.json` 파일 하나만 만들면 됨(코드 수정 불필요).
 *
 * ⚠️ 브랜드 설정 파일은 **사용자 데이터**로 취급함(계정 아이디·스토어 주소를 직접 채우는
 * 파일이라서). 저장소에는 `brands/templates/<키>.json`이라는 틀만 들어있고, 처음 실행할 때
 * 그 틀을 `brands/<키>.json`으로 복사해준다. 이렇게 나눠둔 이유: update.bat이 저장소 파일을
 * 설치 폴더에 덮어쓰는 방식이라, 설정 파일이 저장소에 있으면 사용자가 채워넣은 계정 아이디가
 * 업데이트 한 번에 초기화돼버림(실제로 겪기 쉬운 사고라 구조적으로 막아둠).
 *
 * 저장 위치 규칙
 *   brands/templates/<키>.json    — 저장소가 들고 다니는 설정 틀(업데이트로 갱신됨)
 *   brands/<키>.json              — 실제로 쓰는 설정(사용자가 편집, 업데이트에도 안 덮어써짐)
 *   reports/<브랜드키>/            — 수집 캐시·엑셀·HTML 리포트·재고 히스토리(브랜드별 격리)
 *   brands/<브랜드키>/             — 사람이 직접 손보는 수동 매칭/제외 목록
 */
const fs = require('fs');
const path = require('path');

const BRANDS_DIR = path.join(__dirname, 'brands');
const TEMPLATES_DIR = path.join(BRANDS_DIR, 'templates');
const REPORTS_DIR = path.join(__dirname, 'reports');
// 브랜드를 안 지정하고 실행했을 때(예전 방식대로 `node run-megahouse.js today`) 쓰는 브랜드 —
// 기존 사용자가 갑자기 다른 동작을 겪지 않게 메가하우스로 고정.
const DEFAULT_BRAND = 'megahouse';

/**
 * 브랜드 개념이 없던 시절(2026-09 이전) 파일 위치 → 브랜드 폴더 안 위치 대응표.
 * 기존 사용자의 PC에는 이 경로에 실제 데이터(재고 스냅샷 히스토리, 엑셀 누적분 등)가
 * 쌓여 있어서, 그냥 새 경로로 바꾸면 사용자 입장에선 "데이터가 다 날아간" 것처럼 보임.
 * 그래서 첫 실행 때 자동으로 브랜드 폴더로 **복사**함(원본은 그대로 남겨둠 — 혹시 잘못돼도
 * 되돌릴 수 있게).
 */
const LEGACY_FILES = [
  { from: ['reports', '_last-collection.json'], to: ['reports', '<brand>', '_last-collection.json'] },
  { from: ['reports', '_stock-history.json'], to: ['reports', '<brand>', '_stock-history.json'] },
  { from: ['reports', 'sns-report.xlsx'], to: ['reports', '<brand>', 'sns-report.xlsx'] },
  { from: ['manual-matches.json'], to: ['brands', '<brand>', 'manual-matches.json'] },
  { from: ['ignore-posts.json'], to: ['brands', '<brand>', 'ignore-posts.json'] },
  { from: ['manual-posts.json'], to: ['brands', '<brand>', 'manual-posts.json'] },
];
const LEGACY_DIRS = [
  { from: ['reports', 'period-cache'], to: ['reports', '<brand>', 'period-cache'] },
];

function brandFilePath(key) {
  return path.join(BRANDS_DIR, `${key}.json`);
}

/**
 * 저장소가 들고 있는 설정 틀(brands/templates/*.json)을 실제 설정 파일(brands/*.json)로
 * 복사 — 이미 있으면 절대 건드리지 않음(사용자가 채운 계정이 날아가면 안 되므로).
 * @returns {string[]} 새로 만들어진 브랜드 키 목록
 */
function ensureBrandFiles() {
  if (!fs.existsSync(TEMPLATES_DIR)) return [];
  fs.mkdirSync(BRANDS_DIR, { recursive: true });
  const created = [];
  for (const f of fs.readdirSync(TEMPLATES_DIR)) {
    if (!f.endsWith('.json')) continue;
    const key = f.replace(/\.json$/, '');
    const dest = brandFilePath(key);
    if (fs.existsSync(dest)) continue;
    fs.copyFileSync(path.join(TEMPLATES_DIR, f), dest);
    created.push(key);
  }
  return created;
}

/** 설치된 브랜드 목록(대시보드 선택 메뉴용). brands/*.json 파일이 곧 목록임. */
function listBrands() {
  ensureBrandFiles();
  if (!fs.existsSync(BRANDS_DIR)) return [];
  return fs.readdirSync(BRANDS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const key = f.replace(/\.json$/, '');
      const raw = JSON.parse(fs.readFileSync(path.join(BRANDS_DIR, f), 'utf-8'));
      const accounts = [...(raw.own || []), ...(raw.competitors || [])];
      return {
        key,
        label: raw.label || key,
        // 계정 핸들이 아직 안 채워진 브랜드는 대시보드에서 "설정 필요"로 표시해야 하므로
        // 준비 여부를 같이 알려줌(빈 문자열이면 미설정).
        ready: accounts.length > 0 && accounts.every(a => a.account),
        accountCount: accounts.filter(a => a.account).length,
        hasStock: (raw.stockStores || []).some(s => s.url),
        datePresets: raw.datePresets || [],
        defaultDateMode: raw.defaultDateMode || 'custom',
      };
    })
    .sort((a, b) => (a.key === DEFAULT_BRAND ? -1 : b.key === DEFAULT_BRAND ? 1 : a.label.localeCompare(b.label)));
}

/**
 * 브랜드 설정 + 그 브랜드가 쓸 모든 파일 경로를 계산해서 돌려줌.
 * @param {string} [key] 브랜드 키(brands/<키>.json). 생략하면 메가하우스.
 */
function loadBrand(key = DEFAULT_BRAND) {
  ensureBrandFiles();
  const file = brandFilePath(key);
  if (!fs.existsSync(file)) {
    const available = listBrands().map(b => b.key).join(', ') || '(없음)';
    throw new Error(`브랜드 설정 파일이 없음: brands/${key}.json (설치된 브랜드: ${available})`);
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const dataDir = path.join(REPORTS_DIR, key);
  const configDir = path.join(BRANDS_DIR, key);

  return {
    key,
    label: raw.label || key,
    own: raw.own || [],
    competitors: raw.competitors || [],
    stockStores: (raw.stockStores || []).filter(s => s && s.url),
    datePresets: raw.datePresets || [],
    defaultDateMode: raw.defaultDateMode || 'custom',
    // 리포트에 재고를 어떻게 넣을지 기본값 — 'none'(안 넣음) 또는 'ratio'(비율·지수만).
    // 절대 수량은 대외비로 취급해서 리포트 파일에 아예 안 심는 것이 방침(html-report.js 참고).
    defaultStockMode: raw.defaultStockMode || 'ratio',
    paths: {
      dataDir,
      configDir,
      cache: path.join(dataDir, '_last-collection.json'),
      stockHistory: path.join(dataDir, '_stock-history.json'),
      lastRun: path.join(dataDir, '_last-run.json'),
      excel: path.join(dataDir, 'sns-report.xlsx'),
      periodCacheDir: path.join(dataDir, 'period-cache'),
      periodExcel: path.join(dataDir, 'period-comparison.xlsx'),
      htmlDir: dataDir,
      htmlBaseName: 'sns-report',
      manualMatches: path.join(configDir, 'manual-matches.json'),
      ignorePosts: path.join(configDir, 'ignore-posts.json'),
      manualPosts: path.join(configDir, 'manual-posts.json'),
    },
  };
}

/**
 * 브랜드 폴더가 없으면 만들고, 예전(브랜드 없던 시절) 데이터가 있으면 브랜드 폴더로 복사.
 * 이미 브랜드 폴더에 같은 파일이 있으면 절대 건드리지 않음(덮어쓰기 금지 — 데이터 유실 방지).
 * @returns {string[]} 사람이 읽을 이관 로그(없으면 빈 배열)
 */
function ensureBrandDirs(brand) {
  fs.mkdirSync(brand.paths.dataDir, { recursive: true });
  fs.mkdirSync(brand.paths.configDir, { recursive: true });

  // 예전 데이터 이관은 기본 브랜드(메가하우스)만 해당 — 굿스마일 등 나중에 추가된 브랜드는
  // 예전 데이터가 있을 수 없음.
  if (brand.key !== DEFAULT_BRAND) return [];

  const logs = [];
  const resolve = parts => path.join(__dirname, ...parts.map(p => (p === '<brand>' ? brand.key : p)));

  for (const { from, to } of LEGACY_FILES) {
    const src = resolve(from);
    const dest = resolve(to);
    if (!fs.existsSync(src) || fs.existsSync(dest)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    logs.push(`${path.relative(__dirname, src)} → ${path.relative(__dirname, dest)}`);
  }

  for (const { from, to } of LEGACY_DIRS) {
    const srcDir = resolve(from);
    const destDir = resolve(to);
    if (!fs.existsSync(srcDir)) continue;
    fs.mkdirSync(destDir, { recursive: true });
    for (const f of fs.readdirSync(srcDir)) {
      const src = path.join(srcDir, f);
      const dest = path.join(destDir, f);
      if (!fs.statSync(src).isFile() || fs.existsSync(dest)) continue;
      fs.copyFileSync(src, dest);
      logs.push(`${path.relative(__dirname, src)} → ${path.relative(__dirname, dest)}`);
    }
  }

  return logs;
}

/** 브랜드 폴더 준비 + 이관 결과를 콘솔에 사람 말로 알려줌(스크립트 시작부에서 호출). */
function prepareBrand(key) {
  const created = ensureBrandFiles();
  created.forEach(k => console.log(`🆕 브랜드 설정 파일 생성: brands/${k}.json (계정 아이디는 이 파일에 채우면 되고, 업데이트해도 덮어써지지 않습니다)`));
  const brand = loadBrand(key);
  const migrated = ensureBrandDirs(brand);
  if (migrated.length > 0) {
    console.log(`📦 예전 데이터를 [${brand.label}] 폴더로 옮겨왔음(${migrated.length}건):`);
    migrated.forEach(line => console.log(`   · ${line}`));
    console.log('   예전 파일은 그대로 남겨뒀으니, 정상 동작 확인한 뒤 지워도 됩니다.');
  }
  return brand;
}

/**
 * 커맨드라인 인자에서 브랜드 키를 뽑아냄 (`brand=goodsmile` 또는 `--brand=goodsmile`).
 * @returns {{ brandKey: string, rest: string[] }} 브랜드 인자를 제거한 나머지 인자 목록
 */
function parseBrandArg(args) {
  const rest = [];
  let brandKey = DEFAULT_BRAND;
  for (const arg of args) {
    const m = /^--?brand=(.+)$/.exec(arg) || /^brand=(.+)$/.exec(arg);
    if (m) brandKey = m[1];
    else rest.push(arg);
  }
  return { brandKey, rest };
}

/** 마지막으로 수집을 끝낸 기간을 기록 — "마지막 수집 이후 전부" 버튼이 이걸 보고 시작일을 정함. */
function saveLastRun(brand, { startDate, endDate }) {
  fs.mkdirSync(path.dirname(brand.paths.lastRun), { recursive: true });
  fs.writeFileSync(brand.paths.lastRun, JSON.stringify({ startDate, endDate, savedAt: new Date().toISOString() }, null, 2));
}

function readLastRun(brand) {
  if (!fs.existsSync(brand.paths.lastRun)) return null;
  try {
    return JSON.parse(fs.readFileSync(brand.paths.lastRun, 'utf-8'));
  } catch {
    return null; // 파일이 깨져 있어도 수집 자체를 막을 이유는 없음
  }
}

module.exports = {
  BRANDS_DIR,
  TEMPLATES_DIR,
  ensureBrandFiles,
  REPORTS_DIR,
  DEFAULT_BRAND,
  listBrands,
  loadBrand,
  ensureBrandDirs,
  prepareBrand,
  parseBrandArg,
  saveLastRun,
  readLastRun,
};
