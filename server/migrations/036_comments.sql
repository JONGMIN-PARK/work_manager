-- 036_comments.sql
-- 프로젝트/마일스톤 피드백(코멘트) 저장.
-- 코멘트 작성 시 수신자에게 이메일/텔레그램 알림을 best-effort로 발송.

CREATE TABLE IF NOT EXISTS comments (
  id VARCHAR(60) PRIMARY KEY,
  target_type VARCHAR(20) NOT NULL,          -- 'project' | 'milestone'
  target_id VARCHAR(100) NOT NULL,
  project_id VARCHAR(100),
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES tenants(id),
  author_id UUID REFERENCES users(id),
  author_name TEXT,
  body TEXT NOT NULL,
  recipients JSONB DEFAULT '[]',             -- [{userId,name,email,emailed,telegrammed}]
  parent_id VARCHAR(60),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_comments_target ON comments(target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_project ON comments(project_id);
