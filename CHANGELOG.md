# Work Manager — 변경 이력

## v13.40 (2026-05-08) — L3: 크로스탭 실시간 동기화 (wmDataBus 이벤트 시스템)

### 배경
검토에서 식별된 L3: "크로스탭 실시간 동기화 — 한 탭에서 변경한 게 다른 탭에 안 나타나서 새로고침해야 하는 케이스 해결". 각 탭이 독립적으로 캐시(`_pdCache` 등)를 보유해, 예를 들어 타임라인에서 마일스톤 추가해도 파이프라인 탭이 stale 데이터를 보여주는 문제.

### 변경

**1) 이벤트 버스 도입 (`업무일지_분석기.html` 인라인 script, 모든 모듈보다 먼저 동기 로드)**
- `window.wmDataBus` pub/sub: `on(type, fn)` / `emit(type, action, detail)`
- 기본 type: `project` / `milestone` / `event` / `order` / `issue` / `checklist` / `document`
- 와일드카드 `*` 지원 (모든 변경 listen)
- payload: `{ type, action, detail }`. action: `created` / `updated` / `deleted` / `bulk`
- 무한 루프 방지: 동일 type emit 사이클 중 재emit 차단

**2) Mutator에 emit 추가 (`project-data.js`)**
- `_emitBus(type, action, detail)` 헬퍼 — `wmDataBus` 미정의 시 no-op
- 각 mutator의 성공 후 `.then()` 체인에 emit:
  - `projPut` → project/created or updated, `projDel` → project/deleted
  - `msPut/Del`, `evtPut/Del`, `orderPut/Del`, `issuePut/Del`
  - `chkPut`, `folderPut/Del`, `filePut/Del`
- 실패 시(throw) emit 안 함 — UI 상태 일관성 유지

**3) 활성 탭 자동 재렌더 (`업무일지_분석기.html` 인라인)**
- 탭별 의존 type 매핑:
  - `pipeline` ← project, milestone, checklist, issue
  - `calendar` ← project, milestone, event
  - `timeline` ← project, milestone, checklist
  - `orders` ← order, project, issue
  - `issues` ← issue, project
  - `docs` ← document, project
- `wmDataBus.on('*', ...)` 단일 listener — 현재 활성 탭(`curPage === 'project' && curMode === X`)이 의존하는 type 변경만 재렌더
- **100ms 디바운스** — 한 흐름에서 발생하는 다중 emit을 1회 재렌더로 통합

### UX 효과
- 타임라인에서 마일스톤 추가 → 같은 세션에서 파이프라인 탭 진입 시 즉시 반영 (이전: 새로고침 필요)
- 이슈관리에서 이슈 등록 → 수주대장의 이슈 배지 카운트 자동 갱신
- 캘린더에서 일정 추가/삭제 → 파이프라인의 일정 표시 즉시 동기화

### L2 검토 결과 (구현 안 함, 결정 보류)
사용자 명시: "지금 컨셉 최대 유지로 확장 가능 검토".
- 현재 `timeline.js` 가 이미 의존선·크리티컬패스·4단계줌·드래그이동·마일스톤마커 보유 → 라이브러리 도입은 사실상 재작성, 디자인 일관성 손상.
- 점진 확장 우선순위 (별도 결정):
  1. 오늘 라인 (S, 1~2h)
  2. 진척률 오버레이 (M, 반나절) — `proj.progress` 이미 있음
  3. 드래그 리사이즈 핸들 (L, 1~2일)
  4. 확장 툴팁 (M, 반나절)
  5. 계획 vs 실적 더블 막대 (L, 1일+, 데이터 모델 변경 필요)

### 변경 파일
- `업무일지_분석기.html` (인라인 wmDataBus + 활성 탭 listener), `project-data.js` (mutator emit), `CHANGELOG.md`

---

## v13.39 (2026-05-08) — M1: 수주대장 → 이슈관리 크로스탭 필터 연동

### 배경
검토에서 식별된 M1 이슈: "수주 이슈 배지 클릭 후 필터 상태 불일치 — 수주번호별 이슈 클릭해도 이슈탭 필터 미적용" (`order-view.js:162-164`).

이전 동작은 단일 매칭 이슈 모달만 띄우고, 사용자가 그 수주의 다른 이슈를 보려면 이슈관리 탭으로 이동 후 수동으로 필터해야 했음 — 크로스탭 동선 끊김.

### 변경
- **`issue-manager.js`**:
  - `issueFilterOrderNo` 변수 신설 (line 18)
  - 필터 로직 (`renderIssues` 의 filter 콜백)에 `if (issueFilterOrderNo && iss.orderNo !== issueFilterOrderNo) return false;` 추가
  - 필터 바에 활성 orderNo 배지 + 해제(✕) 버튼 표시 (`📋 수주 [번호]`)
  - `issueClearFilters` 에 `issueFilterOrderNo = ''` 추가, 초기화 버튼 노출 조건에도 포함
- **`order-view.js`**:
  - 이슈 배지 onclick 을 인라인 코드 → `gotoIssuesForOrder(orderNo)` 함수로 단순화
  - **`gotoIssuesForOrder(orderNo)`** 신규: (1) `issueClearFilters` 호출로 다른 필터 초기화 (빈 결과 방지) (2) `issueFilterOrderNo = orderNo` (3) `setPage('project')` + `setMode('issues')` 로 탭 전환 (4) `renderIssues()` 재호출 (5) 토스트 안내
  - 이슈 0건인 수주의 "-" 표시도 클릭 가능 — 사용자가 새 이슈 등록 흐름으로 진입 가능

### UX 효과
- 수주대장에서 이슈 카운트 클릭 → 즉시 이슈관리 탭에서 그 수주의 모든 이슈를 컨텍스트 유지한 채 확인. 단일 모달 → 다중 이슈 목록으로 시야 확장.
- 활성 필터가 명시적으로 표시돼 사용자가 "지금 무엇을 보고 있는지" 즉시 파악 가능. ✕ 클릭 한 번으로 전체 이슈로 복귀.

### 변경 파일
- `issue-manager.js`, `order-view.js`, `업무일지_분석기.html` (헤더 + 패치노트), `CHANGELOG.md`

---

## v13.38 (2026-05-08) — 이슈 상태 변경 500 수정 + Quick Wins 7건

### 1. 🔴 이슈 상태 변경 500 에러 수정 (사용자 보고 핵심)
**원인**: `middleware/optimistic-lock.js` 가 모든 UPDATE에 `SET ... updated_at = now()` 를 추가하지만, `issues` 테이블에는 `updated_at` 컬럼이 없음 (`migrations/002_data.sql:129-152` 확인 — `created_at`만 존재). 동일 이슈가 events/orders/milestones/checklists 에도 잠재. PostgreSQL이 `column updated_at does not exist`로 500 응답.

**변경**: `server/migrations/015_add_updated_at_columns.sql` 신규 — `issues / events / orders / milestones / checklists` 다섯 테이블에 `updated_at TIMESTAMPTZ DEFAULT now()` 추가 (멱등 IF NOT EXISTS).

### 2. Quick Win 7건

| # | 항목 | 파일 |
|---|---|---|
| Q1 | 달력 "+N건 더보기" 토글이 작동 안 하던 버그 — `.cal-bars-expand` 가 `.cal-bars` 에 와야 하는데 한 단계 위(`.cal-bars-limited`)에 토글되어 CSS 매칭 실패. `closest('.cal-bars')` 로 수정 | `calendar.js:231` |
| Q2 | 일정 저장 시 인원 충돌이 있으면 매번 confirm() — 한 번 요약 토스트로 압축, 저장은 차단 안 함 | `calendar.js:499-510` |
| Q3 | 이슈 상세 빠른상태변경 버튼 — 현재 상태에 `✓` + 솔리드 컬러 + disabled, 미선택은 점선 외곽선 + 호버 강조 + 헤더에 "(현재: …)" 표시 | `issue-manager.js:602-619` |
| Q4 | 이슈 대응이력 입력 폼이 이력 아래에 있어서 긴 이력에 가려짐 — 폼을 이력 위쪽(타이틀 바로 아래)으로 이동 | `issue-manager.js:620-672` |
| Q5 | 수주대장 빈 상태 → 아이콘 + 두 줄 안내 + "📥 엑셀 불러오기" / "➕ 신규 등록" 버튼 | `order-view.js:133-147` |
| Q6 | 수주 정렬 키/방향 + 거래처 필터를 localStorage에 보존 — `wm_orderSortKey` / `wm_orderSortAsc` / `wm_orderFilterClient`. 새로고침/재로그인 시 유지 | `order-view.js:6-15` |
| Q7 | 이슈 등록 시 "반복 이슈 감지" 토스트가 사용자에 따라 거슬릴 수 있어 끄기 옵션 추가. 콘솔에서 `issueRepeatDetectOff()` / `issueRepeatDetectOn()` 호출 (localStorage 영구) | `issue-manager.js:777+` |

