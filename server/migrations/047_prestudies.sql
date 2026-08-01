-- 047_prestudies.sql
-- 사전검토 (Pre-study) — 프로젝트가 되기 "이전" 단계를 다루는 독립 모듈.
-- 업체 문의·기술 검토·개선 제안·아이디어를 등록해 브레인스토밍하고,
-- 확정되면 프로젝트/수주로 전환(linked_project_id / linked_order_no)하거나 보류·드롭한다.
-- 기존 프로젝트 하위 "검토"(project_reviews)는 046에서 폐기됨.

CREATE TABLE IF NOT EXISTS prestudies (
  id                VARCHAR(100) PRIMARY KEY,
  tenant_id         UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES tenants(id),
  title             VARCHAR(255) NOT NULL,
  client            VARCHAR(255),
  category          VARCHAR(20) DEFAULT 'inquiry',
  status            VARCHAR(20) DEFAULT 'idea',
  priority          VARCHAR(10) DEFAULT 'normal',
  owner_id          UUID REFERENCES users(id),
  participants      JSONB DEFAULT '[]',
  background        TEXT,
  notes             TEXT,
  conclusion        TEXT,
  due_date          VARCHAR(10),
  tags              JSONB DEFAULT '[]',
  linked_project_id VARCHAR(100),
  linked_order_no   VARCHAR(100),
  sort_order        INT DEFAULT 0,
  deleted_at        TIMESTAMPTZ,
  deleted_by        UUID REFERENCES users(id),
  version           INT NOT NULL DEFAULT 1,
  created_by        UUID REFERENCES users(id),
  updated_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prestudies_board ON prestudies (tenant_id, status, sort_order) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_prestudies_client ON prestudies (tenant_id, client) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_prestudies_owner ON prestudies (tenant_id, owner_id) WHERE deleted_at IS NULL;
