-- 056_mindmaps.sql
-- 마인드맵 — PRD_마인드맵 Phase 1
-- 맵 1행 + 노드 트리 JSONB 문서(doc). 편집은 edit_locks(resourceType='mindmap') + 낙관적 락(version).
-- 사용 권한: admin 기본 + user_settings 'mindmap_access'.enabled 부여 사용자 (middleware/mindmap-access.js)

CREATE TABLE IF NOT EXISTS mindmaps (
  id            VARCHAR(100) PRIMARY KEY,
  tenant_id     UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES tenants(id),
  title         VARCHAR(255) NOT NULL,
  scope         VARCHAR(20) NOT NULL DEFAULT 'personal',
  owner_id      UUID REFERENCES users(id),
  project_id    VARCHAR(100),
  department_id UUID,
  editors       JSONB DEFAULT '[]',
  viewers       JSONB DEFAULT '[]',
  theme         VARCHAR(20) DEFAULT 'default',
  template      VARCHAR(30),
  doc           JSONB NOT NULL DEFAULT '{}',
  node_count    INT DEFAULT 0,
  pinned_by     JSONB DEFAULT '[]',
  deleted_at    TIMESTAMPTZ,
  deleted_by    UUID REFERENCES users(id),
  version       INT NOT NULL DEFAULT 1,
  created_by    UUID REFERENCES users(id),
  updated_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mindmaps_owner ON mindmaps (tenant_id, owner_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_mindmaps_project ON mindmaps (tenant_id, project_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_mindmaps_scope ON mindmaps (tenant_id, scope, updated_at DESC) WHERE deleted_at IS NULL;
