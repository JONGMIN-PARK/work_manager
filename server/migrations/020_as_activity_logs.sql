-- 020_as_activity_logs.sql
-- A/S 부서별 작업 이력 (PRD §5.3)
-- 한 작업당 1행. ticket / assignment 양쪽으로 참조.

CREATE TABLE IF NOT EXISTS as_activity_logs (
  id             VARCHAR(40) PRIMARY KEY,
  ticket_id      VARCHAR(40) NOT NULL REFERENCES as_tickets(id) ON DELETE CASCADE,
  assignment_id  VARCHAR(40) REFERENCES as_assignments(id) ON DELETE SET NULL,
  tenant_id      UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES tenants(id),
  seq            INT NOT NULL,                       -- ticket 내 순번 (1부터)
  worked_at      TIMESTAMPTZ NOT NULL,
  dept           TEXT NOT NULL,
  author_id      UUID REFERENCES users(id),
  author_name    TEXT,
  work_type      TEXT NOT NULL,                      -- 고객문의응대/원격분석/현장출장/...
  problem        TEXT,                               -- 문제현상/분석
  action_taken   TEXT NOT NULL,                      -- 조치내용
  duration_h     NUMERIC(6, 2) NOT NULL DEFAULT 0,   -- 소요시간 (시간 단위)
  status         TEXT NOT NULL DEFAULT 'in_progress',-- 진행중/완료/대기(부품)/대기(고객확인)/이관/보류/취소
  followup       TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by     UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_as_logs_ticket
  ON as_activity_logs(ticket_id, seq);

CREATE INDEX IF NOT EXISTS idx_as_logs_assignment
  ON as_activity_logs(assignment_id) WHERE assignment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_as_logs_tenant_dept
  ON as_activity_logs(tenant_id, dept, worked_at DESC);

-- assignment의 duration_h 자동 집계 트리거
-- (assignment_id가 있는 로그의 duration_h 합을 as_assignments.duration_h에 반영)
CREATE OR REPLACE FUNCTION as_logs_update_assignment_duration() RETURNS TRIGGER AS $$
DECLARE
  v_assignment_id VARCHAR(40);
BEGIN
  v_assignment_id := COALESCE(NEW.assignment_id, OLD.assignment_id);
  IF v_assignment_id IS NOT NULL THEN
    UPDATE as_assignments
       SET duration_h = COALESCE((
             SELECT SUM(duration_h)::NUMERIC(8,2)
             FROM as_activity_logs
             WHERE assignment_id = v_assignment_id
           ), 0),
           updated_at = NOW()
     WHERE id = v_assignment_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_as_logs_dur ON as_activity_logs;
CREATE TRIGGER trg_as_logs_dur
  AFTER INSERT OR UPDATE OR DELETE ON as_activity_logs
  FOR EACH ROW EXECUTE FUNCTION as_logs_update_assignment_duration();
