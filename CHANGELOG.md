# Work Manager — 변경 이력

## v9.0 (2026-03-25~26) — 텔레그램 봇 통합 & AI

### 텔레그램 봇 연동
- QR코드 스캔으로 1회 계정 연동 (`969010a`)
- 프로필 모달에 텔레그램 연동 섹션 (QR 생성, 연동 해제, 알림 설정)
- Webhook 자동 등록 + 진단/수동 등록 UI
- DB 마이그레이션: telegram_links, notification_prefs, notification_logs, telegram_auth_codes (`003_telegram.sql`)

### 봇 명령어 (24개)
| 명령어 | 기능 | 커밋 |
|--------|------|------|
| `/today` | 오늘 통합 브리핑 (일정+이슈+납기) | `6a2b3d8` |
| `/my` | 내 현황 (미해결 이슈 + 임박 납기) | `969010a` |
| `/issues` | 미해결 이슈 목록 | `969010a` |
| `/tasks` | 미완료 체크리스트 | `6a2b3d8` |
| `/done <번호>` | 체크리스트 완료 처리 (양방향) | `6a2b3d8` |
| `/log` | 업무일지 빠른 등록 (or `8h D B2024-001 내용`) | `013a743` |
| `/my-stats` | 개인 월간 통계 (바차트) | `6a2b3d8` |
| `/summary` | 금주 업무시간 요약 | `6313497` |
| `/report` | 월간 리포트 | `6313497` |
| `/weekly-report` | 주간보고 자동 생성 | `013a743` |
| `/overdue` | 지연 프로젝트 + 긴급 이슈 | `6313497` |
| `/project <이름>` | 프로젝트 현황/상세 | `6313497` |
| `/checklist <이름>` | 체크리스트 진행률 | `6a2b3d8` |
| `/calendar [N]` | 향후 N일 일정 (기본 7일) | `6a2b3d8` |
| `/orders` | 수주 목록 | `6a2b3d8` |
| `/order <번호>` | 수주 상세 + 투입시간 | `6a2b3d8` |
| `/deliveries` | 이번 달 납품 예정 | `6a2b3d8` |
| `/remind <시간> <내용>` | 개인 리마인더 (최대 7일) | `013a743` |
| `/vote` | 팀 투표 (인라인 버튼) | `013a743` |
| `/docs <이름>` | 프로젝트 문서 목록 | `6a2b3d8` |
| `/search-doc <키워드>` | 문서 검색 | `6a2b3d8` |
| `/team` | 팀원별 금주 투입 (관리자/팀장) | `6313497` |
| `/help [명령어]` | 전체 목록 또는 상세 도움말 | `c466fab` |
| `/unlink` | 연동 해제 | `969010a` |

### 알림 시스템 (13개 이벤트)
| 이벤트 | 설명 | 커밋 |
|--------|------|------|
| `issue_assigned` | 이슈 배정 + [대응시작][해결] 인라인 버튼 | `969010a`, `9cd48d4` |
| `issue_status_changed` | 이슈 상태 변경 | `969010a` |
| `project_delayed` | 프로젝트 지연 | `969010a` |
| `deadline_d3` / `d1` / `today` | 납기 D-3, D-1, D-day | `969010a` |
| `user_pending` | 가입 승인 요청 + [승인][반려] 버튼 | `969010a`, `013a743` |
| `milestone_complete` | 마일스톤 완료 | `6a2b3d8` |
| `event_today` | 일일 브리핑 (매일 08:30 KST) | `6a2b3d8` |
| `order_delivery_d7` / `d3` | 납품 D-7, D-3 | `6a2b3d8` |
| `weekly_digest` | 주간 다이제스트 (매주 월 09:30) | `6a2b3d8` |
| `progress_warning` | 진행률 경고 (기대 대비 20%p 지연) | `9cd48d4` |

### 스케줄러 (6개)
| 시간 (KST) | 기능 |
|-------------|------|
| 08:30 | 일일 브리핑 |
| 09:00 | 납기 리마인더 (D-3, D-1, D-day) |
| 09:10 | 수주 납품 리마인더 (D-7, D-3) |
| 09:30 월요일 | 주간 다이제스트 |
| 17:00 | 진행률 경고 |
| 18:00 | 과부하 경고 (일평균 9h 초과) |

### 실용 기능
- 사진 → 이슈 자동 등록 (캡션=제목, 긴급변경/대응시작 버튼) (`013a743`)
- 팀 투표 (인라인 버튼) (`013a743`)
- 개인 리마인더 (`013a743`)
- 업무일지 빠른 등록 (`8h D B2024-001 내용` 패턴) (`013a743`)
- 주간보고 자동 생성 (`013a743`)
- 그룹 채팅방 연동 (/linkgroup, /unlinkgroup) (`9cd48d4`)

### AI 통합
- 텔레그램 자연어 질답: DB 데이터 기반 RAG 응답 (`5ad0303`)
- 웹 AI 요약: 서버 Gemini API로 전환 (클라이언트 키 불필요) (`5f60283`)
- AI 엔진 선택/키 입력 UI 제거 → 서버 상태 표시 (`5f60283`)
- 환경변수 `GEMINI_API_KEY` 하나로 웹+텔레그램 통합 (`5f60283`)
- 토큰 한도 증가: Gemini 8192, Claude 4096 (`b302cd4`)

