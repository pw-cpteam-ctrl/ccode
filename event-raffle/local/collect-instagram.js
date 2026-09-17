/**
 * 인스타 댓글 수집기 — 브라우저를 열어 게시물의 댓글을 전부 읽어온다.
 *
 * 화면에서 댓글을 찾는 방법은 기존에 쓰던 크롬 확장("인스타그램 댓글 추출기")이 쓰던
 * 방식을 그대로 옮겨왔다. 그 방식이 실사용에서 9할 이상 잘 걸러냈기 때문에 새로 고안하지
 * 않고 검증된 쪽을 따랐다. 핵심은 "클래스 이름에 매달리지 않는다"는 것:
 *   - 댓글 목록  : 페이지의 모든 ul 중 "시간표시 + 프로필링크"를 가장 많이 가진 ul을 고름
 *   - 작성자     : 프로필 주소 모양(/아이디/)인 링크. privacy·terms 같은 안내 페이지는 제외
 *   - 본문       : 작성자 링크에서 부모를 거슬러 올라가며 시간표시를 품은 덩어리를 찾음
 *   - 답글 펼치기: "답글 보기" / "View all N replies" 같은 문구로 버튼을 찾아 누름
 * 인스타가 클래스 이름을 수시로 난수로 바꿔도 이 구조 자체는 잘 안 바뀐다.
 *
 * 사용법: node collect-instagram.js "<게시물주소>" [옵션JSON]
 *   옵션: { "대댓글포함": true, "주인댓글제외": true, "멘션2배": false }
 * 결과: 마지막 줄에 "__RESULT__" 뒤로 JSON 한 줄 (진행 상황은 그 앞에 사람이 읽는 글로 출력)
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { applyStealth, STEALTH_LAUNCH_ARGS, STEALTH_CONTEXT_OPTIONS } = require('./browser-stealth');

const 세션파일 = path.join(__dirname, 'instagram-session.json');
const 최대대기_분 = 20;        // 이 시간이 지나면 그때까지 모은 것만 들고 끝냄
const 정체판정_횟수 = 6;       // 몇 번 연속으로 댓글 수가 안 늘면 "다 불러왔다"고 봄

const 로그 = (글) => { console.log(글); };

/* ────────────────────────────────────────────────────────────────
   화면에서 댓글을 읽어내는 부분 — 브라우저 안에서 통째로 실행된다.
   (바깥 코드와 변수를 공유할 수 없어서 하나의 함수로 묶여 있음)
   ──────────────────────────────────────────────────────────────── */
