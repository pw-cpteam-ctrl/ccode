// 트윗 링크 하나를 받아 "원문 전체 + 사진 목록"으로 돌려주는 읽기 전용 함수.
//
// 왜 서버를 거치나 — 트위터 공식 주소(cdn.syndication.twimg.com)는 CORS를
// platform.twitter.com 에게만 열어둬서 우리 페이지에서 직접 부르면 브라우저가 막는다.
// 그래서 서버에서 대신 받아온다.
//
// 왜 바깥 주소를 두 개 쓰나 — 원문이 잘리는 문제 때문이다. 메가하우스·굿스마일 공지는
// 대부분 '긴 트윗(note tweet)'인데, 공식 주소는 200자쯤에서 문장 중간을 잘라 보낸다.
// 실제로 재어본 값(2026-10-06):
//     메가하우스BH 9/17  공식 206자(잘림)  /  fxtwitter 535자(전문)
//     메가하우스BH 4/3   공식 204자(잘림)  /  fxtwitter 420자(전문)
//     토리코 BLEACH      공식 177자(잘림)  /  fxtwitter 272자(전문)
// 발매일·가격이 뒤쪽에 몰려 있어서, 잘린 원문을 파싱에 넘기면 그 항목들이 통째로 빈다.
// 그래서 전문이 나오는 fxtwitter를 먼저 쓰고, 그게 죽어 있으면 공식 주소로 내려간다.
// 공식 주소로 내려간 경우 글이 잘렸을 수 있으므로 truncated 플래그를 같이 돌려준다.
//
// ⚠️ fxtwitter는 트위터 공식이 아니라 외부 서비스다. 언제든 멈출 수 있다는 전제로,
//    여기서만 쓰고 화면 쪽에는 주소를 노출하지 않는다. 나중에 다른 경로로 갈아끼울 때
//    이 파일만 고치면 되게 하려는 것이다.
//
// 참고: 사진 파일 자체(pbs.twimg.com)는 CORS가 열려 있어 서버를 거칠 필요가 없다.
//       화면에서 직접 불러 캔버스에 올리면 된다(ig-crop.js가 이미 그렇게 동작한다).

const TIMEOUT_MS = 8000;
const UA = 'Mozilla/5.0 (compatible; insta-gen/1.0)';

// 이 함수는 우리 대신 바깥 주소를 불러주는 역할이라, 열어두면 남이 자기 용도로 쓸 수 있다.
// 브라우저가 우리 페이지에서 보낸 요청만 받는다(api/log-download.js와 같은 방식).
function isSameOrigin(req) {
  const host = req.headers.host;
  if (!host) return false;
  const src = req.headers.origin || req.headers.referer;
  if (!src) return false; // 헤더가 아예 없는 요청(curl 등)은 거부
  try { return new URL(src).host === host; } catch { return false; }
}

// 링크에서 트윗 번호만 뽑는다. 도메인은 따지지 않는다 —
// x.com / twitter.com / mobile.twitter.com / fxtwitter.com / vxtwitter.com / fixupx.com …
// 사람들이 공유하는 주소 모양이 제각각이라, 호스트를 목록으로 관리하면 빠지는 게 계속 생긴다.
// 어차피 필요한 건 status 뒤의 숫자 하나뿐이라 그것만 본다.
// 뒤에 ?s=20, /photo/1 같은 꼬리가 붙어 있어도 괜찮다. 숫자만 붙여넣어도 받는다.
function extractId(input) {
  const s = String(input || '').trim();
  if (/^\d{5,25}$/.test(s)) return s;
  const m = s.match(/\/status(?:es)?\/(\d{5,25})/i);
  return m ? m[1] : null;
}

// 공식 임베드 주소가 요구하는 토큰. 트윗 ID로 계산한다(임베드 스크립트가 쓰는 것과 같은 식).
function syndicationToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

function getJson(url) {
  return fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))));
}

