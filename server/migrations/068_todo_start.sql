-- 068_todo_start.sql (v13.271)
-- 개인 할 일 시작일 — 내 업무 타임라인에서 시작 ~ 마감 막대로 (없으면 마감 점)
ALTER TABLE my_todos ADD COLUMN IF NOT EXISTS start_date VARCHAR(10);
