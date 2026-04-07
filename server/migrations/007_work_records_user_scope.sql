-- work_records: 사용자별 데이터 분리 — user_id 백필 재실행 + 복합 인덱스

-- 1) NULL user_id 레코드 백필 (이름 기반 매칭, 신규 가입자 포함)
UPDATE work_records wr SET user_id = u.id
FROM users u
WHERE wr.user_id IS NULL AND u.name = wr.name AND u.status = 'active';

-- 2) 사용자별 조회 최적화를 위한 복합 인덱스
CREATE INDEX IF NOT EXISTS idx_wr_user_date_name
  ON work_records(user_id, date DESC, name, order_no);
