-- v13.545 ☆ 찜 — 주간 보고서의 남의 일을 찜해 두고 🎯 내 업무 📋 금주 할 일에서 주마다 ☐ 확인 (관리하는 사람용)
--   주와 상관없이 팀 · 업체 · 일 이름으로 기억 → 다음 주 보고서에 같은 일이 있으면 그 주에도 보임. 확인은 주마다 (checks: {"2026-11-16": "2026-11-18T..."} )
CREATE TABLE IF NOT EXISTS weekly_picks (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  team        VARCHAR(100) NOT NULL DEFAULT '',
  ikey        VARCHAR(400) NOT NULL,
  client      VARCHAR(200),
  name        VARCHAR(400),
  checks      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, team, ikey)
);
CREATE INDEX IF NOT EXISTS idx_weekly_picks_user ON weekly_picks (tenant_id, user_id);
