-- 018_as_tickets_freq_count.sql
-- A/S 접수: 발생빈도에 회수(횟수) 컬럼 추가
-- 예) frequency='hourly', frequency_count=2 → "시간당 2회"

ALTER TABLE as_tickets ADD COLUMN IF NOT EXISTS frequency_count NUMERIC(10, 2);
