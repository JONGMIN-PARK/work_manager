-- 051_order_renumber_audit.sql
-- 수주번호 변경(order.renumber) 감사 로그 조회용 인덱스 (v13.182)
--
-- POST /api/orders/:orderNo/renumber 는 변경 이력을 audit_logs 에 남긴다.
--   action     = 'order.renumber'
--   target_id  = 변경 후 수주번호
--   detail     = { from, to, reason, name, client, affected, affectedTotal }
--
-- GET /api/orders/:orderNo/history 가 테넌트별 order.renumber 행을 최신순으로 훑어
-- from/to 체인을 따라간다. 기존 idx_audit_logs_action 은 action 단일 컬럼이라
-- 테넌트·시간 정렬이 붙으면 정렬 비용이 남는다 → 부분 인덱스로 좁힌다.
-- (028_as_perf_indexes.sql 의 'as.%' 부분 인덱스와 같은 패턴)

CREATE INDEX IF NOT EXISTS idx_audit_logs_order
  ON audit_logs(tenant_id, created_at DESC)
  WHERE action LIKE 'order.%';
