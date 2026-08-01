# PRD: 요소기술 개발 관리 (Element Technology / 기반기술 자산)

> **Version**: 1.0
> **Date**: 2026-08-01
> **Status**: 기획 (Draft) — 구현 착수 전
> **관련 문서**: [PRD_프로젝트관리_확장.md](./PRD_프로젝트관리_확장.md), [PRD_텔레그램_확장.md](./PRD_텔레그램_확장.md)

---

## 1. 배경

지금 앱은 **프로젝트 단위**로만 개발을 관리한다. 그런데 실제 개발의 상당 부분은
특정 프로젝트에 속하지 않는 **재사용 가능한 기반기술**이다.

- 카메라 캘리브레이션 알고리즘, 비전 검사 루틴, 모션 제어 모듈, 통신 프로토콜 래퍼,
  AI 결함 검출 모델, HMI 프레임워크 …
- 이런 요소기술은 **한 번 만들어 여러 프로젝트에서 재사용**되는데, 지금은
  기록이 프로젝트 안에 흩어져 있어 다음 문제가 생긴다.

| 문제 | 현상 |
|------|------|
| **보유 기술을 모름** | 사전검토·견적 때 "이거 우리가 할 수 있나?"를 사람 기억에 의존 |
| **중복 개발** | 다른 프로젝트에서 이미 만든 걸 또 만듦 |
| **개발 경위 유실** | 왜 이렇게 설계했는지, 어떤 시행착오가 있었는지 남지 않음 |
| **기술스택 파악 불가** | 어떤 언어·라이브러리·버전을 쓰는지 조직 차원에서 안 보임 (EOL·보안 대응 어려움) |
| **성숙도 불명** | 실전 투입 가능한 기술인지, 아직 연구 단계인지 구분 없음 |

### 목표

| 목표 | 측정 |
|------|------|
| 보유 기술 카탈로그화 | 등록된 요소기술 수 / 적용 이력이 있는 비율 |
| 사전검토 판단 근거 제공 | 사전검토 건 중 요소기술이 연결된 비율 |
| 개발 경위 보존 | 기술당 개발일지 건수 |
| 기술스택 가시화 | 스택 항목별 사용 기술 수 · EOL 대상 식별 |
| 재사용률 향상 | 기술당 평균 적용 프로젝트 수 |

### 설계 원칙

- **프로젝트 독립** — 요소기술은 프로젝트에 종속되지 않는 조직 자산. `project_dev_items`(프로젝트 내 계획 작업)와 명확히 분리.
- **기존 자산 재사용** — 개발일지는 `milestone_progress_logs` 패턴(작성자·진척률·노트·소프트삭제), 서식은 `wmRichNote`, 칸반/카드 UI는 `pipeline`·`prestudy` 패턴, 토론은 `comments`, 알림·명령은 텔레그램 모듈.
- **기존 규약 준수** — 멀티테넌트(`tenant_id`), 낙관적 락(`version`), 소프트 삭제(`deleted_at`), 마이그레이션은 `;` 분리 안전한 순수 DDL.

---

## 2. 개념 정의 — 기존 항목과의 구분

| | **요소기술** | 개발 아이템 | 사전검토 | 이슈 |
|--|-------------|------------|---------|------|
| 소속 | **조직 자산**(프로젝트 무관) | 특정 프로젝트 | 프로젝트 이전 단계 | 특정 프로젝트 |
| 성격 | 재사용 기반기술 | 계획된 개발 작업 | 업체 문의·타당성 검토 | 사후 발생 장애 |
| 수명 | 장기(버전 관리) | 프로젝트 종료 시 종료 | 확정/드롭으로 종결 | 해결 시 종결 |
| 산출물 | 라이브러리·모듈·알고리즘 | 기능 | 결론·견적 | 조치 내역 |
| 예시 | "비전 캘리브레이션 v2.1" | "SK 2호기 검사 화면" | "LG 신규 장비 문의" | "카메라 보정 오류" |

---

## 3. 데이터 모델

### 3.1 `tech_assets` — 요소기술 (마스터)

