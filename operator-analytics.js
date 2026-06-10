/**
 * 운영자 — 프로젝트 분석 / 트렌드 모듈 (Phase 2a)
 *
 * 진입점 (전역):
 *   - renderOperatorAnalytics(containerId)        전사 개요 + 위험 리스트 + 상세 셸
 *   - renderProjectAnalytics(projectId, containerId)  단일 프로젝트 상세 분석
 *
 * 데이터: pmGetProjects(포커스 셋), getProgressHistory, calcHoursByMilestone,
 *         msGetAll / msGetByProject, msLogsGet — 전부 기존 전역 재사용 (신규 수집 0).
 *
 * 차트 안전: 모든 캔버스는 고정 높이 position:relative 래퍼로 감싸고,
 *   재렌더 전 이전 Chart 인스턴스를 destroy() 한다 (무한 성장 방지).
 *
 * PRD: docs/PRD_프로젝트_분석_트렌드.md
 */

/* ───────── 모듈 상태 ───────── */
var _oaCharts = [];            // 전사 개요 Chart 인스턴스 (destroy 보관)
var _oaProjCharts = [];        // 프로젝트 상세 Chart 인스턴스 (destroy 보관)
var _oaLoading = false;
var _oaData = null;            // 마지막 집계 결과 (프로젝트별 분석 캐시)
var _oaSelectedProjectId = null;
var _oaDetailContainerId = 'oaDetail';   // renderOperatorAnalytics 가 만드는 상세 영역 id
var _OA_STALE_DAYS = 14;       // 진척 정체 임계 (PRD: 기본 14일)
var _oaFilterName = '';        // 담당자(등록 인원) 필터 — '' 이면 전체

