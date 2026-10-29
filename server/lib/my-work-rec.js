/**
 * 내 업무 추천 (v13.274) — "지금 하면 좋은 일" · 챙길 것. 텔레그램 /추천 · 정해 둔 시각 알림이 씀
 *   loadMine(req, user)  내 업무 모음 + 내 표시(⭐ 집중 · 칸 · 프로젝트) + 내 프로젝트 + 내 칸 — 웹 GET /api/my-work 와 같은 모양
 *   recommend(mine)      점수 높은 순 top · 마감 없는 중요한 일 · 기다리는 일 · 끝나가는 프로젝트 · 집중 안 고름 (순수 함수)
 *   quadOf · colOf       보드 칸 (웹 my-work-task.js mwQuadOf · my-work-board.js mwBoardColOf 와 같은 규칙)
 * 점수 — 중요도(긴급 40 · 높음 25 · 보통 10) + 마감(지연 45+ · 오늘 40 · 내일 25 · 3일 15 · 7일 6) + ⭐ 집중 30 + 진행 중 8 + 끝나가는 프로젝트 소속 8
 *   대기(기다리는 중) 할 일은 빼고, 마감 없는 일은 긴급 · 집중 · 진행 중일 때만, 20점 아래는 추천 안 함
 */
var db = require('../config/db');
var myWork = require('./my-work');
var myProj = require('./my-projects');

var DEFAULT_CATS = [
  { name: '지금 하기', icon: '🔥', rule: 1 },
  { name: '계획하기', icon: '📅', rule: 2 },
  { name: '빨리 끝내기 · 맡기기', icon: '⚡', rule: 3 },
  { name: '나중에', icon: '🗂', rule: 4 }
];
var PRI_SCORE = { 1: 40, 2: 25, 3: 10, 4: 0 };

function days(a, b) { return myWork.daysBetween(a, b); }

async function loadMine(req, user) {
  var tid = req.tenant.id, uid = req.user.sub;
  var itemsP = myWork.collect(req, [{ id: uid, name: user.name || req.user.name || '' }], { done: false });
  var mkP = db.query('SELECT item_key, focus_date, sort_order, category_id, project_id FROM my_work_marks WHERE user_id = $1 AND tenant_id = $2', [uid, tid]);
  var catP = db.query('SELECT id, name, icon, rule FROM my_work_categories WHERE tenant_id = $1 AND user_id = $2 ORDER BY sort_order, created_at', [tid, uid]);
  var pjP = myProj.list(req);
  [itemsP, mkP, catP, pjP].forEach(function (p) { p.catch(function () {}); });
  var got = await Promise.all([itemsP, mkP, catP, pjP]);
  var by = {};
  got[1].rows.forEach(function (m) { by[m.item_key] = m; });
  var items = got[0].filter(function (it) { return !it.done; });
  items.forEach(function (it) {
    var m = by[it.src + ':' + it.id];
    if (!m) return;
    if (m.focus_date) it.focus = m.focus_date;
    if (m.category_id) it.cat = m.category_id;
    if (m.project_id) it.proj = m.project_id;
  });
  var cats = got[2].rows.length ? got[2].rows : DEFAULT_CATS.map(function (d) { return { id: 'catd-' + d.rule + '-' + uid, name: d.name, icon: d.icon, rule: d.rule }; });
  return { items: items, projs: got[3].data, cats: cats, today: myWork.kstToday() };
}

