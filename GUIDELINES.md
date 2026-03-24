# 업무 관리자 — 개발 가이드라인

이 문서는 프로젝트 전반에 걸친 코딩/디자인 권고 사항입니다.
어떤 환경에서든 이 프로젝트를 수정할 때 참고하세요.

---

## 1. 글자 표시 원칙

- **JS에서 `.slice()`로 텍스트를 자르지 말 것** — 셀/컨테이너 안에서 글자가 최대한 보여야 함
- CSS로 오버플로 처리:
  ```css
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
  ```
- 테두리/마진/패딩은 최소한으로 — 텍스트 영역을 최대한 확보
- 폰트 크기는 **10px 이상** 유지 (8px 이하 사용 금지)
- 긴 텍스트는 `title` 속성(tooltip)으로 전체 내용 확인 가능하게

---

## 2. 코딩 스타일

- **`var`** 사용 (외부 JS 파일에서 `let`/`const` 사용 금지 — 전역 스코프 보장)
- **function 선언문** 사용 (`function foo(){}` ← O, `const foo = () => {}` ← X)
- 화살표 함수는 HTML 인라인 JS에서만 허용
- `file://` 프로토콜 호환 유지 (서버 없이 동작해야 함)
- 외부 JS 로드 실패 대비 인라인 폴백 유지

---

## 2-1. 로컬/서버 듀얼 모드 규칙 (필수)

> **모든 코드 변경은 로컬(IndexedDB)과 서버(API) 양쪽에서 정상 동작해야 한다.**

- `project-data.js`에 IndexedDB 함수 + 서버 모드 오버라이드가 공존
- **CRUD 함수 수정 시**: IndexedDB 로직과 서버 오버라이드 양쪽 확인
- **새 CRUD 함수 추가 시**: 서버 모드 오버라이드도 반드시 함께 구현
- **`_isNew` 플래그**: create 함수에서 `_isNew: true` 추가 → 서버 모드에서 PUT 시도 없이 바로 POST
- **스키마 불일치 주의**: 서버 PostgreSQL 테이블 구조와 클라이언트 IndexedDB 객체 구조가 다를 수 있음 (예: checklists의 items JSONB vs 개별 row)
- **에러 핸들링**: 모든 Promise 체인에 `.catch()` 또는 try-catch 필수

---

## 3. 프로젝트 구조

| 파일 | 역할 |
|------|------|
| `업무일지_분석기.html` | 메인 HTML + CSS + 팀관리 JS (주간분석, 아카이브, 트렌드) |
| `config.js` | 상수/설정 (테마, 색상, 업무분장 코드, AI 설정) |
| `settings.js` | 팀원 그룹, 별칭, localStorage 래퍼, 전체 데이터 백업/복원 |
| `order.js` | 수주번호 ↔ 수주명 매핑 (레거시, 엑셀 기반으로 전환) |
| `pipeline.js` | 파이프라인 뷰 (6단계 칸반 보드) |
| `order-view.js` | 수주 대장 뷰 (테이블, CRUD, 엑셀 연동) |
| `issue-manager.js` | 이슈 관리 (테이블, 모달, 상세 패널, 대응 이력, 통계) |
| `project-data.js` | IndexedDB CRUD, 프로젝트/마일스톤/이벤트 데이터, 유틸 함수 |
| `calendar.js` | 달력 뷰 (월간/주간, 이벤트 등록, 드래그, ICS 가져오기) |
| `timeline.js` | 타임라인/간트 뷰 (프로젝트 등록, 바 드래그, 의존관계 화살표) |
| `dashboard.js` | 대시보드 위젯 (상태 카드, 리소스맵, AI 인사이트) |
| `document-manager.js` | 문서 관리 (폴더, 파일, 미리보기, AI 요약) |
| `auth.js` | 프론트엔드 인증 (로그인, 가입, JWT, 권한 헬퍼, 관리자 사용자 관리 UI) |

### 서버 구조 (`server/`)

