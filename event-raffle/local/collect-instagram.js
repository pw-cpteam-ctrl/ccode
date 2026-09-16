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
async function 전부불러오기(page, 옵션) {
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
    }
    이전개수 = 현재;
  }
}

async function main() {
  const 주소 = process.argv[2];
  const 옵션 = Object.assign(
    { 대댓글포함: false, 주인댓글제외: true, 멘션2배: false },
    JSON.parse(process.argv[3] || '{}'),
  );
  if (!주소 || !/instagram\.com\/(p|reel)\//.test(주소)) {
    console.error('❌ 인스타그램 게시물 주소를 넣어주세요 (예: https://www.instagram.com/p/XXXX/)');
    process.exit(1);
  }
  if (!fs.existsSync(세션파일)) {
    console.error('❌ 인스타 로그인 정보가 없어요. 먼저 "인스타 로그인" 버튼을 눌러 로그인해주세요.');
    process.exit(1);
  }

  로그(`인스타 게시물을 엽니다: ${주소}`);
  const browser = await chromium.launch({ headless: false, args: STEALTH_LAUNCH_ARGS });
  const context = await browser.newContext({ ...STEALTH_CONTEXT_OPTIONS, storageState: 세션파일 });
  await applyStealth(context);
  const page = await context.newPage();

  try {
    await page.goto(주소, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);

    // 로그인이 풀렸는지 확인 — 풀린 채로 긁으면 댓글이 거의 안 보여서 "0명"으로 끝나버림
    const 로그인상태 = await page.evaluate(() =>
      !/\/accounts\/login/.test(location.pathname) && !document.querySelector('input[name="username"]'));
    if (!로그인상태) throw new Error('인스타 로그인이 풀렸어요. "인스타 로그인"을 다시 해주세요.');

    로그('댓글을 불러오는 중입니다. 댓글이 많으면 몇 분 걸릴 수 있어요...');
    await 전부불러오기(page, 옵션);

    로그('화면에서 댓글을 읽는 중...');
    const 결과 = await page.evaluate(화면에서읽기, 옵션);
    로그(`✅ ${결과.행들.length}명 읽었어요 (화면에 보이는 댓글 줄 ${결과.화면속댓글줄수}개 기준)`);
    const ㄱ = 결과.건너뜀 || {};
    if (ㄱ.주인댓글) 로그(`  · 게시물 주인 댓글 ${ㄱ.주인댓글}개는 뺐어요 (설정대로)`);
    if (ㄱ.예비경로사용) {
      로그(`  ⚠️ ${ㄱ.예비경로사용}개는 예비 방법으로 본문을 읽었어요 — 인스타 화면 구조가 바뀐 신호예요.`);
      로그('     읽어온 본문이 이상하지 않은지 표에서 몇 개만 확인해주세요.');
    }
    if (ㄱ.본문못읽음 || ㄱ.작성자못찾음) {
      로그(`  ⚠️ 읽지 못해 건너뛴 줄: 본문 ${ㄱ.본문못읽음 || 0}개, 작성자 ${ㄱ.작성자못찾음 || 0}개`);
      로그('     — 인스타 화면 구조가 바뀌었을 수 있어요. 인스타의 댓글 수와 위 인원을 꼭 비교해보세요.');
    }
    console.log('__RESULT__' + JSON.stringify({ ...결과, 주소, 옵션 }));
  } finally {
    await Promise.race([context.close(), new Promise(r => setTimeout(r, 5000))]);
    await Promise.race([browser.close(), new Promise(r => setTimeout(r, 5000))]);
  }
}

// 직접 실행할 때만 동작하고, 다른 파일에서 불러오면 함수만 내준다(테스트용)
if (require.main === module) {
  main().catch((err) => {
    console.error(`❌ 수집 실패: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { 화면에서읽기 };
