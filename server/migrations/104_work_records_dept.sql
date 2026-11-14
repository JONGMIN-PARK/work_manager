-- 104_work_records_dept.sql (v13.498)
-- 업무일지 사업부 — 파일을 불러올 때 고른(또는 파일 이름으로 알아낸) 사업부를 서버에도 저장.
--   예전엔 브라우저에서만 붙이고 저장하지 않아, 서버에서 받은 업무일지는 사업부가 비어 주간 분석의 🏢 사업부 단추 · 필터가 사라졌다.
--   비어 있는 기록은 서버가 내려 줄 때 작성자 이름 → 사용자 부서(departments.name)로 채움 (lib/record-dept.js).
-- 매 기동 시 다시 돌아도 되게(멱등) 작성.
ALTER TABLE work_records ADD COLUMN IF NOT EXISTS dept VARCHAR(100);
