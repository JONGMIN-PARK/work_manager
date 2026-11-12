-- v13.460 📊 주간 분석 › 분석 — 🎯 목표 분장 비율 (팀 · 부서 · 개인)
--   scope: team(key '*' = 팀 전체) | dept(key = 부서 이름) | person(key = 업무일지 이름)
--   mix  : { "D": 60, "A": 15, ... } — 휴가 뺀 업무 시간 중 분장별 목표 %, 적지 않은 분장은 목표 없음
--   쓰기 = 관리자 · 임원 · 팀장 / 읽기 = 모두 (팀원은 팀 · 부서 + 본인 것만)
CREATE TABLE IF NOT EXISTS wa_targets (
  tenant_id   UUID NOT NULL,
  scope       VARCHAR(10) NOT NULL,
  key         VARCHAR(100) NOT NULL,
  mix         JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by  UUID,
  updated_name VARCHAR(100) NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, scope, key)
);
