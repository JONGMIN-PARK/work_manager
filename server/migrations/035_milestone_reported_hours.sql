-- 035_milestone_reported_hours.sql
-- 마일스톤 업데이트(🖉)에서 직접 입력하는 "보고 투입시간".
-- 업무일지(work_records) 집계와 분리된 '보고 투입'으로 투입실적에 합산 표시한다.
-- (업무일지 일괄 업로드의 사용자 레코드 전량 교체와 충돌하지 않도록 별도 보관)

-- 각 진척률 로그의 보고 투입시간
ALTER TABLE milestone_progress_logs ADD COLUMN IF NOT EXISTS hours NUMERIC(6,2) DEFAULT 0;

-- 마일스톤 보고 투입시간 합계 (denormalize: 로그 hours 합)
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS reported_hours NUMERIC(8,2) DEFAULT 0;
