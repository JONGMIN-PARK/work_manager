-- 042_milestone_logs_soft_delete.sql
-- 투입실적(마일스톤 진척률·작업노트 이력) 2단계 삭제: deleted_at 컬럼 + 휴지통 인덱스
-- soft delete(휴지통 이동) → 관리자가 복구 / 완전삭제(hard) 분기. 영구 보관(자동삭제 없음).

ALTER TABLE milestone_progress_logs
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE milestone_progress_logs
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id);

-- 활성 이력 조회 최적화: 기본 목록은 deleted_at IS NULL 필터를 항상 동반
CREATE INDEX IF NOT EXISTS idx_mpl_ms_active
  ON milestone_progress_logs(milestone_id, created_at DESC) WHERE deleted_at IS NULL;

-- 휴지통 조회용
CREATE INDEX IF NOT EXISTS idx_mpl_ms_trashed
  ON milestone_progress_logs(milestone_id, deleted_at DESC) WHERE deleted_at IS NOT NULL;
