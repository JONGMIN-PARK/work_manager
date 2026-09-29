-- 055_meeting_minutes_form.sql
-- 회의록 양식 (v13.198): 논의 내용은 기존 minutes 컬럼 그대로, 나머지 양식 칸은 form JSONB
--   form: { timeStart, timeEnd, place, writer, decisions, nextDate, nextNote }
-- 메일 발송 기록: 마지막 발송 시각·받는 사람 (목록은 최대 50개 주소)
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS form JSONB DEFAULT '{}';
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS mailed_at TIMESTAMPTZ;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS mailed_by_name TEXT;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS mailed_to JSONB DEFAULT '[]';
