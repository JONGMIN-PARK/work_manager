/**
 * 장비 표준 사양서 (v13.196) — 양식 발행, 사양서 저장 권한, 첨부, 복사, 테넌트 격리
 */
var h = require('./helpers');

var TENANT_C_ID = '00000000-0000-0000-0000-000000000097';

async function cleanupTenantC() {
  var q = function (sql) { return h.db.query(sql, [TENANT_C_ID]).catch(function (e) { console.warn('[cleanupTenantC]', e.message); }); };
  await q('DELETE FROM project_spec_files WHERE tenant_id = $1');
  await q('DELETE FROM spec_template_versions WHERE tenant_id = $1');
  await q('DELETE FROM spec_templates WHERE tenant_id = $1');
  await q('DELETE FROM project_members WHERE tenant_id = $1');
  await q('DELETE FROM projects WHERE tenant_id = $1');
  await q('DELETE FROM audit_logs WHERE tenant_id = $1 OR user_id IN (SELECT id FROM users WHERE tenant_id = $1)');
  await q('DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE tenant_id = $1)');
  await q('DELETE FROM users WHERE tenant_id = $1');
  await q('DELETE FROM tenants WHERE id = $1');
}

var DRAFT = { sections: [{ key: 'mc', label: '모션 컨트롤러', discipline: 'control', items: [
  { key: 'mc_axes', label: '축 수', type: 'number', owner: 'control' },
  { key: 'axes', label: '축 구성', type: 'table', owner: 'design', columns: [{ key: 'name', label: '축', type: 'text', owner: 'design' }] }
] }] };
var PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
var SVG = 'data:image/svg+xml;base64,PHN2Zy8+';

