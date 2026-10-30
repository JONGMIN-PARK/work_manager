/**
 * 업무 관리자 — 파이프라인 뷰 (칸반 보드)
 * 프로젝트를 라이프사이클 단계별로 칸반 레인에 표시
 */

/* ═══ 파이프라인 렌더링 ═══ */
function renderPipeline() {
  var wrap = document.getElementById('pipelineWrap');
  if (!wrap) return;

  // 체크리스트·이슈는 보조 정보 — 실패해도 보드는 그린다. (마일스톤·수주 목록은 쓰지 않아 요청 제거 — 거래처는 ORDER_MAP)
  var chkAllPromise = typeof pipelineLoadAllChecklists === 'function' ? pipelineLoadAllChecklists() : Promise.resolve({});
  var issAllPromise = typeof issueGetAll === 'function' ? issueGetAll().catch(function () { return []; }) : Promise.resolve([]);
  Promise.all([_pipeProjects(), chkAllPromise, issAllPromise]).then(function (results) {
    var projects = results[0] || [];
    var chkProgress = results[1] || {};
    var allIssues = results[2] || [];

    // 프로젝트별 미해결 이슈 카운트
    var issueCount = {};
    allIssues.forEach(function (iss) {
      if (iss.projectId && iss.status !== 'resolved' && iss.status !== 'closed') {
        issueCount[iss.projectId] = (issueCount[iss.projectId] || 0) + 1;
      }
    });
    var phases = typeof PROJ_PHASE !== 'undefined' ? PROJ_PHASE : {};
    var phaseKeys = Object.keys(phases).sort(function (a, b) { return (phases[a].seq || 0) - (phases[b].seq || 0); });

    // 프로젝트를 단계별로 분류
    var buckets = {};
    phaseKeys.forEach(function (k) { buckets[k] = []; });

    projects.forEach(function (p) {
      var phase = guessPhase(p);
      if (!buckets[phase]) phase = phaseKeys[0];
      buckets[phase].push(p);
    });
    // v13.152 레인 내 카드 순서: sort_order 우선(미지정은 뒤, 기존 등록순 유지)
    phaseKeys.forEach(function (k) { buckets[k].sort(_pipeOrderCmp); });

    var html = '';
    var liveIds = {};

    // 상단 요약 카드
    html += '<div class="pnl" style="margin-bottom:14px;padding:14px 18px">';
    html += '<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">';
    html += '<span style="font-size:13px;font-weight:700;color:var(--t2)">🔀 파이프라인</span>';
    html += '<span style="font-size:11px;color:var(--t5)">전체 ' + projects.length + '건</span>';
    html += '<span style="margin-left:auto;display:flex;gap:6px">';
    html += '<button class="pipe-tool-btn" onclick="pipelineSetAll(true)" title="모든 카드 펼치기">⊞ 전체 펼치기</button>';
    html += '<button class="pipe-tool-btn" onclick="pipelineSetAll(false)" title="모든 카드를 제목만 보이게 접기">⊟ 전체 접기</button>';
    html += '<button class="pipe-tool-btn" onclick="exportProjectReport()">📊 보고서</button>';
    html += '</span>';
    phaseKeys.forEach(function (k) {
      var ph = phases[k];
      var cnt = buckets[k].length;
      html += '<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:' + ph.color + '22;color:' + ph.color + ';font-weight:600">' + ph.icon + ' ' + ph.label + ' ' + cnt + '</span>';
    });
    html += '</div></div>';

    // 칸반 보드
    html += '<div class="pipeline-board" style="display:grid;grid-template-columns:repeat(' + phaseKeys.length + ',minmax(0,1fr));gap:10px;min-height:400px">';

    phaseKeys.forEach(function (k) {
      var ph = phases[k];
      var items = buckets[k];

      html += '<div class="pipeline-lane" data-phase="' + k + '" ondragover="pipelineDragOver(event)" ondrop="pipelineDrop(event,\'' + k + '\')" ondragenter="pipelineDragEnter(event)" ondragleave="pipelineDragLeave(event)" style="background:var(--bg-i);border:1px solid var(--bd);border-radius:10px;padding:12px;display:flex;flex-direction:column;min-width:0;transition:border-color .2s">';
      // 레인 헤더
      html += '<div style="text-align:center;margin-bottom:10px;padding-bottom:10px;border-bottom:2px solid ' + ph.color + '">';
      html += '<div style="font-size:20px;margin-bottom:4px">' + ph.icon + '</div>';
      html += '<div style="font-size:11px;font-weight:700;color:' + ph.color + ';letter-spacing:-.2px">' + ph.label + '</div>';
      html += '<div style="font-size:10px;color:var(--t5);margin-top:3px;font-weight:600">' + items.length + '건'
        + (items.length ? ' <button class="pipe-lane-tgl" onclick="pipelineLaneToggle(\'' + k + '\')" title="이 단계 카드 전체 펼치기/접기">⇕</button>' : '')
        + '</div>';
      html += '</div>';

      // 카드들 — 레인 안 스크롤 없이 세로로 끝까지 (접힌 카드는 제목 한 줄)
      html += '<div style="display:flex;flex-direction:column;gap:6px;flex:1">';
      if (items.length === 0) {
        html += '<div style="text-align:center;color:var(--t6);font-size:10px;padding:20px 0">—</div>';
      }
      items.forEach(function (p) {
        var st = typeof PROJ_STATUS !== 'undefined' && PROJ_STATUS[p.status] ? PROJ_STATUS[p.status] : { label: p.status, color: SEM_COLOR.muted, icon: '' };
        var isDelayed = p.status === 'delayed' || (p.endDate && p.endDate < localDate() && p.status !== 'done');
        var borderColor = isDelayed ? SEM_COLOR.danger : 'var(--bd)';
        var borderStyle = isDelayed ? '2px solid ' + borderColor : '1px solid ' + borderColor;
        var progress = p.progress || 0;

        // 현재 단계 체크리스트 완료율
        var chkInfo = chkProgress[p.id] && chkProgress[p.id][k] ? chkProgress[p.id][k] : null;
        var chkTotal = chkInfo ? chkInfo.total : 0;
        var chkDone = chkInfo ? chkInfo.done : 0;
        var chkPct = chkTotal > 0 ? Math.round(chkDone / chkTotal * 100) : -1;

        var isOpen = !!_pipeOpen[p.id];
        liveIds[p.id] = 1;
        // 편집 권한 없는 카드는 끌 수 없게 — 예전엔 끌어 놓으면 서버 403 이 조용히 묻혔다 (v13.213 can_edit)
        var canDrag = typeof projCanEdit !== 'function' || projCanEdit(p);
        var pidA = eA(p.id);
        html += '<div class="pipeline-card' + (isOpen ? ' open' : '') + '" draggable="' + (canDrag ? 'true' : 'false') + '" data-pid="' + eH(p.id) + '" data-phase="' + k + '"' + (canDrag ? ' ondragstart="pipelineDragStart(event,\'' + pidA + '\')" ondragend="pipelineDragEnd(event)"' : '') + ' ondragover="pipelineCardDragOver(event)" ondragleave="pipelineCardDragLeave(event)" ondrop="pipelineCardDrop(event,\'' + pidA + '\',\'' + k + '\')" style="background:var(--bg-p);border:' + borderStyle + ';border-radius:8px;padding:10px 12px;cursor:' + (canDrag ? 'grab' : 'pointer') + ';transition:transform .15s,box-shadow .15s" onmouseenter="this.style.transform=\'translateY(-1px)\';this.style.boxShadow=\'0 3px 8px rgba(0,0,0,.1)\'" onmouseleave="this.style.transform=\'\';this.style.boxShadow=\'\'" onclick="pipelineCardToggle(event,\'' + pidA + '\')" ondblclick="pipelineCardClick(\'' + pidA + '\')" title="' + eH(p.name) + ' — 클릭: 펼치기/접기 · 더블클릭: 상세' + (canDrag ? ' · 드래그: 단계 이동(레인) / 같은 단계 카드 위로: 순서 변경' : ' · 보기 전용(편집 권한 없음)') + '">';

        // 프로젝트명 (접힌 상태에서는 이 줄만 보임)
        html += '<div class="pipe-title"><span class="pipe-caret">▸</span><span class="pipe-name">' + eH(p.name) + '</span></div>';
        html += '<div class="pipe-det">';

        // 수주번호 + 거래처
        if (p.orderNo) {
          var client = '';
          if (typeof ORDER_MAP !== 'undefined' && ORDER_MAP[p.orderNo]) {
            var oi = ORDER_MAP[p.orderNo];
            client = typeof oi === 'object' ? (oi.client || '') : '';
          }
          html += '<div style="font-size:9px;color:var(--t5);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + eH(p.orderNo) + (client ? ' · ' + eH(client) : '') + '</div>';
        }

        // 상태 + 진척률
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">';
        html += '<span style="font-size:9px;padding:1px 6px;border-radius:8px;background:' + st.color + '22;color:' + st.color + '">' + st.icon + ' ' + st.label + '</span>';
        html += '<span style="font-size:9px;color:var(--t5);font-weight:600">' + progress + '%</span>';
        html += '</div>';

        // 진척률 바
        html += '<div style="margin-top:4px;height:3px;background:var(--bd);border-radius:2px;overflow:hidden">';
        html += '<div style="height:100%;width:' + progress + '%;background:' + eC(p.color, SEM_COLOR.info) + ';border-radius:2px"></div>';
        html += '</div>';

        // 체크리스트 완료율
        if (chkPct >= 0) {
          var chkColor = chkPct === 100 ? SEM_COLOR.ok : chkPct >= 50 ? SEM_COLOR.warn : SEM_COLOR.muted;
          html += '<div style="display:flex;align-items:center;gap:4px;margin-top:4px">';
          html += '<span style="font-size:9px;color:' + chkColor + '">☑ ' + chkDone + '/' + chkTotal + '</span>';
          html += '<div style="flex:1;height:2px;background:var(--bd);border-radius:1px;overflow:hidden"><div style="height:100%;width:' + chkPct + '%;background:' + chkColor + '"></div></div>';
          html += '<span style="font-size:9px;color:' + chkColor + ';font-weight:600">' + chkPct + '%</span>';
          html += '</div>';
        }

        // 이슈 배지
        var pIssueN = issueCount[p.id] || 0;
        if (pIssueN > 0) {
          html += '<div style="font-size:9px;color:#EF4444;margin-top:4px;font-weight:600">🎫 미해결 이슈 ' + pIssueN + '건</div>';
        }

        // 담당자
        if (p.assignees && p.assignees.length) {
          html += '<div style="font-size:9px;color:var(--t5);margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">👤 ' + p.assignees.map(function (a) { return eH(typeof displayName === 'function' ? displayName(a) : a); }).join(', ') + '</div>';
        }

        // 지연 경고
        if (isDelayed && p.endDate) {
          var overDays = daysDiff(p.endDate, localDate());
          html += '<div style="font-size:9px;color:#EF4444;font-weight:600;margin-top:3px">⚠️ ' + overDays + '일 초과</div>';
        }

        html += '<button class="pipe-open-btn" onclick="event.stopPropagation();pipelineCardClick(\'' + pidA + '\')">🔍 상세 보기</button>';
        html += '</div>'; // pipe-det end
        html += '</div>'; // card end
      });
      html += '</div>'; // cards container end
      html += '</div>'; // lane end
    });

    html += '</div>'; // grid end

    wrap.innerHTML = html;
    // 삭제된 프로젝트의 펼침 기록 정리
    Object.keys(_pipeOpen).forEach(function (id) { if (!liveIds[id]) delete _pipeOpen[id]; });
    _pipeSaveOpen();
  }).catch(function (err) {
    // 예전엔 catch 가 없어 프로젝트 목록을 못 받으면 보드가 빈 채(또는 옛 화면)로 남았다
    console.error('[renderPipeline]', err);
    wrap.innerHTML = '<div class="pnl" style="padding:24px;text-align:center;color:var(--t5)">파이프라인을 불러오지 못했습니다: ' + eH((err && err.message) || '알 수 없는 오류') +
      '<br><button class="btn btn-g btn-s" style="margin-top:8px" onclick="renderPipeline()">다시 시도</button></div>';
  });
}

