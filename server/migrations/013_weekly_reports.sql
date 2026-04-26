-- 013_weekly_reports.sql
-- 주간업무보고 JSON 적재 테이블 (관리자 전용)
-- weekly_report 도구로 작성된 주차별 보고서를 누적 저장하여 검색/통계에 사용

CREATE TABLE IF NOT EXISTS weekly_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES tenants(id),
  name TEXT NOT NULL,
  team TEXT,
  week_label TEXT,
  week_start DATE,
  week_end DATE,
  saved_at TIMESTAMPTZ,
  last_text TEXT,
  cur_text TEXT,
  parsed JSONB DEFAULT '{}'::jsonb,
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_weekly_reports_tenant_name
  ON weekly_reports(tenant_id, name);

CREATE INDEX IF NOT EXISTS idx_weekly_reports_week_start
  ON weekly_reports(tenant_id, week_start DESC);

CREATE INDEX IF NOT EXISTS idx_weekly_reports_text_gin
  ON weekly_reports USING GIN (
    to_tsvector('simple', coalesce(cur_text, '') || ' ' || coalesce(last_text, ''))
  );

CREATE INDEX IF NOT EXISTS idx_weekly_reports_parsed_gin
  ON weekly_reports USING GIN (parsed jsonb_path_ops);
