-- v13.365 🏭 장비 단위 연결 — 장비마다 대화방 하나(equip_key) · 요청 글은 장비 마스터와 이어 둘 수 있음(post.equipId)
--   equip_key = 'm:<as_equipment_master.id>' (장비 마스터) 또는 'n:<이름 소문자>' (글에 적힌 장비 이름)
ALTER TABLE chat_rooms ADD COLUMN IF NOT EXISTS equip_key VARCHAR(160);
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_room_equip ON chat_rooms(tenant_id, equip_key) WHERE equip_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_msg_post_equip ON chat_messages(lower(post->>'equip')) WHERE post IS NOT NULL;
