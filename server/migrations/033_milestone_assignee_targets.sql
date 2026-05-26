-- 마일스톤별 인원 목표시간 배분
-- { "홍길동": 40, "김철수": 20 } 형태의 이름→목표시간(h) 맵.
-- 투입실적 탭에서 담당자별 "누적 실적 vs 목표" 표시에 사용.
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS assignee_targets JSONB DEFAULT '{}'::jsonb;
