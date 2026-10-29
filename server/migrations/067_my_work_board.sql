-- 067_my_work_board.sql (v13.268)
-- 내 업무 보드 — 칸(카테고리)을 사람마다 직접 · 휴지통

-- 개인 할 일 휴지통 — 지우면 deleted_at, 비우기 전까지 보관 (목록 · 알림 · 텔레그램에서는 빠짐)
ALTER TABLE my_todos ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_my_todos_trash ON my_todos (tenant_id, user_id) WHERE deleted_at IS NOT NULL;

-- 내 칸 — rule 1~4 는 중요 × 급함 자동 칸 (1 지금 하기 · 2 계획하기 · 3 빨리 끝내기 · 4 나중에), null 은 직접 넣는 칸
CREATE TABLE IF NOT EXISTS my_work_categories (
  id          VARCHAR(60) PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(40) NOT NULL,
  icon        VARCHAR(16),
  color       VARCHAR(16),
  rule        SMALLINT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_my_work_categories_user ON my_work_categories (tenant_id, user_id, sort_order);

-- 항목을 칸에 고정 (어느 출처든 — 원래 자리는 안 바꿈)
ALTER TABLE my_work_marks ADD COLUMN IF NOT EXISTS category_id VARCHAR(60);