```sql
CREATE TABLE IF NOT EXISTS tech_assets (
  id           VARCHAR(100) PRIMARY KEY,
  tenant_id    UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES tenants(id),
  code         VARCHAR(40),                  -- 기술코드 (예: TECH-VIS-001) — 조직 내 식별자
  name         VARCHAR(255) NOT NULL,        -- 기술명
  category     VARCHAR(20) DEFAULT 'etc',    -- vision|motion|control|sw|ai|comm|mech|etc
  summary      VARCHAR(500),                 -- 한 줄 설명 (카탈로그 카드용)
  description  TEXT,                         -- 상세 (원리·구조·제약)
  status       VARCHAR(20) DEFAULT 'research', -- research|developing|verifying|available|deprecated
  trl          INT DEFAULT 1,                -- 기술성숙도 1~9 (아래 4.2)
  tech_version VARCHAR(20),                  -- 기술 자체의 버전 (예: v2.1)
  owner_id     UUID REFERENCES users(id),    -- 기술 책임자
  participants JSONB DEFAULT '[]',           -- 참여자 이름 배열
  stack        JSONB DEFAULT '[]',           -- [{kind, name, version}] — 3.4
  tags         JSONB DEFAULT '[]',
  repo_url     TEXT,                         -- 저장소/산출물 링크
  doc_url      TEXT,                         -- 문서 링크
  progress     INT DEFAULT 0,                -- 최신 개발일지 진척률 (denormalize)
  total_hours  NUMERIC(10,1) DEFAULT 0,      -- 개발일지 투입시간 합 (denormalize)
  deleted_at   TIMESTAMPTZ,
  deleted_by   UUID REFERENCES users(id),
  version      INT NOT NULL DEFAULT 1,
  created_by   UUID REFERENCES users(id),
  updated_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);
```

인덱스: `(tenant_id, status)`, `(tenant_id, category)`, `(tenant_id, owner_id)` — 모두 `WHERE deleted_at IS NULL`.
`stack`은 GIN 인덱스(`jsonb_path_ops`)로 스택 검색 지원.

### 3.2 `tech_logs` — 개발일지

`milestone_progress_logs`(034·042) 패턴을 그대로 따른다. **소프트 삭제 + 관리자 복구** 포함.

```sql
CREATE TABLE IF NOT EXISTS tech_logs (
  id           VARCHAR(60) PRIMARY KEY,
  tenant_id    UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES tenants(id),
  tech_id      VARCHAR(100) NOT NULL REFERENCES tech_assets(id) ON DELETE CASCADE,
  log_date     VARCHAR(10),                  -- 일지 날짜 (YYYY-MM-DD)
  kind         VARCHAR(20) DEFAULT 'dev',    -- dev|test|issue|doc|review|idea
  author_id    UUID REFERENCES users(id),
  author_name  TEXT,
  progress     INT DEFAULT 0,                -- 이 시점 진척률 0~100
  hours        NUMERIC(10,1) DEFAULT 0,      -- 투입시간
  content      TEXT,                         -- 일지 본문 (wmRichNote 경량 서식)
  deleted_at   TIMESTAMPTZ,
  deleted_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT now()
);
```

작성/수정 시 `tech_assets.progress`·`total_hours`를 재동기화(`_resyncTech`) — 마일스톤의 `_resyncMilestoneProgress`와 동일한 방식.

### 3.3 `tech_usages` — 적용 이력

어느 프로젝트/사전검토에 이 기술이 쓰였는지. **재사용률과 "보유기술 판단 근거"의 핵심.**

```sql
CREATE TABLE IF NOT EXISTS tech_usages (
  id          VARCHAR(100) PRIMARY KEY,
  tenant_id   UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES tenants(id),
  tech_id     VARCHAR(100) NOT NULL REFERENCES tech_assets(id) ON DELETE CASCADE,
  target_type VARCHAR(20) NOT NULL,          -- 'project' | 'prestudy'
  target_id   VARCHAR(100) NOT NULL,
  note        TEXT,                          -- 적용 방식·커스터마이즈 내용
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tech_usage ON tech_usages (tech_id, target_type, target_id);
```

### 3.4 기술스택 표현 (`stack` JSONB)

```json
[
  { "kind": "language",  "name": "Python",  "version": "3.11" },
  { "kind": "library",   "name": "OpenCV",  "version": "4.9" },
  { "kind": "library",   "name": "Halcon",  "version": "22.11" },
  { "kind": "framework", "name": "PyQt",    "version": "5" },
  { "kind": "hw",        "name": "Basler acA2500", "version": "" },
  { "kind": "tool",      "name": "Docker",  "version": "" }
]
```

