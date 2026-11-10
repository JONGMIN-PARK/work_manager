-- v13.436 🖼 사진 크기(가로 · 세로) — 사진이 뜨기 전에 자리를 잡아 두어 대화가 밀리지 않게
ALTER TABLE chat_files ADD COLUMN IF NOT EXISTS w INTEGER;
ALTER TABLE chat_files ADD COLUMN IF NOT EXISTS h INTEGER;
