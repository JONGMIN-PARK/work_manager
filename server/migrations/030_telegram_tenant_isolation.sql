-- ============================================================
-- 030_telegram_tenant_isolation.sql
-- 텔레그램 관련 테이블 멀티테넌트 격리(P0)
-- - telegram_links / telegram_auth_codes / telegram_group_links
--   / notification_prefs / notification_logs 에 tenant_id 추가
-- - /start 브루트포스 방어용 시도 로그 + 인증코드 attempts 카운터
-- ============================================================
BEGIN;

-- telegram_links: 사용자-챗 매핑
ALTER TABLE telegram_links
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE telegram_links tl
   SET tenant_id = u.tenant_id
  FROM users u
 WHERE u.id = tl.user_id AND tl.tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_telegram_links_tenant ON telegram_links(tenant_id);
CREATE INDEX IF NOT EXISTS idx_telegram_links_tenant_user ON telegram_links(tenant_id, user_id);

-- telegram_auth_codes: 일회용 인증 코드
ALTER TABLE telegram_auth_codes
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE telegram_auth_codes
  ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0;
UPDATE telegram_auth_codes ac
   SET tenant_id = u.tenant_id
  FROM users u
 WHERE u.id = ac.user_id AND ac.tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_telegram_auth_codes_tenant ON telegram_auth_codes(tenant_id);

-- telegram_group_links: 그룹 채팅 ↔ 자원 매핑
ALTER TABLE telegram_group_links
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE telegram_group_links gl
   SET tenant_id = u.tenant_id
  FROM users u
 WHERE u.id = gl.linked_by AND gl.tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_telegram_group_links_tenant ON telegram_group_links(tenant_id);
CREATE INDEX IF NOT EXISTS idx_telegram_group_links_tenant_link ON telegram_group_links(tenant_id, link_type, link_id);

-- notification_prefs: 알림 토글 (코드가 이미 tenant_id 가정 상태)
ALTER TABLE notification_prefs
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE notification_prefs np
   SET tenant_id = u.tenant_id
  FROM users u
 WHERE u.id = np.user_id AND np.tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_notification_prefs_tenant ON notification_prefs(tenant_id);

-- notification_logs: 발송 로그
ALTER TABLE notification_logs
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE notification_logs nl
   SET tenant_id = u.tenant_id
  FROM users u
 WHERE u.id = nl.user_id AND nl.tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_notification_logs_tenant ON notification_logs(tenant_id, created_at DESC);

-- /start 브루트포스 방어: 시도 로그
CREATE TABLE IF NOT EXISTS telegram_auth_attempts (
  id            BIGSERIAL PRIMARY KEY,
  chat_id       BIGINT NOT NULL,
  code_input    VARCHAR(20),
  success       BOOLEAN NOT NULL DEFAULT FALSE,
  attempted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tg_auth_attempts_chat
  ON telegram_auth_attempts(chat_id, attempted_at DESC);

COMMIT;
