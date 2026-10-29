/**
 * 내 일정 — 내가 만든 일정 · 담당자에 내 이름이 들어간 일정 (v13.252)
 *   events.assignees 는 이름 문자열 배열이라 이름으로 맞춘다.
 *   남의 달력을 볼 때는 보는 사람이 볼 수 있는 프로젝트에 연결된 일정만 (개인 일정은 본인만).
 * 반복 일정 회차 계산은 클라 expandRepeatingEvents(project-data.js) 와 같은 규칙.
 */
var db = require('../config/db');
var pa = require('./project-access');

var REPEAT_LIMIT = 400;

function _utc(d) { return new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))); }
function _ymd(t) { return t.toISOString().slice(0, 10); }
function addDays(d, n) { var t = _utc(d); t.setUTCDate(t.getUTCDate() + n); return _ymd(t); }
function daysBetween(a, b) { return Math.round((_utc(b) - _utc(a)) / 86400000); }

/**
 * 한 일정의 회차들 중 [from, to] 와 겹치는 것
 * @returns {Array<{date, end}>}
 */
function occurrences(ev, from, to) {
  var s = ev.start_date, e = ev.end_date || s;
  if (!s) return [];
  var dur = Math.max(0, daysBetween(s, e < s ? s : e));
  var out = [];
  function push(d) { var de = addDays(d, dur); if (d <= to && de >= from) out.push({ date: d, end: de }); }
  push(s);
  if (['weekly', 'biweekly', 'monthly'].indexOf(ev.repeat) < 0) return out;
  var until = ev.repeat_until && ev.repeat_until < to ? ev.repeat_until : to;
  var day = +s.slice(8, 10);
  for (var step = 1; step <= REPEAT_LIMIT; step++) {
    var d;
    if (ev.repeat === 'monthly') {
      // 31일 시작이면 그 달 말일로
      var t = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1 + step, 1));
      var last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
      t.setUTCDate(Math.min(day, last));
      d = _ymd(t);
    } else {
      d = addDays(s, step * (ev.repeat === 'weekly' ? 7 : 14));
    }
    if (d > until) break;
    push(d);
  }
  return out;
}

function _arr(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { var a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch (_) { return []; } }
  return [];
}

/**
 * @param {object} req   테넌트 · 보는 사람
 * @param {{id,name}} user  대상
 * @param {string} from  'YYYY-MM-DD'
 * @param {string} to
 * @returns {Promise<Array>} events 행 (snake_case) — 반복 일정은 원본 한 줄
 */
async function eventsFor(req, user, from, to) {
  var self = user.id === req.user.sub;
  var params = [req.tenant.id, user.id, user.name || '', to, from];
  var vis = '';
  if (!self && req.user.role !== 'admin') {
    var sub = pa.accessibleProjectsSubquery(req, params.length + 1);
    params = params.concat(sub.params);
    vis = " AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(e.project_ids, '[]'::jsonb)) AS _pid WHERE _pid IN (" + sub.sql + '))';
  } else if (!self) {
    vis = " AND jsonb_array_length(COALESCE(e.project_ids, '[]'::jsonb)) > 0";
  }
  var r = await db.query(
    'SELECT e.* FROM events e WHERE e.tenant_id = $1 ' +
    "AND (e.created_by = $2 OR ($3 <> '' AND COALESCE(e.assignees, '[]'::jsonb) ? $3)) " +
    "AND e.start_date <> '' AND e.start_date <= $4 " +
    "AND (COALESCE(NULLIF(e.end_date, ''), e.start_date) >= $5 OR (e.repeat IN ('weekly','biweekly','monthly') AND (COALESCE(e.repeat_until, '') = '' OR e.repeat_until >= $5)))" +
    vis + ' ORDER BY e.start_date, e.start_time NULLS FIRST LIMIT 1000',
    params
  );
  return r.rows.map(function (x) { x.project_ids = _arr(x.project_ids); x.assignees = _arr(x.assignees); return x; });
}

/** 수정할 수 있는지 — routes/events.js 와 같은 규칙 (관리자 · 작성자 · 연결 프로젝트 편집 가능) */
async function markCanModify(req, rows) {
  // v13.270: 프로젝트마다 차례로 묻던 것을 한 번에 (편집할 수 있는 프로젝트만 돌려받음)
  var need = {};
  rows.forEach(function (ev) {
    if (req.user.role === 'admin' || ev.created_by === req.user.sub) return;
    (ev.project_ids || []).forEach(function (pid) { if (pid) need[pid] = true; });
  });
  var can = {};
  var pids = Object.keys(need);
  if (pids.length) {
    var ed = pa.editableProjectsSql(req, 'p', 3);
    var r = await db.query('SELECT p.id FROM projects p WHERE p.tenant_id = $1 AND p.id = ANY($2) AND ' + ed.sql, [req.tenant.id, pids].concat(ed.params));
    r.rows.forEach(function (x) { can[x.id] = true; });
  }
  for (var i = 0; i < rows.length; i++) {
    var ev = rows[i];
    if (req.user.role === 'admin' || ev.created_by === req.user.sub) { ev.can_modify = true; continue; }
    ev.can_modify = false;
    for (var j = 0; j < (ev.project_ids || []).length; j++) {
      if (can[ev.project_ids[j]]) { ev.can_modify = true; break; }
    }
  }
  return rows;
}

module.exports = { eventsFor: eventsFor, occurrences: occurrences, markCanModify: markCanModify, addDays: addDays };
