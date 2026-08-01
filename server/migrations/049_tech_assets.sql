-- 049_tech_assets.sql
-- 요소기술(기반기술) 자산 + 개발일지 — PRD_요소기술_개발관리 Phase 1
-- 프로젝트에 종속되지 않는 조직 자산. project_dev_items(프로젝트 내 계획 작업)와 분리.
-- 개발일지는 milestone_progress_logs(034/042) 패턴을 따른다 — 진척률·투입시간·소프트삭제.

CREATE TABLE IF NOT EXISTS tech_assets (
  id           VARCHAR(100) PRIMARY KEY,
  tenant_id    UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES tenants(id),
  code         VARCHAR(40),
  name         VARCHAR(255) NOT NULL,
  category     VARCHAR(20) DEFAULT 'etc',
  summary      VARCHAR(500),
  description  TEXT,
  status       VARCHAR(20) DEFAULT 'research',
  trl          INT DEFAULT 1,
  tech_version VARCHAR(20),
  owner_id     UUID REFERENCES users(id),
  participants JSONB DEFAULT '[]',
  stack        JSONB DEFAULT '[]',
  tags         JSONB DEFAULT '[]',
  repo_url     TEXT,
  doc_url      TEXT,
  progress     INT DEFAULT 0,
  total_hours  NUMERIC(10,1) DEFAULT 0,
  deleted_at   TIMESTAMPTZ,
  deleted_by   UUID REFERENCES users(id),
  version      INT NOT NULL DEFAULT 1,
  created_by   UUID REFERENCES users(id),
  updated_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tech_status ON tech_assets (tenant_id, status) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tech_category ON tech_assets (tenant_id, category) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tech_owner ON tech_assets (tenant_id, owner_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tech_stack_gin ON tech_assets USING GIN (stack jsonb_path_ops);

CREATE TABLE IF NOT EXISTS tech_logs (
  id           VARCHAR(60) PRIMARY KEY,
  tenant_id    UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES tenants(id),
  tech_id      VARCHAR(100) NOT NULL REFERENCES tech_assets(id) ON DELETE CASCADE,
  log_date     VARCHAR(10),
  kind         VARCHAR(20) DEFAULT 'dev',
  author_id    UUID REFERENCES users(id),
  author_name  TEXT,
  progress     INT DEFAULT 0,
  hours        NUMERIC(10,1) DEFAULT 0,
  content      TEXT,
  deleted_at   TIMESTAMPTZ,
  deleted_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tech_logs ON tech_logs (tech_id, log_date DESC, created_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tech_logs_tenant ON tech_logs (tenant_id);
