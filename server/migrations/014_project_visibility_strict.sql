-- ============================================================
-- 014_project_visibility_strict.sql
--
-- v13.31 정책: 프로젝트 기본 비공개 + 명시 공유만 노출
--
-- 본 마이그레이션은 자기완결(self-contained):
--  1) owner_id, visibility 컬럼이 없으면 추가 (구 환경 호환)
--  2) 인덱스 idempotent 보장
--  3) owner_id 백필 (created_by 값으로)
--  4) 모든 dept tenant visibility 를 private 로 일괄 리셋
--     (v13.27 호환성 백필을 되돌림)
--
-- 주의: 마이그레이션 러너는 세미콜론으로 split해 개별 실행하므로
--       DO 블록과 quote 인용 모두 주석 안에서 사용 금지.
--       각 문장은 독립적으로 idempotent.
-- ============================================================

ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) NOT NULL DEFAULT 'private';

CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_visibility ON projects(visibility);

UPDATE projects SET owner_id = created_by WHERE owner_id IS NULL AND created_by IS NOT NULL;

UPDATE projects SET visibility = 'private' WHERE visibility IN ('dept', 'tenant');
