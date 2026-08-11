// finalOption.jsx — 통합본: A(탭 네비) 기반 + B(환영/완료) 커버 녹여낸 버전
// 원문 텍스트 100% 보존

const CHAPTER_META = {
  flow:   { tag: '협업 진행 프로세스', emoji: '📌', title: '협업은 이렇게 진행돼요', lead: 'STEP 1~2 · 공식 스토어 팔로우부터 최종본 확정까지' },
  upload: { tag: '업로드 순서 (중요!)', emoji: '🚀', title: '업로드 순서, 꼭 지켜주세요', lead: '가장 많이 헷갈리는 단계예요. 오픈 당일 순서를 반드시 확인해주세요.' },
  body:   { tag: '게시글 본문 작성 가이드', emoji: '🖊', title: '본문은 이렇게 작성해주세요', lead: '평소 스타일 그대로! 단, 아래 필수 내용만 꼭 포함해주시면 됩니다.' },
  example:{ tag: '홍보 게시글 예시', emoji: '📎', title: '홍보 게시글 예시', lead: '광고 표기 보충 안내와 실제 게시글 예시를 확인해주세요.' },
  rules:  { tag: '제작 가이드 및 유의 사항', emoji: '🚫', title: '이것만 지켜주세요', lead: '기본적으로 자유 창작! 단, IP 보호를 위한 몇 가지는 함께 지켜주세요.' },
  reward: { tag: '보상 안내', emoji: '🎁', title: '유입 수에 따라 차등 지급돼요', lead: '구매 링크를 통한 고객 유입 수에 따라 보상이 차등 지급됩니다.' },
  faq:    { tag: '보충: 협업 관련 FAQ', emoji: '❓', title: '자주 묻는 문의', lead: '미리 받은 주요 문의를 정리했어요. 탭해서 답변을 펼쳐보세요.' },
};

// 완료 페이지의 리워드 선택지. 유입 수(750)에 따른 금액·구성은 업로드 뒤에 정해지므로,
// 여기서는 "금액으로 받을지 상품으로 받을지"만 고르게 한다. (06 보상 탭 기준)
const REWARD_CHOICES = [
  { id: 'coupon', emoji: '💳', label: '금액 쿠폰', desc: '스토어에서 쓰는\n금액으로 받기', copy: '금액 쿠폰 (스토어 쿠폰)' },
  { id: 'goods',  emoji: '🎁', label: '상품 쿠폰', desc: '해당 월 룩업\n상품으로 받기', copy: '상품 쿠폰 (해당 월 룩업)' },
];

// 담당자에게 붙여넣을 회신 문구를 만든다. 항목 이름은 화면에 보이는 것과 똑같이 맞춘다
// — 크리에이터가 "내가 고른 게 그대로 갔구나"를 바로 알 수 있어야 하기 때문.
function buildReplyText(dateLabel, reward) {
  return [
    '[협업 진행 정보]',
    `① 초안 공유 예정일 : ${dateLabel}`,
    `② 리워드 수령 방식 : ${reward.copy}`,
  ].join('\n');
}

// 메가하우스 오픈일은 매월 첫 번째 목요일로 고정돼 있다. 크리에이터가 초안 일정을
// 잡을 때 기준이 되는 날짜라, 다음 오픈일이 실제로 며칠인지 계산해서 보여준다
// (문구로만 "매월 첫 목요일"이라고 적으면 직접 달력을 세어봐야 하기 때문).
function firstThursday(year, month) {
  const first = new Date(year, month, 1);
  // 0=일 … 4=목. 1일이 목요일이면 그대로, 아니면 다음 목요일까지 더한다
  return new Date(year, month, 1 + ((4 - first.getDay() + 7) % 7));
}


// 2026-08-18 → "8월 18일 (화)"
function formatDate(value) {
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return value;
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return `${m}월 ${d}일 (${days[new Date(y, m - 1, d).getDay()]})`;
}

// ─── 달력 ────────────────────────────────────────────────────────
// 브라우저 기본 날짜 선택기 대신 직접 그린다. 기본 선택기는 내부를 꾸밀 수 없어서
// 메가하우스 오픈일(매월 첫 목요일)에 표시를 넣을 방법이 없기 때문.
//
// 규칙
//   - 이번 달부터 다음 달까지만 이동 가능 (인플루언서 연락이 월말부터 나가는 흐름 기준)
//   - 지난 날짜는 고를 수 없음 (초안 예정일이 과거일 수는 없으므로)
//   - 오픈일은 빨간 동그라미로 표시만 하고, 고르는 것 자체는 막지 않음
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const MONTHS_AHEAD = 1;   // 다음 달까지만

