-- 스케일링용 복합 인덱스 (100명+ 대응)

-- work_records: 주 조회 패턴 (날짜 내림차순 + 이름 + 수주번호)
CREATE INDEX IF NOT EXISTS idx_wr_date_desc_name_order
  ON work_records(date DESC, name, order_no);

-- work_records: 집계 쿼리 최적화 (hours, task_type 포함)
CREATE INDEX IF NOT EXISTS idx_wr_name_date
  ON work_records(name, date);

-- work_records: 수주번호 기준 집계
CREATE INDEX IF NOT EXISTS idx_wr_order_date
  ON work_records(order_no, date);

-- work_records: abbr(업무분장) 기준 집계
CREATE INDEX IF NOT EXISTS idx_wr_abbr_date
  ON work_records(abbr, date);

-- users: 이름 → 부서 조회 (부서별 접근제어용)
CREATE INDEX IF NOT EXISTS idx_users_name_dept
  ON users(name, department_id);

-- work_records: user_id 컬럼 추가 (부서별 접근제어 준비)
ALTER TABLE work_records ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_wr_user_id ON work_records(user_id);

-- user_id 백필 (기존 name 기반 → user_id 매핑)
UPDATE work_records wr SET user_id = u.id
FROM users u WHERE u.name = wr.name AND u.status = 'active'
AND wr.user_id IS NULL;
