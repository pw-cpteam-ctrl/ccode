/**
 * 인스타 로그인 1회 도우미 — 브라우저 창이 뜨면 사람이 직접 로그인하고, 그 시점의
 * 로그인 상태를 파일로 저장해둔다. 이후 수집할 때는 그 파일만 물려주면 로그인된 상태로
 * 시작한다(며칠~몇 주 감. 풀리면 다시 이 버튼을 누르면 됨).
 *
 * 자동 로그인은 일부러 안 한다 — 아이디·비번을 프로그램이 대신 입력하면 봇으로 더 잘
 * 걸려서 오히려 세션이 자주 끊긴다. 사람이 직접 로그인한 세션을 재사용하는 쪽이 안전하다.
 * (같은 저장소 `sns-report-scraper`에서 검증된 방식을 이 프로젝트용으로 옮겨온 것)
 *
 * 사용법: node login-session.js        (대시보드의 "인스타 로그인" 버튼이 이걸 실행함)
 */
const path = require('path');
const readline = require('readline');
const { applyStealth, launchLoginBrowser, closeLoginBrowser } = require('./browser-stealth');

const 로그인주소 = 'https://www.instagram.com/accounts/login/';
const 저장경로 = path.join(__dirname, 'instagram-session.json');
const 프로필폴더 = path.join(__dirname, 'chrome-profile', 'instagram');

// 대시보드에서 실행할 땐 터미널에 엔터를 칠 수 없으므로, 로그인이 끝난 걸 스스로 알아챈다.
async function 로그인될때까지기다리기(page, 제한분 = 10) {
  const 끝시각 = Date.now() + 제한분 * 60000;
  while (Date.now() < 끝시각) {
    try {
      const 됐나 = await page.evaluate(() =>
        !/\/accounts\/(login|emailsignup)/.test(location.pathname) &&
        !document.querySelector('input[name="username"]'));
      if (됐나) {
        await page.waitForTimeout(3000);   // 로그인 직후 쿠키가 다 자리잡을 시간
        return true;
      }
    } catch (e) { /* 이동 중이면 잠깐 실패할 수 있음 — 계속 기다림 */ }
    await page.waitForTimeout(2000);
  }
  return false;
}

function 엔터기다리기(안내) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(안내, () => { rl.close(); resolve(); });
  });
}

async function main() {
  const 터미널에서실행 = process.stdin.isTTY;
  console.log('크롬 창을 엽니다. 그 창에서 인스타그램에 직접 로그인해주세요.');
  console.log('(2단계 인증이 있으면 그것까지 끝내면 됩니다. 자동으로 감지해서 저장해요.)');

  const { context, browser } = await launchLoginBrowser(프로필폴더);
  await applyStealth(context);
  const page = await context.newPage();
  await page.goto(로그인주소);

  const 됐다 = await 로그인될때까지기다리기(page);
  if (!됐다) {
    if (터미널에서실행) await 엔터기다리기('시간이 오래 걸리네요. 로그인 끝냈으면 엔터를 눌러주세요: ');
    else throw new Error('10분 안에 로그인이 확인되지 않았어요. 다시 시도해주세요.');
  }

  await context.storageState({ path: 저장경로 });
  console.log(`✅ 로그인 정보를 저장했어요. 이제 댓글 수집을 쓸 수 있습니다.`);

  // 창 닫기가 간혹 안 끝나고 멈추는 경우가 있어서, 저장이 끝났으면 기다리다 그냥 종료한다
  await closeLoginBrowser({ context, browser });
  process.exit(0);
}

main().catch((err) => {
  console.error(`❌ 로그인 실패: ${err.message}`);
  process.exit(1);
});
