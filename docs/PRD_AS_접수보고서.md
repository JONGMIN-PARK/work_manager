# PRD: A/S 접수·할당·처리·보고·확인·보고서 모듈

> 업무 관리자 — A/S 워크플로우 통합 모듈
> 작성일: 2026-05-13 | 작성자: jmpark5303@gmail.com
> 참조 자료:
> - `AS 접수 및 보고서.pptx` (사내 4-step 플로우 시안)
> - `AS_Report_Template_v1.xlsx` (6시트 통합 리포트 템플릿)

---

## 1. 배경 및 목적

### 현재 상황
- 이슈관리(`issue-manager.js`) 모듈이 존재하지만 **A/S 전용 라이프사이클**(접수→할당→처리→보고→확인→보고서)을 모두 담지 못함.
- 고객사 현장 A/S는 다음과 같은 추가 데이터가 필요:
  - 고객사·장비번호(Prj No.)·Serial·보증여부·설치일자
  - 다부서(CS/공정/SW/제조/품질/영업) **병렬 처리** 및 부서별 소요시간 집계
  - 사용부품·수량·청구구분(보증/유상/Goodwill) 및 청구금액 자동 집계
  - 고객 서명·사내 결재·만족도(CSAT)
  - PDF/엑셀 보고서 + 이메일 공유
- 현재는 PPT/엑셀로 수기 작성 → 데이터 검색·집계·KPI 불가, 부서 간 핸드오프 누락 발생.

### 목표
| # | 목표 | 설명 |
|---|------|------|
| G1 | **A/S 전용 단일 진입점** | 접수~보고서 발행까지 한 화면에서 워크플로우 단계 추적 |
| G2 | **다부서 협업** | 한 A/S 건에 여러 부서 담당자가 동시에 작업 로그 기록, 소요시간 자동 집계 |
| G3 | **표준 보고서 자동 생성** | 엑셀 템플릿 6시트 구조 그대로 PDF/XLSX 산출, 이메일 발송 |
| G4 | **이슈관리와 연계** | A/S 건이 SW 버그·설계 결함이면 기존 `issues` 테이블로 자동 연동 |
| G5 | **고객 만족도·청구 데이터 집계** | CSAT, 청구금액, MTTR(평균 처리시간) KPI 대시보드 |

### 비목표 (Out of Scope, v1)
- 고객 셀프 접수 포털(고객용 로그인) — v2
- RMA 물류 추적(택배 송장) — v2
- 견적/세금계산서 발행 연동 — v2 (ERP 별도)

---

## 2. 용어 및 코드 (엑셀 템플릿 enum 그대로 사용)

| 분류 | 코드값 | 비고 |
|------|--------|------|
| **부서 (Dept)** | CS · 공정 · SW · 제조 · 품질 · 영업 · 기타 | 기존 `DEPT`에 `cs`, `quality`, `sales`, `etc` 추가 필요 |
| **카테고리 (Category)** | HW고장 · SW오류 · 공정이슈 · 통신/네트워크 · 센서/비전 · 모션/구동 · 소모품교체 · 운영미숙 · 환경/설치 · 개선요청 · 기타 | A/S 전용 |
| **긴급도 (Priority)** | P1-긴급(라인정지) · P2-높음(생산영향) · P3-보통 · P4-낮음(요청사항) | 기존 `ISSUE_URGENCY` 확장 |
| **처리방식 (Method)** | 원격지원 · 출장 · RMA · 가이드제공 · 자료송부 | |
| **접수경로 (Channel)** | 전화 · 이메일 · 메신저 · 방문 · 자동알람 · 기타 | |
| **작업유형 (WorkType)** | 고객문의응대 · 원격분석 · 현장출장 · 로그분석 · 재현테스트 · 부품교체 · SW수정 · 파라미터조정 · 캘리브레이션 · RCA분석 · 검증/QA · 문서화 · 이관/협조 · 기타 | 부서별 처리이력 한 줄당 1개 선택 |
| **처리 상태 (Status)** | 진행중 · 완료 · 대기(부품) · 대기(고객확인) · 이관 · 보류 · 취소 | |
| **리포트 상태 (ReportStatus)** | 작성중 · 검토중 · 승인완료 · 재처리요청 · 보류 · 취소 | |
| **완료여부 (Closure)** | 정상완료 · 부분완료 · 미완료(사유필요) · 이관처리 · 취소 | |
| **청구구분 (Billing)** | 보증(무상) · 보증외(유상) · Goodwill(무상) · 확인필요 | |
| **만족도 (CSAT)** | 매우만족 · 만족 · 보통 · 불만족 · 매우불만족 · N/A | |
| **장비 최종 상태** | 정상가동 · 임시조치(가동) · 제한가동 · 가동불가 · 재방문필요 | PPT 시안 기반 |
| **모니터링** | 불필요 · 단기관찰 · 장기관찰 | |
| **재현여부** | 100% 재현 · 간헐적 · 1회성 · 재현불가 · 미확인 | |
| **발생빈도** | 시간당 · 일당 · 주당 · 월당 · 비정규적 · 회 | |

