// 접속 코드 입력 화면 — 코드가 맞아야 가이드 내용을 열어준다.
//
// ─── 이게 왜 이렇게 만들어졌나 ────────────────────────────────────
// 이 가이드는 서버 없이 파일만 올려두는 정적 페이지다. 그래서 "화면을 가려두고
// 비번 맞으면 걷어내는" 방식은 소용이 없다 — 페이지 소스를 열면 가려둔 내용이
// 그대로 보이기 때문이다.
//
// 그래서 가이드 본문(jsx 코드)을 아예 '읽을 수 없게 변환한 상태'로 올린다
// (build-lock.js가 배포할 때 자동으로 한다). 이 파일은 사용자가 입력한 코드로
// 그걸 되돌린 뒤 실행한다. 코드가 틀리면 되돌리기 자체가 실패하므로, 소스를
// 뜯어봐야 알아볼 수 없는 문자열 덩어리만 나온다.
//
// 코드는 이 브라우저 밖으로 나가지 않는다(서버로 보내지 않음).
//
// ─── 한계(알고 쓸 것) ────────────────────────────────────────────
// assets/ 폴더의 이미지는 잠기지 않는다. 주소를 정확히 아는 사람은 이미지
// 낱장을 볼 수 있다. 이미지까지 잠그면 첫 로딩이 크게 느려져서 일부러 뺐다.
// (사용자와 합의된 사항)

