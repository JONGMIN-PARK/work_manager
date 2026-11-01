-- 075_telegram_hub.sql (v13.301~305)
-- 텔레그램을 업무 창구로:
--  1) telegram_refs — 봇이 보낸 메시지 ↔ 업무 항목 연결 (답장 → 댓글 · 쪽지 · 대응 이력),
--     말로 등록 확인 대기(draft), 그룹방 연결 코드(grouplink)를 한 표에 둔다.
--  2) telegram_links 방해 금지 시간 (그 시간엔 소리 없이 도착)
--  3) telegram_group_links.tenant_id 가 없는 오래된 DB 대비
-- 매 기동 시 다시 돌아도 되게(멱등) 작성.
BEGIN;

CREATE TABLE IF NOT EXISTS telegram_refs (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   UUID,
  user_id     UUID,
  chat_id     BIGINT,
  message_id  BIGINT,
  kind        VARCHAR(20) NOT NULL,
  ref_id      VARCHAR(120),
  data        JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_telegram_refs_msg ON telegram_refs (chat_id, message_id);
CREATE INDEX IF NOT EXISTS idx_telegram_refs_kind ON telegram_refs (kind, ref_id);
CREATE INDEX IF NOT EXISTS idx_telegram_refs_created ON telegram_refs (created_at);

ALTER TABLE telegram_links ADD COLUMN IF NOT EXISTS quiet_start VARCHAR(5);
ALTER TABLE telegram_links ADD COLUMN IF NOT EXISTS quiet_end VARCHAR(5);

ALTER TABLE telegram_group_links ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE telegram_group_links ADD COLUMN IF NOT EXISTS title VARCHAR(200);

COMMIT;
