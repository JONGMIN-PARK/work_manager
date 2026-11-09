-- v13.409 🖼 나만 보는 회전 — 휴대폰 사진이 가로 · 세로 · 비스듬히 제각각이라, 각자 돌려 둔 각도를 사람마다 따로 기억
--   angle: 0~360 (0.1° 단위, 비스듬히 바로잡기 포함) · fill: 비스듬히 돌렸을 때 빈 모서리를 잘라 채울지
CREATE TABLE IF NOT EXISTS chat_file_views (
  user_id     UUID NOT NULL,
  file_id     VARCHAR(40) NOT NULL REFERENCES chat_files(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL,
  angle       REAL NOT NULL DEFAULT 0,
  fill        BOOLEAN NOT NULL DEFAULT false,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, file_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_file_views_file ON chat_file_views(file_id);