(function () {
  'use strict';

  const script = document.currentScript;
  const LOCKED_URL = script.dataset.locked;   // 예: locked/megahouse.enc
  const STORAGE_KEY = 'cg-access';            // 코드 기억용
  const REMEMBER_DAYS = 30;                   // 한 번 입력하면 이 기간 동안 유지
  const NICK_MAX = 20;                        // 닉네임 길이 상한

  // ─── 워터마크 설정 ─────────────────────────────────────────────
  // 입장할 때 받은 닉네임을 화면 전체에 아주 옅게 반복해서 깐다. 유출을 막지는
  // 못하지만, 캡처본이 돌아다닐 때 어느 계정에서 나갔는지 되짚을 수 있다.
  //
  // WM_ALPHA가 핵심이다. 눈으로는 안 보이되 편집 도구에서 명도를 극단적으로
  // 올리면 드러나는 값이어야 한다. 너무 낮추면 캡처가 메신저를 거치며 다시
  // 압축될 때 뭉개져서 아예 사라지므로, 값을 바꾸면 반드시 실제로 캡처해서
  // 메신저로 주고받은 뒤 복원되는지 확인할 것.
  // 아래 값은 실제로 재서 정한 것이다. 흰 배경에 깔고 카톡급(JPEG 품질 0.7)으로
  // 다시 압축했을 때, 글자 자리와 배경 자리의 평균 밝기 차이를 측정했다.
  //   alpha 0.030 → 7단계 — 육안으로 그냥 보인다. 쓰면 안 되는 값
  //   alpha 0.012 → 3단계, 압축 후 2.44
  //   alpha 0.008 → 2단계, 압축 후 1.52
  //   alpha 0.005 → 1단계, 압축 후 0.97  ← 지금 값. 화면이 색을 256단계로만
  //                 표현하므로 이보다 옅게는 만들 수 없다(하한)
  // 목표는 '육안으로는 절대 안 보이되 편집 도구로 명도를 극단적으로 올리면
  // 드러나는' 선이다. 진하기를 올리고 싶어지면 그 전에 반드시 육안 확인부터 할 것.
  // 글자는 클수록 압축에 강하다(17px는 28%, 34px는 11% 손실). 작은 글씨를
  // 촘촘히 까는 쪽이 직관적이지만 정반대다.
  const WM_ALPHA = 0.005;   // 안 보이는 워터마크의 진하기 (255 중 1단계 = 하한)
  const WM_TILE_W = 200;    // 한 칸의 가로 크기(px) — 작을수록 촘촘해진다
  const WM_TILE_H = 130;
  const WM_FONT = 32;       // 글자 크기 — 작으면 압축에 먼저 뭉개진다

  // 본문을 열고 나서 필요한 외부 라이브러리. 잠긴 동안엔 받지 않는다
  // (코드를 모르는 사람에게 굳이 3MB를 내려줄 이유가 없다).
  const VENDOR = [
    'https://unpkg.com/react@18.3.1/umd/react.development.js',
    'https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js',
    'https://unpkg.com/@babel/standalone@7.29.0/babel.min.js',
  ];

  // ─── 되돌리기(복호화) ──────────────────────────────────────────
  // build-lock.js가 잠글 때 쓴 방식과 정확히 짝이 맞아야 한다.
  //   코드 → PBKDF2(반복 200,000회) → 열쇠 → AES-GCM으로 되돌리기
  // 반복 횟수가 큰 이유: 코드를 무작위로 대입해보는 공격을 느리게 만들기 위해서다.
  const PBKDF2_ITERATIONS = 200000;

  function fromBase64(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function deriveKey(password, salt) {
    const base = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
  }

  // 코드가 틀리면 AES-GCM이 복호화를 거부한다(예외 발생) → null을 돌려준다.
  // 즉 "코드가 맞는지"를 따로 검사하지 않는다. 되돌려지면 맞는 것이다.
  async function unlock(payload, password) {
    try {
      const key = await deriveKey(password, fromBase64(payload.salt));
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64(payload.iv) },
        key,
        fromBase64(payload.data)
      );
      return new TextDecoder().decode(plain);
    } catch {
      return null;
    }
  }

  // ─── 화면 ──────────────────────────────────────────────────────
  const STYLE = `
    .cg-gate {
      position: fixed; inset: 0; z-index: 9999;
      display: flex; align-items: center; justify-content: center;
      padding: 24px; background: #f0f0ed;
      font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo",
                   "Malgun Gothic", sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .cg-card {
      width: 100%; max-width: 340px; background: #fff;
      border-radius: 18px; padding: 36px 26px 30px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.07), 0 0 0 1px rgba(0,0,0,0.04);
      text-align: center;
    }
    .cg-lock { font-size: 30px; line-height: 1; margin-bottom: 14px; }
    .cg-title { font-size: 17px; font-weight: 700; color: #1c1917; margin: 0 0 6px; }
    .cg-desc { font-size: 13px; line-height: 1.6; color: #78716c; margin: 0 0 22px; }
    .cg-form { display: flex; flex-direction: column; gap: 10px; }
    .cg-input {
      width: 100%; box-sizing: border-box;
      padding: 14px 16px; font-size: 16px;   /* 16px 미만이면 iOS에서 화면이 확대된다 */
      text-align: center; letter-spacing: 1px;
      border: 1.5px solid #e7e5e4; border-radius: 11px;
      background: #fafaf9; color: #1c1917; outline: none;
      transition: border-color .15s, background .15s;
    }
    .cg-input:focus { border-color: #1c1917; background: #fff; }
    .cg-input.is-bad { border-color: #dc2626; background: #fef2f2; }
    .cg-btn {
      width: 100%; padding: 14px; font-size: 15px; font-weight: 600;
      color: #fff; background: #1c1917; border: 0; border-radius: 11px;
      cursor: pointer; transition: opacity .15s;
    }
    .cg-btn:hover { opacity: .86; }
    .cg-btn:disabled { opacity: .5; cursor: default; }
    .cg-msg { font-size: 12.5px; line-height: 1.5; min-height: 18px; margin-top: 2px; }
    .cg-msg.is-bad { color: #dc2626; }
    .cg-msg.is-busy { color: #78716c; }
    .cg-help { font-size: 11.5px; color: #a8a29e; margin: 18px 0 0; line-height: 1.6; }
    .cg-label { font-size: 11.5px; color: #a8a29e; text-align: left; margin: 2px 0 -4px 4px; }

    /* 눈에 보이는 표식 — 억제용으로 딱 한 군데만 둔다.
       떠 있는 챗봇 버튼이 오른쪽 아래에 있으므로 왼쪽 아래에 붙인다. */
    .cg-wm-visible {
      position: fixed; left: 10px; bottom: 8px; z-index: 2147483001;
      font-size: 10px; line-height: 1; color: #d6d3d1;
      pointer-events: none; user-select: none; -webkit-user-select: none;
      font-family: inherit; letter-spacing: .2px;
    }
    @media print { .cg-wm-visible { display: block !important; } }
  `;

  // ─── 워터마크 ──────────────────────────────────────────────────
  // 반복 무늬는 SVG 한 칸을 배경 이미지로 깔아서 만든다. 요소를 수백 개 만드는
  // 방식보다 가볍고, 화면 크기가 바뀌어도 알아서 채워진다.
  function watermarkTile(nick) {
    const esc = (s) => s.replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${WM_TILE_W}" height="${WM_TILE_H}">` +
      `<text x="50%" y="50%" fill="#000" fill-opacity="${WM_ALPHA}"` +
      ` font-family="sans-serif" font-size="${WM_FONT}" font-weight="700"` +
      ` text-anchor="middle" dominant-baseline="middle"` +
      ` transform="rotate(-30 ${WM_TILE_W / 2} ${WM_TILE_H / 2})">${esc(nick)}</text>` +
      `</svg>`;
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
  }

  // 화면 위에 층을 하나 덮는 방식이 아니라, 본문 영역(.section)의 배경에 깐다.
  // 카드·박스처럼 자기 배경색을 가진 요소는 위를 덮으므로 워터마크는 여백에만
  // 남는다. 화면 전체에 덮어씌우면 아무리 옅어도 글자 위에까지 얹혀서 눈에 띈다.
  //
  // .app-shell이나 body에 걸면 안 된다 — 좁은 화면에서는 그 영역이 본문에 가려
  // 거의 드러나지 않아, 정작 사람들이 캡처하는 자리에는 아무것도 안 남는다.
  function applyWatermark(nick) {
    if (!nick) return;
    document.getElementById('cg-wm-style')?.remove();
    document.querySelectorAll('.cg-wm-visible').forEach((el) => el.remove());

    const tile = watermarkTile(nick);
    const st = document.createElement('style');
    st.id = 'cg-wm-style';
    // .app-shell은 background 한 줄로 색을 지정해 두었기 때문에, 뒤에 오는 이
    // 규칙이 이미지를 얹는다. 본문이 아직 안 그려졌어도 규칙은 미리 넣어둔다.
    st.textContent =
      `.section, .ev-body { background-image: ${tile} !important;` +
      ` background-repeat: repeat !important; }`;
    document.head.appendChild(st);

    const mark = document.createElement('div');
    mark.className = 'cg-wm-visible';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = nick;
    document.body.appendChild(mark);
  }

  // 닉네임 정리 — 줄바꿈·보이지 않는 문자를 걷어내고 길이를 제한한다.
  function cleanNick(raw) {
    return String(raw || '')
      // 제어문자와 폭 없는 문자(눈에 안 보이지만 글자로 세어지는 것)를 걷어낸다
      .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, NICK_MAX);
  }

  function render() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    const gate = document.createElement('div');
    gate.className = 'cg-gate';
    gate.innerHTML = `
      <div class="cg-card">
        <div class="cg-lock">🔒</div>
        <p class="cg-title">크리에이터 협업 가이드</p>
        <p class="cg-desc">활동명과 담당자에게 받으신 접속 코드를 입력해 주세요.</p>
        <form class="cg-form" novalidate>
          <input class="cg-input cg-nick" type="text" placeholder="활동명 (닉네임)"
                 autocomplete="off" autocapitalize="off" autocorrect="off"
                 spellcheck="false" maxlength="${NICK_MAX}" aria-label="활동명" />
          <input class="cg-input cg-code" type="password" placeholder="접속 코드"
                 autocomplete="off" autocapitalize="off" autocorrect="off"
                 spellcheck="false" aria-label="접속 코드" />
          <button class="cg-btn" type="submit">입장하기</button>
          <p class="cg-msg"></p>
        </form>
        <p class="cg-help">활동명은 보상 안내를 드릴 때 본인 확인용으로 쓰입니다.<br />
          코드를 모르시면 담당자에게 문의해 주세요.<br />
          한 번 입력하면 이 기기에서 ${REMEMBER_DAYS}일간 다시 묻지 않습니다.</p>
      </div>`;
    document.body.appendChild(gate);
    return gate;
  }

  // ─── 본문 실행 ─────────────────────────────────────────────────
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.onload = resolve;
      el.onerror = () => reject(new Error(`불러오기 실패: ${src}`));
      document.head.appendChild(el);
    });
  }

  // 되돌린 코드는 jsx 문법이라 그대로는 실행되지 않는다. Babel로 한 번 번역한 뒤
  // 전역에서 실행한다(간접 eval — 함수 안이 아니라 페이지 전체 범위에서 돈다).
  async function run(code) {
    for (const src of VENDOR) await loadScript(src);
    const js = window.Babel.transform(code, { presets: ['react'] }).code;
    (0, eval)(js);
  }

  // ─── 진행 ──────────────────────────────────────────────────────
  let payloadPromise = null;
  function getPayload() {
    // 잠긴 본문은 코드 입력 전에 미리 받아둔다(입력 후 기다리는 시간을 줄인다).
    // 받아둬도 코드 없이는 읽을 수 없으므로 안전하다.
    if (!payloadPromise) {
      payloadPromise = fetch(LOCKED_URL, { cache: 'no-store' }).then((r) => {
        if (!r.ok) throw new Error(`본문을 불러오지 못했습니다 (${r.status})`);
        return r.json();
      });
    }
    return payloadPromise;
  }

  function remember(password, nick) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        code: password,
        nick,
        until: Date.now() + REMEMBER_DAYS * 24 * 60 * 60 * 1000,
      }));
    } catch { /* 저장 실패해도 이번 접속은 정상 동작한다 */ }
  }

  function recall() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      // nick은 나중에 추가된 항목이라, 예전에 저장된 값에는 없을 수 있다.
      // 없으면 빈 값으로 두고 아래에서 다시 입력받는다.
      if (saved && saved.code && saved.until > Date.now()) {
        return { code: saved.code, nick: cleanNick(saved.nick) };
      }
      localStorage.removeItem(STORAGE_KEY); // 기간이 지났거나 형식이 깨진 경우
    } catch { /* 무시 */ }
    return null;
  }

  async function start() {
    const gate = render();
    const form = gate.querySelector('.cg-form');
    const nickInput = gate.querySelector('.cg-nick');
    const input = gate.querySelector('.cg-code');
    const button = gate.querySelector('.cg-btn');
    const msg = gate.querySelector('.cg-msg');

    const say = (text, kind) => {
      msg.textContent = text;
      msg.className = 'cg-msg' + (kind ? ` is-${kind}` : '');
    };

    // 코드가 맞았을 때: 본문을 실행하고 입력 화면을 걷어낸다.
    async function enter(code, nick, { save }) {
      button.disabled = true;
      say('여는 중…', 'busy');
      try {
        const payload = await getPayload();
        const text = await unlock(payload, code);
        if (text === null) {
          button.disabled = false;
          input.classList.add('is-bad');
          say('코드가 맞지 않습니다. 다시 확인해 주세요.', 'bad');
          input.select();
          return false;
        }
        await run(text);
        if (save) remember(code, nick);
        gate.remove();
        // 본문이 그려진 뒤에 워터마크를 얹는다. 다른 화면으로 넘어가도
        // 이 층은 화면에 고정되어 있어 다시 깔 필요가 없다.
        window.CG_NICK = nick;   // 나중에 보상 제출에서 제출자 식별에 쓴다
        applyWatermark(nick);
        return true;
      } catch (err) {
        button.disabled = false;
        say(err.message || '여는 중 문제가 생겼습니다. 새로고침해 주세요.', 'bad');
        return false;
      }
    }

    // 예전에 입력해둔 코드가 있으면 입력 화면을 보여주지 않고 바로 연다.
    const saved = recall();
    if (saved && saved.nick) {
      const ok = await enter(saved.code, saved.nick, { save: false });
      if (ok) return;
      // 저장된 코드가 더 이상 맞지 않는 경우(= 코드가 교체됨) → 다시 입력받는다
      localStorage.removeItem(STORAGE_KEY);
      input.classList.remove('is-bad');
      say('접속 코드가 변경되었습니다. 새 코드를 입력해 주세요.', 'bad');
    } else if (saved) {
      // 활동명을 받기 전에 저장된 값 — 코드는 채워두고 활동명만 받는다
      input.value = saved.code;
    }

    getPayload().catch(() => {}); // 입력하는 동안 미리 받아둔다
    nickInput.focus();
    [nickInput, input].forEach((el) => el.addEventListener('input', () => {
      el.classList.remove('is-bad');
      if (msg.classList.contains('is-bad')) say('');
    }));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const nick = cleanNick(nickInput.value);
      const code = input.value.trim();
      if (!nick) {
        nickInput.classList.add('is-bad');
        say('활동명을 입력해 주세요.', 'bad');
        nickInput.focus();
        return;
      }
      if (!code) { input.focus(); return; }
      enter(code, nick, { save: true });
    });
  }

  // 이 방식은 브라우저의 암호화 기능(Web Crypto)이 필요하다. https에서만 켜지는데,
  // 배포 주소는 https라 문제가 없다. 다만 파일을 직접 열었을 때 등을 대비해 안내한다.
  if (!window.crypto || !crypto.subtle) {
    document.addEventListener('DOMContentLoaded', () => {
      document.body.innerHTML =
        '<p style="padding:40px;text-align:center;font-family:sans-serif;line-height:1.7">' +
        '이 브라우저에서는 열 수 없습니다.<br />최신 브라우저에서 다시 시도해 주세요.</p>';
    });
    return;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