/* 화면에 쓰는 프로젝트 목록 — 그리기·순서 변경이 같은 소스(운영자는 전체, 숨김 제외)를 쓰게 */
function _pipeProjects() {
  return (typeof pmGetProjects === 'function') ? pmGetProjects() : projGetAll();
}

/* 프로젝트의 현재 단계 추정 (currentPhase 없을 때 폴백) */
function guessPhase(proj) {
  if (proj.currentPhase) return proj.currentPhase;
  var s = proj.status;
  if (s === 'done') return 'done';
  if (s === 'waiting') return 'order';
  // 진행중/지연/보류 → 중간 단계로 추정
  return 'manufacture';
}

/* ═══ 카드 펼치기/접기 — 기본은 제목만, 펼친 카드 id 는 localStorage 에 기억 ═══ */
var _pipeOpen = (function () {
  try { return JSON.parse(localStorage.getItem('pipe-open') || '{}') || {}; } catch (e) { return {}; }
})();
function _pipeSaveOpen() { try { localStorage.setItem('pipe-open', JSON.stringify(_pipeOpen)); } catch (e) {} }
function _pipeSetCard(card, on) {
  card.classList.toggle('open', on);
  if (on) _pipeOpen[card.dataset.pid] = 1; else delete _pipeOpen[card.dataset.pid];
}
/* 카드 클릭 → 펼치기/접기 (DOM 만 토글, 재렌더 없음) */
function pipelineCardToggle(e, projId) {
  var card = e && e.currentTarget;
  if (!card || (e.target && e.target.closest && e.target.closest('button,a,input'))) return;
  _pipeSetCard(card, !card.classList.contains('open'));
  _pipeSaveOpen();
}
/* 전체(또는 한 단계) 펼치기/접기 */
function pipelineSetAll(on, phase) {
  var cards = document.querySelectorAll('#pipelineWrap .pipeline-card' + (phase ? '[data-phase="' + phase + '"]' : ''));
  for (var i = 0; i < cards.length; i++) _pipeSetCard(cards[i], on);
  _pipeSaveOpen();
}
/* 레인 헤더 ⇕ — 하나라도 접혀 있으면 모두 펼치고, 다 펼쳐져 있으면 모두 접기 */
function pipelineLaneToggle(phase) {
  var closed = document.querySelectorAll('#pipelineWrap .pipeline-card[data-phase="' + phase + '"]:not(.open)').length;
  pipelineSetAll(closed > 0, phase);
}

