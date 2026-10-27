-- 060_mindmap_comments.sql
-- 마인드맵 주제 댓글 — v13.237
-- node_id 는 맵 문서(doc) 안 주제 id. 주제를 지워도 댓글은 남김(화면에서 "지워진 주제의 댓글"로 모아 보임).
-- 맵을 지우면(행 삭제) 함께 지워짐. 읽기 권한이 있으면 쓸 수 있음(검토자 의견용).

CREATE TABLE IF NOT EXISTS mindmap_comments (
  id          VARCHAR(60) PRIMARY KEY,
  map_id      VARCHAR(100) NOT NULL REFERENCES mindmaps(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL,
  node_id     VARCHAR(100) NOT NULL,
  body        TEXT NOT NULL,
  resolved    BOOLEAN NOT NULL DEFAULT FALSE,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mindmap_comments_map ON mindmap_comments (map_id, created_at);
