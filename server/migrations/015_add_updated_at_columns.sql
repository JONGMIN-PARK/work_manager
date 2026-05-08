-- ============================================================
-- 015_add_updated_at_columns.sql
-- 이슈 상태 변경 500 에러 수정 (v13.38)
--
-- middleware/optimistic-lock.js 가 모든 UPDATE 에 'updated_at = now()' 를 추가하지만
-- 일부 테이블(issues, events, orders, milestones, checklists)은 created_at 만 있고
-- updated_at 컬럼이 없어 PUT 요청 시 'column updated_at does not exist' 로 500.
--
-- 멱등 — IF NOT EXISTS 로 보호. 기존 행은 default now() 가 적용됨.
-- ============================================================

ALTER TABLE issues      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE events      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE orders      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE milestones  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE checklists  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
