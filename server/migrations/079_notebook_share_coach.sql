-- 079_notebook_share_coach.sql (v13.317 · v13.318)
-- 👥 노트 공유(읽기 전용) · ✍️ 글쓰기 코치 기록
CREATE TABLE IF NOT EXISTS nb_shares (
  note_id     VARCHAR(40) NOT NULL REFERENCES nb_notes(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (note_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_nb_shares_user ON nb_shares (tenant_id, user_id);

-- 노트 · 날마다 한 줄 (같은 날 다시 점검하면 덮어씀) — 점수 · 버릇 개수 · 글자 수
CREATE TABLE IF NOT EXISTS nb_coach_logs (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id     VARCHAR(60) NOT NULL,                   -- 노트 id 또는 'weekly' 등 (주간 업무 작성)
  day         DATE NOT NULL,
  kind        VARCHAR(20),
  scores      JSONB NOT NULL DEFAULT '{}'::jsonb,     -- { clarity, concise, structure, evidence, total }
  counts      JSONB NOT NULL DEFAULT '{}'::jsonb,     -- { 버릇 key: 횟수 }
  chars       INT NOT NULL DEFAULT 0,
  ai          BOOLEAN NOT NULL DEFAULT FALSE,
  task        TEXT,                                   -- AI 가 준 연습 과제
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, note_id, day)
);
CREATE INDEX IF NOT EXISTS idx_nb_coach_user ON nb_coach_logs (tenant_id, user_id, day DESC);
