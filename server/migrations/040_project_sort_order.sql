-- 040_project_sort_order.sql
-- 프로젝트 표시 순서(파이프라인 카드 순서 등) 영속화용 정렬 키.
-- NULL = 미지정(기존 등록순 폴백). 같은 단계(레인) 내에서 드래그로 재배열 시 0,1,2.. 로 채움.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS sort_order INT;
CREATE INDEX IF NOT EXISTS idx_projects_sort ON projects(tenant_id, sort_order);