### 영향 범위
- DB 스키마: 5개 테이블에 `updated_at` 추가. 기존 데이터는 default `now()` 적용 — 백필 시 모든 행이 마이그레이션 시점 타임스탬프로 채워짐.
- UX: 대부분 양성 변화. Q4의 폼 위치 변경은 기존 흐름과 다르므로 사용자가 잠시 적응 필요.

### 변경 파일
- `server/migrations/015_add_updated_at_columns.sql` (신규)
- `calendar.js`, `issue-manager.js`, `order-view.js`
- `업무일지_분석기.html` (헤더 + 패치노트), `CHANGELOG.md`

---

## v13.37 (2026-05-08) — 프로젝트 메모: 다중 이미지 순서 보장 + 이미지 삭제 UX

### 배경
사용자 요청: "이미지 등록한 것 삭제나, 여러개 이미지 등록 처리."

v13.35에서 메모 인라인 이미지를 도입했으나 (1) 다중 파일 동시 선택 시 FileReader 비동기로 인해 삽입 순서가 흔들릴 수 있었고, (2) 삽입 후 이미지를 삭제할 명시적 UI가 없었음.

### 변경 (`timeline.js`)
- **다중 이미지 순서 보장**: `_memoInsertImageFromFile`을 Promise 반환 함수로 전환. `_memoInsertManyFiles` 헬퍼가 Promise chain으로 직렬 처리해 사용자가 고른 순서대로 삽입.
- **이미지 클릭 → 선택 강조**: `memoEditorClickHandler`가 `<img>` 클릭 시 외곽선(3px solid var(--ac))으로 강조하고 선택 상태를 `_memoSelectedImg`에 저장. 다른 곳 클릭하면 선택 해제.
- **🗑 선택 이미지 삭제 버튼**: 메모 헤더에 추가. 이미지 미선택 시 비활성. 클릭 시 `memoDeleteSelectedImage`가 DOM에서 제거 + 토스트 안내.
- **키보드 지원**: `memoEditorKeyHandler`가 Delete/Backspace로 선택 이미지 삭제, Esc로 선택 해제.
- **다중 삽입 토스트**: 2개 이상 일괄 삽입 시 "🖼 N개 이미지 추가" 안내.
- **모달 재오픈 시 잔여 선택 정리**: `showProjectModal` 진입부에서 `_memoSelectedImg = null`.

### 영향
- 메모 데이터 구조는 변경 없음 — 단순히 입력 UX 개선. 기존 메모/이미지 그대로 동작.
- 텍스트 영역 클릭 시에는 기존 contenteditable 동작(커서 위치 지정) 유지. 이미지 클릭만 별도 처리.

### 변경 파일
- `timeline.js`, `업무일지_분석기.html` (헤더 + 패치노트), `CHANGELOG.md`

---

## v13.36 (2026-05-08) — 수주대장: 조회는 전체 공개, 수정은 관리 직급만

### 배경
사용자 명시 정책: "프로젝트 관리에서 수주대장은 공유되고 있는거 맞지? 누구나 볼 수 있어야 하고, 수정은 관리자와 허락된 인원만 가능해야 함."

v13.34에서 다른 프로젝트 데이터(milestones·issues·documents 등)와 함께 orders도 가시성 필터(`created_by=me OR order_no IN accessible projects`)를 적용했으나, 수주대장은 사내 공통 자산 성격이 강해 누구나 조회 가능해야 한다는 사용자 정책에 따라 환원.

