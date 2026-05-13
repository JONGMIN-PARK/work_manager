-- 021_as_tickets_linked_issue.sql
-- A/S ↔ 이슈 양방향 연계: as_tickets에 linked_issue_id 컬럼 추가 (PRD §5.1)

ALTER TABLE as_tickets ADD COLUMN IF NOT EXISTS linked_issue_id VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_as_tickets_linked_issue
  ON as_tickets(linked_issue_id) WHERE linked_issue_id IS NOT NULL;
