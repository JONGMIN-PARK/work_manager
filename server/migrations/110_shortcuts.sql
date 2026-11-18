-- v13.528 🔖 바로가기 — 어디서든 지금 화면(메뉴 › 파트 › 항목)을 저장해 내 업무에서 바로 이동
--   target: { page, mode, ctx: { k: project|note|map|room|doc|docview, id, pid? } } · 휴지통은 deleted_at
CREATE TABLE IF NOT EXISTS user_shortcuts (
  id         VARCHAR(40) PRIMARY KEY,
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      VARCHAR(200) NOT NULL,
  menu       VARCHAR(60),
  part       VARCHAR(60),
  item       VARCHAR(300),
  icon       VARCHAR(16),
  target     JSONB NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_shortcuts ON user_shortcuts (tenant_id, user_id, deleted_at, sort_order);
