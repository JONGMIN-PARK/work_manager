// 버전 기록 API — 직접 저장 · 자동 기록 · 이름 · 권한 · 되돌리기 · 이미지 보존
var B = 'http://localhost:3000';
var pg = require(require('path').join(__dirname, '../../server/node_modules/pg'));
async function login(email) {
  var r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, password: 'Test1234!' }) });
  return (await r.json()).data.accessToken;
}
function api(tok) {
  return async function (method, url, body) {
    var r = await fetch(B + url, { method: method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined });
    var j = null; try { j = await r.json(); } catch (_) {}
    return { s: r.status, d: j };
  };
}
var n = 0;
function check(name, c, x) { if (!c) { console.log('FAIL', name, JSON.stringify(x, null, 1).slice(0, 1500)); process.exit(1); } n++; console.log('✔', name); }
function doc(texts, img) {
  return { sheets: [{ id: 'sh-1', title: '시트 1', structure: 'balanced', root: { id: 'n-root', text: '루트', children: texts.map(function (t, i) {
    var x = { id: 'n-' + i, text: t, children: [] };
    if (img && i === 0) x.blocks = [{ t: 'img', id: img }];
    return x;
  }) } }] };
}

(async function () {
  var c = new pg.Client('postgres://postgres:pw@localhost:54329/wm'); await c.connect();
  var A = api(await login('admin@t.com')), K = api(await login('kim@t.com')), L = api(await login('lee@t.com'));
  var m = (await K('POST', '/api/mindmaps', { title: '기록 시험', scope: 'personal' })).d.data;
  var U = '/api/mindmaps/' + m.id;
  var img = (await K('POST', U + '/images', { src: 'data:image/png;base64,iVBORw0KGgo=', w: 10, h: 10 })).d.data.id;
  var v = (await K('PUT', U, { version: m.version, doc: doc(['가', '나'], img) })).d.data.version;
  check('빈 목록', (await K('GET', U + '/snapshots')).d.data.length === 0);
  var s1 = await K('POST', U + '/snapshots', { label: '1차안' });
  check('직접 저장', s1.s === 201 && s1.d.data.kind === 'manual' && s1.d.data.label === '1차안' && s1.d.data.node_count === 3, s1);
  // 계속 편집 — 마지막 기록 직후라 자동 기록 없음
  v = (await K('PUT', U, { version: v, doc: doc(['가', '나', '다']) })).d.data.version;
  check('바로 이어 저장 → 자동 기록 없음', (await K('GET', U + '/snapshots')).d.data.length === 1);
  // 45분 쉰 것으로 만들고 저장 → 그 전 상태(가 나 다)가 자동 기록으로
  await c.query("UPDATE mindmaps SET updated_at = now() - interval '45 minutes' WHERE id = $1", [m.id]);
  await c.query("UPDATE mindmap_snapshots SET created_at = now() - interval '50 minutes' WHERE map_id = $1", [m.id]);
  v = (await K('PUT', U, { version: v, doc: doc(['가2']) })).d.data.version;
  var list = (await K('GET', U + '/snapshots')).d.data;
  check('쉬었다가 저장 → 자동 기록', list.length === 2 && list[0].kind === 'auto' && list[0].node_count === 4 && list[0].created_by_name, list);
  var auto = list[0];
  check('자동 기록 시각 = 직전 저장 시각', Date.now() - new Date(auto.created_at).getTime() > 40 * 60000, auto);
  var full = (await K('GET', U + '/snapshots/' + s1.d.data.id)).d.data;
  check('기록 문서 읽기', full.doc.sheets[0].root.children.length === 2);
  // 이미지: 지금 문서에서 빠졌지만 기록이 쓰고 있음 → 7일 지나도 남음
  await c.query("UPDATE mindmap_images SET unref_at = now() - interval '8 days' WHERE map_id = $1", [m.id]);
  v = (await K('PUT', U, { version: v, doc: doc(['가3']) })).d.data.version;
  var im = await c.query('SELECT id, unref_at FROM mindmap_images WHERE map_id = $1', [m.id]);
  check('기록이 쓰는 이미지는 지우지 않음 (지금 문서엔 없으니 unref 표시는 유지)', im.rows.length === 1 && im.rows[0].unref_at !== null, im.rows);
  // 이름 붙이기 → 자동이 직접 저장으로
  var rn = await K('PUT', U + '/snapshots/' + auto.id, { label: '회의 전' });
  check('이름 붙이면 직접 저장으로', rn.s === 200 && rn.d.data.kind === 'manual' && rn.d.data.label === '회의 전', rn);
  // 권한: 다른 사람(공유 안 됨) 404, 보기만 공유된 이씨는 목록 OK · 저장 403
  var me = (await L('GET', '/api/auth/me')).d.data.id;
  var ls0 = await L('GET', U + '/snapshots'); check('남의 개인 맵 기록 404', ls0.s === 404, ls0);
  
  await K('PUT', U, { version: v, viewers: [me] }); v++;
  check('보기 공유 → 목록 OK', (await L('GET', U + '/snapshots')).s === 200);
  check('보기 공유 → 저장 403', (await L('POST', U + '/snapshots', { label: 'x' })).s === 403);
  check('보기 공유 → 되돌리기 403', (await L('POST', U + '/snapshots/' + s1.d.data.id + '/restore', { version: v })).s === 403);
  // 되돌리기: 버전 안 맞으면 409, 맞으면 문서 교체 + 백업
  var bad = await K('POST', U + '/snapshots/' + s1.d.data.id + '/restore', { version: v - 1 });
  check('되돌리기 — 낡은 version 409', bad.s === 409, bad);
  var rs = await K('POST', U + '/snapshots/' + s1.d.data.id + '/restore', { version: v });
  check('되돌리기', rs.s === 200 && rs.d.data.version === v + 1 && rs.d.data.doc.sheets[0].root.children.length === 2 && rs.d.backup.kind === 'restore', rs);
  var row = (await K('GET', U)).d.data;
  check('맵 문서 교체됨', row.doc.sheets[0].root.children[0].text === '가' && row.version === v + 1);
  list = (await K('GET', U + '/snapshots')).d.data;
  check('되돌리기 전 백업 남음', list[0].kind === 'restore' && /되돌리기 전/.test(list[0].label) && list[0].node_count === 2, list[0]);
  // 지우기: 만든 사람 OK
  var del = await K('DELETE', U + '/snapshots/' + list[0].id);
  check('지우기', del.s === 200 && (await K('GET', U + '/snapshots')).d.data.length === list.length - 1, del);
  check('없는 기록 404', (await K('GET', U + '/snapshots/snap-nope')).s === 404);
  // 테넌트 · 맵 경계: 다른 맵 id 로 남의 기록 못 읽음
  var m2 = (await K('POST', '/api/mindmaps', { title: '다른 맵', scope: 'personal' })).d.data;
  check('다른 맵 경로로 기록 못 읽음', (await K('GET', '/api/mindmaps/' + m2.id + '/snapshots/' + s1.d.data.id)).s === 404);
  // 맵 지우면 기록도 (CASCADE 는 하드 삭제 때) — 소프트 삭제된 맵은 404
  await K('DELETE', U);
  check('삭제된 맵 기록 404', (await K('GET', U + '/snapshots')).s === 404);
  await c.end();
  console.log('\nALL PASS ' + n);
})().catch(function (e) { console.log('ERR', e); process.exit(1); });
