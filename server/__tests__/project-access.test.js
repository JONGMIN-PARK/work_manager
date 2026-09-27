/**
 * lib/project-access.js 단위 테스트 — SQL 조각 생성 + DB 없이 판정 가능한 경로
 * (DB 가 필요한 경로는 refactor-consolidation.test.js 에서 실제 데이터로 검증)
 */
var pa = require('../lib/project-access');

var T = '00000000-0000-0000-0000-0000000000f1';
function req(role, opts) {
  opts = opts || {};
  return {
    user: { role: role, sub: opts.sub || 'u-me', departmentId: opts.dept || null },
    tenant: { id: T },
    _operatorAll: opts.operatorAll
  };
}

describe('visibleProjectsSql', function () {
  test('admin → TRUE (테넌트 전체), 파라미터 없음', function () {
    expect(pa.visibleProjectsSql(req('admin', { dept: 'd1' }), 'p', 3)).toEqual({ sql: 'TRUE', params: [], nextIdx: 3 });
  });
  test('전체보기 운영자(_operatorAll) → TRUE', function () {
    expect(pa.visibleProjectsSql(req('member', { operatorAll: true }), 'p', 1).sql).toBe('TRUE');
  });
  test.each(['manager', 'executive', 'member'])('%s + 부서 → owner/tenant/dept/멤버', function (role) {
    var v = pa.visibleProjectsSql(req(role, { dept: 'd1' }), 'x', 2);
    expect(v.params).toEqual(['u-me', 'd1']);
    expect(v.nextIdx).toBe(4);
    expect(v.sql).toContain('x.owner_id = $2');
    expect(v.sql).toContain("x.visibility = 'tenant'");
    expect(v.sql).toContain("(x.visibility = 'dept' AND x.department_id = $3)");
    expect(v.sql).toContain('_pm.project_id = x.id AND _pm.user_id = $2 AND _pm.released_at IS NULL');
  });
  test('부서 없음 → dept 조건 없음', function () {
    var v = pa.visibleProjectsSql(req('member'), 'p', 1);
    expect(v.params).toEqual(['u-me']);
    expect(v.nextIdx).toBe(2);
    expect(v.sql).not.toContain("'dept'");
  });
  test('executive 는 읽기 우회 없음 (가시성 룰 적용)', function () {
    expect(pa.visibleProjectsSql(req('executive'), 'p', 1).sql).not.toBe('TRUE');
  });
});

describe('editableProjectsSql', function () {
  test.each(['admin', 'executive'])('%s → TRUE', function (role) {
    expect(pa.editableProjectsSql(req(role), 'p', 4)).toEqual({ sql: 'TRUE', params: [], nextIdx: 4 });
  });
  test.each(['manager', 'member'])('%s → owner 또는 활성 멤버 (가시성 무관)', function (role) {
    var e = pa.editableProjectsSql(req(role, { dept: 'd1' }), 'p', 4);
    expect(e.params).toEqual(['u-me']);
    expect(e.nextIdx).toBe(5);
    expect(e.sql).toContain('p.owner_id = $4');
    expect(e.sql).not.toContain('visibility');
  });
});

describe('accessibleProjectsSubquery / accessibleOrderNosSubquery', function () {
  test('admin → 테넌트 조건만', function () {
    var s = pa.accessibleProjectsSubquery(req('admin'), 2);
    expect(s).toEqual({ sql: 'SELECT p.id FROM projects p WHERE p.tenant_id = $2 AND TRUE', params: [T], nextIdx: 3 });
  });
  test('member + 부서 → [tenant, user, dept]', function () {
    var s = pa.accessibleProjectsSubquery(req('member', { dept: 'd1' }), 3);
    expect(s.params).toEqual([T, 'u-me', 'd1']);
    expect(s.nextIdx).toBe(6);
    expect(s.sql).toMatch(/^SELECT p\.id FROM projects p WHERE p\.tenant_id = \$3 AND \(p\.owner_id = \$4/);
  });
  test('orderNos: 빈 수주번호 제외', function () {
    var s = pa.accessibleOrderNosSubquery(req('manager'), 1);
    expect(s.sql).toContain("p.order_no IS NOT NULL AND p.order_no <> ''");
    expect(s.params).toEqual([T, 'u-me']);
  });
  test('middleware/project-scope 는 같은 구현을 다시 내보낸다', function () {
    var ps = require('../middleware/project-scope');
    expect(ps.accessibleProjectsSubquery).toBe(pa.accessibleProjectsSubquery);
    expect(ps.accessibleOrderNosSubquery).toBe(pa.accessibleOrderNosSubquery);
  });
});

describe('canRead / canEdit — DB 없이 결정되는 경로', function () {
  var base = { id: 'p1', owner_id: 'someone', visibility: 'private', department_id: 'd1' };
  test('admin: 읽기·편집 모두 허용', async function () {
    expect(await pa.canRead(req('admin'), base)).toBe(true);
    expect(await pa.canEdit(req('admin'), base)).toBe(true);
  });
  test('executive: 편집 허용(관리자 계층)', async function () {
    expect(await pa.canEdit(req('executive'), base)).toBe(true);
  });
  test.each(['manager', 'executive', 'member'])('%s owner → 읽기·편집', async function (role) {
    var p = Object.assign({}, base, { owner_id: 'u-me' });
    expect(await pa.canRead(req(role), p)).toBe(true);
    expect(await pa.canEdit(req(role), p)).toBe(true);
  });
  test.each(['manager', 'executive', 'member'])('%s: visibility=tenant → 읽기 허용', async function (role) {
    expect(await pa.canRead(req(role), Object.assign({}, base, { visibility: 'tenant' }))).toBe(true);
  });
  test.each(['manager', 'executive', 'member'])('%s: visibility=dept 부서 일치 → 읽기 허용', async function (role) {
    expect(await pa.canRead(req(role, { dept: 'd1' }), Object.assign({}, base, { visibility: 'dept' }))).toBe(true);
  });
  test('opts.isMember=true → 읽기 허용 (DB 조회 생략)', async function () {
    expect(await pa.canRead(req('member'), base, { isMember: true })).toBe(true);
  });
  test('null 프로젝트 → false', async function () {
    expect(await pa.canRead(req('admin'), null)).toBe(false);
    expect(await pa.canEdit(req('admin'), null)).toBe(false);
  });
});
