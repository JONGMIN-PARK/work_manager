-- 043_project_dev_items.sql
-- 프로젝트 개발 백로그 (칸반) — PRD_프로젝트관리_확장 모듈 C
-- 계획된 개발 작업. 이슈(사후 장애/CS)와 분리. 소프트 삭제(deleted_at) + 낙관적 락(version).

CREATE TABLE IF NOT EXISTS project_dev_items (
  id           VARCHAR(100) PRIMARY KEY,
  tenant_id    UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES tenants(id),
  project_id   VARCHAR(100) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  milestone_id VARCHAR(100) REFERENCES milestones(id) ON DELETE SET NULL,
  title        VARCHAR(500) NOT NULL,
  description  TEXT,
  category     VARCHAR(20) DEFAULT 'feature',
  status       VARCHAR(20) DEFAULT 'backlog',
  priority     VARCHAR(10) DEFAULT 'normal',
  assignee_id  UUID REFERENCES users(id),
  estimate_h   NUMERIC(10,1) DEFAULT 0,
  actual_h     NUMERIC(10,1) DEFAULT 0,
  sort_order   INT DEFAULT 0,
  deleted_at   TIMESTAMPTZ,
  deleted_by   UUID REFERENCES users(id),
  version      INT NOT NULL DEFAULT 1,
  created_by   UUID REFERENCES users(id),
  updated_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dev_items_board ON project_dev_items (tenant_id, project_id, status, sort_order) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_dev_items_assignee ON project_dev_items (tenant_id, assignee_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_dev_items_milestone ON project_dev_items (milestone_id) WHERE deleted_at IS NULL;
