-- v13.535 👥 그룹(TFT) — 고정된 사람 묶음. 업무 보내기 · 함께 하기 · 같이 담당에서 이름 하나로 전원, 그룹 전용 대화방
CREATE TABLE IF NOT EXISTS work_groups (
  id          VARCHAR(40) PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  icon        VARCHAR(16),
  purpose     TEXT,
  owner_id    UUID NOT NULL,
  members     UUID[] NOT NULL,
  project_id  VARCHAR(100),
  room_id     VARCHAR(60),
  archived_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_work_groups_members ON work_groups USING GIN (members);
CREATE INDEX IF NOT EXISTS idx_work_groups_tenant ON work_groups (tenant_id, archived_at);
