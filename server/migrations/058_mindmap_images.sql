-- 058_mindmap_images.sql
-- 마인드맵 주제 안 이미지 줄 (node.blocks 의 { t: 'img', id }) — v13.220
-- 맵 문서(doc)는 1.5초마다 통째로 저장되므로 이미지는 따로 둔다. src 는 업로드 때 클라에서 줄인 data URI.
-- (map_id, id) 키 — 맵을 복제하면 같은 id 로 행을 복사해 문서를 그대로 쓸 수 있게.
-- 문서에서 빠진 이미지는 unref_at 을 찍고, 7일 동안 다시 쓰이지 않으면 저장 때 지운다(되돌리기 대비).

CREATE TABLE IF NOT EXISTS mindmap_images (
  map_id      VARCHAR(100) NOT NULL REFERENCES mindmaps(id) ON DELETE CASCADE,
  id          VARCHAR(60) NOT NULL,
  tenant_id   UUID NOT NULL,
  src         TEXT NOT NULL,
  w           INT,
  h           INT,
  bytes       INT,
  unref_at    TIMESTAMPTZ,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (map_id, id)
);

CREATE INDEX IF NOT EXISTS idx_mindmap_images_tenant ON mindmap_images (tenant_id);
