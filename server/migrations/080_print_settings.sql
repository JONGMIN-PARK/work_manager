-- 080_print_settings.sql (v13.319)
-- 🖨 출력 머리글 — 회사 이름 · 로고 (회사 전체가 같이 씀, 관리자만 고침)
CREATE TABLE IF NOT EXISTS doc_print_settings (
  tenant_id   UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  company     VARCHAR(120),
  logo        TEXT,                                  -- data:image/(png|jpeg|svg+xml|webp);base64,… (300KB 까지)
  updated_by  UUID,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
