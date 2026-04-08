-- ============================================================
-- 004_phase3.sql — Phase 3: SSO, 커스텀 필드, 워크플로우, 라이선스, 감사 보강
-- ============================================================

-- ─── SSO/SAML 설정 ───
CREATE TABLE IF NOT EXISTS sso_configs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider    VARCHAR(50) NOT NULL DEFAULT 'saml'
              CHECK (provider IN ('saml', 'oidc')),
  enabled     BOOLEAN DEFAULT false,
  entity_id   VARCHAR(500),
  sso_url     VARCHAR(500),
  certificate TEXT,
  metadata_url VARCHAR(500),
  settings    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_sso_tenant ON sso_configs(tenant_id);

-- ─── 커스텀 필드 정의 ───
CREATE TABLE IF NOT EXISTS custom_field_definitions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN ('project', 'issue', 'order')),
  field_name  VARCHAR(100) NOT NULL,
  field_key   VARCHAR(100) NOT NULL,
  field_type  VARCHAR(30) NOT NULL DEFAULT 'text'
              CHECK (field_type IN ('text', 'number', 'date', 'select', 'multiselect', 'checkbox', 'url', 'email')),
  options     JSONB DEFAULT '[]',
  required    BOOLEAN DEFAULT false,
  sort_order  INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, entity_type, field_key)
);

CREATE INDEX IF NOT EXISTS idx_cfd_tenant_entity ON custom_field_definitions(tenant_id, entity_type);

-- ─── 커스텀 필드 값 ───
CREATE TABLE IF NOT EXISTS custom_field_values (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  field_id    UUID NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE,
  entity_type VARCHAR(50) NOT NULL,
  entity_id   VARCHAR(100) NOT NULL,
  value       JSONB,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(field_id, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_cfv_entity ON custom_field_values(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_cfv_field ON custom_field_values(field_id);

-- ─── 워크플로우 정의 ───
CREATE TABLE IF NOT EXISTS workflow_definitions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN ('project', 'issue')),
  name        VARCHAR(200) NOT NULL,
  is_default  BOOLEAN DEFAULT false,
  states      JSONB NOT NULL DEFAULT '[]',
  transitions JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wf_tenant ON workflow_definitions(tenant_id, entity_type);

-- ─── 화이트라벨 설정 ───
CREATE TABLE IF NOT EXISTS white_label_configs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  logo_url     VARCHAR(500),
  favicon_url  VARCHAR(500),
  primary_color VARCHAR(20) DEFAULT '#3B82F6',
  app_name     VARCHAR(100),
  custom_domain VARCHAR(255),
  custom_css   TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- ─── 라이선스 키 ───
CREATE TABLE IF NOT EXISTS licenses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_key VARCHAR(255) UNIQUE NOT NULL,
  tenant_id   UUID REFERENCES tenants(id) ON DELETE SET NULL,
  plan        VARCHAR(20) NOT NULL DEFAULT 'enterprise',
  max_users   INT DEFAULT 0,
  features    JSONB DEFAULT '[]',
  issued_at   TIMESTAMPTZ DEFAULT now(),
  expires_at  TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  status      VARCHAR(20) DEFAULT 'active'
              CHECK (status IN ('active', 'expired', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_license_key ON licenses(license_key);
CREATE INDEX IF NOT EXISTS idx_license_tenant ON licenses(tenant_id);

-- ─── 데이터 보관 정책 ───
CREATE TABLE IF NOT EXISTS data_retention_policies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  audit_logs_days   INT DEFAULT 365,
  archives_days     INT DEFAULT 0,
  deleted_data_days INT DEFAULT 30,
  auto_purge        BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ─── audit_logs에 tenant_id 추가 (없는 경우) ───
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'audit_logs' AND column_name = 'tenant_id') THEN
    ALTER TABLE audit_logs ADD COLUMN tenant_id UUID REFERENCES tenants(id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id);
  END IF;
END $$;
