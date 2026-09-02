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

// 수령 방식(트랙). 06 보상 탭의 GUIDE.reward.tracks와 같은 내용이며, 여기서는
// 고르기 위한 짧은 문구만 둔다. 한 번 정하면 변경할 수 없다.
const TRACK_CHOICES = [
  { id: 'split', emoji: '🟦', label: '선지급', desc: '먼저 받고\n나중에 더 받기', copy: '선지급 (업로드 후 5만 원 + 750 달성 시 추가)' },
  { id: 'after', emoji: '🟨', label: '후지급', desc: '정산 후\n한 번에 받기',   copy: '후지급 (프리오더 마감 이후 한 번에)' },
];

// ─── 팬 이벤트 안내 ──────────────────────────────────────────────
// 탭 목록(01~07)에는 넣지 않고, 06 보상 탭 맨 아래 작은 링크로만 들어간다.
// 이벤트를 실제로 계획하는 크리에이터만 보면 되는 내용이고, 모두에게 크게 노출하면
// 굳이 안 해도 될 이벤트를 하게 만들 수 있어서 접근성을 일부러 낮춰 뒀다.
//
// 담당자 회신용 폼 주소가 정해지면 EVENT_FORM_URL만 채우면 된다.
// 비어 있으면 "담당자에게 문의" 안내로 대체되어, 잘못된 링크가 나가지 않는다.
const EVENT_FORM_URL = '';

const EVENT_GUIDE = {
  title: '팬 이벤트 진행 안내',
  lead: '받으신 보상을 팬 이벤트 경품으로 활용하실 때 확인해 주세요.',

  // 이 정책은 원래 "대부분 자율"이 핵심인데, 항목을 전부 같은 무게로 늘어놓으면
  // "지켜야 할 규칙이 잔뜩"으로 읽혀서 오히려 이벤트를 접게 만든다.
  // 그래서 꼭 맞춰야 하는 것(3개)만 먼저 보여주고, 자유로운 부분을 그다음에,
  // 나머지 상세는 접어 둔다.
  musts: [
    { t: '이벤트 기간 7일 이상', d: '참여자가 충분히 모이려면 최소 일주일은 필요해요' },
    { t: '당첨자 정보 발표 후 3일 이내 전달', d: '경품 발송을 위해 필요해요' },
    { t: '진행 전 기획 방향 공유', d: '담당자에게 간단히만 알려주시면 돼요' },
  ],

  frees: [
    '경품을 몇 명에게, 얼마씩 나눌지',
    '경품 형태 — 금액 쿠폰 / 상품 쿠폰',
    '마감일, 발표 방식, 참여 조건 등 세부 사항',
  ],

  details: [
    {
      emoji: '🎁',
      title: '경품은 이렇게 나눌 수 있어요',
      body: '받으신 보상 전부를 경품으로 드려도 되고, 일부만 나눠 드려도 됩니다.',
      bullets: [
        '전액 양도 — 5만 원 상당 전부를 당첨자 1명에게',
        '나눠서 양도 — 예: 1만 원씩 5명에게',
        '일부만 양도 — 예: 2만 원씩 2명에게 드리고 나머지는 본인 수령',
      ],
      note: '유입 수에 따른 보상은 이벤트를 진행하셔도 그대로 적용됩니다.',
    },
    {
      emoji: '🏷',
      title: '경품 형태는 두 가지예요',
      body: '보상이 금액 쿠폰과 상품 쿠폰 두 종류라, 경품도 같은 형태로 나갑니다.',
      bullets: [
        '금액 쿠폰형 — 당첨자에게 스토어 금액 쿠폰 지급',
        '상품 쿠폰형 — 당첨자에게 해당 월 룩업 상품 쿠폰 지급',
      ],
      note: '자세한 보상 종류는 06 보상 탭을 참고해 주세요.',
    },
    {
      emoji: '⏱',
      title: '경품 쿠폰은 언제 지급되나요',
      body: '메가하우스 오픈일로부터 7일 이내에, 콘텐츠 업로드가 확인된 이후 발급됩니다. 크리에이터님이 보상을 받으시는 시점과 같아요.',
      note: '두 조건을 모두 충족해야 발급됩니다 — 오픈일 기준 7일 이내 + 콘텐츠 업로드 확인',
    },
    {
      emoji: '📋',
      title: '당첨자 정보는 이렇게 보내주세요',
      body: '경품 발송을 위해 당첨자분의 네이버 아이디와 성함이 필요합니다.',
      bullets: [
        '주소는 필요하지 않습니다',
        '당첨자분께 정보 수집 동의를 먼저 받아주세요',
      ],
      form: true,
    },
    {
      emoji: '🔄',
      title: '당첨자가 연락을 받지 않으면',
      body: '차순위 당첨자에게 연락해 주시면 됩니다. 개별 당첨자분의 응답 여부는 크리에이터님 재량으로 진행해 주세요.',
    },
    {
      emoji: '💬',
      title: '진행 전 공유해 주실 내용',
      body: '이벤트를 기획하시면 아래 내용을 담당자에게 간단히 알려주세요.',
      bullets: [
        '게시물에 올라갈 텍스트 초안 또는 기획 방향',
        '진행 기간',
        '참여 방법',
        '당첨자 발표 일정',
      ],
    },
  ],
};

