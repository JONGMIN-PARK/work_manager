/**
 * 업무일지 분석기 — 프로젝트/마일스톤/일정 데이터 관리
 * IndexedDB 'WorkAnalyzerDB' v7 (projects, milestones, events, progressHistory, orders, checklists, issues, issueLogs, workRecords 스토어)
 *
 * === API 네이밍 규칙 (#14) ===
 * 공용 팩토리: dbPut(store, item), dbGetAll(store), dbGet(store, id), dbDel(store, id), dbGetByIndex(store, idx, key)
 * 엔티티별:   {prefix}Put, {prefix}GetAll, {prefix}Get, {prefix}Del
 *   proj*   → projects       | ms*      → milestones    | evt*     → events
 *   order*  → orders         | chk*     → checklists    | issue*   → issues
 *   issueLog* → issueLogs   | wr*      → workRecords
 * localStorage: lsGet(key), lsSet(key,val), lsRemove(key), lsGetJSON(key,fallback), lsSetJSON(key,val)
 * 모달: createModal({title, html, content, width, onClose, closeOnOverlay})
 * 토스트: showToast(msg, type)
 * 아카이브 캐시: invalidateArchiveCache()
 */

/* ═══ DB 업그레이드 (v1→v2→v3→v4) ═══ */
function upgradeProjectDB(db, tx) {
  if (!db.objectStoreNames.contains('projects')) {
    var s = db.createObjectStore('projects', { keyPath: 'id' });
    s.createIndex('orderNo', 'orderNo', { unique: false });
    s.createIndex('status', 'status', { unique: false });
  }
  if (!db.objectStoreNames.contains('milestones')) {
    var m = db.createObjectStore('milestones', { keyPath: 'id' });
    m.createIndex('projectId', 'projectId', { unique: false });
  }
  if (!db.objectStoreNames.contains('events')) {
    var ev = db.createObjectStore('events', { keyPath: 'id' });
    ev.createIndex('startDate', 'startDate', { unique: false });
  }
  // v3: 진척률 히스토리 스토어
  if (!db.objectStoreNames.contains('progressHistory')) {
    var ph = db.createObjectStore('progressHistory', { keyPath: 'id' });
    ph.createIndex('projectId', 'projectId', { unique: false });
    ph.createIndex('date', 'date', { unique: false });
  }
  // v4: 수주 대장, v5: 체크리스트 스토어
  if (!db.objectStoreNames.contains('orders')) {
    var od = db.createObjectStore('orders', { keyPath: 'orderNo' });
    od.createIndex('client', 'client', { unique: false });
    od.createIndex('date', 'date', { unique: false });
  }
  // v5: 체크리스트 스토어
  if (!db.objectStoreNames.contains('checklists')) {
    var cl = db.createObjectStore('checklists', { keyPath: 'id' });
    cl.createIndex('projectId', 'projectId', { unique: false });
    cl.createIndex('phase', 'phase', { unique: false });
  }
  // v6: 이슈 스토어
  if (!db.objectStoreNames.contains('issues')) {
    var iss = db.createObjectStore('issues', { keyPath: 'id' });
    iss.createIndex('projectId', 'projectId', { unique: false });
    iss.createIndex('orderNo', 'orderNo', { unique: false });
    iss.createIndex('phase', 'phase', { unique: false });
    iss.createIndex('dept', 'dept', { unique: false });
    iss.createIndex('status', 'status', { unique: false });
    iss.createIndex('urgency', 'urgency', { unique: false });
  }
  // v6: 이슈 대응 이력 스토어
  if (!db.objectStoreNames.contains('issueLogs')) {
    var il = db.createObjectStore('issueLogs', { keyPath: 'id' });
    il.createIndex('issueId', 'issueId', { unique: false });
    il.createIndex('date', 'date', { unique: false });
  }
  // v7: 업무일지 레코드 스토어
  if (!db.objectStoreNames.contains('workRecords')) {
    var wr = db.createObjectStore('workRecords', { keyPath: 'id', autoIncrement: true });
    wr.createIndex('date', 'date', { unique: false });
    wr.createIndex('name', 'name', { unique: false });
    wr.createIndex('orderNo', 'orderNo', { unique: false });
    wr.createIndex('dateNameOrder', ['date', 'name', 'orderNo'], { unique: false });
  }
  // v8: 프로젝트 문서 관리 스토어
  if (!db.objectStoreNames.contains('projectFolders')) {
    var pf = db.createObjectStore('projectFolders', { keyPath: 'id' });
    pf.createIndex('projectId', 'projectId', { unique: false });
    pf.createIndex('parentId', 'parentId', { unique: false });
  }
  if (!db.objectStoreNames.contains('projectFiles')) {
    var fi = db.createObjectStore('projectFiles', { keyPath: 'id' });
    fi.createIndex('projectId', 'projectId', { unique: false });
    fi.createIndex('folderId', 'folderId', { unique: false });
    fi.createIndex('ext', 'ext', { unique: false });
  }
  // v4: projects에 currentPhase 인덱스 추가
  if (tx && db.objectStoreNames.contains('projects')) {
    var ps = tx.objectStore('projects');
    if (!ps.indexNames.contains('currentPhase')) {
      try { ps.createIndex('currentPhase', 'currentPhase', { unique: false }); } catch(ex) { /* 인덱스 이미 존재 — 정상 */ }
    }
  }
}

/* ═══ DB v3 열기 (기존 openDBv2 대체) ═══ */
function openDBv2() {
  return new Promise(function (res, rej) {
    var req = indexedDB.open('WorkAnalyzerDB', 8);
    req.onupgradeneeded = function (e) {
      var d = e.target.result;
      // v1 스토어
      if (!d.objectStoreNames.contains('weeks')) d.createObjectStore('weeks', { keyPath: 'id' });
      // v2+ 스토어
      upgradeProjectDB(d, e.target.transaction);
    };
    req.onsuccess = function (e) { db = e.target.result; res(db); };
    req.onerror = function (e) { rej(e); };
  });
}

/* ═══ UUID 생성 ═══ */
function uuid() {
  return 'xxxx-xxxx-xxxx'.replace(/x/g, function () {
    return (Math.random() * 16 | 0).toString(16);
  });
}

/* ═══ #1 리팩토링: 공용 CRUD 팩토리 ═══ */
function dbPut(storeName, item) {
  return new Promise(function (res, rej) {
    var tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(item);
    tx.oncomplete = function () { res(item); };
    tx.onerror = function (e) { console.warn('[DB] put error on ' + storeName, e); rej(e); };
  });
}
function dbGetAll(storeName) {
  return new Promise(function (res, rej) {
    var tx = db.transaction(storeName, 'readonly');
    var req = tx.objectStore(storeName).getAll();
    req.onsuccess = function () { res(req.result || []); };
    req.onerror = function (e) { console.warn('[DB] getAll error on ' + storeName, e); rej(e); };
  });
}
function dbGet(storeName, id) {
  return new Promise(function (res, rej) {
    var tx = db.transaction(storeName, 'readonly');
    var req = tx.objectStore(storeName).get(id);
    req.onsuccess = function () { res(req.result); };
    req.onerror = function (e) { console.warn('[DB] get error on ' + storeName, e); rej(e); };
  });
}
function dbDel(storeName, id) {
  return new Promise(function (res, rej) {
    var tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = function () { res(); };
    tx.onerror = function (e) { console.warn('[DB] del error on ' + storeName, e); rej(e); };
  });
}
function dbGetByIndex(storeName, indexName, key) {
  return new Promise(function (res, rej) {
    var tx = db.transaction(storeName, 'readonly');
    var req = tx.objectStore(storeName).index(indexName).getAll(key);
    req.onsuccess = function () { res(req.result || []); };
    req.onerror = function (e) { console.warn('[DB] index query error on ' + storeName + '.' + indexName, e); rej(e); };
  });
}

/* ═══ #12 리팩토링: localStorage 래퍼 ═══ */
function lsGet(key, fallback) {
  try { var v = localStorage.getItem(key); return v !== null ? v : (fallback !== undefined ? fallback : null); }
  catch (e) { console.warn('[LS] read error', key, e); return fallback !== undefined ? fallback : null; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, value); }
  catch (e) { console.warn('[LS] write error', key, e); }
}
function lsRemove(key) {
  try { localStorage.removeItem(key); }
  catch (e) { console.warn('[LS] remove error', key, e); }
}
function lsGetJSON(key, fallback) {
  try { var v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : (fallback !== undefined ? fallback : null); }
  catch (e) { console.warn('[LS] JSON parse error', key, e); return fallback !== undefined ? fallback : null; }
}
function lsSetJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (e) { console.warn('[LS] JSON write error', key, e); }
}

