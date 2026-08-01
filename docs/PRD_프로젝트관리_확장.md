# PRD: 프로젝트 관리 확장 (사전검토 · 회의 · 개발 백로그)

> **Version**: 1.1 (사전검토 모듈 반영)
> **Date**: 2026-06-28
> **Status**: Draft
> **관련 문서**: [PRD_프로젝트_달력_타임라인.md](../PRD_프로젝트_달력_타임라인.md), [PRD_텔레그램_확장.md](./PRD_텔레그램_확장.md)

---

## 1. 배경 & 목표

현재 프로젝트 관리는 **마일스톤(진척률·달성률)**, **단계별 체크리스트**, **이슈(사후 장애·CS)**, **일정(events)** 을 갖추고 있으나, 다음 세 영역이 비어 있다.

| 빈 곳 | 설명 |
|-------|------|
| **사전검토** | 프로젝트가 되기 *이전* 단계(업체 문의·기술검토·아이디어)를 담을 곳이 없음 |
| **회의** | `events(type=meeting)` 는 제목·날짜만 — 안건/회의록/액션아이템 없음 |
| **개발 백로그** | 계획된 개발 작업을 담는 칸반이 없음 (이슈는 사후 발생 장애 중심) |

### 목표

| 목표 | 측정 |
|------|------|
| 사전검토 → 수주 전환 가시화 | 확정(won) 건수 / 전체 검토 건수 |
| 회의 → 실행 전환 | 액션아이템 완료율 / 기한 준수율 |
| 계획 개발 작업 가시화 | 개발 아이템 상태별 처리 리드타임 |

### 설계 원칙

- 기존 자산 **재사용** — `checklists`(JSONB items), `pipeline` 칸반 UI, `events` 일정, `milestones` 진척률, 텔레그램 명령/알림 패턴.
- **멀티테넌트 격리**(`tenant_id`), **낙관적 락**(`version`), **소프트 삭제**(A/S 026 패턴) 등 기존 규약 준수.

---

## 2. 모듈 A — 사전검토 (Pre-study) ✅ 구현됨 (v13.174)

> **변경 이력**: 최초 초안은 "프로젝트 하위 검토 체크리스트"였으나, 실제 요구는
> *프로젝트가 되기 이전 단계*를 다루는 **독립 모듈**이었다. v13.171의 프로젝트 하위
> 「검토」 탭(`project_reviews`)은 폐기하고 아래 모듈로 대체함.

프로젝트와 무관하게, 특정 업체와의 업무 검토·기술 검토·개선 제안·아이디어(브레인스토밍)를
관리하다가 확정되면 프로젝트/수주로 넘긴다. 프로젝트 관리의 독립 모드(`setMode('prestudy')`).

### 2.1 상태 흐름

```
💡 아이디어 → 🔍 검토중 → 🤝 업체협의 → 📄 견적/제안 → ✅ 확정(→ 프로젝트/수주 전환)
                                                        ⏸ 보류   ❌ 드롭
```

### 2.2 데이터 모델 (`047_prestudies.sql`)

`prestudies` — title, client(업체), category(inquiry/tech/improve/idea/quote),
status, priority, owner_id, participants, background, **notes(브레인스토밍)**,
conclusion, due_date(회신기한), tags, **linked_project_id / linked_order_no**,
soft delete + version.

### 2.3 기능

| 기능 | 설명 |
|------|------|
| 3가지 보기 | 칸반(상태별) · **업체별**(특정 업체 검토 이력) · 목록 |
| 필터 | 검색(제목·업체·내용) · 업체 · 내 담당 |
| 전환 | 프로젝트(담당자 → PL 자동 등록) 또는 수주 생성 후 원본에 링크 |
| 코멘트 | `comments` 모듈 재사용(`target_type='prestudy'`) — 메일·텔레그램 알림 |
| 알림 | `prestudy_assigned` · `prestudy_due`(D-1) · `prestudy_won` |
| 텔레그램 | `/prestudy`, `/prestudy <업체명>` |

### 2.4 API (`routes/prestudies.js`)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/prestudies?status=&client=&category=&mine=&q=` | 목록 |
| GET | `/api/prestudies/clients` | 업체별 집계 |
| POST/PUT/DELETE | `/api/prestudies[/:id]` | 등록·수정·소프트삭제 |
| PUT | `/api/prestudies/:id/move` | 칸반 이동 |
| POST | `/api/prestudies/:id/convert` | 프로젝트/수주 전환 |

## 3. 모듈 B — 회의 관리 (Meeting)

