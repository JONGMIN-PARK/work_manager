-- 029_ai_query_usage.sql
-- v13.75 — AI 쿼리 사용량 기록 테이블 (월별 할당량 추적용)
-- server/routes/ai.js의 getMonthlyUsage / logUsage가 사용

CREATE TABLE IF NOT EXISTS ai_query_usage (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES tenants(id),
  user_id      UUID REFERENCES users(id),
  query_text   TEXT,           -- 처음 500자만 저장 (라우터에서 슬라이스)
  provider     TEXT,           -- 'anthropic' | 'gemini'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 월별 사용량 카운트 쿼리 최적화: tenant_id + created_at
CREATE INDEX IF NOT EXISTS idx_ai_query_usage_tenant_date
  ON ai_query_usage(tenant_id, created_at DESC);

-- 사용자별 사용량 통계 (선택, 향후 분석용)
CREATE INDEX IF NOT EXISTS idx_ai_query_usage_user_date
  ON ai_query_usage(user_id, created_at DESC) WHERE user_id IS NOT NULL;

-- 테넌트 AI 설정 (테넌트 전용 API 키) — 동일 라우터에서 SELECT
CREATE TABLE IF NOT EXISTS tenant_ai_configs (
  tenant_id    UUID PRIMARY KEY REFERENCES tenants(id),
  provider     TEXT NOT NULL DEFAULT 'gemini',
  api_key      TEXT,
  model        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
