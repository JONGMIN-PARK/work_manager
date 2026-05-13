-- 024_as_attachments.sql
-- A/S 첨부 파일 (PRD §5.5) — 사진/로그/측정데이터 등
-- file_url은 외부 스토리지(또는 documents 모듈) 경로

CREATE TABLE IF NOT EXISTS as_attachments (
  id           VARCHAR(40) PRIMARY KEY,
  ticket_id    VARCHAR(40) NOT NULL REFERENCES as_tickets(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES tenants(id),
  category     TEXT,                                  -- photo_before/photo_after/log/measurement/etc
  file_name    TEXT NOT NULL,
  file_url     TEXT NOT NULL,
  file_size    BIGINT,
  mime_type    TEXT,
  note         TEXT,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by  UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_as_attachments_ticket
  ON as_attachments(ticket_id);
