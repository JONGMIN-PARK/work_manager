-- v13.526 🖍 문서 칠판 — 문서 미리보기 · 발표 모드에서 쪽마다 그린 표시 · 글 · 붙인 그림
--   items: [{ id, k: pen|line|arrow|rect|ell|text|img, … }] 좌표는 쪽 너비 1000 기준 (창 크기가 달라도 같은 자리)
CREATE TABLE IF NOT EXISTS doc_annotations (
  file_id    VARCHAR(100) NOT NULL,
  page       INTEGER NOT NULL,
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  items      JSONB NOT NULL DEFAULT '[]'::jsonb,
  version    INTEGER NOT NULL DEFAULT 1,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (file_id, page)
);
CREATE INDEX IF NOT EXISTS idx_doc_annot_tenant ON doc_annotations (tenant_id, file_id);
