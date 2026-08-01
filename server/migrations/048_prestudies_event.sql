-- 048_prestudies_event.sql
-- 사전검토 회신기한을 캘린더 일정(events, type='review')으로 발행하기 위한 연결 컬럼.
-- 회의(meetings.event_id)와 동일한 패턴 — 기한이 캘린더·타임라인·텔레그램 /calendar·/today 에 노출된다.

ALTER TABLE prestudies ADD COLUMN IF NOT EXISTS event_id VARCHAR(100);
