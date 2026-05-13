-- 017_as_categories.sql
-- A/S 접수 카테고리 마스터 — 관리자가 자유롭게 추가/수정/비활성화
-- 테넌트별로 별도 관리. soft-delete(active=false) 기본.

CREATE TABLE IF NOT EXISTS as_categories (
  id          VARCHAR(40) PRIMARY KEY,
  tenant_id   UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES tenants(id),
  code        VARCHAR(40) NOT NULL,                   -- ex) hw_fault, optic_cleaning
  label       TEXT NOT NULL,                          -- ex) HW 고장, Optic Cleaning
  icon        TEXT,                                   -- ex) 🔴, 🔆
  sort_order  INT NOT NULL DEFAULT 100,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  UUID REFERENCES users(id),
  updated_by  UUID REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_as_categories_tenant_code
  ON as_categories(tenant_id, code);

CREATE INDEX IF NOT EXISTS idx_as_categories_active
  ON as_categories(tenant_id, active, sort_order);

-- 기본 카테고리 seed (기존 config.js AS_CATEGORY 11종 + Optic Cleaning)
-- 기본 테넌트(00000000-...-0001)에만 seed; 신규 테넌트는 부트스트랩 시 별도 seed
INSERT INTO as_categories (id, tenant_id, code, label, icon, sort_order, active) VALUES
  ('asc-seed-hw',      '00000000-0000-0000-0000-000000000001', 'hw_fault',       'HW 고장',         '🔴',  10, TRUE),
  ('asc-seed-sw',      '00000000-0000-0000-0000-000000000001', 'sw_error',       'SW 오류',         '💻',  20, TRUE),
  ('asc-seed-proc',    '00000000-0000-0000-0000-000000000001', 'process',        '공정 이슈',       '⚙️',  30, TRUE),
  ('asc-seed-net',     '00000000-0000-0000-0000-000000000001', 'network',        '통신/네트워크',   '📡',  40, TRUE),
  ('asc-seed-sensor',  '00000000-0000-0000-0000-000000000001', 'sensor',         '센서/비전',       '👁️',  50, TRUE),
  ('asc-seed-motion',  '00000000-0000-0000-0000-000000000001', 'motion',         '모션/구동',       '🔧',  60, TRUE),
  ('asc-seed-consum',  '00000000-0000-0000-0000-000000000001', 'consumable',     '소모품 교체',     '🔩',  70, TRUE),
  ('asc-seed-optic',   '00000000-0000-0000-0000-000000000001', 'optic_cleaning', 'Optic Cleaning',  '🔆',  75, TRUE),
  ('asc-seed-misuse',  '00000000-0000-0000-0000-000000000001', 'misuse',         '운영 미숙',       '📚',  80, TRUE),
  ('asc-seed-install', '00000000-0000-0000-0000-000000000001', 'install',        '환경/설치',       '🏗️',  90, TRUE),
  ('asc-seed-improve', '00000000-0000-0000-0000-000000000001', 'improve',        '개선 요청',       '💡', 100, TRUE),
  ('asc-seed-etc',     '00000000-0000-0000-0000-000000000001', 'etc',            '기타',            '📌', 999, TRUE)
ON CONFLICT (tenant_id, code) DO NOTHING;
