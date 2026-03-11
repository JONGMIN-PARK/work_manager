/**
 * 업무일지 분석기 — 프로젝트/마일스톤/일정 데이터 관리
 * IndexedDB 'WorkAnalyzerDB' v3 (projects, milestones, events, progressHistory 스토어)
 */

/* ═══ DB 업그레이드 (v1→v2→v3) ═══ */
function upgradeProjectDB(db) {
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
}

/* ═══ DB v3 열기 (기존 openDBv2 대체) ═══ */
function openDBv2() {
  return new Promise(function (res, rej) {
    var req = indexedDB.open('WorkAnalyzerDB', 3);
    req.onupgradeneeded = function (e) {
      var d = e.target.result;
      // v1 스토어
      if (!d.objectStoreNames.contains('weeks')) d.createObjectStore('weeks', { keyPath: 'id' });
      // v2+ 스토어
      upgradeProjectDB(d);
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

/* ═══ 프로젝트 CRUD ═══ */
function projPut(proj) {
  return new Promise(function (res, rej) {
    var tx = db.transaction('projects', 'readwrite');
    tx.objectStore('projects').put(proj);
    tx.oncomplete = function () { res(proj); };
    tx.onerror = function (e) { rej(e); };
  });
}

function projGetAll() {
  return new Promise(function (res, rej) {
    var tx = db.transaction('projects', 'readonly');
    var req = tx.objectStore('projects').getAll();
    req.onsuccess = function () { res(req.result || []); };
    req.onerror = function (e) { rej(e); };
  });
}

function projGet(id) {
  return new Promise(function (res, rej) {
    var tx = db.transaction('projects', 'readonly');
    var req = tx.objectStore('projects').get(id);
    req.onsuccess = function () { res(req.result); };
    req.onerror = function (e) { rej(e); };
  });
}

function projDel(id) {
  return new Promise(function (res, rej) {
    var tx = db.transaction('projects', 'readwrite');
    tx.objectStore('projects').delete(id);
    tx.oncomplete = function () { res(); };
    tx.onerror = function (e) { rej(e); };
  });
}

function createProject(data) {
  var now = new Date().toISOString();
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
    dependencies: data.dependencies || [], // 선행 프로젝트 ID 배열
    color: data.color || COL[(Math.random() * COL.length | 0)],
    memo: data.memo || '',
    createdAt: now,
    updatedAt: now
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

/* ═══ 마일스톤 CRUD ═══ */
function msPut(ms) {
  return new Promise(function (res, rej) {
    var tx = db.transaction('milestones', 'readwrite');
    tx.objectStore('milestones').put(ms);
    tx.oncomplete = function () { res(ms); };
    tx.onerror = function (e) { rej(e); };
  });
}

function msGetAll() {
  return new Promise(function (res, rej) {
    var tx = db.transaction('milestones', 'readonly');
    var req = tx.objectStore('milestones').getAll();
    req.onsuccess = function () { res(req.result || []); };
    req.onerror = function (e) { rej(e); };
  });
}

function msGetByProject(projectId) {
  return msGetAll().then(function (all) {
    return all.filter(function (m) { return m.projectId === projectId; });
  });
}

function msDel(id) {
  return new Promise(function (res, rej) {
    var tx = db.transaction('milestones', 'readwrite');
    tx.objectStore('milestones').delete(id);
    tx.oncomplete = function () { res(); };
    tx.onerror = function (e) { rej(e); };
  });
}

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
    createdAt: new Date().toISOString()
  };
  return msPut(ms);
}

/* ═══ 일정(이벤트) CRUD ═══ */
function evtPut(evt) {
  return new Promise(function (res, rej) {
    var tx = db.transaction('events', 'readwrite');
    tx.objectStore('events').put(evt);
    tx.oncomplete = function () { res(evt); };
    tx.onerror = function (e) { rej(e); };
  });
}

function evtGetAll() {
  return new Promise(function (res, rej) {
    var tx = db.transaction('events', 'readonly');
    var req = tx.objectStore('events').getAll();
    req.onsuccess = function () { res(req.result || []); };
    req.onerror = function (e) { rej(e); };
  });
}

function evtGet(id) {
  return new Promise(function (res, rej) {
    var tx = db.transaction('events', 'readonly');
    var req = tx.objectStore('events').get(id);
    req.onsuccess = function () { res(req.result); };
    req.onerror = function (e) { rej(e); };
  });
}

function evtDel(id) {
  return new Promise(function (res, rej) {
    var tx = db.transaction('events', 'readwrite');
    tx.objectStore('events').delete(id);
    tx.oncomplete = function () { res(); };
    tx.onerror = function (e) { rej(e); };
  });
}

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
    var limit = 200; // 무한 루프 방지
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
  return msDelByProject(id).then(function () {
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

/* ═══ 아카이브 전체 레코드 읽기 (공용) ═══ */
function readAllArchiveRecords() {
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
      res(records);
    };
    req.onerror = function (e) { rej(e); };
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
        var progress = Math.min(Math.round((actual / p.estimatedHours) * 100), 100);
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
  var id = projectId + '_' + today;
  return new Promise(function (res, rej) {
    // progressHistory 스토어가 없을 수 있음 (DB 업그레이드 전)
    if (!db.objectStoreNames.contains('progressHistory')) { res(); return; }
    var tx = db.transaction('progressHistory', 'readwrite');
    var store = tx.objectStore('progressHistory');
    // 같은 날 같은 프로젝트는 덮어쓰기 (max 1 per day per project)
    var snapshot = {
      id: id,
      projectId: projectId,
      date: today,
      progress: progress,
      actualHours: actualHours || 0,
      timestamp: new Date().toISOString()
    };
    store.put(snapshot);
    tx.oncomplete = function () { res(snapshot); };
    tx.onerror = function (e) { rej(e); };
  });
}

function getProgressHistory(projectId) {
  return new Promise(function (res, rej) {
    if (!db.objectStoreNames.contains('progressHistory')) { res([]); return; }
    var tx = db.transaction('progressHistory', 'readonly');
    var store = tx.objectStore('progressHistory');
    var idx = store.index('projectId');
    var req = idx.getAll(projectId);
    req.onsuccess = function () {
      var results = (req.result || []).sort(function (a, b) {
        return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
      });
      res(results);
    };
    req.onerror = function (e) { rej(e); };
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
  setTimeout(function () { toast.style.opacity = '0'; setTimeout(function () { toast.remove(); }, 300); }, 2500);
}
