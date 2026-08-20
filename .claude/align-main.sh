#!/bin/bash
#
# 세션 시작 시 로컬 브랜치를 main으로 정렬한다.
#
# 왜 필요한가
#   Claude Code의 Stop 훅은 "안 올린 커밋 없나"를 검사할 때, 현재 브랜치와
#   '같은 이름의 원격 브랜치'만 비교 대상으로 삼는다. 이 레포는 작업용 브랜치를
#   쓰지 않고 main에 직접 push하는 방식이라, 세션에 배정된 작업용 브랜치
#   (claude/xxx)의 낡은 원격 사본과 비교돼 매 턴 "N개 안 올렸다"는 오탐 경고가
#   떴다. 현재 브랜치를 main으로 맞추면 비교 대상이 origin/main이 되어 사라진다.
#
# 안전 원칙 — 잃을 게 하나라도 있으면 아무것도 하지 않는다
#   1. 저장 안 된 변경(uncommitted/untracked)이 있으면 즉시 중단
#   2. 현재 브랜치에 아직 안 올린 커밋이 있으면 중단
#   3. 로컬 main에 아직 안 올린 커밋이 있으면 중단
#   4. 이동은 --ff-only(앞으로만 감기)로만 — 기록을 덮어쓰는 방식은 쓰지 않음
#   어떤 경우에도 브랜치를 삭제하거나 강제 이동(-B, reset --hard)하지 않는다.

set -u

cd "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || exit 0

# origin/main 최신화 (네트워크 실패는 조용히 넘어감 — 세션 시작을 막지 않도록)
git fetch origin main -q 2>/dev/null

# origin/main을 못 찾으면 판단 근거가 없으니 중단
git rev-parse --verify -q origin/main >/dev/null 2>&1 || exit 0

# 가드1: 저장 안 된 변경이 있으면 중단
[ -n "$(git status --porcelain 2>/dev/null)" ] && exit 0

# 가드2: 현재 브랜치에 안 올린 커밋이 있으면 중단
git merge-base --is-ancestor HEAD origin/main 2>/dev/null || exit 0

if git show-ref -q --verify refs/heads/main 2>/dev/null; then
  # 가드3: 로컬 main에 안 올린 커밋이 있으면 중단
  [ "$(git rev-list --count origin/main..main 2>/dev/null)" = "0" ] || exit 0
  # 가드4: --ff-only — 앞으로 감기가 아니면 실패하고 아무것도 안 바뀜
  git checkout main -q 2>/dev/null && git merge --ff-only origin/main -q 2>/dev/null
else
  # 로컬 main이 없으면 새로 만들기 — 잃을 게 없음
  git checkout -b main origin/main -q 2>/dev/null
fi

exit 0
