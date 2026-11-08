-- v13.376 💬 인용 답장 (카톡 '답장') — 본 대화 흐름 안에서 원문을 붙여 답함. 답글 줄기(reply_to)와 따로
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS quote_id BIGINT;
