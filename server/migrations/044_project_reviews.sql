-- 044_project_reviews.sql
-- 프로젝트 검토 체크리스트 (간단형) — PRD_프로젝트관리_확장 모듈 A
-- 단계 전환/출하 전 확인 항목. 판정/전자서명 없이 체크·검토자 메모·결과 3단계(open/ok/issue).

CREATE TABLE IF NOT EXISTS project_reviews (
  id          VARCHAR(100) PRIMARY KEY,
  tenant_id   UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES tenants(id),
  project_id  VARCHAR(100) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase       VARCHAR(20),
  title       VARCHAR(255) NOT NULL,
  items       JSONB DEFAULT '[]',
  reviewer_id UUID REFERENCES users(id),
  note        TEXT,
  result      VARCHAR(20) DEFAULT 'open',
  deleted_at  TIMESTAMPTZ,
  deleted_by  UUID REFERENCES users(id),
  version     INT NOT NULL DEFAULT 1,
  created_by  UUID REFERENCES users(id),
  updated_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_reviews_proj ON project_reviews (tenant_id, project_id) WHERE deleted_at IS NULL;
