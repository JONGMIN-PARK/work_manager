/**
 * 마인드맵 마감 알림 — 맵 문서(doc)에서 담당(assigneeId)이 있는 주제의 마감을 골라 사람별로 묶는다 (v13.238)
 * 순수 함수 — 날짜는 'YYYY-MM-DD' 문자열(KST) 로 받는다.
 *   today    : 마감이 오늘
 *   tomorrow : 마감이 내일
 *   late     : 지난 지 1 · 3 · 7 · 14일째 (매일 반복해서 보내지 않도록 이 날들만)
 * 완료(done) · 진척 100% 주제는 제외.
 */
var LATE_DAYS = [1, 3, 7, 14];

function _days(a, b) {
  return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000);
}

/** 한 맵 → [{ userId, kind, text, due, lateDays }] */
function collectDue(doc, today) {
  var out = [];
  ((doc && doc.sheets) || []).forEach(function (sh) {
    (function walk(n) {
      if (!n) return;
      var p = parseInt(n.progress, 10);
      var done = !!n.done || p >= 100;
      var due = typeof n.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(n.dueDate) ? n.dueDate : null;
      if (n.assigneeId && due && !done) {
        var d = _days(today, due);   // 마감 - 오늘
        var kind = d === 0 ? 'today' : d === 1 ? 'tomorrow' : (d < 0 && LATE_DAYS.indexOf(-d) >= 0) ? 'late' : null;
        if (kind) out.push({ userId: n.assigneeId, kind: kind, text: String(n.text || '').split('\n')[0].trim().slice(0, 80) || '(빈 주제)', due: due, lateDays: d < 0 ? -d : 0 });
      }
      (n.children || []).forEach(walk);
    })(sh.root);
  });
  return out;
}

/** 여러 맵 [{ id, title, doc }] → { userId: [{ mapId, mapTitle, kind, text, due, lateDays }] } (오늘 · 내일 · 지연 순) */
function groupDueByUser(maps, today) {
  var by = {};
  maps.forEach(function (m) {
    collectDue(m.doc, today).forEach(function (it) {
      (by[it.userId] = by[it.userId] || []).push({ mapId: m.id, mapTitle: m.title, kind: it.kind, text: it.text, due: it.due, lateDays: it.lateDays });
    });
  });
  var order = { today: 0, tomorrow: 1, late: 2 };
  Object.keys(by).forEach(function (u) { by[u].sort(function (a, b) { return order[a.kind] - order[b.kind] || b.lateDays - a.lateDays; }); });
  return by;
}

module.exports = { collectDue: collectDue, groupDueByUser: groupDueByUser, LATE_DAYS: LATE_DAYS };