function 화면에서읽기(옵션) {
  // 프로필 주소가 아닌 인스타 자체 페이지들 — 작성자 링크로 오인하면 안 됨
  const 아이디아님 = new Set(['p', 'reel', 'reels', 'explore', 'stories', 'accounts', 'direct',
    'legal', 'privacy', 'terms', 'help', 'support', 'tv', 'about', 'developer', 'api']);

  const 프로필주소인가 = (주소) => {
    if (!주소 || typeof 주소 !== 'string') return false;
    const m = 주소.split('?')[0].match(/^\/([A-Za-z0-9._]+)\/?$/);
    return !!m && !아이디아님.has(m[1].toLowerCase());
  };

  // 댓글 한 줄에서 작성자 링크 찾기
  const 작성자링크 = (줄) => {
    if (!줄) return null;
    const 우선 = 줄.querySelector('a._a6hd');
    if (우선 && 프로필주소인가(우선.getAttribute('href') || '')) return 우선;
    for (const a of 줄.querySelectorAll('a[href^="/"]')) {
      if (프로필주소인가(a.getAttribute('href') || '')) return a;
    }
    return null;
  };

  // 작성자 링크에서 위로 거슬러 올라가며 "시간표시를 품은 덩어리"를 찾는다 (본문이 들어있는 영역)
  const 본문덩어리 = (줄) => {
    const 앞 = 줄.querySelector('.xbmvrgn');
    if (앞 && 앞.nextElementSibling) return 앞.nextElementSibling;
    const a = 작성자링크(줄);
    if (!a) return null;
    let n = a;
    for (let i = 0; i < 28 && n && n !== 줄; i++) {
      if (n.querySelector && n.querySelector('time[datetime]')) return n;
      n = n.parentElement;
    }
    return a.parentElement;
  };

  // 프로필 사진·이모티콘 이미지 주소 (본문으로 오인하면 안 됨)
  const 프로필사진인가 = (src) =>
    /cdninstagram\.com\/v\/t51\.\d+-19\//.test(src) || /profile_pic|stp=dst-jpg_s\d+x\d+/i.test(src);

  const 본문읽기 = (덩어리) => {
    const 후보 = 덩어리.querySelectorAll('div.x1nhvcw1> span.x5n08af');
    const 마지막 = 후보.length ? 후보[후보.length - 1] : null;
    const 글 = 마지막 ? 마지막.textContent.trim() : '';
    if (글) return { 글, 폴백: false };
    // 글자 없이 움짤(GIF)만 단 댓글 처리
    for (const img of 덩어리.querySelectorAll('img')) {
      const src = img.getAttribute('src') || '';
      if (src && !프로필사진인가(src) && /giphy|fbcdn\.net\/emg|tenor|\.gif(\?|$|&)/i.test(src)) {
        return { 글: '움짤', 폴백: false };
      }
    }
    // 예비 경로 — 인스타가 클래스 이름을 갈아엎으면 위 방법이 통째로 실패해서 0명이 된다.
    // 그때를 대비해 "덩어리에서 링크·시간·버튼을 걷어낸 나머지 글자"를 본문으로 본다.
    // 링크를 먼저 지우므로 작성자 아이디가 본문으로 둔갑할 일은 없다.
    const 사본 = 덩어리.cloneNode(true);
    사본.querySelectorAll('a, time, button, [role="button"], svg, img').forEach((el) => el.remove());
    const 나머지 = (사본.textContent || '').replace(/\s+/g, ' ').trim()
      .replace(/(좋아요\s*[\d,]+개|답글 달기|번역 보기|더 보기)/g, '').trim();
    if (나머지) return { 글: 나머지, 폴백: true };
    // 여기서 "영역 전체 글자"를 그냥 쓰면 안 된다 — 작성자 아이디가 본문인 것처럼 기록돼서,
    // 못 읽은 상황이 정상처럼 위장된다. 못 읽었으면 빈 값으로 두고 그 줄은 건너뛴다.
    return { 글: '', 폴백: false };
  };

  const 시각읽기 = (덩어리, 줄) => {
    const t = (덩어리 && 덩어리.querySelector('time[datetime]')) || (줄 && 줄.querySelector('time[datetime]'));
    const raw = t ? t.getAttribute('datetime') : '';
    if (!raw) return '';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return '';
    const k = new Date(d.getTime() + 32400000);   // 한국 시간
    const p = (n) => String(n).padStart(2, '0');
    return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ` +
           `${p(k.getUTCHours())}:${p(k.getUTCMinutes())}:${p(k.getUTCSeconds())}`;
  };

  // 댓글 목록 찾기 — 클래스 이름이 맞으면 그걸 쓰고, 안 맞으면 구조로 찾는다
  const 댓글줄들 = () => {
    const 정해진 = document.querySelectorAll('.xh8yej3 > .x1iyjqo2 > .x1nhvcw1');
    if (정해진.length > 0) return Array.from(정해진);
    const 본문영역 = document.querySelector('article') || document.body;
    if (!본문영역) return [];
    // 모든 ul을 훑어서 "시간표시 + 작성자링크"를 가장 많이 가진 ul의 li들을 댓글로 본다
    let 최다 = -1, 결과 = [];
    for (const ul of 본문영역.querySelectorAll('ul')) {
      const li들 = ul.querySelectorAll(':scope > li');
      if (!li들.length) continue;
      let 점수 = 0;
      for (const li of li들) if (li.querySelector('time[datetime]') && 작성자링크(li)) 점수++;
      if (점수 > 최다) { 최다 = 점수; 결과 = Array.from(li들); }
    }
    if (최다 > 0) return 결과;
    // 그래도 못 찾으면 시간표시를 기준으로 가장 가까운 목록 항목을 모은다
    const 본 = new Set(), 모음 = [];
    for (const t of 본문영역.querySelectorAll('time[datetime]')) {
      let n = t;
      for (let i = 0; i < 28 && n; i++) {
        if (n.tagName === 'LI' || n.getAttribute?.('role') === 'listitem') {
          if (!본.has(n)) { 본.add(n); 모음.push(n); }
          break;
        }
        n = n.parentElement;
      }
    }
    return 모음;
  };

  // 한 댓글에 달린 답글(대댓글)들
  const 답글줄들 = (줄) => {
    const 정해진 = Array.from(줄.querySelectorAll('ul > div > .x1nhvcw1'));
    if (정해진.length > 0) return 정해진;
    const 본 = new Set(), 모음 = [];
    for (const ul of 줄.querySelectorAll(':scope ul')) {
      for (const li of ul.querySelectorAll(':scope > li')) {
        if (li === 줄 || 본.has(li)) continue;
        if (작성자링크(li) && li.querySelector('time[datetime]')) { 본.add(li); 모음.push(li); }
      }
    }
    return 모음;
  };

  // 게시물 주인 아이디 (주인이 단 댓글을 빼고 싶을 때 씀)
  const 주인아이디 = () => {
    const 제외 = new Set(['p', 'reel', 'stories', 'explore', 'accounts', 'direct', 'legal']);
    const 조각 = window.location.pathname.split('/').filter(Boolean);
    if (조각[0] && !제외.has(조각[0]) && (조각[1] === 'p' || 조각[1] === 'reel')) return 조각[0];
    const og = document.querySelector('meta[property="og:url"]');
    if (og) {
      const m = (og.getAttribute('content') || '').match(/instagram\.com\/([^/?]+)\/(?:p|reel)\//);
      if (m && m[1] && !제외.has(m[1])) return m[1];
    }
    const 헤더 = document.querySelector('article header a[href^="/"][role="link"]');
    if (헤더) {
      const id = (헤더.getAttribute('href') || '').replace(/^\/|\/$/g, '').split('/')[0];
      if (id && !제외.has(id)) return id;
    }
    return '';
  };

  const 아이디추출 = (a) =>
    (a.getAttribute('href') || '').split('/').filter(Boolean)[0] || a.textContent.trim();

  const 주인 = 주인아이디();
  const 결과 = [];
  // 읽지 못하고 건너뛴 줄을 센다 — 조용히 사라지면 "일부만 수집됐는데 전부인 줄" 알게 되므로
  const 건너뜀 = { 작성자못찾음: 0, 본문못읽음: 0, 주인댓글: 0, 예비경로사용: 0 };
  const 담기 = (줄, 유형) => {
    const a = 작성자링크(줄);
    if (!a) { 건너뜀.작성자못찾음++; return; }
    const 아이디 = 아이디추출(a);
    if (!아이디) { 건너뜀.작성자못찾음++; return; }
    if (옵션.주인댓글제외 && 주인 && 아이디.toLowerCase() === 주인.toLowerCase()) { 건너뜀.주인댓글++; return; }
    const 덩어리 = 본문덩어리(줄);
    if (!덩어리) { 건너뜀.본문못읽음++; return; }
    const { 글: 내용, 폴백 } = 본문읽기(덩어리);
    if (!내용) { 건너뜀.본문못읽음++; return; }
    if (폴백) 건너뜀.예비경로사용++;
    const 행 = {
      아이디,
      내용,
      시간: 시각읽기(덩어리, 줄),
      프로필: `https://www.instagram.com/${아이디.replace(/^@/, '')}`,
      유형,
    };
    결과.push(행);
    // 친구를 멘션한 댓글은 한 줄 더 넣어 당첨 확률을 두 배로 (확장의 "@친구소환 2배"와 같은 규칙)
    if (옵션.멘션2배 && 내용.includes('@')) 결과.push({ ...행, 내용: '@친구소환 보너스' });
  };

  for (const 줄 of 댓글줄들()) {
    담기(줄, '댓글');
    if (옵션.대댓글포함) for (const 답 of 답글줄들(줄)) 담기(답, '답글');
  }
  return { 행들: 결과, 주인아이디: 주인, 화면속댓글줄수: 댓글줄들().length, 건너뜀 };
}