describe('표준 사양서', function () {
  var admin, member, outsider, adminC, projId, proj2Id, tplId;
  function api(user) {
    var agent = h.request(h.app);
    return {
      get: function (u) { return agent.get(u).set('Authorization', 'Bearer ' + user.token); },
      post: function (u, b) { return h.request(h.app).post(u).set('Authorization', 'Bearer ' + user.token).send(b || {}); },
      put: function (u, b) { return h.request(h.app).put(u).set('Authorization', 'Bearer ' + user.token).send(b || {}); },
      patch: function (u) { return h.request(h.app).patch(u).set('Authorization', 'Bearer ' + user.token); },
      del: function (u) { return h.request(h.app).delete(u).set('Authorization', 'Bearer ' + user.token); }
    };
  }

  beforeAll(async function () {
    await h.createTestTenant('spec-a-' + Date.now());
    admin = await h.createTestUser({ role: 'admin', email: 'spec-admin@test.com' });
    member = await h.createTestUser({ role: 'member', email: 'spec-member@test.com' });
    outsider = await h.createTestUser({ role: 'member', email: 'spec-outsider@test.com' });
    await h.db.query("INSERT INTO tenants (id, name, slug, plan, max_users) VALUES ($1, 'Tenant C', $2, 'pro', 50) ON CONFLICT (id) DO NOTHING", [TENANT_C_ID, 'spec-c-' + Date.now()]);
    adminC = await h.createTestUser({ role: 'admin', email: 'spec-adminc@test.com', tenantId: TENANT_C_ID });
    var p1 = await api(admin).post('/api/projects', { name: '사양 대상', status: 'active', visibility: 'tenant' });
    projId = p1.body.data.id;
    var p2 = await api(admin).post('/api/projects', { name: '사양 원본', status: 'active', visibility: 'tenant' });
    proj2Id = p2.body.data.id;
    await h.db.query('INSERT INTO project_members (project_id, user_id, role, tenant_id) VALUES ($1, $2, $3, $4)', [projId, member.user.id, 'assignee', h.TEST_TENANT_ID]);
  });

  afterAll(async function () {
    await cleanupTenantC();
    await h.cleanup();
  });

  test('양식: 관리자만 만들고, 발행하면 버전이 쌓인다', async function () {
    var denied = await api(member).post('/api/spec-templates', { name: 'X', draft: DRAFT });
    expect(denied.status).toBe(403);
    var c = await api(admin).post('/api/spec-templates', { name: '회사 표준', draft: DRAFT });
    expect(c.status).toBe(201);
    expect(c.body.data.is_default).toBe(true);
    tplId = c.body.data.id;
    var p = await api(admin).post('/api/spec-templates/' + tplId + '/publish');
    expect(p.status).toBe(200);
    expect(p.body.data.current_version).toBe(1);
    var v = await api(member).get('/api/spec-templates/' + tplId + '/versions/1');
    expect(v.status).toBe(200);
    expect(v.body.data.schema.sections[0].key).toBe('mc');
    var list = await api(member).get('/api/spec-templates');
    expect(list.body.data.map(function (t) { return t.id; })).toContain(tplId);
  });

  test('양식: 키가 중복된 초안은 발행하지 않는다', async function () {
    var bad = { sections: [{ key: 'a', label: 'A', discipline: 'design', items: [{ key: 'x', label: 'X', type: 'text' }, { key: 'x', label: 'Y', type: 'text' }] }] };
    await api(admin).put('/api/spec-templates/' + tplId, { draft: bad });
    var p = await api(admin).post('/api/spec-templates/' + tplId + '/publish');
    expect(p.status).toBe(400);
    await api(admin).put('/api/spec-templates/' + tplId, { draft: DRAFT });
  });

  test('양식: 다른 테넌트는 볼 수 없다', async function () {
    var v = await api(adminC).get('/api/spec-templates/' + tplId + '/versions/1');
    expect(v.status).toBe(404);
    var list = await api(adminC).get('/api/spec-templates');
    expect(list.body.data.map(function (t) { return t.id; })).not.toContain(tplId);
    var u = await api(adminC).put('/api/spec-templates/' + tplId, { name: 'hijack' });
    expect(u.status).toBe(404);
  });

  test('사양서 저장: 참여자는 가능, 참여하지 않은 멤버는 403', async function () {
    var specs = { v: 2, templateId: tplId, templateVersion: 1, values: { mc_axes: '0', axes: [{ id: 'r1', name: 'X1' }] }, remarks: {}, extra: {} };
    var ok = await api(member).put('/api/projects/' + projId + '/specs', { specs: specs });
    expect(ok.status).toBe(200);
    expect(ok.body.data.specs.values.mc_axes).toBe('0');
    var no = await api(outsider).put('/api/projects/' + projId + '/specs', { specs: specs });
    expect(no.status).toBe(403);
    var bad = await api(member).put('/api/projects/' + projId + '/specs', { specs: [1, 2] });
    expect(bad.status).toBe(400);
  });

  test('첨부: 인라인 이미지·draw.io 등록, 이미지가 아닌 인라인·다른 위치 키는 거절', async function () {
    var img = await api(member).post('/api/projects/' + projId + '/spec-files', { sectionKey: 'mc', kind: 'image', name: 'a.png', data: PNG });
    expect(img.status).toBe(201);
    var notImg = await api(member).post('/api/projects/' + projId + '/spec-files', { sectionKey: 'mc', kind: 'file', name: 'a.pdf', data: 'data:application/pdf;base64,AAAA' });
    expect(notImg.status).toBe(400);
    var badKey = await api(member).post('/api/projects/' + projId + '/spec-files', { sectionKey: 'mc', kind: 'file', name: 'x', storageKey: 'tenants/' + TENANT_C_ID + '/specs/' + projId + '/x.pdf' });
    expect(badKey.status).toBe(400);
    var badSec = await api(member).post('/api/projects/' + projId + '/spec-files', { sectionKey: 'A B', kind: 'image', data: PNG });
    expect(badSec.status).toBe(400);
    var dg = await api(member).post('/api/projects/' + proj2Id + '/spec-files', { sectionKey: 'hw', kind: 'drawio', name: '구조도', drawioXml: '<mxfile/>', previewSvg: SVG });
    expect(dg.status).toBe(403); // 원본 프로젝트의 참여자가 아니다
    var dg2 = await api(admin).post('/api/projects/' + proj2Id + '/spec-files', { sectionKey: 'hw', kind: 'drawio', name: '구조도', drawioXml: '<mxfile/>', previewSvg: SVG });
    expect(dg2.status).toBe(201);
    var up = await api(admin).put('/api/projects/' + proj2Id + '/spec-files/' + dg2.body.data.id, { drawioXml: '<mxfile><diagram/></mxfile>', previewSvg: SVG });
    expect(up.status).toBe(200);
    var list = await api(admin).get('/api/projects/' + proj2Id + '/spec-files');
    expect(list.body.data.length).toBe(1);
    expect(list.body.data[0].drawio_xml).toBeUndefined();   // 목록에는 원본 XML 없음
    var one = await api(admin).get('/api/projects/' + proj2Id + '/spec-files/' + dg2.body.data.id);
    expect(one.body.data.drawio_xml).toBe('<mxfile><diagram/></mxfile>');
    var cross = await api(adminC).get('/api/projects/' + projId + '/spec-files');
    expect(cross.status).toBe(404);
  });

  test('동시 편집: 같은 표의 다른 칸은 병합, 같은 칸은 충돌로 돌려주고 이력을 남긴다', async function () {
    // 둘 다 같은 기준(base)에서 시작: 축 X1 한 행
    var base = { v: 2, templateId: tplId, templateVersion: 1, values: { mc_axes: '2', axes: [{ id: 'r1', name: 'X1', stroke: '300', drv_model: '' }] }, remarks: {}, status: {}, extra: {} };
    var put = await api(admin).put('/api/projects/' + projId + '/specs', { specs: base });
    expect(put.status).toBe(200);
    // 설계(admin): 스트로크 변경 / 전장(member): 드라이브 입력 — 같은 행, 다른 칸
    var a = await api(admin).patch('/api/projects/' + projId + '/specs').send({ changes: [{ path: ['values', 'axes', 'r1', 'stroke'], from: '300', to: '350', label: 'X1 스트로크' }] });
    expect(a.status).toBe(200);
    expect(a.body.applied).toBe(1);
    var b = await api(member).patch('/api/projects/' + projId + '/specs').send({ changes: [
      { path: ['values', 'axes', 'r1', 'drv_model'], from: '', to: 'SGD7S-2R8', label: 'X1 드라이브' },
      { path: ['values', 'axes', 'r1', 'stroke'], from: '300', to: '320', label: 'X1 스트로크' },   // admin 이 먼저 바꿨다 → 충돌
      { path: ['values', 'axes', 'r2'], from: null, to: { id: 'r2', name: 'Y1' }, label: 'Y1 추가' },
      { path: ['status', 'mc_axes'], from: '', to: 'fixed', label: '축 수 상태' }
    ] });
    expect(b.status).toBe(200);
    expect(b.body.applied).toBe(3);
    expect(b.body.conflicts.length).toBe(1);
    expect(b.body.conflicts[0].theirs).toBe('350');
    expect(b.body.conflicts[0].mine).toBe('320');
    var ax = b.body.data.specs.values.axes;
    expect(ax.find(function (r) { return r.id === 'r1'; })).toMatchObject({ stroke: '350', drv_model: 'SGD7S-2R8' });
    expect(ax.find(function (r) { return r.id === 'r2'; }).name).toBe('Y1');
    expect(b.body.data.specs.status.mc_axes).toBe('fixed');
    var hist = await api(member).get('/api/projects/' + projId + '/spec-changes');
    expect(hist.status).toBe(200);
    expect(hist.body.data[0].changes.map(function (c) { return c.label; })).toEqual(['X1 드라이브', 'Y1 추가', '축 수 상태']);
    expect(hist.body.data[1].changes[0].to).toBe('350');
    var no = await api(outsider).patch('/api/projects/' + projId + '/specs').send({ changes: [{ path: ['values', 'mc_axes'], from: '2', to: '9' }] });
    expect(no.status).toBe(403);
    var badPath = await api(member).patch('/api/projects/' + projId + '/specs').send({ changes: [{ path: ['__proto__', 'x'], from: null, to: 1 }] });
    expect(badPath.status).toBe(400);
  });

  test('동시 편집: 이전 형식 문서에 부분 변경이 오면 409, 전체 전환은 기준이 같을 때만', async function () {
    await h.db.query('UPDATE projects SET specs = $1 WHERE id = $2', [JSON.stringify({ design: [{ id: 'x', item: '총 중량', value: '850' }] }), proj2Id]);
    var stale = await api(admin).patch('/api/projects/' + proj2Id + '/specs').send({ changes: [{ path: ['values', 'mc_axes'], from: '', to: '2' }] });
    expect(stale.status).toBe(409);
    var wrongBase = await api(admin).patch('/api/projects/' + proj2Id + '/specs').send({ changes: [{ path: [], from: { design: [] }, to: { v: 2, values: {} } }] });
    expect(wrongBase.body.applied).toBe(0);
    expect(wrongBase.body.conflicts.length).toBe(1);
    var conv = await api(admin).patch('/api/projects/' + proj2Id + '/specs').send({ changes: [{ path: [], from: { design: [{ id: 'x', item: '총 중량', value: '850' }] }, to: { v: 2, templateId: tplId, templateVersion: 1, values: { mech_weight: '850' }, remarks: {}, extra: {} } }] });
    expect(conv.body.applied).toBe(1);
    expect(conv.body.data.specs.v).toBe(2);
  });

  test('복사: 원본 사양서와 draw.io 도면을 가져온다', async function () {
    await api(admin).put('/api/projects/' + proj2Id + '/specs', { specs: { v: 2, templateId: tplId, templateVersion: 1, values: { mc_axes: '4' }, remarks: {}, extra: {} } });
    var r = await api(member).post('/api/projects/' + projId + '/specs/copy-from/' + proj2Id, {});
    expect(r.status).toBe(200);
    expect(r.body.data.specs.values.mc_axes).toBe('4');
    expect(r.body.copiedDrawings).toBe(1);
    var files = await api(member).get('/api/projects/' + projId + '/spec-files');
    expect(files.body.data.filter(function (f) { return f.kind === 'drawio'; }).length).toBe(1);
    var self = await api(member).post('/api/projects/' + projId + '/specs/copy-from/' + projId, {});
    expect(self.status).toBe(400);
  });
});