/* 파이프라인 카드 더블클릭·[상세 보기] → 프로젝트 상세 패널 (다른 화면과 같게 — 예전엔 편집창이 열렸다).
   편집은 상세 패널의 [✏️ 편집] 에서 */
function pipelineCardClick(projId) {
  if (typeof showProjectDetail === 'function') showProjectDetail(projId);
  else if (typeof showProjectModal === 'function') showProjectModal(projId);
}

/* ═══ 파이프라인 드래그 앤 드롭 ═══ */
var pipelineDragId = '';

function pipelineDragStart(e, projId) {
  pipelineDragId = projId;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', projId);
  e.target.style.opacity = '0.5';
}

function pipelineDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

/* v13.152 레인 내 프로젝트 순서 변경 (카드 위로 드롭) */
function _pipeOrderCmp(a, b) {
  var sa = a.sortOrder, sb = b.sortOrder;
  var na = (sa == null), nb = (sb == null);
  if (na && nb) return 0;
  if (na) return 1;       // 미지정은 뒤로
  if (nb) return -1;
  return sa - sb;
}
function pipelineDragEnd(e) { if (e && e.target) e.target.style.opacity = ''; var c = document.querySelectorAll('.pipeline-card.pipe-drop-before,.pipeline-card.pipe-drop-after'); for (var i = 0; i < c.length; i++) c[i].classList.remove('pipe-drop-before', 'pipe-drop-after'); }
function pipelineCardDragOver(e) {
  e.preventDefault(); e.stopPropagation();
  e.dataTransfer.dropEffect = 'move';
  var card = e.currentTarget; if (!card) return;
  var rect = card.getBoundingClientRect();
  var after = e.clientY > rect.top + rect.height / 2;
  card.classList.toggle('pipe-drop-after', after);
  card.classList.toggle('pipe-drop-before', !after);
}
function pipelineCardDragLeave(e) { var card = e.currentTarget; if (card) card.classList.remove('pipe-drop-before', 'pipe-drop-after'); }
function pipelineCardDrop(e, targetId, targetPhase) {
  e.preventDefault(); e.stopPropagation();
  var card = e.currentTarget; if (card) card.classList.remove('pipe-drop-before', 'pipe-drop-after');
  var dragId = pipelineDragId || e.dataTransfer.getData('text/plain');
  if (!dragId || dragId === targetId) { pipelineDragId = ''; return; }
  pipelineDragId = '';
  var rect = card ? card.getBoundingClientRect() : null;
  var after = rect ? (e.clientY > rect.top + rect.height / 2) : false;
  pipelineReorder(dragId, targetId, targetPhase, after);
}
function pipelineReorder(dragId, targetId, targetPhase, after) {
  // 그리기와 같은 목록(_pipeProjects) — 예전엔 projGetAll 이라 운영자가 보는 카드 일부는 찾지 못해 조용히 무시됐다
  _pipeProjects().then(function (list) {
    var dragProj = null;
    list.forEach(function (p) { if (p.id === dragId) dragProj = p; });
    if (!dragProj) return;
    var dragPhase = guessPhase(dragProj);
    // 다른 단계 카드 위로 드롭 → 레인에 놓은 것과 같게(체크리스트 확인 · 오류 표시 포함)
    if (dragPhase !== targetPhase) { _pipeMovePhase(dragId, targetPhase); return; }
    // v13.155 같은 단계 내 순서 변경 → 전역 순서(sort_order) 통일.
    //  list 는 이미 전역 정렬 순서(서버 sort_order 우선)로 옴 → 드래그 항목을 타겟 위치로 옮기고 전체 재번호.
    var arr = list.slice();
    var dragIdx = -1;
    for (var di = 0; di < arr.length; di++) { if (arr[di].id === dragId) { dragIdx = di; break; } }
    if (dragIdx >= 0) arr.splice(dragIdx, 1);
    var ti = -1;
    for (var i = 0; i < arr.length; i++) { if (arr[i].id === targetId) { ti = i; break; } }
    var insertIdx = (ti < 0) ? arr.length : (after ? ti + 1 : ti);
    arr.splice(insertIdx, 0, dragProj);
    var items = arr.map(function (p, idx) { return { id: p.id, sortOrder: idx }; });
    if (typeof projReorder !== 'function') { if (typeof showToast === 'function') showToast('순서 변경 기능을 사용할 수 없습니다.', 'error'); return; }
    projReorder(items).then(function () {
      if (typeof showToast === 'function') showToast('순서가 변경되었습니다 (타임라인·목록 공통).');
      renderPipeline();
    }).catch(function (err) {
      if (typeof showToast === 'function') showToast('순서 변경 실패' + ((err && err.status === 404) ? ' — 서버 배포 후 사용 가능' : ''), 'error');
    });
  }).catch(_pipeErr);
}

