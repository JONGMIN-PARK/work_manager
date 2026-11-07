-- v13.362 ⏰ 메신저 예약 보내기 · 다시 알림
--   타이머는 서버 메모리(lib/chat-timers.js) — 켤 때 한 번 + 한 시간에 한 번만 DB 를 봄 (1분마다 보지 않음: Neon 컴퓨트)
CREATE TABLE IF NOT EXISTS chat_scheduled (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL,
  room_id     VARCHAR(40) NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  body        TEXT NOT NULL,
  send_at     TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at     TIMESTAMPTZ,
  sent_msg_id BIGINT,
  canceled_at TIMESTAMPTZ,
  fail        VARCHAR(200)
);
CREATE INDEX IF NOT EXISTS idx_chat_sched_due ON chat_scheduled(send_at) WHERE sent_at IS NULL AND canceled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chat_sched_user ON chat_scheduled(user_id, room_id) WHERE sent_at IS NULL AND canceled_at IS NULL;

CREATE TABLE IF NOT EXISTS chat_reminders (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL,
  user_id     UUID NOT NULL,
  room_id     VARCHAR(40) NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  msg_id      BIGINT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  remind_at   TIMESTAMPTZ NOT NULL,
  note        VARCHAR(300),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_chat_remind_due ON chat_reminders(remind_at) WHERE done_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chat_remind_user ON chat_reminders(user_id) WHERE done_at IS NULL;