### 변경 (서버)
- **`server/routes/orders.js` GET /**: 가시성 서브쿼리 제거. 단순히 `WHERE tenant_id = $1`로 환원 — tenant 전체 공개. `project-scope` import도 제거 (더 이상 필요 없음).
- **`server/middleware/rbac.js`** `order.edit`: `allowed = true` → `allowed = role === 'manager' || role === 'executive'`. admin은 이미 상위에서 통과하므로 결과적으로 admin/manager/executive만 수정 가능. POST·PUT·DELETE·POST /bulk 모두 동일 RBAC 적용.

### 영향
- 일반 사용자(member): 조회만 가능. 수정 시 403 응답.
- admin/manager/executive: 기존과 동일하게 모든 CRUD 가능.
- 수주대장 행 자체는 변경 없음 — 정책만 환원.

### 후속 작업 (TODO)
- "허락된 인원"의 세밀한 권한 부여(특정 member에게 명시적 권한 grant)는 별도 UI/스토리지(예: `order_editors` 테이블)가 필요. 본 패치에는 미포함. 필요 시 분리하여 작업.

### 변경 파일
- `server/routes/orders.js`, `server/middleware/rbac.js`, `업무일지_분석기.html` (헤더 + 패치노트), `CHANGELOG.md`

---

## v13.35 (2026-05-08) — 프로젝트 메모 인라인 이미지 + 문서관리 빈 상태 처리

### 1. 프로젝트 메모 인라인 이미지 (요청 기반 신규 기능)

#### 변경
- `업무일지_분석기.html` `core-logic.js`: `isHtmlMemo` / `plainToHtml` / `sanitizeMemo` / `memoToHtml` 헬퍼 신설.
  - `sanitizeMemo` — DOMParser 기반 화이트리스트 sanitizer: 허용 태그 (img·br·p·div·span·b·i·u·strong·em·a·ul·ol·li·h1~6·blockquote·code·pre·hr), 허용 src (http(s):, `data:image/...`), 허용 href (http(s):, mailto:, tel:, #), 모든 `on*` 이벤트 핸들러 제거. `<a target="_blank">`에 `rel="noopener noreferrer"` 강제.
  - 평문 메모는 escape + `<br>` 변환으로 안전하게 표시. HTML 메모는 sanitize.
- `timeline.js` 프로젝트 편집 모달: 메모 입력을 `textarea` → `contenteditable div`로 업그레이드.
  - 🖼 이미지 추가 버튼 (파일 선택, 다중 가능, 5MB 권장)
  - 클립보드 붙여넣기 (이미지면 base64 임베드, 텍스트면 평문 정규화하여 HTML 오염 방지)
  - 드래그 드롭 (이미지 파일만 처리)
  - 저장 시 innerHTML을 `sanitizeMemo`로 정제한 뒤 메모 필드에 저장
- `project-detail.js` 상세 패널: 메모 표시를 `eH(memo)` plain text → `memoToHtml(memo)` 자동 감지 렌더로 변경.

#### 보안 노트
- 이미지는 base64 data URL로 메모에 인라인 임베드 — 메모 텍스트 크기가 커질 수 있음. 운영상 메모당 누적 5~10MB 이상이 되면 별도 문서 업로드(문서관리)를 권장.
- 화이트리스트 sanitizer가 모든 인라인 이벤트 핸들러·`javascript:` URL·`expression()` 등 위험 패턴을 차단.

### 2. 문서관리 프로젝트 선택 핸들링 개선

#### 변경 (`document-manager.js`)
- 접근 가능한 프로젝트가 0개일 때: 명확한 빈 상태 + "프로젝트 등록" CTA + v13.31 정책 변경 안내.
- 선택된 `docSelProject`가 가시성 필터로 사라진 경우(공유 회수·이관 등): 자동 초기화 + 첫 번째 자동 선택. 선택 폴더/파일 상태도 함께 리셋.
- 드롭다운 옆에 "N개 접근 가능" 카운트 노출 — 사용자가 자기 가시 프로젝트 수를 즉시 파악 가능.
- `<option value="' + p.id + '"`에 `eH()` 적용해 잠재적 따옴표 이슈 방지.

### 변경 파일
- `core-logic.js`, `timeline.js`, `project-detail.js`, `document-manager.js`, `업무일지_분석기.html` (헤더 + 패치노트), `CHANGELOG.md`

---

## v13.34 (2026-05-08) — 프로젝트 관리 전 페이지에 가시성 정책 일관 적용

### 배경
사용자 보고: "프로젝트 관리 > 파이프라인, 달력, 타임라인, 수주대장, 이슈관리, 문서관리 등 모두 권한이 없으면 안보이게 처리!"

v13.31에서 프로젝트 자체에 가시성 정책(기본 비공개 + 명시 공유)을 도입했지만, 프로젝트에 종속된 데이터(마일스톤·일정·이슈·문서·체크리스트·수주)를 제공하는 라우트는 여전히 tenant 스코프만 적용 — 다른 사용자의 비공개 프로젝트 마일스톤/이슈/문서까지 모두 노출되던 정책 표류.

### 변경 (서버 — 6개 라우트 + bootstrap)
- **`server/middleware/project-scope.js`** (신규): `accessibleProjectsSubquery(req, startIdx)` / `accessibleOrderNosSubquery(req, startIdx)` 헬퍼. v13.31 가시성 룰(owner / project_members(active) / visibility=tenant / (visibility=dept AND 부서 일치))을 SQL 서브쿼리로 일원화. 향후 라우트 추가 시 정책 표류 방지.

| 라우트 | 변경 |
|---|---|
| `milestones.js` GET / | `project_id IN (accessible)` 추가 |
| `checklists.js` GET / | `project_id IN (accessible)` 추가 |
| `issues.js` GET / | `(project_id IS NULL AND created_by=me) OR project_id IN (accessible)` |
| `documents.js` GET /folders, /files | 동일 패턴 — 프로젝트 없는 폴더/파일은 작성자만 |
| `events.js` GET / | `project_ids` JSONB 배열 — 비어있으면 작성자만, 배열에 접근 가능 ID 있으면 노출 |
| `orders.js` GET / | `created_by=me OR order_no IN (accessible projects의 order_no들)` |
| `bootstrap.js` | milestones / events 쿼리에 동일 룰 적용 — 첫 로드 응답도 일관 |

### 정책 결정 노트
- 프로젝트에 종속된 데이터는 그 프로젝트 가시성을 따른다.
- `project_id`가 NULL인 일반 항목(개인 일정, 일반 이슈, 일반 폴더/파일)은 작성자 본인만 노출 — 익명 공개 의도가 없는 한 default-private.
- `orders`는 `project_id` 컬럼이 없으므로 `order_no` 매칭으로 대신함. 본인이 생성한 수주는 항상 본인에게 노출.
- admin/executive 우회 없음 — v13.31 정책과 동일.

### 영향
- 기존에 다른 사용자의 비공개 프로젝트 데이터를 볼 수 있던 사용자는 더 이상 노출되지 않음.
- 새로 생성한 비공개 프로젝트의 마일스톤/이슈/문서 등은 owner와 project_members에게만 노출.
- 메뉴/탭은 그대로 유지 — 사용자가 자기 데이터로 진입은 가능.

### 변경 파일
- `server/middleware/project-scope.js` (신규), `server/routes/{milestones,checklists,issues,documents,events,orders,bootstrap}.js`, `업무일지_분석기.html` (헤더 + 패치노트), `CHANGELOG.md`

---

## v13.33 (2026-05-08) — 페이지 첫 로딩 시 업무일지 미표시 (콜드 스타트 race 수정)

### 배경
사용자 보고: "페이지 로딩시, db에 저장된 업무 내용들이 안보이고, 리프레쉬 해야지만 보이는 경우가 있는데."

### 원인 (콜드 스타트와 토큰 갱신 타이밍 race)
1. `업무일지_분석기.html:5464-5467`에서 `_bootstrap`이 `authInit()`을 10s 타임아웃으로 race.
2. `authInit()` → `_tryRefresh()` 호출 (`auth.js:268`).
3. `_tryRefresh()`의 자체 타임아웃이 **8초** (`auth.js:102`).
4. **Render Free 플랜 콜드 스타트는 30~60초** 소요.
5. 결과: `_tryRefresh` 8s에서 abort → `_accessToken` 미설정 → `authInit` false 반환.
6. `_postAuthInit`이 1-b 단계에서 5초만 폴링 (`업무일지_분석기.html:4636-4642`) → 토큰 미도착 → 데이터 로드 포기.
7. 사용자가 새로고침하면 서버가 warm해진 상태라 `_tryRefresh`가 1초 만에 성공 → 정상 로드.

### 변경 (`auth.js`)
- `_tryRefresh` 타임아웃 8s → **35s** (콜드 스타트 30~60s 커버).
- `_tryRefresh` / `authLogin` / Google OAuth 콜백에서 `_accessToken` 설정 직후 `window.dispatchEvent(new CustomEvent('wm:auth-ready'))` 발행.

### 변경 (`업무일지_분석기.html`)
- `_postAuthInit`에서 `wm:auth-ready` 이벤트 리스너 등록. 부트스트랩 race가 종료된 뒤 토큰이 늦게 들어와도 `_loadFromServer`를 자동 재시도.
- 1-b 폴링 대기 시간 5s → 30s (콜드 스타트 시간 커버).
- `_authReadyHandled` 플래그 + `_dataLoaded` 체크로 동일 데이터 중복 로드 방지.

### 영향
- 첫 로딩에 빈 화면이 보이던 문제 해소. 토큰 갱신이 완료되는 즉시(혹은 polling이 잡을 때) 자동으로 데이터 표시.
- 콜드 스타트 환경에서도 새로고침 없이 정상 동작. Local IndexedDB가 있는 환경에선 SWR 패턴으로 즉시 잠정 렌더 후 서버 응답으로 갱신(기존 동작 유지).

### 변경 파일
- `auth.js`, `업무일지_분석기.html` (헤더 + 패치노트), `CHANGELOG.md`

---

## v13.32 (2026-05-08) — 프로젝트 RBAC 완화 (가시성 정책에 정렬)

### 배경
사용자 보고: "프로젝트 등록시에 이 작업에 대한 권한이 없습니다 에러 발생".

원인: `server/middleware/rbac.js:67`에서 `project.create` 권한이 `role === 'manager'` 만 허용. v13.31에서 가시성 정책을 엄격하게(기본 private + 명시 공유) 도입한 이후로는 RBAC의 manager-only 제약이 의미 중복이자 충돌 — 사용자의 명시적 정책("프로젝트 생성은 임의대로할 수 있지만, 보이는건 생성자가 설정할 수 있어야 함")과도 어긋남.

### 변경 (`server/middleware/rbac.js`)
- **`project.create`** : `manager` only → **모든 인증 사용자** 허용
- **`project.edit`** / **`project.delete`** : `manager || pl` → 인증 사용자 허용. 실질 접근 통제는 v13.31에서 추가한 라우트 핸들러의 `canAccessProject` 사전 체크가 담당.
- **`project.read`** : 모든 인증 사용자 허용. 가시성 룰은 GET 핸들러의 SQL where 절이 적용.
- **`project.assign`** (멤버 추가/해제): 인증 사용자 허용. 라우트에서 owner/PL 검사 필요 시 후속 추가.
- **`pl.assign`** (PL 지정): admin/manager 또는 해당 프로젝트의 기존 PL — 권한 분리 유지.

### 영향
- v13.31 이전부터 manager가 아닌 사용자(member, executive)는 프로젝트를 생성할 수 없었음. v13.32로 누구나 생성 가능. 만든 프로젝트는 기본 비공개라 다른 사용자에게 노출되지 않음.
- 기존 manager에 의존하던 워크플로(예: 매니저 검토 후 프로젝트 등록)가 있다면 별도 정책으로 후속 결정 필요.

### 변경 파일
- `server/middleware/rbac.js`, `업무일지_분석기.html` (헤더 + 패치노트), `CHANGELOG.md`

---

## v13.31 (2026-05-07) — 프로젝트 가시성 엄격 적용 (기본 비공개 + 명시 공유만)

### 배경
사용자 보고: "프로젝트 관리 개별 로그인 사용자 별 처리가 안되네? 기본적으로 다 보이게 되어있는데, 내가 허락한 사용자만 보여야 하는거 아냐?"

원인 분석:
1. **`server/routes/projects.js:23-25`**: `admin`/`executive` 역할이 가시성 필터를 **완전 우회** — `SELECT * FROM projects WHERE tenant_id = $1`. 본인이 만든 비공개 프로젝트도 다른 admin/executive에게 노출.
2. **`migrations/006_project_visibility.sql:37-43`**: v13.27 도입 시 호환성을 위해 기존 프로젝트를 `'dept'`(부서 있음)/`'tenant'`(부서 없음)로 자동 백필 — 결과적으로 v13.27 이전 데이터는 광범위 노출 유지.
3. **`server/routes/bootstrap.js:33-55`**: 별도 정책으로 `department_id` 기반 필터만 사용. `visibility` 컬럼 무시. 부트스트랩 응답에선 여전히 부서원 프로젝트가 모두 노출.

### 정책 결정
사용자 확인 결과 "엄격하게 (기본값 + 명시 공유만)" 선택 — 프로젝트는 기본 비공개, 생성자가 편집 모달에서 명시적으로 공개 범위를 변경하거나 공유 사용자를 추가해야 함. **admin/executive도 동일 룰 따름** (자기가 만든 게 아니거나 공유받지 않은 비공개 프로젝트는 보지 못함).

### 변경 (서버)
- **`server/routes/projects.js`**:
  - `canAccessProject(req, project, opts)` 헬퍼 도입 — owner / member / visibility 체크를 한 곳에서 일관 처리.
  - `GET /api/projects`: admin/executive 우회 제거. 모든 role에 동일한 SQL where 절 적용 — `(p.owner_id = me OR pm.user_id IS NOT NULL OR p.visibility = 'tenant' OR (visibility='dept' AND department_id = my_dept))`.
  - `GET /api/projects/:id`: admin/executive 우회 제거. `canAccessProject`로 일관 검증.
  - `PUT /api/projects/:id`: 가시성 사전 체크 추가 — RBAC 권한이 있어도 안 보이는 프로젝트는 편집 불가 (403).
  - `DELETE /api/projects/:id`: 동일하게 가시성 사전 체크 추가.
  - `POST /api/projects/:id/transfer`: admin/executive 우회 제거. 현재 owner만 이관 가능.

- **`server/routes/bootstrap.js`**: 프로젝트 쿼리를 `projects.js`와 동일한 가시성 룰로 통일. `department_id` 기반의 별도 정책 제거.

- **`server/migrations/014_project_visibility_strict.sql`** 신규:
  - 자기완결: `owner_id`/`visibility` 컬럼이 없으면 추가 (구 환경 호환), 체크 제약·인덱스 idempotent 보장.
  - `owner_id` 백필 (`created_by` → `owner_id`).
  - **모든 `'dept'`/`'tenant'` visibility 를 `'private'` 로 리셋** — v13.27 호환성 백필을 되돌림.

### 운영 가이드
- 본 마이그레이션 적용 후, 광범위 가시성이 필요한 프로젝트는 각 소유자가 프로젝트 편집 모달에서 공개 범위를 `'dept'` 또는 `'tenant'`로 명시적으로 변경하거나, "👥 공유 관리"에서 사용자를 추가해야 합니다.
- admin/executive도 본인이 만들지 않고 공유받지 않은 프로젝트는 보지 못합니다. 관리 목적의 접근이 필요하면 owner에게 공유 요청하거나 owner 이관을 요청해야 합니다.

### 변경 파일
- `server/routes/projects.js`, `server/routes/bootstrap.js`, `server/migrations/014_project_visibility_strict.sql`, `업무일지_분석기.html` (헤더 버전 + 패치노트), `CHANGELOG.md`

---

## v13.30 (2026-05-07) — 편집모드 수정 적용 시 항목 중복 생성 버그 수정

### 배경
사용자 보고: "필터 편집모드 수정 적용 시, 항목 중복 생성됨".

### 원인 (데이터 흐름)
- `GET /api/archives/records`: 매니저/임원은 부서 전체, 관리자는 테넌트 전체 레코드를 반환 → `aD`에 본인+타인 레코드 혼재
- `POST /api/archives/records/bulk` (`wrBulkPut`): `WHERE user_id=me`로 본인 레코드만 DELETE 후 전체 페이로드 INSERT (`user_id=me`로 고정)
- 기존 `applyEdits`: `wrBulkPut(aD)` 호출 → 타인 레코드는 원본 그대로 남고, 본인 user_id로 복사본까지 INSERT → **중복 생성**

### 변경 (서버)
- **`PATCH /api/archives/records/batch`** (`server/routes/archives.js`): WHERE 절을 role 기반 스코프로 확장 — `member`는 본인, `manager`/`executive`는 부서, `admin`은 테넌트. GET 정책과 일치. 매니저가 부원 레코드를 편집해도 silent 0-row update가 더 이상 발생하지 않음.
- **`DELETE /api/archives/records/batch`**도 동일 정책으로 확장.

### 변경 (클라이언트)
- **`applyEdits`** (`업무일지_분석기.html`): `wrBulkPut(aD)` 전체 저장 → `wrUpdateRecords` PATCH로 전환. 변경된 행 + cascade 픽스(같은 수주번호의 미편집 행에서 실제로 ocmt/oclient가 채워진 경우)만 페이로드에 포함. 로컬(IndexedDB) 모드는 `wrUpdateRecords`가 정의되지 않으므로 기존 `wrBulkPut(aD)` 폴백 — 단일 사용자 환경이라 안전.
- **import 후 aD 리로드**: `ldBuf` / `importWorkRecordsJSON` 모두 `wrBulkPut` 직후 `wrGetAll`로 다시 읽어 서버가 새로 부여한 id를 채움. 이게 빠지면 import 직후 편집 시 PATCH가 stale id 때문에 silent 실패.

### 알아둘 점
- 로컬 모드 `wrBulkPut`(IndexedDB `s.clear()` + put)은 그대로 — 단일 사용자 보장 환경.
- 같은 수주번호의 다른 사용자 레코드(예: 부서원의 같은 프로젝트 작업)는 매니저/임원이 ocmt/oclient를 편집하면 함께 갱신됨 (의도된 동작 — order-level 메타는 부서 단위로 일관성 유지).

### 변경 파일
- `server/routes/archives.js`, `업무일지_분석기.html`

---

## v13.29 (2026-05-07) — 업무일지 가져오기 충돌 미리보기 + 컬럼 round-trip

### 배경
사용자 보고: "상세 → 📤 엑셀저장"으로 저장한 파일을 다시 불러오면, 일반 업무일지 엑셀과 컬럼 수가 달라(9 vs 7) 수주명·거래처가 무시되고 편집값이 사라짐. 또한 기존 "갱신" 모드는 식별 키가 너무 엄격(`date+name+orderNo+hours+content`)해서 시간만 바뀐 동일 레코드도 새로 추가됨.

### 기능
- **컬럼 자동감지 확장 (`업무일지_분석기.html`)**: `COL_PATTERNS`에 `ocmt`(수주명·프로젝트명·사업명·건명), `oclient`(거래처·고객사·업체·발주처) 추가. `pMapRow`에서 cells 값이 비어있지 않을 때만 `rec.ocmt`/`rec.oclient`를 채워 ORDER_MAP 기본값을 가리지 않음. `COL_ALL` 순서를 구체적 패턴 우선으로 재배열 (수주명이 "수주"보다 먼저 매칭).
- **`wrAnalyzeImport(existing, newRecs)`**: (날짜+이름+수주번호) 느슨한 키로 분류 — `identical`(완전 일치), `conflicts`(시간/내용 차이), `newRows`(후보 없음). existing 자체 dedup도 함께 수행. 같은 existing이 두 번 매칭되는 것 방지.
- **`wrApplyDecisions(newRecs, analysis, decisions)`**: 행 단위 결정(`update`/`skip`/`add`)을 받아 최종 merged 배열 생성. `mode='replace_keep_matched'` 옵션은 매칭되지 않은 기존만 삭제.
- **`showImportPreviewModal`**: 신규/자동 갱신/충돌 카운트 + 충돌 행 테이블 (날짜·이름·수주번호·시간 비교·내용 diff). 행마다 select로 처리 선택, "전체 갱신/무시/별개 추가" 일괄 버튼 제공.

### 변경된 흐름
- `ldBuf` (엑셀 업로드)와 `importWorkRecordsJSON` (JSON 가져오기) 모두 "갱신" 선택 시 미리보기 모달로 진행. 영향 없는 신규-only 케이스는 미리보기 생략.

### 알아둘 점
- 같은 `(date, name, orderNo)` 후보가 둘 이상이면 ⚠ 배지로 표시 — 사용자가 모호함을 인지한 상태에서 결정.
- `wrBulkPut`는 로컬(IndexedDB)·서버(`/api/archives/records/bulk`) 양쪽 모두 "해당 사용자 레코드 전체 삭제 후 재삽입" 의미 — `merge`/`replace_keep_matched` 두 모드 모두 단일 `wrBulkPut(result.merged)` 호출로 일관 처리.
- 영향 범위: 서버 `/bulk`는 `WHERE user_id = ?` 스코프이므로 본인 데이터에만 적용. 매니저/관리자가 다른 사용자 데이터를 함께 다루려면 별도 경로 필요.

### 변경 파일
- `업무일지_분석기.html`

---

## v13.28 (2026-05-06) — 담당자→멤버 자동 동기화 + 비공개 신규시 공유 모달 자동 오픈

### 기능
- **`syncAssigneesToMembers(projectId, names)`** (`project-data.js`): 프로젝트 저장 후 담당자 이름 배열을 `users.name` / `users.display_name` 정확 일치로 매칭하여 `project_members`에 active `assignee` 로 자동 추가. 매칭 실패한 이름은 외부 인원으로 간주하고 무시. **자동 제거는 하지 않음** — 의도치 않은 접근 회수 방지를 위해 명시적 회수는 "공유 관리" 모달의 "제거" 버튼에서만 수행.
- **`saveProjectUI`** (`timeline.js`): 저장(생성·편집) 직후 best-effort로 위 동기화 호출. 실패 시 토스트 무시.
- **자동 공유 모달**: 신규 등록이고 `visibility='private'`이며 담당자도 비어 있으면 등록 직후 `showProjectShareModal(projId)`을 자동 오픈. 동료가 아무도 못 보는 사각지대 방지.

### 알아둘 점
- 동일 이름의 사용자가 둘 이상이면 `userLookup` 결과의 첫 매칭 한 명만 추가됨. 운영상 충돌이 잦아지면 매칭 키를 email 또는 사번으로 전환할 것.

### 변경 파일
- `project-data.js`, `timeline.js`

---

## v13.27 (2026-05-06) — 사용자 단위 프로젝트 소유권 + 가시성 + 공유/이관

### 기능
- **DB 스키마 (`migrations/006_project_visibility.sql`)**:
  - `projects.owner_id UUID REFERENCES users(id)` — 현재 소유자
  - `projects.visibility VARCHAR(20)` — `'private' | 'dept' | 'tenant'`, 기본 `'private'`
  - 백필: `owner_id ← created_by`. `visibility`는 `department_id` 있으면 `'dept'`, 없으면 `'tenant'`로 채워 기존 가시성 보존 (신규 데이터만 `'private'` 기본).
  - 인덱스: `idx_projects_owner`, `idx_projects_visibility`.
- **`GET /api/projects` 가시성 단일 룰** (`server/routes/projects.js`):
  - admin/executive: 테넌트 전체 가시
  - 그 외: `owner_id = me OR project_members.user_id = me(active) OR visibility='tenant' OR (visibility='dept' AND department_id = my_dept)`
  - 기존 `manager`/`member` 분기 제거 — visibility로 일원화.
- **`GET /api/projects/:id` 권한 체크 강화**: 위 룰 위반 시 403. 기존엔 테넌트 스코프만 검사.
- **`POST /api/projects` + `POST /api/projects/full`**: `owner_id`(미지정 시 `req.user.sub`), `visibility`(미지정 시 `'private'`) 수용.
- **`PUT /api/projects/:id`**: `visibility` 변경 허용.
- **신규 `POST /api/projects/:id/transfer`**: 소유자 또는 admin/executive만 호출 가능. 트랜잭션 내에서:
  1. `projects.owner_id ← newOwnerId` (`updated_at`/`version` 갱신)
  2. 신규 소유자가 멤버였다면 `released_at = now()` 처리
  3. `keepPrevAsMember=true` (기본)이면 기존 소유자를 `assignee`로 active 멤버 보존 (`ON CONFLICT DO UPDATE`)
- **신규 `POST /api/milestones/:id/transfer`** (`server/routes/milestones.js`): `{ targetProjectId }` 받아 `_canEditProject` 헬퍼로 src·dst 양쪽 권한 검사 후 `milestones.project_id` 갱신. 권한은 owner / 활성 member / admin·executive.
- **신규 `GET /api/users/lookup`** (`server/routes/users.js`): 공유/이관 대상자 선택용 경량 엔드포인트. `id`, `name`, `display_name`만 반환. 모든 인증 사용자 호출 가능 (member 권한도 OK).

### 프론트
- **`project-data.js` 헬퍼**: `userLookup`, `projMembersGet`, `projShareAdd`, `projShareRemove`, `projTransfer(id, newOwnerId, { keepPrevAsMember })`, `msTransfer(id, targetProjectId)`.
- **`timeline.js` 프로젝트 모달** (`showProjectModal`): 가시성 셀렉터 (🔒 비공개 / 🏢 부서 / 🌐 전체), 편집 시 "👥 공유 관리" / "↪ 소유권 이관" 버튼. 마일스톤 행에 `↪` 이관 버튼.
- **신규 모달 3개**: `showProjectShareModal`, `showProjectTransferModal`, `showMilestoneTransferModal` — `userLookup`/`projGetAll` 비동기 로드 후 선택지 렌더.

### 마이그레이션 절차
- 배포 후 `migrations/006_project_visibility.sql` 자동 실행. 멱등(IF NOT EXISTS / DO $$ ... END $$). 기존 프로젝트는 `'dept'`/`'tenant'`로 백필되어 가시성 손실 없음.

### 변경 파일
- `migrations/006_project_visibility.sql` (신규)
- `server/routes/projects.js`, `server/routes/milestones.js`, `server/routes/users.js`
- `project-data.js`, `timeline.js`

---

## v13.26 (2026-05-06) — 월별 비교 차트 축 라벨 확대 + 막대 내 상위 2개 % 표시

### 기능
- **축 라벨 폰트 150% 확대** (`업무일지_분석기.html`): `mtrChart` (월별 비교 — 개인별 추이) 와 `mtrCChart` (월별 비교 — 업무분장 코드별 추이) 두 차트의 X축(년월) / Y축(시간 `h`) 틱 폰트를 `10` → `15`로 확대. PPT에 캡쳐 후 축소 시 가독성 확보. 범례는 `10` 유지.
- **막대 내 상위 2개 % 라벨** (`_mtrTop2PctPlugin`): Chart.js `afterDatasetsDraw` 커스텀 플러그인으로, 각 X 위치에서 막대 세그먼트 합계를 구해 비율 1·2위 세그먼트 중앙에 흰색 굵은 글씨 + 그림자로 `XX%` 표시. 5% 미만이거나 세그먼트 높이 14px 미만이면 글자 깨짐 방지를 위해 생략.
- 두 차트 생성 시 `plugins: [_mtrTop2PctPlugin]`로 등록 (전역 등록 X — 다른 차트엔 영향 없음).

### 변경 파일
- `업무일지_분석기.html`

---

## v13.25 (2026-04-23) — 필터 활성 시 차트 V(휴가) 자동 보정 비활성화

### 버그 수정
- **`rCht`** (`업무일지_분석기.html`): 키워드 검색(`cKw`)이나 수주/수주명/거래처 필터(`sO`/`sON`/`sCL`)가 활성, "휴가 제외" 토글(`excludeVac`)이 ON, 또는 업무분장에서 V를 제외한 다른 코드만 선택한 경우 `_calcVacFill` 합성 V 레코드 추가를 건너뜀. 키워드 'mes' 등으로 22건만 남았을 때 차트가 평일 8시간 미달분을 V(휴가)로 잘못 채워 36% 휴가로 보이던 문제 해결.
- 업무분장 필터에서 V만 선택한 경우는 합성 V가 영향 없음 (사용자 의도 우선).

---

## v13.24 (2026-04-23) — 업무내용 검색에서 휴가(V) 자동 제외 + 수동 토글

### 기능
- **자동 제외**: 상세 필터 "업무내용 검색"(`cKw`)에 키워드 입력 시, `abbr === 'V'`(휴가) 레코드를 결과에서 자동 제외. "휴가 신청" 같은 키워드 검색 결과에 휴가 본문이 섞여 들어오던 문제 해결. 단, 사용자가 업무분장 필터에서 V를 명시 선택한 경우는 의도적이므로 포함 유지.
- **수동 토글**: 업무분장 필터 헤더에 "휴가 제외" 체크박스 추가 (`#excludeVacChk`). 체크 시 키워드 유무와 무관하게 V 레코드를 `gF()` 결과에서 전체 제외. 단, V를 명시 선택한 경우는 우선 (선택과 충돌 방지).
- 체크 상태는 `localStorage('wm_excludeVac')`에 영구 저장 → 페이지 재방문 시 복원.

### 변경 파일
- `업무일지_분석기.html`: `excludeVac` 상태, `gF()` 필터 로직, 업무분장 헤더 UI, `togExcludeVac()` 핸들러, `_initExcludeVacChk()` 부트스트랩.

---

## v13.23 (2026-04-15) — "전체 데이터 초기화" 역할별 스코프 일치

### 버그 수정
- **`DELETE /api/archives/records`** 스코프가 목록(GET) 스코프와 일치하지 않던 문제 수정. 기존엔 항상 본인 `user_id` 레코드만 삭제해, 매니저/임원이 부서 전체를 보다가 "전체 데이터 초기화" 클릭 후에도 **다른 부서원 레코드가 남아있음**. 이제 역할별로:
  - `admin` → 테넌트 전체 삭제
  - `manager` / `executive` (부서 있음) → 소속 부서 전체 삭제
  - `member` 또는 부서 없음 → 본인만
  - `?scope=self` 쿼리 파라미터로 본인만 삭제 강제도 가능
- 응답에 `deleted`(건수)와 `scope` 포함.
- 클라이언트 `resetAllData` 확인 다이얼로그에 역할별 영향 범위를 명시. 완료 토스트에 삭제 건수와 스코프 표시.

---

## v13.22 (2026-04-15) — /api/bootstrap 번들 엔드포인트 (N×RTT → 1×RTT)

### 성능
- **신규 `GET /api/bootstrap?recentDays=60`** (`server/routes/bootstrap.js`): 초기 로드에 필요한 projects / milestones / events / recent archives를 **단일 응답**으로 반환. 서버에서 `Promise.all` 병렬 실행. 네트워크 왕복이 4~5회에서 1회로 줄어 고RTT 환경에서 로딩 체감 크게 개선.
- **클라이언트 통합** (`업무일지_분석기.html` `_loadFromServer`): 먼저 `/api/bootstrap` 시도 → 성공 시 `_pdPrimeCache`로 프로젝트/마일스톤/이벤트 TTL 캐시 일괄 프라이밍, 아카이브는 `aD`에 주입해 즉시 렌더. 실패·404 시 기존 개별 API 플로우로 폴백(하위 호환).
- **`_pdPrimeCache` 헬퍼** (`project-data.js`): snake→camel 변환 + 중복 제거 + 타임스탬프 갱신.

---

## v13.21 (2026-04-15) — 서버 쿼리 최적화 (COUNT 제거 + 인덱스 추가)

### 성능 (서버 측)
- **`/api/archives/records` COUNT 제거** (`server/routes/archives.js`): `all=true` 벌크 로드 시 페이지네이션 `total`을 계산하지 않도록 변경. 클라이언트가 `total`을 사용하지 않음에도 매 초기 호출마다 `SELECT COUNT(*) FROM work_records WHERE tenant_id=...` 를 실행해 왔음 (많은 행에서 수 초 소요). `withTotal=true`를 명시할 때만 계산.
- **복합 인덱스 추가** (`server/migrations/012_work_records_perf_indexes.sql`):
  - `idx_wr_tenant_date_desc(tenant_id, date DESC)` — admin/광범위 조회 커버
  - `idx_wr_tenant_user_date_desc(tenant_id, user_id, date DESC)` — 매니저/멤버 조회 커버
  - `ANALYZE work_records` — 플래너 통계 갱신
- 배포 후 자동 마이그레이션 실행되며 PostgreSQL 오토바큠 대기 후 쿼리 계획이 Index Scan으로 전환됨.

---

## v13.20 (2026-04-15) — 아카이브 초기 로드 페이지네이션 (최근 60일 우선)

### 성능 (Phase 2, 2순위)
- `_loadFromServer` 2단계 로드 (`업무일지_분석기.html`):
  - **1차 (빠른 렌더)**: `/api/archives/records?startDate=<60일 전>&limit=50000&all=true` — 최근 60일 레코드만 받아 즉시 렌더. 대부분 사용자의 실사용 범위를 커버.
  - **2차 (백그라운드)**: 800ms 후 `endDate=<60일 전>`로 과거 히스토리 전체 요청. 응답 오면 `id` 기준 dedup 후 `aD`에 append하여 조용히 갱신. 사용자 필터 선택은 `applyADToUI` 내부 보존 로직으로 유지.
  - 최근 60일 데이터가 없는 경우(신규 유저/오래된 데이터만 있는 테넌트) 전체 로드로 폴백.
- 서버 페이로드가 크게 줄어 첫 렌더 체감 시간 단축. 과거 데이터도 곧 자동 병합되어 통계·차트 누락 없음.

---

## v13.19 (2026-04-15) — 대시보드 위젯 렌더 파이프라인 최적화

### 성능 (Phase 2, 1순위)
- `renderDashboard` (dashboard.js) 크리티컬 패스 정리:
  - `autoUpdateProgress`를 **fire-and-forget 백그라운드**로 분리. 기존엔 첫 렌더 전에 수~수십 개의 `updateProject` API를 순차 대기하여 초기 대시보드 표시가 느렸음. 이제 현재 저장된 progress로 즉시 렌더하고, 갱신이 완료되면 `_pdInvalidate('proj')`로 다음 호출 때 반영. 5분 throttle로 과호출 방지(`window._dashAutoProgAt`).
  - `calcTaskDistByOrder`(아카이브 전체 스캔) + `msGetAll/evtGetAll`을 **병렬**로 시작. 기존엔 taskDist await 후 msEvt를 순차 호출.
- 최초 대시보드 표시 시간 크게 단축. progress 수치는 약간 stale이지만 다음 30초 이내 재진입 시 자동 최신화(기존 API TTL 캐시 v13.17과 연계).

---

## v13.18 (2026-04-15) — 초기 로딩 성능 개선 (Phase 2) — Stale-While-Revalidate

### 성능
- **아카이브 초기 로드 SWR 전환** (`업무일지_분석기.html` `_postAuthInit`): 서버 요청 직후 150ms 타이머로 로컬 IndexedDB 선로드 결과를 잠정 렌더 → 서버 응답이 오면 실제 데이터로 덮어쓰기. 서버가 빠르면(150ms 이내) 로컬 렌더 스킵. 서버가 느리면(수 초) 사용자는 로컬 캐시로 거의 즉시 UI 확인. 네트워크 지연 환경에서 TTI 체감 대폭 단축.

### Phase 2에서 제외한 항목
- Chart.js/XLSX 동적 로더: 콜사이트 40+ 개로 invasive, Phase 1 회귀 이력 감안하여 보류
- Service Worker: 현재 HTML에 등록 없음, 별도 배포 검토 필요

---

## v13.17 (2026-04-15) — 초기 로딩 성능 개선 (Phase 1)

### 성능
- **로컬 JS 스크립트 defer 적용** — `config.js`, `settings.js`, `auth.js`, `project-data.js`, `calendar.js`, `timeline.js`, `project-detail.js`, `dashboard.js`, `pipeline.js`, `order-view.js`, `issue-manager.js`, `document-manager.js` 모두 `defer` 추가. HTML 파싱과 JS 다운로드가 병렬 진행 → FCP 단축. 인라인 부트스트랩 IIFE는 `DOMContentLoaded` 시점으로 이동하여 defer 스크립트 실행 후 안전하게 시작.
- **API TTL 캐시 (30s)** (`project-data.js`): `projGetAll` / `msGetAll` / `evtGetAll` 에 공통 `_pdCached` 훅 추가. 동일 페이지 초기 진입 시 대시보드/타임라인/파이프라인/달력이 각자 호출하던 3~5회 중복 요청을 1회로 감소. 진행 중 동일 요청(inflight)은 공유. 모든 쓰기 경로(`projPut`/`projDel`/`msPut`/`msDel`/`evtPut`/`evtDel`)에 `_pdInvalidate` 훅 — stale 데이터 방지.
- **Google Fonts 최적화** — CSS `@import` 제거, `<link rel="preconnect">` + `<link rel="preload" as="style">` 조합으로 변경하여 폰트 요청을 HTML 파싱과 병렬화. Noto Sans KR + JetBrains Mono를 한 요청으로 결합.
- **아카이브 초기 로드 타임아웃 20s → 8s** (`업무일지_분석기.html` `_postAuthInit`): 서버 지연 시 초기 UI 대기 시간 단축. 로컬 IndexedDB는 `_localPreload`로 **서버 요청과 병렬로 선로드**, 서버 실패 시 즉시 폴백 사용.

### 기대 효과
- 초기 중복 API 요청 50~70% 감소
- 서버 지연 환경에서 데이터 표시 시간 최대 12초 단축
- 재방문 시 defer+preload로 FCP 300~600ms 개선

---

## v13.16 (2026-04-15) — 프로젝트 메모 입력 높이 확대

### UI 개선
- 프로젝트 편집 모달의 메모 textarea `rows` 2 → 15, `min-height:240px` 적용 (`timeline.js`).

---

## v13.15 (2026-04-15) — 업무분장 휴가(V) 자동 보정

### 기능 추가
- 차트 탭(업무 분장 비율 / 인원별 분포 / 일별 투입시간)에서 **평일 8시간 미달분을 V(휴가)로 자동 집계**. 기록이 있는 평일(월~금) 기준 (name+date)별 합계가 8h 미만이면 부족분을 합성 `V` 레코드로 추가하여 집계·차트에 반영. 토요일·일요일·기록이 아예 없는 날은 제외. 원본 데이터(엑셀/DB)는 변경 없음.
- 클라이언트별 집계(업체 비율/시간/일별)는 영향 없음 — 휴가는 업체 대응이 아님.

---

## v13.14 (2026-04-15) — 마일스톤 중복 자동 정리를 전 경로로 확대

### 버그 수정
- 타임라인/달력/대시보드/파이프라인/프로젝트 상세 등 **모든 마일스톤 로드 경로에서 중복 자동 정리** 적용. `project-data.js`의 `msGetAll` / `msGetByProject`에 공통 `_msDedupe` 훅을 추가 — `(projectId|name|startDate|endDate)` 중복 시 `sort_order` / `createdAt` 우선순위로 1건만 남기고 나머지는 서버에서 자동 삭제(fire-and-forget). 기존 v13.13 수정은 모달 오픈 시점만 커버했기 때문에, 타임라인에서 중복이 보이는 증상(기존 DB 잔여 중복) 해소.

---

## v13.13 (2026-04-15) — 프로젝트 마일스톤 중복 방지 & 저장 로직 보완

### 버그 수정
- **마일스톤 리스트 중복 현상 수정** (`timeline.js`):
  - **로드 시 중복 자동 정리**: 프로젝트 편집 모달 오픈 시 `(name|startDate|endDate)` 기준 중복 항목을 탐지해 DB에서 삭제하고 유니크 목록만 렌더 (`showProjectModal`).
  - **저장 로직 destroy-recreate 제거**: 기존에는 저장 시 `msDelByProject`로 전체 삭제 후 재생성하여, DELETE가 부분 실패하거나 재생성이 중복 호출되면 중복이 누적. diff 기반 upsert로 변경 — 기존 id는 PUT, 신규 행은 POST, 제거된 행만 DELETE. 같은 모달 내 동일 키 행도 1회만 저장.
  - `addMsRow` / `runSuggestMilestones`로 추가된 행은 `data-msid`가 없어 자연스럽게 신규로 처리됨.

---

## v13.12 (2026-04-15) — 상세 테이블 표시 행 수 확대

### UI 개선
- 팀관리 > 주간분석 > 상세 탭 테이블 뷰포트 높이 확대: `.tw` max-height 480px → 940px (약 11행 → 25행 가시화, `업무일지_분석기.html`).

---

## v13.11 (2026-04-14) — 업무일지 마일스톤 태깅 (투입실적 정확도 향상)

### 기능 추가
- **업무일지 레코드에 `milestone_id` 컬럼 추가** (migration `011_work_records_milestone_id.sql`). 투입실적 집계 시 명시적 태그가 있으면 태그 기반으로 우선 집계, 없으면 기존 날짜 구간 매칭 fallback.
- 서버 엔드포인트 확장 (`archives.js`): GET/POST/PATCH/단건POST 모두 `milestoneId` 필드 accept/return. 신규 엔드포인트 `POST /api/archives/records/auto-tag-milestones` — 프로젝트의 마일스톤 날짜 구간으로 업무일지를 일괄 자동 태깅 (`overwrite` 옵션: 미태깅만 or 전체 덮어쓰기).
- `calcHoursByMilestone` 3단 우선순위로 재작성:
  1. `milestoneId` 태그 일치 → 정확 집계
  2. 날짜 구간 매칭 → 미태깅 카운트 표기 (추정 집계)
  3. 가장 가까운 마일스톤 → 추정 집계
  반환값에 `_meta.untaggedCount`, 마일스톤별 `untagged` 카운트, `people` 맵 포함.
- **투입실적 탭 UX** (`project-detail.js`): 우상단 "🏷 자동 태깅" 버튼, 마일스톤별 "~N" 미태깅 카운트, 헤더에 전체 미태깅 경고. 자동 태깅 후 아카이브 캐시 invalidate + 부분 갱신.
- **인원별 투입** 섹션 이제 실제 데이터 표시 (v13.10 이전엔 `calcHoursByMilestone`이 `people`를 반환하지 않아 항상 비었음).

### 남은 작업
- 업무일지 편집 테이블에 마일스톤 선택 드롭다운 (수동 태깅 UI)은 다음 작업으로 분리.

---

## v13.10 (2026-04-14) — 프로젝트 저장 후 "Invalid time value" 실제 원인 수정

### 버그 수정
- **renderCalendar가 initCalendar보다 먼저 호출될 때 crash**: `calYear`/`calMonth` 전역이 미초기화된 상태에서 `new Date(undefined, NaN, 0).toISOString()` → "Invalid time value" RangeError. saveProjectUI가 저장 후 `if (typeof renderCalendar === 'function') await renderCalendar()`로 호출하는데, 사용자가 한 번도 달력 탭을 열지 않았다면 초기화가 안 됐음. renderCalendar 진입부에서 값이 없으면 오늘 기준으로 자기 초기화하도록 가드 추가 (`calendar.js`).
- v13.9의 renderTimeline 폴백은 그대로 유지 (별개 방어 케이스).

---

## v13.9 (2026-04-14) — 프로젝트 저장 후 "Invalid time value" 에러 수정

### 버그 수정
- **renderTimeline에서 "Invalid time value" 예외**: 전체 프로젝트의 `startDate`/`endDate`가 모두 비어있거나(NULL) 형식이 깨진 경우 `new Date(undefined)` → Invalid Date → `getTimeUnits`의 `toISOString()`에서 RangeError. 저장 성공 후 재렌더링이 crash하여 사용자에겐 "프로젝트 저장 실패: Invalid time value" 토스트로 노출되던 현상.
  - 유효한 `YYYY-MM-DD` 포맷만 범위 산출에 사용하도록 정규식 필터 추가
  - 수집된 날짜가 없으면 오늘 기준 ±30일 폴백
  - `calcCriticalPath`의 `new Date(...).toISOString()` 3곳에 `isNaN(getTime())` 가드 추가

---

## v13.8 (2026-04-14) — 프로젝트 관리 리팩토링 (2/2): 로컬 모드 제거

### 리팩토링 — 로컬 IndexedDB 모드 제거
- **`project-data.js` 서버 전용화**: 기존 로컬(IndexedDB) + 서버(REST) 듀얼 모드에서 **로컬 모드 전체 삭제**. 1653줄 → 1166줄 (≈487줄/30% 감소).
- 제거: `upgradeProjectDB`, `openDBv2`, `db` 전역, `dbPut/GetAll/Get/Del/GetByIndex`, AUTH_SKIP/apiFetch 가드, IIFE 래퍼
- IIFE 안에 있던 서버 오버라이드(`toCamel`, `toCamelArray`, `toSnake`, 그리고 entity CRUD들)를 모두 **top-level 선언**으로 승격
- 서버 API를 사용하도록 재작성: `readAllArchiveRecords`, `suggestMilestones`, `getWeeklyArchiveSummary`, `getRecentArchiveWeeks` (`wrGetAll`/`wkGetAll` 기반)
- 날짜 포맷(YYYYMMDD / YYYY-MM-DD) 양쪽 모두 방어적 처리
- `apiFetch`는 전역에 반드시 있어야 하며, 없으면 런타임 오류 발생(의도된 동작)

### 비고
- 로컬 IndexedDB 백업/복원 UI(`settings.js`)는 그대로 두었으나 실제 기능은 동작하지 않음 (fallback `openDBv2` no-op). 추후 서버 API 기반 백업으로 교체 예정.

---

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

## v10.2 (2026-04-07) — 사업부/부서별 접근 제어

### 기능
- **프로젝트 부서 필터링**: 사용자의 `departmentId`로 자동 필터링하여 본인 부서 프로젝트만 노출. 생성 시 부서 자동 배정.
- **일정 부서 필터링**: `events`도 동일 정책 — admin/executive는 전체, manager/member는 소속 부서만.
- **업무일지 부서 스코프**: 매니저/임원은 소속 부서 전체 조회 가능, member는 본인만.
- **백필**: 기존 프로젝트/일정의 `department_id` 누락분을 생성자(`created_by`)의 부서로 자동 채움.

### 변경 파일
- 서버: 프로젝트/일정/업무일지 라우트, migration

---

## v10.1 (2026-04-07) — 사용자별 데이터 분리 (멀티 유저 지원)

### 기능
- **업무일지 사용자별 격리**: `work_records.user_id` 컬럼 + 인덱스 추가. 모든 GET/POST/PATCH/DELETE에 `user_id` 스코프 적용 — 다른 사용자 데이터가 보이거나 영향받지 않도록.
- **엑셀 불러오기/저장/편집/삭제 모두 본인 데이터만 영향**.
- **NULL user_id 자동 백필**: 업그레이드 시 기존 NULL 레코드를 admin 계정으로 귀속.

### 변경 파일
- migration 007, server/routes/archives.js

---

## v10.0 (2026-04-07) — 성능 최적화 + 편집 저장 안정화 + 모바일 개선

### 성능
- **가상 스크롤**: 업무일지 테이블에서 화면에 보이는 행만 렌더링 — 수천 행에서도 DOM 가벼움.
- **GET 응답 ETag 캐싱**: 데이터 변경 없으면 304로 회신 — 네트워크/CPU 절감.
- **서버 SELECT 최소화**: 불필요 컬럼 제외 → 전송량 감소.
- **로드 경량화**: 전용 변환 함수 + 중복 체크 제거.
- **테이블 렌더 최적화**: 이름별 색상 룩업 O(n²) → O(1).

### 편집 저장 안정화
- **편집 적용 시 전체 데이터 저장으로 통일** — per-row 수주명/거래처 영속 보장 (※ v13.30에서 매니저/관리자 스코프 문제로 PATCH로 재전환).
- **공통업무 수주명/거래처 per-row 저장** 수정 (NULL 폴백 처리).

### 차트/UX
- 업무분장 비율·일별 투입시간 차트에 등록된 전체 코드(V 포함) 표시.
- 인원별 분포 영역 10명 기본 표시 (max-height 확대).
- 모바일 터치 영역 확대, 검색 드롭다운 전체 너비.
- 중복 레코드 제거 버튼(🧹) + 병합 시 덮어쓰기 지원.

---

## v9.8 (2026-04-07) — 서버 DB 전용 전환 + 편집모드 저장 수정

### 변경
- 수주명/거래처 저장을 서버 DB 전용으로 단순화 (localStorage·메모리 임시저장 제거).
- 로컬 IndexedDB 폴백 제거 — 서버 API만 사용.
- 편집모드 수정 적용 후 이전 데이터가 표시되는 캐시 버그 수정.
- 업무일지 편집 권한을 모든 인증 사용자에게 허용.
- 토스트 알림 위치를 화면 최상단으로 변경.

---

## v9.7 (2026-04-01) — 서버 우선 로드 + 그룹/별칭 서버 저장 + 날짜 정규화

### 변경
- **날짜 정규화**: 서버 DB의 `date` 필드를 `YYYY-MM-DD` → `YYYYMMDD`로 정규화 (주차 NaN 표시 근본 수정).
- **서버 우선 로드**: 접속 시 서버 DB를 먼저 로드 — 모든 기기(PC/모바일)에서 동일 데이터 보장.
- **인증 지연 방어**: 토큰 미발급 시 최대 5초 대기 후 서버 재시도.
- **팀원 그룹/별칭 서버 저장**: `user_settings` 테이블 + `/api/settings` API 추가. 로드 시 서버에서 동기화.
- 수동입력 날짜 `YYYYMMDD` 정규화 + IndexedDB 동기화 + 필터 즉시 갱신.

---

## v9.6 (2026-03-31) — 휴가(V) 업무분장 추가 + 거래처/수주명 DB 저장 수정

### 기능
- 업무분장 코드 V(휴가) 추가 — 색상, 차트, 엑셀 반영.
- DB 스키마에 `ocmt`(수주명), `oclient`(거래처) 컬럼 추가.
- 서버 POST bulk / PATCH batch에서 ocmt, oclient 저장/갱신 처리.

### 안정성
- 새로고침/재로그인 후에도 수정된 거래처/수주명이 유지되도록 흐름 정리.
- 편집 적용 시 PATCH 실패 → bulk 폴백 + 에러 토스트 표시.
- 서버 DB 연결/ROLLBACK 에러 처리 강화 (502 크래시 방지).
- 서버 모드에서 삭제/수정/저장 시 로컬 IndexedDB도 함께 동기화.

---

## v9.5 (2026-03-31) — 작업 내용 선택 삭제

### 기능
- 편집모드에서 체크박스로 개별/멀티 선택 삭제.
- 헤더 체크박스로 전체 선택/해제. 선택 건수 실시간 표시 + 삭제 확인 다이얼로그.
- id 보유 레코드는 서버 개별 삭제(`DELETE /records/batch`), 미보유 시 전체 교체 폴백.

---

## v9.4 (2026-03-31) — 편집모드 변경분만 갱신

### 변경
- 편집모드 적용 시 변경된 레코드만 DB 업데이트 (`PATCH /records/batch`).
- 레코드 id 보유 시 개별 UPDATE, 미보유 시 기존 전체 교체 폴백.
- 엑셀 갱신(merge) 시 기존 레코드 id 보존.

### 비고
- 이 시점에선 `PATCH /records/batch`가 본인 user_id만 허용 — 매니저/관리자 시나리오는 v13.30에서 비로소 정합화.

---

## v9.3 (2026-03-31) — 엑셀 갱신 시 중복 데이터 방지

### 변경
- 서버 모드 bulk 저장 시 트랜잭션(DELETE→INSERT)으로 중복 삽입 방지.
- 대량 데이터 배치 삽입 (500건씩, PostgreSQL 파라미터 한도 대비).
- 중복 판별 키에 hours·abbr 추가 (`date|name|orderNo|hours|abbr|dept|content`).

---

## v9.2 (2026-03-31) — 차트 이미지 저장

### 기능
- 모든 차트 패널에 📷 저장 버튼 추가 (hover 시 표시).
- 배경·테두리 포함 캡처 (html2canvas, 현재 테마 그대로).
- 흰색/검정 배경 선택 저장 (Chart.js canvas 직접 추출, 2x 해상도).
- canvas 없는 패널(인원별 분포, 업체 대응별 시간)도 html2canvas로 캡처 지원.

---

## v9.1 (2026-03-31) — 엑셀/TSV 내보내기 수정

### 버그 수정
- 엑셀저장·TSV복사 시 수주명·거래처 편집값(`editMap`, 레코드 override) 정상 반영.
- TSV복사에서도 `editMap` 편집값(수주번호·시간·업무분장·약자·업무내용) 반영.

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