// ── 1차: 전문이 나오는 경로 ──
async function fromFxtwitter(id) {
  const j = await getJson(`https://api.fxtwitter.com/_/status/${id}`);
  const t = j && j.tweet;
  if (!t || !t.text) throw new Error('본문 없음');
  const m = t.media || {};
  return {
    source: 'fxtwitter',
    // is_note_tweet이 true여도 이쪽은 전문을 주므로 잘릴 걱정이 없다.
    maybeTruncated: false,
    author: { name: t.author?.name || '', handle: t.author?.screen_name || '' },
    createdAt: t.created_at || null,
    text: t.text,
    photos: (m.photos || []).map(p => ({ url: p.url, width: p.width || null, height: p.height || null })),
    videos: (m.videos || []).map(v => ({
      thumb: v.thumbnail_url || null,
      url: v.url || null,
      width: v.width || null,
      height: v.height || null,
    })),
  };
}

// ── 2차: 트위터 공식. 사진은 확실하지만 긴 트윗은 글이 잘린다. ──
async function fromSyndication(id) {
  const url = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${syndicationToken(id)}&lang=ko`;
  const j = await getJson(url);
  if (!j || !j.text) throw new Error('본문 없음');
  const media = j.mediaDetails || [];
  const size = m => ({ width: m.original_info?.width || null, height: m.original_info?.height || null });
  return {
    source: 'syndication',
    // ⚠️ 여기서는 "잘렸는지"를 확실히 알 수 없다. note_tweet 필드는 실제로 잘린 글에도,
    //    안 잘린 짧은 글에도 똑같이 붙어 있다(둘 다 id만 들어 있고 본문은 없음).
    //    실측: 토리코 글은 153자만 오고 전문은 272자(=잘림), 굿스마일 글은 180자가 전문인데
    //    둘 다 note_tweet이 있었다. 그래서 이 값은 '잘렸다'가 아니라 '잘렸을 수 있다'는 뜻으로 쓴다.
    //    화면에서도 단정하지 말고 확인을 권하는 문구를 띄울 것.
    //    (1차 경로가 살아 있으면 전문이 오므로 이 애매함은 fxtwitter가 죽었을 때만 생긴다.)
    maybeTruncated: Boolean(j.note_tweet),
    author: { name: j.user?.name || '', handle: j.user?.screen_name || '' },
    createdAt: j.created_at || null,
    // 본문 끝에 붙는 사진용 t.co 링크는 원문이 아니라 트위터가 덧붙인 것이라 떼어낸다.
    text: j.text.replace(/\s*https:\/\/t\.co\/\w+\s*$/, '').trim(),
    photos: media.filter(m => m.type === 'photo').map(m => ({ url: `${m.media_url_https}?name=orig`, ...size(m) })),
    videos: media.filter(m => m.type !== 'photo').map(m => {
      const best = (m.video_info?.variants || [])
        .filter(v => v.content_type === 'video/mp4')
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      return { thumb: m.media_url_https || null, url: best?.url || null, ...size(m) };
    }),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, reason: 'GET 요청만 지원합니다.' });
    return;
  }
  if (!isSameOrigin(req)) {
    res.status(403).json({ ok: false, reason: '허용되지 않은 출처의 요청입니다.' });
    return;
  }

  const id = extractId(req.query?.url ?? req.query?.id);
  if (!id) {
    res.status(400).json({ ok: false, reason: '트윗 링크를 알아보지 못했습니다. x.com/계정/status/숫자 형태로 넣어주세요.' });
    return;
  }

  const errors = [];
  for (const [label, fn] of [['fxtwitter', fromFxtwitter], ['syndication', fromSyndication]]) {
    try {
      const data = await fn(id);
      // 캐시: 같은 트윗을 여러 번 불러도 바깥 주소를 매번 때리지 않게 한다.
      res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');
      res.status(200).json({ ok: true, id, url: `https://x.com/i/status/${id}`, ...data });
      return;
    } catch (err) {
      errors.push(`${label}: ${err.message}`);
    }
  }

  // 둘 다 실패 — 화면은 이걸 받으면 "직접 넣어주세요"로 내려가면 된다.
  // 오류 자체는 정상 흐름의 일부라 200으로 돌려준다(화면에서 예외 처리할 필요 없게).
  console.error('트윗 읽기 실패', id, errors.join(' | '));
  res.status(200).json({
    ok: false,
    id,
    reason: '트윗을 읽지 못했습니다. 삭제·비공개 글이거나, 트위터 쪽이 일시적으로 막았을 수 있습니다.',
    details: errors,
  });
}
