-- 프로젝트/일정 부서별 접근 제어를 위한 department_id 추가

-- 1) projects 테이블에 department_id 추가
ALTER TABLE projects ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id);
CREATE INDEX IF NOT EXISTS idx_projects_dept ON projects(department_id);

-- 2) events 테이블에 department_id 추가
ALTER TABLE events ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id);
CREATE INDEX IF NOT EXISTS idx_events_dept ON events(department_id);

-- 3) 기존 프로젝트: 생성자의 부서로 백필
UPDATE projects p SET department_id = u.department_id
FROM users u
WHERE p.department_id IS NULL AND p.created_by = u.id AND u.department_id IS NOT NULL;

-- 4) 기존 일정: 생성자의 부서로 백필
UPDATE events e SET department_id = u.department_id
FROM users u
WHERE e.department_id IS NULL AND e.created_by = u.id AND u.department_id IS NOT NULL;
