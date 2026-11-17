-- v13.521 🔄 회사 공통 설정 — 관리자가 정하고 모두가 읽는 값 (user_settings 는 사람마다 따로)
--   첫 쓰임: aw_auto { on, min } — 애니웍스 수주 · 업무일지 자동 갱신 주기(분)
CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key        VARCHAR(60) NOT NULL,
  value      JSONB NOT NULL,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);
