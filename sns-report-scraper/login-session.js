/**
 * 세션 파일(x-session.json/instagram-session.json) 만료됐을 때 다시 만드는 반자동 도우미.
 * 지금까지 하던 "F12 → Application → Cookies 표 전체선택/복사 → table-cookies-to-storage-state.js
 * 변환" 과정을 없애고, Playwright가 브라우저 창을 띄워주면 거기서 로그인만(2단계인증 있으면
 * 그것도 그대로) 하고 터미널에서 엔터 치면 그 시점 세션을 storageState로 바로 저장해줌.
 *
 * 로그인 자체는 사용자가 실제 브라우저 창에서 직접 하는 것 — 자동입력/자동로그인이 아님.
 * (자동 로그인은 메타/X의 봇 탐지에 더 잘 걸려서 오히려 세션이 더 자주 끊길 위험이 있음.
 * 지금처럼 "사람이 직접 로그인한 세션 재사용" 방식이 봇 탐지 관점에서 더 안전 — PLAN.md 참고)
 *
 * 사용법:
 *   node login-session.js instagram
 *   node login-session.js twitter
 */
const path = require('path');
const readline = require('readline');
const { applyStealth, launchLoginBrowser, closeLoginBrowser } = require('./browser-stealth');

const PLATFORMS = {
  instagram: {
    url: 'https://www.instagram.com/accounts/login/',
    outputPath: './instagram-session.json',
    profileDir: path.join(__dirname, 'chrome-profile', 'instagram'),
  },
  twitter: {
    url: 'https://x.com/login',
    outputPath: './x-session.json',
    profileDir: path.join(__dirname, 'chrome-profile', 'twitter'),
  },
};

function waitForEnter(message) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  const platform = process.argv[2];
  const config = PLATFORMS[platform];
  if (!config) {
    console.error(`❌ 사용법: node login-session.js <${Object.keys(PLATFORMS).join('|')}>`);
    process.exit(1);
  }

  // 로그인은 이 컴퓨터에 설치된 진짜 크롬을(이 프로그램 전용 프로필로) 열어서 진행함 —
  // Playwright 내장 브라우저보다 실제 사람이 쓰는 브라우저에 훨씬 가까워서, 비번이 맞는데도
  // 자동화로 의심돼 로그인이 거부되는 문제를 줄여줌(2026-07-20 실제 발생 사례로 확인).
  // 이 프로필 폴더는 평소 쓰는 크롬 프로필과 완전히 분리돼 있어서 서로 충돌 없음.
  const { context, browser } = await launchLoginBrowser(config.profileDir);
  await applyStealth(context);
  const page = await context.newPage();
  await page.goto(config.url);

  console.log(`\n브라우저 창에서 ${platform} 로그인을 직접 진행해줘 (2단계인증/보안 확인 있으면 그것도 그대로 진행).`);
  await waitForEnter('로그인 다 끝났으면 여기서 엔터 눌러줘 (로그인된 상태에서 세션을 저장함): ');

  await context.storageState({ path: config.outputPath });
  console.log(`✅ 세션 저장 완료: ${config.outputPath}`);

  // browser.close()가 간혹 안 끝나고 멈추는 경우가 있어서(대시보드에서 이 스크립트를
  // 자식 프로세스로 띄워두는데, 이러면 세션은 이미 저장됐는데도 프로세스가 안 죽어서
  // "진행 중" 상태가 영원히 안 풀리는 문제로 이어짐) — 중요한 건 세션 저장이지 브라우저를
  // 깔끔하게 닫는 게 아니므로, 일정 시간 기다려도 안 끝나면 그냥 넘어가고 프로세스를
  // 강제로 종료함(진짜 크롬 모드는 browser가 없고 context.close()만으로 충분 — closeLoginBrowser가
  // 내부적으로 분기 처리).
  await closeLoginBrowser({ context, browser });
  process.exit(0);
}

main().catch(err => {
  console.error('❌ 실패:', err.message);
  process.exit(1);
});
