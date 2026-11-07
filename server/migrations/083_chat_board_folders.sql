-- v13.358 메신저 게시판 · 내 폴더
--   chat_messages.post = 게시글 { title, cat: notice|data|qna|req, status, equip, urgency, assignee, due, history[] } — 댓글은 답글 줄기(reply_to)
--   chat_folders / chat_saved = 사람마다 메시지 · 사진 · 파일 · 글을 폴더에 모아 둠 (방에서 나가면 안 보임)
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS post JSONB;
CREATE INDEX IF NOT EXISTS idx_chat_msg_post ON chat_messages(room_id, id DESC) WHERE post IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_msg_post_asg ON chat_messages((post->>'assignee')) WHERE post IS NOT NULL;

CREATE TABLE IF NOT EXISTS chat_folders (
  id          VARCHAR(40) PRIMARY KEY,
  tenant_id   UUID NOT NULL,
  user_id     UUID NOT NULL,
  name        VARCHAR(80) NOT NULL,
  icon        VARCHAR(16),
  sort        INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_folders_user ON chat_folders(tenant_id, user_id);

CREATE TABLE IF NOT EXISTS chat_saved (
  folder_id   VARCHAR(40) NOT NULL REFERENCES chat_folders(id) ON DELETE CASCADE,
  msg_id      BIGINT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  tenant_id   UUID NOT NULL,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (folder_id, msg_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_saved_user ON chat_saved(user_id, msg_id);
