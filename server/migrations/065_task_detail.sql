-- 065_task_detail.sql (v13.253)
-- 내 업무 할 일 강화 · 종류별 등록
--   중요도 4단계: 1 긴급 · 2 높음 · 3 보통 · 4 낮음 (다른 출처는 원래 값에서 바꿔 읽고 쓴다 — lib/priority.js)
ALTER TABLE my_todos ADD COLUMN IF NOT EXISTS priority SMALLINT NOT NULL DEFAULT 3;
ALTER TABLE my_todos ADD COLUMN IF NOT EXISTS status VARCHAR(10) NOT NULL DEFAULT 'todo';   -- todo · doing · waiting (완료는 done_at)
ALTER TABLE my_todos ADD COLUMN IF NOT EXISTS waiting_for VARCHAR(100);
ALTER TABLE my_todos ADD COLUMN IF NOT EXISTS memo TEXT;
ALTER TABLE my_todos ADD COLUMN IF NOT EXISTS due_time VARCHAR(5);
ALTER TABLE my_todos ADD COLUMN IF NOT EXISTS repeat VARCHAR(10);                     -- daily · weekdays · weekly · monthly
ALTER TABLE my_todos ADD COLUMN IF NOT EXISTS estimate_h NUMERIC(5,1);
ALTER TABLE my_todos ADD COLUMN IF NOT EXISTS checklist JSONB NOT NULL DEFAULT '[]';  -- [{ id, t, d }]

-- 회의 액션아이템 중요도 (내 업무에서 바꾸면 회의 화면에도)
ALTER TABLE meeting_action_items ADD COLUMN IF NOT EXISTS priority SMALLINT;

-- 일정 장소 (회의 · 출장 · 외근)
ALTER TABLE events ADD COLUMN IF NOT EXISTS location VARCHAR(255);

-- 내 업무 표시 — 어느 출처든 '오늘 집중' · 직접 순서 (item_key = src:id)
CREATE TABLE IF NOT EXISTS my_work_marks (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_key    VARCHAR(200) NOT NULL,
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  focus_date  VARCHAR(10),
  sort_order  INTEGER,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, item_key)
);