/* ────────────────────────────────────────────────────────────────
   화면을 조작해 댓글을 끝까지 불러오는 부분
   ──────────────────────────────────────────────────────────────── */
async function 전부불러오기(page, 옵션, 스냅찍기) {
  const 시작 = Date.now();
  let 이전개수 = -1, 정체 = 0, 회차 = 0;

  while (Date.now() - 시작 < 최대대기_분 * 60000) {
    회차++;

    // ① 답글 펼치기 버튼 누르기 ("답글 보기", "View all 3 replies" 등)
    if (옵션.대댓글포함) {
      const 누른수 = await page.evaluate(() => {
        const 답글문구인가 = (글) => {
          const t = (글 || '').replace(/\s+/g, ' ').trim();
          if (!t || t.length > 160) return false;
          const 답글 = t.includes('답글') || /repl(?:y|ies)/i.test(t);
          const 보기 = t.includes('보기') || /(view|see)\b/i.test(t);
          return (답글 && 보기) || t === '모두 보기' || /^View all(\s|$)/i.test(t);
        };
        const 보이나 = (el) => {
          const s = window.getComputedStyle(el);
          if (s.display === 'none' || s.visibility === 'hidden' || s.pointerEvents === 'none') return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const 뿌리 = document.querySelector('article') || document;
        const 누를것 = new Set();
        for (const el of 뿌리.querySelectorAll('button, [role="button"], [tabindex], span, a[href]')) {
          if (!답글문구인가(el.textContent) && !답글문구인가(el.getAttribute('aria-label'))) continue;
          const 실제 = el.tagName === 'BUTTON' ? el : (el.closest('button, [role="button"], [tabindex], a[href]') || el);
          if (실제.getAttribute('aria-disabled') === 'true' || 실제.hasAttribute('disabled')) continue;
          if (보이나(실제)) 누를것.add(실제);
        }
        let n = 0;
        for (const el of 누를것) {
          // 인스타는 진짜 마우스 동작을 흉내내야 반응하는 버튼이 있어서 여러 이벤트를 같이 보냄
          const 대상 = el.querySelector?.('span') || el;
          대상.click();
          for (const [종류, 생성] of [['pointerdown', PointerEvent], ['mousedown', MouseEvent],
                                     ['mouseup', MouseEvent], ['pointerup', PointerEvent], ['click', MouseEvent]]) {
            대상.dispatchEvent(new 생성(종류, { bubbles: true, cancelable: true, view: window }));
          }
          n++;
        }
        return n;
      });
      if (누른수) 로그(`  · 답글 펼치기 ${누른수}개 눌렀어요`);
    }

    // ② 댓글 더 불러오기 (+ 버튼) 누르기
    const 더불러오기 = await page.evaluate(() => {
      const 뿌리 = document.querySelector('article') || document;
      for (const el of 뿌리.querySelectorAll('button, [role="button"]')) {
        const 라벨 = `${el.getAttribute('aria-label') || ''} ${el.textContent || ''}`;
        if (/더 불러오기|댓글 더|Load more|더보기/i.test(라벨)) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) { el.click(); return true; }
        }
      }
      return false;
    });

    // ③ 아래로 스크롤해서 다음 묶음을 불러오게 함
    await page.evaluate(() => {
      const 시간들 = document.querySelectorAll('time[datetime]');
      const 마지막 = 시간들[시간들.length - 1];
      if (마지막) 마지막.scrollIntoView({ block: 'center' });
      window.scrollBy(0, 600);
    });
    await page.waitForTimeout(1200);

    const 현재 = await page.evaluate(() => document.querySelectorAll('time[datetime]').length);
    if (현재 === 이전개수 && !더불러오기) {
      정체++;
      if (정체 >= 정체판정_횟수) { 로그(`  · 더 이상 새 댓글이 안 나와서 마칩니다 (${회차}회차)`); break; }
    } else {
      정체 = 0;
      로그(`  · ${회차}회차 — 지금까지 ${현재}개 불러옴`);
      /* 지금까지 읽은 걸 계속 저장해둔다 — 뒤에서 창이 닫혀도 여기까지는 건진다.
         초반에는 매 회차 찍는다. 창을 닫아버리는 일은 대개 시작 직후에 벌어지고
         (실제로 1회차에서 끊긴 적이 있다) 그때는 화면이 작아서 비용도 거의 없다.
         뒤로 갈수록 화면이 커지니 간격을 벌린다. */
      if (스냅찍기 && (회차 <= 10 || 회차 % 5 === 0)) await 스냅찍기();
    }
    이전개수 = 현재;
  }
}


