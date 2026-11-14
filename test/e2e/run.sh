#!/bin/bash
# 마인드맵 통합 테스트 — 임시 Postgres(:54329) + 서버(:3000) 를 띄우고 API · 브라우저 테스트 실행.
#   bash test/e2e/run.sh              # 전부
#   bash test/e2e/run.sh e2e3.js ...  # 고른 파일만 (한 묶음)
#   KEEP=1 bash test/e2e/run.sh ...   # DB 를 깨끗하게 되돌리지 않고 그대로 (기본은 실행마다 wm_tpl 에서 새로 — reset.js)
# 처음 한 번: 이 폴더에서 npm install (embedded-postgres). puppeteer · pg 는 server/node_modules 것을 씀.
# 서버는 묶음마다 다시 켠다 — 로그인 횟수 제한(10회) 때문.
cd "$(dirname "$0")"
DIR=$(pwd)
SRV="$DIR/../../server"
DB=postgres://postgres:pw@localhost:54329/wm
[ -d node_modules ] || npm install --no-audit --no-fund > /dev/null

port_open() { (echo > /dev/tcp/127.0.0.1/$1) > /dev/null 2>&1; }
kill_port() {
  if command -v taskkill > /dev/null 2>&1; then
    for p in $(netstat -ano 2>/dev/null | grep ":$1 .*LISTENING" | awk '{print $5}' | sort -u); do taskkill //PID $p //F > /dev/null 2>&1; done
  else
    fuser -k $1/tcp > /dev/null 2>&1
  fi
}

# 지난 실행이 남긴 postgres(.pgdata 를 쓰는 것)는 정리하고 매번 새로 띄움 — 남은 것은 연결이 멈춰 있을 수 있다
kill_stale_pg() {
  if command -v powershell > /dev/null 2>&1; then
    powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='postgres.exe'\" | Where-Object { \$_.CommandLine -like '*e2e*pgdata*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }" > /dev/null 2>&1
  else
    pkill -f "e2e/.pgdata" > /dev/null 2>&1
  fi
  sleep 1
}
kill_stale_pg

PG_PID=
if ! port_open 54329; then
  node start.mjs > pg.log 2>&1 &
  PG_PID=$!
  for i in $(seq 1 60); do grep -q "PG READY" pg.log 2>/dev/null && break; sleep 1; done
fi

# 지난 실행이 남긴 테스트 서버(.srv.pid 에 적어 둔 것)면 끄고 시작 — 출력을 head 로 자르는 등 중간에 끊기면 남던 것
SRV_PID_FILE="$DIR/.srv.pid"
listen_pids() { netstat -ano 2>/dev/null | grep ":$1 .*LISTENING" | awk '{print $5}' | sort -u; }
if port_open 3000 && [ -f "$SRV_PID_FILE" ]; then
  kill_port 3000; sleep 1
