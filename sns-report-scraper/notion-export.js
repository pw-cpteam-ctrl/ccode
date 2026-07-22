/**
 * 리포트 랭킹표를 스크린샷이 아니라 진짜 노션 표로 직접 만들어서 지정한 노션 페이지 밑에
 * 새 하위 페이지로 생성함. 노션 안에서 그대로 검색/정렬/편집까지 가능해짐.
 *
 * 사전 준비 (한 번만, 배포-패키지-만들기.md 참고):
 *  1. https://www.notion.so/my-integrations 에서 연동 만들고 "Internal Integration Secret" 복사
 *  2. 표를 넣을 노션 페이지 열어서 "···" → "연결(Connections)" → 방금 만든 연동 추가
 *  3. 이 폴더에 notion-config.json 파일을 새로 만들고 아래 형식으로 채우기(이 파일은 git에
 *     안 올라가게 이미 .gitignore에 등록돼 있음 — 토큰이 든 파일이라 절대 커밋하면 안 됨):
 *     { "token": "ntn_...", "parentPageId": "노션 페이지 URL 끝의 32자리 ID" }
 *
 * 사용법: node notion-export.js
 */
const fs = require('fs');
const { buildComparisonReport, applyManualPosts } = require('./aggregate');

const CONFIG_PATH = './notion-config.json';
const CACHE_PATH = './reports/_last-collection.json';
const MANUAL_MATCHES_PATH = './manual-matches.json';
const IGNORE_POSTS_PATH = './ignore-posts.json';
const MANUAL_POSTS_PATH = './manual-posts.json';
const NOTION_VERSION = '2022-06-28';

const FIELD_LABELS = { likes: '좋아요', retweets: '리트윗', comments: '댓글' };
const PLATFORM_TITLES = { twitter: 'X(트위터)', instagram: '인스타그램' };

function loadJson(p, fallback) {
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : fallback;
}

// 노션 표 셀은 리치 텍스트 배열만 담을 수 있음(이미지/버튼/막대그래프 불가) — url을 주면
// 그 텍스트가 클릭 가능한 링크가 됨(게시물 원문 바로가기 용도).
function richText(content, url) {
  const text = { content: String(content ?? '') };
  if (url) text.link = { url };
  return [{ type: 'text', text }];
}

function buildPlatformTable(platformReport) {
  const { fields, productComparison } = platformReport;
  const products = productComparison.products;
  const headers = [
    '순위', 'IP', '시리즈',
    ...fields.flatMap(f => [`PW ${FIELD_LABELS[f] || f}`, `BH ${FIELD_LABELS[f] || f}`]),
    '결과', 'PW 링크', 'BH 링크',
  ];

  const headerRow = { object: 'block', type: 'table_row', table_row: { cells: headers.map(h => richText(h)) } };

  const rows = products.map((p, i) => {
    const cells = [richText(i + 1), richText(p.ip), richText(p.line || '-')];
    fields.forEach(f => {
      cells.push(richText(p.own[`total_${f}`] ?? 0));
      cells.push(richText(p.competitor[`total_${f}`] ?? 0));
    });
    cells.push(richText(p.verdict + (p.needsReview ? ' ⚠️확인필요' : '')));
    const pwLink = p.ownPosts && p.ownPosts[0] ? p.ownPosts[0].link : null;
    const bhLink = p.competitorPosts && p.competitorPosts[0] ? p.competitorPosts[0].link : null;
    cells.push(pwLink ? richText('보기', pwLink) : richText('-'));
    cells.push(bhLink ? richText('보기', bhLink) : richText('-'));
    return { object: 'block', type: 'table_row', table_row: { cells } };
  });

  return {
    object: 'block',
    type: 'table',
    table: { table_width: headers.length, has_column_header: true, has_row_header: false, children: [headerRow, ...rows] },
  };
}

