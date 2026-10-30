/**
 * 프로젝트 만들기 — 서버의 단 하나의 생성 경로 (v13.283)
 *  POST /api/projects · /full · /:id/copy · 사전검토 전환(prestudies /:id/convert) 이 모두 insertProject 를 쓴다.
 *  예전엔 복사·전환이 INSERT 를 따로 가져서 상태('waiting')·단계·체크리스트·멤버 tenant_id 가 제각각이었다.
 *
 *  insertProject 가 해 주는 것
 *   - 상태 정리(active · hold · done 만 저장) + 완료 단계 ↔ 상태 완료 연동(syncDonePhase)
 *   - 단계 일정이 없으면 기본 단계(수주부터), current_phase 없으면 'order'
 *   - 체크리스트: b.checklists 배열이 있으면 그대로, 없거나 비었으면 단계별 기본 체크리스트 (b.checklists === false 면 안 만듦)
 *   - 멤버: opts.members [{ userId, role }] + 담당자 이름(assignees)이 같은 테넌트 사용자와 맞으면 assignee 로
 *     (생성자 owner_id 는 멤버로 넣지 않음 — 소유자 권한이 따로 있고, 이관(transfer)도 소유자를 멤버에서 뺀다)
 */
var sv = require('./safe-val');
var pd = require('./project-defaults');
var authService = require('../services/auth.service');
var notificationService = require('../services/notification.service');

function _rid(prefix) { return prefix + '-' + require('crypto').randomUUID().slice(0, 12); }

/** 완료 단계 ↔ 상태 완료 연동 (v13.277 — 마지막 단계 A/S → 완료).
 *  완료 단계로 옮기면 상태 완료 · 진척 100, 상태를 완료로 바꾸면 완료 단계로.
 *  완료 단계에서 다른 단계로 옮기면 진행중, 완료를 풀면(단계를 따로 안 줬을 때) 납품 단계로 돌림.
 *  완료에서 빠지면 진척 100 이 남지 않게 단계 비율(수주 0 · 설계 20 … 납품 80)로 — 이후 마일스톤 보고·자동 산출이 덮어씀.
 *  clean: DB 컬럼 이름(snake)으로 바뀔 값 · prev: 이전 행 (새로 만들 땐 null) */
var _PHASE_SEQ = pd.PHASE_SEQ;
function syncDonePhase(clean, prev) {
  prev = prev || {};
  var phase = clean.current_phase !== undefined ? clean.current_phase : prev.current_phase;
  var status = clean.status !== undefined ? clean.status : prev.status;
  var phaseMoved = clean.current_phase !== undefined && clean.current_phase !== prev.current_phase;
  var statusMoved = clean.status !== undefined && clean.status !== prev.status;
  if (phaseMoved && phase === 'done') { clean.status = 'done'; clean.progress = 100; }
  else if (phaseMoved && prev.current_phase === 'done' && status === 'done') clean.status = 'active';
  else if (statusMoved && status === 'done' && phase !== 'done') { clean.current_phase = 'done'; clean.progress = 100; }
  else if (statusMoved && prev.status === 'done' && phase === 'done' && clean.current_phase === undefined) clean.current_phase = 'deliver';
  // 진척: 완료 단계면 100 고정, 완료에서 빠졌는데 100 이면 단계 비율로
  var finalPhase = clean.current_phase !== undefined ? clean.current_phase : prev.current_phase;
  if (finalPhase === 'done') { if (clean.progress !== undefined) clean.progress = 100; }
  else if (prev.current_phase === 'done') {
    var pg = clean.progress !== undefined ? clean.progress : prev.progress;
    var si = _PHASE_SEQ.indexOf(finalPhase);
    if (Number(pg) >= 100 && si >= 0) clean.progress = Math.round(si / (_PHASE_SEQ.length - 1) * 100);
  }
  if (!(clean.current_phase !== undefined && clean.current_phase !== prev.current_phase)) return clean;
  // 단계 일정(phases JSON)도 같이 — 지난 단계는 완료, 새 단계는 진행(완료 단계는 바로 완료)
  var ph = clean.phases !== undefined ? clean.phases : prev.phases;
  if (typeof ph === 'string') { try { ph = JSON.parse(ph); } catch (e) { ph = null; } }
  if (ph && typeof ph === 'object') {
    ph = JSON.parse(JSON.stringify(ph));
    var today = pd.todayKST();
    var from = prev.current_phase, to = clean.current_phase;
    if (from && ph[from] && to === 'done') { ph[from].status = 'done'; if (!ph[from].endDate) ph[from].endDate = today; }
    if (!ph[to]) ph[to] = {};
    ph[to].status = to === 'done' ? 'done' : 'active';
    if (!ph[to].startDate) ph[to].startDate = today;
    if (to === 'done' && !ph[to].endDate) ph[to].endDate = today;
    if (from === 'done' && ph.done) ph.done.status = 'waiting';
    clean.phases = JSON.stringify(ph);
  }
  return clean;
}

function _hasPhases(ph) {
  if (typeof ph === 'string') { try { ph = JSON.parse(ph); } catch (e) { return false; } }
  return !!ph && typeof ph === 'object' && !Array.isArray(ph) && Object.keys(ph).length > 0;
}

/**
 * 프로젝트 1행 INSERT + 기본 단계 · 체크리스트 · 멤버.
 * @param q    db 또는 트랜잭션 client (여러 쿼리를 하므로 트랜잭션 client 권장)
 * @param b    요청 본문 (camelCase · snake_case 둘 다)
 * @param opts { members: [{ userId, role }] } — 담당자 이름 매칭보다 먼저 넣는다(역할 유지)
 */
