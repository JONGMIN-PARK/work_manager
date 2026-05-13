-- 016_as_tickets.sql
-- A/S 접수 마스터 테이블 (수직 슬라이스 v1 — 접수 단계만 우선)
-- PRD: docs/PRD_AS_접수보고서.md §5.1
-- 후속 마이그레이션에서 assignments / activity_logs / parts / attachments / signatures / reports 추가 예정

CREATE TABLE IF NOT EXISTS as_tickets (
  id              VARCHAR(40) PRIMARY KEY,
  ticket_no       VARCHAR(20) NOT NULL,                -- AS-YYYY-MM-### (테넌트별 채번)
  tenant_id       UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES tenants(id),

  -- 고객·장비
  customer_name   TEXT NOT NULL,
  site_line       TEXT,
  customer_contact TEXT,
  equipment_no    VARCHAR(40),                          -- Prj No.
  equipment_model TEXT,
  serial_no       TEXT,
  install_date    DATE,
  warranty_status TEXT,                                 -- 보증내 | 보증종료 | 확인필요

  -- 접수 정보
  received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_by     UUID REFERENCES users(id),
  channel         TEXT,                                 -- 전화/이메일/메신저/방문/자동알람/기타
  priority        TEXT NOT NULL DEFAULT 'P3',           -- P1 | P2 | P3 | P4
  category        TEXT,                                 -- HW고장/SW오류/공정이슈/...
  method          TEXT,                                 -- 원격지원/출장/RMA/가이드제공/자료송부

  -- 신고 내용 + 1차 분석
  issue_summary   TEXT NOT NULL,
  reproduction    TEXT,                                 -- 100%재현 / 간헐적 / 1회성 / 재현불가 / 미확인
  frequency       TEXT,                                 -- 시간당/일당/주당/월당/비정규적/회
  impact_scope    TEXT,
  initial_analysis TEXT,

  -- 상태
  status          TEXT NOT NULL DEFAULT 'received',     -- received/assigned/in_progress/reporting/approved/customer_wait/closed/hold/cancelled

  -- 수주·프로젝트 연결 (옵션)
  project_id      VARCHAR(40),
  order_no        VARCHAR(40),

  -- 메타
  version         INT NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID REFERENCES users(id),
  updated_by      UUID REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_as_tickets_tenant_no
  ON as_tickets(tenant_id, ticket_no);

CREATE INDEX IF NOT EXISTS idx_as_tickets_tenant_status
  ON as_tickets(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_as_tickets_customer
  ON as_tickets(tenant_id, customer_name);

CREATE INDEX IF NOT EXISTS idx_as_tickets_received_at
  ON as_tickets(tenant_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_as_tickets_order_no
  ON as_tickets(tenant_id, order_no) WHERE order_no IS NOT NULL;
