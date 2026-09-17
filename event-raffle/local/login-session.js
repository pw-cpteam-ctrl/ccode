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
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { applyStealth, launchLoginBrowser, closeLoginBrowser } = require('./browser-stealth');

const 로그인주소 = 'https://www.instagram.com/accounts/login/';
const 저장경로 = path.join(__dirname, 'instagram-session.json');
const 프로필폴더 = path.join(__dirname, 'chrome-profile', 'instagram');

/* 인스타에 로그인된 브라우저는 `sessionid` 쿠키를 갖는다. 그게 생겼는지만 본다.
   ⚠️ 예전엔 화면 모양으로 판단했다 — "주소가 /accounts/login이 아니고 아이디 입력칸이
   없으면 로그인 끝". 그런데 인스타가 로그인 주소를 홈으로 넘겨버리는 경우가 있어서,
   사용자가 아이디를 치기도 전에 그 조건이 참이 됐다. 그러면 빈 로그인 정보를 저장하고
   창을 닫아버린 뒤 "저장했어요"라고 알렸다. 실제로 사용자가 세 번 넘게 로그인했는데도
   매번 실패한 원인이 이것이었다. 화면 모양은 인스타 사정에 따라 바뀌지만 쿠키는
   "로그인됐다"는 사실 그 자체라서, 이제 그것만 믿는다. */
async function 로그인될때까지기다리기(context, page, 제한분 = 10) {
  const 끝시각 = Date.now() + 제한분 * 60000;
  let 안내한적 = false;
  while (Date.now() < 끝시각) {
    try {
      const 쿠키 = await context.cookies('https://www.instagram.com');
      if (쿠키.some((c) => c.name === 'sessionid' && c.value)) {
        await page.waitForTimeout(3000);   // 나머지 쿠키도 자리잡을 시간
        return true;
      }
      if (!안내한적) {
        console.log('창에서 로그인해주세요. 로그인이 끝나면 자동으로 감지합니다. (최대 10분 대기)');
        안내한적 = true;
      }
    } catch (e) { /* 이동 중이거나 창이 잠깐 바쁜 상태 — 계속 기다림 */ }
    await page.waitForTimeout(2000);
  }
  return false;
}

/* 저장한 파일에 진짜 로그인 정보가 들어갔는지 확인한다.
   저장은 됐는데 알맹이가 없는 채로 "✅ 저장했어요"라고 알리면, 사용자는 로그인이 된 줄
   알고 수집을 누르고, 거기서야 실패한다. 어디가 잘못됐는지도 모른 채로.
   ※ 쿠키 "이름"만 출력한다 — 값은 로그인 그 자체라 화면에도 기록에도 남기면 안 된다. */
function 저장된것확인(경로) {
  const 저장본 = JSON.parse(fs.readFileSync(경로, 'utf-8'));
  const 인스타쿠키 = (저장본.cookies || [])
    .filter((c) => String(c.domain || '').replace(/^\./, '').endsWith('instagram.com'));
  const 세션있음 = 인스타쿠키.some((c) => c.name === 'sessionid' && c.value);
  return { 세션있음, 이름들: 인스타쿠키.map((c) => c.name) };
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

  const 됐다 = await 로그인될때까지기다리기(context, page);
  if (!됐다) {
    if (터미널에서실행) await 엔터기다리기('시간이 오래 걸리네요. 로그인 끝냈으면 엔터를 눌러주세요: ');
    else throw new Error('10분 안에 로그인이 확인되지 않았어요. 창에서 로그인을 끝까지 마친 뒤 다시 시도해주세요.');
  }

  await context.storageState({ path: 저장경로 });

  // 저장했다고 말하기 전에, 진짜 들어갔는지 열어서 확인한다
  const { 세션있음, 이름들 } = 저장된것확인(저장경로);
  if (!세션있음) {
    // 알맹이 없는 파일을 남겨두면 화면이 "로그인해둔 게 있어요"라고 잘못 안내한다
    try { fs.unlinkSync(저장경로); } catch (e) { /* 지우기 실패해도 아래 안내는 나간다 */ }
    console.error('❌ 저장은 했는데 인스타 로그인 정보(sessionid)가 안 들어있어요.');
    console.error(`   저장된 인스타 쿠키: ${이름들.join(', ') || '(하나도 없음)'}`);
    console.error('   창에서 로그인을 끝까지 마치지 않았을 가능성이 커요. 다시 시도해주세요.');
    throw new Error('로그인 정보가 비어 있어요.');
  }
  console.log(`✅ 로그인 정보를 저장했어요 (인스타 쿠키 ${이름들.length}개). 이제 댓글 수집을 쓸 수 있습니다.`);

  // 창 닫기가 간혹 안 끝나고 멈추는 경우가 있어서, 저장이 끝났으면 기다리다 그냥 종료한다
  await closeLoginBrowser({ context, browser });
  process.exit(0);
}

main().catch((err) => {
  console.error(`❌ 로그인 실패: ${err.message}`);
  process.exit(1);
});