`kind`: `language | framework | library | hw | tool | protocol | etc`

> **왜 정규화 테이블이 아니라 JSONB인가** — 스택 항목은 자유도가 높고(장비·프로토콜까지),
> 집계는 `jsonb_array_elements`로 충분하다. 앱의 기존 `specs`·`items` JSONB 패턴과도 일치.
> 스택 이름 표기 흔들림(OpenCV/opencv)은 등록 시 **자동완성**(기존 값 제안)으로 억제한다.

---

## 4. 기능

### 4.1 화면 구성

프로젝트 관리의 **신규 모드** `setMode('tech')` — 「🧪 요소기술」 (사전검토·수주·이슈와 동급).

| 보기 | 내용 |
|------|------|
| **카탈로그**(기본) | 카드 그리드. 기술명·분류·상태·TRL·담당·스택 배지·최근 일지일 |
| **분류별** | vision/motion/control/sw/ai/comm/mech 별 묶음 |
| **기술스택** | 스택 항목별 집계 — "OpenCV 8건, Halcon 3건…" + 버전 분포, 클릭 시 해당 기술 목록 |
| **목록** | 표 형태 (정렬·전체 스캔용) |

필터: 검색(기술명·설명·스택) · 분류 · 상태 · 내 담당.

### 4.2 상태 & 기술성숙도(TRL)

```
🔬 연구(research) → 🛠 개발(developing) → 🧪 검증(verifying) → ✅ 사용가능(available) → ⚠️ 폐기예정(deprecated)
```

TRL은 1~9 단순 척도로 두되, UI에는 3구간으로 요약 표시한다.

| TRL | 의미 | 표시 |
|-----|------|------|
| 1–3 | 개념·원리 검증 | 🔴 초기 |
| 4–6 | 랩/유사환경 검증 | 🟡 검증중 |
| 7–9 | 실환경 검증·양산 적용 | 🟢 실전 |

> `status`는 **작업 진행 상태**, `trl`은 **기술 신뢰 수준**이라 서로 다르다.
> 예) status=available + TRL 6 = "쓸 수는 있으나 실환경 검증은 미흡".

### 4.3 상세 화면 (모달)

1. **개요** — 코드·분류·상태·TRL·버전·담당·참여자·링크(repo/doc)
2. **기술스택** — 항목 추가/삭제(kind·name·version), 기존 값 자동완성
3. **개발일지** — 시간순 타임라인. 작성(날짜·유형·진척률·투입시간·본문), `wmRichNote` 서식(체크박스·굵게), 소프트 삭제 + 관리자 복구
4. **적용 이력** — 연결된 프로젝트/사전검토 목록 + 추가
5. **코멘트** — `comments` 모듈 재사용 (`target_type='tech'`)

### 4.4 사전검토·프로젝트 연동 (이 모듈의 핵심 가치)

- **사전검토 상세**에 「관련 요소기술」 섹션 → 검토 중 보유기술을 바로 확인/연결.
  `category='tech'`(기술검토) 건에서 특히 유용 — *"이거 우리 TECH-VIS-001로 됨"* 판단이 기록으로 남는다.
- **프로젝트 상세**에 「적용 기술」 표시 → 역방향으로 "이 기술이 쓰인 프로젝트" 조회.
- 사전검토가 프로젝트로 전환될 때, 연결된 요소기술 usage도 **함께 이관**.

### 4.5 업무시간 귀속

- 개발일지의 `hours`로 기술별 투입시간을 집계한다(1차).
- 업무일지(`work_records`)는 분장 `D(개발)`로 이미 기록되므로, **2차**로 `work_records`에
  선택적 `tech_id` 태그를 추가해 교차 검증하는 방안을 검토한다(스키마 변경 필요 → 별도 단계).

---

