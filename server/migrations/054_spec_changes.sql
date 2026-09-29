-- 054_spec_changes.sql
-- 사양서 변경 이력 (v13.196) — 저장할 때마다 적용된 변경분(경로·라벨·이전 값·새 값)을 한 행으로 남긴다.
-- 제작 단계에서 "누가 언제 무엇을 바꿨는지" 확인하고, 최근 바뀐 칸을 화면에 표시하는 데 쓴다.
CREATE TABLE IF NOT EXISTS project_spec_changes (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  project_id      VARCHAR(100) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  changed_by      UUID,
  changed_by_name TEXT,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  kind            VARCHAR(20) NOT NULL DEFAULT 'edit',   -- edit | copy | template
  changes         JSONB NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_spec_changes_proj ON project_spec_changes(project_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_spec_changes_tenant ON project_spec_changes(tenant_id);