| 파일 | 역할 |
|------|------|
| `server/server.js` | Express 서버 진입점 |
| `server/app.js` | Express 앱 설정 (CORS, 헤더, 라우트 등록) |
| `server/config/index.js` | 환경변수 기반 설정 |
| `server/config/db.js` | PostgreSQL 연결 풀 + 쿼리/트랜잭션 헬퍼 |
| `server/services/auth.service.js` | 인증 비즈니스 로직 (JWT, bcrypt, 토큰 관리) |
| `server/middleware/auth.js` | JWT 인증 + 역할 검사 미들웨어 |
| `server/routes/auth.js` | 인증 API (register, login, refresh, logout, me) |
| `server/routes/users.js` | 사용자 관리 API (승인, 거절, 역할 변경) |
| `server/scripts/seed-admin.js` | 초기 관리자 계정 생성 스크립트 |
| `migrations/001_auth.sql` | PostgreSQL 인증 스키마 |

---

## 4. 데이터 구조

### IndexedDB (`WorkAnalyzerDB` v7)

| 스토어 | keyPath | 인덱스 | 용도 |
|--------|---------|--------|------|
| `weeks` | `id` | — | 주간 업무 아카이브 |
| `projects` | `id` | `orderNo`, `status` | 프로젝트 |
| `milestones` | `id` | `projectId` | 마일스톤 |
| `events` | `id` | `startDate` | 일정/이벤트 |
| `progressHistory` | `id` | `projectId`, `date` | 진척률 히스토리 |
| `orders` | `orderNo` | `client`, `date` | 수주 대장 |
| `checklists` | `id` | `projectId`, `phase` | 단계별 체크리스트 |
| `issues` | `id` | `projectId`, `orderNo`, `phase`, `dept`, `status`, `urgency` | 이슈 |
| `issueLogs` | `id` | `issueId`, `date` | 이슈 대응 이력 |
| `workRecords` | `id` (auto) | `date`, `name`, `orderNo`, `dateNameOrder` | 업무일지 레코드 |

### 팀 관리 데이터 (aD 배열)
```
{date: "YYYYMMDD", name, orderNo, hours, taskType, abbr, content}
```

### 프로젝트 데이터
```
{id, orderNo, name, startDate: "YYYY-MM-DD", endDate, status, progress,
 estimatedHours, assignees: [], dependencies: [], color, memo,
 currentPhase, phases: {order:{status,startDate,endDate}, ...}}
```

### 이슈 데이터
```
{id, projectId, orderNo, phase, dept, type, urgency, status,
 reportDate, dueDate, title, description, reporter, assignees: [],
 tags: [], resolution, resolvedDate, createdAt}
```

### 수주맵 (ORDER_MAP)
```
ORDER_MAP[수주번호] = {name, date, client, amount, manager, delivery}
```
- 엑셀 입력 기본 형식: 수주번호, 수주일, 거래처, 프로젝트명, 납품예정
- 파싱: BOM 제거 → 정확 매칭 → 부분 매칭 → 첫 열 폴백

### 공통 연결 키
- `orderNo` — 수주번호로 팀 업무 ↔ 프로젝트 ↔ 수주 ↔ 이슈 연결
- `name` ↔ `assignees` — 팀원명으로 연결
- `projectId` — 프로젝트 ↔ 마일스톤/체크리스트/이슈/진척이력 연결
- 날짜 형식 주의: 팀 측 `YYYYMMDD`, 프로젝트 측 `YYYY-MM-DD`

---

## 5. 날짜 처리

- **타임존 안전**: `localDate()`, `dateToStr(d)` 헬퍼 사용
- `toISOString().slice(0,10)` 직접 사용 금지 (UTC 기준이라 한국 시간과 다를 수 있음)
- 팀 측 ↔ 프로젝트 측 날짜 변환 시:
  - `YYYYMMDD` → `YYYY-MM-DD`: `d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6,8)`
  - `YYYY-MM-DD` → `YYYYMMDD`: `d.replace(/-/g,'')`

---

## 6. UI 패턴

- **토스트 알림**: `showToast(msg, type)` — type: `undefined`(성공), `'error'`, `'warn'`
- **모달**: `position:fixed;inset:0;z-index:9999` + 배경 클릭 닫기
- **사이드 패널**: `position:fixed;right:0` + `animation:slideIn .2s ease`
- **빈 상태**: 데이터 없을 때 안내 메시지 + 등록 버튼 표시
- **2단 탭**: `setPage('team'|'project')` → `setMode('weekly'|'archive'|...)`

---

## 7. 브라우저 호환

- 외부 라이브러리: Chart.js 4.x, SheetJS (xlsx)
- ES5+ 문법 (외부 JS), ES6 허용 (HTML 인라인 JS)
- `file://` 프로토콜 대응: 모든 외부 JS에 `onerror` 폴백 정의
