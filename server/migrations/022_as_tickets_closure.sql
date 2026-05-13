-- 022_as_tickets_closure.sql
-- A/S 최종 결과/모니터링/약속시각 컬럼 추가 (PRD §5.1)
-- ④보고~⑥보고서 단계에서 사용

ALTER TABLE as_tickets ADD COLUMN IF NOT EXISTS rca                  TEXT;
ALTER TABLE as_tickets ADD COLUMN IF NOT EXISTS prevention           TEXT;
ALTER TABLE as_tickets ADD COLUMN IF NOT EXISTS final_equip_status   TEXT;     -- 정상가동/임시조치/제한가동/가동불가/재방문필요
ALTER TABLE as_tickets ADD COLUMN IF NOT EXISTS monitoring           TEXT;     -- 불필요/단기관찰/장기관찰
ALTER TABLE as_tickets ADD COLUMN IF NOT EXISTS closure              TEXT;     -- 정상완료/부분완료/미완료/이관처리/취소
ALTER TABLE as_tickets ADD COLUMN IF NOT EXISTS closed_at            TIMESTAMPTZ;
ALTER TABLE as_tickets ADD COLUMN IF NOT EXISTS promised_response_at TIMESTAMPTZ;
ALTER TABLE as_tickets ADD COLUMN IF NOT EXISTS promised_visit_at    TIMESTAMPTZ;
