-- 034_milestone_progress.sql
-- 마일스톤 단위 "작업 노트 + 보고 진척률" 기능
-- 할당된 인원이 마일스톤별로 진척률과 작업 노트를 직접 업데이트 → 이력으로 남기고
-- 프로젝트 진척률(목표시간 가중평균)·투입실적에 반영.

-- 마일스톤 최신 보고 진척률 (denormalize: 빠른 조회·롤업용)
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS progress INT DEFAULT 0;
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS progress_note TEXT;
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS progress_updated_at TIMESTAMPTZ;
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS progress_updated_by TEXT; -- 작성자명

-- 작업 노트 + 진척률 이력 (한 건당 1행)
CREATE TABLE IF NOT EXISTS milestone_progress_logs (
  id           VARCHAR(60) PRIMARY KEY,
  milestone_id VARCHAR(100) NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
  project_id   VARCHAR(100),
  tenant_id    UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES tenants(id),
  author_id    UUID REFERENCES users(id),
  author_name  TEXT,
  progress     INT NOT NULL DEFAULT 0,   -- 이 시점 보고 진척률 (0~100)
  note         TEXT,                       -- 작업 노트 / 처리 결과
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ms_prog_logs ON milestone_progress_logs(milestone_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ms_prog_logs_tenant ON milestone_progress_logs(tenant_id);
