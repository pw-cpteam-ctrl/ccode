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

function FinalOption() {
  const [phase, setPhase] = React.useState('cover');
  const [tab, setTab] = React.useState('flow');
  const [openFaq, setOpenFaq] = React.useState(-1);

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

          <h1 style={{ fontSize: 30, fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1.15, margin: '0 0 6px' }}>
            크리에이터 협업 가이드 👋
          </h1>
          <div style={{ fontSize: 13, fontWeight: 600, opacity: 0.75, marginBottom: 14, letterSpacing: '-0.01em' }}>
            굿스마일컴퍼니PW / 부시로드 크리에이티브
          </div>
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
              수고하셨어요! 아래 안내를 확인해주세요.
            </div>
          </div>
        </div>

        {/* 하단 본문 — 하얀 영역 */}
        <div className="done-body">
          <div className="done-card">
            <div className="done-card-head">
              <span className="done-card-icon">📨</span>
              <span className="done-card-title">다음 할 일</span>
            </div>
            <p className="done-card-text">
              담당자에게 <strong>초안 작업 일정</strong>을 공유해주세요. 추가로 궁금하거나 협의가 필요한 부분이 있다면 언제든 편히 말씀해주세요.
            </p>
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
      <WorkflowDiagram label="예약 상품 협업" />
      <WorkflowDiagram
        label="입고 상품 협업"
        steps={[
          { n: '①', title: '상품 수령', cap: '협찬 상품 수령 확인' },
          { n: '②', title: '초안 준비', cap: '그림·영상·글 자유 형식' },
          { n: '③', title: '피드백 확인', cap: '담당자 검토·수정 조율' },
          { n: '④', title: '최종본 체크', cap: '완성본·업로드 본문 회신' },
          { n: '⑤', title: '본인 계정\n업로드', cap: '컨펌 본문·작업물 업로드', key: true },
        ]}
      />

      {/* STEP 1 */}
      <div className="step-card">
        <div className="step-num">{step1.n}</div>
        <div className="step-body">
          <h3>{step1.emoji} STEP {step1.n}. {step1.title}</h3>
          <p>{step1.short}</p>
        </div>
      </div>
      <div className="card step-nested">
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-800)', lineHeight: 1.7 }}>먼저, 최신 정보 전달 및 DM 누락 최소화를 위하여 <strong style={{ textDecoration: 'underline' }}>현재 연락 중이신 플랫폼의 협업 브랜드 계정</strong>을 팔로우해 주세요. 협업 기간 내 업데이트 되는 최신 상품 소식을 빠르게 확인하실 수 있습니다.</p>
        {step1.accounts && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--ink-200)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr', gap: '6px 10px', fontSize: 12 }}>
              <div style={{ fontWeight: 700, color: 'var(--ink-400)', paddingBottom: 4 }}>브랜드</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 700, color: 'var(--ink-400)', paddingBottom: 4 }}><Icon.x_social style={{ width: 12, height: 12 }} /> X (구 트위터)</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 700, color: 'var(--ink-400)', paddingBottom: 4 }}><Icon.ig style={{ width: 12, height: 12 }} /> Instagram</div>
              {step1.accounts.map((a) => (
                <React.Fragment key={a.brand}>
                  <div style={{ fontWeight: 700, color: 'var(--ink-800)' }}>{a.brand}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--blue-600)', fontWeight: 600 }}>{a.x}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--blue-600)', fontWeight: 600 }}>{a.ig}</div>
                </React.Fragment>
              ))}
            </div>
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
function WorkflowDiagram({ label = '예약 상품 협업', steps: customSteps }) {
  const steps = customSteps || [
    { n: '①', title: '초안 준비 단계', cap: '그림·영상·글 자유 형식' },
    { n: '②', title: '피드백 받기', cap: '담당자 검토·수정 조율' },
    { n: '③', title: '최종본 확정', cap: '완성본·업로드 본문 회신' },
    { n: '④', title: '스토어 오픈 후\n판매글 공유', cap: '공식 게시글 먼저 공유', key: true, warn: true },
    { n: '⑤', title: '내 계정에\n업로드', cap: '컨펌 본문·작업물 업로드', key: true },
  ];
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--blue-600)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
        [{label}]
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
              <span style={{ fontSize: 11, color: 'var(--ink-600)', fontWeight: 600 }}>※ 담당자가 먼저 전달해 드리는 사항</span>
            </div>
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
      <div className="alert warn"><Icon.alert /><span>{GUIDE.body.check2}</span></div>
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
        <img src={window.__resources && window.__resources.b2Ex1 || 'assets/b2-example-1.png'} alt="콘텐츠 참고 예시 1" />
        <img src={window.__resources && window.__resources.adDisc2 || 'assets/ad-disclosure-2.png'} alt="콘텐츠 참고 예시 2" style={{ borderTop: '1px solid var(--ink-200)' }} />
        <img src={window.__resources && window.__resources.b2Ex3 || 'assets/b2-example-3.png'} alt="콘텐츠 참고 예시 3" style={{ borderTop: '1px solid var(--ink-200)' }} />
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
          <span style={{ color: 'var(--blue-200)' }}>#광고</span> 드디어 뫄뫄솨솨도 넨도로이드가~!!{'\n\n'}
          굿스마일 컴퍼니 by PW에서 예약받고 있으니{'\n'}
          첫구매 5% 할인, 알림받기 1,000원 할인 혜택까지{'\n'}
          꼬옥 받아가세요! (~5/17 예약마감){'\n\n'}
          자세한 내용은 아래 링크를 참고해주세요~!!{'\n\n'}
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
          {f.bullets && (
            <ul style={{ margin: '8px 0 0', padding: '0 0 0 16px', fontSize: 12, color: 'var(--ink-700)', lineHeight: 1.7 }}>
              {f.bullets.map((b, bi) => <li key={bi}>{b}</li>)}
            </ul>
          )}
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
        <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 16, lineHeight: 1.6 }}>{GUIDE.reward.intro}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 10, padding: '14px 14px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, opacity: 0.75, marginBottom: 6, letterSpacing: '0.06em' }}>지급 상품</div>
            <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.3 }}>{GUIDE.reward.product}</div>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 10, padding: '14px 14px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, opacity: 0.75, marginBottom: 6, letterSpacing: '0.06em' }}>지급 시점</div>
            <div style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.4 }}>{GUIDE.reward.payout}</div>
          </div>
        </div>
      </div>
      <div className="alert info" style={{ marginTop: 10 }}>
        <Icon.info /><span>{GUIDE.reward.note}</span>
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
      <ChatBox brand="brand2" onGoTab={onGoTab} />
    </div>
  );
}

Object.assign(window, { FinalOption });
