# Work Manager — 변경 이력

## v13.7 (2026-04-14) — 프로젝트 관리 리팩토링 (1/2)

### 리팩토링 — 파일 분리
- **timeline.js 분할**: 2100+ 줄의 timeline.js에서 프로젝트 상세 패널 관련 로직(약 856줄)을 `project-detail.js`로 분리. `showProjectDetail` / `pdSwitchTab` / `pdLoadIssues` / `pdLoadWork` / `pdToggleCheck` / `pdDeleteCheck` / `pdEditCheckInline` / `pdAddCheck` / `pdShowPhase` / `pdAdvancePhase` / `renderOverviewChkListHtml` / `renderProgressHistoryChart` 등 `pd*` 일체. 동작 변경 없음, 파일 크기/가독성 개선.
- 로드 순서: `timeline.js` → `project-detail.js` (전역 네임스페이스에 순서대로 정의).

---

## v13.6 (2026-04-14) — 체크리스트 추가 시 패널 리로드 제거 (부분 갱신)

### UX 개선
- **체크리스트 추가 시 프로젝트 상세 패널이 닫혔다 다시 열리던 문제**: `pdAddCheck`가 성공 후 `showProjectDetail`로 패널 전체를 재생성하여 깜빡임 + 스크롤/포커스 유실이 발생. 이제 **활성 탭의 체크리스트 영역만 부분 갱신**하고 패널은 그대로 유지. 입력창에 포커스도 복원하여 연속 입력이 가능 (`timeline.js`).
- `renderOverviewChkListHtml`/`pdRefreshOverviewChk` 헬퍼 추가로 개요 탭 체크리스트 렌더링을 별도 함수로 분리. 라이프사이클 탭에서 추가 시엔 기존 `pdShowPhase`로 해당 phase만 갱신.

---

## v13.5 (2026-04-14) — 프로젝트 개요 탭 체크리스트 추가 버그 수정

### 버그 수정
- **프로젝트 상세 패널 개요 탭에서 체크리스트 항목 추가가 동작하지 않던 문제**: `pdAddCheck`가 라이프사이클 탭의 input(`pdNewChkText`)을 먼저 확인하는 구조여서, 해당 탭이 감춰져 있더라도 DOM에 남은 잔여 값/포커스 문제로 개요 탭 input(`pdOverviewNewChk`) 값이 사용되지 않거나 엉뚱한 phase로 전송되던 케이스. **현재 보이는 탭의 input을 우선 사용**하도록 로직 변경 (`timeline.js`).
- **서버 모드 `createCheckItem` 단순화**: 불필요한 선행 `chkGetByProject` 호출 제거 (3→2 API 호출), 응답의 `items` 배열을 slice하여 mutation 방지, `(row.phase || row.phase)` 중복 표현 정리, `dueDate`/`order` 필드 누락 방지 (`project-data.js`).
- **에러 메시지 노출**: 추가 실패 시 서버 에러 메시지를 토스트에 표시하여 원인 파악이 가능하도록 개선.

---

## v13.4 (2026-04-14) — 갱신 후 상세 탭 빈 표 문제 수정

### 버그 수정
- **갱신 후 상세 탭에 데이터가 보이지 않던 문제**: `applyADToUI()`가 병합 후 `sN/sO/sT/sDV/cKw` 등 모든 필터 선택을 초기화하여, `gF()`가 "선택된 인원 없음 → 빈 배열"을 반환하던 문제. 기존 선택값 중 현재 데이터에도 존재하는 항목만 보존하도록 변경 (`업무일지_분석기.html` `applyADToUI`). 이제 갱신 후에도 기존 뷰/필터가 유지되며, 신규 추가된 레코드도 해당 인원/필터 범위 내에서 즉시 노출됨.

---

## v13.3 (2026-04-14) — 다른파일 불러오기 / 갱신 시 데이터 누락 수정

