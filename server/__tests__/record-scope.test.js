/**
 * lib/record-scope.js 단위 테스트 — 역할별 업무일지 범위 (DB 불필요)
 */
var { recordScope } = require('../lib/record-scope');

var T = 'tenant-1';
function req(role, opts) {
  opts = opts || {};
  return {
    user: { role: role, sub: opts.sub || 'user-1', departmentId: opts.dept === undefined ? null : opts.dept },
    tenant: { id: T }
  };
}

describe('recordScope', function () {
  test('admin → 테넌트 전체', function () {
    var s = recordScope(req('admin', { dept: 'd1' }));
    expect(s).toEqual({ where: 'tenant_id = $1', params: [T], nextIdx: 2, scope: 'tenant' });
  });

  test.each(['manager', 'executive'])('%s + 부서 → 부서 사용자 레코드', function (role) {
    var s = recordScope(req(role, { dept: 'd1' }));
    expect(s.where).toBe('tenant_id = $1 AND user_id IN (SELECT id FROM users WHERE department_id = $2)');
    expect(s.params).toEqual([T, 'd1']);
    expect(s.nextIdx).toBe(3);
    expect(s.scope).toBe('department');
  });

  test.each(['manager', 'executive'])('%s 부서 없음 → 본인만', function (role) {
    var s = recordScope(req(role, { sub: 'u9' }));
    expect(s).toEqual({ where: 'tenant_id = $1 AND user_id = $2', params: [T, 'u9'], nextIdx: 3, scope: 'self' });
  });

  test('member (부서 있어도) → 본인만, 주인 없는(user_id NULL) 행 불포함', function () {
    var s = recordScope(req('member', { sub: 'u2', dept: 'd1' }));
    expect(s).toEqual({ where: 'tenant_id = $1 AND user_id = $2', params: [T, 'u2'], nextIdx: 3, scope: 'self' });
    expect(s.where).not.toMatch(/IS NULL/);
  });

  test('alias · startIdx', function () {
    var s = recordScope(req('manager', { dept: 'd1' }), { alias: 'w', startIdx: 12 });
    expect(s.where).toBe('w.tenant_id = $12 AND w.user_id IN (SELECT id FROM users WHERE department_id = $13)');
    expect(s.nextIdx).toBe(14);
    var a = recordScope(req('admin'), { alias: 'w', startIdx: 5 });
    expect(a.where).toBe('w.tenant_id = $5');
    expect(a.nextIdx).toBe(6);
  });

  test.each(['admin', 'manager', 'executive', 'member'])('forceSelf: %s → 본인만', function (role) {
    var s = recordScope(req(role, { sub: 'me', dept: 'd1' }), { forceSelf: true });
    expect(s.scope).toBe('self');
    expect(s.params).toEqual([T, 'me']);
  });

  test('hasTenantColumn=false (구배포) → user_id 만', function () {
    var s = recordScope(req('admin', { sub: 'me' }), { hasTenantColumn: false });
    expect(s).toEqual({ where: 'user_id = $1', params: ['me'], nextIdx: 2, scope: 'self' });
  });
});
