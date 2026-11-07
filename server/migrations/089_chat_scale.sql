-- v13.366 💬 메신저 100명+ 대비 — 메시지 · 파일 이름 찾기 색인 (pg_trgm: ILIKE '%말%' 도 색인으로)
--   확장을 못 켜는 DB(권한 없음 등)에서는 건너뜀 — 찾기는 그대로 되고 느릴 뿐
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_trgm 없음 — 메시지 찾기 색인 건너뜀';
  END;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_chat_msg_body_trgm ON chat_messages USING gin (body gin_trgm_ops) WHERE deleted_at IS NULL';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_chat_files_name_trgm ON chat_files USING gin (name gin_trgm_ops)';
  END IF;
END $$;