/* ───────── 유틸 ───────── */
function _oaEsc(s) {
  if (typeof eH === 'function') return eH(s == null ? '' : String(s));
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function _oaToday() {
  if (typeof localDate === 'function') return localDate();
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
// end - start (양수면 경과/지연 일수). daysDiff 가 있으면 그것을 사용.
function _oaDaysDiff(start, end) {
  if (typeof daysDiff === 'function') return daysDiff(start, end);
  return Math.round((new Date(end) - new Date(start)) / 86400000);
}
function _oaRnd(n) { return Math.round((Number(n) || 0) * 10) / 10; }
function _oaStatusOf(p) {
  if (typeof autoProjectStatus === 'function') return autoProjectStatus(p);
  return p && p.status ? p.status : 'waiting';
}
function _oaStatusMeta(code) {
  var M = (typeof PROJ_STATUS !== 'undefined') ? PROJ_STATUS : {};
  return M[code] || { label: code || '-', color: '#94A3B8', bg: 'rgba(148,163,184,.15)', icon: '•' };
}
function _oaPhaseMeta(code) {
  var M = (typeof PROJ_PHASE !== 'undefined') ? PROJ_PHASE : {};
  return M[code] || { label: code || '기타', icon: '•', color: '#94A3B8', seq: 99 };
}
function _oaSumTargets(milestones) {
  var sum = 0;
  (milestones || []).forEach(function (m) {
    var at = (m && m.assigneeTargets) || {};
    Object.keys(at).forEach(function (k) { sum += Number(at[k]) || 0; });
  });
  return _oaRnd(sum);
}
function _oaSumReported(milestones) {
  var sum = 0;
  (milestones || []).forEach(function (m) { sum += Number(m && m.reportedHours) || 0; });
  return _oaRnd(sum);
}
// calcHoursByMilestone 결과를 합산 → { workHours(멤버한정 업무일지), people:{이름:h}, outHours, untaggedCount }
function _oaSumCalc(calc) {
  var out = { workHours: 0, people: {}, outHours: 0, untaggedCount: 0 };
  if (!calc) return out;
  Object.keys(calc).forEach(function (mid) {
    if (mid === '_meta') return;
    var b = calc[mid] || {};
    out.workHours += Number(b.hours) || 0;
    out.outHours += Number(b.outHours) || 0;
    var ppl = b.people || {};
    Object.keys(ppl).forEach(function (nm) { out.people[nm] = (out.people[nm] || 0) + (Number(ppl[nm]) || 0); });
  });
  if (calc._meta) out.untaggedCount = calc._meta.untaggedCount || 0;
  out.workHours = _oaRnd(out.workHours);
  out.outHours = _oaRnd(out.outHours);
  return out;
}
// 최근 N일 진척 변화량 (히스토리 시계열 → 마지막값 - (N일전 이전 최근값)). 데이터 부족 시 null.
function _oaRecentProgressDelta(history, days) {
  if (!history || !history.length) return null;
  var sorted = history.slice().sort(function (a, b) { return (a.date || '') < (b.date || '') ? -1 : 1; });
  var last = sorted[sorted.length - 1];
  if (!last || last.date == null) return null;
  var cutoff = new Date(last.date);
  cutoff.setDate(cutoff.getDate() - days);
  var cutoffStr = cutoff.getFullYear() + '-' + String(cutoff.getMonth() + 1).padStart(2, '0') + '-' + String(cutoff.getDate()).padStart(2, '0');
  // cutoff 시점 이전의 가장 최근 진척 (없으면 가장 오래된 값)
  var base = null;
  for (var i = 0; i < sorted.length; i++) {
    if (sorted[i].date <= cutoffStr) base = sorted[i];
    else break;
  }
  if (!base) base = sorted[0];
  // 관측 구간이 days 의 절반도 안 되면 판단 보류 (정체 오탐 방지)
  var span = Math.abs(_oaDaysDiff(sorted[0].date, last.date));
  if (span < Math.max(3, Math.floor(days / 2))) return null;
  return _oaRnd((Number(last.progress) || 0) - (Number(base.progress) || 0));
}

/* ───────── Chart.js 공통 ───────── */
function _oaDestroy(arr) {
  (arr || []).forEach(function (c) { try { c.destroy(); } catch (e) {} });
  arr.length = 0;
}
function _oaChartReady(el) {
  return el && typeof Chart !== 'undefined';
}
function _oaGridColor() { return 'rgba(148,163,184,0.15)'; }
function _oaApplyChartDefaults() {
  if (typeof Chart === 'undefined') return;
  try {
    Chart.defaults.font.family = 'Noto Sans KR, Malgun Gothic, sans-serif';
    Chart.defaults.font.size = 11;
    Chart.defaults.color = 'rgba(148,163,184,0.85)';
  } catch (e) {}
}
// 고정 높이 래퍼 + 캔버스 (무한 성장 방지)
function _oaCanvas(id, height) {
  return '<div style="position:relative;height:' + (height || 200) + 'px"><canvas id="' + _oaEsc(id) + '"></canvas></div>';
}
function _oaPanel(inner, extra) {
  return '<div class="pnl" style="padding:14px 16px;' + (extra || '') + '">' + inner + '</div>';
}
function _oaSectionTitle(t, sub) {
  var h = '<div style="font-size:11px;font-weight:700;color:var(--t3);margin-bottom:' + (sub ? '2px' : '8px') + '">' + _oaEsc(t) + '</div>';
  if (sub) h += '<div style="font-size:9px;color:var(--t6);margin-bottom:8px">' + _oaEsc(sub) + '</div>';
  return h;
}
function _oaEmpty(container, icon, title, msg) {
  if (!container) return;
  container.innerHTML =
    '<div class="pnl" style="padding:50px 20px;text-align:center;color:var(--t5)">' +
    '<div style="font-size:42px;margin-bottom:10px">' + (icon || '📊') + '</div>' +
    '<div style="font-size:13px;font-weight:600;color:var(--t3);margin-bottom:6px">' + _oaEsc(title) + '</div>' +
    '<div style="font-size:11px;color:var(--t5);max-width:460px;margin:0 auto;line-height:1.7">' + _oaEsc(msg) + '</div>' +
    '</div>';
}
function _oaError(container, msg) {
  if (!container) return;
  container.innerHTML = '<div class="pnl" style="padding:24px;text-align:center;color:#EF4444;font-size:12px">' + _oaEsc(msg) + '</div>';
}

var _OA_PALETTE = ['#3B82F6', '#EF4444', '#F59E0B', '#10B981', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#64748B', '#A855F7', '#14B8A6'];

/* ───────── 담당자(등록 인원) 필터 ───────── */
// 프로젝트 행의 "등록 인원" 집합 = 지정 담당자(assignees) ∪ 마일스톤 목표 대상 ∪ 멤버한정 투입자
function _oaRowPersons(row) {
  var set = {};
  var p = (row && row.project) || {};
  (Array.isArray(p.assignees) ? p.assignees : []).forEach(function (n) { if (n) set[n] = true; });
  (row.milestones || []).forEach(function (m) {
    var at = (m && m.assigneeTargets) || {};
    Object.keys(at).forEach(function (n) { if (n) set[n] = true; });
  });
  var people = (row.sumCalc && row.sumCalc.people) || {};
  Object.keys(people).forEach(function (n) { if (n) set[n] = true; });
  return set;
}
function _oaFilterRows(rows) {
  if (!_oaFilterName) return rows || [];
  return (rows || []).filter(function (r) { return _oaRowPersons(r)[_oaFilterName]; });
}
// 전체 rows에서 등록 인원 이름 목록(정렬)
function _oaAllPersons(rows) {
  var set = {};
  (rows || []).forEach(function (r) { var ps = _oaRowPersons(r); Object.keys(ps).forEach(function (n) { set[n] = true; }); });
  return Object.keys(set).sort(function (a, b) { return a.localeCompare(b); });
}
// 필터 변경 → 개요 재렌더 + 상세 자동 선택 갱신 (재집계 없음)
function _oaSetFilter(name) {
  _oaFilterName = name || '';
  if (!_oaData) return;
  _oaRenderOverview(_oaData);
  var filtered = _oaFilterRows(_oaData);
  var auto = _oaPickAutoSelect(filtered);
  var det = document.getElementById(_oaDetailContainerId);
  if (auto) { _oaSelectedProjectId = auto.id; renderProjectAnalytics(auto.id, _oaDetailContainerId); }
  else if (det) { det.innerHTML = '<div class="pnl" style="padding:24px;text-align:center;color:var(--t5);font-size:12px">선택된 담당자의 프로젝트가 없습니다.</div>'; }
}

/* ════════════════════════════════════════════════════════
 * 1) 전사 개요 — renderOperatorAnalytics
 * ════════════════════════════════════════════════════════ */
function renderOperatorAnalytics(containerId) {
  var wrap = document.getElementById(containerId || 'oaWrap');
  if (!wrap) return;

  if (typeof pmGetProjects !== 'function') {
    _oaError(wrap, '프로젝트 API 미연결 (project-data.js)');
    return;
  }
  if (typeof Chart === 'undefined') {
    _oaError(wrap, 'Chart.js 로드 실패 — 페이지 새로고침 후 다시 시도하세요');
    return;
  }
  if (_oaLoading) return;

  _oaLoading = true;
  _oaDestroy(_oaCharts);

  wrap.innerHTML =
    '<div id="oaOverview"><div class="pnl" style="padding:46px 20px;text-align:center;color:var(--t5);font-size:12px">📊 프로젝트 분석 데이터를 집계하는 중…</div></div>' +
    '<div id="' + _oaDetailContainerId + '" style="margin-top:14px"></div>';

  _oaCollect().then(function (rows) {
    _oaLoading = false;
    _oaData = rows;
    _oaRenderOverview(rows);
    // 위험 1순위 또는 첫 프로젝트를 자동 선택 (있으면)
    var auto = _oaPickAutoSelect(rows);
    if (auto) {
      _oaSelectedProjectId = auto.id;
      renderProjectAnalytics(auto.id, _oaDetailContainerId);
    } else {
      var det = document.getElementById(_oaDetailContainerId);
      if (det) {
        det.innerHTML = '<div class="pnl" style="padding:24px;text-align:center;color:var(--t5);font-size:12px">위 목록에서 프로젝트를 선택하면 상세 분석이 표시됩니다.</div>';
      }
    }
  }).catch(function (err) {
    _oaLoading = false;
    _oaError(document.getElementById('oaOverview') || wrap, '분석 데이터 로드 실패: ' + ((err && err.message) || '알 수 없는 오류'));
  });
}

// 각 프로젝트의 진척 히스토리 + 투입 집계를 병렬 수집 → 분석 행 배열
function _oaCollect() {
  return pmGetProjects().then(function (projects) {
    projects = (projects || []).slice();
    // orderNo 기준 정렬 (없으면 이름)
    projects.sort(function (a, b) {
      var ao = a.orderNo || '', bo = b.orderNo || '';
      if (ao !== bo) return ao < bo ? -1 : 1;
      return (a.name || '') < (b.name || '') ? -1 : 1;
    });

    var pMs = (typeof msGetAll === 'function')
      ? msGetAll().catch(function () { return []; })
      : Promise.resolve([]);

    return pMs.then(function (allMs) {
      var msByProj = {};
      (allMs || []).forEach(function (m) {
        var pid = m.projectId;
        if (!pid) return;
        (msByProj[pid] = msByProj[pid] || []).push(m);
      });

      return Promise.all(projects.map(function (p) {
        var milestones = msByProj[p.id] || [];
        var pHist = (typeof getProgressHistory === 'function')
          ? getProgressHistory(p.id).catch(function () { return []; })
          : Promise.resolve([]);
        var pCalc = (typeof calcHoursByMilestone === 'function')
          ? calcHoursByMilestone(p.id, { proj: p, milestones: milestones }).catch(function () { return null; })
          : Promise.resolve(null);

        return Promise.all([pHist, pCalc]).then(function (res) {
          return _oaAnalyze(p, milestones, res[0] || [], res[1]);
        });
      })).then(function (rows) {
        // 위험 점수 내림차순 (위험한 프로젝트 우선)
        rows.sort(function (a, b) { return b.riskScore - a.riskScore; });
        return rows;
      });
    });
  });
}

// 단일 프로젝트 분석 행 산출
function _oaAnalyze(p, milestones, history, calc) {
  var today = _oaToday();
  var status = _oaStatusOf(p);
  var progress = Number(p.progress) || 0;

  var sumCalc = _oaSumCalc(calc);
  var reported = _oaSumReported(milestones);
  var targets = _oaSumTargets(milestones);
  var totalInput = _oaRnd(sumCalc.workHours + reported);   // 총 투입 = 업무일지(멤버한정) + 보고
  var estimated = Number(p.estimatedHours) || 0;

  // 위험 플래그
  var risks = [];
  // 🔴 공수초과: 총투입 > 목표(있으면) 또는 > 예상
  var capBasis = targets > 0 ? targets : estimated;
  var overHours = (capBasis > 0 && totalInput > capBasis);
  if (overHours) {
    var pct = capBasis > 0 ? Math.round((totalInput / capBasis) * 100) : 0;
    risks.push({ kind: 'over', icon: '🔴', label: '공수초과 ' + pct + '%', color: '#EF4444' });
  }
  // 🟠 일정지연: today > endDate & progress < 100
  var dPlus = 0;
  var delayed = false;
  if (p.endDate && p.endDate < today && progress < 100) {
    delayed = true;
    dPlus = Math.max(0, _oaDaysDiff(p.endDate, today));
    risks.push({ kind: 'delay', icon: '🟠', label: 'D+' + dPlus, color: '#F59E0B' });
  } else if (status === 'delayed') {
    delayed = true;
    risks.push({ kind: 'delay', icon: '🟠', label: '지연', color: '#F59E0B' });
  }
  // ⚠️ 진척 정체: 최근 N일 변화 ≈ 0 (완료 제외)
  var delta = _oaRecentProgressDelta(history, _OA_STALE_DAYS);
  var stale = false;
  if (status !== 'done' && progress < 100 && delta != null && delta <= 0.5) {
    stale = true;
    risks.push({ kind: 'stale', icon: '⚠️', label: '정체 ' + _OA_STALE_DAYS + '일', color: '#8B5CF6' });
  }
  // ⚠️ 효율주의: (투입/목표) - (progress/100) >= 0.3
  var effWarn = false;
  if (capBasis > 0) {
    var effGap = (totalInput / capBasis) - (progress / 100);
    if (effGap >= 0.3) {
      effWarn = true;
      risks.push({ kind: 'eff', icon: '⚠️', label: '효율주의', color: '#EC4899' });
    }
  }

  var riskScore =
    (overHours ? 100 : 0) +
    (delayed ? (50 + dPlus) : 0) +
    (stale ? 40 : 0) +
    (effWarn ? 30 : 0);

  return {
    id: p.id,
    name: p.name || '(이름 없음)',
    orderNo: p.orderNo || '',
    project: p,
    status: status,
    progress: progress,
    phase: p.currentPhase || '',
    milestones: milestones,
    history: history,
    calc: calc,
    sumCalc: sumCalc,
    reported: reported,
    targets: targets,
    estimated: estimated,
    totalInput: totalInput,
    dPlus: dPlus,
    delayed: delayed,
    overHours: overHours,
    stale: stale,
    effWarn: effWarn,
    progressDelta: delta,
    risks: risks,
    riskScore: riskScore
  };
}

function _oaPickAutoSelect(rows) {
  if (!rows || !rows.length) return null;
  // 이미 선택된게 유효하면 유지
  if (_oaSelectedProjectId) {
    var found = rows.filter(function (r) { return r.id === _oaSelectedProjectId; })[0];
    if (found) return found;
  }
  // 위험 점수 최상위(>0), 없으면 첫 프로젝트
  if (rows[0].riskScore > 0) return rows[0];
  return rows[0];
}

/* ───────── 전사 개요 렌더 ───────── */
function _oaRenderOverview(rows) {
  var box = document.getElementById('oaOverview');
  if (!box) return;
  if (!rows || !rows.length) {
    _oaEmpty(box, '📊', '분석할 프로젝트가 없습니다.',
      '운영자 보기에 포함된 프로젝트가 없거나 모두 숨김 처리되었습니다. 프로젝트를 등록하거나 가시성 설정을 확인하세요.');
    return;
  }

  _oaApplyChartDefaults();
  _oaDestroy(_oaCharts);

  // ── 담당자(등록 인원) 필터 바 ──
  var allRows = rows;
  var personNames = _oaAllPersons(allRows);
  if (_oaFilterName && personNames.indexOf(_oaFilterName) < 0) _oaFilterName = '';  // stale 필터 정리
  var filtered = _oaFilterRows(allRows);
  var filterBar = '';
  if (personNames.length) {
    filterBar = '<div class="pnl" style="padding:10px 14px;margin-bottom:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
      '<span style="font-size:11px;color:var(--t4);font-weight:600">👤 담당자(등록 인원) 필터</span>' +
      '<select onchange="_oaSetFilter(this.value)" style="font-size:11px;padding:4px 8px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t2)">' +
        '<option value="">전체 (' + allRows.length + '개)</option>' +
        personNames.map(function (nm) { return '<option value="' + _oaEsc(nm) + '"' + (nm === _oaFilterName ? ' selected' : '') + '>' + _oaEsc(nm) + '</option>'; }).join('') +
      '</select>' +
      (_oaFilterName ? '<span style="font-size:10px;color:var(--t6)">' + _oaEsc(_oaFilterName) + ' 등록 ' + filtered.length + '개 프로젝트</span>' : '') +
    '</div>';
  }
  rows = filtered;   // 이하 집계는 필터된 집합 기준
  if (!rows.length) {
    box.innerHTML = filterBar + '<div class="pnl" style="padding:30px;text-align:center;color:var(--t5);font-size:12px">선택한 담당자가 등록된 프로젝트가 없습니다.</div>';
    return;
  }

  // ── KPI 집계 ──
  var n = rows.length;
  var avgProg = _oaRnd(rows.reduce(function (s, r) { return s + r.progress; }, 0) / n);
  var totalInput = _oaRnd(rows.reduce(function (s, r) { return s + r.totalInput; }, 0));
  var totalTargets = _oaRnd(rows.reduce(function (s, r) { return s + r.targets; }, 0));
  var totalEst = _oaRnd(rows.reduce(function (s, r) { return s + r.estimated; }, 0));
  var delayedN = rows.filter(function (r) { return r.delayed; }).length;
  var overN = rows.filter(function (r) { return r.overHours; }).length;
  var staleN = rows.filter(function (r) { return r.stale; }).length;

  // 상태 분포
  var statusCount = {};
  rows.forEach(function (r) { statusCount[r.status] = (statusCount[r.status] || 0) + 1; });
  // 단계 분포
  var phaseCount = {};
  rows.forEach(function (r) { var ph = r.phase || '_none'; phaseCount[ph] = (phaseCount[ph] || 0) + 1; });

  var h = filterBar;

  // KPI 카드
  var cards = [
    { l: '프로젝트', val: n, unit: '개', color: '#6366F1' },
    { l: '평균 진척률', val: avgProg, unit: '%', color: '#3B82F6' },
    { l: '총 투입', val: totalInput.toLocaleString(), unit: 'h',
      sub: (totalTargets > 0 ? '목표 대비 ' + Math.round(totalInput / totalTargets * 100) + '%' : (totalEst > 0 ? '예상 대비 ' + Math.round(totalInput / totalEst * 100) + '%' : '')),
      color: '#8B5CF6' },
    { l: '일정 지연', val: delayedN, unit: '개', color: delayedN > 0 ? '#F59E0B' : '#10B981' },
    { l: '공수 초과', val: overN, unit: '개', color: overN > 0 ? '#EF4444' : '#10B981' },
    { l: '진척 정체', val: staleN, unit: '개', sub: '최근 ' + _OA_STALE_DAYS + '일', color: staleN > 0 ? '#EC4899' : '#10B981' }
  ];
  h += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px">';
  cards.forEach(function (c) {
    h += '<div class="pnl" style="padding:14px 16px;border-top:3px solid ' + c.color + '">';
    h += '<div style="font-size:10px;color:var(--t5);margin-bottom:6px;font-weight:600">' + _oaEsc(c.l) + '</div>';
    h += '<div style="display:flex;align-items:baseline;gap:4px">';
    h += '<span style="font-size:24px;font-weight:700;color:' + c.color + '">' + c.val + '</span>';
    h += '<span style="font-size:11px;color:var(--t5)">' + c.unit + '</span></div>';
    if (c.sub) h += '<div style="margin-top:4px;font-size:9px;color:var(--t6)">' + _oaEsc(c.sub) + '</div>';
    h += '</div>';
  });
  h += '</div>';

  // 상태 분포(도넛) + 단계 분포(가로 바)
  h += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-bottom:12px">';
  h += _oaPanel(_oaSectionTitle('📌 상태 분포', 'PROJ_STATUS 기준') + _oaCanvas('oa_status', 200), 'display:flex;flex-direction:column');
  h += _oaPanel(_oaSectionTitle('🏭 단계 분포', '파이프라인 적체 지점') + _oaCanvas('oa_phase', 200), 'display:flex;flex-direction:column');
  h += '</div>';

  // 위험 프로젝트 리스트
  h += _oaRenderRiskList(rows);

  box.innerHTML = h;

  // ── 차트 그리기 ──
  // 상태 도넛
  (function () {
    var el = document.getElementById('oa_status');
    if (!_oaChartReady(el)) return;
    var keys = Object.keys(statusCount);
    if (!keys.length) return;
    // PROJ_STATUS 정의 순서 우선
    var order = (typeof PROJ_STATUS !== 'undefined') ? Object.keys(PROJ_STATUS) : keys;
    keys.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
    var c = new Chart(el, {
      type: 'doughnut',
      data: {
        labels: keys.map(function (k) { var m = _oaStatusMeta(k); return m.icon + ' ' + m.label; }),
        datasets: [{
          data: keys.map(function (k) { return statusCount[k]; }),
          backgroundColor: keys.map(function (k) { return _oaStatusMeta(k).color; }),
          borderWidth: 0
        }]
      },
      options: {
        maintainAspectRatio: false, responsive: true,
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 10, padding: 6, font: { size: 10 } } },
          tooltip: { callbacks: { label: function (ctx) {
            var total = ctx.dataset.data.reduce(function (s, v) { return s + v; }, 0);
            var pct = total ? Math.round(ctx.parsed * 100 / total) : 0;
            return ctx.label + ': ' + ctx.parsed + '개 (' + pct + '%)';
          } } }
        }
      }
    });
    _oaCharts.push(c);
  })();

  // 단계 가로 바
  (function () {
    var el = document.getElementById('oa_phase');
    if (!_oaChartReady(el)) return;
    var keys = Object.keys(phaseCount);
    if (!keys.length) return;
    var order = (typeof PROJ_PHASE !== 'undefined') ? Object.keys(PROJ_PHASE) : keys;
    keys.sort(function (a, b) {
      var ai = order.indexOf(a === '_none' ? '' : a), bi = order.indexOf(b === '_none' ? '' : b);
      if (ai === -1) ai = 98; if (bi === -1) bi = 98;
      return ai - bi;
    });
    var c = new Chart(el, {
      type: 'bar',
      data: {
        labels: keys.map(function (k) { if (k === '_none') return '미지정'; var m = _oaPhaseMeta(k); return m.icon + ' ' + m.label; }),
        datasets: [{
          label: '프로젝트',
          data: keys.map(function (k) { return phaseCount[k]; }),
          backgroundColor: keys.map(function (k) { return k === '_none' ? '#94A3B8' : _oaPhaseMeta(k).color; }),
          borderWidth: 0, borderRadius: 4
        }]
      },
      options: {
        maintainAspectRatio: false, responsive: true, indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: { x: { grid: { color: _oaGridColor() }, beginAtZero: true, ticks: { precision: 0 } }, y: { grid: { display: false } } }
      }
    });
    _oaCharts.push(c);
  })();
}