/* ═══ #4/#10 리팩토링: 아카이브 캐시 ═══ */
var _archiveCache = { data: null, ts: 0 };
var ARCHIVE_CACHE_TTL = 5000; // 5초 캐시

function invalidateArchiveCache() { _archiveCache.data = null; _archiveCache.ts = 0; }

/* ═══ #13 리팩토링: 매직 넘버 상수 ═══ */
var REPEAT_LIMIT = 200;
var TOAST_DURATION = 2500;
var TOAST_FADE = 300;
var PROGRESS_MAX = 100;

/* ═══ 프로젝트 CRUD (팩토리 기반) ═══ */
function projPut(proj) { return dbPut('projects', proj); }
function projGetAll() { return dbGetAll('projects'); }
function projGet(id) { return dbGet('projects', id); }
function projDel(id) { return dbDel('projects', id); }

function createProject(data) {
  var now = new Date().toISOString();
  var defaultPhases = { order: { status: 'waiting', startDate: '', endDate: '' }, design: { status: 'waiting', startDate: '', endDate: '' }, manufacture: { status: 'waiting', startDate: '', endDate: '' }, inspect: { status: 'waiting', startDate: '', endDate: '' }, deliver: { status: 'waiting', startDate: '', endDate: '' }, as: { status: 'waiting', startDate: '', endDate: '' } };
  var proj = {
    id: 'proj-' + uuid(),
    orderNo: (data.orderNo || '').trim(),
    name: (data.name || '').trim(),
    startDate: data.startDate || '',
    endDate: data.endDate || '',
    status: data.status || 'active',
    progress: data.progress || 0,
    estimatedHours: data.estimatedHours || 0,
    assignees: data.assignees || [],
    dependencies: data.dependencies || [],
    color: data.color || COL[(Math.random() * COL.length | 0)],
    memo: data.memo || '',
    currentPhase: data.currentPhase || 'order',
    phases: data.phases || defaultPhases,
    createdAt: now,
    updatedAt: now,
    _isNew: true
  };
  return projPut(proj);
}

function updateProject(id, updates) {
  return projGet(id).then(function (p) {
    if (!p) return null;
    Object.assign(p, updates, { updatedAt: new Date().toISOString() });
    return projPut(p);
  });
}

/* ═══ 마일스톤 CRUD (팩토리 기반) ═══ */
function msPut(ms) { return dbPut('milestones', ms); }
function msGetAll() { return dbGetAll('milestones'); }

function msGetByProject(projectId) {
  return msGetAll().then(function (all) {
    return all.filter(function (m) { return m.projectId === projectId; });
  });
}

function msDel(id) { return dbDel('milestones', id); }

function msDelByProject(projectId) {
  return msGetByProject(projectId).then(function (list) {
    return Promise.all(list.map(function (m) { return msDel(m.id); }));
  });
}

function createMilestone(data) {
  var ms = {
    id: 'ms-' + uuid(),
    projectId: data.projectId,
    name: (data.name || '').trim(),
    startDate: data.startDate || '',
    endDate: data.endDate || '',
    status: data.status || 'waiting',
    order: data.order || 0,
    createdAt: new Date().toISOString(),
    _isNew: true
  };
  return msPut(ms);
}

/* ═══ 일정(이벤트) CRUD (팩토리 기반) ═══ */
function evtPut(evt) { return dbPut('events', evt); }
function evtGetAll() { return dbGetAll('events'); }
function evtGet(id) { return dbGet('events', id); }
function evtDel(id) { return dbDel('events', id); }

function createEvent(data) {
  var now = new Date().toISOString();
  var evt = {
    id: 'evt-' + uuid(),
    title: (data.title || '').trim(),
    type: data.type || 'etc',
    startDate: data.startDate || '',
    endDate: data.endDate || data.startDate || '',
    projectIds: data.projectIds || [],
    assignees: data.assignees || [],
    color: data.color || (EVT_TYPE[data.type] || EVT_TYPE.etc).color,
    memo: data.memo || '',
    repeat: data.repeat || null, // null, 'weekly', 'biweekly', 'monthly'
    repeatUntil: data.repeatUntil || '', // 반복 종료일
    createdAt: now
  };
  return evtPut(evt);
}

function dateToStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* ═══ 반복 일정 인스턴스 확장 ═══ */
function expandRepeatingEvents(events, viewStart, viewEnd) {
  var result = [];
  events.forEach(function (ev) {
    result.push(ev);
    if (!ev.repeat || !ev.startDate) return;
    var duration = daysDiff(ev.startDate, ev.endDate) || 0;
    var until = ev.repeatUntil || viewEnd;
    if (until > viewEnd) until = viewEnd;
    var cur = new Date(ev.startDate);
    var limit = REPEAT_LIMIT;
    while (limit-- > 0) {
      if (ev.repeat === 'weekly') cur.setDate(cur.getDate() + 7);
      else if (ev.repeat === 'biweekly') cur.setDate(cur.getDate() + 14);
      else if (ev.repeat === 'monthly') cur.setMonth(cur.getMonth() + 1);
      else break;
      var ns = dateToStr(cur);
      if (ns > until) break;
      if (ns < viewStart && ns < ev.startDate) continue;
      var nd = new Date(cur);
      nd.setDate(nd.getDate() + duration);
      var ne = dateToStr(nd);
      // 가상 인스턴스 (원본 ID 유지하여 편집 가능)
      var inst = {};
      for (var k in ev) inst[k] = ev[k];
      inst.startDate = ns;
      inst.endDate = ne;
      inst._repeatInstance = true;
      inst._origId = ev.id;
      result.push(inst);
    }
  });
  return result;
}

function updateEvent(id, updates) {
  return evtGet(id).then(function (e) {
    if (!e) return null;
    Object.assign(e, updates);
    return evtPut(e);
  });
}

/* ═══ 프로젝트 상태 자동 판별 ═══ */
function autoProjectStatus(proj) {
  if (proj.status === 'done' || proj.status === 'hold') return proj.status;
  var today = localDate();
  if (proj.endDate && proj.endDate < today) return 'delayed';
  if (proj.startDate && proj.startDate <= today) return 'active';
  return 'waiting';
}

/* ═══ 프로젝트 삭제 (마일스톤 포함) ═══ */
function deleteProjectCascade(id) {
  // 이슈 + 이슈로그 삭제
  var issDel = typeof issueGetByProject === 'function'
    ? issueGetByProject(id).then(function (issues) {
        return Promise.all(issues.map(function (iss) { return deleteIssueCascade(iss.id); }));
      })
    : Promise.resolve();
  // 체크리스트도 삭제
  var chkDel = typeof chkDelByProject === 'function' ? chkDelByProject(id) : Promise.resolve();
  // 문서 파일/폴더 삭제
  var docDel = typeof deleteProjectFiles === 'function' ? deleteProjectFiles(id) : Promise.resolve();
  return Promise.all([issDel, chkDel, docDel]).then(function () { return msDelByProject(id); }).then(function () {
    // 이벤트에서 삭제된 프로젝트 참조 제거
    return evtGetAll().then(function (events) {
      var updates = [];
      events.forEach(function (ev) {
        if (ev.projectIds && ev.projectIds.includes(id)) {
          ev.projectIds = ev.projectIds.filter(function (pid) { return pid !== id; });
          updates.push(evtPut(ev));
        }
      });
      return Promise.all(updates);
    });
  }).then(function () {
    // 다른 프로젝트의 의존관계에서 제거
    return projGetAll().then(function (projects) {
      var updates = [];
      projects.forEach(function (p) {
        if (p.dependencies && p.dependencies.includes(id)) {
          p.dependencies = p.dependencies.filter(function (did) { return did !== id; });
          updates.push(projPut(p));
        }
      });
      return Promise.all(updates);
    });
  }).then(function () {
    return projDel(id);
  });
}

/* ═══ 아카이브 전체 레코드 읽기 (캐시 적용) ═══ */
function readAllArchiveRecords() {
  var now = Date.now();
  if (_archiveCache.data && (now - _archiveCache.ts) < ARCHIVE_CACHE_TTL) {
    return Promise.resolve(_archiveCache.data);
  }
  return new Promise(function (res, rej) {
    var tx = db.transaction('weeks', 'readonly');
    var req = tx.objectStore('weeks').getAll();
    req.onsuccess = function () {
      var weeks = req.result || [];
      var records = [];
      weeks.forEach(function (w) {
        if (!w.data || !Array.isArray(w.data)) return;
        w.data.forEach(function (r) { records.push(r); });
      });
      _archiveCache.data = records;
      _archiveCache.ts = Date.now();
      res(records);
    };
    req.onerror = function (e) { console.warn('[DB] readAllArchiveRecords error', e); rej(e); };
  });
}

