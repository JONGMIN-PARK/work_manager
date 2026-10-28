-- 064_calendar_link.sql (v13.252)
-- 내 업무 달력 연동
--   events.start_time / end_time — 'HH:MM' (비면 하루 종일)
--   calendar_feeds — 개인 .ics 구독 주소 토큰 (사람당 하나, 재발급하면 바뀜)
--   event_reminder_sent — 일정 30분 전 텔레그램 알림을 한 번만 보내려고 (회차 날짜별)
ALTER TABLE events ADD COLUMN IF NOT EXISTS start_time VARCHAR(5);
ALTER TABLE events ADD COLUMN IF NOT EXISTS end_time VARCHAR(5);

CREATE TABLE IF NOT EXISTS calendar_feeds (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  token       VARCHAR(64) NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS event_reminder_sent (
  event_id    VARCHAR(100) NOT NULL,
  occur_date  VARCHAR(10) NOT NULL,
  user_id     UUID NOT NULL,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, occur_date, user_id)
);
