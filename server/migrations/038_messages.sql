-- 038_messages.sql
-- 사용자 간 1:1 메시지(쪽지) — 별도 메뉴. 업무 인수인계 맥락 전달·개인 알림 채널.
-- context_type/context_id 로 마일스톤·프로젝트 등과 연결(선택).

CREATE TABLE IF NOT EXISTS messages (
  id           VARCHAR(60) PRIMARY KEY,
  tenant_id    UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES tenants(id),
  from_user_id UUID NOT NULL REFERENCES users(id),
  to_user_id   UUID NOT NULL REFERENCES users(id),
  body         TEXT NOT NULL,
  context_type VARCHAR(20),   -- 'milestone' | 'project' 등(선택)
  context_id   VARCHAR(100),
  read_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_msg_to_unread ON messages(tenant_id, to_user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_msg_pair ON messages(tenant_id, from_user_id, to_user_id, created_at);
