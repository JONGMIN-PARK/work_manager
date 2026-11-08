-- v13.380 🔑 키워드 알림 — 이 낱말이 나오면 알림 꺼 둔 방이라도 알림
ALTER TABLE chat_user_state ADD COLUMN IF NOT EXISTS keywords JSONB;