/* ═══ 진척률 자동 산출 (아카이브 연동) ═══ */
function calcProgressFromArchive() {
  return readAllArchiveRecords().then(function (records) {
    var hoursByOrder = {};
    records.forEach(function (r) {
      if (!r.orderNo) return;
      var key = r.orderNo.trim();
      hoursByOrder[key] = (hoursByOrder[key] || 0) + (r.hours || 0);
    });
    return hoursByOrder;
  });
}

function autoUpdateProgress() {
  return calcProgressFromArchive().then(function (hoursByOrder) {
    return projGetAll().then(function (projects) {
      var updates = [];
      projects.forEach(function (p) {
        if (!p.orderNo || !p.estimatedHours || p.estimatedHours <= 0) return;
        var key = p.orderNo.trim();
        var actual = hoursByOrder[key] || 0;
        if (actual <= 0) return;
        var progress = Math.min(Math.round((actual / p.estimatedHours) * 100), PROGRESS_MAX);
        if (progress !== p.progress) {
          updates.push({ id: p.id, progress: progress, actualHours: Math.round(actual * 10) / 10 });
        }
      });
      return Promise.all(updates.map(function (u) {
        return updateProject(u.id, { progress: u.progress, actualHours: u.actualHours });
      })).then(function () {
        // Integration 5: 진척률 변경 시 히스토리 스냅샷 저장
        return Promise.all(updates.map(function (u) {
          return saveProgressSnapshot(u.id, u.progress, u.actualHours);
        }));
      }).then(function () { return updates.length; });
    });
  });
}

/* ═══ Integration 1: 수주번호별 업무유형 분포 ═══ */
function calcTaskDistByOrder() {
  return readAllArchiveRecords().then(function (records) {
    // { orderNo: { A: hours, B: hours, ... } }
    var dist = {};
    records.forEach(function (r) {
      if (!r.orderNo || !r.abbr) return;
      var key = r.orderNo.trim();
      var abbr = r.abbr.trim().charAt(0).toUpperCase();
      if (!dist[key]) dist[key] = {};
      dist[key][abbr] = (dist[key][abbr] || 0) + (r.hours || 0);
    });
    return dist;
  });
}

/* ═══ Integration 4: 마일스톤별 실적 시간 집계 ═══ */
function calcHoursByMilestone(projectId) {
  return projGet(projectId).then(function (proj) {
    if (!proj || !proj.orderNo) return {};
    return msGetByProject(projectId).then(function (milestones) {
      if (!milestones.length) return {};
      milestones.sort(function (a, b) { return (a.startDate || '') < (b.startDate || '') ? -1 : 1; });
      return readAllArchiveRecords().then(function (records) {
        var orderKey = proj.orderNo.trim();
        var result = {};
        milestones.forEach(function (ms) { result[ms.id] = { hours: 0, records: 0, name: ms.name }; });
        records.forEach(function (r) {
          if (!r.orderNo || r.orderNo.trim() !== orderKey) return;
          if (!r.date) return;
          // YYYYMMDD → YYYY-MM-DD
          var recDate = r.date.length === 8
            ? r.date.slice(0, 4) + '-' + r.date.slice(4, 6) + '-' + r.date.slice(6, 8)
            : r.date;
          // 해당 날짜를 포함하는 마일스톤 찾기
          var matched = false;
          for (var i = 0; i < milestones.length; i++) {
            var ms = milestones[i];
            if (ms.startDate && ms.endDate && recDate >= ms.startDate && recDate <= ms.endDate) {
              result[ms.id].hours += (r.hours || 0);
              result[ms.id].records += 1;
              matched = true;
              break;
            }
          }
          // 매칭 안 되면 날짜가 가장 가까운 마일스톤에 배정
          if (!matched && milestones.length) {
            var bestIdx = 0;
            var bestDist = Infinity;
            for (var j = 0; j < milestones.length; j++) {
              var msEnd = milestones[j].endDate || milestones[j].startDate;
              if (!msEnd) continue;
              var d = Math.abs(daysDiff(recDate, msEnd));
              if (d < bestDist) { bestDist = d; bestIdx = j; }
            }
            result[milestones[bestIdx].id].hours += (r.hours || 0);
            result[milestones[bestIdx].id].records += 1;
          }
        });
        // 소수점 정리
        Object.keys(result).forEach(function (k) {
          result[k].hours = Math.round(result[k].hours * 10) / 10;
        });
        return result;
      });
    });
  });
}

/* ═══ Integration 5: 진척률 히스토리 ═══ */
function saveProgressSnapshot(projectId, progress, actualHours) {
  var today = localDate();
  if (!db.objectStoreNames.contains('progressHistory')) return Promise.resolve();
  var snapshot = {
    id: projectId + '_' + today,
    projectId: projectId,
    date: today,
    progress: progress,
    actualHours: actualHours || 0,
    timestamp: new Date().toISOString()
  };
  return dbPut('progressHistory', snapshot);
}

function getProgressHistory(projectId) {
  if (!db.objectStoreNames.contains('progressHistory')) return Promise.resolve([]);
  return dbGetByIndex('progressHistory', 'projectId', projectId).then(function (results) {
    return results.sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    });
  });
}

/* ═══ Integration 8: 아카이브 패턴 기반 마일스톤 자동 제안 ═══ */
function suggestMilestones(orderNo, startDate, endDate) {
  return new Promise(function (res, rej) {
    var tx = db.transaction('weeks', 'readonly');
    var req = tx.objectStore('weeks').getAll();
    req.onsuccess = function () {
      var weeks = req.result || [];
      var records = [];
      weeks.forEach(function (w) {
        if (!w.data || !Array.isArray(w.data)) return;
        w.data.forEach(function (r) {
          if (r.orderNo && r.orderNo.trim() === orderNo.trim()) {
            records.push(r);
          }
        });
      });
      if (!records.length) { res([]); return; }

      records.sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });

      // 날짜별 업무분장 시간 집계
      var dateMap = {};
      records.forEach(function (r) {
        var d = r.date || '';
        if (!dateMap[d]) dateMap[d] = {};
        var abbr = (r.abbr || r.taskType || 'G').charAt(0).toUpperCase();
        dateMap[d][abbr] = (dateMap[d][abbr] || 0) + (r.hours || 0);
      });

      var dates = Object.keys(dateMap).sort();
      if (!dates.length) { res([]); return; }

      // 각 날짜의 지배적 업무유형
      var dominantByDate = dates.map(function (d) {
        var dist = dateMap[d];
        var maxAbbr = 'G'; var maxH = 0;
        for (var k in dist) { if (dist[k] > maxH) { maxH = dist[k]; maxAbbr = k; } }
        return { date: d, dominant: maxAbbr };
      });

      // 연속된 같은 지배적 유형을 구간으로 묶기
      var phases = [];
      var curPhase = { abbr: dominantByDate[0].dominant, startDate: dominantByDate[0].date, endDate: dominantByDate[0].date };
      for (var i = 1; i < dominantByDate.length; i++) {
        if (dominantByDate[i].dominant === curPhase.abbr) {
          curPhase.endDate = dominantByDate[i].date;
        } else {
          phases.push(curPhase);
          curPhase = { abbr: dominantByDate[i].dominant, startDate: dominantByDate[i].date, endDate: dominantByDate[i].date };
        }
      }
      phases.push(curPhase);

      function toISO(d) { return d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8); }

      var amLabels = typeof AM !== 'undefined' ? AM : { A: 'A(CS현장)', B: 'B(제작)', D: 'D(개발)', G: 'G(일반)', M: 'M(관리)', S: 'S(영업지원)' };
      var suggestions = phases.map(function (ph, idx) {
        var label = amLabels[ph.abbr] || ph.abbr;
        return { name: label + ' 집중 구간', startDate: toISO(ph.startDate), endDate: toISO(ph.endDate), status: 'done', order: idx };
      });

      // 인접 동일 유형 병합
      var merged = [];
      suggestions.forEach(function (s) {
        if (merged.length && s.name === merged[merged.length - 1].name) {
          merged[merged.length - 1].endDate = s.endDate;
        } else {
          merged.push({ name: s.name, startDate: s.startDate, endDate: s.endDate, status: s.status, order: merged.length });
        }
      });

      res(merged);
    };
    req.onerror = function (e) { rej(e); };
  });
}

