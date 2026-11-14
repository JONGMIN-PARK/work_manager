-- 103_weekly_item_bin.sql (v13.490)
-- 주간 업무 작성 › 🔎 점검 — 「빠진 일」을 🗑 없애기로 치운 것을 버리지 않고 보관하는 휴지통(임시 보관함)
--   · 팀마다 따로 · item_key = 팀|업체|이름(공백·기호 뺀 것, weekly-insights.itemKey)
--   · last_week: 없앨 때 그 일을 마지막으로 본 주 — 그 뒤 보고서에 다시 나왔다가 또 빠지면 점검에 다시 보임
--   · line: 편집창에 그대로 다시 넣을 수 있는 한 줄 ('- [업체] 이름 ~MM/DD 50% @담당')
--   · use_count / last_used_at: 다시 넣어 쓴 횟수 — 자주 쓰는 항목을 위로
--   · state: wait(처리 대기 — 아직 해야 할 일, 점검에 몇 주째인지 늘 보임) · done(완료 처리) · resumed(금주에 다시 넣음)
--     없앤다고 잊는 게 아니라 결말(완료 · 재개)을 낼 때까지 추적. 처리된 것도 남겨 다시 꺼내 씀
--   · note: 대기 사유(고객 회신 대기 · 보류 등)
-- 매 기동 시 다시 돌아도 되게(멱등) 작성.
CREATE TABLE IF NOT EXISTS weekly_item_bin (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    UUID NOT NULL,
  team         TEXT NOT NULL DEFAULT '',
  item_key     TEXT NOT NULL,
  section      VARCHAR(10) NOT NULL DEFAULT 'etc',
  client       TEXT NOT NULL DEFAULT '',
  name         TEXT NOT NULL DEFAULT '',
  line         TEXT NOT NULL,
  members      JSONB NOT NULL DEFAULT '[]'::jsonb,
  pct          INTEGER,
  deadline     TEXT,
  last_week    DATE,
  use_count    INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  state        VARCHAR(10) NOT NULL DEFAULT 'wait' CHECK (state IN ('wait', 'done', 'resumed')),
  note         TEXT NOT NULL DEFAULT '',
  resolved_at  TIMESTAMPTZ,
  created_by   UUID,
  created_name VARCHAR(100) NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_weekly_item_bin ON weekly_item_bin(tenant_id, team, item_key);
