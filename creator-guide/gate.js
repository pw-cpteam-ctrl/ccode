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
  `;

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
        <p class="cg-desc">담당자에게 받으신 접속 코드를 입력해 주세요.</p>
        <form class="cg-form" novalidate>
          <input class="cg-input" type="password" placeholder="접속 코드"
                 autocomplete="off" autocapitalize="off" autocorrect="off"
                 spellcheck="false" aria-label="접속 코드" />
          <button class="cg-btn" type="submit">입장하기</button>
          <p class="cg-msg"></p>
        </form>
        <p class="cg-help">코드를 모르시면 담당자에게 문의해 주세요.<br />
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

  function remember(password) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        code: password,
        until: Date.now() + REMEMBER_DAYS * 24 * 60 * 60 * 1000,
      }));
    } catch { /* 저장 실패해도 이번 접속은 정상 동작한다 */ }
  }

  function recall() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && saved.code && saved.until > Date.now()) return saved.code;
      localStorage.removeItem(STORAGE_KEY); // 기간이 지났거나 형식이 깨진 경우
    } catch { /* 무시 */ }
    return null;
  }

  async function start() {
    const gate = render();
    const form = gate.querySelector('.cg-form');
    const input = gate.querySelector('.cg-input');
    const button = gate.querySelector('.cg-btn');
    const msg = gate.querySelector('.cg-msg');

    const say = (text, kind) => {
      msg.textContent = text;
      msg.className = 'cg-msg' + (kind ? ` is-${kind}` : '');
    };

    // 코드가 맞았을 때: 본문을 실행하고 입력 화면을 걷어낸다.
    async function enter(code, { save }) {
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
        if (save) remember(code);
        gate.remove();
        return true;
      } catch (err) {
        button.disabled = false;
        say(err.message || '여는 중 문제가 생겼습니다. 새로고침해 주세요.', 'bad');
        return false;
      }
    }

    // 예전에 입력해둔 코드가 있으면 입력 화면을 보여주지 않고 바로 연다.
    const saved = recall();
    if (saved) {
      const ok = await enter(saved, { save: false });
      if (ok) return;
      // 저장된 코드가 더 이상 맞지 않는 경우(= 코드가 교체됨) → 다시 입력받는다
      localStorage.removeItem(STORAGE_KEY);
      input.classList.remove('is-bad');
      say('접속 코드가 변경되었습니다. 새 코드를 입력해 주세요.', 'bad');
    }

    getPayload().catch(() => {}); // 입력하는 동안 미리 받아둔다
    input.focus();
    input.addEventListener('input', () => {
      input.classList.remove('is-bad');
      if (msg.classList.contains('is-bad')) say('');
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const code = input.value.trim();
      if (!code) { input.focus(); return; }
      enter(code, { save: true });
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
