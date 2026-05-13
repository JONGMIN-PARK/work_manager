-- 025_as_signatures.sql
-- A/S 서명·결재 + CSAT (PRD §5.6)
-- role: customer_field | engineer | author | reviewer | approver

CREATE TABLE IF NOT EXISTS as_signatures (
  id             VARCHAR(40) PRIMARY KEY,
  ticket_id      VARCHAR(40) NOT NULL REFERENCES as_tickets(id) ON DELETE CASCADE,
  tenant_id      UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES tenants(id),
  role           TEXT NOT NULL,                       -- customer_field/engineer/author/reviewer/approver
  signer_name    TEXT,
  signer_id      UUID REFERENCES users(id),           -- 내부 사용자만 채움
  signed_at      TIMESTAMPTZ,
  signature_url  TEXT,                                -- data URL (PNG base64) 또는 외부 URL
  csat_speed     TEXT,                                -- 매우만족/만족/보통/불만족/매우불만족/N/A
  csat_quality   TEXT,
  csat_overall   TEXT,
  comment        TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by     UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_as_signatures_ticket
  ON as_signatures(ticket_id, role);

-- 한 ticket × role 조합은 최대 1개 (재서명 시 UPDATE)
CREATE UNIQUE INDEX IF NOT EXISTS uq_as_signatures_role
  ON as_signatures(ticket_id, role);
