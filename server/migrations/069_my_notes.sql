-- 069_my_notes.sql (v13.272)
-- 내 업무 📝 노트 — 날짜마다 한 장(ref ''), 그날 회의마다 한 장(ref 'ev:<일정 id>'). 본인만 보고 고친다.
CREATE TABLE IF NOT EXISTS my_notes (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_date   VARCHAR(10) NOT NULL,
  ref         VARCHAR(120) NOT NULL DEFAULT '',
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  body        TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, note_date, ref)
);
CREATE INDEX IF NOT EXISTS idx_my_notes_recent ON my_notes (tenant_id, user_id, updated_at DESC);
