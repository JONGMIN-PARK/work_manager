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
  // v13.481 업무일지는 회사가 함께 보는 한 벌 — 역할 · 부서와 상관없이 테넌트 전체 (쓰기 권한은 middleware/worklog-manager)
  test.each([['admin', 'd1'], ['manager', 'd1'], ['executive', 'd1'], ['manager', null], ['member', 'd1'], ['member', null]])('%s (부서 %s) → 테넌트 전체', function (role, dept) {
    var s = recordScope(req(role, { dept: dept, sub: 'u2' }));
    expect(s).toEqual({ where: 'tenant_id = $1', params: [T], nextIdx: 2, scope: 'tenant' });
    expect(s.where).not.toMatch(/user_id/);
  });

  test('alias · startIdx', function () {
    var a = recordScope(req('member'), { alias: 'w', startIdx: 5 });
    expect(a.where).toBe('w.tenant_id = $5');
    expect(a.nextIdx).toBe(6);
    var f = recordScope(req('manager', { dept: 'd1', sub: 'me' }), { alias: 'w', startIdx: 12, forceSelf: true });
    expect(f.where).toBe('w.tenant_id = $12 AND w.user_id = $13');
    expect(f.nextIdx).toBe(14);
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
