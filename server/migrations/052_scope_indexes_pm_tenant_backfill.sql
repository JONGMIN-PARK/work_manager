-- 052_scope_indexes_pm_tenant_backfill.sql
-- 조회 패턴 인덱스 2개 + project_members.tenant_id 백필.
--
-- 이 파일은 config/db.js 가 서버 시작(및 jest 파일마다)마다 다시 실행한다.
-- BEGIN 이 없으므로 문장 단위로 개별 실행되며, 모두 재실행 안전(idempotent)하다.

-- 1) work_records(tenant_id, order_no, date)
--    POST /api/archives/records/auto-tag-milestones:
--      WHERE order_no = $ AND tenant_id = $ AND date BETWEEN 마일스톤 구간
--    수주번호별 집계/필터(GET /records?orderNo=, 통계)도 항상 tenant_id 와 함께 온다.
--    기존 idx_wr_order_date(order_no, date) 는 테넌트 조건을 인덱스로 거르지 못한다.
CREATE INDEX IF NOT EXISTS idx_wr_tenant_order_date
  ON work_records(tenant_id, order_no, date);

-- 2) projects(end_date, status)
--    스케줄 작업(notification/jobs.js) — 테넌트 무관 전체 스캔:
--      sendDeadlineReminders : WHERE end_date = ANY($1) AND status NOT IN ('done','hold')
--      sendDailyBriefing     : WHERE end_date = $1 AND status != 'done'
--    기존에는 status 단일 인덱스뿐이라 end_date 등치 조건이 Seq Scan 이었다.
CREATE INDEX IF NOT EXISTS idx_projects_end_date_status
  ON projects(end_date, status);

-- 3) project_members.tenant_id 백필
--    009_tenants 가 컬럼을 DEFAULT '00000000-0000-0000-0000-000000000001'(기본 테넌트)로 추가했고,
--    v13.193 이전의 INSERT 는 tenant_id 를 쓰지 않았다 → 다른 테넌트 프로젝트의 멤버 행도
--    NULL 이 아니라 "기본 테넌트" 값을 갖는다. 그래서 `tenant_id IS NULL` 조건으로는 고쳐지지 않고,
--    idx_project_members_tenant 로 테넌트별 조회를 하면 오래된 행이 빠진다.
--    프로젝트의 tenant_id 와 다르면(NULL 포함) 프로젝트 값으로 맞춘다. 두 번째 실행부터는 0행.
UPDATE project_members pm
   SET tenant_id = p.tenant_id
  FROM projects p
 WHERE pm.project_id = p.id
   AND p.tenant_id IS NOT NULL
   AND pm.tenant_id IS DISTINCT FROM p.tenant_id;

ANALYZE work_records;
ANALYZE projects;
ANALYZE project_members;