async function insertProject(q, req, b, opts) {
  b = b || {}; opts = opts || {};
  var id = sv.safeId(b.id, function () { return _rid('proj'); });
  var deptId = b.departmentId || b.department_id || req.user.departmentId || null;
  var visibility = b.visibility || 'private';
  if (['private','dept','tenant'].indexOf(visibility) === -1) visibility = 'private';
  var ownerId = b.ownerId || b.owner_id || req.user.sub;
  var startDate = b.startDate || b.start_date || '';
  var phases = _hasPhases(b.phases) ? b.phases : pd.defaultPhases(startDate);
  var st0 = syncDonePhase({ status: pd.normalizeStatus(b.status), current_phase: b.currentPhase || b.current_phase || 'order', phases: phases }, { current_phase: 'order', status: 'active' });
  if (ownerId !== req.user.sub) {
    // 다른 사람을 생성자로 지정하면 같은 테넌트 사용자인지 확인 — 아니면 본인으로
    var ur = await q.query('SELECT 1 FROM users WHERE id = $1 AND tenant_id = $2', [ownerId, req.tenant.id]);
    if (!ur.rows.length) ownerId = req.user.sub;
  }
  var assignees = Array.isArray(b.assignees) ? b.assignees : [];
  var r = await q.query(
    "INSERT INTO projects (id, order_no, name, start_date, end_date, status, progress, estimated_hours, assignees, dependencies, color, memo, current_phase, phases, created_by, updated_by, department_id, tenant_id, owner_id, visibility, specs) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15,$16,$17,$18,$19,$20) RETURNING *",
    [id, b.orderNo || b.order_no || '', b.name || '', startDate, b.endDate || b.end_date || '',
     st0.status, st0.progress != null ? st0.progress : (b.progress || 0), b.estimatedHours || b.estimated_hours || 0,
     JSON.stringify(assignees), JSON.stringify(b.dependencies || []),
     sv.safeColor(b.color, '#3B82F6'), b.memo || '', st0.current_phase,
     typeof st0.phases === 'string' ? st0.phases : JSON.stringify(st0.phases), req.user.sub, deptId, req.tenant.id, ownerId, visibility, JSON.stringify(b.specs || {})]
  );
  var row = r.rows[0];
  var tid = req.tenant.id;

  // 체크리스트 — 준 것이 있으면 그대로, 없으면 단계별 기본
  if (b.checklists !== false) {
    var cls = Array.isArray(b.checklists) && b.checklists.length ? b.checklists : pd.defaultChecklists();
    var cIds = [], cPh = [], cItems = [];
    cls.forEach(function (c) {
      cIds.push(sv.safeId(c.id, function () { return _rid('chk'); })); cPh.push(c.phase || null); cItems.push(JSON.stringify(c.items || []));
    });
    await q.query(
      "INSERT INTO checklists (id, project_id, phase, items, created_by, tenant_id) SELECT t.id, $4, t.ph, t.it::jsonb, $5, $6 FROM unnest($1::text[], $2::text[], $3::text[]) AS t(id, ph, it)",
      [cIds, cPh, cItems, row.id, req.user.sub, tid]
    );
  }

  // 멤버 — 지정 멤버(역할 유지) 먼저, 그다음 담당자 이름이 맞는 같은 테넌트 사용자
  var mUsers = [], mRoles = [], seen = {};
  seen[ownerId] = true;
  (opts.members || []).forEach(function (m) {
    if (!m || !m.userId || seen[m.userId]) return;
    seen[m.userId] = true; mUsers.push(m.userId); mRoles.push(m.role === 'pl' ? 'pl' : 'assignee');
  });
  var names = assignees.map(function (n) { return String(n || '').trim(); }).filter(Boolean);
  if (names.length) {
    var ur2 = await q.query("SELECT id, name, display_name FROM users WHERE tenant_id = $1 AND (name = ANY($2) OR display_name = ANY($2)) ORDER BY created_at", [tid, names]);
    var byName = {};
    ur2.rows.forEach(function (u) { [u.name, u.display_name].forEach(function (k) { if (k && !byName[k]) byName[k] = u.id; }); });
    names.forEach(function (n) { var uid = byName[n]; if (uid && !seen[uid]) { seen[uid] = true; mUsers.push(uid); mRoles.push('assignee'); } });
  }
  if (mUsers.length) {
    await q.query(
      "INSERT INTO project_members (project_id, user_id, role, assigned_by, tenant_id) SELECT $3, t.uid, t.role, $4, $5 FROM unnest($1::uuid[], $2::text[]) AS t(uid, role) " +
      "ON CONFLICT (project_id, user_id) DO NOTHING",
      [mUsers, mRoles, row.id, req.user.sub, tid]
    );
  }
  if (row) row.can_edit = req.user.role === 'admin' || req.user.role === 'executive' || row.owner_id === req.user.sub || mUsers.indexOf(req.user.sub) >= 0;
  return row;
}

/** 만든 뒤: 감사 로그 + 관리자 알림 (best-effort — 응답 보낸 다음 부른다) */
function afterProjectCreate(req, row, action) {
  try {
    authService.auditLog(req.user.sub, action || 'project.create', 'project', row.id, { name: row.name }, req).catch(function () {});
  } catch (_) {}
  try {
    notificationService.notifyAdmins('project_created', {
      projectName: row.name, orderNo: row.order_no
    }, req.tenant.id).catch(function (e) { console.error('[noti]', e.message); });
  } catch (_) {}
}

module.exports = { syncDonePhase: syncDonePhase, insertProject: insertProject, afterProjectCreate: afterProjectCreate };
