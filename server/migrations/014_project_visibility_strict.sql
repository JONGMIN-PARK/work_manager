-- ============================================================
-- 014_project_visibility_strict.sql
-- 정책 변경 (v13.31): 프로젝트는 기본 비공개, 생성자가 명시적으로 공유한
-- 사용자만 볼 수 있도록 엄격한 가시성 정책 적용.
--
-- 본 마이그레이션은 자기완결(self-contained):
--  1) owner_id / visibility 컬럼이 없으면 추가 (구 환경 호환)
--  2) 인덱스 idempotent 보장
--  3) owner_id 백필 (created_by → owner_id)
--  4) 모든 'dept'/'tenant' visibility 를 'private' 로 일괄 리셋
--     (v13.27 호환성 백필을 되돌림)
--
-- ※ 마이그레이션 러너는 ';' 로 split해 개별 실행하므로 DO $$ 블록은 사용하지 않음.
--   각 문장은 독립적으로 idempotent.
--
-- 운영자 노트: 이 마이그레이션 이후, 광범위 가시성이 필요한 프로젝트는
--             각 소유자가 프로젝트 편집 모달에서 공개 범위를 'dept' 또는
--             'tenant' 로 명시적으로 변경해야 합니다.
-- ============================================================

-- 컬럼 추가 (멱등 — IF NOT EXISTS)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) NOT NULL DEFAULT 'private';

-- 인덱스 (멱등)
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_visibility ON projects(visibility);

-- owner_id 백필: 비어 있으면 created_by 로
UPDATE projects SET owner_id = created_by WHERE owner_id IS NULL AND created_by IS NOT NULL;

-- 엄격 리셋: 모든 광범위 가시성('dept'/'tenant')을 'private' 로 되돌림. 이미 'private' 는 영향 없음
UPDATE projects SET visibility = 'private' WHERE visibility IN ('dept', 'tenant');
