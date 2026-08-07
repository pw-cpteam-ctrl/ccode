// chat-widget.jsx — FAQ 탭 하단의 문의 응대 챗봇
//
// 두 브랜드 가이드가 이 파일 하나를 같이 쓴다. 어느 브랜드인지는 brand 값으로
// 구분하고, 실제 답변은 서버(api/chat.js)가 해당 브랜드 지식 파일만 보고 만든다.
//
// UI 요구사항은 PLAN.md 3-8을 따른다.

// 출처에 적힌 번호(01~07)로 어느 탭인지 찾기 위한 표.
// finalOption.jsx의 tabs 배열과 순서가 같아야 한다.
const CHAT_TAB_IDS = ['flow', 'upload', 'body', 'example', 'rules', 'reward', 'faq'];

// ─── 자주 묻는 질문(고정 답변) ──────────────────────────────────
// 이 5개는 버튼을 누르면 아래 답변이 '그대로' 즉시 표시된다. 서버도 AI도 거치지
// 않으므로 비용이 0이고 기다림도 없다.
//
// 왜 버튼이어야 하나:
//   "언제 올려요?" / "업로드 타이밍이요" / "며칠까지에요" — 사람마다 다르게 치기
//   때문에 '입력한 문장이 정확히 같을 때만 고정 답변'식으로는 거의 걸리지 않는다.
//   버튼 클릭으로 받으면 표현이 어긋날 일이 아예 없다.
//
// ⚠️ 답변 문구는 knowledge-*.md(지식 베이스)와 내용이 같아야 한다. 가이드가 바뀌면
//    지식 파일과 이 표를 함께 고친다. 마지막 줄의 '출처:' 형식도 그대로 유지할 것 —
//    이 형식이어야 답변 아래 출처 버튼이 해당 탭으로 이동한다.
const CHAT_FAQ = {
  megahouse: [
    {
      q: '업로드 순서를 요약해주세요',
      a: `순서가 정해져 있으니 반드시 아래 순서를 지켜주세요.

1. 메가하우스 공식 스토어 게시글을 먼저 공유
   · X(구 트위터): 리트윗 필수 / 인용은 선택
   · Instagram: 스토리 공유 필수 / 리그램은 선택
2. 컨펌받은 본문과 작업물을 크리에이터님 계정에 업로드

출처: 02 업로드 순서 탭`,
    },
    {
      q: '콘텐츠는 언제 올려야 하나요?',
      a: `특이사항이 없는 경우 스토어 오픈 시점과 가까운 시간을 원칙으로 합니다.

오픈 직후에 업로드하기 어려운 상황이라면 담당자에게 먼저 공유해 주세요. 이 경우 접속자가 많은 늦은 오후~저녁 시간대 업로드를 권장드립니다.

출처: 02 업로드 순서 탭`,
    },
    {
      q: '본문에 꼭 들어가야 하는 내용은 뭔가요?',
      a: `아래 3가지는 꼭 포함해 주세요.

1. 혜택 안내 — 예약판매 기간 중 5% 할인, 첫 구매 3,000원 할인
2. 구매 링크 — 고객수 집계가 가능한 링크 (예판 당일 또는 전날 전달 예정)
3. 광고 표기 — 첫 줄에 '광고' 혹은 '협찬' 중 택 1

출처: 03 본문 작성 탭`,
    },
    {
      q: '하면 안 되는 것(금지 사항)이 뭔가요?',
      a: `5가지입니다.

1. 대외비 유출 금지 — 쿠폰·보상 금액 등 구체적인 협업 조건은 대외비입니다.
2. 공식 이미지 활용 범위 준수 — 판권원 공식 이미지는 가이드라인 허용 범위 내에서만 사용해 주세요.
3. 제품 대상 대사 금지 — 피규어(룩업) 등 제품 자체가 말하는 형태(말풍선·따옴표)는 불가합니다.
4. 수위 및 소재 — 커플링 요소, 수위성·선정적 요소는 포함하실 수 없습니다.
5. 저작권 준수 및 도용 금지 — 본인의 순수 창작물 게시가 원칙입니다.

출처: 05 제작 규칙 탭`,
    },
    {
      q: '보상은 언제, 어떻게 받나요?',
      a: `보상은 구매 링크를 통한 고객 유입 수에 따라 차등 지급되며, 프리오더 기간(약 1달) 동안 유입 수가 카운트됩니다.

· 유입 수 750 미만 — 스토어 5만 원 쿠폰 또는 해당 월 룩업 단품 1개 (택 1)
· 유입 수 750 이상 — 스토어 10만 원 쿠폰 또는 해당 월 룩업 세트 구성 (택 1)

지급 시점은 프리오더 종료 후 유입 수 정산이 완료되는 시점이며, 그때 담당자가 한 번 더 연락드립니다. 희망하시는 수령 방식은 사전에 담당자에게 공유해 주세요.

출처: 06 보상 탭`,
    },
  ],
  brand2: [
    {
      q: '업로드 순서를 요약해주세요',
      a: `순서가 정해져 있으니 반드시 아래 순서를 지켜주세요.

1. 브랜드 계정 게시글을 먼저 공유
   · X(구 트위터): 리트윗 필수 / 인용은 선택
   · Instagram: 스토리 공유 필수 / 리그램은 선택
2. 컨펌받은 본문과 작업물을 크리에이터님 계정에 업로드

출처: 02 업로드 순서 탭`,
    },
    {
      q: '콘텐츠는 언제 올려야 하나요?',
      a: `특이사항이 없는 경우 스토어 오픈 시점과 가까운 시간을 원칙으로 합니다.

오픈 직후에 업로드하기 어려운 상황이라면 담당자에게 먼저 공유해 주세요. 이 경우 접속자가 많은 늦은 오후~저녁 시간대 업로드를 권장드립니다.

출처: 02 업로드 순서 탭`,
    },
    {
      q: '본문에 꼭 들어가야 하는 내용은 뭔가요?',
      a: `아래 3가지는 꼭 포함해 주세요.

1. 혜택 안내 — 첫 구매 5% 할인, 알림받기 1,000원 할인
2. 구매 링크 — 고객수 집계가 가능한 링크 (예판 당일 또는 전날 전달 예정)
3. 광고 표기 — 첫 줄에 '광고' 혹은 '협찬' 중 택 1

출처: 03 본문 작성 탭`,
    },
    {
      q: '하면 안 되는 것(금지 사항)이 뭔가요?',
      a: `크게 3가지입니다.

1. 대외비 유출 금지 — 쿠폰·보상 금액 등 구체적인 협업 조건은 대외비입니다.
2. 창작물 원칙 — 판권원 공식 이미지는 가이드라인 허용 범위 내에서만 사용해 주세요. 제품 자체가 말하는 형태(말풍선·따옴표)는 불가하며, 커플링 요소와 수위성·선정적 요소도 포함하실 수 없습니다.
3. 저작권 준수 및 도용 금지 — 본인의 순수 창작물 게시가 원칙입니다.

출처: 05 제작 규칙 탭`,
    },
    {
      q: '보상은 언제, 어떻게 받나요?',
      a: `콘텐츠 업로드가 완료되면 홍보해주신 상품과 동일한 제품을 보상으로 드립니다. 유입 수에 따른 차등 지급은 없습니다.

지급은 콘텐츠 업로드 후 7일 이내(검수 완료 기준)입니다. 업로드 직후 저희 측으로 확인을 요청해 주시면 검수를 거쳐 신속하게 상품 발급을 도와드리겠습니다.

출처: 06 보상 탭`,
    },
  ],
};