/* 인스타그램 게시물 주소가 맞는지 제대로 확인한다.
   "주소 안에 instagram.com/p/ 라는 글자가 있나"로만 보면
   https://남의사이트.com/?x=instagram.com/p/ 같은 주소도 통과해버린다 —
   그 상태로 열면 내 인스타 로그인이 붙은 브라우저로 엉뚱한 사이트에 들어가게 된다. */
function 인스타게시물주소인가(값) {
  try {
    const u = new URL(String(값));
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    if (!['instagram.com', 'www.instagram.com'].includes(u.hostname.toLowerCase())) return false;
    const 조각 = u.pathname.split('/').filter(Boolean);
    // /p/XXXX/ · /reel/XXXX/ · /계정/p/XXXX/ · /계정/reel/XXXX/
    return (['p', 'reel'].includes(조각[0]) && Boolean(조각[1]))
        || (['p', 'reel'].includes(조각[1]) && Boolean(조각[2]));
  } catch (e) { return false; }
}

/* 브라우저를 연다 — 저장해둔 로그인 정보(세션 파일)를 물려주는 방식.
   같은 저장소 `sns-report-scraper/instagram.js`가 쓰는 것과 같은 구조이고, 그쪽에서
   실사용으로 검증된 방식이라 그대로 따른다. 한때 "로그인은 진짜 크롬 프로필, 수집은
   내장 브라우저라서 인스타가 다른 기기로 본다"고 판단해 프로필을 공유하도록 바꿨었는데,
   그건 틀린 진단이었다(그 구조로 잘 돌아가는 실제 사례가 있었음). 프로필 공유는 오히려
   "폴더를 한 프로세스만 열 수 있다"는 제약 때문에 로그인 창이 떠 있으면 아예 못 여는
   새 문제를 만든다. 그래서 되돌렸다.

   중요한 건 로그인할 때와 수집할 때 ①세션 ②화면 크기·언어·시간대 ③navigator 위장
   세 가지를 똑같이 맞추는 것이다. */
