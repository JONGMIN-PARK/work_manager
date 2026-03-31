-- work_records: 수주명(ocmt), 거래처(oclient) 컬럼 추가
ALTER TABLE work_records ADD COLUMN IF NOT EXISTS ocmt VARCHAR(200);
ALTER TABLE work_records ADD COLUMN IF NOT EXISTS oclient VARCHAR(200);
