#!/bin/bash
# 맥용 더블클릭 런처. 더블클릭 실행이 안 되면 파일에 실행 권한을 한 번 줘야 함:
#   chmod +x run.command
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[설치 필요] Node.js가 없습니다."
  echo "https://nodejs.org 에서 LTS 버전을 설치한 뒤, 이 아이콘을 다시 더블클릭해주세요."
  read -p "엔터를 누르면 창이 닫힙니다..." _
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "최초 실행 준비 중입니다... 1~2분 정도 걸려요. 창을 닫지 마세요."
  npm install
fi

node scrape.js

echo ""
echo "끝났습니다. 이 창은 닫으셔도 됩니다."
read -p "엔터를 누르면 창이 닫힙니다..." _
