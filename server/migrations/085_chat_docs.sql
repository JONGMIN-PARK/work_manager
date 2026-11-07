-- v13.360 📝 방 공동 문서 — 방 사람 모두가 같이 고치는 글 (마크다운). 고칠 때마다 rev +1, 다르면 409 → 클라가 세 갈래 합치기
CREATE TABLE IF NOT EXISTS chat_docs (
  id          VARCHAR(40) PRIMARY KEY,
  tenant_id   UUID NOT NULL,
  room_id     VARCHAR(40) NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  title       VARCHAR(200) NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  rev         INT NOT NULL DEFAULT 1,
  created_by  UUID,
  updated_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_chat_docs_room ON chat_docs(room_id, updated_at DESC) WHERE deleted_at IS NULL;
-- 10분에 한 번 고치기 전 모습 (되돌리기용)
CREATE TABLE IF NOT EXISTS chat_doc_versions (
  id          BIGSERIAL PRIMARY KEY,
  doc_id      VARCHAR(40) NOT NULL REFERENCES chat_docs(id) ON DELETE CASCADE,
  rev         INT NOT NULL,
  title       VARCHAR(200),
  body        TEXT NOT NULL,
  by_user     UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_doc_versions ON chat_doc_versions(doc_id, id DESC);
