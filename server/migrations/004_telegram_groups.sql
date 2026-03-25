-- 텔레그램 그룹 채팅방 연동
CREATE TABLE IF NOT EXISTS telegram_group_links (
  id          SERIAL PRIMARY KEY,
  chat_id     BIGINT NOT NULL UNIQUE,
  link_type   VARCHAR(20) NOT NULL,
  link_id     VARCHAR(100),
  linked_by   UUID REFERENCES users(id),
  linked_at   TIMESTAMPTZ DEFAULT NOW(),
  is_active   BOOLEAN DEFAULT TRUE
);
