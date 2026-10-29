// 내 업무 📝 노트 · 회의 미리보기 API — 날짜 · 회의 메모 저장 · 빈 글 지우기 · 본인만 · 검색 · 노트 있는 날 · 회의록 요약(권한 · 내 액션) (v13.272)
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
  (await c.query("SELECT id, email, name, tenant_id FROM users WHERE email IN ('admin@t.com','kim@t.com','lee@t.com')")).rows.forEach(function (r) { U[r.email.split('@')[0]] = r; });
  var tid = U.kim.tenant_id, kim = U.kim.id, lee = U.lee.id, adm = U.admin.id;
  async function clean() {
    await c.query('DELETE FROM my_notes WHERE user_id = ANY($1)', [[kim, lee, adm]]);
    await c.query("DELETE FROM meeting_action_items WHERE id LIKE 'nt-%'");
    await c.query("DELETE FROM meetings WHERE id LIKE 'nt-%'");
    await c.query("DELETE FROM events WHERE id LIKE 'nt-%'");
    await c.query("DELETE FROM projects WHERE id LIKE 'nt-%'");
  }
  await clean();
  var A = api(await login('admin@t.com')), K = api(await login('kim@t.com')), L = api(await login('lee@t.com'));
  try {
    var d0 = kst(0), d1 = kst(-1);
    // ── 1. 저장 · 읽기 ──
    var p = await K('PUT', '/api/my-work/notes', { date: d0, ref: '', body: '견적 단가 다시 확인\n- [x] 샘플 발송 ⟦todo-abc⟧\n고객사 담당 바뀜' });
    check('그날 노트 저장', p.s === 200 && p.d.data.updatedAt, p.d);
    check('회의 메모 저장', (await K('PUT', '/api/my-work/notes', { date: d0, ref: 'ev:nt-e1', body: '결정: 다음 주 납품' })).s === 200);
    var g = (await K('GET', '/api/my-work/notes?date=' + d0)).d.data;
    var by = {}; g.notes.forEach(function (x) { by[x.ref] = x.body; });
    check('그날 노트 · 회의 메모 같이 읽힘', /샘플 발송/.test(by['']) && by['ev:nt-e1'] === '결정: 다음 주 납품', g);
    check('잘못된 날짜 400', (await K('GET', '/api/my-work/notes?date=x')).s === 400);
    check('잘못된 회의 표시 400', (await K('PUT', '/api/my-work/notes', { date: d0, ref: 'bad ref', body: 'x' })).s === 400);
    check('너무 긴 글 400', (await K('PUT', '/api/my-work/notes', { date: d0, ref: '', body: 'x'.repeat(20001) })).s === 400);
    check('고치면 덮어씀', (await K('PUT', '/api/my-work/notes', { date: d0, ref: '', body: '견적 단가 다시 확인\n- [x] 샘플 발송 ⟦todo-abc⟧\n고객사 담당 바뀜\n추가 줄' })).s === 200 &&
      (await c.query("SELECT COUNT(*)::int AS n FROM my_notes WHERE user_id = $1 AND note_date = $2 AND ref = ''", [kim, d0])).rows[0].n === 1);
    // ── 2. 본인만 ──
    check('다른 사람 노트는 안 보임', (await L('GET', '/api/my-work/notes?date=' + d0)).d.data.notes.length === 0);
    await L('PUT', '/api/my-work/notes', { date: d0, ref: '', body: '이 사람 노트' });
    check('같은 날 다른 사람 노트는 따로', /추가 줄/.test((await K('GET', '/api/my-work/notes?date=' + d0)).d.data.notes.filter(function (x) { return !x.ref; })[0].body));
    // ── 3. 노트 있는 날 ──
    await K('PUT', '/api/my-work/notes', { date: d1, ref: '', body: '어제 메모' });
    var mine = (await K('GET', '/api/my-work')).d;
    check('내 업무에 노트 있는 날', mine.noteDays.indexOf(d0) >= 0 && mine.noteDays.indexOf(d1) >= 0, mine.noteDays);
    check('관리자가 김 업무를 봐도 노트 날짜는 안 줌', (await A('GET', '/api/my-work?userId=' + kim)).d.noteDays.length === 0);
    // 빈 글 → 지움
    var del = await K('PUT', '/api/my-work/notes', { date: d1, ref: '', body: '  \n ' });
    check('빈 글이면 지움', del.d.data.empty && !(await c.query('SELECT 1 FROM my_notes WHERE user_id = $1 AND note_date = $2', [kim, d1])).rows.length);
    check('지우면 노트 있는 날에서 빠짐', (await K('GET', '/api/my-work')).d.noteDays.indexOf(d1) < 0);
    // ── 4. 검색 ──
    var f = (await K('GET', '/api/my-work/notes/find?q=' + encodeURIComponent('샘플'))).d.data;
    check('검색 — 맞은 줄 조각 (표시 없이)', f.length === 1 && f[0].snip === '샘플 발송' && f[0].date === d0, f);
    check('검색 — % 는 글자로', (await K('GET', '/api/my-work/notes/find?q=%25')).d.data.length === 0);
    var rc = (await K('GET', '/api/my-work/notes/find')).d.data;
    check('검색어 없으면 최근', rc.length === 2 && rc.some(function (x) { return x.ref === 'ev:nt-e1'; }), rc);
    check('다른 사람 검색엔 안 나옴', (await L('GET', '/api/my-work/notes/find?q=' + encodeURIComponent('샘플'))).d.data.length === 0);

    // ── 5. 회의 미리보기 ──
    await c.query("INSERT INTO projects (id, name, status, visibility, owner_id, tenant_id) VALUES ('nt-p1', '노트 프로젝트', 'active', 'tenant', $1, $2), ('nt-p2', '노트 비공개', 'active', 'private', $1, $2)", [adm, tid]);
    await c.query("INSERT INTO events (id, title, type, start_date, end_date, start_time, project_ids, assignees, created_by, tenant_id) VALUES ('nt-e1', '노트 설계 회의', 'meeting', $1, $1, '14:00', '[]', '[]', $2, $3), ('nt-e2', '노트 비공개 회의', 'meeting', $1, $1, '16:00', '[]', '[]', $2, $3), ('nt-e3', '노트 회의록 없음', 'meeting', $1, $1, null, '[]', '[]', $2, $3)", [d0, adm, tid]);
    await c.query("INSERT INTO meetings (id, project_id, event_id, title, meet_date, agenda, minutes, tenant_id, created_by) VALUES ('nt-m1', 'nt-p1', 'nt-e1', '노트 설계 회의', $1, $2, '<p>다음 주 <b>납품</b> 확정</p>', $3, $4), ('nt-m2', 'nt-p2', 'nt-e2', '노트 비공개 회의', $1, '[]', '비밀', $3, $4)",
      [d0, JSON.stringify([{ text: '납기 확인', done: true, result: '다음 주' }, '단가 협의'] ), tid, adm]);
    await c.query("INSERT INTO meeting_action_items (id, meeting_id, title, assignee_id, assignee_name, due_date, status, tenant_id) VALUES ('nt-a1', 'nt-m1', '노트 견적서', $1, $2, $3, 'open', $4), ('nt-a2', 'nt-m1', '남의 액션', $5, '이팀원', null, 'open', $4)", [kim, U.kim.name, kst(2), tid, lee]);
    var br = (await K('GET', '/api/my-work/meeting-brief?eventId=nt-e1')).d.data;
    check('회의록 요약 — 안건 · 결과 · 회의록(태그 없이) · 내 액션만', br.meetingId === 'nt-m1' && br.projectName === '노트 프로젝트' && br.agenda.length === 2 && br.agenda[0].result === '다음 주' && br.agenda[1].text === '단가 협의' &&
      br.minutes === '다음 주 납품 확정' && br.myActions.length === 1 && br.myActions[0].title === '노트 견적서' && br.actionN === 2, br);
    var lk = (await K('GET', '/api/my-work/meeting-brief?eventId=nt-e2')).d.data;
    check('볼 수 없는 프로젝트의 회의록은 잠김 (내용 없음)', lk && lk.locked && !lk.minutes && !lk.agenda, lk);
    check('관리자는 비공개 회의록도', (await A('GET', '/api/my-work/meeting-brief?eventId=nt-e2')).d.data.minutes === '비밀');
    check('회의록 없는 일정 → null', (await K('GET', '/api/my-work/meeting-brief?eventId=nt-e3')).d.data === null);
    check('일정 id 없으면 400', (await K('GET', '/api/my-work/meeting-brief')).s === 400);
    console.log('\nALL PASS', n);
  } catch (e) {
    console.log(e.message);
  } finally {
    await clean();
    await c.end();
  }
})();