function _oaRenderRiskList(rows) {
  var risky = rows.filter(function (r) { return r.risks.length > 0; });
  // 전체 프로젝트를 위험 점수 내림차순으로(위험한 것 먼저), 동점은 이름/수주번호순
  var sorted = rows.slice().sort(function (a, b) {
    if ((b.riskScore || 0) !== (a.riskScore || 0)) return (b.riskScore || 0) - (a.riskScore || 0);
    return (a.orderNo || a.name || '') < (b.orderNo || b.name || '') ? -1 : 1;
  });
  var h = '<div class="pnl" style="padding:14px 16px;margin-bottom:4px">';
  h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:6px">';
  h += '<div style="font-size:11px;font-weight:700;color:var(--t3)">📁 전체 프로젝트 (' + rows.length + ')' + (risky.length ? ' · <span style="color:#EF4444">🚨 위험 ' + risky.length + '</span>' : '') + '</div>';
  h += '<div style="font-size:9px;color:var(--t6)">🔴 공수초과 · 🟠 일정지연 · ⚠️ 정체/효율 — 행 클릭 시 하단 상세 분석</div>';
  h += '</div>';

  if (!rows.length) {
    h += '<div style="padding:24px;text-align:center;color:var(--t5);font-size:12px">표시할 프로젝트가 없습니다. (🛡️ 가시성·접근 관리에서 숨김을 해제하세요)</div>';
  } else {
    h += '<div style="max-height:60vh;overflow:auto">' + _oaRiskRows(sorted, true) + '</div>';
  }
  h += '</div>';
  return h;
}

