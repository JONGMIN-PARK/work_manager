-- ============================================================
-- 006_project_visibility.sql — 프로젝트 개인 소유권 + 가시성
-- - projects.owner_id : 현재 소유자 (생성자 기본값, 이관 시 변경)
-- - projects.visibility : 'private' | 'dept' | 'tenant'
-- 기존 동작 보존: 부서 있는 프로젝트는 'dept', 없는 프로젝트는 'tenant'로 백필
-- ============================================================

-- 컬럼 추가 (멱등)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'owner_id') THEN
    ALTER TABLE projects ADD COLUMN owner_id UUID REFERENCES users(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'visibility') THEN
    ALTER TABLE projects ADD COLUMN visibility VARCHAR(20) NOT NULL DEFAULT 'private';
  END IF;
END $$;

-- visibility 체크 제약 (멱등)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'projects' AND constraint_name = 'projects_visibility_chk'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_visibility_chk
      CHECK (visibility IN ('private','dept','tenant'));
  END IF;
END $$;

-- 백필: 소유자 = 생성자
UPDATE projects SET owner_id = created_by
 WHERE owner_id IS NULL AND created_by IS NOT NULL;

-- 백필: visibility — 기존 동작 유지
--   department_id 가 있던 프로젝트는 부서 가시성으로
--   없던 프로젝트는 테넌트 전체 가시성으로 (이전 라우트에서 모두에게 노출되던 동작 보존)
UPDATE projects
   SET visibility = CASE
     WHEN department_id IS NOT NULL THEN 'dept'
     ELSE 'tenant'
   END
 WHERE visibility = 'private'
   AND created_at < now();  -- 신규 등록(now() 직전)은 기본 private 유지

CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_visibility ON projects(visibility);
