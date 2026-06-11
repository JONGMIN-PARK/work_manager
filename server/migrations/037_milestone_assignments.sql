-- 037_milestone_assignments.sql
-- 마일스톤 단위 "담당 배정(assignment)" — 변경(교체)/대체(임시)/원복 지원.
-- 사람은 user_id(UUID)로 묶어 이관에 안전. 기존 assignee_targets(이름맵)는 표시·레거시 폴백으로 유지.
-- 세 유형 매핑:
--   정/부      : role = 'primary' | 'deputy', 기간 NULL(상시)
--   임시 대체  : role='deputy' + valid_from~valid_until + covers_user_id(누구를 대신)
--   교체(영구) : 구 배정 released_at 처리(이력 보존) + 신규 primary 생성
-- "오늘 유효" = released_at IS NULL AND (valid_from IS NULL OR valid_from<=CURRENT_DATE)
--                AND (valid_until IS NULL OR valid_until>=CURRENT_DATE)

CREATE TABLE IF NOT EXISTS milestone_assignments (
  id             VARCHAR(60) PRIMARY KEY,
  tenant_id      UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES tenants(id),
  milestone_id   VARCHAR(100) NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
  project_id     VARCHAR(100),
  user_id        UUID NOT NULL REFERENCES users(id),
  role           VARCHAR(16) NOT NULL DEFAULT 'primary',  -- 'primary'(정) | 'deputy'(부)
  target_hours   NUMERIC(7,2),                            -- 마일스톤 목표시간(assignee_targets 대체)
  valid_from     VARCHAR(10),                             -- 임시대체 시작 'YYYY-MM-DD'(NULL=상시). start_date 와 동일 텍스트 포맷
  valid_until    VARCHAR(10),                             -- 임시대체 종료 'YYYY-MM-DD'(NULL=상시)
  covers_user_id UUID REFERENCES users(id),               -- 임시대체: 누구를 대신하나
  released_at    TIMESTAMPTZ,                             -- 교체: 소프트 해제(이력 보존)
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ms_assign_ms ON milestone_assignments(milestone_id);
CREATE INDEX IF NOT EXISTS idx_ms_assign_user ON milestone_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_ms_assign_tenant ON milestone_assignments(tenant_id);

-- project_members 확장 — 프로젝트 스코프 정/부·임시대체(후속 단계). 기존 컬럼·권한 코드는 무수정.
ALTER TABLE project_members ADD COLUMN IF NOT EXISTS valid_from VARCHAR(10);
ALTER TABLE project_members ADD COLUMN IF NOT EXISTS valid_until VARCHAR(10);
ALTER TABLE project_members ADD COLUMN IF NOT EXISTS covers_user_id UUID;