> 위 enum은 `config.js`에 새 객체 `AS_*` 로 추가하고, 드롭다운/필터 UI에서 공통 사용.

---

## 3. 사용자 스토리

### 3.1 접수 단계 (CS)
| ID | 역할 | 스토리 | 우선순위 |
|----|------|--------|----------|
| AS-US-01 | CS 담당 | 고객 전화/이메일 접수 시 접수번호(`AS-YYYY-MM-###`)를 자동 채번하여 신규 카드를 만들고 싶다 | P0 |
| AS-US-02 | CS 담당 | 고객사·장비번호 입력 시 기존 수주대장(`orders`)/프로젝트(`projects`)에서 자동 매칭되어 보증여부·설치일자가 자동 채워지길 원한다 | P0 |
| AS-US-03 | CS 담당 | 카테고리·긴급도·접수경로를 선택해 1차 분석(재현여부·발생빈도·영향범위)을 기록하고 싶다 | P0 |
| AS-US-04 | CS 담당 | 접수와 동시에 텔레그램으로 책임 부서장에게 알림이 가길 원한다 | P0 |

### 3.2 할당 단계 (CS → 각 부서)
| ID | 역할 | 스토리 | 우선순위 |
|----|------|--------|----------|
| AS-US-10 | CS 담당 | "처리부서 분기 결정"에서 주관부서 1개 + 보조부서 N개를 선택하고 각 담당자를 지정하고 싶다 | P0 |
| AS-US-11 | 팀장 | 부서별 처리방식(원격/출장/RMA)과 약속 방문일시를 지정하고 싶다 | P0 |
| AS-US-12 | 담당자 | 내게 할당된 A/S만 모아보는 "내 A/S 큐" 화면을 원한다 | P0 |
| AS-US-13 | CS 담당 | 잘못 할당했을 때 다른 부서로 **이관**하면 이력에 한 줄로 남아야 한다 | P1 |

### 3.3 처리 단계 (각 부서 병렬)
| ID | 역할 | 스토리 | 우선순위 |
|----|------|--------|----------|
| AS-US-20 | 담당자 | 작업할 때마다 한 줄씩 Activity Log를 추가(작업유형·문제현상·조치내용·소요시간·상태)하고 싶다 | P0 |
| AS-US-21 | 담당자 | 사용한 부품·수량·단가·교체대상 S/N·청구구분을 입력하고 싶다 | P0 |
| AS-US-22 | 담당자 | Laser Power 측정값·Before/After 사진·로그 파일을 첨부하고 싶다 | P0 |
| AS-US-23 | 담당자 | 내 작업이 끝나면 부서 상태를 "완료"로 바꾸고 시스템이 부서별 소요시간을 자동 집계해주길 원한다 | P0 |
| AS-US-24 | 팀장 | 진행 중인 A/S 중 P1/P2를 칸반(접수→할당→처리→완료) 보드로 보고 싶다 | P1 |

### 3.4 보고 단계 (담당 엔지니어 → 팀장)
| ID | 역할 | 스토리 | 우선순위 |
|----|------|--------|----------|
| AS-US-30 | 담당 엔지니어 | 처리 완료 후 "근본원인(RCA)" 및 "재발방지 대책"을 입력하고 보고서 초안을 생성하고 싶다 | P0 |
| AS-US-31 | 팀장 | 검토 후 승인/재처리 요청을 결정하고 사내 결재라인(작성자→검토자→승인자) 서명을 남기고 싶다 | P0 |