// Date → "2026-09-02" (기존 폼 값 형식을 그대로 유지한다)
function toValue(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function CalendarPicker({ value, onChange }) {
  const today = React.useMemo(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }, []);

  // 화면에 보여줄 달 (1일 기준). 처음엔 이번 달부터 시작한다
  const [view, setView] = React.useState(() => new Date(today.getFullYear(), today.getMonth(), 1));

  const minMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const maxMonth = new Date(today.getFullYear(), today.getMonth() + MONTHS_AHEAD, 1);
  const canPrev = view > minMonth;
  const canNext = view < maxMonth;

  const year = view.getFullYear();
  const month = view.getMonth();
  const openDay = firstThursday(year, month).getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leading = new Date(year, month, 1).getDay();   // 1일 앞의 빈 칸 수

  const cells = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const moveMonth = (step) => setView(new Date(year, month + step, 1));

  return (
    <div className="cal">
      <div className="cal-head">
        <button type="button" className="cal-nav" disabled={!canPrev}
          onClick={() => moveMonth(-1)} aria-label="이전 달">‹</button>
        <div className="cal-title">{year}년 {month + 1}월</div>
        <button type="button" className="cal-nav" disabled={!canNext}
          onClick={() => moveMonth(1)} aria-label="다음 달">›</button>
      </div>

      <div className="cal-grid cal-week">
        {WEEKDAYS.map((w) => <div key={w} className="cal-wd">{w}</div>)}
      </div>

      <div className="cal-grid">
        {cells.map((day, i) => {
          if (day === null) return <div key={`b${i}`} />;
          const date = new Date(year, month, day);
          const past = date < today;
          const cls = [
            'cal-day',
            past ? 'is-past' : '',
            day === openDay ? 'is-open' : '',
            value === toValue(date) ? 'is-sel' : '',
          ].filter(Boolean).join(' ');
          return (
            <button
              key={day} type="button" className={cls} disabled={past}
              aria-pressed={value === toValue(date)}
              aria-label={`${month + 1}월 ${day}일${day === openDay ? ' 메가하우스 오픈일' : ''}`}
              onClick={() => onChange(toValue(date))}
            >
              {day}
            </button>
          );
        })}
      </div>

      <div className="cal-legend">
        <span className="cal-legend-dot" /> 메가하우스 오픈일 — 매월 첫 번째 목요일
      </div>
    </div>
  );
}

