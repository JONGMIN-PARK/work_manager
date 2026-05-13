-- 019_as_assignments.sql
-- A/S 부서·담당자 할당 (PRD §5.2)
-- 한 ticket에 부서별로 0~N개 할당 (주관 1개 + 보조 N개)

CREATE TABLE IF NOT EXISTS as_assignments (
  id            VARCHAR(40) PRIMARY KEY,
  ticket_id     VARCHAR(40) NOT NULL REFERENCES as_tickets(id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES tenants(id),
  dept          TEXT NOT NULL,                       -- 부서 코드 (config.js DEPT)
  role          TEXT NOT NULL DEFAULT 'primary',     -- primary | support
  assignee_id   UUID REFERENCES users(id),
  assignee_name TEXT,                                -- 자유 입력 백업 (외부 인력 등)
  method        TEXT,                                -- 원격지원/출장/RMA/가이드제공/자료송부
  promised_at   TIMESTAMPTZ,                         -- 약속 방문일시
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  duration_h    NUMERIC(8, 2) NOT NULL DEFAULT 0,    -- activity_logs로부터 자동 집계
  status        TEXT NOT NULL DEFAULT 'pending',     -- pending|in_progress|completed|handover|hold
  result_note   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    UUID REFERENCES users(id),
  updated_by    UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_as_assignments_ticket
  ON as_assignments(ticket_id);

CREATE INDEX IF NOT EXISTS idx_as_assignments_assignee
  ON as_assignments(tenant_id, assignee_id, status);

CREATE INDEX IF NOT EXISTS idx_as_assignments_dept
  ON as_assignments(tenant_id, dept, status);

-- 한 ticket × dept × role 조합은 유니크 (주관 부서 중복 방지)
CREATE UNIQUE INDEX IF NOT EXISTS uq_as_assignments_primary
  ON as_assignments(ticket_id, dept) WHERE role = 'primary';
