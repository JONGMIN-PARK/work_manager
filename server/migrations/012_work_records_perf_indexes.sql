-- v13.21: work_records 조회 성능 개선 인덱스
-- admin 또는 팀원 전체 범위 조회에서 (tenant_id, date) 필터 + date DESC 정렬을
-- 단일 인덱스로 커버하여 Seq Scan 또는 Bitmap Heap Scan 비용 절감.

-- admin / broad 쿼리용
CREATE INDEX IF NOT EXISTS idx_wr_tenant_date_desc
  ON work_records(tenant_id, date DESC);

-- manager / member 쿼리용 (tenant + user)
CREATE INDEX IF NOT EXISTS idx_wr_tenant_user_date_desc
  ON work_records(tenant_id, user_id, date DESC);

-- 날짜 범위 필터가 잦은 startDate/endDate 용 (date 단독 범위 스캔)
-- 기존 idx_wr_date_desc_name_order 가 date DESC 포함하므로 추가 불필요.

ANALYZE work_records;