function FinalOption() {
  const [phase, setPhase] = React.useState('cover');
  const [tab, setTab] = React.useState('flow');
  const [openFaq, setOpenFaq] = React.useState(-1);

  // ─── 완료 페이지: 담당자 회신 폼 ───────────────
  // 두 항목을 다 고르기 전에는 복사 버튼이 눌리지 않는다. 예전에는 안내 문장만 있어서
  // 둘 중 하나만 알려주거나 아예 안 알려주는 경우가 많았는데, 폼으로 만들면 빠뜨리는 것
  // 자체가 불가능해진다.
  const [draftDate, setDraftDate] = React.useState('');
  const [rewardId, setRewardId] = React.useState('');
  const [copied, setCopied] = React.useState(false);

  const reward = REWARD_CHOICES.find(r => r.id === rewardId);
  const canCopy = Boolean(draftDate && reward);

  const copyReply = async () => {
    if (!canCopy) return;
    const text = buildReplyText(formatDate(draftDate), reward);

    // 클립보드 API가 막힌 환경(구형 브라우저 등)을 대비해 대체 방법을 함께 둔다
    // (chat-widget.jsx의 copy()와 같은 방식 — 파일끼리 의존시키지 않으려고 따로 갖고 있음)
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
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } else {
      // 복사가 안 되면 직접 긁어갈 수 있도록 화면에 문구를 띄운다
      window.prompt('아래 내용을 복사해 담당자에게 보내주세요.', text);
    }
  };

  const tabs = [
    { id: 'flow',    label: '진행 순서' },
    { id: 'upload',  label: '업로드 순서' },
    { id: 'body',    label: '본문 작성' },
    { id: 'example', label: '홍보 예시' },
    { id: 'rules',   label: '제작 규칙' },
    { id: 'reward',  label: '보상' },
    { id: 'faq',     label: 'FAQ' },
  ];

  const tabIdx = tabs.findIndex(t => t.id === tab);
  const isLast = tabIdx === tabs.length - 1;

  const scrollTop = () => { window.scrollTo({ top: 0, behavior: 'instant' }); };

  // 활성 탭을 가로 스크롤 가운데로 이동 (04/05 가시성 확보)
  React.useEffect(() => {
    if (phase !== 'main') return;
    const nav = document.querySelector('.optA .tab-nav');
    const active = nav?.querySelector('.tab.active');
    if (nav && active) {
      const navRect = nav.getBoundingClientRect();
      const aRect = active.getBoundingClientRect();
      const offset = (aRect.left - navRect.left) - (navRect.width / 2) + (aRect.width / 2);
      nav.scrollTo({ left: nav.scrollLeft + offset, behavior: 'smooth' });
    }
  }, [tab, phase]);
  const nextTab = () => {
    if (isLast) { setPhase('done'); }
    else { setTab(tabs[tabIdx + 1].id); scrollTop(); }
  };
  const prevTab = () => { if (tabIdx > 0) { setTab(tabs[tabIdx - 1].id); scrollTop(); } };

  // ─── 환영 커버 ─────────────────────────────
  if (phase === 'cover') {
    return (
      <div className="final-cover">
        {/* 상단 브랜드 스트립 */}
        <div className="cover-brand">
          <div className="brand-dot">P</div>
          <div className="brand-name">PRESENCE WORLD</div>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 24px' }}>
          {/* 대형 브랜드 표기 */}
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.14em', opacity: 0.75, marginBottom: 6 }}>
            MEGAHOUSE COLLABORATION
          </div>
          <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 20, opacity: 0.95 }}>
            PRESENCE WORLD
          </div>

          <h1 style={{ fontSize: 30, fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1.15, margin: '0 0 14px' }}>
            크리에이터 협업 가이드 👋
          </h1>
          <div style={{ fontSize: 14.5, lineHeight: 1.65, opacity: 0.92, textWrap: 'pretty' }}>
            처음이시거나 내용이 헷갈리실 때 언제든 열어보세요. 협업 진행 방식과 본문 작성 요령, 제작 규칙, 보상, 자주 묻는 문의를 담았어요.
          </div>
          <div style={{ marginTop: 22, padding: '12px 14px', background: 'rgba(255,255,255,0.12)', borderRadius: 12, fontSize: 12.5, opacity: 0.95, lineHeight: 1.6, border: '1px solid rgba(255,255,255,0.18)' }}>
            💡 상단 탭으로 원하는 챕터에 바로 이동, 하단 “다음”으로 순서대로 읽을 수도 있어요.
          </div>
        </div>

        <div style={{ padding: '14px 20px 8px' }}>
          <button className="final-btn-primary" onClick={() => setPhase('main')}>
            시작하기 <Icon.chevRight style={{ color: 'var(--blue-600)', width: 18, height: 18 }} />
          </button>
        </div>
        <div className="cover-copyright">
          <strong>ⓒ PRESENCE WORLD</strong> · 본 협업 가이드 페이지의 <strong>유출 · 재배포를 금합니다.</strong>
        </div>
      </div>
    );
  }

  // ─── 완료 페이지 ─────────────────────────────
  if (phase === 'done') {
    return (
      <div className="final-done-split">
        {/* 상단 히어로 — 파란 영역 */}
        <div className="done-hero">
          <div className="cover-brand">
            <div className="brand-dot">P</div>
            <div className="brand-name">PRESENCE WORLD</div>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '8px 24px 20px' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.14em', opacity: 0.75, marginBottom: 10 }}>
              GUIDE COMPLETE · 05 / 05
            </div>
            <div style={{ fontSize: 52, marginBottom: 10, lineHeight: 1 }}>🎉</div>
            <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: '-0.03em', margin: '0 0 8px', lineHeight: 1.15 }}>
              모두 확인 완료했어요
            </h1>
            <div style={{ fontSize: 13, lineHeight: 1.6, opacity: 0.9 }}>
              마지막으로 두 가지만 알려주시면<br />바로 협업 시작할 수 있어요!
            </div>
          </div>
        </div>

        {/* 하단 본문 — 하얀 영역 */}
        <div className="done-body">
          <div className="done-card">
            <div className="done-card-head">
              <span className="done-card-icon">📨</span>
              <span className="done-card-title">담당자에게 보낼 내용</span>
            </div>
            <p className="done-card-text" style={{ marginBottom: 14 }}>
              리워드 지급 준비를 위해 필요해요.
            </p>

            {/* ① 초안 공유 예정일 */}
            <div className="reply-field">
              <div className="reply-label"><span className="reply-num">①</span> 초안 공유 예정일</div>
              <CalendarPicker value={draftDate} onChange={setDraftDate} />
              {draftDate && (
                <div className="reply-picked">선택한 날짜 · <strong>{formatDate(draftDate)}</strong></div>
              )}
              <div className="reply-hint">대략적인 날짜여도 괜찮아요.<br />나중에 바뀌어도 됩니다 🙂</div>
            </div>

            {/* ② 리워드 수령 방식 */}
            <div className="reply-field">
              <div className="reply-label"><span className="reply-num">②</span> 리워드 수령 방식</div>
              <div className="reply-choices">
                {REWARD_CHOICES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`reply-choice${rewardId === c.id ? ' is-on' : ''}`}
                    aria-pressed={rewardId === c.id}
                    onClick={() => setRewardId(c.id)}
                  >
                    <span className="reply-choice-emoji">{c.emoji}</span>
                    <span className="reply-choice-label">{c.label}</span>
                    <span className="reply-choice-desc">{c.desc}</span>
                  </button>
                ))}
              </div>
              <div className="reply-hint">
                금액·구성은 업로드 후 유입 수에 따라 정해져요{' '}
                <button type="button" className="reply-link" onClick={() => { setPhase('main'); setTab('reward'); scrollTop(); }}>
                  06 보상 탭
                </button>
              </div>
            </div>

            <button
              type="button"
              className={`reply-copy${copied ? ' is-done' : ''}`}
              disabled={!canCopy}
              onClick={copyReply}
            >
              {copied ? '✓  복사됐어요!' : '📋  복사하기'}
            </button>
            <div className="reply-guide">
              {canCopy
                ? '담당자에게 붙여넣기만 하면 끝!'
                : '위 두 가지를 모두 골라주세요'}
            </div>
          </div>

          <div className="done-signoff">
            <div className="done-thanks">읽어주셔서 감사합니다.</div>
            <div className="done-sign">— 프레젠스월드 드림</div>
          </div>

          <div className="done-btns">
            <button className="done-btn-ghost" onClick={() => setPhase('main')}>
              <Icon.chevRight style={{ transform: 'rotate(180deg)', width: 16, height: 16 }} /> 돌아가기
            </button>
            <button className="done-btn-primary" onClick={() => { setPhase('cover'); setTab('flow'); }}>처음으로</button>
          </div>

          <div className="done-copyright">
            <strong>ⓒ PRESENCE WORLD</strong> · 본 협업 가이드 페이지의 <strong>유출 · 재배포를 금합니다.</strong>
          </div>
        </div>
      </div>
    );
  }

  const meta = CHAPTER_META[tab];

  return (
    <div className="optA final-main">
      {/* 챕터별 요약 헤더 — 최상단 */}
      <div className="chapter-head">
        <div className="chapter-tag">
          <span className="chap-check" aria-hidden>
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          </span>
          <span style={{ opacity: 0.9 }}>{meta.tag}</span>
        </div>
        <h1 className="chapter-h1">{meta.emoji} {meta.title}</h1>
        <p className="chapter-lead">{meta.lead}</p>
      </div>

      {/* 탭 네비 — 파란 헤더 아래로 */}
      <div className="tab-nav hide-scrollbar">
        {tabs.map((t, i) => (
          <button key={t.id} className={'tab' + (tab === t.id ? ' active' : '')} onClick={() => { setTab(t.id); scrollTop(); }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, opacity: 0.6, marginRight: 5 }}>{String(i + 1).padStart(2, '0')}</span>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'flow'    && <Final_Flow />}
      {tab === 'upload'  && <Final_Upload />}
      {tab === 'body'    && <Final_Body />}
      {tab === 'example' && <Final_Example />}
      {tab === 'rules'   && <Final_Rules />}
      {tab === 'reward'  && <Final_Reward />}
      {tab === 'faq'     && <Final_Faq openFaq={openFaq} setOpenFaq={setOpenFaq} onGoTab={(id) => { setTab(id); scrollTop(); }} />}

      <div className="final-chapter-nav">
        {tabIdx > 0 ? (
          <button className="chap-prev" onClick={prevTab}>
            <Icon.chevRight style={{ transform: 'rotate(180deg)', width: 16, height: 16 }} />
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', opacity: 0.6, letterSpacing: '0.06em' }}>PREV</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{tabs[tabIdx - 1].label}</div>
            </div>
          </button>
        ) : <div />}
        <button className="chap-next" onClick={nextTab}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', opacity: 0.8, letterSpacing: '0.06em' }}>{isLast ? 'FINISH' : 'NEXT'}</div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{isLast ? '모두 확인 완료' : tabs[tabIdx + 1].label}</div>
          </div>
          <Icon.chevRight style={{ width: 16, height: 16 }} />
        </button>
      </div>
    </div>
  );
}