function _oaRiskRows(list, showBadges) {
  var h = '<div style="display:flex;flex-direction:column;gap:4px">';
  list.forEach(function (r) {
    var sm = _oaStatusMeta(r.status);
    var sel = (r.id === _oaSelectedProjectId);
    h += '<div onclick="_oaSelectProject(\'' + _oaEsc(r.id) + '\')" ' +
         'style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;cursor:pointer;' +
         'background:' + (sel ? 'var(--bg-p)' : 'var(--bg-i)') + ';border:1px solid ' + (sel ? 'var(--ac,#6366F1)' : 'var(--bd)') + '" ' +
         'onmouseover="this.style.opacity=0.85" onmouseout="this.style.opacity=1">';
    // 상태 점
    h += '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + sm.color + ';flex-shrink:0" title="' + _oaEsc(sm.label) + '"></span>';
    // 이름 + 수주번호
    h += '<div style="flex:1;min-width:0">';
    h += '<div style="font-size:12px;font-weight:600;color:var(--t2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + _oaEsc(r.name) + '</div>';
    if (r.orderNo) h += '<div style="font-size:9px;color:var(--t6)">' + _oaEsc(r.orderNo) + '</div>';
    h += '</div>';
    // 진척 막대
    h += '<div style="width:90px;flex-shrink:0">';
    h += '<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--t5);margin-bottom:2px"><span>진척</span><span style="font-weight:700;color:' + sm.color + '">' + r.progress + '%</span></div>';
    h += '<div style="height:5px;background:var(--bg-p);border-radius:3px;overflow:hidden"><div style="height:100%;width:' + Math.min(100, r.progress) + '%;background:' + sm.color + '"></div></div>';
    h += '</div>';
    // 배지
    if (showBadges && r.risks.length) {
      h += '<div style="display:flex;gap:4px;flex-wrap:wrap;flex-shrink:0;max-width:230px;justify-content:flex-end">';
      r.risks.forEach(function (rk) {
        h += '<span style="font-size:9px;font-weight:700;padding:2px 6px;border-radius:10px;background:' + rk.color + '22;color:' + rk.color + ';white-space:nowrap">' + rk.icon + ' ' + _oaEsc(rk.label) + '</span>';
      });
      h += '</div>';
    } else {
      // 투입/목표 요약
      var basis = r.targets > 0 ? r.targets : r.estimated;
      var rt = basis > 0 ? (' / ' + basis + 'h') : 'h';
      h += '<div style="font-size:9px;color:var(--t6);flex-shrink:0;text-align:right;min-width:70px">투입 ' + r.totalInput + rt + '</div>';
    }
    h += '</div>';
  });
  h += '</div>';
  return h;
}