### UX 개선
- `/help log` 등 명령어별 상세 도움말 22개 (`c466fab`)
- 명령어 실행 후 관련 기능 추천 (💡 tip) (`c466fab`)
- 자연어 → 명령어 자동 매핑 13패턴 ("내 이슈 보여줘" → /issues) (`c466fab`)
- 연동 완료 시 온보딩 가이드 자동 발송 (`c466fab`)
- 봇 명령어 자동완성 (setMyCommands API, 24개) (`58cbc33`)

### 리팩토링 (`26c436f`)
- telegram.service.js: 1,767줄 → 461줄 (74% 감소)
- app.js 스케줄러: 136줄 → 11줄 (92% 감소)
- 모듈 분리: `server/telegram/commands/` 8개 파일
- 공통 유틸: `constants.js`, `utils.js`, `scheduler.js`
- Factory 패턴 + Lazy 초기화

---

## v8.8 (2026-03-24~25) — UI/성능/스케일링

### 업무분장 코드 변경
- G(일반) → G(공통), 인원별 분포에 R(제안) 범례 추가

### 스케일링 Phase 1
- DB 복합 인덱스 4개 + user_id 컬럼
- 집계 API (stats/summary, weekly, by-team, by-order)
- 페이지네이션 상한 200, 부서별 접근제어

### UI/UX
- 시인성/대비/배치 대폭 개선
- 다중 파일 드래그앤드롭 + 애니웍스 모달 간소화

---

## v8.7 (2026-03-23~24) — 주차 관리/필터

- 월별/분기(1Q-4Q)/연도 필터 추가
- 기간 선택 버튼, 주차 칩 강조
- PUT 404→POST 폴백, 프로젝트 일괄 생성 API
- 마일스톤 병렬 저장, 캐시 버스팅 자동화
- API 병렬화, HTML 캐시, CDN defer, Docker 경량화

---

## v8.6 (2026-03-22~23) — 사업부/팀 관리

- 사업부별 데이터 분리 및 팀원 선택 기능
- 체크리스트: 기본 표시, 완료 날짜, 인라인 갱신
- 서버 모드 체크리스트 스키마 수정

---

## v8.5 (2026-03-20~22) — 다중 사용자 웹 배포

- Express + PostgreSQL + JWT 인증
- Docker + Render 배포
- RBAC (admin/executive/manager/member)
- 낙관적 락, 감사 로그, 비밀번호 정책
- 수주/거래처 서버 저장 + 인라인 편집
- 애니웍스 연동 (Puppeteer)

---

## v7.0 (2026-03-19) — 초기 버전

- 업무일지 분석기 단일 HTML 파일
- IndexedDB 클라이언트 저장
- Chart.js 시각화, AI 요약 (Gemini/Claude)
- 엑셀 파일 파싱 (XLS/XLSX), 7개 테마

---

## 환경변수 목록

| 변수 | 필수 | 설명 |
|------|------|------|
| `DATABASE_URL` | ✅ | PostgreSQL 연결 문자열 |
| `JWT_SECRET` | ✅(prod) | 액세스 토큰 서명 키 |
| `JWT_REFRESH_SECRET` | ✅(prod) | 리프레시 토큰 서명 키 |
| `CORS_ORIGIN` | | 프론트엔드 origin |
| `TELEGRAM_BOT_TOKEN` | | 텔레그램 봇 토큰 (BotFather) |
| `TELEGRAM_BOT_USERNAME` | | 봇 username (@없이) |
| `TELEGRAM_WEBHOOK_URL` | | Webhook 수신 URL |
| `TELEGRAM_WEBHOOK_SECRET` | | Webhook 검증 시크릿 (영숫자만) |
| `GEMINI_API_KEY` | | Gemini AI API 키 (웹+텔레그램) |
| `ANTHROPIC_API_KEY` | | Claude AI API 키 (대안) |
| `AI_PROVIDER` | | AI 엔진 선택 (gemini/anthropic, 기본: gemini) |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | | 이메일 발송 |

---

## 프로젝트 구조

```
work_manager/
├── 업무일지_분석기.html           # 메인 프론트엔드 (SPA)
├── auth.js                       # 인증 + 프로필 + 텔레그램 UI
├── config.js                     # 프론트엔드 설정
├── settings.js / calendar.js / timeline.js / dashboard.js
├── project-data.js / order-view.js / issue-manager.js / document-manager.js
│
├── server/
│   ├── app.js                    # Express 앱 + 스케줄러
│   ├── config/index.js / db.js   # 환경변수 + PostgreSQL
│   ├── middleware/               # auth, rbac, pagination, optimistic-lock
│   ├── services/
│   │   ├── telegram.service.js   # 봇 코어 (461줄)
│   │   ├── notification.service.js
│   │   ├── ai.service.js
│   │   ├── auth.service.js / email.service.js
│   ├── routes/                   # 18개 API 라우트
│   ├── telegram/
│   │   ├── constants.js / utils.js / scheduler.js
│   │   └── commands/             # 8개 명령어 모듈
│   └── migrations/               # 001~004 SQL
│
├── docs/                         # PRD 문서
├── TODO.md / CHANGELOG.md
├── Dockerfile / docker-compose.yml / render.yaml
```
