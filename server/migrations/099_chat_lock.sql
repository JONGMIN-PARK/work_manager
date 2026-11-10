-- v13.426 🔒 채팅 잠금 — PIN 해시 · 자리 비움 자동 잠금(분, 0 = 끔)
ALTER TABLE chat_user_state ADD COLUMN IF NOT EXISTS lock_pin VARCHAR(120);
ALTER TABLE chat_user_state ADD COLUMN IF NOT EXISTS lock_auto INTEGER NOT NULL DEFAULT 0;