// 위험/목록 행 클릭 핸들러 (전역 — onclick 에서 호출)
function _oaSelectProject(projectId) {
  _oaSelectedProjectId = projectId;
  // 선택 강조 갱신을 위해 리스트만 다시 그림 (전체 재집계 불필요)
  if (_oaData) _oaRenderOverview(_oaData);
  renderProjectAnalytics(projectId, _oaDetailContainerId);
  // 상세 영역으로 스크롤
  var det = document.getElementById(_oaDetailContainerId);
  if (det && det.scrollIntoView) { try { det.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {} }
}

/* ════════════════════════════════════════════════════════
 * 2) 프로젝트 상세 — renderProjectAnalytics
 * ════════════════════════════════════════════════════════ */
function renderProjectAnalytics(projectId, containerId) {
  var box = document.getElementById(containerId || _oaDetailContainerId);
  if (!box) return;
  if (typeof Chart === 'undefined') { _oaError(box, 'Chart.js 로드 실패'); return; }

  _oaDestroy(_oaProjCharts);
  box.innerHTML = '<div class="pnl" style="padding:40px;text-align:center;color:var(--t5);font-size:12px">📈 프로젝트 상세 분석을 불러오는 중…</div>';

  // 캐시(_oaData)에 해당 행이 있으면 재사용, 없으면 직접 수집
  var cached = null;
  if (_oaData) cached = _oaData.filter(function (r) { return r.id === projectId; })[0];

  var pRow;
  if (cached) {
    pRow = Promise.resolve(cached);
  } else {
    pRow = _oaCollectOne(projectId);
  }

  pRow.then(function (row) {
    if (!row) { _oaError(box, '프로젝트를 찾을 수 없습니다.'); return; }
    _oaRenderProjectDetail(box, row);
  }).catch(function (err) {
    _oaError(box, '상세 분석 로드 실패: ' + ((err && err.message) || '알 수 없는 오류'));
  });
}

// 캐시 없이 단일 프로젝트 수집 (renderProjectAnalytics 직접 호출 대응)
function _oaCollectOne(projectId) {
  var pProj = (typeof projGet === 'function')
    ? projGet(projectId)
    : (typeof pmGetProjects === 'function'
        ? pmGetProjects().then(function (list) { return (list || []).filter(function (p) { return p.id === projectId; })[0]; })
        : Promise.resolve(null));

  return pProj.then(function (p) {
    if (!p) return null;
    var pMs = (typeof msGetByProject === 'function')
      ? msGetByProject(projectId).catch(function () { return []; })
      : Promise.resolve([]);
    return pMs.then(function (milestones) {
      var pHist = (typeof getProgressHistory === 'function')
        ? getProgressHistory(projectId).catch(function () { return []; })
        : Promise.resolve([]);
      var pCalc = (typeof calcHoursByMilestone === 'function')
        ? calcHoursByMilestone(projectId, { proj: p, milestones: milestones }).catch(function () { return null; })
        : Promise.resolve(null);
      return Promise.all([pHist, pCalc]).then(function (res) {
        return _oaAnalyze(p, milestones, res[0] || [], res[1]);
      });
    });
  });
}

function _oaRenderProjectDetail(box, row) {
  _oaApplyChartDefaults();
  _oaDestroy(_oaProjCharts);

  var sm = _oaStatusMeta(row.status);
  var h = '';

  // 헤더
  h += '<div class="pnl" style="padding:14px 18px;margin-bottom:12px;border-left:4px solid ' + sm.color + '">';
  h += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">';
  h += '<div>';
  h += '<div style="font-size:15px;font-weight:700;color:var(--t1)">' + sm.icon + ' ' + _oaEsc(row.name) + '</div>';
  var meta = [];
  if (row.orderNo) meta.push(_oaEsc(row.orderNo));
  meta.push(sm.label);
  if (row.phase) { var pm = _oaPhaseMeta(row.phase); meta.push(pm.icon + ' ' + pm.label); }
  h += '<div style="font-size:10px;color:var(--t5);margin-top:3px">' + meta.join(' · ') + '</div>';
  h += '</div>';
  // 미니 KPI
  h += '<div style="display:flex;gap:14px;flex-wrap:wrap">';
  h += _oaMiniStat('진척률', row.progress + '%', sm.color);
  h += _oaMiniStat('총 투입', row.totalInput + 'h', '#8B5CF6');
  if (row.targets > 0) h += _oaMiniStat('목표', row.targets + 'h', '#3B82F6');
  else if (row.estimated > 0) h += _oaMiniStat('예상', row.estimated + 'h', '#3B82F6');
  if (row.reported > 0) h += _oaMiniStat('보고 투입', row.reported + 'h', '#EC4899');
  h += '</div>';
  h += '</div>';
  // 위험 배지
  if (row.risks.length) {
    h += '<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">';
    row.risks.forEach(function (rk) {
      h += '<span style="font-size:10px;font-weight:700;padding:3px 8px;border-radius:10px;background:' + rk.color + '22;color:' + rk.color + '">' + rk.icon + ' ' + _oaEsc(rk.label) + '</span>';
    });
    h += '</div>';
  }
  h += '</div>';

  // 진척률 추세선 + 투입 (2축)
  h += _oaPanel(
    _oaSectionTitle('📈 진척률 추세 + 투입시간', '좌축 진척% / 우축 누적 투입h (progress_history)') +
    '<div id="oa_trendBox">' + _oaCanvas('oa_trend', 220) + '</div>',
    'margin-bottom:12px'
  );

  // 담당자별 투입 vs 목표 + 마일스톤 표
  h += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-bottom:12px">';
  h += _oaPanel(
    _oaSectionTitle('👥 담당자별 투입 vs 목표', '업무일지(멤버한정) 집계 vs assigneeTargets') +
    '<div id="oa_assigneeBox">' + _oaCanvas('oa_assignee', 240) + '</div>',
    'display:flex;flex-direction:column'
  );
  h += _oaPanel(_oaSectionTitle('🧭 마일스톤별 현황', '진척 · 투입/목표 · 일정 · 미태깅') + '<div id="oa_msTable"></div>', 'display:flex;flex-direction:column');
  h += '</div>';

  // 작업 노트 타임라인
  h += _oaPanel(_oaSectionTitle('📝 최근 작업 노트', '마일스톤 작업노트 통합 (최신순)') + '<div id="oa_logs"><div style="padding:14px;text-align:center;color:var(--t6);font-size:11px">불러오는 중…</div></div>', 'margin-bottom:4px');

  box.innerHTML = h;

  // 차트/표/타임라인 채우기
  _oaDrawTrend(row);
  _oaDrawAssignee(row);
  _oaRenderMsTable(row);
  _oaRenderLogs(row);
}

function _oaMiniStat(label, val, color) {
  return '<div style="text-align:center;min-width:62px">' +
    '<div style="font-size:18px;font-weight:700;color:' + color + ';line-height:1.1">' + _oaEsc(val) + '</div>' +
    '<div style="font-size:9px;color:var(--t5);margin-top:2px">' + _oaEsc(label) + '</div></div>';
}

/* 진척률 추세 + 누적 투입 (2축) */
function _oaDrawTrend(row) {
  var el = document.getElementById('oa_trend');
  if (!_oaChartReady(el)) return;
  var hist = (row.history || []).slice().sort(function (a, b) { return (a.date || '') < (b.date || '') ? -1 : 1; });
  if (!hist.length) {
    var box = document.getElementById('oa_trendBox');
    if (box) box.innerHTML = '<div style="padding:30px;text-align:center;color:var(--t6);font-size:11px">진척 히스토리가 아직 없습니다. 기록이 쌓이면 추세가 표시됩니다.</div>';
    return;
  }
  var labels = hist.map(function (p) { var d = p.date || ''; return d.length >= 10 ? d.slice(5) : d; });
  var progressData = hist.map(function (p) { return Number(p.progress) || 0; });
  var hoursData = hist.map(function (p) { return Number(p.actualHours) || 0; });
  var hasHours = hoursData.some(function (v) { return v > 0; });

  var datasets = [{
    label: '진척률(%)', data: progressData, yAxisID: 'y',
    borderColor: '#3B82F6', backgroundColor: '#3B82F622', tension: 0.3, fill: true, borderWidth: 2,
    pointRadius: 2, pointBackgroundColor: '#3B82F6'
  }];
  if (hasHours) {
    datasets.push({
      label: '누적 투입(h)', data: hoursData, yAxisID: 'y1',
      borderColor: '#F59E0B', backgroundColor: '#F59E0B11', tension: 0.3, fill: false, borderWidth: 2,
      pointRadius: 2, pointBackgroundColor: '#F59E0B', borderDash: [4, 3]
    });
  }

  var scales = {
    x: { grid: { color: _oaGridColor() }, ticks: { font: { size: 9 }, maxRotation: 0, autoSkip: true } },
    y: { position: 'left', grid: { color: _oaGridColor() }, min: 0, max: 100, title: { display: true, text: '진척%', font: { size: 9 } } }
  };
  if (hasHours) {
    scales.y1 = { position: 'right', grid: { display: false }, beginAtZero: true, title: { display: true, text: '투입h', font: { size: 9 } } };
  }

  var c = new Chart(el, {
    type: 'line',
    data: { labels: labels, datasets: datasets },
    options: {
      maintainAspectRatio: false, responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { boxWidth: 10, padding: 8, font: { size: 10 } } } },
      scales: scales
    }
  });
  _oaProjCharts.push(c);
}

