-- 061_mindmap_files.sql
-- 마인드맵 주제 첨부 파일 — v13.244
-- 파일은 DB(bytea)에 둔다(파일당 5MB, 맵당 100개). 주제 id(node_id)로 묶고 문서(doc)와는 따로 — 되돌리기 · 버전 기록과 무관.
-- 주제를 지워도 남김(중심 주제 패널에 "지워진 주제의 첨부"로). 맵 행이 지워지면 함께 삭제.

CREATE TABLE IF NOT EXISTS mindmap_files (
  id          VARCHAR(60) PRIMARY KEY,
  map_id      VARCHAR(100) NOT NULL REFERENCES mindmaps(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL,
  node_id     VARCHAR(100) NOT NULL,
  name        VARCHAR(255) NOT NULL,
  mime        VARCHAR(120),
  size        INT NOT NULL DEFAULT 0,
  data        BYTEA NOT NULL,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mindmap_files_map ON mindmap_files (map_id, created_at);
