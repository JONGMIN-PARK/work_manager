// 내 업무 보드 API — 휴지통(지우기 · 목록 · 되살리기 · 영구 삭제 · 비우기 · 다른 곳에서 빠짐) · 내 칸(기본 4칸 · 추가 · 고치기 · 순서 · 지우기 · 기본으로) · 칸 고정 (v13.268)
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm';
var path = require('path');
var B = 'http://localhost:3000';
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
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
function check(name, c, x) { if (!c) { console.log('FAIL', name, JSON.stringify(x, null, 1).slice(0, 1500)); throw new Error('FAIL ' + name); } n++; console.log('✔', name); }
function kst(k) { var d = new Date(Date.now() + 9 * 3600 * 1000); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); }

(async function () {
  var c = new pg.Client(process.env.DATABASE_URL); await c.connect();
  var U = {};
  (await c.query("SELECT id, email, tenant_id FROM users WHERE email IN ('admin@t.com','kim@t.com','lee@t.com')")).rows.forEach(function (r) { U[r.email.split('@')[0]] = r; });
  var kim = U.kim.id, lee = U.lee.id;
  async function clean() {
    await c.query('DELETE FROM my_todos WHERE user_id = ANY($1)', [[kim, lee]]);
    await c.query('DELETE FROM my_work_marks WHERE user_id = ANY($1)', [[kim, lee]]);
    await c.query('DELETE FROM my_work_categories WHERE user_id = ANY($1)', [[kim, lee]]);
  }
  await clean();
  var A = api(await login('admin@t.com')), K = api(await login('kim@t.com')), L = api(await login('lee@t.com'));
  try {
    // ── 1. 휴지통 ──
    var t1 = (await K('POST', '/api/my-work/todos', { title: '보드 할일 하나', dueDate: kst(0), dueTime: '23:50', priority: 2, memo: '메모', checklist: [{ t: 'a' }, { t: 'b', d: true }] })).d.data;
    var t2 = (await K('POST', '/api/my-work/todos', { title: '보드 할일 둘' })).d.data;
    var t3 = (await K('POST', '/api/my-work/todos', { title: '보드 할일 셋' })).d.data;
    check('지우기 → 휴지통', (await K('DELETE', '/api/my-work/todos/' + t1.id)).s === 200);
    var row = (await c.query('SELECT deleted_at FROM my_todos WHERE id = $1', [t1.id])).rows[0];
    check('행은 남고 deleted_at', row && row.deleted_at);
    var mine = (await K('GET', '/api/my-work')).d;
    check('목록에서 빠짐 · trashN 1', !mine.data.some(function (x) { return x.id === t1.id; }) && mine.trashN === 1, mine.trashN);
    var tr = (await K('GET', '/api/my-work/trash')).d.data;
    check('휴지통 목록 — 내용 그대로', tr.length === 1 && tr[0].id === t1.id && tr[0].memo === '메모' && tr[0].checklist.length === 2 && tr[0].due_time === '23:50', tr);
    check('다른 사람 휴지통엔 없음', (await L('GET', '/api/my-work/trash')).d.data.length === 0);
    check('다시 지우기 404', (await K('DELETE', '/api/my-work/todos/' + t1.id)).s === 404);
    check('휴지통 할 일은 고치기 404', (await K('PUT', '/api/my-work/todos/' + t1.id, { title: 'x' })).s === 404);
    check('휴지통 할 일은 완료 404', (await K('PUT', '/api/my-work/done', { src: 'todo', id: t1.id, done: true })).s === 404);
    check('남의 것 되살리기 404', (await L('POST', '/api/my-work/todos/' + t1.id + '/restore')).s === 404);
    check('남의 것 영구 삭제 404', (await L('DELETE', '/api/my-work/trash/' + t1.id)).s === 404);
    // 텔레그램 · 마감 시각 알림 쿼리도 휴지통 제외 (같은 조건을 그대로 돌려 봄)
    var tg = (await c.query('SELECT id FROM my_todos WHERE user_id = $1 AND done_at IS NULL AND deleted_at IS NULL', [kim])).rows.map(function (x) { return x.id; });
    check('텔레그램 /todos 조건에서 빠짐', tg.indexOf(t1.id) < 0 && tg.indexOf(t2.id) >= 0);
    check('되살리기', (await K('POST', '/api/my-work/todos/' + t1.id + '/restore')).s === 200);
    var back = (await K('GET', '/api/my-work')).d;
    check('되살린 것은 목록에 · 내용 그대로', back.data.some(function (x) { return x.id === t1.id && x.pri === 2 && x.dueTime === '23:50' && x.checkTotal === 2; }) && back.trashN === 0);
    // 영구 삭제 · 비우기 — 고정 표시도 같이 정리
    await K('PUT', '/api/my-work/mark', { key: 'todo:' + t2.id, focus: true });
    await K('DELETE', '/api/my-work/todos/' + t2.id);
    await K('DELETE', '/api/my-work/todos/' + t3.id);
    check('하나 영구 삭제', (await K('DELETE', '/api/my-work/trash/' + t2.id)).s === 200 && !(await c.query('SELECT 1 FROM my_todos WHERE id = $1', [t2.id])).rows.length);
    check('영구 삭제하면 표시도 정리', !(await c.query("SELECT 1 FROM my_work_marks WHERE item_key = $1", ['todo:' + t2.id])).rows.length);
    check('살아 있는 할 일은 영구 삭제 안 됨', (await K('DELETE', '/api/my-work/trash/' + t1.id)).s === 404);
    var em = (await K('DELETE', '/api/my-work/trash')).d.data;
    check('비우기', em.n === 1 && (await K('GET', '/api/my-work/trash')).d.data.length === 0 && !!(await c.query('SELECT 1 FROM my_todos WHERE id = $1', [t1.id])).rows.length, em);

    // ── 2. 내 칸 ──
    var cats = (await K('GET', '/api/my-work/categories')).d.data;
    check('처음엔 기본 4칸 (규칙 1~4)', cats.length === 4 && cats.map(function (x) { return x.rule; }).join() === '1,2,3,4' && cats[0].name === '지금 하기', cats);
    var again = await Promise.all([L('GET', '/api/my-work/categories'), L('GET', '/api/my-work/categories'), L('GET', '/api/my-work')]);
    check('동시에 불러도 한 벌만', (await c.query('SELECT COUNT(*)::int AS n FROM my_work_categories WHERE user_id = $1', [lee])).rows[0].n === 4, again.map(function (x) { return x.s; }));
    check('목록 응답에도 칸', (await K('GET', '/api/my-work')).d.cats.length === 4);
    var nc = (await K('POST', '/api/my-work/categories', { name: '  영업  ', icon: '💼', color: 'green' })).d.data;
    check('칸 추가 — 끝에 · 자동 규칙 없음', nc.name === '영업' && nc.color === 'green' && !nc.rule && nc.order === 4, nc);
    check('빈 이름 400', (await K('POST', '/api/my-work/categories', { name: ' ' })).s === 400);
    check('이상한 색은 slate', (await K('POST', '/api/my-work/categories', { name: '임시', color: 'neon' })).d.data.color === 'slate');
    check('이름 · 색 고치기', (await K('PUT', '/api/my-work/categories/' + nc.id, { name: '영업 건', color: 'blue' })).d.data.name === '영업 건');
    check('남의 칸 고치기 404', (await L('PUT', '/api/my-work/categories/' + nc.id, { name: 'x' })).s === 404);
    for (var i = 0; i < 6; i++) await K('POST', '/api/my-work/categories', { name: '칸' + i });
    check('12칸까지', (await K('POST', '/api/my-work/categories', { name: '넘침' })).s === 400);
    // 칸 고정
    var t4 = (await K('POST', '/api/my-work/todos', { title: '보드 고정' })).d.data;
    await K('PUT', '/api/my-work/mark', { key: 'todo:' + t4.id, focus: true });
    check('칸 고정', (await K('PUT', '/api/my-work/mark', { key: 'todo:' + t4.id, category: nc.id })).d.data.category === nc.id);
    var it4 = (await K('GET', '/api/my-work')).d.data.filter(function (x) { return x.id === t4.id; })[0];
    check('목록 cat · 집중은 그대로', it4.cat === nc.id && !!it4.focus, it4);
    check('남의 칸으로는 고정 안 됨', (await L('PUT', '/api/my-work/mark', { key: 'todo:x', category: nc.id })).s === 404);
    check('바꿀 것 없으면 400', (await K('PUT', '/api/my-work/mark', { key: 'todo:' + t4.id })).s === 400);
    // 순서
    var all = (await K('GET', '/api/my-work/categories')).d.data;
    var ids = all.map(function (x) { return x.id; }).reverse();
    var ord = (await K('PUT', '/api/my-work/categories-order', { ids: ids })).d.data;
    check('순서 바꾸기', ord.map(function (x) { return x.id; }).join() === ids.join());
    // 지우기 → 고정 풀림, 항목은 그대로
    check('칸 지우기', (await K('DELETE', '/api/my-work/categories/' + nc.id)).s === 200);
    var it4b = (await K('GET', '/api/my-work')).d.data.filter(function (x) { return x.id === t4.id; })[0];
    check('지운 칸의 항목은 고정 풀림 · 남아 있음', it4b && !it4b.cat);
    // 관리자가 김 업무를 보면 김의 칸
    var av = (await A('GET', '/api/my-work?userId=' + kim)).d;
    check('다른 사람 업무 볼 때는 그 사람 칸', av.cats.length === all.length - 1 && av.trashN === 0, av.cats.length);
    // 기본으로
    await K('PUT', '/api/my-work/mark', { key: 'todo:' + t4.id, category: all.filter(function (x) { return x.rule === 1; })[0].id });
    var rs = (await K('POST', '/api/my-work/categories-reset')).d.data;
    check('기본 4칸으로 되돌리기', rs.length === 4 && rs.every(function (x) { return x.rule; }));
    check('되돌리면 고정도 풀림', !(await K('GET', '/api/my-work')).d.data.filter(function (x) { return x.id === t4.id; })[0].cat);
    console.log('\nALL PASS', n);
  } catch (e) {
    console.log(e.message);
  } finally {
    await clean();
    await c.end();
  }
})();
