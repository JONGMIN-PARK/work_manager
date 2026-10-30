-- 072_phase_done.sql (v13.277)
-- 프로젝트 마지막 단계 'A/S'(as) → '완료'(done). A/S 는 이제 별도 A/S 탭(as_tickets)에서만 다룸.
-- 완료 단계 ↔ 프로젝트 상태 '완료'(status done) 를 항상 같이 맞춘다 (서버 routes/projects.js 도 같은 규칙).
-- 매 기동 시 다시 돌아도 되게(멱등) 작성.
BEGIN;

-- 0) 수주에서 자동으로 만든 단계 마일스톤 이름 'A/S' → '완료'
--    아직 A/S 단계를 쓰던(=이 파일이 처음 도는) 프로젝트만 — 매 기동 다시 돌 때 사용자가 지은 'A/S' 마일스톤까지 바꾸지 않게
UPDATE milestones m SET name = '완료'
  FROM projects p
 WHERE m.project_id = p.id AND m.tenant_id = p.tenant_id AND m.name = 'A/S'
   AND (p.current_phase = 'as' OR (jsonb_typeof(p.phases) = 'object' AND p.phases ? 'as'));

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
-- (진척 100 고정은 서버도 지킨다 — 마일스톤 롤업·자동 산출은 완료 프로젝트를 건드리지 않음. 그래서 다시 돌아도 바뀌는 행이 없다)
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

COMMIT;