### 버그 수정
- **식별 키 부분 매칭으로 인한 데이터 누락**: `wrIdKey`/`idKey`가 `content`의 앞 30자만 비교하여, 앞부분이 동일하고 뒷부분만 다른 레코드가 같은 키로 충돌 → 병합 시 하나만 남고 나머지가 소실되던 문제. 식별 키를 `date+name+orderNo+hours+content(전체)`로 변경하여 정확 매칭 기준으로 개선 (`업무일지_분석기.html`, `local-auto.js`, `upload.js`).
- **신규 레코드 내 동일 키 충돌**: 신규 배열 자체에 동일한 `wrIdKey`를 가진 레코드가 여러 개일 때 `Map.set`으로 뒤 레코드가 앞 레코드를 덮어쓰던 문제. 첫 번째 레코드를 유지하도록 `if (!newById.has(k))` 가드 추가.

---

## v13.2 (2026-04-14) — 응답 속도 개선 및 낙관적 UI 업데이트

### 서버 응답 속도 개선
- **알림 발송 완전 비동기화**: 이슈 상태 변경 시 텔레그램/이메일/인앱 알림 발송이 API 응답을 블로킹하던 문제 해결 (`server/routes/issues.js`).
- **알림 배치 쿼리 최적화**: `notification.service.js`에서 대상자별 루프로 실행되던 알림 설정/연동/중복 체크 쿼리를 `ANY($1)` 기반 단일 배치 쿼리로 통합. 다수 수신자 발송 시 응답 시간 단축 및 병렬 발송으로 처리량 향상.

### 낙관적 UI 업데이트
- **편집 후 목록 재조회 제거**: 프로젝트/이슈/수주/캘린더/이슈 상태변경 시, PUT 응답 데이터로 로컬 상태를 직접 병합하도록 변경하여 불필요한 목록 재조회(`loadXxx()`) 제거 (`web/src/app/dashboard/{projects,issues,orders,calendar}/page.js`).

---

## v13.1 (2026-04-14) — 엑셀 파싱 및 UI 개선

### 엑셀 데이터 연동 및 파싱 개선
- **날짜 정규화 강화**: 엑셀의 일련번호(Serial Number) 및 다양한 날짜 포맷(`YYYY.MM.DD`, `YY.MM.DD`) 인식 지원 강화 (`pNormDate` 함수 수정).
- **헤더/컬럼 감지 로직 고도화**: 헤더 명칭의 띄어쓰기 무시 처리 및 검색 범위를 늘려, 공백/형식 불일치나 병합된 셀에서도 데이터를 누락 없이 정확하게 가져오도록 개선.
- **데이터 병합/갱신 기준 강화**: 완전히 다른 작업(content)이 같은 날/같은 사람/같은 프로젝트(orderNo)에 속할 때 덮어쓰기되는 문제 해결. 식별 키(`idKey`, `wrIdKey`)에 `content`를 추가하여 중복 판별의 정밀도 향상 (`upload.js`, `local-auto.js`, `업무일지_분석기.html`).

### UI/UX 개선
- **PC 좁은 화면 테이블 최적화**: 분석기 테이블 구조에 `table-layout: fixed` 적용.
- **텍스트 시인성 향상**: 주요 컬럼인 `이름`과 `수주번호`에 말줄임표(...)를 제거하고 `word-break`를 적용하여 정보가 잘리지 않고 항상 전부 표시되도록 보장 (`업무일지_분석기.html`).

---

## v13.0 (2026-04-08) — Phase 1~3 전체 완료 + 프로덕션 레디

### PostgreSQL RLS
- Row-Level Security 정책 추가 (users, projects, issues, orders, audit_logs)
- tenant_id 기반 자동 행 격리 (app.tenant_id 세션 변수)

### AI 기능 보강
- 테넌트별 AI API 키 관리 (GET/PUT `/api/ai/config`)
- 자연어 질의 REST API (POST `/api/ai/query`) — RAG 기반 DB 데이터 자동 수집
- 플랜별 월간 AI 쿼리 제한 (free=0, pro=100, business=500, enterprise=무제한)
- AI 사용량 추적 테이블 (ai_query_usage)

