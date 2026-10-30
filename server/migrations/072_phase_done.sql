-- 072_phase_done.sql (v13.277)
-- 프로젝트 마지막 단계 'A/S'(as) → '완료'(done). A/S 는 이제 별도 A/S 탭(as_tickets)에서만 다룸.
-- 완료 단계 ↔ 프로젝트 상태 '완료'(status done) 를 항상 같이 맞춘다 (서버 routes/projects.js 도 같은 규칙).
-- 매 기동 시 다시 돌아도 되게(멱등) 작성.
BEGIN;

-- 1) 단계 일정(phases JSON)의 as 키 → done
UPDATE projects
   SET phases = (phases - 'as') || jsonb_build_object('done', phases->'as')
 WHERE jsonb_typeof(phases) = 'object' AND phases ? 'as' AND NOT phases ? 'done';
UPDATE projects SET phases = phases - 'as'
 WHERE jsonb_typeof(phases) = 'object' AND phases ? 'as';

-- 2) A/S 단계에 있던 프로젝트 → 완료 단계 · 상태 완료
UPDATE projects SET current_phase = 'done' WHERE current_phase = 'as';
-- 상태가 완료인데 다른 단계에 있던 프로젝트도 완료 단계로
UPDATE projects SET current_phase = 'done' WHERE status = 'done' AND current_phase IS DISTINCT FROM 'done';
UPDATE projects SET status = 'done', progress = 100
 WHERE current_phase = 'done' AND (status IS DISTINCT FROM 'done' OR progress IS DISTINCT FROM 100);

-- 3) 완료 단계 프로젝트는 단계 일정도 전부 완료로 (타임라인 단계 막대 색)
UPDATE projects p
   SET phases = (SELECT jsonb_object_agg(k, CASE WHEN jsonb_typeof(v) = 'object' THEN v || '{"status":"done"}'::jsonb ELSE v END)
                   FROM jsonb_each(p.phases) AS e(k, v))
 WHERE p.current_phase = 'done' AND jsonb_typeof(p.phases) = 'object' AND p.phases <> '{}'::jsonb
   AND EXISTS (SELECT 1 FROM jsonb_each(p.phases) e(k, v) WHERE jsonb_typeof(v) = 'object' AND v->>'status' IS DISTINCT FROM 'done');

-- 4) 단계 키를 쓰는 곳 — 체크리스트 · 이슈 단계
UPDATE checklists SET phase = 'done' WHERE phase = 'as';
UPDATE issues SET phase = 'done' WHERE phase = 'as';

-- 5) 수주에서 자동으로 만든 단계 마일스톤 이름
UPDATE milestones SET name = '완료' WHERE name = 'A/S';

COMMIT;
