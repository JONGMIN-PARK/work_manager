-- 071_mywork_rec.sql (v13.274)
-- 텔레그램 내 업무 추천 — 받을 시각(KST, 'HH:MM' 쉼표, 빈 값 = 끄기, 평일만) · 오늘 보낸 시각 · 마지막에 보낸 추천 (같은 날 같은 추천은 다시 안 보냄)
ALTER TABLE telegram_links ADD COLUMN IF NOT EXISTS rec_slots VARCHAR(40) NOT NULL DEFAULT '13:30';
ALTER TABLE telegram_links ADD COLUMN IF NOT EXISTS rec_sent_date VARCHAR(10);
ALTER TABLE telegram_links ADD COLUMN IF NOT EXISTS rec_sent_slots VARCHAR(40);
ALTER TABLE telegram_links ADD COLUMN IF NOT EXISTS rec_sig VARCHAR(200);
