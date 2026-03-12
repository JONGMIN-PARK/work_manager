-- Google OAuth2 지원을 위한 컬럼 추가
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;
