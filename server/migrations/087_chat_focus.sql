-- v13.363 🎯 메신저 집중 모드 — 정한 때까지 메신저 알림(푸시 · 텔레그램 대신 알림)을 미룸. @멘션 · 나에게 온 긴급 요청은 받을지 고름
CREATE TABLE IF NOT EXISTS chat_user_state (
  user_id      UUID PRIMARY KEY,
  tenant_id    UUID,
  focus_until  TIMESTAMPTZ,
  focus_allow  BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
