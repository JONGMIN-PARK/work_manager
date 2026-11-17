-- 105_gongsu_days.sql (v13.512) 📝 애니웍스 공수 등록 — 날짜별 내 초안 · 등록 기록
--   items      : 작성 중인 행 [{orderno, prodspec, hours, divi, job, memo}]
--   status     : draft(작성 중) | sent(애니웍스에 등록함)
--   sent_items : 등록할 때 올린 그대로 (뒤에 초안을 고쳐도 무엇을 올렸는지 남김)
--   checked_at : 내려받은 주간일지에서 내 행을 확인한 시각
CREATE TABLE IF NOT EXISTS gongsu_days (
  tenant_id   UUID NOT NULL,
  user_id     UUID NOT NULL,
  day         DATE NOT NULL,
  items       JSONB NOT NULL DEFAULT '[]'::jsonb,
  status      VARCHAR(12) NOT NULL DEFAULT 'draft',
  sent_at     TIMESTAMPTZ,
  sent_items  JSONB,
  sent_msg    TEXT NOT NULL DEFAULT '',
  checked_at  TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, day)
);
