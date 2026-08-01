-- 045_meetings.sql
-- 회의 관리 (안건·회의록·액션아이템) — PRD_프로젝트관리_확장 모듈 B
-- 회의 생성 시 events(type=meeting) 자동 발행(event_id 연동). 액션아이템 → 이슈/개발아이템 전환.

CREATE TABLE IF NOT EXISTS meetings (
  id          VARCHAR(100) PRIMARY KEY,
  tenant_id   UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES tenants(id),
  project_id  VARCHAR(100) REFERENCES projects(id) ON DELETE CASCADE,
  event_id    VARCHAR(100) REFERENCES events(id) ON DELETE SET NULL,
  title       VARCHAR(255) NOT NULL,
  meet_date   VARCHAR(10),
  agenda      JSONB DEFAULT '[]',
  minutes     TEXT,
  attendees   JSONB DEFAULT '[]',
  version     INT NOT NULL DEFAULT 1,
  created_by  UUID REFERENCES users(id),
  updated_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meetings_proj ON meetings (tenant_id, project_id);

CREATE TABLE IF NOT EXISTS meeting_action_items (
  id                 VARCHAR(100) PRIMARY KEY,
  tenant_id          UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES tenants(id),
  meeting_id         VARCHAR(100) NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  title              VARCHAR(500) NOT NULL,
  assignee_name      VARCHAR(100),
  assignee_id        UUID REFERENCES users(id),
  due_date           VARCHAR(10),
  status             VARCHAR(20) DEFAULT 'open',
  linked_issue_id    VARCHAR(100),
  linked_dev_item_id VARCHAR(100),
  sort_order         INT DEFAULT 0,
  created_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meeting_actions_meeting ON meeting_action_items (meeting_id);

CREATE INDEX IF NOT EXISTS idx_meeting_actions_assignee ON meeting_action_items (tenant_id, assignee_id) WHERE status <> 'done';