/* 담당자별 투입 vs 목표 (그룹 바) */
function _oaDrawAssignee(row) {
  var el = document.getElementById('oa_assignee');
  if (!_oaChartReady(el)) return;

  // 목표(assigneeTargets 합) per 담당자
  var targetByName = {};
  (row.milestones || []).forEach(function (m) {
    var at = (m && m.assigneeTargets) || {};
    Object.keys(at).forEach(function (nm) { targetByName[nm] = (targetByName[nm] || 0) + (Number(at[nm]) || 0); });
  });
  // 투입(업무일지 멤버한정 합) per 담당자
  var inputByName = (row.sumCalc && row.sumCalc.people) || {};

  var names = {};
  Object.keys(targetByName).forEach(function (n) { names[n] = true; });
  Object.keys(inputByName).forEach(function (n) { names[n] = true; });
  var nameList = Object.keys(names);

  if (!nameList.length) {
    var box = document.getElementById('oa_assigneeBox');
    if (box) box.innerHTML = '<div style="padding:30px;text-align:center;color:var(--t6);font-size:11px">담당자별 목표/투입 데이터가 아직 없습니다.</div>';
    return;
  }
  // 투입 큰 순 정렬
  nameList.sort(function (a, b) { return (inputByName[b] || 0) - (inputByName[a] || 0); });

  var c = new Chart(el, {
    type: 'bar',
    data: {
      labels: nameList,
      datasets: [
        { label: '투입(h)', data: nameList.map(function (n) { return _oaRnd(inputByName[n] || 0); }), backgroundColor: '#8B5CF6', borderWidth: 0, borderRadius: 3 },
        { label: '목표(h)', data: nameList.map(function (n) { return _oaRnd(targetByName[n] || 0); }), backgroundColor: '#3B82F644', borderColor: '#3B82F6', borderWidth: 1, borderRadius: 3 }
      ]
    },
    options: {
      maintainAspectRatio: false, responsive: true, indexAxis: 'y',
      plugins: {
        legend: { labels: { boxWidth: 10, padding: 8, font: { size: 10 } } },
        tooltip: { callbacks: { afterLabel: function (ctx) {
          var nm = nameList[ctx.dataIndex];
          var t = targetByName[nm] || 0, inp = inputByName[nm] || 0;
          if (t > 0) return '달성 ' + Math.round(inp / t * 100) + '%';
          return '';
        } } }
      },
      scales: { x: { grid: { color: _oaGridColor() }, beginAtZero: true }, y: { grid: { display: false } } }
    }
  });
  _oaProjCharts.push(c);
}

