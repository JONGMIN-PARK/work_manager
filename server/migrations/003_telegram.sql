-- 텔레그램 연동 테이블
-- 사용자-텔레그램 계정 연결
CREATE TABLE IF NOT EXISTS telegram_links (
  id          SERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id     BIGINT NOT NULL UNIQUE,
  username    VARCHAR(100),
  linked_at   TIMESTAMPTZ DEFAULT NOW(),
  is_active   BOOLEAN DEFAULT TRUE,
  UNIQUE(user_id)
);

-- 알림 설정 (이벤트별 수신 토글)
CREATE TABLE IF NOT EXISTS notification_prefs (
  id          SERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel     VARCHAR(20) DEFAULT 'telegram',
  event_type  VARCHAR(50) NOT NULL,
  is_enabled  BOOLEAN DEFAULT TRUE,
  UNIQUE(user_id, channel, event_type)
);

-- 알림 발송 로그
CREATE TABLE IF NOT EXISTS notification_logs (
  id          SERIAL PRIMARY KEY,
  user_id     UUID REFERENCES users(id),
  chat_id     BIGINT,
  event_type  VARCHAR(50),
  payload     JSONB,
  status      VARCHAR(20) DEFAULT 'sent',
  error_detail TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_noti_logs_user ON notification_logs(user_id, created_at DESC);

-- 텔레그램 인증 코드 (일회성, 5분 만료)
CREATE TABLE IF NOT EXISTS telegram_auth_codes (
  code        VARCHAR(8) PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id),
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN DEFAULT FALSE
);
