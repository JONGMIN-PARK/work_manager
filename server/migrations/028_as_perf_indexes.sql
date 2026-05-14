-- 028_as_perf_indexes.sql
-- v13.59: 100명 동시 사용 대비 — A/S 통계·집계 쿼리용 시간 인덱스 보강
-- 통계 1회 호출에 18 병렬 쿼리가 실행되므로 인덱스가 정렬된 시간 범위 스캔에 의존

-- 1) activity_logs — 시간 범위 (worked_at) 기반 쿼리가 통계·주간요약에서 자주 발생
--    기존: (tenant_id, dept, worked_at DESC) 만 있어 dept 컬럼이 leading
CREATE INDEX IF NOT EXISTS idx_as_activity_logs_tenant_date
  ON as_activity_logs(tenant_id, worked_at DESC);

-- 2) parts — used_at 기반 월별 부품 추이 쿼리용 (partsByMonth)
--    기존: ticket_id 만 인덱스
CREATE INDEX IF NOT EXISTS idx_as_parts_tenant_used
  ON as_parts(tenant_id, used_at DESC) WHERE used_at IS NOT NULL;

-- 3) signatures — customer_field CSAT 추이 쿼리용 (signed_at 범위)
CREATE INDEX IF NOT EXISTS idx_as_signatures_tenant_date
  ON as_signatures(tenant_id, signed_at DESC) WHERE role = 'customer_field';

-- 4) tickets — closed_at 기준 RCA·MTTR 쿼리
CREATE INDEX IF NOT EXISTS idx_as_tickets_closed_at
  ON as_tickets(tenant_id, closed_at DESC) WHERE status = 'closed' AND deleted_at IS NULL;

-- 5) tickets — customer_name + received_at (Top 고객 Pareto 쿼리)
CREATE INDEX IF NOT EXISTS idx_as_tickets_customer_received
  ON as_tickets(tenant_id, customer_name, received_at DESC) WHERE deleted_at IS NULL AND customer_name IS NOT NULL;

-- 6) audit_logs — 스케줄러 dedup 체크용 (action + target_id + created_at)
CREATE INDEX IF NOT EXISTS idx_audit_logs_dedup
  ON audit_logs(action, target_id, created_at DESC) WHERE action LIKE 'as.%';
