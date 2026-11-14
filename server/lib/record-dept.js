/**
 * record-dept.js — 업무일지 기록에 사업부(부서) 붙이기 (v13.498)
 *
 * 서버에 저장된 dept(파일을 불러올 때 고른 사업부)가 있으면 그것, 없으면 작성자 이름으로 사용자의 부서를 찾아 붙인다.
 *   · 이름은 users.name 과 display_name 둘 다로 찾음 (업무일지 이름이 화면 이름일 수 있음)
 *   · 같은 이름이 여러 부서에 있으면 붙이지 않음 (잘못 나누느니 비워 둠)
 *   · 회사(테넌트)마다 1분 동안 기억 — 5만 건을 내려 줄 때 기록마다 DB 에 묻지 않게
 * 쓰는 곳: routes/archives.js GET /records · routes/bootstrap.js (최근 업무일지)
 */
var CACHE = new Map(), TTL = 60 * 1000;

async function deptMap(db, tenantId) {
  var c = CACHE.get(tenantId);
  if (c && c.exp > Date.now()) return c;
  var r = await db.query(
    "SELECT u.name, u.display_name, d.name AS dept FROM users u JOIN departments d ON d.id = u.department_id " +
    "WHERE u.tenant_id = $1 AND COALESCE(u.status, 'active') <> 'deleted' AND d.name IS NOT NULL AND d.name <> ''", [tenantId]);
  var map = {}, clash = {};
  r.rows.forEach(function (x) {
    [x.name, x.display_name].forEach(function (n) {
      n = String(n || '').trim(); if (!n) return;
      if (map[n] && map[n] !== x.dept) clash[n] = true; else map[n] = x.dept;
    });
  });
  Object.keys(clash).forEach(function (n) { delete map[n]; });
  // 바뀌면 ETag 도 바뀌게 — 이름 · 부서 짝으로 만든 짧은 지문
  var sig = 0, s = Object.keys(map).sort().map(function (k) { return k + '=' + map[k]; }).join('|');
  for (var i = 0; i < s.length; i++) sig = (sig * 31 + s.charCodeAt(i)) | 0;
  c = { map: map, sig: (sig >>> 0).toString(36), exp: Date.now() + TTL };
  CACHE.set(tenantId, c);
  if (CACHE.size > 500) CACHE.clear();
  return c;
}

/** rows 의 dept 를 채움 (저장된 값이 먼저) — 그 자리에서 바꾸고 rows 를 돌려줌 */
function attach(rows, dm) {
  var map = (dm && dm.map) || {};
  (rows || []).forEach(function (r) { if (!r.dept) { var d = map[String(r.name || '').trim()]; if (d) r.dept = d; } });
  return rows;
}

function clearCache(tenantId) { if (tenantId) CACHE.delete(tenantId); else CACHE.clear(); }

module.exports = { deptMap: deptMap, attach: attach, clearCache: clearCache };