/* ═══ Integration 9: 달력에 주간 업무 요약 오버레이 ═══ */
function getWeeklyArchiveSummary() {
  return new Promise(function (res, rej) {
    var tx = db.transaction('weeks', 'readonly');
    var req = tx.objectStore('weeks').getAll();
    req.onsuccess = function () {
      var weeks = req.result || [];
      var summaries = [];
      weeks.forEach(function (w) {
        var dr = w.dateRange || [];
        if (!dr.length || !dr[0]) return;
        var startDate = dr[0].slice(0, 4) + '-' + dr[0].slice(4, 6) + '-' + dr[0].slice(6, 8);
        var endDate = dr[1] ? dr[1].slice(0, 4) + '-' + dr[1].slice(4, 6) + '-' + dr[1].slice(6, 8) : startDate;
        var memberCount = (w.selectedNames || []).length;
        summaries.push({
          startDate: startDate,
          endDate: endDate,
          totalHours: w.totalHours || 0,
          memberCount: memberCount,
          label: w.label || ''
        });
      });
      res(summaries);
    };
    req.onerror = function (e) { rej(e); };
  });
}

/* ═══ Integration 10 helper: 최근 아카이브 데이터 읽기 ═══ */
function getRecentArchiveWeeks(count) {
  return new Promise(function (res, rej) {
    var tx = db.transaction('weeks', 'readonly');
    var req = tx.objectStore('weeks').getAll();
    req.onsuccess = function () {
      var weeks = req.result || [];
      weeks.sort(function (a, b) { return (b.savedAt || '').localeCompare(a.savedAt || ''); });
      res(weeks.slice(0, count || 4));
    };
    req.onerror = function (e) { rej(e); };
  });
}

/* ═══ 날짜 유틸 ═══ */
function datesBetween(start, end) {
  var arr = [];
  var d = new Date(start);
  var e = new Date(end);
  while (d <= e) {
    arr.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return arr;
}

function daysDiff(start, end) {
  return Math.round((new Date(end) - new Date(start)) / 86400000);
}

function localDate() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }

/* ═══ 수주 대장 CRUD (팩토리 기반) ═══ */
function orderPut(order) { return dbPut('orders', order); }
function orderGetAll() { return dbGetAll('orders'); }
function orderGet(orderNo) { return dbGet('orders', orderNo); }
function orderDel(orderNo) { return dbDel('orders', orderNo); }

/* 수주 등록 + ORDER_MAP 동기화 */
function createOrder(data) {
  var now = new Date().toISOString();
  var order = {
    orderNo: data.orderNo,
    date: data.date || '',
    client: data.client || '',
    name: data.name || '',
    amount: data.amount || 0,
    manager: data.manager || '',
    delivery: data.delivery || '',
    memo: data.memo || '',
    createdAt: now
  };
  // ORDER_MAP 동기화
  if (typeof ORDER_MAP !== 'undefined') {
    ORDER_MAP[order.orderNo] = { name: order.name, date: order.date, client: order.client, amount: String(order.amount), manager: order.manager, delivery: order.delivery };
  }
  if (order.name) lsSet('wa-oc-' + order.orderNo, order.name);
  return orderPut(order);
}

/* 수주 삭제 + ORDER_MAP 동기화 */
function deleteOrder(orderNo) {
  if (typeof ORDER_MAP !== 'undefined') delete ORDER_MAP[orderNo];
  lsRemove('wa-oc-' + orderNo);
  return orderDel(orderNo);
}

/* 엑셀 → orders 스토어 일괄 동기화 */
function syncOrderMapToDB() {
  if (typeof ORDER_MAP === 'undefined') return Promise.resolve();
  var keys = Object.keys(ORDER_MAP);
  if (keys.length === 0) return Promise.resolve();
  return new Promise(function (res, rej) {
    var tx = db.transaction('orders', 'readwrite');
    var store = tx.objectStore('orders');
    var now = new Date().toISOString();
    keys.forEach(function (k) {
      var v = ORDER_MAP[k];
      var rec = {
        orderNo: k,
        date: (typeof v === 'object' ? v.date : '') || '',
        client: (typeof v === 'object' ? v.client : '') || '',
        name: (typeof v === 'object' ? v.name : v) || '',
        amount: (typeof v === 'object' ? Number(v.amount) || 0 : 0),
        manager: (typeof v === 'object' ? v.manager : '') || '',
        delivery: (typeof v === 'object' ? v.delivery : '') || '',
        memo: '',
        createdAt: now
      };
      store.put(rec);
    });
    tx.oncomplete = function () { res(); };
    tx.onerror = function (e) { rej(e); };
  });
}

/* orders DB → ORDER_MAP 동기화 (앱 시작 시) */
function loadOrdersToMap() {
  return orderGetAll().then(function (orders) {
    orders.forEach(function (o) {
      ORDER_MAP[o.orderNo] = { name: o.name, date: o.date, client: o.client, amount: String(o.amount || ''), manager: o.manager, delivery: o.delivery };
      if (o.name) lsSet('wa-oc-' + o.orderNo, o.name);
    });
    return orders;
  });
}

/* 수주에서 프로젝트 + 기본 마일스톤 자동 생성 */
function createProjectFromOrder(order) {
  var projId = 'proj-' + uuid();
  var now = new Date().toISOString();
  var startDate = order.date || localDate();
  var endDate = order.delivery || '';
  var defaultPhases = { order: { status: 'done', startDate: startDate, endDate: startDate }, design: { status: 'waiting', startDate: '', endDate: '' }, manufacture: { status: 'waiting', startDate: '', endDate: '' }, inspect: { status: 'waiting', startDate: '', endDate: '' }, deliver: { status: 'waiting', startDate: '', endDate: '' }, as: { status: 'waiting', startDate: '', endDate: '' } };
  var proj = {
    id: projId, orderNo: order.orderNo, name: order.name || order.orderNo,
    startDate: startDate, endDate: endDate, status: 'active', progress: 0,
    estimatedHours: 0, actualHours: 0, assignees: order.manager ? [order.manager] : [],
    dependencies: [], color: typeof COL !== 'undefined' ? COL[Math.floor(Math.random() * COL.length)] : '#3B82F6',
    memo: '', currentPhase: 'design', phases: defaultPhases,
    createdAt: now, updatedAt: now
  };
  // 기본 마일스톤 6개 생성 (프로젝트 저장 후 실행해야 FK 제약 충족)
  var phaseKeys = ['order', 'design', 'manufacture', 'inspect', 'deliver', 'as'];
  var phaseLabels = typeof PROJ_PHASE !== 'undefined' ? PROJ_PHASE : {};
  return projPut(proj).then(function () {
    var msPromises = phaseKeys.map(function (pk, idx) {
      var label = phaseLabels[pk] ? phaseLabels[pk].label : pk;
      return createMilestone({ projectId: projId, name: label, startDate: '', endDate: '', status: 'waiting', order: idx });
    });
    return Promise.all(msPromises);
  }).then(function () {
    // 기본 체크리스트 생성
    return createDefaultChecklists(projId);
  }).then(function () { return proj; });
}

/* ═══ 체크리스트 CRUD (팩토리 기반) ═══ */
function chkPut(item) { return dbPut('checklists', item); }

function chkGetByProject(projectId) {
  return dbGetByIndex('checklists', 'projectId', projectId).then(function (items) {
    return items.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  });
}

function chkGetByPhase(projectId, phase) {
  return chkGetByProject(projectId).then(function (items) {
    return items.filter(function (i) { return i.phase === phase; });
  });
}

function chkDel(id) { return dbDel('checklists', id); }

function chkDelByProject(projectId) {
  return chkGetByProject(projectId).then(function (items) {
    if (!items.length) return;
    return new Promise(function (res, rej) {
      var tx = db.transaction('checklists', 'readwrite');
      var store = tx.objectStore('checklists');
      items.forEach(function (i) { store.delete(i.id); });
      tx.oncomplete = function () { res(); };
      tx.onerror = function (e) { rej(e); };
    });
  });
}

/* 체크리스트 항목 생성 */
function createCheckItem(data) {
  var item = {
    id: 'chk-' + uuid(),
    projectId: data.projectId,
    phase: data.phase,
    text: data.text || '',
    done: false,
    doneDate: null,
    doneBy: null,
    dueDate: data.dueDate || '',
    order: data.order || 0,
    createdAt: new Date().toISOString()
  };
  return chkPut(item);
}

