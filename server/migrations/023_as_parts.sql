-- 023_as_parts.sql
-- A/S 사용 부품/소모품 (PRD §5.4)

CREATE TABLE IF NOT EXISTS as_parts (
  id           VARCHAR(40) PRIMARY KEY,
  ticket_id    VARCHAR(40) NOT NULL REFERENCES as_tickets(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES tenants(id),
  used_at      DATE,
  item_name    TEXT NOT NULL,
  part_no      TEXT,
  qty          NUMERIC(10, 2) NOT NULL DEFAULT 1,
  unit_price   NUMERIC(12, 0) NOT NULL DEFAULT 0,
  replaced_sn  TEXT,                                  -- 교체 대상 S/N
  warranty     BOOLEAN,
  billing      TEXT NOT NULL DEFAULT 'warranty',      -- warranty | paid | goodwill | check
  amount       NUMERIC(14, 0) GENERATED ALWAYS AS (qty * unit_price) STORED,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by   UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_as_parts_ticket
  ON as_parts(ticket_id);

CREATE INDEX IF NOT EXISTS idx_as_parts_billing
  ON as_parts(tenant_id, billing, used_at);