### 3.5 확인 단계 (고객)
| ID | 역할 | 스토리 | 우선순위 |
|----|------|--------|----------|
| AS-US-40 | 현장 담당자 | 현장에서 태블릿/PC로 서명하면 보고서에 이미지 서명이 박혀 PDF가 만들어지길 원한다 | P0 |
| AS-US-41 | 고객 | 만족도(CSAT)와 코멘트를 남기고 싶다 | P1 |
| AS-US-42 | CS 담당 | 고객 서명 안 받은 건은 자동으로 "대기(고객확인)" 상태가 되고 D+3일 미회신 시 알림이 오길 원한다 | P1 |

### 3.6 보고서 단계
| ID | 역할 | 스토리 | 우선순위 |
|----|------|--------|----------|
| AS-US-50 | 담당 엔지니어 | 표지 + 접수상세 + 처리이력 + 부품 + 결과 + 가이드 6시트 구조의 엑셀로 다운로드하고 싶다 | P0 |
| AS-US-51 | 담당 엔지니어 | 동일 내용을 PDF로 변환해 고객 이메일로 발송하고 싶다 | P0 |
| AS-US-52 | 팀장 | 월별/고객사별 A/S 통계(건수·MTTR·청구금액·CSAT)를 대시보드에서 보고 싶다 | P1 |

---

## 4. 워크플로우 (상태 다이어그램)

```
┌────────┐  접수    ┌────────┐  분기   ┌────────┐  부서완료  ┌────────┐  RCA+서명 ┌────────┐
│ 신규   │ ───────▶ │ 접수   │ ──────▶ │ 할당   │ ─────────▶ │ 처리중 │ ────────▶ │ 보고   │
└────────┘ (CS 채번) │ (CS)   │ (주/보) │        │ (부서별)    │ (병렬) │ (엔지니어) │ (검토)  │
                    └────────┘        └────────┘            └────────┘           └────┬───┘
                                                                                      │
                       ┌──────────┐ 고객서명+CSAT ┌──────────┐  발송  ┌──────────┐  │
                       │ 보고서   │ ◀──────────── │ 확인     │ ◀───── │ 승인     │ ◀┘
                       │ 발행완료 │               │ (고객)   │        │ (팀장)   │
                       └──────────┘               └──────────┘        └──────────┘

   ↑ 이슈관리 연계: 처리중 단계에서 SW오류/HW고장/설계변경 → `issues` 자동 생성·링크
   ↑ 보류/취소: 어느 단계에서도 진입 가능 (사유 필수)
```

### 4.1 상태 전이 규칙
- `신규 → 접수`: CS가 필수 필드 11개 입력 시 자동.
- `접수 → 할당`: 주관 부서 1개 + 담당자 1명 이상 지정 시.
- `할당 → 처리중`: 부서별 첫 Activity Log 추가 시.
- `처리중 → 보고`: 모든 활성 부서 상태가 "완료"이고 RCA 입력 시.
- `보고 → 승인`: 사내 결재(작성자+검토자+승인자) 완료 시.
- `승인 → 확인 대기`: 보고서 발행(PDF/이메일) 후.
- `확인 대기 → 완료`: 고객 서명 + CSAT 수집 시.

---

## 5. 데이터 모델 (PostgreSQL)

기존 `issues` 테이블과 분리하고, 필요 시 1:1 링크. 멀티 테넌트(`tenant_id`) 적용.

