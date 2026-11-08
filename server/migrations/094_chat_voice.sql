-- v13.379 🎤 음성 메시지 — 길이(초) · 받아쓰기(AI, Gemini 있으면)
ALTER TABLE chat_files ADD COLUMN IF NOT EXISTS dur REAL;
ALTER TABLE chat_files ADD COLUMN IF NOT EXISTS transcript TEXT;
