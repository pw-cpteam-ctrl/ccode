#!/usr/bin/env bash
# 세션이 열릴 때(새로 열기 / 다시 열기 / 대화 압축 포함) 자동 배포를 꺼둔
# 프로젝트가 있으면 알려준다.
#
# 왜 필요한가: 배포 한도를 아끼려고 일부 프로젝트는 vercel.json에서 자동 배포를
# 꺼두는데, 그 사실이 세션마다 공유되지 않으면 "A 세션이 껐다"를 사람이 매번
# 채팅으로 중계해야 한다. 사람이 기억해서 전달하는 구조는 한 번 깜빡하면 무너지니,
# 파일을 직접 읽어서 알리는 쪽으로 바꾼 것이다.
#
# 이것만으로는 부족한 부분(세션을 열어둔 채로 다른 세션이 끈 경우)은
# .claude-hooks/pre-push 의 push 직전 경고가 받아낸다. 둘은 보완 관계다.
#
# 꺼진 게 하나도 없으면 아무 말도 하지 않는다 — 매번 뜨는 알림은 곧 안 읽히게 된다.

cd "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || exit 0
command -v jq >/dev/null 2>&1 || exit 0

off=""
for cfg in */vercel.json; do
  [ -e "$cfg" ] || continue
  # jq의 `//`(기본값) 연산자는 쓰지 말 것 — false를 "값 없음"으로 보고 기본값으로
  # 바꿔버려서, 정작 찾으려는 false가 전부 걸러진다. 값이 없으면 null이 찍히므로
  # 그대로 꺼내서 비교하면 된다.
  [ "$(jq -r '.git.deploymentEnabled.main' "$cfg" 2>/dev/null)" = "false" ] || continue
  off="$off ${cfg%/vercel.json}"
done

[ -n "$off" ] || exit 0

msg="지금 자동 배포가 꺼져 있는 프로젝트:$off

이 폴더들은 고쳐서 push해도 사이트에 반영되지 않는다(배포 한도 절약 목적으로 꺼둠).
이미 떠 있는 사이트와 API는 그대로 돌아간다 — 멈추는 건 '새 코드의 반영'뿐이다.

이 중 한 폴더를 수정하게 되면, 해당 폴더 vercel.json의 git.deploymentEnabled.main 을
true로 바꿔 **코드 수정과 같은 push에 함께** 올릴 것. 따로 올리면 배포가 2번 돌아
아끼려던 한도를 오히려 더 쓴다. 작업이 끝나면 다시 false로 되돌린다(끄는 push는
배포를 만들지 않으므로 한도를 쓰지 않는다)."

jq -n --arg m "$msg" \
  '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$m}}'
