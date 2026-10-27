-- 062_my_todos.sql
-- 내 업무 — 출처 없는 개인 할 일 (v13.248)
-- 다른 할 일(마인드맵 주제 · 이슈 · 회의 액션 · 사전검토 · 마일스톤 · 개발 작업)은 원래 테이블에서 모아 보여주고,
-- 어디에도 속하지 않는 메모성 할 일만 여기 둔다. 본인만 보고 고친다.

CREATE TABLE IF NOT EXISTS my_todos (
  id          VARCHAR(60) PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       VARCHAR(500) NOT NULL,
  due_date    VARCHAR(10),
  done_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_my_todos_user ON my_todos (tenant_id, user_id, done_at);

-- 회의 액션아이템 완료 시각 — '다 한 것(최근 7일)' 에 보이려고
ALTER TABLE meeting_action_items ADD COLUMN IF NOT EXISTS done_at TIMESTAMPTZ;
