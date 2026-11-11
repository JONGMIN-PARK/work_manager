-- v13.444 📢 공지사항 — 관리자 · 지정된 작성자가 쓰고 게시하면 모두에게 알림 · 사람마다 읽음 기록
--   status: draft(임시) | published(게시) · level: normal | important(로그인하면 창으로 띄움)
--   expires_at 이 지나면 목록에서 내려감(관리 화면에는 '끝남' 으로 남음)
CREATE TABLE IF NOT EXISTS notices (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  title         VARCHAR(200) NOT NULL,
  body          TEXT NOT NULL DEFAULT '',
  level         VARCHAR(12) NOT NULL DEFAULT 'normal',
  pinned        BOOLEAN NOT NULL DEFAULT false,
  status        VARCHAR(12) NOT NULL DEFAULT 'draft',
  published_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,
  author_id     UUID NOT NULL,
  author_name   VARCHAR(100) NOT NULL DEFAULT '',
  updated_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notices_tenant ON notices(tenant_id, status, published_at DESC);

CREATE TABLE IF NOT EXISTS notice_reads (
  notice_id  BIGINT NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL,
  read_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (notice_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_notice_reads_user ON notice_reads(user_id);

-- 공지를 쓸 수 있게 지정된 사용자 (관리자는 늘 쓸 수 있음)
CREATE TABLE IF NOT EXISTS notice_writers (
  tenant_id  UUID NOT NULL,
  user_id    UUID NOT NULL,
  added_by   UUID,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
