-- 077_chat.sql (v13.315) 💬 사내 메신저 — 방 · 멤버 · 메시지 · 파일
--  kind: dm(1:1, dm_key = 두 사용자 id 정렬) · group(이름 있는 방) · project(프로젝트 방, project_id)
--  메시지 kind: text · system · file / cards = 붙인 업무 카드 [{type,id,title,sub,nav}] / mentions = [user_id]
--  reply_to = 스레드(답글 줄기)의 첫 메시지
--  읽음은 멤버마다 last_read_id (그 번호까지 읽음)
--  파일은 GCS 가 켜져 있으면 storage_key, 아니면 data(bytea) — 어느 쪽이든 같은 길로 받음
--  예전 1:1 쪽지(messages)는 한 번만 dm 방으로 옮겨 옴 (chat_migrated 표시)
-- 매 기동 시 다시 돌아도 되게(멱등) 작성.
BEGIN;

CREATE TABLE IF NOT EXISTS chat_rooms (
  id            VARCHAR(40) PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  kind          VARCHAR(10) NOT NULL CHECK (kind IN ('dm', 'group', 'project')),
  name          VARCHAR(120),
  dm_key        VARCHAR(80),
  project_id    VARCHAR(100),
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_msg_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at   TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_dm ON chat_rooms(tenant_id, dm_key) WHERE dm_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_project ON chat_rooms(tenant_id, project_id) WHERE project_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS chat_members (
  room_id       VARCHAR(40) NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL,
  tenant_id     UUID NOT NULL,
  role          VARCHAR(10) NOT NULL DEFAULT 'member',
  last_read_id  BIGINT NOT NULL DEFAULT 0,
  muted         BOOLEAN NOT NULL DEFAULT FALSE,
  pinned        BOOLEAN NOT NULL DEFAULT FALSE,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at       TIMESTAMPTZ,
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(tenant_id, user_id) WHERE left_at IS NULL;

CREATE TABLE IF NOT EXISTS chat_messages (
  id            BIGSERIAL PRIMARY KEY,
  room_id       VARCHAR(40) NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL,
  user_id       UUID,
  kind          VARCHAR(10) NOT NULL DEFAULT 'text',
  body          TEXT NOT NULL DEFAULT '',
  cards         JSONB,
  file_id       VARCHAR(40),
  mentions      JSONB,
  reply_to      BIGINT,
  legacy_id     VARCHAR(60),
  edited_at     TIMESTAMPTZ,
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_msg_room ON chat_messages(room_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_chat_msg_reply ON chat_messages(reply_to) WHERE reply_to IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_msg_legacy ON chat_messages(legacy_id) WHERE legacy_id IS NOT NULL;
-- 공감(이모지) { "👍": [user_id…] } · 방 공지(고정 메시지)
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS reactions JSONB;
ALTER TABLE chat_rooms ADD COLUMN IF NOT EXISTS notice_id BIGINT;

CREATE TABLE IF NOT EXISTS chat_files (
  id            VARCHAR(40) PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  room_id       VARCHAR(40) NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id       UUID,
  name          VARCHAR(255) NOT NULL,
  mime          VARCHAR(120),
  size          INTEGER NOT NULL DEFAULT 0,
  storage_key   VARCHAR(300),
  data          BYTEA,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_files_room ON chat_files(room_id, created_at DESC);

-- 예전 1:1 쪽지 → dm 방 (한 번만 · legacy_id 로 중복 방지)
INSERT INTO chat_rooms (id, tenant_id, kind, dm_key, created_at, last_msg_at)
SELECT 'dm-' || substr(md5(p.tenant_id::text || p.k), 1, 20), p.tenant_id, 'dm', p.k, p.first_at, p.last_at
FROM (
  SELECT tenant_id, LEAST(from_user_id::text, to_user_id::text) || ':' || GREATEST(from_user_id::text, to_user_id::text) AS k,
         MIN(created_at) AS first_at, MAX(created_at) AS last_at
  FROM messages GROUP BY 1, 2
) p
ON CONFLICT DO NOTHING;

INSERT INTO chat_members (room_id, user_id, tenant_id, last_read_id)
SELECT r.id, u.uid::uuid, r.tenant_id, 0
FROM chat_rooms r, LATERAL (SELECT split_part(r.dm_key, ':', 1) AS uid UNION SELECT split_part(r.dm_key, ':', 2)) u
WHERE r.kind = 'dm' AND r.dm_key IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO chat_messages (room_id, tenant_id, user_id, kind, body, legacy_id, created_at)
SELECT r.id, m.tenant_id, m.from_user_id, 'text', m.body, m.id, m.created_at
FROM messages m
JOIN chat_rooms r ON r.tenant_id = m.tenant_id AND r.dm_key = LEAST(m.from_user_id::text, m.to_user_id::text) || ':' || GREATEST(m.from_user_id::text, m.to_user_id::text)
ON CONFLICT DO NOTHING;

-- 옮겨 온 쪽지 중 이미 읽은 것은 읽음으로 (받는 사람의 last_read_id)
UPDATE chat_members cm SET last_read_id = s.mx
FROM (
  SELECT cmsg.room_id, m.to_user_id AS uid, MAX(cmsg.id) AS mx
  FROM chat_messages cmsg JOIN messages m ON m.id = cmsg.legacy_id
  WHERE m.read_at IS NOT NULL GROUP BY 1, 2
) s
WHERE cm.room_id = s.room_id AND cm.user_id = s.uid AND cm.last_read_id < s.mx;
-- 보낸 사람은 자기 메시지를 읽은 것으로
UPDATE chat_members cm SET last_read_id = s.mx
FROM (SELECT room_id, user_id AS uid, MAX(id) AS mx FROM chat_messages WHERE legacy_id IS NOT NULL GROUP BY 1, 2) s
WHERE cm.room_id = s.room_id AND cm.user_id = s.uid AND cm.last_read_id < s.mx;

COMMIT;
