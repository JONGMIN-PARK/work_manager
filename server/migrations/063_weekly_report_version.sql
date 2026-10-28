-- 063_weekly_report_version.sql (v13.250)
-- 주간업무보고 덮어쓰기 충돌 확인용 버전 — 작성 화면이 불러온 버전과 다르면 409
ALTER TABLE weekly_reports ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
