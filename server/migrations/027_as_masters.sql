-- 027_as_masters.sql
-- A/S 운영 효율을 위한 마스터 데이터 — 장비/고객 컨택
-- A1: 재발 이력 자동 노출 + 접수 시 자동 채움 + 메일 To 드롭다운

-- 장비 마스터: serial_no UNIQUE (테넌트별)
CREATE TABLE IF NOT EXISTS as_equipment_master (
  id              VARCHAR(40) PRIMARY KEY,
  tenant_id       UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES tenants(id),
  serial_no       VARCHAR(80) NOT NULL,
  equipment_no    VARCHAR(40),
  equipment_model TEXT,
  customer_name   TEXT,
  site_line       TEXT,
  install_date    DATE,
  warranty_until  DATE,
  warranty_status TEXT,
  note            TEXT,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID REFERENCES users(id),
  updated_by      UUID REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_as_equipment_serial
  ON as_equipment_master(tenant_id, serial_no);
CREATE INDEX IF NOT EXISTS idx_as_equipment_customer
  ON as_equipment_master(tenant_id, customer_name);
CREATE INDEX IF NOT EXISTS idx_as_equipment_model
  ON as_equipment_master(tenant_id, equipment_model);

-- 고객 컨택 마스터: 같은 고객사에 담당자 여러 명 가능
CREATE TABLE IF NOT EXISTS as_customer_contacts (
  id            VARCHAR(40) PRIMARY KEY,
  tenant_id     UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES tenants(id),
  customer_name TEXT NOT NULL,
  contact_name  TEXT,
  email         TEXT,
  phone         TEXT,
  role          TEXT,                          -- 현장담당/구매/기술/관리자 등
  is_primary    BOOLEAN NOT NULL DEFAULT FALSE,
  note          TEXT,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    UUID REFERENCES users(id),
  updated_by    UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_as_contacts_customer
  ON as_customer_contacts(tenant_id, customer_name);
CREATE INDEX IF NOT EXISTS idx_as_contacts_email
  ON as_customer_contacts(tenant_id, email) WHERE email IS NOT NULL AND email <> '';

-- 재발 이력 조회 최적화: serial_no/equipment_no 기준 검색 빠르게
CREATE INDEX IF NOT EXISTS idx_as_tickets_serial_recur
  ON as_tickets(tenant_id, serial_no) WHERE serial_no IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_as_tickets_equip_recur
  ON as_tickets(tenant_id, equipment_no) WHERE equipment_no IS NOT NULL AND deleted_at IS NULL;
