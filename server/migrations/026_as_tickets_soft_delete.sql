-- 026_as_tickets_soft_delete.sql
-- A/S 접수 2단계 삭제: deleted_at 컬럼 + 휴지통 인덱스
-- soft delete(휴지통 이동) → 휴지통에서 복구 / 완전삭제(hard) 분기

ALTER TABLE as_tickets
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE as_tickets
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id);

-- 활성 접수 조회 최적화: 기본 목록은 deleted_at IS NULL 필터를 항상 동반
CREATE INDEX IF NOT EXISTS idx_as_tickets_tenant_active
  ON as_tickets(tenant_id, received_at DESC) WHERE deleted_at IS NULL;

-- 휴지통 조회용
CREATE INDEX IF NOT EXISTS idx_as_tickets_tenant_trashed
  ON as_tickets(tenant_id, deleted_at DESC) WHERE deleted_at IS NOT NULL;
