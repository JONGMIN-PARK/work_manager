-- v13.378 💬 링크 미리보기 · 프로필 사진 · 상태 메시지
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS link JSONB;
ALTER TABLE chat_user_state ADD COLUMN IF NOT EXISTS status_emoji VARCHAR(16);
ALTER TABLE chat_user_state ADD COLUMN IF NOT EXISTS status_text VARCHAR(60);
ALTER TABLE chat_user_state ADD COLUMN IF NOT EXISTS status_until TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS chat_avatars (
  user_id    UUID PRIMARY KEY,
  tenant_id  UUID NOT NULL,
  img        BYTEA NOT NULL,
  v          INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_avatars_tenant ON chat_avatars(tenant_id);
