// chat-widget.jsx — FAQ 탭 하단의 문의 응대 챗봇
//
// 두 브랜드 가이드가 이 파일 하나를 같이 쓴다. 어느 브랜드인지는 brand 값으로
// 구분하고, 실제 답변은 서버(api/chat.js)가 해당 브랜드 지식 파일만 보고 만든다.
//
// UI 요구사항은 PLAN.md 3-8을 따른다.

// 출처에 적힌 번호(01~07)로 어느 탭인지 찾기 위한 표.
// finalOption.jsx의 tabs 배열과 순서가 같아야 한다.
const CHAT_TAB_IDS = ['flow', 'upload', 'body', 'example', 'rules', 'reward', 'faq'];

// 처음 열었을 때 보여줄 예시 질문. 빈 입력창만 있으면 뭘 물어야 할지 몰라
// 그냥 닫는 경우가 많아서 미리 띄운다.
const CHAT_SAMPLES = [
  '업로드 순서가 어떻게 되나요?',
  '보상은 언제 받나요?',
  '광고 표기는 어떻게 하나요?',
];

function ChatBox({ brand, onGoTab }) {
  const [messages, setMessages] = React.useState([]);   // {role, content, unanswered}
  const [input, setInput] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [toast, setToast] = React.useState('');
  const listRef = React.useRef(null);
  const taRef = React.useRef(null);

  const showToast = (t) => { setToast(t); setTimeout(() => setToast(''), 2200); };

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
            가이드 내용을 바탕으로 바로 답변해 드려요. 이 대화는 저장되지 않으니
            필요한 답변은 복사해 두세요.
          </div>
        </div>
      </div>

      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && !loading && (
          <div className="chat-samples">
            <div className="chat-samples-label">이런 걸 물어보실 수 있어요</div>
            {CHAT_SAMPLES.map((s) => (
              <button key={s} className="chat-sample" onClick={() => send(s)}>{s}</button>
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
