-- 076_weekly_goals_links.sql (v13.311)
-- 주간 업무 분석을 믿을 수 있게:
--  1) weekly_item_links — 사람이 손으로 "같은 일" 묶기(merge) · 나누기(split)
--     item_key = 팀|업체|이름(공백·기호 뺀 것). merge 는 target_key 쪽 일로 셈, split 은 글자 비교로 잇지 않음
--  2) weekly_goals — 팀(빈 값 = 모든 팀) · 사람(빈 값 = 팀 전체)별 목표값
-- 매 기동 시 다시 돌아도 되게(멱등) 작성.
BEGIN;

CREATE TABLE IF NOT EXISTS weekly_item_links (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL,
  item_key    TEXT NOT NULL,
  kind        VARCHAR(10) NOT NULL CHECK (kind IN ('merge', 'split')),
  target_key  TEXT,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_weekly_item_links ON weekly_item_links(tenant_id, item_key);

CREATE TABLE IF NOT EXISTS weekly_goals (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL,
  team        TEXT NOT NULL DEFAULT '',
  member      TEXT NOT NULL DEFAULT '',
  metric      VARCHAR(30) NOT NULL,
  target      NUMERIC NOT NULL,
  updated_by  UUID,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_weekly_goals ON weekly_goals(tenant_id, team, member, metric);

COMMIT;