### 5.1 `as_tickets` (A/S 접수 마스터)
```sql
CREATE TABLE as_tickets (
  id              VARCHAR(40) PRIMARY KEY,           -- as-{uuid12}
  ticket_no       VARCHAR(20) UNIQUE NOT NULL,       -- AS-2026-05-001 (테넌트별 채번)
  tenant_id       UUID NOT NULL,
  -- 고객·장비
  customer_id     VARCHAR(40),                       -- customers FK (옵션)
  customer_name   TEXT NOT NULL,
  site_line       TEXT,
  customer_contact TEXT,
  equipment_no    VARCHAR(40),                       -- Prj No.
  equipment_model TEXT NOT NULL,
  serial_no       TEXT NOT NULL,
  install_date    DATE,
  warranty_status TEXT,                              -- 보증내/보증종료
  -- 접수
  received_at     TIMESTAMPTZ NOT NULL,
  received_by     UUID NOT NULL,                     -- users FK
  channel         TEXT,                              -- enum Channel
  priority        TEXT NOT NULL,                     -- enum Priority
  category        TEXT NOT NULL,                     -- enum Category
  method          TEXT,                              -- enum Method (대표 처리방식)
  -- 신고내용·1차분석
  issue_summary   TEXT NOT NULL,                     -- 고객 신고 원문
  reproduction    TEXT,                              -- 재현여부
  frequency       TEXT,                              -- 발생빈도
  impact_scope    TEXT,                              -- 영향범위
  initial_analysis TEXT,
  -- 상태
  status          TEXT NOT NULL DEFAULT 'received',  -- received|assigned|in_progress|reporting|approved|customer_wait|closed|hold|cancelled
  closure         TEXT,                              -- enum Closure
  closed_at       TIMESTAMPTZ,
  -- 최종 결과
  rca             TEXT,
  prevention      TEXT,
  final_equip_status TEXT,                           -- 정상가동/임시조치/제한가동/가동불가/재방문필요
  monitoring      TEXT,                              -- 불필요/단기/장기
  -- 이슈관리 연계
  linked_issue_id VARCHAR(40),                       -- issues.id (옵션)
  -- 메타
  promised_response_at TIMESTAMPTZ,
  promised_visit_at    TIMESTAMPTZ,
  version         INT DEFAULT 1,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  created_by      UUID,
  updated_by      UUID
);
CREATE INDEX idx_as_tickets_tenant_status ON as_tickets(tenant_id, status);
CREATE INDEX idx_as_tickets_customer ON as_tickets(tenant_id, customer_name);
```

### 5.2 `as_assignments` (부서·담당자 할당)
```sql
CREATE TABLE as_assignments (
  id           VARCHAR(40) PRIMARY KEY,
  ticket_id    VARCHAR(40) NOT NULL REFERENCES as_tickets(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL,
  dept         TEXT NOT NULL,                        -- enum Dept
  role         TEXT NOT NULL,                        -- 'primary' | 'support'
  assignee_id  UUID,
  assignee_name TEXT,
  method       TEXT,                                 -- enum Method
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_h   NUMERIC(8,2),                         -- activity_logs로부터 자동 집계
  status       TEXT DEFAULT 'pending',               -- pending|in_progress|completed|handover
  result       TEXT,                                 -- 처리결과 요약
  note         TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_as_assign_ticket ON as_assignments(ticket_id);
CREATE INDEX idx_as_assign_assignee ON as_assignments(tenant_id, assignee_id, status);
```

### 5.3 `as_activity_logs` (부서별 작업 이력)
```sql
CREATE TABLE as_activity_logs (
  id           VARCHAR(40) PRIMARY KEY,
  ticket_id    VARCHAR(40) NOT NULL REFERENCES as_tickets(id) ON DELETE CASCADE,
  assignment_id VARCHAR(40) REFERENCES as_assignments(id) ON DELETE SET NULL,
  tenant_id    UUID NOT NULL,
  seq          INT NOT NULL,                         -- 1부터 순번
  worked_at    TIMESTAMPTZ NOT NULL,
  dept         TEXT NOT NULL,
  author_id    UUID NOT NULL,
  author_name  TEXT,
  work_type    TEXT NOT NULL,                        -- enum WorkType
  problem      TEXT,                                 -- 문제현상/분석
  action_taken TEXT,                                 -- 조치내용
  duration_h   NUMERIC(6,2),                         -- 소요시간(시간 단위)
  status       TEXT NOT NULL,                        -- enum Status
  followup     TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_as_logs_ticket ON as_activity_logs(ticket_id, seq);
```

