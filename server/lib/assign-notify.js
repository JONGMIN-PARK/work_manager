/**
 * 내 일에 추가 · 변경 알림 (v13.256) — 남이 나를 넣었을 때만 (본인이 한 것은 알리지 않음)
 *   · 일정: 담당(이름)에 새로 들어감 → '일정에 추가됨', 원래 담당이었는데 날짜 · 시각이 바뀜 → '일정 변경'
 *   · 맵 주제: assigneeId 가 새로 나로 바뀜 → 맵마다 한 번에 묶어서
 * 응답을 막지 않도록 호출하는 쪽에서 기다리지 않고 부르고, 실패는 로그만.
 */
var db = require('../config/db');
var notificationService = require('../services/notification.service');

function names(v) {
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { v = []; } }
  return Array.isArray(v) ? v.filter(Boolean).map(String) : [];
}

function when(ev) {
  return [ev.start_date || '', ev.start_time || '', ev.end_date || '', ev.end_time || ''].join('|');
}

/** 같은 테넌트의 활성 사용자 이름 → id (본인 제외) */
async function idsOf(tenantId, list, actorId) {
  if (!list.length) return [];
  var r = await db.query("SELECT id FROM users WHERE tenant_id = $1 AND status = 'active' AND name = ANY($2)", [tenantId, list]);
  return r.rows.map(function (x) { return x.id; }).filter(function (id) { return id !== actorId; });
}

/** prev 가 null 이면 새 일정 */
async function eventChanged(tenantId, actorId, actorName, prev, next) {
  try {
    if (!next) return;
    var before = prev ? names(prev.assignees) : [];
    var after = names(next.assignees);
    var added = after.filter(function (n) { return before.indexOf(n) < 0; });
    var moved = prev && when(prev) !== when(next) ? after.filter(function (n) { return before.indexOf(n) >= 0; }) : [];
    var base = {
      eventId: next.id, title: next.title, type: next.type, startDate: next.start_date, endDate: next.end_date,
      startTime: next.start_time || '', endTime: next.end_time || '', location: next.location || '', byName: actorName || ''
    };
    var addIds = await idsOf(tenantId, added, actorId);
    if (addIds.length) await notificationService.notify('event_assigned', Object.assign({ kind: 'added' }, base), addIds);
    var movIds = await idsOf(tenantId, moved, actorId);
    if (movIds.length) {
      await notificationService.notify('event_assigned', Object.assign({ kind: 'moved', prevDate: prev.start_date, prevTime: prev.start_time || '' }, base), movIds);
    }
  } catch (e) {
    console.error('[assign-notify/event]', e.message);
  }
}

/** 문서의 { nodeId: { a: assigneeId, text, due } } */
function assignMap(doc) {
  var out = {};
  if (typeof doc === 'string') { try { doc = JSON.parse(doc); } catch (_) { return out; } }
  ((doc && doc.sheets) || []).forEach(function (sh) {
    (function walk(n, depth) {
      if (!n || typeof n !== 'object' || depth > 60) return;
      if (n.assigneeId) out[n.id] = { a: String(n.assigneeId), text: String(n.text || '').replace(/\s+/g, ' ').trim(), due: n.dueDate || '' };
      (Array.isArray(n.children) ? n.children : []).forEach(function (c) { walk(c, depth + 1); });
    })(sh && sh.root, 0);
  });
  return out;
}

async function mindmapChanged(tenantId, actorId, actorName, map, oldDoc, newDoc) {
  try {
    var before = assignMap(oldDoc), after = assignMap(newDoc);
    var byUser = {};
    Object.keys(after).forEach(function (id) {
      var n = after[id];
      if (n.a === actorId || (before[id] && before[id].a === n.a)) return;
      (byUser[n.a] = byUser[n.a] || []).push({ nodeId: id, text: n.text || '(제목 없음)', due: n.due });
    });
    // 맵을 볼 수 있는 사람만 (소유자 · 보낸 사람 — mindmap-visible 과 같은 규칙)
    var see = {};
    see[String(map.owner_id)] = 1;
    names(map.editors).concat(names(map.viewers)).forEach(function (id) { see[id] = 1; });
    var uids = Object.keys(byUser).filter(function (id) { return see[id]; });
    if (!uids.length) return;
    // 같은 테넌트 · 활성 사용자만
    var ok = await db.query("SELECT id FROM users WHERE tenant_id = $1 AND status = 'active' AND id::text = ANY($2)", [tenantId, uids]);
    for (var i = 0; i < ok.rows.length; i++) {
      var uid = ok.rows[i].id;
      await notificationService.notify('mindmap_assigned', { mapId: map.id, mapTitle: map.title || '', byName: actorName || '', items: byUser[String(uid)] }, [uid]);
    }
  } catch (e) {
    console.error('[assign-notify/mindmap]', e.message);
  }
}

module.exports = { eventChanged: eventChanged, mindmapChanged: mindmapChanged, _assignMap: assignMap };