### 알림 시스템 3채널
- 인앱 알림 (in_app_notifications 테이블 + REST API)
- 이메일 알림 (기존 email.service.js 통합, 이벤트 템플릿)
- 알림 센터 페이지 (`/dashboard/notifications`) — 전체/미읽음/환경설정 3탭
- 이벤트별 채널 ON/OFF 설정 (인앱/텔레그램/이메일)
- NotificationBell 컴포넌트: API 연동 + 30초 자동 갱신 + 실시간 뱃지

### PWA 오프라인 + 모바일
- Service Worker: Network First + 데이터 캐시 폴백 (프로젝트, 이슈, 수주 등)
- 정적 파일: Cache First 전략
- 오프라인 감지 + 상단 배너 표시
- 모바일 터치 최적화 (44px 탭 타겟, iOS 줌 방지, safe-area, overscroll-behavior)

### 인프라
- DB 마이그레이션: `005_phase_remaining.sql` (RLS, tenant_ai_configs, ai_query_usage, in_app_notifications)
- 신규 API: `/api/notifications`, `/api/ai/query`, `/api/ai/config`

---

## v12.0 (2026-04-08) — Phase 3 엔터프라이즈 완료

### 3-1. SSO/SAML
- SAML 2.0 IdP 연동 (Azure AD, Okta 호환)
- SSO 설정 관리 UI (관리자 대시보드)
- JIT 프로비저닝 (첫 SSO 로그인 시 계정 자동 생성)
- SP 정보 (ACS URL, Entity ID, NameID Format) 자동 안내

### 3-3. 커스텀 필드/워크플로우
- 커스텀 필드 정의 (프로젝트/이슈/수주 — text, number, date, select, multiselect, checkbox, url, email)
- 커스텀 필드 값 관리 API (엔티티별 일괄 저장/조회)
- 워크플로우 빌더 UI (상태 정의, 전이 규칙, 기본 워크플로우)
- 상태 전이 유효성 검사 API
- 화이트라벨 설정 (로고, 파비콘, 색상, 앱 이름, 커스텀 도메인, CSS)

### 3-4. 온프레미스 Docker Compose
- 원클릭 배포: `docker compose -f docker-compose.onprem.yml up -d`
- 4 서비스: PostgreSQL + API + Next.js Web + Nginx 리버스 프록시
- Web Dockerfile (Next.js 빌드 + 프로덕션 실행)
- Nginx 설정 (API/프론트엔드 자동 라우팅)
- `.env.onprem` 환경 변수 템플릿
- `INSTALL.md` 설치 가이드 문서
- 라이선스 키 시스템 (생성/활성화/상태 조회, 플랜 자동 업그레이드)

### 3-5. 감사/컴플라이언스
- 감사 로그 대시보드 (필터, 검색, 페이지네이션)
- 데이터 내보내기 (감사 로그 CSV, 사용자 JSON, 전체 데이터 JSON — GDPR 대응)
- 접근 기록 리포트 (사용자별 로그인/활동/IP 요약)
- 데이터 보관 정책 설정 (감사 로그/아카이브/삭제 데이터 보관 기간, 자동 정리)

### 인프라/라우트
- 신규 API: `/api/sso`, `/api/custom-fields`, `/api/workflows`, `/api/white-label`, `/api/license`, `/api/data-export`
- DB 마이그레이션: `004_phase3.sql` (sso_configs, custom_field_definitions/values, workflow_definitions, white_label_configs, licenses, data_retention_policies)
- 사이드바 관리자 섹션 추가 (SSO, 커스텀 필드, 워크플로우)
- Next.js 감사 로그 페이지 (`/dashboard/audit`)

### 통계
- 총 API 엔드포인트: 155+
- 총 DB 테이블: 36+
- 총 프론트엔드 페이지: 14개

---

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