`events(type=meeting)` 를 확장해 **안건·회의록·참석·액션아이템**을 담고, 액션아이템을 실행(이슈/개발아이템)으로 잇는다.

### 3.1 데이터 모델

```sql
CREATE TABLE IF NOT EXISTS meetings (
  id          VARCHAR(100) PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) DEFAULT '00000000-0000-0000-0000-000000000001',
  project_id  VARCHAR(100) REFERENCES projects(id) ON DELETE SET NULL,
  event_id    VARCHAR(100) REFERENCES events(id) ON DELETE SET NULL,  -- 일정 연동
  title       VARCHAR(255) NOT NULL,
  meet_date   VARCHAR(10),
  agenda      JSONB DEFAULT '[]',           -- [{ topic, owner }]
  minutes     TEXT,                          -- 회의록(경량 서식 재사용)
  attendees   JSONB DEFAULT '[]',           -- [user_id | name]
  version     INT NOT NULL DEFAULT 1,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meeting_action_items (
  id            VARCHAR(100) PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) DEFAULT '00000000-0000-0000-0000-000000000001',
  meeting_id    VARCHAR(100) NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  title         VARCHAR(500) NOT NULL,
  assignee_id   UUID REFERENCES users(id),
  due_date      VARCHAR(10),
  status        VARCHAR(20) DEFAULT 'open',   -- open | done
  linked_issue_id    VARCHAR(100),
  linked_dev_item_id VARCHAR(100),
  created_at    TIMESTAMPTZ DEFAULT now()
);
```

### 3.2 핵심 흐름

1. 회의 생성 → `events`(type=`meeting`) **자동 발행** → 캘린더·타임라인·텔레그램 `/calendar`·`/today` 노출.
2. 회의록 작성 + 액션아이템 입력(담당·기한).
3. 액션아이템 → **이슈 또는 개발 아이템으로 전환**(한 번의 클릭, `linked_*` 연결).
4. 담당자에게 텔레그램 `action_item_assigned` 알림.

### 3.3 UI

- 프로젝트 상세 **「회의」** 섹션 + 전역 캘린더에서 회의 클릭 시 상세.
- 회의록 경량 서식(체크박스·굵게 — `wmRichNote` 재사용).
- 액션아이템 표: 담당·기한·상태·[이슈로] [개발로] 전환 버튼.

---

## 4. 모듈 C — 개발 백로그 (Dev Items, 칸반)

계획된 개발 작업을 담는 **별도 칸반 백로그**. 이슈(사후 발생 장애·CS)와 명확히 분리.

### 4.1 데이터 모델

```sql
CREATE TABLE IF NOT EXISTS project_dev_items (
  id           VARCHAR(100) PRIMARY KEY,
  tenant_id    UUID NOT NULL REFERENCES tenants(id) DEFAULT '00000000-0000-0000-0000-000000000001',
  project_id   VARCHAR(100) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  milestone_id VARCHAR(100) REFERENCES milestones(id) ON DELETE SET NULL,
  title        VARCHAR(500) NOT NULL,
  description  TEXT,
  category     VARCHAR(20) DEFAULT 'feature', -- feature(신규)|improve(개선)|change(설계변경)|refactor|chore
  status       VARCHAR(20) DEFAULT 'backlog', -- backlog|todo|doing|review|done
  priority     VARCHAR(10) DEFAULT 'normal',  -- high|normal|low
  assignee_id  UUID REFERENCES users(id),
  estimate_h   NUMERIC(10,1) DEFAULT 0,
  actual_h     NUMERIC(10,1) DEFAULT 0,
  sort_order   INT DEFAULT 0,
  deleted_at   TIMESTAMPTZ,                    -- 소프트 삭제
  version      INT NOT NULL DEFAULT 1,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dev_items_board ON project_dev_items(tenant_id, project_id, status, sort_order) WHERE deleted_at IS NULL;
```

### 4.2 UI

- 프로젝트 상세 **「개발」** 탭 — 칸반 보드(기존 `pipeline.js` 보드 패턴 재사용, 5열: 백로그/할 일/진행/검토/완료).
- 카드: 제목·카테고리 배지·담당·우선순위·예상시간. 드래그로 상태 이동.
- 마일스톤 태그 → **진척률 자동 반영**(마일스톤 내 개발아이템 done 비율을 진척 산정에 반영, 선택).

### 4.3 이슈와의 구분

| | 개발 아이템 | 이슈 |
|--|-----------|------|
| 성격 | **계획된** 개발 작업 | **사후 발생** 장애·불량·CS |
| 시작 상태 | backlog | open(접수) |
| 흐름 | 칸반(백로그→완료) | 접수→대응→해결→종결 |
| 전환 | 회의 액션아이템에서 생성 | 현장/고객 제보 |

