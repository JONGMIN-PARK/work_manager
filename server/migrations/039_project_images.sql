-- 039_project_images.sql
-- 프로젝트 참고 이미지(장비 사진 등) — 여러 장 등록, 한 장씩 열람(캐러셀), 타임라인 호버 프리뷰용.
-- 목록/부트스트라프 응답 비대화 방지를 위해 projects 와 분리한 별도 테이블에 저장.
-- src 는 data URI(업로드 시 클라에서 다운스케일) 또는 외부 URL.

CREATE TABLE IF NOT EXISTS project_images (
  id          VARCHAR(60) PRIMARY KEY,
  tenant_id   UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES tenants(id),
  project_id  VARCHAR(100) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  src         TEXT NOT NULL,
  caption     TEXT,
  sort_order  INT DEFAULT 0,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proj_img ON project_images(project_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_proj_img_tenant ON project_images(tenant_id);
