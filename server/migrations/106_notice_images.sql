-- v13.514 📢 공지사항 그림 — 공지에 붙인 캡처 · 사진 (본문의 [그림1] 자리에, 안 쓴 것은 본문 아래에)
--   목록을 가볍게 하려고 따로 둔다 — 공지를 펼칠 때만 GET /api/notices/:id/images 로 받는다
CREATE TABLE IF NOT EXISTS notice_images (
  id         BIGSERIAL PRIMARY KEY,
  notice_id  BIGINT NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
  idx        INT NOT NULL DEFAULT 0,
  src        TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notice_images_notice ON notice_images(notice_id, idx);
