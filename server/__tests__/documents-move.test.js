/**
 * 문서 넣기 보완 (v13.307)
 *  - ?personal=1 → 프로젝트 없이 내가 올린 것만 (남의 것 · 프로젝트 문서 제외)
 *  - 프로젝트로 옮기기: 올린 사람 + 옮겨 갈 프로젝트 편집권 · 폴더는 그 프로젝트 것만
 *  - 프로젝트 → 내 문서: 올린 사람만
 */
var h = require('./helpers');
var db = h.db;
var T = h.TEST_TENANT_ID;
var S = Date.now();
var owner, other;
var P = 'dm-p-' + S, PX = 'dm-px-' + S, FO = 'dm-fo-' + S, FX = 'dm-fx-' + S;
var MINE = 'dm-mine-' + S, THEIRS = 'dm-theirs-' + S, INPROJ = 'dm-in-' + S;

function api(method, url, who) { return h.request(h.app)[method](url).set('Authorization', 'Bearer ' + who.token); }

beforeAll(async function () {
  await h.cleanup();
  await h.createTestTenant('dm-' + S);
  owner = await h.createTestUser({ email: 'dm-owner-' + S + '@test.com', role: 'member' });
  other = await h.createTestUser({ email: 'dm-other-' + S + '@test.com', role: 'member' });
  await db.query("INSERT INTO projects (id, tenant_id, name, owner_id, visibility) VALUES ($1,$2,'내 프로젝트',$3,'tenant')", [P, T, owner.user.id]);
  await db.query("INSERT INTO projects (id, tenant_id, name, owner_id, visibility) VALUES ($1,$2,'남의 프로젝트',$3,'tenant')", [PX, T, other.user.id]);
  await db.query("INSERT INTO project_folders (id, tenant_id, project_id, name, phase) VALUES ($1,$2,$3,'설계','design')", [FO, T, P]);
  await db.query("INSERT INTO project_folders (id, tenant_id, project_id, name) VALUES ($1,$2,$3,'남의 폴더')", [FX, T, PX]);
  var ins = "INSERT INTO project_files (id, tenant_id, project_id, folder_id, name, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6)";
  await db.query(ins, [MINE, T, null, null, '텔레그램 사진.jpg', owner.user.id]);
  await db.query(ins, [THEIRS, T, null, null, '남의 개인 파일.pdf', other.user.id]);
  await db.query(ins, [INPROJ, T, P, FO, '사양서.pdf', owner.user.id]);
});
afterAll(async function () {
  await db.query('DELETE FROM project_files WHERE tenant_id = $1', [T]);
  await db.query('DELETE FROM project_folders WHERE tenant_id = $1', [T]);
  await h.cleanup();
});

test('?personal=1 — 프로젝트 없이 내가 올린 것만', async function () {
  var r = await api('get', '/api/docs/files?all=true&personal=1', owner);
  expect(r.status).toBe(200);
  expect(r.body.data.map(function (f) { return f.id; })).toEqual([MINE]);
});

test('남의 프로젝트(편집권 없음)로는 못 옮김', async function () {
  var r = await api('put', '/api/docs/files/' + MINE, owner).send({ projectId: PX, folderId: FX });
  expect(r.status).toBe(403);
});

test('다른 프로젝트의 폴더로는 못 옮김', async function () {
  var r = await api('put', '/api/docs/files/' + MINE, owner).send({ projectId: P, folderId: FX });
  expect(r.status).toBe(400);
});

test('내 문서 → 내 프로젝트 설계 폴더', async function () {
  var r = await api('put', '/api/docs/files/' + MINE, owner).send({ projectId: P, folderId: FO });
  expect(r.status).toBe(200);
  expect(r.body.data).toMatchObject({ project_id: P, folder_id: FO });
  var l = await api('get', '/api/docs/files?all=true&personal=1', owner);
  expect(l.body.data.length).toBe(0);
});

test('남의 개인 파일은 건드릴 수 없음 (존재도 숨김)', async function () {
  var r = await api('put', '/api/docs/files/' + THEIRS, owner).send({ projectId: P, folderId: FO });
  expect(r.status).toBe(404);
});

test('프로젝트 → 내 문서: 올린 사람만', async function () {
  await db.query('UPDATE project_files SET uploaded_by = $1 WHERE id = $2', [other.user.id, INPROJ]);
  var no = await api('put', '/api/docs/files/' + INPROJ, owner).send({ projectId: null });
  expect(no.status).toBe(403);
  await db.query('UPDATE project_files SET uploaded_by = $1 WHERE id = $2', [owner.user.id, INPROJ]);
  var ok = await api('put', '/api/docs/files/' + INPROJ, owner).send({ projectId: null });
  expect(ok.status).toBe(200);
  expect(ok.body.data).toMatchObject({ project_id: null, folder_id: null });
});

test('같은 프로젝트 안 폴더 이동은 그대로 됨 (예전 동작)', async function () {
  var r = await api('put', '/api/docs/files/' + MINE, owner).send({ projectId: P, folderId: null, name: '사진.jpg' });
  expect(r.status).toBe(200);
  expect(r.body.data).toMatchObject({ project_id: P, folder_id: null, name: '사진.jpg' });
});
