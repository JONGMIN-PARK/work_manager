-- 059_mindmap_snapshots.sql
-- 마인드맵 버전 기록 — v13.223
-- kind: manual(이름 붙여 저장) · auto(30분 넘게 쉬었다가 다시 저장할 때, 그 전까지 저장된 상태) · restore(되돌리기 직전 백업)
-- created_at 은 "이 상태가 저장된 시각"(auto 는 맵의 직전 updated_at). image_ids 는 문서가 쓰는 이미지 —
-- 맵에서 빠진 이미지라도 기록이 쓰고 있으면 지우지 않도록(routes/mindmaps.js syncImages).

CREATE TABLE IF NOT EXISTS mindmap_snapshots (
  id           VARCHAR(60) PRIMARY KEY,
  map_id       VARCHAR(100) NOT NULL REFERENCES mindmaps(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL,
  kind         VARCHAR(10) NOT NULL DEFAULT 'manual',
  label        VARCHAR(100),
  title        VARCHAR(255),
  doc          JSONB NOT NULL,
  node_count   INT DEFAULT 0,
  map_version  INT,
  image_ids    TEXT[] NOT NULL DEFAULT '{}',
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mindmap_snapshots_map ON mindmap_snapshots (map_id, created_at DESC);
