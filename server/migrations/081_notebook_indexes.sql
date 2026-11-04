-- 081_notebook_indexes.sql (v13.330)
-- 📓 노트북 — 폴더 지우기(ON DELETE SET NULL) · 폴더별 개수가 노트 전체를 훑지 않게
CREATE INDEX IF NOT EXISTS idx_nb_notes_folder ON nb_notes (folder_id) WHERE folder_id IS NOT NULL;
