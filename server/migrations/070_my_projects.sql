-- 070_my_projects.sql (v13.273)
-- 내 업무 📁 내 프로젝트 — 기간이 있는 일 묶음. 본인만 보고 고친다.
--   단독 = 여기서만 (기간 · 진행률 직접), 연계 = 프로젝트 관리의 프로젝트(link_project_id)를 따라감 (기간 · 진행률 · 마일스톤을 읽어 옴, 복사 안 함)
CREATE TABLE IF NOT EXISTS my_projects (
  id               VARCHAR(60) PRIMARY KEY,
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            VARCHAR(200) NOT NULL,
  start_date       VARCHAR(10),
  end_date         VARCHAR(10),
  status           VARCHAR(12) NOT NULL DEFAULT 'doing',   -- plan · doing · hold · done
  color            VARCHAR(16),
  icon             VARCHAR(16),
  memo             TEXT,
  progress         SMALLINT,                               -- null = 소속 항목으로 자동
  visible          BOOLEAN NOT NULL DEFAULT TRUE,          -- 타임라인 · 달력에 보이기
  sort_order       INTEGER NOT NULL DEFAULT 0,
  link_project_id  VARCHAR(100),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_my_projects_user ON my_projects (tenant_id, user_id, sort_order);
-- 같은 프로젝트 관리 프로젝트는 한 사람에게 한 번만 연결
CREATE UNIQUE INDEX IF NOT EXISTS uq_my_projects_link ON my_projects (user_id, link_project_id) WHERE link_project_id IS NOT NULL AND deleted_at IS NULL;

-- 항목을 내 프로젝트에 넣기 (어느 출처든 — 원래 자리는 안 바꿈). '-' = 연계 프로젝트에 자동으로 묶이는 것도 빼기
ALTER TABLE my_work_marks ADD COLUMN IF NOT EXISTS project_id VARCHAR(60);
