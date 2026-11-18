-- v13.534 🤝 함께 하기 — 페어 세션: 방 · 📝 공동 메모 · 걸린 시간 · 요약. 끝내면 참여자 노트 · 연결된 할 일에 기록
CREATE TABLE IF NOT EXISTS pair_sessions (
  id         VARCHAR(40) PRIMARY KEY,
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title      VARCHAR(200) NOT NULL,
  item_key   VARCHAR(160),
  project_id VARCHAR(100),
  room_id    VARCHAR(60),
  doc_id     VARCHAR(60),
  started_by UUID,
  members    UUID[] NOT NULL,
  joined     JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at   TIMESTAMPTZ,
  ended_by   UUID,
  minutes    INTEGER,
  summary    TEXT
);
CREATE INDEX IF NOT EXISTS idx_pair_members ON pair_sessions USING GIN (members);
CREATE INDEX IF NOT EXISTS idx_pair_tenant ON pair_sessions (tenant_id, started_at DESC);
