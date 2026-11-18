-- v13.525 📨 업무 요청 — 프로젝트 · 내 할 일 · 일정에서 사람에게 보내는 업무 지시 · 이관 · 전달 · 일정 · 할 일
--   보내면 받는 사람과의 1:1 메신저 방에 카드(chat_messages.wreq). 받는 사람이 수락하면 그 사람 할 일(my_todos) 또는 일정(events)이 생기고,
--   그 할 일을 끝내면 요청도 '완료' — 보낸 사람이 끝까지 볼 수 있게
CREATE TABLE IF NOT EXISTS work_requests (
  id           VARCHAR(40) PRIMARY KEY,
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         VARCHAR(12) NOT NULL,              -- order 지시 · transfer 이관 · forward 전달 · event 일정 · todo 할 일
  title        VARCHAR(300) NOT NULL,
  body         TEXT,
  due_date     VARCHAR(10),
  due_time     VARCHAR(5),
  end_time     VARCHAR(5),
  location     VARCHAR(255),
  project_id   VARCHAR(100),
  project_name VARCHAR(300),
  src_key      VARCHAR(120),                      -- 보낸 쪽 원래 항목 (예 'todo:<id>') — 이관 수락 때 닫음
  status       VARCHAR(10) NOT NULL DEFAULT 'sent', -- sent · accepted · declined · done · canceled
  reply        TEXT,
  result_key   VARCHAR(120),                      -- 받은 쪽에 생긴 것 ('todo:<id>' · 'event:<id>')
  chat_msg_id  BIGINT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  done_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_wreq_to ON work_requests (tenant_id, to_user_id, status);
CREATE INDEX IF NOT EXISTS idx_wreq_from ON work_requests (tenant_id, from_user_id, status);
CREATE INDEX IF NOT EXISTS idx_wreq_result ON work_requests (tenant_id, result_key);
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS wreq JSONB;