fi
rm -f "$SRV_PID_FILE"
port_open 3000 && { echo "포트 3000 을 다른 서버(PID $(listen_pids 3000 | tr '
' ' '))가 쓰고 있습니다 — 끄고 다시 실행하세요"; exit 1; }

# 어떻게 끝나든(Ctrl+C · 파이프 끊김 포함) 테스트 서버는 정리
cleanup() { port_open 3000 && [ -f "$SRV_PID_FILE" ] && kill_port 3000; rm -f "$SRV_PID_FILE"; }
trap cleanup EXIT
trap 'cleanup; exit 130' INT TERM PIPE

# 실행마다 깨끗한 DB (KEEP=1 이면 그대로)
if [ -z "$KEEP" ]; then
  node reset.js || exit 1
fi

FAILED=0
run_batch() {
  (cd "$SRV" && DATABASE_URL=$DB PORT=3000 CORS_ORIGIN=http://localhost:3000 node server.js > "$DIR/server.log" 2>&1) &
  echo $! > "$SRV_PID_FILE"
  curl -s -o /dev/null --retry 20 --retry-connrefused --retry-delay 1 http://localhost:3000/
  sleep 3   # 시작 직후 마이그레이션 확인이 끝날 때까지 — 첫 테스트가 가끔 목록을 못 받던 것
  for f in "$@"; do
    out=$(node "$f" 2>&1)
    mkdir -p "$DIR/.shots"; echo "$out" > "$DIR/.shots/${f%.js}.log"   # 실패 때 어느 단계인지 보려고
    res=$(echo "$out" | grep -E "ALL PASS|FAIL|AssertionError|Error:" | head -3 | tr '\n' ' ')
    [ -z "$res" ] && res=$(echo "$out" | tail -1)
    echo "$res" | grep -q "ALL PASS" || FAILED=1
    printf "%-20s %s\n" "$f" "$res"
  done
  kill_port 3000
  rm -f "$SRV_PID_FILE"
  sleep 1
}

if [ $# -gt 0 ]; then
  run_batch "$@"
else
  run_batch api-test.js api-project.js
  run_batch api-phase2.js api-snap.js
  run_batch e2e.js e2e7.js
  run_batch e2e2.js
  run_batch e2e3.js e2e4.js e2e5.js
  run_batch e2e6.js
  run_batch e2e8.js e2e9-progress.js e2e10-split.js
  run_batch e2e11-filter.js e2e12-bg.js e2e13-weekly.js
  run_batch api-comments.js e2e14-comments.js
  run_batch api-notify.js e2e15-meeting.js e2e16-theme.js e2e17-xmind.js
  run_batch e2e18-pitch.js e2e19-risk.js
  run_batch e2e20-files.js e2e21-structures.js e2e22-floating.js
  run_batch e2e23-perf.js
  run_batch api-mywork.js e2e24-mywork.js e2e25-templates.js
  run_batch api-weekly.js e2e26-weekly-author.js e2e27-wide.js
  run_batch e2e84-wr-narrow.js
  run_batch api-calendar.js e2e28-calendar.js
  run_batch e2e30-last-view.js   # 따로 — 앞 묶음 로그인과 합치면 횟수 제한(10회)에 걸림
  run_batch e2e31-worklog-query.js
  run_batch e2e32-weekly-state.js
  run_batch e2e33-drill.js
  run_batch e2e34-mindmap-list.js
  run_batch api-remind.js
  run_batch api-tasks.js e2e29-tasks.js
  run_batch api-board.js e2e35-board.js
  run_batch e2e36-timeline.js
  run_batch api-notes.js e2e37-notes.js
  run_batch api-myproj.js e2e38-myproj.js
  run_batch e2e39-mw-polish.js e2e40-cal-tip.js
  run_batch api-tgmywork.js
  run_batch api-pm.js e2e41-pm.js
  run_batch api-speed.js
  run_batch e2e42-header.js
  run_batch e2e43-tabs.js
  run_batch e2e44-toolbar.js
  run_batch e2e45-pd-tabs.js
  run_batch e2e46-search.js
  run_batch e2e47-toolbar-proj.js
  run_batch e2e48-toolbar-mw.js
  run_batch e2e49-ai-ask.js
  # v13.342 빠져 있던 것들 — 로그인 횟수 제한(서버당 10회) 때문에 하나씩
  run_batch e2e50-telegram.js
  run_batch e2e51-docs.js
  run_batch e2e52-mm-touch.js
  run_batch e2e53-wr-insights.js
  run_batch e2e54-lazy-libs.js
  run_batch e2e55-wr-goals.js
  run_batch e2e56-wr-analytics.js e2e82-wa-kpi.js e2e83-wa-p2.js
  run_batch e2e57-mtl-longbar.js
  run_batch e2e58-chat.js
  run_batch e2e85-cx-back.js
  run_batch e2e86-font-size.js
  run_batch e2e87-pd-win.js
  run_batch e2e88-mw-panel-close.js
  run_batch e2e89-team-access.js
  run_batch e2e90-shell.js
  run_batch e2e91-topo-edit.js
  run_batch e2e92-worklog-shared.js
  run_batch e2e93-wr-plan-actual.js
  run_batch e2e94-desk-update.js
  run_batch e2e95-chat-img-fast.js
  run_batch e2e59-notebook.js
  run_batch e2e60-notebook-links-coach.js
  run_batch e2e61-notebook-print.js
  run_batch e2e62-meeting-print.js
  run_batch e2e63-live-paper.js
  run_batch e2e64-file-open.js
  run_batch e2e65-write-start.js
  run_batch e2e66-spell.js
  run_batch e2e67-mm-timesort.js
  run_batch e2e68-search-recent.js
  run_batch e2e69-note-spread.js
  run_batch e2e70-book-all.js
  run_batch e2e71-notes-safe.js
  run_batch e2e72-nb-save.js
fi

# 이 실행이 띄운 Postgres 면 정상 종료 (start.mjs 가 .pgstop 을 보고 멈춤)
if [ -n "$PG_PID" ]; then
  touch .pgstop
  for i in $(seq 1 30); do port_open 54329 || break; sleep 1; done
  port_open 54329 && kill_stale_pg
fi
[ $FAILED = 0 ] && echo "== 전부 통과" || { echo "== 실패 있음"; exit 1; }