/* 체크리스트 항목 토글 */
function toggleCheckItem(id, doneBy) {
  return new Promise(function (res, rej) {
    var tx = db.transaction('checklists', 'readwrite');
    var store = tx.objectStore('checklists');
    var req = store.get(id);
    req.onsuccess = function () {
      var item = req.result;
      if (!item) { res(null); return; }
      item.done = !item.done;
      item.doneDate = item.done ? localDate() : null;
      item.doneBy = item.done ? (doneBy || '') : null;
      store.put(item);
    };
    tx.oncomplete = function () { res(req.result); };
    tx.onerror = function (e) { rej(e); };
  });
}

/* 단계별 완료율 계산 */
function calcPhaseProgress(projectId, phase) {
  return chkGetByPhase(projectId, phase).then(function (items) {
    if (!items.length) return { total: 0, done: 0, pct: 0 };
    var done = items.filter(function (i) { return i.done; }).length;
    return { total: items.length, done: done, pct: Math.round(done / items.length * 100) };
  });
}

/* 전 단계 완료율 한 번에 계산 */
function calcAllPhaseProgress(projectId) {
  return chkGetByProject(projectId).then(function (items) {
    var result = {};
    var phases = typeof PROJ_PHASE !== 'undefined' ? Object.keys(PROJ_PHASE) : [];
    phases.forEach(function (ph) {
      var phItems = items.filter(function (i) { return i.phase === ph; });
      var done = phItems.filter(function (i) { return i.done; }).length;
      result[ph] = { total: phItems.length, done: done, pct: phItems.length ? Math.round(done / phItems.length * 100) : 0 };
    });
    return result;
  });
}

/* ═══ 기본 체크리스트 템플릿 ═══ */
var DEFAULT_CHECKLIST = {
  order: ['견적서 발행', '계약서 체결', '선급금 수령', '킥오프 미팅 완료', '요구사항 정의서 작성'],
  design: ['기구 설계 완료', '전장 설계 완료', 'SW 설계 완료', '설계 검토(DR) 완료', '자재 발주'],
  manufacture: ['자재 입고 확인', '기구 가공/조립 완료', '전장 배선 완료', 'SW 개발/탑재 완료', '단품 시험 완료'],
  inspect: ['자체 검수 완료', '검수 성적서 작성', '고객 입회 검수(FAT) 완료', '불량 시정 완료'],
  deliver: ['출하 검사 완료', '운송/설치 완료', '시운전 완료(SAT)', '운전 교육 완료', '인수인계서 서명'],
  as: ['하자보증 기간 설정', '정기점검 일정 등록', 'A/S 연락처 공유']
};

/* 프로젝트에 기본 체크리스트 일괄 생성 */
function createDefaultChecklists(projectId) {
  var promises = [];
  Object.keys(DEFAULT_CHECKLIST).forEach(function (phase) {
    DEFAULT_CHECKLIST[phase].forEach(function (text, idx) {
      promises.push(createCheckItem({ projectId: projectId, phase: phase, text: text, order: idx }));
    });
  });
  return Promise.all(promises);
}

/* 단계 전환 (게이트 체크) */
function advancePhase(projectId, targetPhase) {
  return projGet(projectId).then(function (proj) {
    if (!proj) return null;
    var curPhase = proj.currentPhase || 'order';
    // 현재 단계 체크리스트 완료 확인
    return calcPhaseProgress(projectId, curPhase).then(function (prog) {
      var result = { proj: proj, fromPhase: curPhase, toPhase: targetPhase, gatePass: true, progress: prog };
      if (prog.total > 0 && prog.pct < 100) {
        result.gatePass = false;
      }
      return result;
    });
  });
}

/* 단계 전환 실행 (강제 포함) */
function executePhaseTransition(projectId, targetPhase) {
  return projGet(projectId).then(function (proj) {
    if (!proj) return null;
    if (!proj.phases) proj.phases = {};
    // 현재 단계 완료 처리
    var curPhase = proj.currentPhase || 'order';
    if (proj.phases[curPhase]) {
      proj.phases[curPhase].status = 'done';
      if (!proj.phases[curPhase].endDate) proj.phases[curPhase].endDate = localDate();
    }
    // 새 단계 활성화
    proj.currentPhase = targetPhase;
    if (!proj.phases[targetPhase]) proj.phases[targetPhase] = {};
    proj.phases[targetPhase].status = 'active';
    if (!proj.phases[targetPhase].startDate) proj.phases[targetPhase].startDate = localDate();
    proj.updatedAt = new Date().toISOString();
    return projPut(proj);
  });
}

/* ═══ 이슈 CRUD (팩토리 기반) ═══ */
function issuePut(issue) { return dbPut('issues', issue); }
function issueGetAll() { return dbGetAll('issues'); }
function issueGet(id) { return dbGet('issues', id); }
function issueDel(id) { return dbDel('issues', id); }
function issueGetByProject(projectId) { return dbGetByIndex('issues', 'projectId', projectId); }
function issueGetByOrder(orderNo) { return dbGetByIndex('issues', 'orderNo', orderNo); }

function createIssue(data) {
  var now = new Date().toISOString();
  var issue = {
    id: 'iss-' + uuid(),
    projectId: data.projectId || '',
    orderNo: data.orderNo || '',
    phase: data.phase || 'order',
    dept: data.dept || '',
    title: data.title || '',
    type: data.type || 'etc',
    urgency: data.urgency || 'normal',
    status: 'open',
    reportDate: data.reportDate || localDate(),
    reporter: data.reporter || '',
    assignees: data.assignees || [],
    description: data.description || '',
    resolvedDate: null,
    resolution: '',
    tags: data.tags || [],
    createdAt: now
  };
  return issuePut(issue);
}

function updateIssue(id, updates) {
  return issueGet(id).then(function (issue) {
    if (!issue) return null;
    Object.assign(issue, updates);
    issue.updatedAt = new Date().toISOString();
    return issuePut(issue);
  });
}

function deleteIssueCascade(id) {
  return issueLogGetByIssue(id).then(function (logs) {
    return Promise.all(logs.map(function (l) { return issueLogDel(l.id); }));
  }).then(function () {
    return issueDel(id);
  });
}

/* ═══ 이슈 대응 이력 CRUD (팩토리 기반) ═══ */
function issueLogPut(log) { return dbPut('issueLogs', log); }
function issueLogDel(id) { return dbDel('issueLogs', id); }

function issueLogGetByIssue(issueId) {
  return dbGetByIndex('issueLogs', 'issueId', issueId).then(function (items) {
    return items.sort(function (a, b) {
      var da = (a.date || '') + (a.time || '');
      var db2 = (b.date || '') + (b.time || '');
      return da < db2 ? -1 : da > db2 ? 1 : 0;
    });
  });
}