// ─── 챕터 1: 진행 순서 (STEP 1~2 + 워크플로우) ──────
function Final_Flow() {
  const step1 = GUIDE.steps[0];
  const step2 = GUIDE.steps[1];
  return (
    <div className="section">
      {/* 워크플로우 다이어그램 */}
      <WorkflowDiagram />

      {/* STEP 1 */}
      <div className="step-card">
        <div className="step-num">{step1.n}</div>
        <div className="step-body">
          <h3>{step1.emoji} STEP {step1.n}. {step1.title}</h3>
          <p>{step1.short}</p>
        </div>
      </div>
      <div className="card step-nested">
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-800)', lineHeight: 1.7 }}>{step1.body}</p>
        {step1.accounts && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--ink-200)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {step1.accounts.map((a) => (
              <div key={a.handle} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, minWidth: 0 }}>
                {a.label.includes('X') ? <Icon.x_social style={{ color: 'var(--ink-900)' }} /> : <Icon.ig style={{ color: 'var(--ink-900)' }} />}
                <span style={{ color: 'var(--ink-600)', flexShrink: 0 }}>{a.label}</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--blue-600)', fontWeight: 600, marginLeft: 'auto' }}>{a.handle}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* STEP 2 */}
      <div className="step-card" style={{ marginTop: 6 }}>
        <div className="step-num">{step2.n}</div>
        <div className="step-body">
          <h3>{step2.emoji} STEP {step2.n}. {step2.title}</h3>
          <p>{step2.short}</p>
        </div>
      </div>
      <div className="step-nested-group">
        {step2.substeps.map((ss, i) => (
          <div key={i} className="card">
            <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 6, letterSpacing: '-0.01em' }}>
              <span style={{ color: 'var(--blue-500)', fontFamily: 'var(--font-mono)', marginRight: 6 }}>{step2.n}-{i + 1}</span>
              {ss.t}
            </div>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-800)', lineHeight: 1.7 }}>{ss.d}</p>
            {ss.bullets && <ul className="nested-bullets">{ss.bullets.map((b, j) => <li key={j}>{b}</li>)}</ul>}
            {ss.tip && (
              <div className="alert info" style={{ marginTop: 10, marginBottom: 0 }}>
                <Icon.info /> <span>{ss.tip}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── 워크플로우 미니 다이어그램 ─────────────────────
function WorkflowDiagram() {
  const steps = [
    { n: '①', title: '초안 준비 단계', cap: '그림·영상·글 자유 형식' },
    { n: '②', title: '피드백 받기', cap: '담당자 검토·수정 조율' },
    { n: '③', title: '최종본 확정', cap: '완성본·업로드 본문 회신' },
    { n: '④', title: '스토어 오픈 후\n판매글 공유', cap: '공식 게시글 먼저 공유', key: true, warn: true },
    { n: '⑤', title: '내 계정에\n업로드', cap: '컨펌 본문·작업물 업로드', key: true },
  ];
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--blue-600)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
        협업 전체 흐름
      </div>
      <div style={{ display: 'flex', gap: 0, alignItems: 'stretch', overflowX: 'auto' }} className="hide-scrollbar">
        {steps.map((s, i) => (
          <React.Fragment key={i}>
            <div style={{
              flex: '1 0 0', minWidth: 0,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
            }}>
              {/* 박스 */}
              <div style={{
                width: '100%',
                padding: '14px 10px',
                borderRadius: 12,
                background: s.key ? 'var(--blue-500)' : '#fff',
                border: s.key ? 'none' : '1.5px solid var(--ink-200)',
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: 4,
                boxShadow: s.key ? '0 4px 14px rgba(37,99,235,0.18)' : 'none',
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)', color: s.key ? 'rgba(255,255,255,0.7)' : 'var(--ink-400)' }}>{s.n}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: s.key ? '#fff' : 'var(--ink-900)', textAlign: 'center', whiteSpace: 'pre-line', lineHeight: 1.3 }}>{s.title}</div>
                {s.warn && <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.9)', background: 'rgba(255,255,255,0.18)', padding: '2px 6px', borderRadius: 100, marginTop: 2 }}>⚠ 순서 주의</div>}
              </div>
              {/* 캡션 */}
              <div style={{ fontSize: 10.5, color: 'var(--ink-500)', textAlign: 'center', lineHeight: 1.4, paddingBottom: 4 }}>{s.cap}</div>
            </div>
            {i < steps.length - 1 && (
              <div style={{ display: 'flex', alignItems: 'flex-start', paddingTop: 24, flexShrink: 0, width: 16 }}>
                <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
                  <path d="M2 8h10M9 5l3 3-3 3" stroke="var(--ink-300)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// ─── 챕터 2: 업로드 순서 ─────────────────────────────
function Final_Upload() {
  const step3 = GUIDE.steps[2];
  return (
    <div className="section">
      <div className="step-card">
        <div className="step-num">{step3.n}</div>
        <div className="step-body">
          <h3>{step3.emoji} STEP {step3.n}. {step3.title}</h3>
          <p>{step3.short}</p>
        </div>
      </div>

      {/* 사전 안내 */}
      {step3.preInfo && (
        <div className="step-nested-group">
          <div className="card" style={{ background: 'var(--ink-50)', borderStyle: 'dashed' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, background: 'var(--ink-200)', color: 'var(--ink-700)', padding: '2px 7px', borderRadius: 999 }}>사전 안내</span>
              <span style={{ fontSize: 11, color: 'var(--ink-600)', fontWeight: 600 }}>※ 담당자가 먼저 진행하는 절차</span>
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 4 }}>{step3.preInfo.t}</div>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-800)', lineHeight: 1.7 }}>{step3.preInfo.d}</p>
            {step3.preInfo.bullets && <ul className="nested-bullets">{step3.preInfo.bullets.map((b, j) => <li key={j}>{b}</li>)}</ul>}
          </div>
        </div>
      )}

      {/* 크리에이터 액션 */}
      <div className="step-nested-group">
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--blue-600)', marginBottom: 8, letterSpacing: '0.04em' }}>
          ▼ 크리에이터님께서 진행해 주실 순서
        </div>
        {step3.ordered.map((o, i) => (
          <div key={i} className="card" style={o.highlight ? { borderColor: 'var(--blue-500)', background: 'var(--blue-50)', borderWidth: 2 } : {}}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, background: o.highlight ? 'var(--blue-500)' : 'var(--ink-100)', color: o.highlight ? '#fff' : 'var(--ink-700)', padding: '2px 7px', borderRadius: 999 }}>ORDER {i + 1}</span>
              {o.highlight && <span style={{ fontSize: 11, color: 'var(--blue-600)', fontWeight: 600 }}>⚠ 가장 많이 헷갈리는 부분</span>}
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 4 }}>{o.t}</div>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-800)', lineHeight: 1.7 }}>{o.d}</p>
            {o.bullets && <ul className="nested-bullets">{o.bullets.map((b, j) => <li key={j}>{b}</li>)}</ul>}
            {o.extra && <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--ink-800)', lineHeight: 1.7 }}>{o.extra}</p>}
            {o.tip && (
              <div className="alert warn" style={{ marginTop: 10, marginBottom: 0 }}>
                <Icon.alert /> <span>{o.tip}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── 챕터 3: 본문 작성 ──────────────────────────────
function Final_Body() {
  return (
    <div className="section">
      {/* 도입부 */}
      <div className="body-intro">
        <div className="body-intro-lead">
          <div className="body-intro-mark">💬</div>
          <p>{GUIDE.body.intro1}</p>
        </div>
        <div className="body-intro-points">
          <div className="body-intro-point">
            <span className="bi-num" aria-hidden>
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            </span>
            <p>{GUIDE.body.intro2}</p>
          </div>
          <div className="body-intro-point">
            <span className="bi-num" aria-hidden>
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            </span>
            <p>{GUIDE.body.intro3}</p>
          </div>
        </div>
        <div className="body-intro-highlight">
          <p><strong>{GUIDE.body.intro4}</strong></p>
          <p>{GUIDE.body.intro5}</p>
        </div>
      </div>

      <h2 style={{ marginTop: 28 }}>📌 본문 구성을 위한 안내사항</h2>
      <p style={{ fontSize: 13, color: 'var(--ink-800)', marginTop: 0, marginBottom: 14, lineHeight: 1.7 }}>
        {GUIDE.body.mustIntro}
      </p>
      {GUIDE.body.must.map((m, i) => (
        <div key={i} className="step-card" style={{ cursor: 'default' }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, background: 'var(--blue-500)', color: '#fff', fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>{i + 1}</div>
          <div className="step-body">
            <h3>{m.t}</h3>
            <p style={{ whiteSpace: 'pre-line' }}>{m.d}</p>
          </div>
        </div>
      ))}

      <h2 style={{ marginTop: 28, fontSize: 16 }}>보충 안내</h2>
      <div className="alert info"><Icon.info /><span>{GUIDE.body.check1}</span></div>
      <div className="alert info"><Icon.info /><span>{GUIDE.body.check2}</span></div>
      <div className="alert warn"><Icon.alert /><span>{GUIDE.body.check3}</span></div>
    </div>
  );
}

// ─── 챕터 4: 홍보 예시 ──────────────────────────────
function Final_Example() {
  return (
    <div className="section">
      <h2 style={{ marginTop: 0 }}>광고 표기법 및 홍보 예시</h2>
      <p style={{ fontSize: 13, color: 'var(--ink-800)', marginTop: 0, marginBottom: 14, lineHeight: 1.7 }}>
        {GUIDE.body.adIntro}
      </p>
      {GUIDE.body.adOptions.map((o, i) => (
        <div key={i} className="ad-option-card">
          <span className="ad-option-chip">{o.name}</span>
          <div className="ad-option-desc">{o.desc}</div>
        </div>
      ))}
      <div className="alert info" style={{ marginTop: 10 }}><Icon.info /><span>{GUIDE.body.check4}</span></div>

      <div className="ref-image-block">
        <div className="ref-image-caption">📎 참고 · 공정거래위원회 보도자료 예시</div>
        <img src={window.__resources && window.__resources.exWork1 || 'assets/example-work-1.jpg'} alt="경제적 이해관계 표시 예시 1" />
        <img src={window.__resources && window.__resources.exWork2 || 'assets/example-work-2.jpg'} alt="경제적 이해관계 표시 예시 2" style={{ borderTop: '1px solid var(--ink-200)' }} />
      </div>

      <div className="ref-image-block">
        <div className="ref-image-caption">📎 콘텐츠 참고 예시</div>
        <img src={window.__resources && window.__resources.adDisc1 || 'assets/ad-disclosure-1.png'} alt="콘텐츠 참고 예시 1" />
        <img src={window.__resources && window.__resources.adDisc2 || 'assets/ad-disclosure-2.png'} alt="콘텐츠 참고 예시 2" style={{ borderTop: '1px solid var(--ink-200)' }} />
        <img src={window.__resources && window.__resources.adDisc3 || 'assets/ad-disclosure-3.png'} alt="콘텐츠 참고 예시 3" style={{ borderTop: '1px solid var(--ink-200)' }} />
      </div>

      <h2 style={{ marginTop: 28 }}>📌 홍보 게시글 예시</h2>
      <div className="card" style={{ background: '#000', color: '#fff', padding: 16, borderRadius: 16, border: 'none' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg, var(--blue-400), oklch(0.7 0.2 320))' }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>@your_account</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>지금 · X</div>
          </div>
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>
          <span style={{ color: 'var(--blue-200)' }}>#광고</span> 드디어 뫄뫄솨솨도 룩업이~!!{'\n\n'}
          이렇게 생긴 뫄뫄솨솨가 손바닥 위에서 빤히 쳐다보면 어떡할거야?{'\n'}
          인용으로 MBTI랑 반응 알려줘{'\n\n'}
          예약기간 내 5% 할인, 첫 구매 3,000원 할인 혜택{'\n'}
          꼬옥 받아가세요! (~5/17 예약마감){'\n\n'}
          <span style={{ color: 'var(--blue-200)', fontFamily: 'var(--font-mono)' }}>뫄뫄: m.site.naver.com/xxxxx</span>{'\n'}
          <span style={{ color: 'var(--blue-200)', fontFamily: 'var(--font-mono)' }}>솨솨: m.site.naver.com/ooooo</span>
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink-600)', marginTop: 8, textAlign: 'center' }}>
        ※ 실제 본문은 평소 크리에이터님의 스타일대로 자유롭게 작성해 주세요.
      </div>
    </div>
  );
}

// ─── 챕터 3: 제작 규칙 ──────────────────────────────
function Final_Rules() {
  return (
    <div className="section">
      <div className="card" style={{ background: '#fff' }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-900)', lineHeight: 1.75 }}>
          {GUIDE.rules.intro}
        </p>
      </div>
      <div className="alert info"><Icon.info /><span>{GUIDE.rules.note}</span></div>

      <h2 style={{ marginTop: 22, fontSize: 18 }}>1. 제한 사항</h2>
      {GUIDE.rules.forbidden.map((f, i) => (
        <div key={i} className="card" style={{ borderLeft: '3px solid var(--danger-accent)' }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 6, letterSpacing: '-0.01em' }}>{f.t}</div>
          <div style={{ fontSize: i === 0 ? 13.5 : 12.5, fontWeight: i === 0 ? 700 : 400, color: 'var(--ink-800)', lineHeight: 1.7 }}>{f.d}</div>
        </div>
      ))}

      {/* 유출·재배포 금지 — 저작권 준수 및 도용 금지 바로 밑, 2. 표현 가이드 위 */}
      <div className="alert danger alert-danger-outline" style={{ fontWeight: 500 }}>
        <Icon.alert />
        <span>
          <strong>본 협업 가이드 페이지의 유출 · 재배포를 금합니다.</strong><br/>
          페이지 내용은 협업 진행을 위한 용도로만 열람·사용해주세요.
        </span>
      </div>

      <h2 style={{ marginTop: 22, fontSize: 18 }}>2. 표현 가이드</h2>
      <div className="allow-deny">
        <div className="ad-box ad-allow">
          <span className="ad-icon">⭕</span>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>허용</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{GUIDE.rules.expression.allow.title}</div>
          <div style={{ opacity: 0.85, lineHeight: 1.5 }}>{GUIDE.rules.expression.allow.example}</div>
        </div>
        <div className="ad-box ad-deny">
          <span className="ad-icon">❌</span>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>불가</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{GUIDE.rules.expression.deny.title}</div>
          <ul style={{ padding: 0, margin: 0, listStyle: 'none' }}>
            {GUIDE.rules.expression.deny.examples.map((e, i) => (
              <li key={i} style={{ padding: '2px 0', opacity: 0.85, lineHeight: 1.5 }}>· {e}</li>
            ))}
          </ul>
        </div>
      </div>

      <h2 style={{ marginTop: 22, fontSize: 18 }}>💗 브랜드 가치 보호 안내</h2>
      <p style={{ fontSize: 12.5, color: 'var(--ink-800)', marginTop: 0, marginBottom: 10, lineHeight: 1.7 }}>
        {GUIDE.rules.ipIntro}
      </p>
      {GUIDE.rules.ipProtect.map((r, i) => (
        <div key={i} className="card" style={{ borderLeft: '3px solid oklch(0.7 0.2 320)' }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon.alert style={{ color: 'oklch(0.55 0.2 320)', width: 15, height: 15, flexShrink: 0 }} />{r.t}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-800)', lineHeight: 1.7 }}>{r.d}</div>
        </div>
      ))}
    </div>
  );
}

// ─── 챕터 5: 보상 ──────────────────────────────
function Final_Reward() {
  return (
    <div className="section">
      <div className="card" style={{ background: 'var(--blue-500)', color: '#fff', borderColor: 'var(--blue-500)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {GUIDE.reward.tiers.map((t, i) => (
            <div key={i} style={{ padding: '14px 0 6px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 800, background: 'rgba(255,255,255,0.25)', padding: '2px 8px', borderRadius: 6, letterSpacing: '0.04em' }}>STEP {t.step}</span>
                <span style={{ fontSize: 20 }}>{t.emoji}</span>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{t.range} (택1)</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'stretch' }}>
                {t.options.map((op, j) => (<React.Fragment key={j}>{j === 1 && <div style={{ textAlign: 'center', fontWeight: 800, fontSize: 13, opacity: 0.85, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>OR</div>}
                  <div key={j} style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, opacity: 0.8, marginBottom: 4, letterSpacing: '0.06em' }}>{op.label}</div>
                    <div style={{ fontSize: 13.5, fontWeight: 800, lineHeight: 1.3, marginBottom: 4 }}>{op.name}</div>
                    <div style={{ fontSize: 11, opacity: 0.85, lineHeight: 1.5, whiteSpace: 'pre-line' }}>{op.desc}</div>
                    {op.note && <div style={{ fontSize: 10, opacity: 0.75, marginTop: 6, borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: 5 }}>{op.note}</div>}
                  </div>
                </React.Fragment>))}
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.2)', fontSize: 12.5, opacity: 0.95, lineHeight: 1.6 }}>
          <div><span style={{ opacity: 0.75 }}>집계 기간 · </span>{GUIDE.reward.period}</div>
          <div style={{ marginTop: 4 }}><span style={{ opacity: 0.75 }}>지급 시기 · </span>{GUIDE.reward.payout}</div>
        </div>
        {GUIDE.reward.tiersNote && (
          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.9, lineHeight: 1.6 }}>{GUIDE.reward.tiersNote}</div>
        )}
        {GUIDE.reward.tiersBNote && (
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9, lineHeight: 1.6 }}>{GUIDE.reward.tiersBNote}</div>
        )}
      </div>

      <div className="alert warn" style={{ marginTop: 10 }}>
        <Icon.alert /><span style={{ fontWeight: 700 }}>{GUIDE.reward.tiersDisclaimer}</span>
      </div>

      <div className="alert info" style={{ marginTop: 10 }}>
        <Icon.info /><span>{GUIDE.reward.note}</span>
      </div>

      <div className="alert info" style={{ marginTop: 10 }}>
        <Icon.info /><span>쿠폰 보상 조정 관련하여 문의가 있으실 경우 <strong>07 FAQ</strong> 단락을 참조해주세요.</span>
      </div>
    </div>
  );
}

// ─── 챕터 5: FAQ ──────────────────────────────
function Final_Faq({ openFaq, setOpenFaq, onGoTab }) {
  return (
    <div className="section">
      <p style={{ fontSize: 13, color: 'var(--ink-800)', marginTop: 0, marginBottom: 16, lineHeight: 1.7 }}>
        {GUIDE.faqIntro}
      </p>
      {GUIDE.faqs.map((f, i) => (
        <div key={i} className={'faq-item' + (openFaq === i ? ' open' : '')} onClick={() => setOpenFaq(openFaq === i ? -1 : i)}>
          <div className="faq-q">
            <span className="q-badge">Q{String(i + 1).padStart(2, '0')}</span>
            <span style={{ flex: 1 }}>{f.q}</span>
            <Icon.chev className="chev ic" />
          </div>
          <div className="faq-a">
            {f.a.map((line, j) => (<div key={j} style={{ margin: '6px 0' }}>{line}</div>))}
          </div>
        </div>
      ))}

      {/* 문의 입력 박스 → 챗봇으로 대체 (chat-widget.jsx) */}
      <ChatBox brand="megahouse" onGoTab={onGoTab} />
    </div>
  );
}

Object.assign(window, { FinalOption });
