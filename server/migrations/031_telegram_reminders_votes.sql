-- ============================================================
-- 031_telegram_reminders_votes.sql
-- /remind, /vote 영속화 (P1)
-- - 기존 setTimeout 기반 리마인더는 프로세스 재시작 시 소실 → DB 영속화
-- - 기존 /vote는 클릭 echo만 + 집계 없음 → 응답 영속화 + 집계
-- ============================================================
BEGIN;

-- 리마인더 — fire_at 도래 시 발송 워커가 처리
CREATE TABLE IF NOT EXISTS telegram_reminders (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  chat_id      BIGINT NOT NULL,
  message      TEXT NOT NULL,
  fire_at      TIMESTAMPTZ NOT NULL,
  sent_at      TIMESTAMPTZ,
  status       VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending | sent | failed | cancelled
  error_detail TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 워커가 pending + fire_at <= NOW() 빠르게 찾도록
CREATE INDEX IF NOT EXISTS idx_tg_reminders_due
  ON telegram_reminders(status, fire_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_tg_reminders_chat
  ON telegram_reminders(chat_id, fire_at DESC);
CREATE INDEX IF NOT EXISTS idx_tg_reminders_tenant
  ON telegram_reminders(tenant_id);

-- 투표 — 질문/옵션은 JSONB 배열
CREATE TABLE IF NOT EXISTS telegram_votes (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    UUID REFERENCES tenants(id) ON DELETE CASCADE,
  chat_id      BIGINT NOT NULL,
  message_id   BIGINT,                       -- 텔레그램 메시지 ID (집계 업데이트용)
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  question     TEXT NOT NULL,
  options      JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_closed    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tg_votes_chat ON telegram_votes(chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tg_votes_tenant ON telegram_votes(tenant_id);

-- 투표 응답 — 사용자 1인 1표(같은 vote 안에서 갱신)
CREATE TABLE IF NOT EXISTS telegram_vote_responses (
  id           BIGSERIAL PRIMARY KEY,
  vote_id      BIGINT NOT NULL REFERENCES telegram_votes(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  user_name    VARCHAR(100),
  option_index INT NOT NULL,
  voted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(vote_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_tg_vote_resp_vote ON telegram_vote_responses(vote_id);

COMMIT;