/* 마일스톤별 표 */
function _oaRenderMsTable(row) {
  var box = document.getElementById('oa_msTable');
  if (!box) return;
  var ms = (row.milestones || []).slice().sort(function (a, b) {
    var ao = (a.order == null ? 999999 : a.order), bo = (b.order == null ? 999999 : b.order);
    if (ao !== bo) return ao - bo;
    return (a.startDate || '') < (b.startDate || '') ? -1 : 1;
  });
  if (!ms.length) {
    box.innerHTML = '<div style="padding:24px;text-align:center;color:var(--t6);font-size:11px">등록된 마일스톤이 없습니다.</div>';
    return;
  }
  var today = _oaToday();
  var calc = row.calc || {};

  var h = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px">';
  h += '<thead><tr style="color:var(--t5);text-align:left;border-bottom:1px solid var(--bd)">';
  ['마일스톤', '진척', '투입/목표', '일정', '미태깅'].forEach(function (t, i) {
    h += '<th style="padding:6px 6px;font-weight:600;font-size:10px;' + (i > 0 ? 'text-align:right' : '') + '">' + t + '</th>';
  });
  h += '</tr></thead><tbody>';

  ms.forEach(function (m) {
    var b = calc[m.id] || {};
    var work = _oaRnd(Number(b.hours) || 0);
    var reported = Number(m.reportedHours) || 0;
    var input = _oaRnd(work + reported);
    var tgt = 0; var at = m.assigneeTargets || {};
    Object.keys(at).forEach(function (k) { tgt += Number(at[k]) || 0; });
    tgt = _oaRnd(tgt);
    var prog = Number(m.progress) || 0;
    var over = (tgt > 0 && input > tgt);

    // 일정
    var sched = '-';
    var schedColor = 'var(--t5)';
    if (m.endDate) {
      if (m.endDate < today && prog < 100) {
        var dp = Math.max(0, _oaDaysDiff(m.endDate, today));
        sched = '🟠 D+' + dp; schedColor = '#F59E0B';
      } else if (m.endDate >= today) {
        var rem = Math.max(0, _oaDaysDiff(today, m.endDate));
        sched = '잔여 ' + rem + 'd'; schedColor = 'var(--t4)';
      } else {
        sched = '완료기한'; schedColor = '#10B981';
      }
    }
    var untag = Number(b.untagged) || 0;

    h += '<tr style="border-bottom:1px solid var(--bd)">';
    h += '<td style="padding:7px 6px;color:var(--t2);max-width:160px"><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + _oaEsc(m.name || '(이름 없음)') + '</div></td>';
    // 진척
    h += '<td style="padding:7px 6px;text-align:right"><span style="font-weight:700;color:' + (prog >= 100 ? '#10B981' : 'var(--t3)') + '">' + prog + '%</span></td>';
    // 투입/목표
    h += '<td style="padding:7px 6px;text-align:right;color:' + (over ? '#EF4444' : 'var(--t3)') + ';font-weight:' + (over ? '700' : '500') + '">' + input + (tgt > 0 ? ' / ' + tgt : '') + 'h' + (over ? ' ⚠' : '') + '</td>';
    // 일정
    h += '<td style="padding:7px 6px;text-align:right;color:' + schedColor + ';white-space:nowrap">' + sched + '</td>';
    // 미태깅
    h += '<td style="padding:7px 6px;text-align:right;color:' + (untag > 0 ? '#F59E0B' : 'var(--t6)') + '">' + (untag > 0 ? untag + '건' : '-') + '</td>';
    h += '</tr>';
  });
  h += '</tbody></table></div>';

  // 할당 외 기록 안내
  var outH = (row.sumCalc && row.sumCalc.outHours) || 0;
  if (outH > 0) {
    h += '<div style="margin-top:8px;font-size:10px;color:var(--t6);padding:6px 8px;background:var(--bg-i);border-radius:6px">ℹ️ 할당 외(비등록자) 기록 ' + outH + 'h — 공식 투입 집계에서 제외됨</div>';
  }
  box.innerHTML = h;
}

