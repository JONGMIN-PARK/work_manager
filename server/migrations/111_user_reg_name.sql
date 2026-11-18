-- v13.530 등록 이름 — 프로필에서 이름을 바꿔도 처음 이름을 남겨 'Alex(박종민)' 처럼 함께 보여 줌 (업무 보내기 · 요청 카드)
--   프로필 PUT 이 이름을 바꿀 때 reg_name 이 비어 있으면 바뀌기 전 이름을 넣음. 지금 사용자는 지금 이름으로 채움
ALTER TABLE users ADD COLUMN IF NOT EXISTS reg_name VARCHAR(100);
UPDATE users SET reg_name = name WHERE reg_name IS NULL;