/** 보드 칸 규칙 — 1 중요·급함 2 중요 3 급함 4 나머지 (급함 = 마감 2일 안) */
function quadOf(it, today) {
  var imp = it.pri <= 2;
  var urg = !!it.due && days(today, it.due) <= 2;
  return imp ? (urg ? 1 : 2) : (urg ? 3 : 4);
}
function colOf(it, cats, today) {
  var i;
  if (it.cat) for (i = 0; i < cats.length; i++) if (cats[i].id === it.cat) return cats[i];
  var q = quadOf(it, today);
  for (i = 0; i < cats.length; i++) if (cats[i].rule === q) return cats[i];
  return { id: 'none', name: '분류 안 됨', icon: '📥' };
}
/** 항목이 든 내 프로젝트 — 웹 mwProjOf 와 같은 규칙 */
function projOf(it, projs) {
  if (it.proj === '-') return null;
  if (it.proj) return projs.filter(function (p) { return p.id === it.proj; })[0] || null;
  if (!it.projectId) return null;
  return projs.filter(function (p) { return p.link && p.link === it.projectId; })[0] || null;
}

function recommend(mine) {
  var today = mine.today, projs = mine.projs || [];
  var ending = {};
  var projEnding = [];
  projs.forEach(function (p) {
    if (p.status === 'done' || !p.end) return;
    var d = days(today, p.end);
    if (d > 7) return;
    var open = mine.items.filter(function (it) { return projOf(it, projs) === p; }).length;
    if (d >= 0) ending[p.id] = d;
    if (open || d < 0) projEnding.push({ p: p, d: d, open: open });
  });
  projEnding.sort(function (a, b) { return a.d - b.d; });
  var scored = [];
  mine.items.forEach(function (it) {
    if (it.done || it.todoStatus === 'waiting') return;
    var s = PRI_SCORE[it.pri] != null ? PRI_SCORE[it.pri] : 10, why = [];
    if (it.pri === 1) why.push('긴급');
    else if (it.pri === 2) why.push('중요');
    if (it.due) {
      var d = days(today, it.due);
      if (d < 0) { s += 45 + Math.min(-d, 10) * 2; why.unshift('지연 ' + (-d) + '일'); }
      else if (d === 0) { s += 40; why.unshift('오늘 마감' + (it.dueTime ? ' ' + it.dueTime : '')); }
      else if (d === 1) { s += 25; why.unshift('내일 마감'); }
      else if (d <= 3) { s += 15; why.unshift('D-' + d); }
      else if (d <= 7) s += 6;
    }
    if (it.focus) { s += 30; why.unshift('⭐ 집중'); }
    if (it.todoStatus === 'doing') { s += 8; why.push('진행 중'); }
    var p = projOf(it, projs);
    if (p && ending[p.id] != null) { s += 8; why.push('📁 ' + p.title + ' D-' + ending[p.id]); }
    // 마감 없는 일은 긴급 · 집중 · 진행 중일 때만 — 나머지는 아래 '마감 없는 중요한 일'로 따로 권함
    if (!it.due && it.pri > 1 && !it.focus && it.todoStatus !== 'doing') return;
    if (s < 20) return;
    scored.push({ it: it, score: s, why: why });
  });
  scored.sort(function (a, b) { return b.score - a.score || String(a.it.due || '9999').localeCompare(String(b.it.due || '9999')); });
  var inTop = {};
  scored.slice(0, 5).forEach(function (x) { inTop[x.it.key || x.it.src + ':' + x.it.id] = true; });
  var noDue = mine.items.filter(function (it) { return !it.due && it.pri <= 2 && it.todoStatus !== 'waiting' && !inTop[it.key || it.src + ':' + it.id]; }).sort(function (a, b) { return a.pri - b.pri; });
  var waiting = mine.items.filter(function (it) { return it.todoStatus === 'waiting'; });
  var late = 0, todayN = 0;
  mine.items.forEach(function (it) { if (it.due) { var d = days(today, it.due); if (d < 0) late++; else if (d === 0) todayN++; } });
  return {
    top: scored.slice(0, 5), more: Math.max(0, scored.length - 5),
    noDue: noDue, waiting: waiting, projEnding: projEnding,
    noFocus: !mine.items.some(function (it) { return it.focus; }),
    late: late, today: todayN, open: mine.items.length
  };
}

module.exports = { loadMine: loadMine, recommend: recommend, quadOf: quadOf, colOf: colOf, projOf: projOf, DEFAULT_CATS: DEFAULT_CATS };
