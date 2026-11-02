-- 078_notebook.sql (v13.316)
-- 📓 노트북 — 마크다운 노트 · 폴더 · 태그 · 고정 · 즐겨찾기 · 낙서장(inbox) · ✍️ 손글씨(ink) · 고친 기록 · 첨부
-- 본인만 보고 고친다 (공유는 다음 단계). 예전 📝 일일 노트(my_notes)는 그대로 두고 노트북에서 같이 보여 줌.
CREATE TABLE IF NOT EXISTS nb_folders (
  id          VARCHAR(40) PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(80) NOT NULL,
  color       VARCHAR(20),
  icon        VARCHAR(16),
  sort        INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_nb_folders_user ON nb_folders (tenant_id, user_id);

CREATE TABLE IF NOT EXISTS nb_notes (
  id          VARCHAR(40) PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id   VARCHAR(40) REFERENCES nb_folders(id) ON DELETE SET NULL,
  title       VARCHAR(300) NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  ink         JSONB NOT NULL DEFAULT '{}'::jsonb,      -- { blocks: { <id>: { h, s:[획] } }, over: { s:[획] } }
  tags        JSONB NOT NULL DEFAULT '[]'::jsonb,
  pinned      BOOLEAN NOT NULL DEFAULT FALSE,
  starred     BOOLEAN NOT NULL DEFAULT FALSE,
  inbox       BOOLEAN NOT NULL DEFAULT FALSE,          -- 📥 낙서장 (빨리 적기 · 텔레그램 /memo · 메신저에서 보낸 것)
  source      VARCHAR(20),                             -- web · quick · telegram · chat
  words       INT NOT NULL DEFAULT 0,
  rev         INT NOT NULL DEFAULT 1,                  -- 저장마다 +1 — 다른 창 · 기기에서 고친 것과 엇갈리면 409
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_nb_notes_user ON nb_notes (tenant_id, user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS nb_versions (
  id          BIGSERIAL PRIMARY KEY,
  note_id     VARCHAR(40) NOT NULL REFERENCES nb_notes(id) ON DELETE CASCADE,
  title       VARCHAR(300) NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  ink         JSONB,
  words       INT NOT NULL DEFAULT 0,
  label       VARCHAR(80),                             -- 직접 남긴 버전 이름 (자동은 NULL)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_nb_versions_note ON nb_versions (note_id, id DESC);

CREATE TABLE IF NOT EXISTS nb_files (
  id          VARCHAR(40) PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id     VARCHAR(40),
  name        VARCHAR(200) NOT NULL,
  mime        VARCHAR(120),
  size        INT NOT NULL DEFAULT 0,
  storage_key TEXT,
  data        BYTEA,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_nb_files_user ON nb_files (tenant_id, user_id);
