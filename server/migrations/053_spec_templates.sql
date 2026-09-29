-- 053_spec_templates.sql
-- 장비 표준 사양서 (v13.196, P1)
--  · spec_templates         : 회사(테넌트)별 표준 양식. 편집 중인 초안(draft)과 현재 발행 버전 번호.
--  · spec_template_versions : 발행된 양식의 버전별 스냅샷(불변). 사양서는 (template_id, version) 만 참조한다
--                             → 프로젝트 목록 응답에 양식 전체가 실리지 않는다.
--  · project_spec_files     : 사양서 섹션별 첨부(이미지·파일·draw.io 도면).
--                             GCS 가 설정되면 storage_key, 아니면 압축 이미지를 data 에 보관.
--                             draw.io 는 편집용 원본(drawio_xml)과 미리보기(preview_svg, data URI)를 DB 에 둔다.
-- 서버 시작마다 다시 실행되므로 모든 문장은 재실행 안전(IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS spec_templates (
  id              VARCHAR(60) PRIMARY KEY,
  tenant_id       UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES tenants(id),
  name            TEXT NOT NULL,
  description     TEXT,
  draft           JSONB NOT NULL DEFAULT '{}',
  current_version INT NOT NULL DEFAULT 0,
  is_default      BOOLEAN NOT NULL DEFAULT FALSE,
  created_by      UUID,
  updated_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_spec_tpl_tenant ON spec_templates(tenant_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS spec_template_versions (
  template_id  VARCHAR(60) NOT NULL REFERENCES spec_templates(id) ON DELETE CASCADE,
  version      INT NOT NULL,
  tenant_id    UUID NOT NULL REFERENCES tenants(id),
  schema       JSONB NOT NULL,
  published_by UUID,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (template_id, version)
);

CREATE TABLE IF NOT EXISTS project_spec_files (
  id           VARCHAR(60) PRIMARY KEY,
  tenant_id    UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES tenants(id),
  project_id   VARCHAR(100) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  section_key  VARCHAR(60) NOT NULL DEFAULT '',
  kind         VARCHAR(20) NOT NULL,             -- image | file | drawio
  name         TEXT,
  mime         TEXT,
  size         BIGINT,
  storage_key  TEXT,                             -- GCS 객체 키 (tenants/<tenant>/specs/<project>/...)
  data         TEXT,                             -- GCS 미설정 시 압축 이미지 data URI
  drawio_xml   TEXT,
  preview_svg  TEXT,
  caption      TEXT,
  sort_order   INT NOT NULL DEFAULT 0,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_spec_files_proj ON project_spec_files(project_id, section_key, sort_order);
CREATE INDEX IF NOT EXISTS idx_spec_files_tenant ON project_spec_files(tenant_id);