async function 브라우저열기() {
  const browser = await chromium.launch({ headless: false, args: STEALTH_LAUNCH_ARGS });
  const context = await browser.newContext({ ...STEALTH_CONTEXT_OPTIONS, storageState: 세션파일 });
  return { context, browser };
}

/* 지금 화면이 어떤 상태인지 "추측하지 말고" 그대로 기록한다.
   예전엔 멈췄을 때 원인을 사람이 짐작해야 했고, 그래서 엉뚱한 곳을 고치느라 시간을
   버렸다. 로그인 벽인지, 그냥 더 불러올 게 없는 건지는 화면을 보면 구분할 수 있다. */
async function 화면상태(page) {
  return page.evaluate(() => {
    const 글자 = (document.body.innerText || '').slice(0, 4000);
    const 로그인링크 = [...document.querySelectorAll('a[href*="/accounts/login"]')]
      .filter((a) => a.getBoundingClientRect().width > 0);
    return {
      주소: location.pathname,
      로그인입력칸: Boolean(document.querySelector('input[name="username"]')),
      로그인유도: 로그인링크.length > 0 || /로그인하여|Log in to like|계정이 있으신가요/.test(글자),
      댓글줄수: document.querySelectorAll('time[datetime]').length,
      // 인스타가 게시물 설명에 "댓글 N개"를 넣어준다 — 몇 개 중 몇 개를 읽었는지 대조용
      설명: (document.querySelector('meta[property="og:description"]') || {}).content || '',
    };
  });
}

