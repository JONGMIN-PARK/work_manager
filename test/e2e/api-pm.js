// 📁 프로젝트 관리 점검 (v13.281) — 색 · id 검사 · 완료 진척 · 이슈 이력 · 권한 · 수주 덮어쓰기 · 사전검토 긴급
var B = 'http://localhost:3000';
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
var ok = 0;
function check(n, c, x) { if (!c) { console.log('FAIL', n, JSON.stringify(x)); process.exit(1); } ok++; console.log('✔', n); }
(async function () {
  var A = api(await login('admin@t.com')), K = api(await login('kim@t.com'));
  var T = Date.now();
  // 1. 색 · id — 속성에 그대로 들어가는 값은 서버가 거른다
  var bad = await A('POST', '/api/projects', { id: "x');alert(1);('", name: '검사 ' + T, color: 'red" onmouseover="alert(1)', visibility: 'private', startDate: '2026-10-01', endDate: '2026-10-31' });
  check('프로젝트 생성', bad.s === 201 || bad.s === 200, bad);
  var pid = bad.d.data.id;
  check('이상한 id → 새 id', /^proj-[\w-]+$/.test(pid), pid);
  check('이상한 색 → 기본 색', bad.d.data.color === '#3B82F6', bad.d.data.color);
  var up = await A('PUT', '/api/projects/' + pid, { color: '#10B981' });
  check('정상 색 저장', up.s === 200 && up.d.data.color === '#10B981', up.d);
  // 2. 완료 프로젝트 — 마일스톤 목표시간이 바뀌어도 진척 100 유지
  var ms = await A('POST', '/api/milestones', { projectId: pid, name: '설계', startDate: '2026-10-01', endDate: '2026-10-10', assigneeTargets: { 관리자: 10 } });
  check('마일스톤 생성', ms.s === 201, ms);
  var dn = await A('PUT', '/api/projects/' + pid, { status: 'done' });
  check('완료로 → 완료 단계 · 100', dn.d.data.current_phase === 'done' && dn.d.data.progress === 100, dn.d.data);
  await A('PUT', '/api/milestones/' + ms.d.data.id, { assigneeTargets: { 관리자: 20 } });
  await new Promise(function (r) { setTimeout(r, 500); });
  var g = await A('GET', '/api/projects/' + pid);
  check('목표시간 바꿔도 완료 진척 100', g.d.data.progress === 100, g.d.data.progress);
  var back = await A('PUT', '/api/projects/' + pid, { currentPhase: 'deliver' });
  check('완료에서 나오면 진행중 · 100 아님', back.d.data.status === 'active' && back.d.data.progress < 100, back.d.data);
  // 2-1. 마일스톤 완료 처리 → 그 마일스톤 100 · 프로젝트 완료율 바로 갱신 (v13.282)
  //   설계(목표 20h) + 제작(목표 없음 → 평균 가중치 20h) — 제작만 완료하면 50%
  var ms2 = await A('POST', '/api/milestones', { projectId: pid, name: '제작', startDate: '2026-10-11', endDate: '2026-10-20', status: 'waiting' });
  var d2 = await A('PUT', '/api/milestones/' + ms2.d.data.id, { status: 'done' });
  check('마일스톤 완료 → 진척 100', d2.s === 200 && d2.d.data.progress === 100, d2.d.data);
  var p2 = await A('GET', '/api/projects/' + pid);
  check('프로젝트 완료율 바로 갱신 (목표시간 없는 마일스톤도 반영) 50', p2.d.data.progress === 50, p2.d.data.progress);
  var lg2 = await A('GET', '/api/milestones/' + ms2.d.data.id + '/logs');
  check('진척 이력에 ✅ 완료 처리', (lg2.d.data || []).some(function (l) { return l.progress === 100 && /완료 처리/.test(l.note); }), lg2.d);
  var d1 = await A('PUT', '/api/milestones/' + ms.d.data.id, { status: 'done' });
  check('나머지도 완료 → 프로젝트 100', d1.d.data.progress === 100 && (await A('GET', '/api/projects/' + pid)).d.data.progress === 100);
  var u2 = await A('PUT', '/api/milestones/' + ms2.d.data.id, { status: 'active' });
  check('완료 풀면 자동 100 지움 → 0', u2.d.data.progress === 0, u2.d.data);
  check('프로젝트 완료율 다시 50', (await A('GET', '/api/projects/' + pid)).d.data.progress === 50);
  var ms3 = await A('POST', '/api/milestones', { projectId: pid, name: '검수', status: 'done' });
  check('처음부터 완료로 만든 마일스톤도 100', ms3.d.data.progress === 100, ms3.d.data);
  // 3. 이슈 — 이력 유형 저장 · 이력 삭제 · 비공개 프로젝트 이슈는 남이 못 봄
  var iss = await A('POST', '/api/issues', { projectId: pid, title: '이슈 ' + T, status: 'open' });
  check('이슈 생성', iss.s === 201, iss);
  var iid = iss.d.data.id;
  var lg = await A('POST', '/api/issues/' + iid + '/logs', { content: '현장 확인', type: 'visit', time: '10:30', dept: '설계' });
  check('이력 추가', lg.s === 201, lg);
  var logs = await A('GET', '/api/issues/' + iid + '/logs');
  var l0 = (logs.d.data || [])[0] || {};
  check('이력 유형 · 시각 · 부서 저장', l0.type === 'visit' && l0.dept === '설계' && /10:30/.test(String(l0.log_time || l0.logTime || '')), l0);
  var ld = await A('DELETE', '/api/issues/' + iid + '/logs/' + l0.id);
  check('이력 삭제', ld.s === 200 || ld.s === 204, ld);
  var kv = await K('GET', '/api/issues/' + iid);
  check('비공개 프로젝트 이슈 — 김은 못 봄', kv.s === 404 || kv.s === 403, kv.s);
  // 4. 문서 — 남의 비공개 프로젝트에 폴더 못 만듦
  var kf = await K('POST', '/api/docs/folders', { projectId: pid, name: '몰래' });
  check('문서 폴더 — 권한 없으면 거부', kf.s === 403 || kf.s === 404, kf.s);
  var af = await A('POST', '/api/docs/folders', { projectId: pid, name: '설계 자료' });
  check('문서 폴더 — 편집권자는 만듦', af.s === 201 || af.s === 200, af);
  check('문서 폴더 단건 조회', (await A('GET', '/api/docs/folders/' + af.d.data.id)).s === 200);
  check('문서 폴더 단건 — 김은 못 봄', [403, 404].indexOf((await K('GET', '/api/docs/folders/' + af.d.data.id)).s) >= 0);
  // 5. 수주 — 신규 등록은 기존 번호를 덮어쓰지 않음
  var no = 'PM' + T;
  check('수주 신규 등록', (await A('POST', '/api/orders', { orderNo: no, name: '원래 이름', createOnly: true })).s < 300);
  var dup = await A('POST', '/api/orders', { orderNo: no, name: '덮어쓰기', createOnly: true });
  check('같은 번호 신규 등록 → 409', dup.s === 409, dup);
  var od = await A('GET', '/api/orders/' + no);
  check('기존 수주 그대로', od.d.data && od.d.data.name === '원래 이름', od.d);
  await A('DELETE', '/api/orders/' + no);
  // 6. 사전검토 — 긴급 우선순위 저장
  var ps = await A('POST', '/api/prestudies', { title: '검토 ' + T, priority: 'urgent' });
  check('사전검토 긴급 저장', ps.s < 300 && ps.d.data.priority === 'urgent', ps.d);
  await A('DELETE', '/api/prestudies/' + ps.d.data.id);
  // 정리
  await A('DELETE', '/api/issues/' + iid);
  await A('DELETE', '/api/projects/' + pid);
  console.log('\nALL PASS ' + ok);
})().catch(function (e) { console.log('ERR', e.message); process.exit(1); });