function pipelineDragEnter(e) {
  e.preventDefault();
  var lane = e.currentTarget;
  if (lane) lane.style.borderColor = 'var(--accent, #6366F1)';
}

function pipelineDragLeave(e) {
  var lane = e.currentTarget;
  if (lane) lane.style.borderColor = 'var(--bd)';
}

function pipelineDrop(e, targetPhase) {
  e.preventDefault();
  var lane = e.currentTarget;
  if (lane) lane.style.borderColor = 'var(--bd)';
  var projId = pipelineDragId || e.dataTransfer.getData('text/plain');
  if (!projId) return;
  pipelineDragId = '';
  _pipeMovePhase(projId, targetPhase);
}

/* 단계 이동 공통 — 레인에 놓기 · 다른 단계 카드 위에 놓기 모두.
   현재 단계와 같으면 무시 · 편집 권한 확인 · 체크리스트 미완료면 확인 · 실패(403 · 409 등)는 토스트 */
function _pipeMovePhase(projId, targetPhase) {
  var gate = (typeof advancePhase === 'function')
    ? advancePhase(projId, targetPhase)
    : projGet(projId).then(function (proj) { return proj ? { proj: proj, gatePass: true } : null; });
  gate.then(function (result) {
    if (!result) return;
    if (result.proj && guessPhase(result.proj) === targetPhase) return;   // 현재 단계와 같음
    if (result.proj && typeof projCanEdit === 'function' && !projCanEdit(result.proj)) {
      if (typeof showToast === 'function') showToast('편집 권한이 없는 프로젝트입니다.', 'warn');
      return;
    }
    if (result.gatePass === false) {
      if (!confirm('현재 단계 체크리스트가 미완료입니다 (' + (result.progress ? result.progress.pct : 0) + '%). 강제로 ' + getPhaseName(targetPhase) + ' 단계로 이동하시겠습니까?')) return;
    }
    return executePhaseTransition(projId, targetPhase).then(function () {
      if (typeof showToast === 'function') showToast(getPhaseName(targetPhase) + ' 단계로 이동했습니다.');
      renderPipeline();
    });
  }).catch(_pipeErr);
}
function _pipeErr(err) {
  console.error('[pipeline]', err);
  var msg = (err && err.status === 403) ? '편집 권한이 없습니다.'
    : (err && err.status === 409) ? '다른 사용자가 먼저 수정했습니다 — 화면을 다시 불러옵니다.'
    : ((err && err.data && err.data.message) || (err && err.message) || '알 수 없는 오류');
  if (typeof showToast === 'function') showToast('❌ ' + msg, 'error');
  if (err && err.status === 409) renderPipeline();
}