/* 위 설명 글에서 댓글 수를 뽑아낸다. 못 뽑으면 null — 모르면 모른다고 둔다.
   한국어는 "댓글 89개"(숫자가 뒤), 영어는 "567 comments"(숫자가 앞)라 둘 다 본다. */
function 설명속댓글수(설명) {
  const 글 = String(설명 || '').replace(/,/g, '');
  const 한국어 = 글.match(/댓글\s*(\d+)\s*개/);
  if (한국어) return Number(한국어[1]);
  const 영어 = 글.match(/(\d+)\s*comments?\b/i);
  if (영어) return Number(영어[1]);
  return null;
}

async function main() {
  const 주소 = process.argv[2];
  const 옵션 = Object.assign(
    { 대댓글포함: false, 주인댓글제외: true, 멘션2배: false },
    JSON.parse(process.argv[3] || '{}'),
  );
  if (!인스타게시물주소인가(주소)) {
    console.error('❌ 인스타그램 게시물 주소를 넣어주세요 (예: https://www.instagram.com/p/XXXX/)');
    process.exit(1);
  }
  if (!fs.existsSync(세션파일)) {
    console.error('❌ 인스타 로그인 정보가 없어요. 먼저 "인스타 로그인" 버튼을 눌러 로그인해주세요.');
    process.exit(1);
  }

  로그(`인스타 게시물을 엽니다: ${주소}`);
  로그('※ 곧 뜨는 창은 이 프로그램 전용 브라우저예요. 북마크도 없고 낯설어 보이지만 로그인은');
  로그('  되어 있는 상태입니다. 수집이 끝나면 저절로 닫히니 그때까지 건드리지 말아주세요.');
  const { context, browser } = await 브라우저열기();
  await applyStealth(context);
  const page = await context.newPage();

  /* 중간 결과를 계속 들고 있는다.
     20분짜리 수집이 막판에 브라우저가 닫혀서 통째로 날아가는 일을 막기 위해서다.
     (실제로 사용자가 창을 닫아 그때까지 읽은 게 전부 사라진 적이 있다) */
  let 마지막스냅 = null;
  const 스냅찍기 = async () => {
    try { 마지막스냅 = await page.evaluate(화면에서읽기, 옵션); } catch (e) { /* 닫혔으면 직전 것 유지 */ }
  };

  try {
    await page.goto(주소, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);

    /* 지금 화면이 어떤 상태인지 확인 — 추측하지 않고 화면을 그대로 본다.
       "로그인 벽"과 "그냥 더 불러올 게 없음"은 완전히 다른 문제인데, 예전엔 둘을 구분
       못 해서 엉뚱한 곳을 고쳤다. 여기서 갈라놓는다. */
    const 첫상태 = await 화면상태(page);
    const 쿠키들 = await context.cookies('https://www.instagram.com');
    const 쿠키있음 = 쿠키들.some((c) => c.name === 'sessionid' && c.value);
    if (!쿠키있음) {
      throw new Error('저장된 로그인 정보에 인스타 세션이 없어요. "인스타 로그인"을 다시 해주세요.');
    }
    if (첫상태.로그인입력칸 || /\/accounts\/login/.test(첫상태.주소)) {
      throw new Error('인스타 로그인이 풀렸어요(로그인 화면으로 넘어감). "인스타 로그인"을 다시 해주세요.');
    }
    if (첫상태.로그인유도) {
      로그('⚠️ 화면에 로그인을 권하는 안내가 보여요. 이 상태면 댓글이 앞부분만 보일 수 있어요.');
      로그('   결과가 실제 댓글 수보다 적으면 "인스타 로그인"을 다시 하고 시도해주세요.');
    }

    const 예상댓글수 = 설명속댓글수(첫상태.설명);
    if (예상댓글수 !== null) 로그(`이 게시물의 댓글 수: ${예상댓글수}개 (인스타가 알려준 값)`);

    로그('댓글을 불러오는 중입니다. 댓글이 많으면 몇 분 걸릴 수 있어요...');
    await 스냅찍기();   // 첫 화면 것부터 챙겨둔다 (바로 창이 닫혀도 빈손이 되지 않게)
    await 전부불러오기(page, 옵션, 스냅찍기);

    로그('화면에서 댓글을 읽는 중...');
    await 스냅찍기();
    const 결과 = 마지막스냅;
    if (!결과) throw new Error('화면에서 댓글을 읽지 못했어요.');
    로그(`✅ ${결과.행들.length}명 읽었어요 (화면에 보이는 댓글 줄 ${결과.화면속댓글줄수}개 기준)`);
    const ㄱ = 결과.건너뜀 || {};
    if (ㄱ.주인댓글) 로그(`  · 게시물 주인 댓글 ${ㄱ.주인댓글}개는 뺐어요 (설정대로)`);
    if (ㄱ.예비경로사용) {
      로그(`  ⚠️ ${ㄱ.예비경로사용}개는 예비 방법으로 본문을 읽었어요 — 인스타 화면 구조가 바뀐 신호예요.`);
      로그('     읽어온 본문이 이상하지 않은지 표에서 몇 개만 확인해주세요.');
    }
    if (ㄱ.본문못읽음 || ㄱ.작성자못찾음) {
      로그(`  ⚠️ 읽지 못해 건너뛴 줄: 본문 ${ㄱ.본문못읽음 || 0}개, 작성자 ${ㄱ.작성자못찾음 || 0}개`);
    }

    /* 추첨에 쓸 명단이라 "몇 개 중 몇 개"를 반드시 대조한다. 일부만 가져왔는데 전부인 줄
       알고 추첨하면 그 추첨 자체가 불공정해진다. 그래서 조용히 넘어가지 않는다. */
    const 끝상태 = await 화면상태(page).catch(() => 첫상태);
    if (예상댓글수 !== null && 결과.화면속댓글줄수 < 예상댓글수 * 0.9) {
      로그('');
      로그(`  🚨 인스타는 댓글이 ${예상댓글수}개라는데 화면엔 ${결과.화면속댓글줄수}개까지만 나왔어요.`);
      로그('     일부만 수집된 상태입니다. 이대로 추첨하면 빠진 사람이 생겨요.');
      if (끝상태.로그인유도) 로그('     화면에 로그인 안내가 떠 있어요 → "인스타 로그인"을 다시 해보세요.');
      else 로그('     로그인 문제는 아니에요 → "더 보기" 버튼을 못 찾은 쪽에 가깝습니다. 이 메시지를 알려주세요.');
    }
    console.log('__RESULT__' + JSON.stringify({
      ...결과, 주소, 옵션, 예상댓글수, 로그인유도: 끝상태.로그인유도,
    }));
  } catch (err) {
    /* 도중에 창이 닫혀도, 그때까지 읽어둔 게 있으면 버리지 않고 넘긴다 —
       20분 긁은 걸 통째로 날리는 것보다 "일부만 받았다"고 알려주는 쪽이 낫다. */
    if (마지막스냅 && 마지막스냅.행들.length) {
      로그(`⚠️ 도중에 멈췄지만, 그때까지 읽어둔 ${마지막스냅.행들.length}명은 살려뒀어요.`);
      로그(`   사유: ${읽을수있게(err.message)}`);
      로그('   ‼️ 전부가 아닙니다. 인스타 댓글 수와 꼭 비교하고, 모자라면 다시 수집해주세요.');
      console.log('__RESULT__' + JSON.stringify({
        ...마지막스냅, 주소, 옵션, 중간에멈춤: true, 멈춘사유: 읽을수있게(err.message),
      }));
      return;
    }
    throw err;
  } finally {
    /* 브라우저를 닫는 건 오직 여기 한 곳뿐이다. 이 줄을 남기는 이유는, "창이 닫혔다"는
       오류가 났을 때 우리가 닫은 건지 밖에서 닫힌 건지 바로 구분하기 위해서다.
       이 줄 없이 "창이 닫혔다"가 나오면 우리가 닫은 게 아니다. */
    로그('브라우저를 정리합니다.');
    await Promise.race([context.close(), new Promise(r => setTimeout(r, 5000))]);
    if (browser) await Promise.race([browser.close(), new Promise(r => setTimeout(r, 5000))]);
  }
}