function createIssueLog(data) {
  var now = new Date();
  var log = {
    id: 'ilog-' + uuid(),
    issueId: data.issueId || '',
    date: data.date || localDate(),
    time: data.time || (String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')),
    type: data.type || '기타',
    author: data.author || '',
    dept: data.dept || '',
    content: data.content || '',
    attachmentNote: data.attachmentNote || ''
  };
  return issueLogPut(log);
}

/* ═══ 업무일지 레코드 CRUD (팩토리 기반) ═══ */
function wrPut(record) { return dbPut('workRecords', record); }
function wrGetAll() { return dbGetAll('workRecords'); }

function wrClear() {
  return new Promise(function (res, rej) {
    var tx = db.transaction('workRecords', 'readwrite');
    tx.objectStore('workRecords').clear();
    tx.oncomplete = function () { res(); };
    tx.onerror = function (e) { console.warn('[DB] wrClear error', e); rej(e); };
  });
}

function wrBulkPut(records) {
  return new Promise(function (res, rej) {
    var tx = db.transaction('workRecords', 'readwrite');
    var st = tx.objectStore('workRecords');
    records.forEach(function (r) { st.put(r); });
    tx.oncomplete = function () { res(); };
    tx.onerror = function (e) { console.warn('[DB] wrBulkPut error', e); rej(e); };
  });
}

function wrCount() {
  return new Promise(function (res, rej) {
    var tx = db.transaction('workRecords', 'readonly');
    var req = tx.objectStore('workRecords').count();
    req.onsuccess = function () { res(req.result); };
    req.onerror = function (e) { console.warn('[DB] wrCount error', e); rej(e); };
  });
}

/* 업무일지 레코드 중복 키 생성 (date+name+orderNo+content) */
function wrRecordKey(r) {
  return (r.date || '') + '|' + (r.name || '') + '|' + (r.orderNo || '') + '|' + (r.content || '');
}

/* 기존 DB 레코드에 새 레코드 병합 (중복 제거 후 추가) */
function wrMerge(existingRecords, newRecords) {
  var keySet = {};
  existingRecords.forEach(function (r) { keySet[wrRecordKey(r)] = true; });
  var added = 0;
  var toAdd = [];
  newRecords.forEach(function (r) {
    var k = wrRecordKey(r);
    if (!keySet[k]) {
      keySet[k] = true;
      toAdd.push(r);
      added++;
    }
  });
  return { toAdd: toAdd, added: added };
}

/* ═══ #9 리팩토링: 페이지네이션 유틸리티 ═══ */
var PAGE_SIZE = 50;
function paginate(items, page, size) {
  size = size || PAGE_SIZE;
  page = Math.max(1, page || 1);
  var total = items.length;
  var totalPages = Math.ceil(total / size) || 1;
  page = Math.min(page, totalPages);
  var start = (page - 1) * size;
  return {
    items: items.slice(start, start + size),
    page: page,
    totalPages: totalPages,
    total: total,
    hasNext: page < totalPages,
    hasPrev: page > 1
  };
}

function renderPagination(containerId, pageInfo, onPageChange) {
  var el = document.getElementById(containerId);
  if (!el) return;
  if (pageInfo.totalPages <= 1) { el.innerHTML = ''; return; }
  var html = '<div style="display:flex;align-items:center;justify-content:center;gap:6px;padding:8px;font-size:11px;color:var(--t4)">';
  html += '<button class="btn btn-g btn-s" ' + (pageInfo.hasPrev ? '' : 'disabled') + ' onclick="(' + onPageChange + ')(' + (pageInfo.page - 1) + ')">&lt;</button>';
  html += '<span>' + pageInfo.page + ' / ' + pageInfo.totalPages + ' (' + pageInfo.total + '건)</span>';
  html += '<button class="btn btn-g btn-s" ' + (pageInfo.hasNext ? '' : 'disabled') + ' onclick="(' + onPageChange + ')(' + (pageInfo.page + 1) + ')">&gt;</button>';
  html += '</div>';
  el.innerHTML = html;
}

/* ═══ #11 리팩토링: 공용 모달 프레임 ═══ */
var MODAL_Z = 9999;
function createModal(opts) {
  var ov = document.createElement('div');
  ov.className = 'wa-modal-overlay';
  ov.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.55);z-index:' + MODAL_Z + ';display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)';
  var box = document.createElement('div');
  box.className = 'wa-modal-box';
  box.style.cssText = 'background:var(--bg-p);border:1px solid var(--bd);border-radius:14px;padding:24px;max-width:' + (opts.width || '600px') + ';width:100%;max-height:85vh;overflow-y:auto;box-shadow:0 12px 40px rgba(0,0,0,.3);color:var(--t2)';
  if (opts.title) {
    var hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:16px';
    hdr.innerHTML = '<span style="font-size:15px;font-weight:700;color:var(--t1)">' + opts.title + '</span>';
    var closeBtn = document.createElement('span');
    closeBtn.textContent = '\u2715';
    closeBtn.style.cssText = 'cursor:pointer;color:var(--t5);font-size:16px;padding:4px 8px;border-radius:6px;transition:all .15s';
    closeBtn.onmouseover = function () { this.style.color = 'var(--d-t)'; this.style.background = 'var(--d-bg)'; };
    closeBtn.onmouseout = function () { this.style.color = 'var(--t5)'; this.style.background = 'none'; };
    closeBtn.onclick = function () { ov.remove(); if (opts.onClose) opts.onClose(); };
    hdr.appendChild(closeBtn);
    box.appendChild(hdr);
  }
  if (opts.html) { var body = document.createElement('div'); body.innerHTML = opts.html; box.appendChild(body); }
  if (opts.content) { box.appendChild(opts.content); }
  ov.appendChild(box);
  if (opts.closeOnOverlay !== false) {
    ov.addEventListener('click', function (e) { if (e.target === ov) { ov.remove(); if (opts.onClose) opts.onClose(); } });
  }
  document.body.appendChild(ov);
  return { overlay: ov, box: box, close: function () { ov.remove(); if (opts.onClose) opts.onClose(); } };
}

/* ═══ 프로젝트 문서 관리 CRUD (v8) ═══ */
var DOC_FOLDER_DEFAULTS = ['order', 'design', 'manufacture', 'inspect', 'deliver', 'as'];
var DOC_MAX_FILE = 50 * 1024 * 1024; // 50MB
var DOC_MAX_PROJECT = 500 * 1024 * 1024; // 500MB

function folderPut(f) { return dbPut('projectFolders', f); }
function folderGetAll() { return dbGetAll('projectFolders'); }
function folderGet(id) { return dbGet('projectFolders', id); }
function folderDel(id) { return dbDel('projectFolders', id); }
function folderGetByProject(projId) { return dbGetByIndex('projectFolders', 'projectId', projId); }

function filePut(f) { return dbPut('projectFiles', f); }
function fileGetAll() { return dbGetAll('projectFiles'); }
function fileGet(id) { return dbGet('projectFiles', id); }
function fileDel(id) { return dbDel('projectFiles', id); }
function fileGetByFolder(folderId) { return dbGetByIndex('projectFiles', 'folderId', folderId); }
function fileGetByProject(projId) { return dbGetByIndex('projectFiles', 'projectId', projId); }

function createDefaultFolders(projectId) {
  var phaseLabels = typeof PROJ_PHASE !== 'undefined' ? PROJ_PHASE : {};
  return Promise.all(DOC_FOLDER_DEFAULTS.map(function (phase, idx) {
    var label = phaseLabels[phase] ? phaseLabels[phase].label : phase;
    return folderPut({
      id: 'fldr-' + uuid(),
      projectId: projectId,
      parentId: null,
      name: label,
      phase: phase,
      order: idx,
      createdAt: new Date().toISOString()
    });
  }));
}

function deleteProjectFiles(projectId) {
  return fileGetByProject(projectId).then(function (files) {
    return Promise.all(files.map(function (f) { return fileDel(f.id); }));
  }).then(function () {
    return folderGetByProject(projectId);
  }).then(function (folders) {
    return Promise.all(folders.map(function (f) { return folderDel(f.id); }));
  });
}

function getProjectStorageSize(projectId) {
  return fileGetByProject(projectId).then(function (files) {
    var total = 0;
    files.forEach(function (f) { total += (f.size || 0); });
    return { total: total, count: files.length };
  });
}

var DOC_ICONS = {
  pdf: { icon: '📕', color: '#EF4444' },
  xlsx: { icon: '📗', color: '#10B981' }, xls: { icon: '📗', color: '#10B981' },
  pptx: { icon: '📙', color: '#F59E0B' }, ppt: { icon: '📙', color: '#F59E0B' },
  docx: { icon: '📘', color: '#3B82F6' }, doc: { icon: '📘', color: '#3B82F6' },
  txt: { icon: '📄', color: '' }, csv: { icon: '📄', color: '' }, md: { icon: '📄', color: '' },
  json: { icon: '📄', color: '' }, xml: { icon: '📄', color: '' }, log: { icon: '📄', color: '' },
  png: { icon: '🖼️', color: '#8B5CF6' }, jpg: { icon: '🖼️', color: '#8B5CF6' },
  jpeg: { icon: '🖼️', color: '#8B5CF6' }, gif: { icon: '🖼️', color: '#8B5CF6' },
  svg: { icon: '🖼️', color: '#8B5CF6' }, bmp: { icon: '🖼️', color: '#8B5CF6' }
};
function getDocIcon(ext) { return DOC_ICONS[ext] || { icon: '📎', color: '' }; }

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / 1048576).toFixed(1) + 'MB';
}

/* ═══ 토스트 알림 ═══ */
function showToast(msg, type) {
  var existing = document.querySelectorAll('.wa-toast');
  existing.forEach(function (t, i) { t.style.bottom = (12 + (i + 1) * 44) + 'px'; });
  var toast = document.createElement('div');
  toast.className = 'wa-toast';
  var bg = type === 'error' ? '#EF4444' : type === 'warn' ? '#F59E0B' : '#10B981';
  toast.style.cssText = 'position:fixed;bottom:12px;left:50%;transform:translateX(-50%);padding:8px 20px;border-radius:8px;font-size:12px;font-weight:600;color:#fff;background:' + bg + ';z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,.2);opacity:0;transition:opacity .3s;white-space:nowrap';
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(function () { toast.style.opacity = '1'; });
  setTimeout(function () { toast.style.opacity = '0'; setTimeout(function () { toast.remove(); }, TOAST_FADE); }, TOAST_DURATION);
}