function getPhaseName(phaseKey) {
  var phases = typeof PROJ_PHASE !== 'undefined' ? PROJ_PHASE : {};
  return phases[phaseKey] ? phases[phaseKey].label : phaseKey;
}

/* ═══ 전체 체크리스트 로드 (파이프라인용) ═══ */
// 서버 전용 — 예전 로컬(IndexedDB) 분기는 쓰이지 않아 제거. 실패하면 {} (체크리스트 막대만 빠지고 보드는 그림)
function pipelineLoadAllChecklists() {
  if (typeof apiFetch !== 'function') return Promise.resolve({});
  return apiFetch('/api/checklists?limit=5000&all=true').then(function (r) {
    var rows = r.data || [];
    var map = {};
    rows.forEach(function (row) {
      var pid = row.project_id || row.projectId;
      var phase = row.phase;
      if (!pid || !phase) return;
      if (!map[pid]) map[pid] = {};
      if (!map[pid][phase]) map[pid][phase] = { total: 0, done: 0 };
      var items = row.items;
      if (typeof items === 'string') { try { items = JSON.parse(items); } catch (e) { items = []; } }   // 한 행이 깨져도 전체를 잃지 않게
      (Array.isArray(items) ? items : []).forEach(function (it) {
        map[pid][phase].total++;
        if (it && it.done) map[pid][phase].done++;
      });
    });
    return map;
  }).catch(function () { return {}; });
}