// 담당자에게 붙여넣을 회신 문구를 만든다. 항목 이름은 화면에 보이는 것과 똑같이 맞춘다
// — 크리에이터가 "내가 고른 게 그대로 갔구나"를 바로 알 수 있어야 하기 때문.
function buildReplyText(dateLabel, track, reward) {
  return [
    '[협업 진행 정보]',
    `① 초안 공유 예정일 : ${dateLabel}`,
    `② 보상 수령 방식 : ${track.copy}`,
    `③ 보상 형태 : ${reward.copy}`,
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
        {/* 범례를 아래 별도 줄이 아니라 제목 옆에 둔다 — 설명은 남기고 높이는 아낀다 */}
        <div className="cal-titlebox">
          <span className="cal-title">{year}년 {month + 1}월</span>
          <span className="cal-legend"><span className="cal-legend-dot" />오픈일</span>
        </div>
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
              {/* 누르는 영역은 칸 전체, 눈에 보이는 동그라미는 그 안의 span —
                  동그라미를 작게 줄여도 손가락으로 누르기는 그대로 편하게 둔다 */}
              <span className="cal-dot">{day}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── 고른 값 임시 저장 ────────────────────────────────────────────
// 06 탭에서 고른 값을 마지막 페이지까지 들고 가야 하는데, 중간에 새로고침하면
// 날아간다. 브라우저에 하루만 남겨둔다 — 같은 날 다시 열면 유지되고,
// 다음 협업(다음 달) 때는 남은 값이 없이 새로 시작한다.
const REPLY_KEY = 'cg-reply';
const REPLY_TTL_MS = 24 * 60 * 60 * 1000;

function loadReply() {
  try {
    const saved = JSON.parse(localStorage.getItem(REPLY_KEY) || 'null');
    if (!saved || !saved.savedAt || Date.now() - saved.savedAt > REPLY_TTL_MS) return {};
    // 예전에 저장된 값에 없는 항목이 있어도 깨지지 않도록 항상 기본값을 깔아둔다.
    // track은 나중에 추가된 항목이라, 그전에 저장된 값에는 아예 없다.
    return { date: saved.date ?? '', track: saved.track ?? '', reward: saved.reward ?? '' };
  } catch {
    return {};   // 저장값이 망가져 있어도 화면은 정상 동작해야 한다
  }
}

function saveReply(date, track, reward) {
  try {
    localStorage.setItem(REPLY_KEY, JSON.stringify({ v: 2, date, track, reward, savedAt: Date.now() }));
  } catch { /* 저장 실패해도 이번 이용엔 지장 없다 */ }
}

// ─── 담당자에게 알려줄 내용 (06 보상 탭 맨 아래) ──────────────────
// 원래는 마지막 페이지에 있었는데, 다 읽고 "끝났다" 상태에서는 그냥 넘겨버려서
// 회신율이 낮았다. 가이드 원문이 이미 이 자리에서 "수령 방식을 사전 공유해달라"고
// 부탁하고 있으므로, 부탁하는 문장 바로 옆에 답하는 칸을 둔다.
function ReplyForm({ draftDate, setDraftDate, trackId, rewardId, setRewardId, canCopy, copied, onCopy, onGoReward }) {
  // 수령 방식은 이제 이 폼이 아니라 바로 위 '언제 받나' 카드에서 직접 고른다.
  // 아직 안 골랐으면 그 자리로 스크롤해 이동시켜 준다.
  const goToTrackChoice = () => {
    document.getElementById('reward-track-choice')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div className="done-card">
      <div className="done-card-head">
        <span className="done-card-icon">📨</span>
        <span className="done-card-title">협업 시작 전, 담당자에게 알려주세요</span>
      </div>
      <p className="done-card-text" style={{ marginBottom: 14 }}>
        수령 방식 선택까지 마치셨다면, 아래 두 가지만 확인해 주세요.
      </p>

      {!trackId && (
        <button type="button" className="reply-track-missing" onClick={goToTrackChoice}>
          <Icon.info /> <span>위에서 보상 수령 방식을 선택해 주세요.</span><span aria-hidden="true">↑</span>
        </button>
      )}

      <div className="reply-field">
        <div className="reply-label"><span className="reply-num">①</span> 초안 공유 예정일</div>
        <CalendarPicker value={draftDate} onChange={setDraftDate} />
        {draftDate && (
          <div className="reply-picked">선택한 날짜 · <strong>{formatDate(draftDate)}</strong></div>
        )}
        <div className="reply-hint">대략적인 날짜여도 괜찮아요.<br />나중에 바뀌어도 됩니다 🙂</div>
      </div>

      <div className="reply-field">
        <div className="reply-label"><span className="reply-num">②</span> 보상 형태</div>
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
        <div className="reply-hint">금액·구성은 유입 수에 따라 정해져요</div>
      </div>

      <div className="reply-warn">보상 수령 방식과 보상 형태는 선택 후 변경·교환이 어렵습니다.</div>

      <button type="button" className={`reply-copy${copied ? ' is-done' : ''}`}
        disabled={!canCopy} onClick={onCopy}>
        {copied ? '✓  복사됐어요!' : '📋  복사하기'}
      </button>
      <div className="reply-guide">
        {canCopy ? '담당자에게 붙여넣기만 하면 끝!' : '보상 수령 방식과 아래 두 가지를 모두 선택해 주세요'}
      </div>
    </div>
  );
}

// 탭 바 없이 전체 화면으로 열리는 별도 페이지. 돌아가기로만 빠져나온다.
function EventGuide({ onBack }) {
  return (
    <div className="ev">
      <div className="ev-top">
        <button type="button" className="ev-back" onClick={onBack}>
          ‹ 보상 탭으로 돌아가기
        </button>
      </div>

      <div className="ev-hero">
        <div className="ev-hero-tag">FAN EVENT</div>
        <h1 className="ev-hero-title">{EVENT_GUIDE.title}</h1>
        <p className="ev-hero-lead">{EVENT_GUIDE.lead}</p>
      </div>

      <div className="ev-body">
        {/* 먼저 "지켜야 할 게 3개뿐"이라는 것을 보여준다 — 분량 부담을 줄이는 핵심 */}
        <div className="ev-must">
          <div className="ev-must-lead">
            대부분 자유롭게 정하시면 돼요.<br />
            꼭 맞춰주실 건 <b>아래 3가지</b>뿐이에요.
          </div>
          {EVENT_GUIDE.musts.map((m, i) => (
            <div className="ev-must-item" key={i}>
              <span className="ev-must-check">✓</span>
              <span className="ev-must-text">
                <b>{m.t}</b>
                <span>{m.d}</span>
              </span>
            </div>
          ))}
        </div>

        <div className="ev-free">
          <div className="ev-free-title">자유롭게 정하셔도 되는 것</div>
          <ul className="ev-free-list">
            {EVENT_GUIDE.frees.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        </div>

        {/* 나머지는 접어 둔다. 필요한 사람만 펼쳐 보면 되는 내용 */}
        <details className="ev-more">
          <summary className="ev-more-head">
            <span>자세한 안내 보기</span>
            <span className="ev-more-sub">경품 구성 · 지급 시점 · 당첨자 정보 · 공유할 내용</span>
            <span className="ev-more-arrow">⌄</span>
          </summary>
          <div className="ev-more-body">
            {EVENT_GUIDE.details.map((s2, i) => (
              <div className="ev-item" key={i}>
                <div className="ev-item-head">
                  <span className="ev-item-emoji">{s2.emoji}</span>
                  <h2 className="ev-item-title">{s2.title}</h2>
                </div>
                <p className="ev-item-body">{s2.body}</p>
                {s2.bullets && (
                  <ul className="ev-list">
                    {s2.bullets.map((b, j) => <li key={j}>{b}</li>)}
                  </ul>
                )}
                {s2.form && (
                  EVENT_FORM_URL
                    ? <a className="ev-form-btn" href={EVENT_FORM_URL} target="_blank" rel="noopener noreferrer">
                        당첨자 정보 보내기 →
                      </a>
                    // 폼 주소가 아직 없을 때. 잘못된 링크를 내보내지 않고 안내로 대체한다
                    : <div className="ev-form-todo">당첨자 정보 제출 링크는 담당자가 별도로 전달드립니다.</div>
                )}
                {s2.note && <div className="ev-note">{s2.note}</div>}
              </div>
            ))}
          </div>
        </details>

        <div className="ev-foot">
          궁금한 점이 있으시면 담당자에게 편히 문의해 주세요.
        </div>
        <button type="button" className="ev-back-btn" onClick={onBack}>
          보상 탭으로 돌아가기
        </button>
      </div>

      <div className="done-copyright" style={{ padding: '16px 20px 24px' }}>
        <strong>ⓒ PRESENCE WORLD</strong> · 본 협업 가이드 페이지의 <strong>유출 · 재배포를 금합니다.</strong>
      </div>
    </div>
  );
}

// ─── 플로팅/FAQ 공용 AI 채팅 도크 ──────────────────────────────
// ChatBox는 여기서 한 번만 마운트된다. 01~06 탭에서는 접힌 플로팅 스티커로,
// 07 FAQ 탭에서는 문서 흐름 안의 인라인 카드로 모습만 바뀔 뿐, 컴포넌트 자체는
// 그대로 유지되므로 대화 내용이 두 화면 사이에서 계속 이어진다.
function FloatingChatDock({ brand, onGoTab, inline = false }) {
  const [open, setOpen] = React.useState(false);
  const close = () => setOpen(false);
  const visible = inline || open;

  // FAQ를 떠날 때는 읽던 페이지를 가리지 않도록 다시 스티커 상태로 접는다.
  React.useEffect(() => {
    if (!inline) setOpen(false);
  }, [inline]);

  return (
    <>
      {open && !inline && <button type="button" className="ai-dock-backdrop" aria-label="AI 질문창 접기" onClick={close} />}
      <div className={`ai-dock${inline ? ' ai-dock-inline' : ''}`}>
        <button type="button" className="ai-dock-sticker" hidden={visible} onClick={() => setOpen(true)} aria-label="헷갈리거나 궁금한 내용을 챗봇에게 물어보기">
          <span className="ai-dock-sticker-icon">💬</span>
          <span className="ai-dock-sticker-copy">
            <strong>헷갈리거나 궁금한 내용이 있어요!</strong>
            <small>챗봇에게 바로 물어보기 &gt;</small>
          </span>
        </button>
        <section className="ai-dock-panel" hidden={!visible} role={inline ? 'region' : 'dialog'} aria-modal={inline ? undefined : 'true'} aria-label="가이드 AI 질문창">
          <div className="ai-dock-head">
            <div>
              <strong>{inline ? 'FAQ에서 원하는 답을 찾지 못하셨나요?' : '가이드 AI'}</strong>
              <span>{inline ? '가이드 AI에게 상황을 직접 설명해 주세요. 기존 대화도 이곳에서 이어집니다.' : '읽다가 헷갈리는 내용을 바로 물어보세요'}</span>
            </div>
            {!inline && <button type="button" className="ai-dock-close" onClick={close} aria-label="AI 질문창 접기">›</button>}
          </div>
          <div className="ai-dock-body">
            <ChatBox brand={brand} onGoTab={(id) => { if (!inline) close(); if (onGoTab) onGoTab(id); }} />
          </div>
        </section>
      </div>
    </>
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
  const [draftDate, setDraftDate] = React.useState(() => loadReply().date ?? '');
  const [trackId, setTrackId] = React.useState(() => loadReply().track ?? '');
  const [rewardId, setRewardId] = React.useState(() => loadReply().reward ?? '');
  const [copied, setCopied] = React.useState(false);

  // 고른 값이 바뀔 때마다 저장 — 중간에 새로고침해도 남아 있게
  React.useEffect(() => { saveReply(draftDate, trackId, rewardId); }, [draftDate, trackId, rewardId]);

  const track = TRACK_CHOICES.find(t => t.id === trackId);
  const reward = REWARD_CHOICES.find(r => r.id === rewardId);
  const canCopy = Boolean(draftDate && track && reward);

  const copyReply = async () => {
    if (!canCopy) return;
    const text = buildReplyText(formatDate(draftDate), track, reward);

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

  // 마지막 페이지에서 "고르러 가기"를 누르면 06 보상 탭으로 보낸다
  const goReward = () => { setPhase('main'); setTab('reward'); scrollTop(); };

  // ─── 팬 이벤트 안내 (탭 목록에 없는 별도 페이지) ───────────────
  // 주소 끝에 #event 를 붙이면 바로 열린다. 담당자가 "이벤트 하실 거면 여기 보세요"
  // 하고 링크 하나만 보낼 수 있게 하기 위한 것.
  React.useEffect(() => {
    const apply = () => setPhase((prev) => {
      if (window.location.hash === '#event') return 'event';
      // 브라우저 뒤로가기로 #event 를 빠져나온 경우 원래 화면으로 되돌린다
      return prev === 'event' ? 'main' : prev;
    });
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, []);

  // 화면과 주소를 맞춰 둔다 — 이벤트 페이지에 있을 때만 #event 가 붙어 있게
  React.useEffect(() => {
    const hasHash = window.location.hash === '#event';
    if (phase === 'event' && !hasHash) {
      history.replaceState(null, '', '#event');
    } else if (phase !== 'event' && hasHash) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, [phase]);

  if (phase === 'event') {
    return <EventGuide onBack={goReward} />;
  }

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
              GUIDE COMPLETE · 07 / 07
            </div>
            <div style={{ fontSize: 52, marginBottom: 10, lineHeight: 1 }}>🎉</div>
            <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: '-0.03em', margin: '0 0 8px', lineHeight: 1.15 }}>
              모두 확인 완료했어요
            </h1>
            <div style={{ fontSize: 13, lineHeight: 1.6, opacity: 0.9 }}>
              {canCopy
                ? <>담당자에게 아래 내용만 보내주시면<br />바로 협업 시작할 수 있어요!</>
                : <>아직 선택하지 않은 항목만 완료하면<br />바로 협업 시작할 수 있어요!</>}
            </div>
          </div>
        </div>

        {/* 하단 본문 — 하얀 영역 */}
        {/* 여기서 새로 묻지 않는다. 06 보상 탭에서 이미 고른 내용을 확인시켜 주고,
            아직 안 골랐으면 그 자리로 보내준다 — 다 읽고 "끝났다" 상태에서 새로
            입력을 요구하면 그냥 넘겨버리기 때문. */}
        <div className="done-body">
          <div className="done-card">
            <div className="done-card-head">
              <span className="done-card-icon">📨</span>
              <span className="done-card-title">담당자에게 알려주실 내용</span>
            </div>

            {canCopy ? (
              <>
                <div className="sum-row">
                  <span className="sum-check">✅</span>
                  <span className="sum-label"><span className="reply-num">①</span> 초안 공유 예정일</span>
                  <span className="sum-value">{formatDate(draftDate)}</span>
                </div>
                <div className="sum-row">
                  <span className="sum-check">✅</span>
                  <span className="sum-label"><span className="reply-num">②</span> 보상 수령 방식</span>
                  <span className="sum-value">{track.label}</span>
                </div>
                <div className="sum-row">
                  <span className="sum-check">✅</span>
                  <span className="sum-label"><span className="reply-num">③</span> 보상 형태</span>
                  <span className="sum-value">{reward.label}</span>
                </div>

                <button type="button" className={`reply-copy${copied ? ' is-done' : ''}`} onClick={copyReply}>
                  {copied ? '✓  복사됐어요!' : '📋  복사하기'}
                </button>
                <div className="reply-guide">담당자에게 붙여넣기만 하면 끝!</div>
                <button type="button" className="sum-edit" onClick={goReward}>내용 수정하기</button>
              </>
            ) : (
              <>
                <p className="done-card-text" style={{ marginBottom: 12 }}>
                  아래 내용을 아직 안 고르셨어요. 리워드 지급 준비를 위해 필요해요.
                </p>
                <div className={`sum-row${draftDate ? '' : ' is-todo'}`}>
                  <span className="sum-check">{draftDate ? '✅' : '⬜'}</span>
                  <span className="sum-label"><span className="reply-num">①</span> 초안 공유 예정일</span>
                  <span className="sum-value">{draftDate ? formatDate(draftDate) : '미선택'}</span>
                </div>
                <div className={`sum-row${track ? '' : ' is-todo'}`}>
                  <span className="sum-check">{track ? '✅' : '⬜'}</span>
                  <span className="sum-label"><span className="reply-num">②</span> 보상 수령 방식</span>
                  <span className="sum-value">{track ? track.label : '미선택'}</span>
                </div>
                <div className={`sum-row${reward ? '' : ' is-todo'}`}>
                  <span className="sum-check">{reward ? '✅' : '⬜'}</span>
                  <span className="sum-label"><span className="reply-num">③</span> 보상 형태</span>
                  <span className="sum-value">{reward ? reward.label : '미선택'}</span>
                </div>
                <button type="button" className="reply-copy" onClick={goReward}>고르러 가기</button>
                <div className="reply-guide">06 보상 탭으로 이동해요</div>
              </>
            )}
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
      {tab === 'body'    && <Final_Body setTab={setTab} scrollTop={scrollTop} />}
      {tab === 'example' && <Final_Example />}
      {tab === 'rules'   && <Final_Rules />}
      {tab === 'reward'  && (
        <Final_Reward
          reply={{ draftDate, setDraftDate, trackId, setTrackId, rewardId, setRewardId, canCopy, copied, onCopy: copyReply }}
        />
      )}
      {tab === 'faq'     && <Final_Faq openFaq={openFaq} setOpenFaq={setOpenFaq} onGoTab={(id) => {
        // 챗봇 답변의 출처를 누르면 그 자리로 보내준다. 'event'는 탭이 아니라 별도 페이지
        if (id === 'event') { setPhase('event'); } else { setTab(id); }
        scrollTop();
      }} />}

      {/* 01~06에서는 플로팅 스티커, 07 FAQ에서는 인라인 카드로 모습만 바뀌는
          단일 챗봇. 탭 조건 밖에서 한 번만 마운트해야 대화 상태가 유지된다. */}
      <FloatingChatDock brand="megahouse" inline={tab === 'faq'} onGoTab={(id) => {
        if (id === 'event') { setPhase('event'); } else { setTab(id); }
        scrollTop();
      }} />

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

      {/* 전체 분량이 주는 부담을 먼저 덜고, 마지막에 무엇을 답해야 하는지 미리 알려 준다.
          다 읽고 나서야 숙제가 처음 등장하던 것이 회신율이 낮은 원인이었다. */}
      <div className="opener">
        <div className="opener-h">⏱ {GUIDE.opener.t}</div>
        <p className="opener-lead">{GUIDE.opener.lead}</p>
        <ul className="opener-keys">
          {GUIDE.opener.keys.map((k, i) => <li key={i}>{k}</li>)}
        </ul>
        <div className="opener-ask">
          <div className="opener-ask-h">📨 {GUIDE.opener.askT}</div>
          <ol className="opener-asks">
            {GUIDE.opener.asks.map((a, i) => <li key={i}>{a}</li>)}
          </ol>
          <div className="opener-ask-note">{GUIDE.opener.askNote}</div>
        </div>
      </div>

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
        {/* 수령 방식은 이 단계에서 정하고 나중에 바꿀 수 없어서, 진행 순서에도 넣어 둔다 */}
        {step1.after && (
          <div className="alert info" style={{ marginTop: 12, marginBottom: 0 }}>
            <Icon.info />
            <span>
              <strong>{step1.after.t}</strong>
              <br />{step1.after.d}
            </span>
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
    { n: '①', title: '초안 준비\n단계', cap: '그림·영상·글\n자유 형식' },
    { n: '②', title: '피드백\n받기', cap: '담당자 검토·수정\n조율' },
    { n: '③', title: '최종본\n확정', cap: '완성본·업로드 본문\n회신' },
    { n: '④', title: '스토어 오픈 후\n판매글 공유', cap: '공식 게시글\n먼저 공유', key: true, warn: true },
    { n: '⑤', title: '내 계정에\n업로드', cap: '컨펌 본문·작업물\n업로드', key: true },
  ];
  return (
    <div className="workflow">
      <div className="workflow-head">
        <span>협업 전체 흐름</span>
        <span className="workflow-swipe">옆으로 밀어보기 →</span>
      </div>
      <div className="workflow-track hide-scrollbar">
        {steps.map((s, i) => (
          <React.Fragment key={i}>
            <div className="workflow-step">
              <div className={`workflow-card${s.key ? ' is-key' : ''}`}>
                <div className="workflow-num">{s.n}</div>
                <div className="workflow-title">{s.title}</div>
                {s.warn && <div className="workflow-warn">⚠ 순서 주의</div>}
              </div>
              <div className="workflow-cap">{s.cap}</div>
            </div>
            {i < steps.length - 1 && (
              <div className="workflow-arrow" aria-hidden="true">
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
function Final_Body({ setTab, scrollTop }) {
  return (
    <div className="section">
      {/* 꼭 넣어야 할 세 가지를 맨 위에 둔다. 예전에는 "자유롭게 쓰세요"라는 같은 뜻의
          문단 다섯 개를 지나야 여기까지 내려왔다. */}
      <h2 style={{ marginTop: 0 }}>📌 본문에 꼭 들어갈 세 가지</h2>
      <p style={{ fontSize: 13, color: 'var(--ink-800)', marginTop: 0, marginBottom: 14, lineHeight: 1.7 }}>
        {GUIDE.body.mustIntro}
      </p>
      {GUIDE.body.must.map((m, i) => (
        <div key={i} className="step-card" style={{ cursor: 'default' }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, background: 'var(--blue-500)', color: '#fff', fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>{i + 1}</div>
          <div className="step-body">
            <h3>{m.t}</h3>
            <p style={{ whiteSpace: 'pre-line' }}>{m.d}</p>
            {/* 광고 표기 방법은 여기서 끝낸다 — 04는 예시만 두기로 했다 */}
            {i === 2 && (
              <div className="ad-ways">
                {GUIDE.body.adOptions.map((o, j) => (
                  <div key={j} className="ad-way">
                    <span className="ad-way-chip">{o.name}</span>
                    <span className="ad-way-desc">{o.desc}</span>
                  </div>
                ))}
                <div className="ad-way-note">{GUIDE.body.check4.replace('※ 참고: ', '')}</div>
                <button type="button" className="ad-way-link" onClick={() => { setTab('example'); scrollTop(); }}>
                  실제 예시 보기 · 04 홍보 예시 탭 →
                </button>
              </div>
            )}
          </div>
        </div>
      ))}

      {/* 서문은 필수 항목 뒤로. 다섯 문단이던 것을 둘로 줄였다 */}
      <div className="body-intro" style={{ marginTop: 20 }}>
        <div className="body-intro-lead">
          <div className="body-intro-mark">💬</div>
          <p>{GUIDE.body.intro1}</p>
        </div>
        <details className="body-style-toggle">
          <summary>
            <span>{GUIDE.body.intro2}</span>
            <span className="body-style-toggle-icon" aria-hidden="true">⌄</span>
          </summary>
          <div className="body-style-toggle-content">
            <p><strong>{GUIDE.body.styleNote1}</strong></p>
            <p>{GUIDE.body.styleNote2}</p>
          </div>
        </details>
      </div>

      <h2 style={{ marginTop: 28, fontSize: 16 }}>보충 안내</h2>
      {/* 상호를 혼동해 잘못 적는 사고가 실제로 있었던 자리라, 스토어 이름만 밑줄로 도드라지게 한다. */}
      <div className="alert info"><Icon.info /><span>{(() => {
        const NAME = "'메가하우스 공식 스토어'";
        const [head, ...rest] = GUIDE.body.check1.split(NAME);
        if (!rest.length) return GUIDE.body.check1;
        return <>{head}<strong className="store-emphasis">{NAME}</strong>{rest.join(NAME)}</>;
      })()}</span></div>
      <div className="alert info"><Icon.info /><span>{GUIDE.body.check2}</span></div>
      <div className="alert warn"><Icon.alert /><span>{GUIDE.body.check3}</span></div>
    </div>
  );
}

// ─── 챕터 4: 홍보 예시 ──────────────────────────────
// 예시 이미지를 세로로 쌓으면 이 탭만 3,495px이 된다. 이미지는 한 장도 빼지 않고
// 좌우로 넘겨 보는 형태로 바꿨다. 몇 장인지·넘길 수 있다는 것을 반드시 표시한다 —
// 표시가 없으면 다음 장이 있는 줄 모르고 지나쳐 오히려 안 보게 된다.
function RefStrip({ caption, images }) {
  return (
    <div className="ref-strip">
      <h2 className="ref-strip-title">{caption}</h2>
      <div className="ref-strip-images">
        {images.map((im, i) => <img key={i} src={im.src} alt={im.alt} />)}
      </div>
    </div>
  );
}

// 콘텐츠 참고 예시 3장을 썸네일 그리드로 보여주고, 눌러서 크게 볼 수 있게 한다.
function ExampleGrid({ caption, hint, labels, images }) {
  const [selected, setSelected] = React.useState(null);
  React.useEffect(() => {
    if (!selected) return;
    const onKeyDown = (e) => { if (e.key === 'Escape') setSelected(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selected]);

  return (
    <div className="example-grid-card">
      <h2 className="example-grid-title"><span>{caption}</span>{hint && <span className="example-grid-title-hint">{hint}</span>}</h2>
      <div className="example-grid">
        {images.map((im, i) => (
          <button type="button" className="example-thumb" key={i} onClick={() => setSelected(im)} aria-label={`${labels[i]} 예시 크게 보기`}>
            <span className="example-thumb-label">{labels[i]}</span>
            <img src={im.src} alt={im.alt} />
          </button>
        ))}
      </div>
      {selected && (
        <div className="image-lightbox" role="dialog" aria-modal="true" aria-label="확대 이미지" onClick={() => setSelected(null)}>
          <button type="button" className="image-lightbox-close" onClick={() => setSelected(null)} aria-label="닫기">×</button>
          <img src={selected.src} alt={selected.alt} onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

function Final_Example() {
  const R = window.__resources || {};
  return (
    <div className="section">
      <h2 style={{ marginTop: 0 }}>홍보 게시글 예시</h2>
      {/* 규칙은 03에서 끝내고 여기서는 예시만 보여준다. 다만 무엇을 지켜야 하는지는
          이미지를 넘겨보지 않아도 눈에 들어오도록 텍스트로 위에 고정해 둔다 */}
      <div className="ad-recap">
        <div className="ad-recap-t">광고 표기, 이 중 하나면 됩니다</div>
        {GUIDE.body.adOptions.map((o, i) => (
          <div className="ad-recap-row" key={i}>
            <span className="ad-recap-chip">{o.name}</span>
            <span>{o.desc}</span>
          </div>
        ))}
      </div>

      <RefStrip caption="📎 참고 · 공정거래위원회 보도자료 예시" images={[
        { src: R.exWork1 || 'assets/example-work-1.jpg', alt: '경제적 이해관계 표시 예시 1' },
        { src: R.exWork2 || 'assets/example-work-2.jpg', alt: '경제적 이해관계 표시 예시 2' },
      ]} />

      <ExampleGrid caption="📎 콘텐츠 참고 예시" hint="(눌러서 크게 보기)" labels={['그림 분야', '정보 분야', '카드뉴스 분야']} images={[
        { src: R.adDisc1 || 'assets/ad-disclosure-1.png', alt: '콘텐츠 참고 예시 1' },
        { src: R.adDisc2 || 'assets/ad-disclosure-2.png', alt: '콘텐츠 참고 예시 2' },
        { src: R.adDisc3 || 'assets/ad-disclosure-3.png', alt: '콘텐츠 참고 예시 3' },
      ]} />

      <h2 style={{ marginTop: 28 }}>✍️ 실제 게시물 구성 예시</h2>
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
// 세 묶음(파랑/보라/빨강 레일)의 아코디언 스택. 한 번에 하나만 펼쳐지고,
// 스크롤 방향에 따라 ①→②→③ / ③→②→① 순으로 자동 전환된다(마그네틱 스크롤).
function RuleAccordion({ id, title, summary, open, onToggle, headerRef, children }) {
  return (
    <div className={`rule-acc rule-acc-${id}`}>
      <button type="button" ref={headerRef} data-rule-group={id} className={`rule-acc-head${open ? ' is-open' : ''}`} onClick={onToggle} aria-expanded={open}>
        <span className="rule-acc-arrow" aria-hidden>{open ? '▼' : '▶'}</span>
        <span>
          <span className="rule-acc-title">{id === 1 ? '①' : id === 2 ? '②' : '③'} {title}</span>
          <span className="rule-acc-summary">{summary}</span>
        </span>
      </button>
      {open && <div className="rule-acc-body">{children}</div>}
    </div>
  );
}

function Final_Rules() {
  const [openGroups, setOpenGroups] = React.useState(() => new Set([1]));
  const groupHeaders = React.useRef({});
  const activeGroup = React.useRef(1);
  const magnetLock = React.useRef(false);
  const lastScrollY = React.useRef(0);
  const byTitle = Object.fromEntries(GUIDE.rules.forbidden.map((item) => [item.t, item]));
  const allOpen = [1, 2, 3].every((id) => openGroups.has(id));

  // 스크롤 방향을 감지해 다음/이전 묶음을 자동으로 펼치고 그 자리로 부드럽게 이동한다.
  React.useEffect(() => {
    lastScrollY.current = window.scrollY;
    let rafId = 0;
    let unlockTimer = 0;

    const activateAndSnap = (id) => {
      const target = groupHeaders.current[id];
      if (!target) return;
      activeGroup.current = id;
      magnetLock.current = true;

      // 현재 묶음만 남기고 위·아래 묶음은 접는다.
      setOpenGroups(new Set([id]));

      // 접힘으로 위쪽 높이가 바뀐 다음 좌표를 다시 계산해야 화면이 튀지 않는다.
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const anchorY = window.innerHeight * 0.28;
          const targetY = window.scrollY + target.getBoundingClientRect().top - anchorY;
          window.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });
        });
      });

      unlockTimer = window.setTimeout(() => {
        magnetLock.current = false;
        lastScrollY.current = window.scrollY;
      }, 800);
    };

    const onScroll = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        const currentY = window.scrollY;
        const goingDown = currentY > lastScrollY.current + 2;
        const goingUp = currentY < lastScrollY.current - 2;
        lastScrollY.current = currentY;
        if ((!goingDown && !goingUp) || magnetLock.current) return;

        const active = activeGroup.current;
        const candidate = goingDown ? active + 1 : active - 1;
        if (candidate < 1 || candidate > 3) return;
        const target = groupHeaders.current[candidate];
        if (!target) return;

        const top = target.getBoundingClientRect().top;
        const zoneTop = window.innerHeight * (goingDown ? 0.38 : 0.10);
        const zoneBottom = window.innerHeight * (goingDown ? 0.76 : 0.82);
        if (top < zoneTop || top > zoneBottom) return;
        activateAndSnap(candidate);
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (rafId) window.cancelAnimationFrame(rafId);
      if (unlockTimer) window.clearTimeout(unlockTimer);
    };
  }, []);

  const toggleGroup = (id) => {
    activeGroup.current = id;
    setOpenGroups((prev) => prev.has(id) ? new Set() : new Set([id]));
  };

  const renderRule = (title) => {
    const item = byTitle[title];
    return (
      <div className="rule-item" key={title}>
        <div className="rule-item-title">{item.t}</div>
        <div className="rule-item-copy">
          {item.t === '제품 실물 사진 최소 1장'
            ? <>그림·트레이싱 콘텐츠도 가능하지만, 게시물 전체에서 제품 <strong>실물 사진이 최소 1장</strong>은 포함되어야 합니다.</>
            : item.d}
        </div>
      </div>
    );
  };

  return (
    <div className="section">
      <div className="rule-lead">
        <p>{GUIDE.rules.intro}</p>
        <div className="rule-lead-note"><Icon.info /><span>{GUIDE.rules.note}</span></div>
      </div>

      <div className="rule-core">
        <div className="rule-core-title">제작 전 핵심 체크</div>
        <div className="rule-core-chips">
          {['실물사진 포함', '제품 대사 금지', '대외비 준수', '저작권 준수'].map((label) => (
            <span className="rule-core-chip" key={label}><span aria-hidden>✅</span><span>{label}</span></span>
          ))}
        </div>
      </div>

      <div className="rule-stack">
        <RuleAccordion id={1} title="콘텐츠 제작 기준" summary="실물 사진 · 공식 이미지 · 제품 대사" open={openGroups.has(1)} onToggle={() => toggleGroup(1)} headerRef={(el) => { groupHeaders.current[1] = el; }}>
          {['창작물 원칙 · 공식 이미지 활용 범위', '제품 실물 사진 최소 1장', '제품 대상 대사 금지'].map(renderRule)}
          <div className="allow-deny">
            <div className="ad-box ad-allow">
              <span className="ad-icon">⭕</span><div style={{ fontWeight: 700, marginBottom: 4 }}>가능합니다</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{GUIDE.rules.expression.allow.title}</div>
              <div style={{ opacity: 0.85, lineHeight: 1.5 }}>{GUIDE.rules.expression.allow.example}</div>
            </div>
            <div className="ad-box ad-deny">
              <span className="ad-icon">❌</span><div style={{ fontWeight: 700, marginBottom: 4 }}>어렵습니다</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{GUIDE.rules.expression.deny.title}</div>
              <ul style={{ padding: 0, margin: 0, listStyle: 'none' }}>{GUIDE.rules.expression.deny.examples.map((e, i) => <li key={i} style={{ padding: '2px 0', opacity: 0.85, lineHeight: 1.5 }}>· {e}</li>)}</ul>
            </div>
          </div>
        </RuleAccordion>

        <RuleAccordion id={2} title="대외비 · 소재 · 저작권" summary="협업 조건 · 수위 및 소재 · 타인 창작물" open={openGroups.has(2)} onToggle={() => toggleGroup(2)} headerRef={(el) => { groupHeaders.current[2] = el; }}>
          {['대외비 유출 금지', '수위 및 소재', '저작권 준수 및 도용 금지'].map(renderRule)}
          <div className="alert danger alert-danger-outline" style={{ fontWeight: 500, marginTop: 12 }}><Icon.alert /><span><strong>본 협업 가이드 페이지의 유출 · 재배포를 금합니다.</strong><br/>페이지 내용은 협업 진행을 위한 용도로만 열람·사용해주세요.</span></div>
        </RuleAccordion>

        <RuleAccordion id={3} title="IP와 팬덤 보호" summary="차별·공격적 분쟁 · IP 및 팬덤 비하" open={openGroups.has(3)} onToggle={() => toggleGroup(3)} headerRef={(el) => { groupHeaders.current[3] = el; }}>
          <p style={{ fontSize: 12, color: 'var(--ink-700)', margin: '0 0 8px', lineHeight: 1.65 }}>{GUIDE.rules.ipIntro}</p>
          {GUIDE.rules.ipProtect.map((item) => <div className="rule-item" key={item.t}><div className="rule-item-title">{item.t}</div><div className="rule-item-copy">{item.d}</div></div>)}
        </RuleAccordion>
      </div>

      <button type="button" className="rule-all-toggle" onClick={() => {
        if (allOpen) { setOpenGroups(new Set([activeGroup.current])); }
        else { setOpenGroups(new Set([1, 2, 3])); }
      }}>{allOpen ? '전체 접기' : '전체 펼쳐 보기'}</button>
    </div>
  );
}

// ─── 챕터 5: 보상 ──────────────────────────────
function Final_Reward({ reply }) {
  const R = GUIDE.reward;
  const selectedTrack = R.tracks.find((track) => track.id === reply?.trackId);
  return (
    <div className="section">
      {/* ─── 얼마를 받나 (유입 수 기준) ───────────────────────
          예전엔 큰 카드 4개로 펼쳐져 있었는데, 표로 바꾸면 같은 정보를 훨씬
          짧게 담을 수 있고 아래 '언제 받나' 표와 형태가 같아져 비교가 쉬워진다. */}
      <div className="rwd">
        <p className="rwd-axis">{GUIDE.reward.axisNote}</p>
        <div className="rwd-title"><span className="rwd-title-num">1</span> 얼마를 받나</div>
        <div className="rwd-table">
          <div className="rwd-row rwd-head">
            <span className="rwd-th">유입 수</span>
            <span className="rwd-th">💳 금액 쿠폰</span>
            <span className="rwd-th">🎁 상품 쿠폰</span>
          </div>
          {R.tiers.map((t, i) => (
            <div className="rwd-row" key={i}>
              <span className="rwd-key">{t.range.replace('유입 수 ', '')}</span>
              {t.options.map((op, j) => (
                <span className="rwd-val" key={j}>{op.name}</span>
              ))}
            </div>
          ))}
        </div>
        <ul className="rwd-notes">
          <li>금액 쿠폰은 해당 금액 이상 단품 결제 시 사용 가능하며, 룩업 외 다른 라인업 상품에도 쓰실 수 있습니다</li>
          <li>상품 쿠폰은 해당 월 라인업 기준입니다 (타월 등 일부 상품 제외 · 5만 원 미만 상품은 배송비 발생 가능)</li>
          <li>{R.tiersNote.replace('※ ', '')}</li>
          <li>유입 수는 프리오더 기간(약 1달) 동안 카운트되며, 정산 완료 시 담당자가 한 번 더 연락드립니다</li>
        </ul>
      </div>

      {/* ─── 언제 받나 (수령 방식) ───────────────────────────
          표로 만들었더니 두 방식을 한 줄씩 번갈아 읽어야 해서 오히려 이해가
          어려웠다. 카드로 되돌리되 좌우로 나란히 놓아, 한쪽씩 통째로 읽으면서
          비교할 수 있게 한다.
          '이런 분께 맞아요'는 뺐다 — "10만 원대 단품 구매 계획"이라고 적으면
          후지급을 고르면 무조건 10만 원을 받는 것처럼 읽히기 때문. */}
      <div className="rwd" id="reward-track-choice" style={{ marginTop: 16 }}>
        <div className="rwd-title"><span className="rwd-title-num">2</span> 언제 받나</div>
        <div className="rwd-sub">{R.trackIntro}</div>
        <div className={`trk-choice-prompt${selectedTrack ? ' is-picked' : ''}`} aria-live="polite">
          <span className="trk-choice-prompt-icon">{selectedTrack ? '✓' : '!'}</span>
          <span>
            {selectedTrack
              ? <strong>{selectedTrack.name}을 선택했어요</strong>
              : <><strong>수령 방식을 선택해 주세요</strong><small>두 카드를 비교한 뒤 하나를 눌러주세요.</small></>}
          </span>
        </div>
        <div className="trk-grid" role="radiogroup" aria-label="보상 수령 방식">
          {R.tracks.map((t) => {
            const selected = reply?.trackId === t.id;
            return (
              <button type="button" className={`trk-card trk-${t.id}${selected ? ' is-selected' : ''}`} key={t.id}
                role="radio" aria-checked={selected} onClick={() => reply?.setTrackId(t.id)}>
                <div className="trk-card-top">
                  <span className="trk-emoji">{t.emoji}</span>
                  <span className="trk-name">{t.name}</span>
                  <span className="trk-select-state">{selected ? '● 선택됨' : '○'}</span>
                </div>
                <div className="trk-tag">{t.tag}</div>
                <div className="trk-rows">
                  {t.rows.map((r, i) => (
                    <div className="trk-row" key={i}>
                      {r.when && <span className="trk-when">{r.when}</span>}
                      <span className="trk-what">{r.what}</span>
                    </div>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
        {selectedTrack?.notes && (
          <div className="trk-detail">
            <div className="trk-detail-title">{selectedTrack.name} 선택 시 꼭 확인해 주세요</div>
            <ul>{selectedTrack.notes.map((note, i) => <li key={i}>{note}</li>)}</ul>
          </div>
        )}
        <ul className="rwd-notes rwd-cautions">
          {R.trackCautions.map((c, i) => <li key={i}>{c}</li>)}
        </ul>
      </div>

      <div className="alert info" style={{ marginTop: 12 }}>
        <Icon.info /><span>쿠폰 보상 조정 관련하여 문의가 있으실 경우 <strong>07 FAQ</strong> 단락을 참조해주세요.</span>
      </div>

      {/* 보상 내용을 방금 읽은 자리에서 바로 고르게 한다 — 판단이 가장 쉬운 순간 */}
      {reply && <div style={{ marginTop: 14 }}><ReplyForm {...reply} /></div>}
    </div>
  );
}

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
    </div>
  );
}

Object.assign(window, { FinalOption });
