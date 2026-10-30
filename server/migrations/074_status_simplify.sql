-- 074_status_simplify.sql (v13.283)
-- 저장 상태 단순화 — 프로젝트는 active · hold · done, 마일스톤은 waiting · active · done 만 저장한다.
-- 프로젝트 '대기'(시작 전) · '지연'(종료일 지남)은 날짜로 계산해 보여 주기만 (server/lib/project-defaults.js computeStatus).
-- 매 기동 시 다시 돌아도 되게(멱등) 작성 — 바꿀 행이 없으면 아무것도 안 함.
BEGIN;

UPDATE projects SET status = 'active' WHERE status IN ('waiting', 'delayed');

UPDATE milestones SET status = 'active' WHERE status = 'delayed';
UPDATE milestones SET status = 'waiting' WHERE status = 'hold';

COMMIT;
