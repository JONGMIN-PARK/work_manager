-- 050_tech_usages.sql
-- 요소기술 적용 이력 — PRD_요소기술_개발관리 Phase 2
-- 어느 프로젝트/사전검토에 이 기술이 쓰였는지. 재사용률과 "보유기술 판단 근거"의 핵심.
--
-- target_id 는 projects.id 또는 prestudies.id 를 가리키지만 FK를 걸지 않는다.
-- (대상 종류가 둘이라 단일 FK가 불가능하고, 대상이 삭제돼도 적용 이력 자체는 보존해야 함.
--  조회 시 LEFT JOIN 으로 소실 대상을 표시한다.)

CREATE TABLE IF NOT EXISTS tech_usages (
  id          VARCHAR(100) PRIMARY KEY,
  tenant_id   UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES tenants(id),
  tech_id     VARCHAR(100) NOT NULL REFERENCES tech_assets(id) ON DELETE CASCADE,
  target_type VARCHAR(20) NOT NULL,
  target_id   VARCHAR(100) NOT NULL,
  note        TEXT,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tech_usage ON tech_usages (tech_id, target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_tech_usage_target ON tech_usages (tenant_id, target_type, target_id);
