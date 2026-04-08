-- ============================================================
-- 005_phase_remaining.sql — Phase 1-2 미구현 항목 보강
-- PostgreSQL RLS, AI 쿼리 제한, 인앱 알림, 테넌트 AI 키
-- ============================================================

-- ─── PostgreSQL RLS (Row-Level Security) ───

-- tenants 테이블은 RLS 불필요 (관리자 직접 조회)

-- users 테이블 RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_tenant_policy ON users
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid OR current_setting('app.tenant_id', true) IS NULL);

-- projects RLS
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'tenant_id') THEN
    ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
    CREATE POLICY projects_tenant_policy ON projects
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid OR current_setting('app.tenant_id', true) IS NULL);
  END IF;
END $$;

-- issues RLS
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'issues' AND column_name = 'tenant_id') THEN
    ALTER TABLE issues ENABLE ROW LEVEL SECURITY;
    CREATE POLICY issues_tenant_policy ON issues
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid OR current_setting('app.tenant_id', true) IS NULL);
  END IF;
END $$;

-- orders RLS
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'tenant_id') THEN
    ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
    CREATE POLICY orders_tenant_policy ON orders
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid OR current_setting('app.tenant_id', true) IS NULL);
  END IF;
END $$;

-- audit_logs RLS
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'audit_logs' AND column_name = 'tenant_id') THEN
    ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
    CREATE POLICY audit_logs_tenant_policy ON audit_logs
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid OR current_setting('app.tenant_id', true) IS NULL);
  END IF;
END $$;

-- ─── 테넌트별 AI API 키 저장 ───
CREATE TABLE IF NOT EXISTS tenant_ai_configs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  provider    VARCHAR(20) DEFAULT 'gemini',
  api_key     VARCHAR(500),
  model       VARCHAR(100),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ─── AI 쿼리 사용량 추적 ───
CREATE TABLE IF NOT EXISTS ai_query_usage (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query_text  TEXT,
  tokens_used INT DEFAULT 0,
  provider    VARCHAR(20),
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_tenant_month ON ai_query_usage(tenant_id, created_at);

-- ─── 인앱 알림 ───
CREATE TABLE IF NOT EXISTS in_app_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type  VARCHAR(50) NOT NULL,
  title       VARCHAR(255) NOT NULL,
  body        TEXT,
  link        VARCHAR(500),
  is_read     BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inapp_user_unread ON in_app_notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_inapp_created ON in_app_notifications(created_at);

-- ─── notification_prefs에 email 채널 지원 추가 ───
-- 기존 constraint가 telegram만 허용하면 제거 후 재생성
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'notification_prefs_channel_check') THEN
    ALTER TABLE notification_prefs DROP CONSTRAINT notification_prefs_channel_check;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