/* ═══ 프로젝트 보고서 엑셀 내보내기 ═══ */
function exportProjectReport() {
  var phases = typeof PROJ_PHASE !== 'undefined' ? PROJ_PHASE : {};
  var depts = typeof DEPT !== 'undefined' ? DEPT : {};
  var phaseKeys = Object.keys(phases).sort(function (a, b) { return (phases[a].seq || 0) - (phases[b].seq || 0); });

  var issPromise = typeof issueGetAll === 'function' ? issueGetAll() : Promise.resolve([]);
  var chkPromise2 = typeof pipelineLoadAllChecklists === 'function' ? pipelineLoadAllChecklists() : Promise.resolve({});

  // 사양서 양식(v13.196) — 프로젝트가 참조하는 (양식, 버전)을 미리 받아 둔다
  var specSchemaPromise = Promise.resolve(projGetAll()).then(function (list) {
    if (typeof specNormalize !== 'function' || typeof psTemplateSchema !== 'function') return {};
    var map = {}, jobs = [];
    (list || []).forEach(function (p) {
      var s = specNormalize(p.specs), k = s.templateId + ':' + s.templateVersion;
      if (!s.templateId || map[k] !== undefined) return;
      map[k] = null;
      jobs.push(psTemplateSchema(s.templateId, s.templateVersion).then(function (sc) { map[k] = sc; }).catch(function () {}));
    });
    return Promise.all(jobs).then(function () { return map; });
  }).catch(function () { return {}; });

  // (수주 목록은 쓰지 않아 요청 제거 — 거래처는 ORDER_MAP)
  Promise.all([projGetAll(), msGetAll(), issPromise, chkPromise2, specSchemaPromise]).then(function (results) {
    var projects = results[0] || [];
    var specSchemas = results[4] || {};
    var milestones = results[1] || [];
    var issues = results[2] || [];
    var chkMap = results[3] || {};

    if (typeof XLSX === 'undefined') { showToast('SheetJS(xlsx) 라이브러리를 불러올 수 없습니다.','error'); return; }

    var wb = XLSX.utils.book_new();

    // Sheet 1: 프로젝트 현황
    var projRows = [['프로젝트명', '수주번호', '거래처', '시작일', '종료일', '상태', '현재단계', '진척률', '담당자']];
    projects.forEach(function (p) {
      var phaseName = p.currentPhase && phases[p.currentPhase] ? phases[p.currentPhase].label : '-';
      var client = '';
      if (typeof ORDER_MAP !== 'undefined' && ORDER_MAP[p.orderNo]) {
        var oi = ORDER_MAP[p.orderNo];
        client = typeof oi === 'object' ? (oi.client || '') : '';
      }
      var stLabel = typeof PROJ_STATUS !== 'undefined' && PROJ_STATUS[p.status] ? PROJ_STATUS[p.status].label : p.status;
      projRows.push([p.name || '', p.orderNo || '', client, p.startDate || '', p.endDate || '', stLabel, phaseName, (p.progress || 0) + '%', (p.assignees || []).join(', ')]);
    });

    // 단계별 체크리스트 완료율 열 추가
    projRows[0] = projRows[0].concat(phaseKeys.map(function (k) { return phases[k].label + ' 체크리스트'; }));
    projects.forEach(function (p, i) {
      var chkCols = phaseKeys.map(function (k) {
        var info = chkMap[p.id] && chkMap[p.id][k] ? chkMap[p.id][k] : null;
        if (!info || info.total === 0) return '-';
        return info.done + '/' + info.total + ' (' + Math.round(info.done / info.total * 100) + '%)';
      });
      projRows[i + 1] = projRows[i + 1].concat(chkCols);
    });

    var ws1 = XLSX.utils.aoa_to_sheet(projRows);
    XLSX.utils.book_append_sheet(wb, ws1, '프로젝트현황');

    // Sheet 2: 이슈 요약
    if (issues.length) {
      var issTypes = typeof ISSUE_TYPE !== 'undefined' ? ISSUE_TYPE : {};
      var issUrgencies = typeof ISSUE_URGENCY !== 'undefined' ? ISSUE_URGENCY : {};
      var issStatuses = typeof ISSUE_STATUS !== 'undefined' ? ISSUE_STATUS : {};
      var projMap = {};
      projects.forEach(function (p) { projMap[p.id] = p; });

      var issRows = [['번호', '등록일', '프로젝트', '단계', '부서', '유형', '긴급도', '상태', '제목', '담당자', '해결일']];
      issues.forEach(function (iss, i) {
        var proj = projMap[iss.projectId];
        issRows.push([
          i + 1, iss.reportDate || '',
          proj ? proj.name : '', phases[iss.phase] ? phases[iss.phase].label : iss.phase,
          depts[iss.dept] ? depts[iss.dept].label : iss.dept,
          issTypes[iss.type] ? issTypes[iss.type].label : iss.type,
          issUrgencies[iss.urgency] ? issUrgencies[iss.urgency].label : iss.urgency,
          issStatuses[iss.status] ? issStatuses[iss.status].label : iss.status,
          iss.title || '', (iss.assignees || []).join(', '), iss.resolvedDate || ''
        ]);
      });
      var ws2 = XLSX.utils.aoa_to_sheet(issRows);
      XLSX.utils.book_append_sheet(wb, ws2, '이슈대장');
    }

    // Sheet 3: 마일스톤
    if (milestones.length) {
      var msRows = [['프로젝트', '마일스톤', '시작일', '종료일', '상태']];
      var projMap2 = {};
      projects.forEach(function (p) { projMap2[p.id] = p; });
      milestones.forEach(function (m) {
        var proj = projMap2[m.projectId];
        var msSt = typeof PROJ_STATUS !== 'undefined' && PROJ_STATUS[m.status] ? PROJ_STATUS[m.status].label : m.status;
        msRows.push([proj ? proj.name : '', m.name || '', m.startDate || '', m.endDate || '', msSt]);
      });
      var ws3 = XLSX.utils.aoa_to_sheet(msRows);
      XLSX.utils.book_append_sheet(wb, ws3, '마일스톤');
    }

    // Sheet 4: 사양서 (v13.160 → v13.196 표준 사양서) — 일반 항목은 한 시트, 표 항목(축 구성·외부장치 등)은 표마다 시트
    if (typeof specNormalize === 'function') {
      var specRows = [['프로젝트', '섹션', '항목', '값', '단위', '비고', '상태']];
      var specTables = {}, specTableOrder = [];
      projects.forEach(function (p) {
        var sh = specNormalize(p.specs);
        var sc = (sh.templateId && specSchemas[sh.templateId + ':' + sh.templateVersion]) || { sections: [] };
        var out = specSheetRows(p.name || '', sc, sh);
        specRows = specRows.concat(out.rows);
        out.tables.forEach(function (t) {
          if (!specTables[t.label]) { specTables[t.label] = t.rows.slice(0, 1); specTableOrder.push(t.label); }
          specTables[t.label] = specTables[t.label].concat(t.rows.slice(1));
        });
      });
      if (specRows.length > 1) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(specRows), '사양서');
      var usedNm = {};
      specTableOrder.forEach(function (lbl) {
        var base = ('사양-' + String(lbl).replace(/[\\/\?\*\[\]:]/g, ' ')).slice(0, 28), nm = base, n = 2;
        while (usedNm[nm]) nm = base + ' ' + (n++);
        usedNm[nm] = true;
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(specTables[lbl]), nm);
      });
    }

    XLSX.writeFile(wb, '프로젝트_보고서_' + localDate() + '.xlsx');
    showToast('프로젝트 보고서를 엑셀로 저장했습니다.');
  }).catch(function (err) {
    console.error('[exportProjectReport]', err);
    showToast('보고서 만들기 실패: ' + ((err && err.message) || '알 수 없는 오류'), 'error');
  });
}

