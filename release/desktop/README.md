# PC 앱 배포 파일 (자동 업데이트 원본)

서버가 이 폴더를 `/desktop-release/` 로 내려 주고, PC 앱(13.495 부터)이 `latest.yml` 을 보고 새 버전을 뒤에서 받아 둡니다.
웹에서 새로 고치면(새 버전 띠 · F5 · Ctrl+R) 받아 둔 것을 설치하고 다시 시작합니다.

## 새 버전 배포
1. `desktop/package.json` 의 `version` 을 올림
2. `cd desktop && npm run dist`
3. 이 폴더(release/desktop)의 예전 설치 파일 · blockmap 을 지우고 `dist/` 의 새 `WorkManager-Setup-x.y.z.exe` · `.blockmap` · `latest.yml` 을 복사
4. 커밋 · 푸시 → 서버가 배포되면 PC 앱들이 알아서 받음

예전 PC 앱(13.494 이하 — GitHub 릴리스를 보던 것)은 스스로 못 받으므로, 웹이 「PC 앱 새 버전 — 설치 파일 받기」 띠를 띄웁니다. 한 번 설치하면 그 뒤로는 자동입니다.
