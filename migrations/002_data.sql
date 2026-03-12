-- ============================================================
-- 002_data.sql — 비즈니스 데이터 테이블 (IndexedDB → PostgreSQL)
-- ============================================================

-- 프로젝트
CREATE TABLE IF NOT EXISTS projects (
  id              VARCHAR(100) PRIMARY KEY,
  order_no        VARCHAR(100),
  name            VARCHAR(255) NOT NULL,
  start_date      VARCHAR(10),
  end_date        VARCHAR(10),
  status          VARCHAR(20) DEFAULT 'active',
  progress        INT DEFAULT 0,
  estimated_hours NUMERIC(10,1) DEFAULT 0,
  actual_hours    NUMERIC(10,1) DEFAULT 0,
  assignees       JSONB DEFAULT '[]',
  dependencies    JSONB DEFAULT '[]',
  color           VARCHAR(20),
  memo            TEXT,
  current_phase   VARCHAR(20) DEFAULT 'order',
  phases          JSONB DEFAULT '{}',
  version         INT NOT NULL DEFAULT 1,
  created_by      UUID REFERENCES users(id),
  updated_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_order ON projects(order_no);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

-- 프로젝트 멤버 (PL + 참여자)
CREATE TABLE IF NOT EXISTS project_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  VARCHAR(100) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        VARCHAR(20) NOT NULL DEFAULT 'assignee'
              CHECK (role IN ('pl','assignee')),
  assigned_by UUID REFERENCES users(id),
  assigned_at TIMESTAMPTZ DEFAULT now(),
  released_at TIMESTAMPTZ,
  UNIQUE(project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_pm_project ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_pm_user ON project_members(user_id);

-- 마일스톤
CREATE TABLE IF NOT EXISTS milestones (
  id          VARCHAR(100) PRIMARY KEY,
  project_id  VARCHAR(100) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  start_date  VARCHAR(10),
  end_date    VARCHAR(10),
  status      VARCHAR(20) DEFAULT 'waiting',
  sort_order  INT DEFAULT 0,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones(project_id);

-- 이벤트(일정)
CREATE TABLE IF NOT EXISTS events (
  id           VARCHAR(100) PRIMARY KEY,
  title        VARCHAR(255) NOT NULL,
  type         VARCHAR(20) DEFAULT 'etc',
  start_date   VARCHAR(10),
  end_date     VARCHAR(10),
  project_ids  JSONB DEFAULT '[]',
  assignees    JSONB DEFAULT '[]',
  color        VARCHAR(20),
  memo         TEXT,
  repeat       VARCHAR(20),
  repeat_until VARCHAR(10),
  version      INT NOT NULL DEFAULT 1,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_date);

-- 진척률 히스토리
CREATE TABLE IF NOT EXISTS progress_history (
  id           VARCHAR(200) PRIMARY KEY,
  project_id   VARCHAR(100) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date         VARCHAR(10),
  progress     INT DEFAULT 0,
  actual_hours NUMERIC(10,1) DEFAULT 0,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_progress_project ON progress_history(project_id);
CREATE INDEX IF NOT EXISTS idx_progress_date ON progress_history(date);

-- 수주 대장
CREATE TABLE IF NOT EXISTS orders (
  order_no    VARCHAR(100) PRIMARY KEY,
  date        VARCHAR(10),
  client      VARCHAR(255),
  name        VARCHAR(255),
  amount      NUMERIC(15,0) DEFAULT 0,
  manager     VARCHAR(100),
  delivery    VARCHAR(10),
  memo        TEXT,
  version     INT NOT NULL DEFAULT 1,
  created_by  UUID REFERENCES users(id),
  updated_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_client ON orders(client);

-- 체크리스트
CREATE TABLE IF NOT EXISTS checklists (
  id          VARCHAR(100) PRIMARY KEY,
  project_id  VARCHAR(100) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase       VARCHAR(20),
  items       JSONB DEFAULT '[]',
  version     INT NOT NULL DEFAULT 1,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checklists_project ON checklists(project_id);

-- 이슈
CREATE TABLE IF NOT EXISTS issues (
  id            VARCHAR(100) PRIMARY KEY,
  project_id    VARCHAR(100),
  order_no      VARCHAR(100),
  phase         VARCHAR(20),
  dept          VARCHAR(50),
  type          VARCHAR(20),
  urgency       VARCHAR(20) DEFAULT 'normal',
  status        VARCHAR(20) DEFAULT 'open',
  report_date   VARCHAR(10),
  due_date      VARCHAR(10),
  title         VARCHAR(500) NOT NULL,
  description   TEXT,
  reporter      VARCHAR(100),
  reporter_id   UUID REFERENCES users(id),
  assignees     JSONB DEFAULT '[]',
  tags          JSONB DEFAULT '[]',
  resolution    TEXT,
  resolved_date VARCHAR(10),
  version       INT NOT NULL DEFAULT 1,
  created_by    UUID REFERENCES users(id),
  updated_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_id);
CREATE INDEX IF NOT EXISTS idx_issues_order ON issues(order_no);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
CREATE INDEX IF NOT EXISTS idx_issues_urgency ON issues(urgency);

-- 이슈 대응 이력
CREATE TABLE IF NOT EXISTS issue_logs (
  id         VARCHAR(100) PRIMARY KEY,
  issue_id   VARCHAR(100) NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  date       VARCHAR(10),
  content    TEXT,
  author     VARCHAR(100),
  author_id  UUID REFERENCES users(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_issue_logs_issue ON issue_logs(issue_id);

-- 업무일지 아카이브
CREATE TABLE IF NOT EXISTS work_archives (
  id             VARCHAR(100) PRIMARY KEY,
  label          VARCHAR(255),
  date_range     JSONB DEFAULT '[]',
  selected_names JSONB DEFAULT '[]',
  total_hours    NUMERIC(10,1) DEFAULT 0,
  data           JSONB DEFAULT '[]',
  saved_at       TIMESTAMPTZ,
  uploaded_by    UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- 업무일지 레코드
CREATE TABLE IF NOT EXISTS work_records (
  id        SERIAL PRIMARY KEY,
  date      VARCHAR(10),
  name      VARCHAR(100),
  order_no  VARCHAR(100),
  hours     NUMERIC(5,1) DEFAULT 0,
  task_type VARCHAR(20),
  abbr      VARCHAR(10),
  content   TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wr_date ON work_records(date);
CREATE INDEX IF NOT EXISTS idx_wr_name ON work_records(name);
CREATE INDEX IF NOT EXISTS idx_wr_order ON work_records(order_no);

-- 프로젝트 문서 폴더
CREATE TABLE IF NOT EXISTS project_folders (
  id          VARCHAR(100) PRIMARY KEY,
  project_id  VARCHAR(100),
  parent_id   VARCHAR(100),
  name        VARCHAR(255) NOT NULL,
  memo        TEXT,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_folders_project ON project_folders(project_id);

-- 프로젝트 문서 파일 (메타데이터 — 바이너리는 GCS)
CREATE TABLE IF NOT EXISTS project_files (
  id            VARCHAR(100) PRIMARY KEY,
  project_id    VARCHAR(100),
  folder_id     VARCHAR(100) REFERENCES project_folders(id) ON DELETE SET NULL,
  name          VARCHAR(500) NOT NULL,
  ext           VARCHAR(20),
  size          BIGINT DEFAULT 0,
  mime_type     VARCHAR(255),
  storage_key   VARCHAR(500),
  text_cache    TEXT,
  tags          JSONB DEFAULT '[]',
  memo          TEXT,
  summary_history JSONB DEFAULT '[]',
  version_history JSONB DEFAULT '[]',
  uploaded_by   UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_files_project ON project_files(project_id);
CREATE INDEX IF NOT EXISTS idx_files_folder ON project_files(folder_id);

-- 편집 잠금 (실시간 충돌 방지)
CREATE TABLE IF NOT EXISTS edit_locks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type VARCHAR(50) NOT NULL,
  resource_id   VARCHAR(100) NOT NULL,
  user_id      UUID NOT NULL REFERENCES users(id),
  user_name    VARCHAR(100),
  locked_at    TIMESTAMPTZ DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  UNIQUE(resource_type, resource_id)
);

CREATE INDEX IF NOT EXISTS idx_locks_resource ON edit_locks(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_locks_expires ON edit_locks(expires_at);
