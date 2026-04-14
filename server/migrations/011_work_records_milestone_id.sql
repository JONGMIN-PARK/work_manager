-- work_records: 마일스톤 태깅 컬럼 추가
-- 업무일지 레코드를 특정 마일스톤에 명시적으로 귀속시켜 투입실적 집계 정확도 향상
ALTER TABLE work_records ADD COLUMN IF NOT EXISTS milestone_id VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_wr_milestone ON work_records(milestone_id);