---

## 5. 일정 통합

- **회의**: `meetings.meet_date` → `events(type='meeting')` 자동 발행/동기화(`meetings.event_id`).
- **사전검토**: `prestudies.due_date`(회신기한) → `events(type='review')` 자동 발행/동기화(`prestudies.event_id`, 048).
  `EVT_TYPE.review = { label:'검토', icon:'🔍' }` 추가됨.
- 기한/일정 삭제·변경 시 연결 일정도 함께 정리. 기존 캘린더/타임라인/일일 브리핑/`/calendar`·`/today` 가 **수정 없이** 자동 노출.

---

## 6. 텔레그램 연동 (기존 패턴 확장)

### 6.1 신규 명령어

| 명령어 | 기능 |
|--------|------|
| `/prestudy` / `/prestudy <업체명>` | 사전검토 현황(진행중 우선, 업체별) |
| `/meeting <프로젝트>` | 최근 회의록 요약 + 미완료 액션아이템 |
| `/actions` | 내게 배정된 미완료 액션아이템 |
| `/devitems` / `/dev <프로젝트>` | 개발 아이템(상태별) |

### 6.2 신규 알림 (notification.service.js TEMPLATES + EVENT_TITLES + 설정 UI 토글)

| event_type | 트리거 | 수신 |
|------------|--------|------|
| `prestudy_assigned` | 사전검토 담당 배정 | 담당자 |
| `prestudy_due` | 회신기한 D-1 | 담당자 (스케줄러) |
| `prestudy_won` | 사전검토 확정 | 담당자 + 관리자 |
| `action_item_assigned` | 액션아이템 배정 | 담당자 |
| `action_item_due` | 액션아이템 기한 D-1 | 담당자 (스케줄러) |
| `dev_item_assigned` | 개발 아이템 배정 | 담당자 |

### 6.3 인라인 버튼

- 액션아이템 알림 → `[완료 ✓]` 버튼(콜백 `action_done:<id>`).
- 개발 아이템 알림 → `[진행 시작]` 버튼(status→doing).

---

## 7. 단계별 로드맵

### Phase 1 — 개발 백로그 ✅ 완료 (v13.171)
- [x] `project_dev_items` 마이그레이션 + CRUD API + 칸반 UI
- [x] ~~`project_reviews`~~ → 폐기(046), **사전검토 모듈로 대체** ✅ (v13.174)

### Phase 2 — 회의 관리 + 일정 통합 ✅ 완료 (v13.172)
- [x] `meetings` / `meeting_action_items` 마이그레이션 + API
- [x] 회의 생성 → `events(type=meeting)` 자동 발행, `EVT_TYPE.review` 추가
- [x] 회의록 UI + 액션아이템 표 + 이슈/개발아이템 전환

### Phase 3 — 텔레그램 연동 + 자동화 ✅ 완료 (v13.173~174)
- [x] `/prestudy` `/meeting` `/actions` `/devitems` 명령어(+자동완성·자연어·help)
- [x] `prestudy_*` `action_item_*` `dev_item_assigned` 알림 + 설정 UI 토글
- [x] 액션아이템·사전검토 기한 D-1 스케줄러
- [ ] 인라인 버튼(액션 완료 / 개발 진행 시작)
- [ ] 주간보고(`/wr`)·주간 다이제스트에 검토·개발·액션 현황 포함

---

## 8. 기술 고려사항

| 항목 | 대응 |
|------|------|
| 멀티테넌트 | 모든 신규 테이블 `tenant_id` + 쿼리 격리(텔레그램 콜백/알림 포함) |
| 소프트 삭제 | 개발 아이템·검토는 `deleted_at` (A/S 026 패턴) |
| 진척률 결합 | 개발아이템 done 비율의 마일스톤 진척 반영은 **옵션 플래그**로(기존 보고 진척률과 충돌 방지) |
| 권한 | 생성/이동: 프로젝트 멤버 / 검토자 지정·결과 확정: PL·관리자 |
| 성능 | 칸반 보드 인덱스(`project_id,status,sort_order`), 액션아이템 담당자 인덱스 |

---

## 9. 성공 지표

| 지표 | 목표 |
|------|------|
| 출하 전 검토 완료율 | 95%+ |
| 회의 액션아이템 기한 준수 | 80%+ |
| 개발 아이템 평균 리드타임(todo→done) | 기준선 대비 20%↓ |
| 텔레그램 액션 완료 처리 비율 | 40%+ |
