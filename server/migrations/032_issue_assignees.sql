-- ============================================================
-- 032_issue_assignees.sql
-- issues.assignees JSONB → 정규화 매핑 테이블(공존 모드)
-- - 기존 issues.assignees JSONB 컬럼은 유지 (호환)
-- - issue_assignees 신규 테이블 + 트리거로 자동 동기화
-- - 백필: 기존 데이터를 풀어 한 번 채움
-- - 텔레그램 LIKE '%name%' 패턴이 user_id/정확이름 매칭으로 교체 가능
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS issue_assignees (
  id            BIGSERIAL PRIMARY KEY,
  issue_id      VARCHAR(100) NOT NULL,
  assignee_name VARCHAR(100) NOT NULL,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(issue_id, assignee_name)
);

-- issues.id가 VARCHAR(100) PK — FK는 통상 CREATE TABLE에서 잡지만,
-- issues 테이블이 기존에 정의돼 있어 ALTER로 분리(타입 충돌 회피).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'issue_assignees_issue_fk'
  ) THEN
    ALTER TABLE issue_assignees
      ADD CONSTRAINT issue_assignees_issue_fk
      FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_issue_assignees_user
  ON issue_assignees(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_issue_assignees_name
  ON issue_assignees(assignee_name);
CREATE INDEX IF NOT EXISTS idx_issue_assignees_tenant
  ON issue_assignees(tenant_id);
CREATE INDEX IF NOT EXISTS idx_issue_assignees_issue
  ON issue_assignees(issue_id);

-- 트리거 함수: issues.assignees JSONB 변경 시 자동 동기화
-- - 문자열 배열 ["이름1","이름2"] 와 객체 배열 [{"name":"이름1"},...] 모두 처리
-- - tenant 내 동일 이름 active 사용자 1건만 있을 때 user_id 자동 매핑
-- - 동명이인 또는 매핑 불가 시 user_id = NULL (이름만 보존)
CREATE OR REPLACE FUNCTION sync_issue_assignees() RETURNS TRIGGER AS $func$
DECLARE
  v_elem JSONB;
  v_name TEXT;
  v_user_id UUID;
  v_arr JSONB;
BEGIN
  -- 기존 매핑 정리
  DELETE FROM issue_assignees WHERE issue_id = NEW.id;
  v_arr := COALESCE(NEW.assignees, '[]'::jsonb);
  IF jsonb_typeof(v_arr) <> 'array' THEN
    RETURN NEW;
  END IF;
  FOR v_elem IN SELECT * FROM jsonb_array_elements(v_arr) LOOP
    IF jsonb_typeof(v_elem) = 'string' THEN
      v_name := v_elem #>> '{}';
    ELSIF jsonb_typeof(v_elem) = 'object' THEN
      v_name := COALESCE(v_elem ->> 'name', v_elem ->> 'userName', v_elem ->> 'user_name');
    ELSE
      CONTINUE;
    END IF;
    IF v_name IS NULL OR v_name = '' THEN CONTINUE; END IF;

    v_user_id := NULL;
    SELECT u.id INTO v_user_id
      FROM users u
     WHERE u.tenant_id = NEW.tenant_id
       AND u.name = v_name
       AND u.status = 'active'
     LIMIT 1;

    INSERT INTO issue_assignees (issue_id, assignee_name, user_id, tenant_id)
    VALUES (NEW.id, v_name, v_user_id, NEW.tenant_id)
    ON CONFLICT (issue_id, assignee_name) DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$func$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_issue_assignees ON issues;
CREATE TRIGGER trg_sync_issue_assignees
  AFTER INSERT OR UPDATE OF assignees ON issues
  FOR EACH ROW
  EXECUTE FUNCTION sync_issue_assignees();

-- 백필: 기존 issues의 assignees JSONB를 풀어 한 번 채움
INSERT INTO issue_assignees (issue_id, assignee_name, user_id, tenant_id)
SELECT
  i.id,
  CASE
    WHEN jsonb_typeof(ae.elem) = 'string' THEN ae.elem #>> '{}'
    WHEN jsonb_typeof(ae.elem) = 'object' THEN COALESCE(ae.elem ->> 'name', ae.elem ->> 'userName')
    ELSE NULL
  END AS assignee_name,
  (SELECT u.id FROM users u
    WHERE u.tenant_id = i.tenant_id
      AND u.name = CASE
        WHEN jsonb_typeof(ae.elem) = 'string' THEN ae.elem #>> '{}'
        WHEN jsonb_typeof(ae.elem) = 'object' THEN COALESCE(ae.elem ->> 'name', ae.elem ->> 'userName')
        ELSE NULL
      END
      AND u.status = 'active'
    LIMIT 1) AS user_id,
  i.tenant_id
FROM issues i,
  LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(COALESCE(i.assignees, '[]'::jsonb)) = 'array'
         THEN i.assignees
         ELSE '[]'::jsonb
    END
  ) AS ae(elem)
WHERE CASE
        WHEN jsonb_typeof(ae.elem) = 'string' THEN ae.elem #>> '{}'
        WHEN jsonb_typeof(ae.elem) = 'object' THEN COALESCE(ae.elem ->> 'name', ae.elem ->> 'userName')
        ELSE NULL
      END IS NOT NULL
ON CONFLICT (issue_id, assignee_name) DO NOTHING;

COMMIT;
