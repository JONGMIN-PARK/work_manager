-- v13.377 🖼 사진 — 여러 장 묶음(grp) · 작은 미리보기(thumb, 보내는 쪽이 만들어 올림 · 예전 사진은 처음 본 사람이 채움)
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS grp VARCHAR(40);
ALTER TABLE chat_files ADD COLUMN IF NOT EXISTS thumb BYTEA;
