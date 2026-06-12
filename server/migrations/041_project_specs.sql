-- 041_project_specs.sql
-- 프로젝트 사양 정리 표 — 설계/제어전장/소프트웨어/공정 4개 분류 × 항목 행(항목/내용/비고).
-- 분류 4개·항목 수십 행 규모 → projects JSONB 컬럼(phases/assignees와 동일 패턴).
-- 협업: 최종 수정자/시각도 기록.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS specs JSONB DEFAULT '{}';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS specs_updated_by TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS specs_updated_at TIMESTAMPTZ;