function ChatBox({ brand, onGoTab }) {
  const [messages, setMessages] = React.useState([]);   // {role, content, unanswered}
  const [input, setInput] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [toast, setToast] = React.useState('');
  const listRef = React.useRef(null);
  const taRef = React.useRef(null);

  const showToast = (t) => { setToast(t); setTimeout(() => setToast(''), 2200); };

  const faqList = CHAT_FAQ[brand] || [];

  // 어떤 질문이 많이 들어오는지 파악하기 위한 기록. 실패해도 화면엔 영향이 없어야
  // 하므로 결과를 기다리지 않고(await 없이) 보내고, 오류는 무시한다.
  const logQuestion = (payload) => {
    try {
      fetch('/api/log-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand, ...payload }),
        keepalive: true, // 답변 직후 탭을 닫아도 기록이 전송되도록
      }).catch(() => {});
    } catch { /* 기록 실패는 무시 */ }
  };

  // 자주 묻는 질문 버튼 — 미리 써둔 답을 그대로 띄운다(서버·AI 호출 없음).
  const sendPreset = (item) => {
    if (loading) return;
    setError('');
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: item.q },
      { role: 'assistant', content: item.a },
    ]);
    logQuestion({ kind: 'preset', question: item.q, answer: item.a, unanswered: false });
  };

  // 새 메시지가 생기면 아래로 스크롤
  React.useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, loading]);

  const send = async (text) => {
    const q = (text ?? input).trim();
    if (!q || loading) return;

    setError('');
    setLoading(true);
    // 사용자 질문을 먼저 화면에 띄운다 (기다리는 동안 뭘 물었는지 보이도록)
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: 'user', content: q }]);
    setInput('');

    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand, question: q, history }),
      });
      const data = await r.json().catch(() => ({}));

      if (!r.ok) {
        // 실패해도 사용자가 쓴 질문은 되돌려준다 — 다시 타이핑하게 만들지 않는다
        setMessages((prev) => prev.slice(0, -1));
        setInput(q);
        setError(data.error || '답변을 가져오지 못했습니다. 잠시 후 다시 시도해주세요.');
        return;
      }

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.answer, unanswered: !!data.unanswered },
      ]);
      logQuestion({
        kind: 'llm',
        question: q,
        answer: data.answer,
        unanswered: !!data.unanswered,
      });
    } catch (e) {
      // 네트워크 자체가 끊긴 경우
      setMessages((prev) => prev.slice(0, -1));
      setInput(q);
      setError('인터넷 연결을 확인해주세요. 입력하신 내용은 그대로 두었습니다.');
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e) => {
    // Enter로 전송, Shift+Enter로 줄바꿈
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const copy = async (text) => {
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch { /* 아래 대체 방법으로 */ }
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch { ok = false; }
    }
    showToast(ok ? '복사했어요' : '복사에 실패했어요. 길게 눌러 직접 복사해주세요.');
  };

  // 답변에서 마지막 "출처: ..." 줄을 따로 떼어낸다
  const splitSource = (text) => {
    const m = text.match(/\n?출처:\s*(.+)\s*$/);
    if (!m) return { body: text, source: null };
    return { body: text.slice(0, m.index).trim(), source: m[1].trim() };
  };

  // "02 업로드 순서 탭" → 'upload'
  const sourceToTabId = (source) => {
    const n = source.match(/^(\d{1,2})/);
    if (!n) return null;
    return CHAT_TAB_IDS[parseInt(n[1], 10) - 1] || null;
  };

  return (
    <div className="chat-card">
      <div className="chat-head">
        <div style={{ fontSize: 22 }}>💬</div>
        <div>
          <div className="chat-title">FAQ에 없는 문의가 있어요!</div>
          <div className="chat-sub">
            가이드 내용을 바탕으로 바로 답변해 드려요. 새로고침하면 대화가 사라지니
            필요한 답변은 복사해 두세요.
          </div>
        </div>
      </div>

      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && !loading && (
          <div className="chat-samples">
            <div className="chat-samples-label">자주 묻는 질문 — 눌러보세요</div>
            {faqList.map((item) => (
              <button key={item.q} className="chat-sample" onClick={() => sendPreset(item)}>
                {item.q}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) => {
          if (m.role === 'user') {
            return <div key={i} className="chat-msg chat-user">{m.content}</div>;
          }
          const { body, source } = splitSource(m.content);
          const tabId = source ? sourceToTabId(source) : null;
          return (
            <div key={i} className={'chat-msg chat-bot' + (m.unanswered ? ' chat-unanswered' : '')}>
              <div className="chat-bot-body">{body}</div>
              {source && (
                <button
                  className="chat-source"
                  onClick={() => { if (tabId && onGoTab) onGoTab(tabId); }}
                  title={tabId ? '이 탭으로 이동' : ''}
                >
                  출처: {source}
                </button>
              )}
              <button className="chat-copy" onClick={() => copy(body)}>
                <svg className="ic" viewBox="0 0 24 24" style={{ width: 13, height: 13 }}>
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                복사
              </button>
            </div>
          );
        })}

        {loading && (
          <div className="chat-msg chat-bot chat-typing" aria-label="답변 작성 중">
            <span /><span /><span />
          </div>
        )}
      </div>

      {error && <div className="chat-error">{error}</div>}

      <div className="chat-input-row">
        <textarea
          ref={taRef}
          className="chat-textarea"
          placeholder={loading ? '답변을 기다리는 중이에요…' : '궁금하신 내용을 입력해주세요'}
          value={input}
          disabled={loading}
          rows={2}
          maxLength={500}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          // 모바일에서 키보드가 올라와도 입력창이 가려지지 않게 한다
          onFocus={(e) => setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300)}
        />
        <button
          className="chat-send"
          onClick={() => send()}
          disabled={loading || !input.trim()}
        >
          전송
        </button>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

Object.assign(window, { ChatBox });