/* ═══ 서버 모드 API 래퍼 (Phase 2) ═══
 * AUTH_SKIP === false 일 때, IndexedDB CRUD를 REST API 호출로 교체
 * 함수 시그니처를 동일하게 유지하여 UI 코드 변경 최소화
 */
(function () {
  if (typeof AUTH_SKIP === 'undefined' || AUTH_SKIP) return;
  if (typeof apiFetch !== 'function') return;

  // camelCase ↔ snake_case 변환 헬퍼
  function toCamel(row) {
    if (!row) return row;
    var out = {};
    for (var k in row) {
      var ck = k.replace(/_([a-z])/g, function (m, c) { return c.toUpperCase(); });
      var v = row[k];
      // JSONB 문자열 → 파싱
      if (typeof v === 'string' && (k === 'assignees' || k === 'dependencies' || k === 'project_ids' || k === 'tags' || k === 'items' || k === 'phases' || k === 'data' || k === 'date_range' || k === 'selected_names' || k === 'summary_history' || k === 'version_history')) {
        try { v = JSON.parse(v); } catch (e) { /* keep string */ }
      }
      // NUMERIC 컬럼 → 숫자 변환 (node-postgres가 문자열로 반환)
      if (typeof v === 'string' && (k === 'hours' || k === 'estimated_hours' || k === 'actual_hours' || k === 'total_hours' || k === 'progress' || k === 'weight')) {
        v = parseFloat(v) || 0;
      }
      out[ck] = v;
    }
    return out;
  }
  function toCamelArray(rows) { return (rows || []).map(toCamel); }

  // ─── 프로젝트 ───
  projGetAll = function () { return apiFetch('/api/projects').then(function (r) { return toCamelArray(r.data); }); };
  projGet = function (id) { return apiFetch('/api/projects/' + id).then(function (r) { return toCamel(r.data); }); };
  projPut = function (proj) {
    if (!proj.id || proj._isNew) {
      delete proj._isNew;
      return apiFetch('/api/projects', { method: 'POST', body: JSON.stringify(proj) }).then(function (r) { return toCamel(r.data); });
    }
    return apiFetch('/api/projects/' + proj.id, { method: 'PUT', body: JSON.stringify(proj) })
      .then(function (r) { return toCamel(r.data); })
      .catch(function (err) {
        if (err && (err.status === 404 || (err.data && err.data.error === 'NOT_FOUND'))) {
          return apiFetch('/api/projects', { method: 'POST', body: JSON.stringify(proj) }).then(function (r) { return toCamel(r.data); });
        }
        throw err;
      });
  };
  projDel = function (id) { return apiFetch('/api/projects/' + id, { method: 'DELETE' }); };

  // ─── 마일스톤 ───
  msGetAll = function () { return apiFetch('/api/milestones').then(function (r) { return toCamelArray(r.data); }); };
  msGetByProject = function (pid) { return apiFetch('/api/milestones?projectId=' + pid).then(function (r) { return toCamelArray(r.data); }); };
  msPut = function (ms) {
    if (!ms.id || ms._isNew) {
      delete ms._isNew;
      return apiFetch('/api/milestones', { method: 'POST', body: JSON.stringify(ms) }).then(function (r) { return toCamel(r.data); });
    }
    return apiFetch('/api/milestones/' + ms.id, { method: 'PUT', body: JSON.stringify(ms) })
      .then(function (r) { return toCamel(r.data); })
      .catch(function (err) {
        if (err && (err.status === 404 || (err.data && err.data.error === 'NOT_FOUND'))) {
          return apiFetch('/api/milestones', { method: 'POST', body: JSON.stringify(ms) }).then(function (r) { return toCamel(r.data); });
        }
        throw err;
      });
  };
  msDel = function (id) { return apiFetch('/api/milestones/' + id, { method: 'DELETE' }); };

  // ─── 이벤트 ───
  evtGetAll = function () { return apiFetch('/api/events').then(function (r) { return toCamelArray(r.data); }); };
  evtGet = function (id) { return apiFetch('/api/events/' + id).then(function (r) { return toCamel(r.data); }); };
  evtPut = function (evt) {
    if (!evt.id) return apiFetch('/api/events', { method: 'POST', body: JSON.stringify(evt) }).then(function (r) { return toCamel(r.data); });
    return apiFetch('/api/events/' + evt.id, { method: 'PUT', body: JSON.stringify(evt) })
      .then(function (r) { return toCamel(r.data); })
      .catch(function (err) {
        if (err && (err.status === 404 || (err.data && err.data.error === 'NOT_FOUND'))) {
          return apiFetch('/api/events', { method: 'POST', body: JSON.stringify(evt) }).then(function (r) { return toCamel(r.data); });
        }
        throw err;
      });
  };
  evtDel = function (id) { return apiFetch('/api/events/' + id, { method: 'DELETE' }); };

  // ─── 수주 ───
  orderGetAll = function () { return apiFetch('/api/orders').then(function (r) { return toCamelArray(r.data); }); };
  orderGet = function (orderNo) { return apiFetch('/api/orders/' + encodeURIComponent(orderNo)).then(function (r) { return toCamel(r.data); }); };
  orderPut = function (order) {
    var key = order.orderNo || order.order_no;
    return apiFetch('/api/orders', { method: 'POST', body: JSON.stringify(order) }).then(function (r) { return toCamel(r.data); });
  };
  orderDel = function (orderNo) { return apiFetch('/api/orders/' + encodeURIComponent(orderNo), { method: 'DELETE' }); };

  // ─── 이슈 ───
  issueGetAll = function () { return apiFetch('/api/issues').then(function (r) { return toCamelArray(r.data); }); };
  issueGet = function (id) { return apiFetch('/api/issues/' + id).then(function (r) { return toCamel(r.data); }); };
  issuePut = function (issue) {
    if (!issue.id) return apiFetch('/api/issues', { method: 'POST', body: JSON.stringify(issue) }).then(function (r) { return toCamel(r.data); });
    return apiFetch('/api/issues/' + issue.id, { method: 'PUT', body: JSON.stringify(issue) })
      .then(function (r) { return toCamel(r.data); })
      .catch(function (err) {
        if (err && (err.status === 404 || (err.data && err.data.error === 'NOT_FOUND'))) {
          return apiFetch('/api/issues', { method: 'POST', body: JSON.stringify(issue) }).then(function (r) { return toCamel(r.data); });
        }
        throw err;
      });
  };
  issueDel = function (id) { return apiFetch('/api/issues/' + id, { method: 'DELETE' }); };
  issueGetByProject = function (pid) { return apiFetch('/api/issues?projectId=' + pid).then(function (r) { return toCamelArray(r.data); }); };
  issueGetByOrder = function (orderNo) { return apiFetch('/api/issues?orderNo=' + encodeURIComponent(orderNo)).then(function (r) { return toCamelArray(r.data); }); };

  // ─── 이슈 로그 ───
  issueLogGetByIssue = function (issueId) { return apiFetch('/api/issues/' + issueId + '/logs').then(function (r) { return toCamelArray(r.data); }); };
  issueLogPut = function (log) {
    return apiFetch('/api/issues/' + log.issueId + '/logs', { method: 'POST', body: JSON.stringify(log) }).then(function (r) { return toCamel(r.data); });
  };
  issueLogDel = function (id) {
    // issueId가 필요하지만, 삭제 시에는 로그 ID만으로도 가능하도록 서버에서 처리
    return apiFetch('/api/issues/_/logs/' + id, { method: 'DELETE' });
  };

  // ─── 체크리스트 ───
  chkGetByProject = function (pid) { return apiFetch('/api/checklists?projectId=' + pid).then(function (r) { return toCamelArray(r.data); }); };
  chkPut = function (item) {
    if (!item.id) return apiFetch('/api/checklists', { method: 'POST', body: JSON.stringify(item) }).then(function (r) { return toCamel(r.data); });
    return apiFetch('/api/checklists/' + item.id, { method: 'PUT', body: JSON.stringify(item) })
      .then(function (r) { return toCamel(r.data); })
      .catch(function (err) {
        if (err && (err.status === 404 || (err.data && err.data.error === 'NOT_FOUND'))) {
          return apiFetch('/api/checklists', { method: 'POST', body: JSON.stringify(item) }).then(function (r) { return toCamel(r.data); });
        }
        throw err;
      });
  };
  chkDel = function (id) { return apiFetch('/api/checklists/' + id, { method: 'DELETE' }); };

  // 서버 모드: createDefaultChecklists 오버라이드 (phase별 items 배열로 묶어서 저장)
  createDefaultChecklists = function (projectId) {
    var promises = [];
    Object.keys(DEFAULT_CHECKLIST).forEach(function (phase) {
      var items = DEFAULT_CHECKLIST[phase].map(function (text, idx) {
        return { text: text, done: false, doneDate: null, doneBy: null, order: idx };
      });
      promises.push(apiFetch('/api/checklists', { method: 'POST', body: JSON.stringify({
        id: 'chk-' + uuid(), projectId: projectId, phase: phase, items: items
      }) }).then(function (r) { return toCamel(r.data); }));
    });
    return Promise.all(promises);
  };

  // 서버 모드: createCheckItem 오버라이드 (개별 항목도 items 배열로 래핑)
  createCheckItem = function (data) {
    var items = [{ text: data.text || '', done: false, doneDate: null, doneBy: null, order: data.order || 0 }];
    return apiFetch('/api/checklists', { method: 'POST', body: JSON.stringify({
      id: 'chk-' + uuid(), projectId: data.projectId, phase: data.phase, items: items
    }) }).then(function (r) { return toCamel(r.data); });
  };

  // 서버 모드: createProjectFromOrder 오버라이드 (1회 API 호출로 프로젝트+마일스톤+체크리스트 일괄 생성)
  createProjectFromOrder = function (order) {
    var projId = 'proj-' + uuid();
    var now = new Date().toISOString();
    var startDate = order.date || localDate();
    var endDate = order.delivery || '';
    var defaultPhases = { order: { status: 'done', startDate: startDate, endDate: startDate }, design: { status: 'waiting', startDate: '', endDate: '' }, manufacture: { status: 'waiting', startDate: '', endDate: '' }, inspect: { status: 'waiting', startDate: '', endDate: '' }, deliver: { status: 'waiting', startDate: '', endDate: '' }, as: { status: 'waiting', startDate: '', endDate: '' } };
    var phaseKeys = ['order', 'design', 'manufacture', 'inspect', 'deliver', 'as'];
    var phaseLabels = typeof PROJ_PHASE !== 'undefined' ? PROJ_PHASE : {};
    var milestones = phaseKeys.map(function (pk, idx) {
      var label = phaseLabels[pk] ? phaseLabels[pk].label : pk;
      return { id: 'ms-' + uuid(), name: label, startDate: '', endDate: '', status: 'waiting', order: idx };
    });
    var checklists = phaseKeys.map(function (pk) {
      var items = (DEFAULT_CHECKLIST[pk] || []).map(function (text, idx) {
        return { text: text, done: false, doneDate: null, doneBy: null, order: idx };
      });
      return { id: 'chk-' + uuid(), phase: pk, items: items };
    });
    var payload = {
      id: projId, orderNo: order.orderNo, name: order.name || order.orderNo,
      startDate: startDate, endDate: endDate, status: 'active', progress: 0,
      estimatedHours: 0, assignees: order.manager ? [order.manager] : [],
      dependencies: [], color: typeof COL !== 'undefined' ? COL[Math.floor(Math.random() * COL.length)] : '#3B82F6',
      memo: '', currentPhase: 'design', phases: defaultPhases,
      milestones: milestones, checklists: checklists
    };
    return apiFetch('/api/projects/full', { method: 'POST', body: JSON.stringify(payload) })
      .then(function (r) { return toCamel(r.data); });
  };

  // ─── 진척률 히스토리 ───
  getProgressHistory = function (pid) { return apiFetch('/api/progress?projectId=' + pid).then(function (r) { return toCamelArray(r.data); }); };
  saveProgressSnapshot = function (pid, progress, actualHours) {
    return apiFetch('/api/progress', { method: 'POST', body: JSON.stringify({ projectId: pid, date: localDate(), progress: progress, actualHours: actualHours }) });
  };

  // ─── 업무일지 아카이브 (weeks) ───
  wkGetAll = function () { return apiFetch('/api/archives').then(function (r) { return toCamelArray(r.data); }); };
  wkGet = function (id) { return apiFetch('/api/archives/' + encodeURIComponent(id)).then(function (r) { return toCamel(r.data); }); };
  wkPut = function (data) { return apiFetch('/api/archives', { method: 'POST', body: JSON.stringify(data) }).then(function (r) { return toCamel(r.data); }); };
  wkDel = function (id) { return apiFetch('/api/archives/' + encodeURIComponent(id), { method: 'DELETE' }); };

  // ─── 업무일지 레코드 ───
  wrGetAll = function () { return apiFetch('/api/archives/records').then(function (r) { return toCamelArray(r.data); }); };
  wrCount = function () { return apiFetch('/api/archives/records/count').then(function (r) { return r.data.count; }); };
  wrBulkPut = function (records) { return apiFetch('/api/archives/records/bulk', { method: 'POST', body: JSON.stringify({ records: records }) }); };
  wrClear = function () { return apiFetch('/api/archives/records', { method: 'DELETE' }); };

  // ─── 문서 폴더 ───
  folderGetAll = function () { return apiFetch('/api/docs/folders').then(function (r) { return toCamelArray(r.data); }); };
  folderGet = function (id) { return apiFetch('/api/docs/folders').then(function (r) { var all = toCamelArray(r.data); return all.find(function (f) { return f.id === id; }) || null; }); };
  folderGetByProject = function (pid) { return apiFetch('/api/docs/folders?projectId=' + pid).then(function (r) { return toCamelArray(r.data); }); };
  folderPut = function (f) {
    if (!f.id) return apiFetch('/api/docs/folders', { method: 'POST', body: JSON.stringify(f) }).then(function (r) { return toCamel(r.data); });
    return apiFetch('/api/docs/folders/' + f.id, { method: 'PUT', body: JSON.stringify(f) }).then(function (r) { return toCamel(r.data); });
  };
  folderDel = function (id) { return apiFetch('/api/docs/folders/' + id, { method: 'DELETE' }); };

  // ─── 문서 파일 ───
  fileGetAll = function () { return apiFetch('/api/docs/files').then(function (r) { return toCamelArray(r.data); }); };
  fileGet = function (id) { return apiFetch('/api/docs/files').then(function (r) { var all = toCamelArray(r.data); return all.find(function (f) { return f.id === id; }) || null; }); };
  fileGetByProject = function (pid) { return apiFetch('/api/docs/files?projectId=' + pid).then(function (r) { return toCamelArray(r.data); }); };
  fileGetByFolder = function (fid) { return apiFetch('/api/docs/files?folderId=' + fid).then(function (r) { return toCamelArray(r.data); }); };
  filePut = function (f) {
    if (!f.id) return apiFetch('/api/docs/files', { method: 'POST', body: JSON.stringify(f) }).then(function (r) { return toCamel(r.data); });
    return apiFetch('/api/docs/files/' + f.id, { method: 'PUT', body: JSON.stringify(f) }).then(function (r) { return toCamel(r.data); });
  };
  fileDel = function (id) { return apiFetch('/api/docs/files/' + id, { method: 'DELETE' }); };

  // ─── syncOrderMapToDB 서버 모드 오버라이드 ───
  syncOrderMapToDB = function () {
    if (typeof ORDER_MAP === 'undefined') return Promise.resolve();
    var keys = Object.keys(ORDER_MAP);
    if (keys.length === 0) return Promise.resolve();
    var records = keys.map(function (k) {
      var v = ORDER_MAP[k];
      return {
        orderNo: k,
        date: (typeof v === 'object' ? v.date : '') || '',
        client: (typeof v === 'object' ? v.client : '') || '',
        name: (typeof v === 'object' ? v.name : v) || '',
        amount: (typeof v === 'object' ? Number(v.amount) || 0 : 0),
        manager: (typeof v === 'object' ? v.manager : '') || '',
        delivery: (typeof v === 'object' ? v.delivery : '') || ''
      };
    });
    return apiFetch('/api/orders/bulk', { method: 'POST', body: JSON.stringify({ records: records }) });
  };

  console.log('[API] 서버 모드 — IndexedDB CRUD → REST API 전환 완료');
})();
