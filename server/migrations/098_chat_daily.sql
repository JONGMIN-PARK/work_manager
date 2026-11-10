-- v13.424 ☀️ 아침 브리핑 받기 · 하루 한 번 표시(브리핑 · 내일 마감 소식)
ALTER TABLE chat_user_state ADD COLUMN IF NOT EXISTS brief_on BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS chat_daily (
  k          VARCHAR(160) PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