## 5. API (`server/routes/tech.js`)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/tech?category=&status=&stack=&mine=&q=` | 목록 |
| GET | `/api/tech/stacks` | 기술스택 집계(항목·버전별 건수) |
| GET | `/api/tech/members` | 담당/참여자 선택용 (사전검토 패턴 재사용) |
| GET/POST/PUT/DELETE | `/api/tech[/:id]` | 상세·등록·수정·소프트삭제 |
| GET/POST | `/api/tech/:id/logs` | 개발일지 목록·작성 (작성 시 진척률·시간 재동기화) |
| PUT/DELETE | `/api/tech/:id/logs/:logId` | 일지 수정·소프트삭제 |
| GET/POST | `/api/tech/:id/logs/trash`, `/restore` | 휴지통·복구 (관리자) |
| GET/POST/DELETE | `/api/tech/:id/usages[/:usageId]` | 적용 이력 |

권한: 조회는 테넌트 구성원 공유(조직 자산). 수정은 **담당자·참여자·관리자**.
삭제(소프트)는 담당자·관리자, 완전삭제·복구는 관리자.

---

## 6. 텔레그램 연동

| 명령어 | 기능 |
|--------|------|
| `/tech` | 사용가능(available) 기술 카탈로그 요약 |
| `/tech <키워드>` | 기술명·스택 검색 — *"opencv 쓰는 기술 뭐 있지?"* |
| `/techlog <기술명>` | 최근 개발일지 |
| `/mytech` | 내가 담당인 기술 + 진척률 |

| 알림 | 트리거 | 수신 |
|------|--------|------|
| `tech_log_added` | 개발일지 작성 | 담당자·참여자(작성자 제외) |
| `tech_status_changed` | 상태/TRL 변경 | 담당자 + 관리자 |
| `tech_assigned` | 기술 담당 배정 | 담당자 |

기존 `pmext.js` 명령 모듈과 `notification.service.js` 템플릿·설정 UI 패턴을 그대로 따른다.

---

## 7. 단계별 로드맵

### Phase 1 — 카탈로그 + 개발일지 (핵심)
- [ ] `tech_assets` · `tech_logs` 마이그레이션
- [ ] `routes/tech.js` CRUD + 일지 API + 진척률/시간 재동기화
- [ ] `tech.js` 프론트 — 카탈로그/분류별/목록 보기 + 상세 모달(개요·스택·개발일지)
- [ ] 모드 탭 「🧪 요소기술」 등록 (`setMode('tech')`)

### Phase 2 — 스택 추적 + 연동
- [ ] `tech_usages` 마이그레이션 + 적용 이력 UI
- [ ] 기술스택 보기(집계·버전 분포·자동완성)
- [ ] 사전검토 상세 「관련 요소기술」 연결
- [ ] 프로젝트 상세 「적용 기술」 표시
- [ ] 코멘트 스레드(`target_type='tech'`)

### Phase 3 — 텔레그램 + 자동화
- [ ] `/tech` `/techlog` `/mytech` 명령어
- [ ] `tech_log_added` · `tech_status_changed` · `tech_assigned` 알림 + 설정 UI
- [ ] 일지 미작성 기술 리마인더(예: 진행중인데 30일 이상 일지 없음)
- [ ] 주간 다이제스트에 요소기술 진척 포함

---

## 8. 기술 고려사항

| 항목 | 대응 |
|------|------|
| 스택 이름 표기 흔들림 | 등록 시 기존 값 자동완성 + 집계는 소문자 정규화 기준 |
| 진척률 denormalize 정합성 | 일지 작성·수정·삭제·복구 모든 경로에서 `_resyncTech` 호출(마일스톤 패턴) |
| 권한 | 조회는 테넌트 공유(조직 자산), 수정은 담당·참여·관리자 |
| 마이그레이션 | `;` 분리 안전한 순수 DDL만 사용 (dollar-quote·블록주석 금지 — 러너 제약) |
| 프로젝트 삭제 시 usage | `tech_usages`는 target_id를 FK 없이 보관하고, 조회 시 LEFT JOIN으로 소실 대상 표시 |
| 기술 폐기(deprecated) | 카탈로그에서 흐리게 표시하되 이력·적용기록은 보존 |

---

## 9. 성공 지표

| 지표 | 목표 |
|------|------|
| 등록 요소기술 수 | 1분기 내 20건+ |
| 기술당 평균 개발일지 | 월 2건+ |
| 사전검토–요소기술 연결률 | 기술검토 건의 60%+ |
| 기술당 평균 적용 프로젝트 | 1.5건+ (재사용 발생) |
| 스택 EOL 대응 | 분기별 점검 대상 자동 식별 |
