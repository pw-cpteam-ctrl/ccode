// 로그인 세션 쿠키가 붙은 상태로 이미지 URL을 받아 파일로 저장.
// B2B 사진이 로그인 필요한 URL일 수 있으므로 반드시 같은 context의 request로 받아야 한다
// (브라우저 밖에서 순수 fetch로 받으면 쿠키가 안 붙어 실패할 수 있음).
const fs = require('fs');
const path = require('path');

// context = 로그인 세션이 살아있는 BrowserContext (scrape.js에서 만든 것)
async function downloadImage(context, imageUrl, savePath) {
  const res = await context.request.get(imageUrl);
  if (!res.ok()) throw new Error(`이미지 다운로드 실패(${res.status()}): ${imageUrl}`);
  const buffer = await res.body();
  fs.mkdirSync(path.dirname(savePath), { recursive: true });
  fs.writeFileSync(savePath, buffer);
  return savePath;
}

module.exports = { downloadImage };