/* Playwright가 내는 영어 오류를 사람이 읽을 수 있는 말로 바꾼다.
   특히 "창이 닫혔다"는 대부분 사용자가 뜬 창을 직접 닫은 경우인데, 원문만 보면
   프로그램이 고장 난 줄 알게 된다. */
function 읽을수있게(메시지) {
  const m = String(메시지 || '');
  if (/Target page, context or browser has been closed|Target closed/i.test(m)) {
    return '수집하던 브라우저 창이 닫혔어요. 수집이 끝날 때까지 그 창은 그대로 두세요 (자동으로 닫힙니다).';
  }
  if (/ProcessSingleton|profile.*in use|SingletonLock/i.test(m)) {
    return '크롬 프로필을 이미 다른 창이 쓰고 있어요. 떠 있는 크롬 창을 닫고 다시 시도해주세요.';
  }
  if (/net::ERR_|Timeout.*exceeded.*goto|navigating to/i.test(m)) {
    return `인스타 게시물을 여는 데 실패했어요. 주소와 인터넷 연결을 확인해주세요. (${m})`;
  }
  return m;
}

/* 내보낼 글이 다 빠져나간 것을 확인하고 프로그램을 확실히 끝낸다.
   브라우저 창 닫기가 간혹 안 끝나고 멈춘다(로그인 도우미에도 같은 문제가 있어 거기엔 이미
   같은 처리를 해뒀다). 그대로 두면 댓글을 다 읽어놓고도 프로그램이 안 꺼져서, 추첨기 화면은
   영원히 "진행 중"으로 남고 수집 결과가 통째로 날아간다.
   그렇다고 바로 끄면 안 된다 — 결과는 댓글이 많으면 수십만 글자라 아직 다 나가지 못한
   상태에서 끄면 중간에 잘린다. 그래서 "다 나갔다"는 신호를 받고 끈다. */
function 내보낸뒤종료(코드) {
  process.stdout.write('\n', () => process.exit(코드));
  setTimeout(() => process.exit(코드), 3000).unref();   // 그 신호마저 안 오면 3초 뒤 강제 종료
}

// 직접 실행할 때만 동작하고, 다른 파일에서 불러오면 함수만 내준다(테스트용)
if (require.main === module) {
  main()
    .then(() => 내보낸뒤종료(0))
    .catch((err) => {
      console.error(`❌ 수집 실패: ${읽을수있게(err.message)}`);
      내보낸뒤종료(1);
    });
}

module.exports = { 화면에서읽기, 전부불러오기, 인스타게시물주소인가, 읽을수있게, 설명속댓글수 };
