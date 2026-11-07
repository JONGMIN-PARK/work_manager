-- v13.356 메신저 이미지 칠판 — 사진 위 표시(글자 · 형광 · 도형 · 흐리게) · 자르기 · 회전을 원본과 따로 저장
--   annot = { rot: 0|90|180|270, crop: {x,y,w,h}|null, shapes: [{id, t, by, ...}] }  — 좌표는 원본 사진 픽셀 기준
ALTER TABLE chat_files ADD COLUMN IF NOT EXISTS annot JSONB;
ALTER TABLE chat_files ADD COLUMN IF NOT EXISTS annot_at TIMESTAMPTZ;
ALTER TABLE chat_files ADD COLUMN IF NOT EXISTS annot_by UUID;
