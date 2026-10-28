-- v13.256: 일정 · 할 일 미리 알림 시점 (분) — 10 · 30 · 60. 기본 30
ALTER TABLE telegram_links ADD COLUMN IF NOT EXISTS remind_lead SMALLINT NOT NULL DEFAULT 30;
