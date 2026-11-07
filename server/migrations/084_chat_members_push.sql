-- v13.359 메신저 참여자 · 방 공유 폴더 · 휴대폰 푸시
--   chat_members.hist_from: 이 번호 '다음' 메시지부터 보임 (초대할 때 '이전 대화 안 보여 주기') · NULL 이면 처음부터
--   chat_members.role: owner(방장) · member · readonly(읽기만) — 컬럼은 077 에 있음
--   chat_folders.room_id: 있으면 그 방 사람 모두가 같이 쓰는 방 폴더
--   push_subs: 휴대폰 · 브라우저 Web Push 구독 · app_keys: VAPID 키(재시작해도 같은 키)
ALTER TABLE chat_members ADD COLUMN IF NOT EXISTS hist_from BIGINT;
ALTER TABLE chat_folders ADD COLUMN IF NOT EXISTS room_id VARCHAR(40) REFERENCES chat_rooms(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_chat_folders_room ON chat_folders(room_id) WHERE room_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS push_subs (
  endpoint    TEXT PRIMARY KEY,
  user_id     UUID NOT NULL,
  tenant_id   UUID,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  ua          VARCHAR(200),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_ok_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subs(user_id);

CREATE TABLE IF NOT EXISTS app_keys (
  name        VARCHAR(40) PRIMARY KEY,
  value       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
