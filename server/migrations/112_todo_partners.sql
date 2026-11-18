-- v13.533 🤝 같이 담당 — 할 일 하나를 여럿이: 주인(user_id) + 같이 담당(partners). 같이 담당도 내 업무에 보이고 고치기 · 완료 가능
--   지우기(휴지통)는 주인만. 누가 끝내든 한 번에 완료
ALTER TABLE my_todos ADD COLUMN IF NOT EXISTS partners UUID[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_my_todos_partners ON my_todos USING GIN (partners);