async function notionRequest(urlPath, token, body) {
  const res = await fetch(`https://api.notion.com/v1${urlPath}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`노션 API 오류(${res.status}): ${json.message || JSON.stringify(json)}`);
  return json;
}

// rebuild-report.js와 동일한 방식으로 최근 수집 캐시를 읽어서 report 객체로 취합.
// API 방식(main)과 복사-붙여넣기용 마크다운 방식(buildMarkdownExport) 둘 다 여기서 시작함.
function loadReport() {
  if (!fs.existsSync(CACHE_PATH)) {
    throw new Error(`캐시 파일이 없음: ${CACHE_PATH} — 먼저 수집을 한 번 해야 함`);
  }
  const cached = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
  const manualMatches = loadJson(MANUAL_MATCHES_PATH, {});
  const ignorePosts = loadJson(IGNORE_POSTS_PATH, {});
  const manualPosts = loadJson(MANUAL_POSTS_PATH, {});
  const { own, competitors } = applyManualPosts(cached.own, cached.competitors, manualPosts);
  return buildComparisonReport({ startDate: cached.startDate, endDate: cached.endDate, own, competitors, manualMatches, ignorePosts });
}

// 표준 마크다운 표(파이프 구분)로 변환 — 노션에 붙여넣으면(Ctrl+V) 자동으로 진짜 표로
// 바뀜(연동/토큰/관리자 승인 전혀 필요 없는 방식). "|"가 본문에 섞이면 표가 깨지므로 이스케이프.
function escapeMdCell(v) {
  return String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function buildPlatformMarkdown(platformReport) {
  const { fields, productComparison } = platformReport;
  const products = productComparison.products;
  const headers = ['순위', 'IP', '시리즈', ...fields.flatMap(f => [`PW ${FIELD_LABELS[f] || f}`, `BH ${FIELD_LABELS[f] || f}`]), '결과'];
  const lines = [
    `| ${headers.join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
  ];
  products.forEach((p, i) => {
    const cells = [i + 1, p.ip, p.line || '-'];
    fields.forEach(f => {
      cells.push(p.own[`total_${f}`] ?? 0);
      cells.push(p.competitor[`total_${f}`] ?? 0);
    });
    cells.push(p.verdict + (p.needsReview ? ' ⚠️확인필요' : ''));
    lines.push(`| ${cells.map(escapeMdCell).join(' | ')} |`);
  });
  return lines.join('\n');
}

function buildMarkdownExport(report) {
  const parts = [`**수집 기간**: ${report.startDate} ~ ${report.endDate} · 생성: ${report.generatedAt} · PW=자사, BH=경쟁사`];
  for (const platformKey of Object.keys(report.platforms)) {
    const title = PLATFORM_TITLES[platformKey] || platformKey;
    parts.push(`\n### [${title}] 상품별 비교\n`);
    parts.push(buildPlatformMarkdown(report.platforms[platformKey]));
  }
  return parts.join('\n');
}

async function main() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`❌ ${CONFIG_PATH} 파일이 없음 — 파일 맨 위 주석의 사전 준비 단계부터 먼저 해야 함.`);
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  if (!config.token || !config.parentPageId) {
    console.error('❌ notion-config.json 안에 token과 parentPageId가 둘 다 있어야 함');
    process.exit(1);
  }

  const report = loadReport();

  const children = [
    { object: 'block', type: 'paragraph', paragraph: { rich_text: richText(`수집 기간: ${report.startDate} ~ ${report.endDate} · 생성: ${report.generatedAt} · PW=자사, BH=경쟁사`) } },
  ];
  for (const platformKey of Object.keys(report.platforms)) {
    const title = PLATFORM_TITLES[platformKey] || platformKey;
    children.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: richText(`[${title}] 상품별 비교`) } });
    children.push(buildPlatformTable(report.platforms[platformKey]));
  }

  console.log('노션에 페이지 생성 중...');
  const page = await notionRequest('/pages', config.token, {
    parent: { page_id: config.parentPageId },
    icon: { type: 'emoji', emoji: '📊' },
    properties: { title: { title: richText(`SNS 성과 비교 (${report.startDate}~${report.endDate})`) } },
    children,
  });
  console.log(`✅ 노션 페이지 생성 완료: ${page.url}`);
}

if (require.main === module) {
  main().catch(err => {
    console.error('❌ 실패:', err.message);
    process.exit(1);
  });
}

module.exports = { buildPlatformTable, richText, loadReport, buildMarkdownExport };
