-- 046_drop_project_reviews.sql
-- project_reviews 제거 — 프로젝트 하위 "검토" 탭은 폐기되고,
-- 프로젝트 이전 단계를 다루는 독립 모듈 "사전검토(prestudies)"로 대체됨(047).

DROP TABLE IF EXISTS project_reviews;
