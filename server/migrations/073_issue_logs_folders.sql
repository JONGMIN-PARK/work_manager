-- 073_issue_logs_folders.sql
-- 1) 이슈 대응 이력: 화면이 보내던 유형·시각·부서·첨부 메모가 컬럼이 없어 버려지던 것 → 컬럼 추가
-- 2) 문서 폴더: 기본 단계 폴더 표시(phase)·순서(sort_order) 컬럼이 없어
--    '기본 단계 폴더 삭제 금지'가 동작하지 않고 폴더가 이름순으로 섞이던 것 → 컬럼 추가 + 기존 기본 폴더 채우기
-- 3) 단계 키 as → done (072) 의 남은 흔적: 기본 폴더 이름 'A/S' → '완료'
--    (그 프로젝트 최상위에 기본 단계 폴더 5개가 모두 있을 때만 = 자동 생성된 기본 폴더로 확실할 때만)
-- 매 기동 시 다시 돌아도 되게(멱등) 작성.
BEGIN;

ALTER TABLE issue_logs ADD COLUMN IF NOT EXISTS log_time VARCHAR(5);
ALTER TABLE issue_logs ADD COLUMN IF NOT EXISTS type VARCHAR(20);
ALTER TABLE issue_logs ADD COLUMN IF NOT EXISTS dept VARCHAR(50);
ALTER TABLE issue_logs ADD COLUMN IF NOT EXISTS attachment_note TEXT;

ALTER TABLE project_folders ADD COLUMN IF NOT EXISTS phase VARCHAR(20);
ALTER TABLE project_folders ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;

-- 기본 단계 폴더 5개(수주·설계·제작·검수·납품)가 최상위에 모두 있는 프로젝트
CREATE TEMP TABLE _wm073_proj ON COMMIT DROP AS
  SELECT tenant_id, project_id FROM project_folders
   WHERE parent_id IS NULL AND project_id IS NOT NULL AND name IN ('수주','설계','제작','검수','납품')
   GROUP BY tenant_id, project_id
  HAVING COUNT(DISTINCT name) = 5;

-- A/S → 완료 (같은 프로젝트에 '완료' 최상위 폴더가 이미 있으면 건드리지 않음)
UPDATE project_folders f SET name = '완료', updated_at = now()
  FROM _wm073_proj p
 WHERE f.tenant_id = p.tenant_id AND f.project_id = p.project_id AND f.parent_id IS NULL AND f.name = 'A/S'
   AND NOT EXISTS (SELECT 1 FROM project_folders x WHERE x.tenant_id = f.tenant_id AND x.project_id = f.project_id
                    AND x.parent_id IS NULL AND x.name = '완료');

-- 기본 폴더에 단계 키·순서 채우기 (아직 비어 있는 것만)
UPDATE project_folders f SET phase = v.k, sort_order = v.o
  FROM _wm073_proj p,
       (VALUES ('수주','order',0),('설계','design',1),('제작','manufacture',2),('검수','inspect',3),('납품','deliver',4),('완료','done',5)) AS v(n, k, o)
 WHERE f.tenant_id = p.tenant_id AND f.project_id = p.project_id AND f.parent_id IS NULL
   AND f.name = v.n AND f.phase IS NULL;

COMMIT;
