-- v13.381 🗳 투표 · 📅 약속 잡기 · ✔ 확인 요청
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS poll JSONB;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS ack JSONB;
CREATE INDEX IF NOT EXISTS idx_chat_msg_ack ON chat_messages(created_at) WHERE ack IS NOT NULL;