### 5.4 `as_parts` (사용 부품)
```sql
CREATE TABLE as_parts (
  id           VARCHAR(40) PRIMARY KEY,
  ticket_id    VARCHAR(40) NOT NULL REFERENCES as_tickets(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL,
  used_at      DATE,
  item_name    TEXT NOT NULL,
  part_no      TEXT,
  qty          NUMERIC(10,2) NOT NULL,
  unit_price   NUMERIC(12,0),
  replaced_sn  TEXT,                                 -- 교체 대상 S/N
  warranty     BOOLEAN,
  billing      TEXT NOT NULL,                        -- enum Billing
  amount       NUMERIC(12,0),                        -- qty * unit_price (자동)
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
```

### 5.5 `as_attachments` (첨부 파일)
```sql
CREATE TABLE as_attachments (
  id           VARCHAR(40) PRIMARY KEY,
  ticket_id    VARCHAR(40) NOT NULL REFERENCES as_tickets(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL,
  category     TEXT,                                 -- 사진/로그/측정데이터/기타
  file_name    TEXT NOT NULL,
  file_url     TEXT NOT NULL,                        -- 기존 documents 모듈 연동
  uploaded_by  UUID,
  uploaded_at  TIMESTAMPTZ DEFAULT NOW()
);
```

### 5.6 `as_signatures` (서명·결재)
```sql
CREATE TABLE as_signatures (
  id           VARCHAR(40) PRIMARY KEY,
  ticket_id    VARCHAR(40) NOT NULL REFERENCES as_tickets(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL,
  role         TEXT NOT NULL,                        -- customer_field | engineer | author | reviewer | approver
  signer_name  TEXT,
  signer_id    UUID,                                 -- 내부 사용자만
  signed_at    TIMESTAMPTZ,
  signature_url TEXT,                                -- 이미지 데이터 URL/파일
  csat         TEXT,                                 -- enum CSAT (고객 서명에만)
  csat_speed   TEXT,
  csat_quality TEXT,
  csat_overall TEXT,
  comment      TEXT
);
```

### 5.7 `as_reports` (보고서 발행 이력)
```sql
CREATE TABLE as_reports (
  id           VARCHAR(40) PRIMARY KEY,
  ticket_id    VARCHAR(40) NOT NULL REFERENCES as_tickets(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL,
  report_no    TEXT NOT NULL,                        -- ticket_no와 동일하거나 -R{rev}
  revision     INT DEFAULT 1,
  report_status TEXT NOT NULL,                       -- enum ReportStatus
  format       TEXT,                                 -- xlsx | pdf
  file_url     TEXT,
  sent_to      TEXT[],                               -- 이메일 수신자
  sent_at      TIMESTAMPTZ,
  generated_by UUID,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 6. API 설계 (`/api/as-tickets`)

기존 `server/routes/issues.js` 패턴 그대로(`auth → tenantScope → rbac → optimistic-lock`).

| Method | Path | 권한 | 설명 |
|--------|------|------|------|
| GET | `/api/as-tickets` | as.read | 목록 (필터: status, dept, customer, priority, period) + 페이지네이션 |
| GET | `/api/as-tickets/:id` | as.read | 단건 + 관련 자식(assignments/logs/parts/attachments/signatures/reports) 동봉 |
| POST | `/api/as-tickets` | as.create | 신규 접수 (`ticket_no` 자동 채번 — `AS-YYYY-MM-{nextSeq}`) |
| PUT | `/api/as-tickets/:id` | as.edit | 수정 (optimistic-lock + 상태 전이 검증) |
| POST | `/api/as-tickets/:id/transition` | as.edit | 상태 강제 전이 (보류/취소 사유 포함) |
| DELETE | `/api/as-tickets/:id` | as.delete | 완전 삭제(관리자) |
| POST | `/api/as-tickets/:id/assignments` | as.assign | 부서·담당자 할당/이관 |
| PUT | `/api/as-tickets/:id/assignments/:aid` | as.assign | 할당 상태 변경 |
| POST | `/api/as-tickets/:id/logs` | as.work | Activity Log 추가 (소요시간 자동 합산 트리거) |
| POST | `/api/as-tickets/:id/parts` | as.work | 사용 부품 추가 |
| POST | `/api/as-tickets/:id/attachments` | as.work | 파일 업로드 (기존 `documents` 연동) |
| POST | `/api/as-tickets/:id/signatures` | as.sign | 서명/CSAT 저장 |
| POST | `/api/as-tickets/:id/reports` | as.report | 보고서 생성 (xlsx/pdf) + 다운로드 URL 반환 |
| POST | `/api/as-tickets/:id/reports/:rid/send` | as.report | 이메일 발송 |
| POST | `/api/as-tickets/:id/link-issue` | as.edit | 이슈관리 연계(`issues` 생성 또는 기존 ID 링크) |
| GET | `/api/as-tickets/stats` | as.read | KPI: 건수·MTTR·CSAT·청구합계 (기간·고객사·부서별) |

### 6.1 RBAC 권한 신설
- `as.read`, `as.create`, `as.edit`, `as.assign`, `as.work`, `as.sign`, `as.report`, `as.delete`
- 기본 매핑: admin=전체, manager=delete제외 전체, member=read/work/sign

### 6.2 채번 트랜잭션
```sql
SELECT 'AS-' || to_char(NOW(),'YYYY-MM') || '-' ||
  LPAD((COALESCE(MAX(SUBSTRING(ticket_no FROM 12)::INT),0)+1)::TEXT, 3, '0')
