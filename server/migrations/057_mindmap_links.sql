-- 057_mindmap_links.sql
-- 마인드맵 참조 노드 역인덱스 — PRD_마인드맵 Phase 2
-- "이 프로젝트·이슈가 어떤 맵에 있나" 조회용. 맵 저장 시 doc 의 ref 에서 다시 계산(삭제 후 삽입).

CREATE TABLE IF NOT EXISTS mindmap_links (
  map_id     VARCHAR(100) NOT NULL REFERENCES mindmaps(id) ON DELETE CASCADE,
  tenant_id  UUID NOT NULL,
  node_id    VARCHAR(60) NOT NULL,
  link_type  VARCHAR(20) NOT NULL,
  link_id    VARCHAR(100) NOT NULL,
  PRIMARY KEY (map_id, node_id)
);

CREATE INDEX IF NOT EXISTS idx_mindmap_links_target ON mindmap_links (tenant_id, link_type, link_id);
