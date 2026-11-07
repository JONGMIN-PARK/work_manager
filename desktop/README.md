# 업무 관리자 PC 앱 (Electron)

같은 서버 · 같은 DB 를 쓰는 윈도우 앱. 화면은 서버의 웹 화면을 그대로 띄우므로 기능은 웹(`chat-ui.js` 등)에 넣으면 PC 앱에도 바로 반영된다.
PC 앱이 더하는 것: 트레이 상주 · 윈도우 알림 · 작업 표시줄 안 읽은 수 · `Ctrl+Shift+M` · 윈도우 시작 시 실행 · 화면 공유 · 자동 업데이트.

```bash
cd desktop
npm install
npm start                 # 운영 서버(https://work-manager-ws3t.onrender.com)
npm run start:local       # 로컬 서버(http://localhost:3000)
npx electron scripts/smoke.js   # 띄워서 화면 찍고 끝냄 → dist/smoke.png
npm run icons             # pwa/icon.svg → 아이콘 PNG 다시 만들기
npm run dist              # 설치 파일 → dist/WorkManager-Setup-<버전>.exe
npm run dist:publish      # GitHub Releases 에 올림 (GH_TOKEN 필요) → 자동 업데이트 대상
```

- 서버 주소: `--server=URL` > 환경변수 `WM_SERVER` > `%APPDATA%/work-manager-desktop/config.json` 의 `server` > 기본값
- 웹 화면 쪽 다리: `window.wmDesktop` (preload.js) ↔ `wm-app.js` (`wmAppNotify` · `wmAppBadge`)
- 버전은 `package.json` 의 `version` — 자동 업데이트는 이 값이 올라야 받는다

## 새 버전 내보내기 (자동 업데이트)
설치한 앱은 4시간마다 GitHub Releases(공개 저장소)의 `latest.yml` 을 보고 새 버전을 뒤에서 받아 둔다 → 알림 → 누르면 설치 · 다시 시작.

1. `package.json` 의 `version` 을 올린다 (예: 13.360.0 → 13.361.0)
2. 둘 중 하나
   - 자동: GitHub 토큰(repo 권한)을 넣고 `npm run dist:publish` → 초안 릴리스가 만들어짐 → GitHub 에서 **Publish release**
     (PowerShell: `$env:GH_TOKEN="ghp_…"; npm run dist:publish`)
   - 손으로: `npm run dist` → GitHub › Releases › Draft a new release(태그 `v13.361.0`) → `dist/` 의 **exe · exe.blockmap · latest.yml** 세 개를 올리고 Publish
3. 앱의 '📲 앱 설치 › PC 앱 받기' 단추는 releases/latest 로 감 — 처음 한 번은 이렇게 올려야 받을 수 있다

## 🖱 원격 제어
`remote-input.js` — 화면 공유 중 내가 '허락'한 사람의 입력만 넣는다. 숨은 PowerShell 이 user32 SendInput 을 부름(네이티브 모듈 없음).
끝내기: 막대의 [제어 끝내기] · Ctrl+Alt+End · 공유 끝 · 앱 끝. 눌린 채 남은 키 · 버튼은 끝낼 때 뗀다.
