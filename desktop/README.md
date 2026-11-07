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