FROM as_tickets
WHERE tenant_id=$1 AND ticket_no LIKE 'AS-'||to_char(NOW(),'YYYY-MM')||'-%'
FOR UPDATE;
```

---

## 7. 프런트엔드 (`as-manager.js`)

### 7.1 신규 탭
- 좌측 메뉴: `🛠️ A/S 관리` (이슈관리 바로 아래)
- 서브탭: `📋 접수목록` | `🎯 내 큐` | `📊 칸반보드` | `📈 통계`

### 7.2 접수목록 (목록 뷰)
- 필터 바: 상태 / 부서 / 긴급도 / 고객사 / 카테고리 / 기간
- 컬럼: 번호 · 고객사 · 장비모델 · 카테고리 · 긴급도 · 주관부서 · 담당자 · 상태 · 경과시간(SLA bar) · 액션
- 검색: 접수번호·고객사·시리얼·키워드
- 일괄: 부서 일괄 할당 / 엑셀 내보내기

### 7.3 접수 상세 (탭형 패널)
PPT 4-step 흐름을 화면 탭으로 1:1 매핑:

```
┌─────────────────────────────────────────────────────────────┐
│ AS-2026-05-001  코아비스 / Laser Trimming System  [P2 ⚠]    │
│ ① 접수  ②할당  ③처리  ④보고  ⑤확인  ⑥보고서   상태:처리중 │
├─────────────────────────────────────────────────────────────┤
│ [① 접수 탭]                                                  │
│  - 고객정보 카드 (자동 매칭 표시)                            │
│  - 접수정보 (일시·접수자·경로·긴급도·카테고리·처리방식)      │
│  - 신고내용 (원문)                                           │
│  - 1차분석 (재현/빈도/영향범위)                              │
│  - [할당으로 →]                                              │
└─────────────────────────────────────────────────────────────┘
```

각 탭별 핵심 위젯:
- **②할당**: 부서 체크박스 + 주/보조 라디오 + 담당자 자동완성 + 약속일시 + [텔레그램 알림 보내기] 버튼
- **③처리**: Activity Log 타임라인(부서별 색상) + 사용부품 표 + 첨부파일 그리드 + Laser Power 측정표(템플릿)
- **④보고**: RCA/재발방지 입력 + 부서별 소요시간 집계 카드 + 사내 결재 라인
- **⑤확인**: 현장 담당자 서명 캔버스(태블릿) + CSAT 라디오 + 코멘트
- **⑥보고서**: [엑셀 다운로드] [PDF 다운로드] [이메일 발송] + 발행이력 목록

### 7.4 칸반 보드
- 컬럼: 접수 / 할당 / 처리중 / 보고 / 확인대기 / 완료
- 카드: 긴급도 색띠 + 고객사 + 장비 + 경과시간
- 드래그&드롭 → 서버 transition API 호출

### 7.5 통계 대시보드
- 카드: 이번달 접수 N건 / 완료 M건 / 평균 MTTR Xh / CSAT 평균 Y점 / 청구합계 Z원
- 차트:
  - 월별 접수 vs 완료 (라인)
  - 카테고리별 분포 (도넛)
  - 부서별 소요시간 분포 (Stacked Bar)
  - 고객사 TOP10 (가로 막대)

### 7.6 모바일 대응
- 현장 엔지니어용: 본인 큐 + Activity Log 추가 + 사진 업로드 + 서명 캔버스 → 모바일 우선 레이아웃.

---

## 8. 보고서 생성 (서버)

### 8.1 엑셀 (xlsx) — 템플릿 6시트 그대로
- 라이브러리: `exceljs` (이미 패치노트에서 사용 중인지 확인 필요, 아니면 신규 추가)
- 템플릿 파일 `server/templates/as_report_template.xlsx` 보관, placeholder 치환 방식.
- 시트 매핑:
  1. **표지요약** — 헤더 정보 + 부서별 소요·완료여부·RCA·서명
  2. **접수 및 이슈 상세** — 고객 신고 원문 + 1차분석 + 처리부서 분기
  3. **부서별 처리 이력** — `as_activity_logs` 전체 행 (No/일자/부서/담당자/유형/현상/조치/소요/상태/F-U)
  4. **사용 부품/소모품** — `as_parts` + 청구 자동집계
  5. **최종 결과/첨부/고객 확인** — `as_signatures` + `as_attachments` 목록 + CSAT
  6. **코드표·작성 가이드** — 정적(템플릿 고정)

### 8.2 PDF
- 엑셀 → LibreOffice headless 변환 (또는 `puppeteer`로 HTML→PDF)
- 서명 이미지 PNG는 셀에 임베드.

### 8.3 이메일 발송
- 기존 `notifications` 또는 새 mailer(SMTP/Resend) 통해 PDF 첨부 발송
- 발송 본문 템플릿: 회사 로고 + 접수번호 + 핵심 요약 3줄

---

## 9. 알림 (텔레그램 + 사내)

| 이벤트 | 수신자 | 내용 |
|--------|--------|------|
| 신규 접수 P1/P2 | 책임 부서장·관리자 | "🚨 [AS-…] {고객사} {장비} {카테고리} 긴급접수" |
| 할당 | 담당자 | "📌 새 A/S 할당: {접수번호} {긴급도} 약속:{날짜}" |
| 처리 지연 (SLA 초과) | 담당자+팀장 | "⏰ {접수번호} SLA 초과 (P1:4h/P2:1d/P3:3d/P4:5d)" |
| 고객 미확인 D+3 | CS | "📞 {접수번호} 고객서명 3일째 미회신" |
| 보고서 발행 | 작성자+팀장 | "📄 {접수번호} 보고서 발행 완료" |

기존 `notification.service.js` 패턴 재사용.

---

## 10. 이슈관리 연계 규칙

- A/S 카테고리가 `SW오류·HW고장·공정이슈·센서/비전·모션/구동` 중 하나이고 사내 재발방지 필요(P1/P2)면 → `issues` 자동 생성, `as_tickets.linked_issue_id` 채움.
- 양방향 링크: 이슈 상세에 "원본 A/S: AS-2026-05-001" 표시.
- 이슈에서 해결되면 A/S 활동로그에 자동 1줄 추가("관련 이슈 #iss-… 해결").

---

## 11. SLA 정책 (v1 기본값)

| 긴급도 | 첫 응답(promised_response_at 자동) | 현장 방문(visit) | 처리 완료 목표 |
|--------|-----------------------------------|-----------------|---------------|
| P1-긴급 | 1시간 이내 | 24시간 이내 | 3일 |
| P2-높음 | 4시간 이내 | 3일 이내 | 7일 |
| P3-보통 | 1영업일 | 7일 이내 | 14일 |
| P4-낮음 | 3영업일 | 협의 | 30일 |

`as_tickets.received_at + sla_offset`을 트리거로 promised 자동 채움, 초과 시 알림.

---

## 12. 권한·테넌트·감사

- 모든 테이블 `tenant_id` 필수, `tenantScope` 미들웨어 적용.
- `audit` 라우트와 동일 패턴: `INSERT/UPDATE/DELETE`에 `audit_logs` 기록.
- 고객 정보는 PII — 내보내기/이메일 발송 시 권한 검사 + 마스킹 옵션.

---

## 13. 마이그레이션·릴리스 계획

### Phase 1 (P0, 2주)
- 마이그레이션 `014_as_tickets.sql` 생성 (5개 테이블)
- `config.js`에 `AS_*` enum 7종 추가
- `server/routes/as-tickets.js` CRUD + assignments + logs
- `as-manager.js` 목록·상세(접수/할당/처리 탭)·내 큐
- 이슈관리 연계 1방향 (A/S → 이슈 자동 생성)

### Phase 2 (P0~P1, 2주)
- 부품·첨부·서명 테이블 + UI
- 보고서 생성 (엑셀 6시트) + 다운로드
- 칸반 보드
- 텔레그램 알림 통합

### Phase 3 (P1~P2, 2주)
- PDF 변환·이메일 발송
- 통계 대시보드 + CSAT 집계
- SLA 자동 산정·초과 알림
- 모바일 최적화 + 서명 캔버스

### Phase 4 (P2, v2)
- 고객 셀프 접수 포털
- RMA 물류 추적
- ERP 견적/세금계산서 연동

---

## 14. 성공 지표 (KPI)

| 지표 | 측정 방식 | 목표(3개월) |
|------|----------|------------|
| 접수~완료 평균 시간 (MTTR) | `closed_at - received_at` 평균 | 기존 대비 -30% |
| 보고서 작성 시간 | 엑셀 수기 vs 자동 발행 | 60분 → 5분 |
| 부서 핸드오프 누락 건수 | `as_assignments` 상태 stuck | 월 0건 |
| 고객 CSAT | 매우만족+만족 비율 | 85% 이상 |
| 보증외(유상) 청구 누락률 | `as_parts.billing` 미입력 | <5% |
| P1/P2 SLA 준수율 | promised 시각 내 처리 비율 | 95% |

---

## 15. 오픈 이슈

1. **부품 마스터** — 현재 `parts` 마스터 테이블이 없음. 자유 입력으로 시작하고 추후 마스터화할지 결정 필요.
2. **고객사 마스터** — `customers` 테이블 부재. 현재 `orders` 테이블에 산재. v1은 자유 입력 + 자동완성으로 가고 v2에서 `customers` 마스터 추출.
3. **서명 저장 형식** — 디지털 서명(법적 효력)이 필요한가? 현재는 단순 이미지(PNG)만 가정.
4. **다국어** — 보고서를 영문으로도 발행해야 하는 고객이 있는지 (해외 장비 납품).
5. **온프레미스** — `.env.onprem` 환경에서도 동일 동작 필요. PDF 변환을 위해 LibreOffice 사전 설치 가이드 필요.

---

## 16. 부록 A: PPT 시안 ↔ DB 필드 매핑

| PPT 항목 | DB 컬럼 |
|---------|---------|
| 접수번호 | `as_tickets.ticket_no` |
| 접수일자 / 접수자 | `received_at` / `received_by` |
| 장비명 / 장비번호(Prj No.) | `equipment_model` / `equipment_no` |
| 고객명 / 고객사업장 및 연락처 | `customer_name` / `site_line` + `customer_contact` |
| A/S 유형 (체크박스 14종) | `category` (enum) — 다중선택은 v2 |
| 발생 세부사항 | `issue_summary` |
| 부서선정 (Click) | `as_assignments` rows |
| 담당자 / 처리방식 / 처리날짜 | `as_assignments.assignee_name` / `.method` / `.completed_at` |
| 재현여부 / 발생빈도 / 보증여부 | `reproduction` / `frequency` / `warranty_status` |
| Laser Power 측정표 | `as_attachments`(측정데이터) + 보고서 템플릿 고정 표 |
| 처리내용 / 사용부품 | `as_activity_logs.action_taken` / `as_parts` |
| 장비 최종 상태 / 모니터링 | `final_equip_status` / `monitoring` |
| A/S 진행 상태 (완료/추가/불가/보류) | `closure` |
| 현장 담당자·엔지니어 서명 | `as_signatures` role=customer_field / engineer |
| 보고서 작성·공유(E-mail) | `as_reports` |

---

작성 완료. 검토 후 우선순위·SLA 수치·권한 매핑은 팀 협의로 확정.