/* 작업 노트 타임라인 (마일스톤 logs 통합) */
function _oaRenderLogs(row) {
  var box = document.getElementById('oa_logs');
  if (!box) return;
  var ms = row.milestones || [];
  if (!ms.length || typeof msLogsGet !== 'function') {
    box.innerHTML = '<div style="padding:14px;text-align:center;color:var(--t6);font-size:11px">작업 노트가 아직 없습니다.</div>';
    return;
  }
  var msNameById = {};
  ms.forEach(function (m) { msNameById[m.id] = m.name || ''; });

  Promise.all(ms.map(function (m) {
    return msLogsGet(m.id).then(function (logs) {
      return (logs || []).map(function (l) { l._msName = m.name || ''; return l; });
    }).catch(function () { return []; });
  })).then(function (lists) {
    var all = [];
    lists.forEach(function (arr) { all = all.concat(arr); });
    all.sort(function (a, b) { return (b.createdAt || '') < (a.createdAt || '') ? -1 : 1; });
    var top = all.slice(0, 12);
    if (!top.length) {
      box.innerHTML = '<div style="padding:14px;text-align:center;color:var(--t6);font-size:11px">작업 노트가 아직 없습니다. 마일스톤 업데이트가 쌓이면 표시됩니다.</div>';
      return;
    }
    var h = '<div style="display:flex;flex-direction:column;gap:8px;max-height:340px;overflow-y:auto">';
    top.forEach(function (l) {
      var when = l.createdAt ? _oaFmtDateTime(l.createdAt) : '';
      h += '<div style="display:flex;gap:8px;padding:8px 10px;background:var(--bg-i);border-radius:6px;border-left:3px solid #8B5CF6">';
      h += '<div style="flex:1;min-width:0">';
      h += '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:3px">';
      if (l.progress != null) h += '<span style="font-size:10px;font-weight:700;color:#3B82F6">진척 ' + (Number(l.progress) || 0) + '%</span>';
      if (l.hours) h += '<span style="font-size:10px;font-weight:600;color:#F59E0B">+' + _oaRnd(l.hours) + 'h</span>';
      if (l._msName) h += '<span style="font-size:9px;color:var(--t6)">· ' + _oaEsc(l._msName) + '</span>';
      h += '</div>';
      if (l.note) h += '<div style="font-size:11px;color:var(--t3);line-height:1.5;white-space:pre-wrap">' + _oaEsc(l.note) + '</div>';
      h += '<div style="font-size:9px;color:var(--t6);margin-top:3px">' + _oaEsc(l.authorName || '') + (when ? ' · ' + when : '') + '</div>';
      h += '</div></div>';
    });
    h += '</div>';
    box.innerHTML = h;
  }).catch(function () {
    box.innerHTML = '<div style="padding:14px;text-align:center;color:var(--t6);font-size:11px">작업 노트를 불러오지 못했습니다.</div>';
  });
}

function _oaFmtDateTime(iso) {
  var d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  var mm = String(d.getMonth() + 1).padStart(2, '0');
  var dd = String(d.getDate()).padStart(2, '0');
  var hh = String(d.getHours()).padStart(2, '0');
  var mi = String(d.getMinutes()).padStart(2, '0');
  return mm + '/' + dd + ' ' + hh + ':' + mi;
}

/* ───────── 전역 노출 (브라우저 환경) ───────── */
if (typeof window !== 'undefined') {
  window.renderOperatorAnalytics = renderOperatorAnalytics;
  window.renderProjectAnalytics = renderProjectAnalytics;
  window._oaSelectProject = _oaSelectProject;
  window._oaSetFilter = _oaSetFilter;
}
