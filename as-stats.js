/**
 * A/S — 트렌드·통계 분석 모듈 (v13.54)
 *
 * 진입점: renderASStats(container)
 *
 * 구성:
 *  - 기간 프리셋 토글 (7d / 30d / 90d / 6m / 12m / 사용자 지정)
 *  - KPI 6장 (신규/처리중/종결/MTTR/SLA위반%/CSAT) — 추세 화살표 + 색상 코딩
 *  - 자동 인사이트 패널 (규칙 기반 한국어 코멘트)
 *  - 차트 그리드:
 *      • 신규/종결 추이 (Line, 2 series)
 *      • 카테고리 분포 (Donut)
 *      • 긴급도 분포 (Bar, 색상 코딩)
 *      • 상태 분포 (Donut)
 *      • SLA 준수율 — 긴급도별 (Stacked Bar)
 *      • 부서별 부하 (Horizontal Bar, h + 건수)
 *      • MTTR 추이 (Line)
 *      • Top 10 고객 (Horizontal Bar — Pareto)
 *      • Top 10 장비모델 (Horizontal Bar)
 *      • RCA·완료분류 분포 (Bar)
 *      • CSAT 추이 (Line, 3 series)
 *      • 부품 비용 — 청구구분별 (Donut) + 월별 누적 (Stacked Bar)
 *  - 주간 요약 텔레그램 발사 버튼 (admin)
 *
 * 디자인 원칙:
 *  - 일관 색상: 긴급도=AS_PRIORITY color, 청구=AS_BILLING color, 상태=내부 매핑
 *  - 시인성: 큰 숫자 + 추세 화살표(▲▼) + 의미 색상(개선=초록/악화=빨강)
 *  - 분석력: drill-down (차트 클릭 시 해당 조건으로 A/S 목록 필터 점프)
 *  - 데이터 부족 시: "데이터가 충분히 쌓이면 표시됩니다" 안내
 */

var _asStatsData = null;       // 마지막 응답 (drill-down 시 컨텍스트)
var _asStatsCharts = [];       // Chart 인스턴스 (destroy 보관)
var _asStatsLoading = false;
var _asStatsPreset = '90d';    // 7d|30d|90d|6m|12m|custom
var _asStatsCustomFrom = '';
var _asStatsCustomTo = '';
var _asStatsFilter = { category: '', priority: '', customer: '' };  // 다중 필터

function _asStatsDestroy() {
  _asStatsCharts.forEach(function (c) { try { c.destroy(); } catch (e) {} });
  _asStatsCharts = [];
}

function _asStatsResolvePeriod() {
  var now = new Date();
  var to = now;
  var from;
  switch (_asStatsPreset) {
    case '7d':  from = new Date(now.getTime() - 7 * 86400000); break;
    case '30d': from = new Date(now.getTime() - 30 * 86400000); break;
    case '90d': from = new Date(now.getTime() - 90 * 86400000); break;
    case '6m':  from = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()); break;
    case '12m': from = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()); break;
    case 'custom':
      from = _asStatsCustomFrom ? new Date(_asStatsCustomFrom) : new Date(now.getTime() - 90 * 86400000);
      to   = _asStatsCustomTo   ? new Date(_asStatsCustomTo + 'T23:59:59') : now;
      break;
    default: from = new Date(now.getTime() - 90 * 86400000);
  }
  return {
    from: from.toISOString().slice(0, 10),
    to:   to.toISOString().slice(0, 10)
  };
}

/* ─── 메인 진입점 ─── */
function renderASStats() {
  var wrap = document.getElementById('asWrap');
  if (!wrap) return;
  if (typeof asStatsGet !== 'function') {
    wrap.innerHTML = '<div class="pnl" style="padding:24px;text-align:center;color:#EF4444">통계 API 미연결 (project-data.js)</div>';
    return;
  }
  if (typeof Chart === 'undefined') {
    wrap.innerHTML = '<div class="pnl" style="padding:24px;text-align:center;color:#EF4444">Chart.js 로드 실패 — 페이지 새로고침 후 다시 시도하세요</div>';
    return;
  }

  // 컨테이너 셸 (먼저 띄우고 데이터는 비동기로 채움)
  wrap.innerHTML = _asStatsShellHtml();
  _asStatsBindControls();
  _asStatsFetch();
}

function _asStatsShellHtml() {
  var presets = [
    { v: '7d', l: '7일' }, { v: '30d', l: '30일' }, { v: '90d', l: '90일' },
    { v: '6m', l: '6개월' }, { v: '12m', l: '12개월' }, { v: 'custom', l: '사용자 지정' }
  ];
  var h = '';

  // 상단 컨트롤
  h += '<div class="pnl" style="margin-bottom:12px;padding:14px 18px">';
  h += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">';
  h += '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">';
  h += '<span style="font-size:13px;font-weight:700;color:var(--t2)">📊 A/S 통계 · 트렌드 분석</span>';
  // 보기 모드 복귀
  h += '<button onclick="asViewMode=\'all\';renderAS()" style="font-size:10px;padding:4px 10px;border:1px solid var(--bd);border-radius:6px;background:var(--bg-i);color:var(--t4);cursor:pointer">← 목록으로</button>';
  h += '</div>';
  // 기간 토글
  h += '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">';
  h += '<span style="font-size:10px;color:var(--t5);font-weight:600">기간</span>';
  h += '<div style="display:inline-flex;border:1px solid var(--bd);border-radius:6px;overflow:hidden">';
  presets.forEach(function (p) {
    var active = _asStatsPreset === p.v;
    h += '<button data-preset="' + p.v + '" class="asStatsPresetBtn" style="font-size:10px;padding:4px 10px;border:none;background:' + (active ? '#F59E0B' : 'var(--bg-i)') + ';color:' + (active ? '#fff' : 'var(--t4)') + ';cursor:pointer;font-weight:' + (active ? '700' : '500') + '">' + p.l + '</button>';
  });
  h += '</div>';
  // custom 기간 입력
  h += '<span id="asStatsCustomRange" style="display:' + (_asStatsPreset === 'custom' ? 'inline-flex' : 'none') + ';gap:4px;align-items:center">';
  h += '<input type="date" id="asStatsFrom" value="' + _asStatsCustomFrom + '" style="font-size:10px;padding:3px 6px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-i);color:var(--t3)">';
  h += '<span style="color:var(--t5)">~</span>';
  h += '<input type="date" id="asStatsTo" value="' + _asStatsCustomTo + '" style="font-size:10px;padding:3px 6px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-i);color:var(--t3)">';
  h += '<button id="asStatsApplyCustom" style="font-size:10px;padding:3px 8px;border:none;border-radius:4px;background:#F59E0B;color:#fff;cursor:pointer">적용</button>';
  h += '</span>';
  // 주간 발사
  var isAdmin = (typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'admin');
  if (isAdmin) {
    h += '<button id="asStatsWeeklyBtn" style="font-size:10px;padding:4px 10px;border:1px solid #0EA5E9;border-radius:6px;background:transparent;color:#0EA5E9;cursor:pointer" title="관리자에게 텔레그램 주간 요약 발사">📨 주간 요약 발사</button>';
  }
  h += '</div></div>';
  h += '<div id="asStatsPeriodLabel" style="margin-top:6px;font-size:10px;color:var(--t5)"></div>';

  // 다중 필터 (v13.55 C)
  h += '<div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--bd);display:flex;gap:8px;align-items:center;flex-wrap:wrap">';
  h += '<span style="font-size:10px;color:var(--t5);font-weight:600">🔍 필터</span>';
  // 카테고리
  h += '<select id="asStatsFilterCat" style="font-size:10px;padding:3px 6px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-i);color:var(--t3)">';
  h += '<option value="">전체 카테고리</option>';
  var _CAT = typeof AS_CATEGORY !== 'undefined' ? AS_CATEGORY : {};
  if (window._AS_CAT_CACHE && window._AS_CAT_CACHE.length) {
    window._AS_CAT_CACHE.forEach(function (c) {
      h += '<option value="' + c.code + '"' + (_asStatsFilter.category === c.code ? ' selected' : '') + '>' + (c.icon || '') + ' ' + c.label + '</option>';
    });
  } else {
    Object.keys(_CAT).forEach(function (k) {
      h += '<option value="' + k + '"' + (_asStatsFilter.category === k ? ' selected' : '') + '>' + (_CAT[k].icon || '') + ' ' + _CAT[k].label + '</option>';
    });
  }
  h += '</select>';
  // 긴급도
  h += '<select id="asStatsFilterPrio" style="font-size:10px;padding:3px 6px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-i);color:var(--t3)">';
  h += '<option value="">전체 긴급도</option>';
  ['P1','P2','P3','P4'].forEach(function (p) {
    h += '<option value="' + p + '"' + (_asStatsFilter.priority === p ? ' selected' : '') + '>' + p + '</option>';
  });
  h += '</select>';
  // 고객 검색
  h += '<input id="asStatsFilterCust" type="text" placeholder="고객사 검색" value="' + _asStatsEsc(_asStatsFilter.customer) + '" style="font-size:10px;padding:3px 8px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-i);color:var(--t3);min-width:140px">';
  h += '<button id="asStatsFilterApply" style="font-size:10px;padding:3px 10px;border:none;border-radius:4px;background:#F59E0B;color:#fff;cursor:pointer;font-weight:600">적용</button>';
  if (_asStatsFilter.category || _asStatsFilter.priority || _asStatsFilter.customer) {
    h += '<button id="asStatsFilterClear" style="font-size:10px;padding:3px 8px;border:1px solid var(--bd);border-radius:4px;background:var(--bg-i);color:var(--t4);cursor:pointer">필터 해제</button>';
  }
  h += '</div>';
  h += '</div>';

  // 본문 (그리드 셸 — 차트들은 이 안에 채워짐)
  h += '<div id="asStatsBody">';
  h += '<div class="pnl" style="padding:40px;text-align:center;color:var(--t5);font-size:12px">📊 통계 데이터를 불러오는 중…</div>';
  h += '</div>';
  return h;
}

function _asStatsBindControls() {
  document.querySelectorAll('.asStatsPresetBtn').forEach(function (btn) {
    btn.onclick = function () {
      _asStatsPreset = btn.dataset.preset;
      renderASStats();
    };
  });
  var applyBtn = document.getElementById('asStatsApplyCustom');
  if (applyBtn) {
    applyBtn.onclick = function () {
      _asStatsCustomFrom = document.getElementById('asStatsFrom').value;
      _asStatsCustomTo   = document.getElementById('asStatsTo').value;
      _asStatsFetch();
    };
  }
  var applyFilter = document.getElementById('asStatsFilterApply');
  if (applyFilter) {
    applyFilter.onclick = function () {
      _asStatsFilter.category = document.getElementById('asStatsFilterCat').value;
      _asStatsFilter.priority = document.getElementById('asStatsFilterPrio').value;
      _asStatsFilter.customer = document.getElementById('asStatsFilterCust').value;
      _asStatsFetch();
    };
  }
  var clearFilter = document.getElementById('asStatsFilterClear');
  if (clearFilter) {
    clearFilter.onclick = function () {
      _asStatsFilter = { category: '', priority: '', customer: '' };
      renderASStats();
    };
  }
  var custInput = document.getElementById('asStatsFilterCust');
  if (custInput) {
    custInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') applyFilter && applyFilter.click();
    });
  }

  var weeklyBtn = document.getElementById('asStatsWeeklyBtn');
  if (weeklyBtn) {
    weeklyBtn.onclick = function () {
      if (!confirm('관리자에게 텔레그램으로 A/S 주간 요약을 즉시 발송합니다. 계속하시겠습니까?')) return;
      weeklyBtn.disabled = true;
      weeklyBtn.textContent = '발송 중…';
      asStatsWeeklyDigest(true).then(function (d) {
        weeklyBtn.disabled = false;
        weeklyBtn.textContent = '📨 주간 요약 발사';
        if (typeof showToast === 'function') {
          showToast(d && d.sentTo ? '✅ 주간 요약 ' + d.sentTo + '명 발송 완료' : '⚠ 관리자(또는 텔레그램 연결) 없음', 'info');
        }
      }).catch(function (err) {
        weeklyBtn.disabled = false;
        weeklyBtn.textContent = '📨 주간 요약 발사';
        if (typeof showToast === 'function') showToast('❌ ' + ((err && err.message) || '실패'), 'error');
      });
    };
  }
}

function _asStatsFetch() {
  if (_asStatsLoading) return;
  _asStatsLoading = true;
  _asStatsDestroy();
  var p = _asStatsResolvePeriod();
  var body = document.getElementById('asStatsBody');
  var periodLabel = document.getElementById('asStatsPeriodLabel');
  if (periodLabel) periodLabel.textContent = '🗓 ' + p.from + ' ~ ' + p.to;
  if (body) body.innerHTML = '<div class="pnl" style="padding:40px;text-align:center;color:var(--t5);font-size:12px">📊 통계 데이터를 불러오는 중…</div>';

  var qparams = { from: p.from, to: p.to };
  if (_asStatsFilter.category) qparams.category = _asStatsFilter.category;
  if (_asStatsFilter.priority) qparams.priority = _asStatsFilter.priority;
  if (_asStatsFilter.customer) qparams.customer = _asStatsFilter.customer;
  asStatsGet(qparams).then(function (d) {
    _asStatsLoading = false;
    _asStatsData = d;
    _asStatsRender();
  }).catch(function (err) {
    _asStatsLoading = false;
    if (body) body.innerHTML = '<div class="pnl" style="padding:24px;text-align:center;color:#EF4444">통계 로드 실패: ' + ((err && err.message) || '알 수 없는 오류') + '</div>';
  });
}

function _asStatsRender() {
  var d = _asStatsData;
  if (!d) return;
  var body = document.getElementById('asStatsBody');
  if (!body) return;

  var hasData = (d.kpi.newCount.value + (d.kpi.inProgress.value || 0) + (d.kpi.closedCount.value || 0)) > 0;
  if (!hasData) {
    body.innerHTML =
      '<div class="pnl" style="padding:60px 20px;text-align:center;color:var(--t5);font-size:13px">' +
      '<div style="font-size:48px;margin-bottom:10px">📊</div>' +
      '<div style="font-size:13px;font-weight:600;color:var(--t3);margin-bottom:6px">선택한 기간에 A/S 데이터가 없습니다.</div>' +
      '<div style="font-size:11px;color:var(--t5);max-width:480px;margin:0 auto;line-height:1.7">' +
      '기간을 더 길게 설정하거나, A/S 접수를 등록한 후 다시 확인해 주세요.<br>' +
      '예시 데이터가 필요하면 [전체] 보기에서 접수를 몇 건 등록해 보세요.</div>' +
      '</div>';
    return;
  }

  var h = '';
  // 건강 점수 (큰 카드 — 가장 위에)
  h += _asStatsHtmlHealthScore(d.kpi.healthScore);
  // 🤖 AI 자연어 코멘트 (Claude) — 컨테이너만 띄우고 비동기 로드
  h += '<div id="asStatsAiCard" style="margin-bottom:12px"></div>';
  setTimeout(function () { _asStatsLoadAiInsight(); }, 0);
  // 인사이트 패널 (규칙 기반)
  h += _asStatsHtmlInsights(d.insights || []);
  // KPI
  h += _asStatsHtmlKpi(d.kpi);
  // 1행: 추이 (큰 라인)
  h += _asStatsHtmlChartCell('chart_trend', '📈 신규/종결 추이', '신규 접수와 종결 건수의 시간 흐름', null, 'large');
  // 2행: 카테고리 도넛 + 긴급도 + 상태
  h += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:12px" id="asStatsRow2">';
  h += _asStatsHtmlChartCell('chart_category', '🏷️ 카테고리 분포', '발생 빈도가 높은 유형', null, 'small', true);
  h += _asStatsHtmlChartCell('chart_priority', '🚦 긴급도 분포', '', null, 'small', true);
  h += _asStatsHtmlChartCell('chart_status',   '📌 상태 분포', '', null, 'small', true);
  h += '</div>';
  // 3행: SLA 막대 + 부서 부하
  h += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-bottom:12px">';
  h += _asStatsHtmlChartCell('chart_sla', '⏱️ SLA 준수율 (긴급도별)', '약속 시간 내 종결 비율', null, 'small');
  h += _asStatsHtmlChartCell('chart_dept', '👥 부서별 처리 부하', '활동로그 누적 소요시간 (시)', null, 'small');
  h += '</div>';
  // 4행: MTTR + Top 고객
  h += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-bottom:12px">';
  h += _asStatsHtmlChartCell('chart_mttr', '⚡ MTTR 추이', '평균 처리 시간 (h)', null, 'small');
  h += _asStatsHtmlChartCell('chart_topCustomers', '🎯 Top 10 고객 (Pareto)', '발생 빈도 상위', null, 'small');
  h += '</div>';
  // 5행: Top 장비 + RCA
  h += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-bottom:12px">';
  h += _asStatsHtmlChartCell('chart_topEquipment', '🔧 Top 10 장비모델', '', null, 'small');
  h += _asStatsHtmlChartCell('chart_rca', '🔍 완료분류 / RCA', '종결 케이스의 closure 분포', null, 'small');
  h += '</div>';
  // 6행: CSAT
  h += _asStatsHtmlChartCell('chart_csat', '⭐ CSAT 추이', '응답속도·처리품질·전반 만족도 (5점 척도)', null, 'small');
  // 7행: 부품 비용 (도넛 + 월별)
  h += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-bottom:12px">';
  h += _asStatsHtmlChartCell('chart_partsBilling', '💰 부품 비용 — 청구구분별', '', null, 'small', true);
  h += _asStatsHtmlChartCell('chart_partsMonth', '💵 부품 비용 — 월별 누적', '청구구분 색상별 스택', null, 'small');
  h += '</div>';

  body.innerHTML = h;

  // 모든 차트 인스턴스화
  _asStatsDrawAll(d);
}

/* v13.65: Claude 기반 자연어 인사이트 — 비동기 로드 + 1시간 캐시(서버) */
function _asStatsLoadAiInsight() {
  var card = document.getElementById('asStatsAiCard');
  if (!card) return;
  if (typeof asAiWeeklyInsight !== 'function') return;
  card.innerHTML =
    '<div class="pnl" style="padding:14px 18px;background:linear-gradient(135deg,#8B5CF61A,transparent);border-left:3px solid #8B5CF6">' +
    '<div style="display:flex;justify-content:space-between;align-items:center">' +
    '<div style="font-size:11px;font-weight:700;color:#8B5CF6">🤖 Claude AI 인사이트</div>' +
    '<div style="font-size:10px;color:var(--t5)">⏳ 분석 중…</div></div></div>';

  asAiWeeklyInsight().then(function (r) {
    var d = r && r.data;
    if (!d) { card.innerHTML = ''; return; }
    var html = '<div class="pnl" style="padding:16px 20px;background:linear-gradient(135deg,#8B5CF61A,transparent);border-left:3px solid #8B5CF6">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px">';
    html += '<div style="font-size:11px;font-weight:700;color:#8B5CF6">🤖 Claude AI 인사이트</div>';
    html += '<div style="font-size:9px;color:var(--t6)">';
    if (r.usage) html += '토큰 ' + (r.usage.input_tokens || 0) + '+' + (r.usage.output_tokens || 0) + ' · ';
    html += '캐시 1h · 생성 ' + (r.generatedAt ? new Date(r.generatedAt).toLocaleTimeString('ko-KR') : '-');
    html += '</div></div>';
    // headline
    html += '<div style="font-size:14px;font-weight:700;color:var(--t1);margin-bottom:6px">' + _asStatsEsc(d.headline || '') + '</div>';
    // narrative
    if (d.narrative) html += '<div style="font-size:12px;color:var(--t2);line-height:1.65;margin-bottom:10px;white-space:pre-wrap">' + _asStatsEsc(d.narrative) + '</div>';
    // focus + actions
    if ((d.focus && d.focus.length) || (d.actions && d.actions.length)) {
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:8px">';
      if (d.focus && d.focus.length) {
        html += '<div style="background:var(--bg-i);border-radius:6px;padding:8px 10px">';
        html += '<div style="font-size:10px;font-weight:700;color:#F59E0B;margin-bottom:4px">🔎 집중 관찰</div>';
        d.focus.forEach(function (f) {
          html += '<div style="font-size:11px;color:var(--t3);padding:2px 0">• ' + _asStatsEsc(f) + '</div>';
        });
        html += '</div>';
      }
      if (d.actions && d.actions.length) {
        html += '<div style="background:var(--bg-i);border-radius:6px;padding:8px 10px">';
        html += '<div style="font-size:10px;font-weight:700;color:#10B981;margin-bottom:4px">✅ 다음 주 액션</div>';
        d.actions.forEach(function (a) {
          html += '<div style="font-size:11px;color:var(--t3);padding:2px 0">• ' + _asStatsEsc(a) + '</div>';
        });
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
    card.innerHTML = html;
  }).catch(function (err) {
    var msg = (err && err.data && err.data.message) || (err && err.message) || '실패';
    // 503(미설정)이면 부드럽게 숨김, 그 외엔 작은 안내
    if (err && err.status === 503) { card.innerHTML = ''; return; }
    card.innerHTML =
      '<div class="pnl" style="padding:10px 14px;background:var(--bg-i);border-left:3px solid #94A3B8">' +
      '<div style="font-size:11px;color:var(--t5)">🤖 AI 인사이트 생성 실패: ' + _asStatsEsc(msg) + '</div></div>';
  });
}

function _asStatsHtmlHealthScore(hs) {
  if (!hs) return '';
  var bd = hs.breakdown || {};
  var h = '<div class="pnl" style="margin-bottom:12px;padding:18px 22px;background:linear-gradient(135deg,' + hs.color + '15,transparent);border-left:4px solid ' + hs.color + '">';
  h += '<div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">';
  // 큰 점수 + 등급
  h += '<div style="display:flex;align-items:baseline;gap:12px">';
  h += '<div>';
  h += '<div style="font-size:10px;color:var(--t5);font-weight:600;margin-bottom:2px">A/S 건강 점수</div>';
  h += '<div style="font-size:42px;font-weight:800;color:' + hs.color + ';line-height:1">' + hs.value + '<span style="font-size:18px;color:var(--t5);font-weight:500">/100</span></div>';
  h += '</div>';
  h += '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:60px;height:60px;border-radius:50%;background:' + hs.color + ';color:#fff;font-size:28px;font-weight:800">' + hs.grade + '</div>';
  h += '</div>';
  // 분석 막대 (SLA / MTTR / CSAT)
  h += '<div style="flex:1;min-width:280px;display:flex;flex-direction:column;gap:6px">';
  var parts = [
    { l: 'SLA 준수', v: bd.sla, w: 50, c: '#3B82F6' },
    { l: '응답 속도 (MTTR)', v: bd.mttr, w: bd.csat != null ? 25 : 30, c: '#F59E0B' }
  ];
  if (bd.csat != null) parts.push({ l: '고객 만족도 (CSAT)', v: bd.csat, w: 25, c: '#10B981' });
  parts.forEach(function (p) {
    if (p.v == null) return;
    h += '<div>';
    h += '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--t4);margin-bottom:2px">';
    h += '<span style="font-weight:600">' + p.l + ' <span style="color:var(--t6);font-weight:400">(가중치 ' + p.w + '%)</span></span>';
    h += '<span style="font-weight:700;color:' + p.c + '">' + p.v + '점</span>';
    h += '</div>';
    h += '<div style="height:6px;background:var(--bg-i);border-radius:3px;overflow:hidden">';
    h += '<div style="height:100%;width:' + p.v + '%;background:' + p.c + ';transition:width 0.4s"></div>';
    h += '</div></div>';
  });
  h += '</div>';
  h += '<div style="font-size:10px;color:var(--t5);min-width:140px;line-height:1.5">';
  h += '등급 기준:<br>A 90+ · B 75+ · C 60+ · D 45+ · E < 45';
  h += '</div>';
  h += '</div></div>';
  return h;
}

function _asStatsHtmlInsights(list) {
  if (!list || !list.length) {
    return '<div class="pnl" style="margin-bottom:12px;padding:14px 18px;background:linear-gradient(135deg,#F59E0B11,#F59E0B05);border-left:3px solid #F59E0B">' +
      '<div style="font-size:11px;color:var(--t4)">💡 자동 인사이트는 데이터가 더 쌓이면 표시됩니다.</div></div>';
  }
  var h = '<div class="pnl" style="margin-bottom:12px;padding:14px 18px">';
  h += '<div style="font-size:11px;font-weight:700;color:var(--t3);margin-bottom:8px">💡 자동 인사이트</div>';
  h += '<div style="display:flex;flex-direction:column;gap:6px">';
  list.forEach(function (ins) {
    var bg, fg, bd;
    switch (ins.kind) {
      case 'good':     bg = '#10B98115'; fg = '#059669'; bd = '#10B981'; break;
      case 'warn':     bg = '#F59E0B15'; fg = '#D97706'; bd = '#F59E0B'; break;
      case 'critical': bg = '#EF444415'; fg = '#DC2626'; bd = '#EF4444'; break;
      case 'info':
      default:         bg = '#3B82F615'; fg = '#2563EB'; bd = '#3B82F6';
    }
    h += '<div style="display:flex;gap:8px;padding:8px 12px;background:' + bg + ';border-left:3px solid ' + bd + ';border-radius:0 4px 4px 0;font-size:11px;line-height:1.5;color:' + fg + '">';
    h += '<span style="font-size:14px">' + (ins.icon || '•') + '</span>';
    h += '<span style="font-weight:600">' + _asStatsEsc(ins.text) + '</span>';
    h += '</div>';
  });
  h += '</div></div>';
  return h;
}

function _asStatsHtmlKpi(kpi) {
  var cards = [
    { k: 'newCount',     l: '신규 접수',     val: kpi.newCount.value,        delta: kpi.newCount.deltaPct,    invert: true,  unit: '건',  color: '#6366F1' },
    { k: 'inProgress',   l: '처리 중',       val: kpi.inProgress.value,                                                       unit: '건',  color: '#3B82F6' },
    { k: 'closedCount',  l: '종결',          val: kpi.closedCount.value,     delta: kpi.closedCount.deltaPct, invert: false, unit: '건',  color: '#10B981' },
    { k: 'openCritical', l: 'P1·P2 미해결',  val: kpi.openCritical.value,                                                     unit: '건',  color: kpi.openCritical.value > 0 ? '#EF4444' : '#10B981' },
    { k: 'mttrHours',    l: '평균 처리시간', val: (kpi.mttrHours.value || 0).toFixed(1), delta: kpi.mttrHours.deltaPct, invert: true, unit: 'h', color: '#F59E0B' },
    { k: 'slaBreach',    l: 'SLA 위반율',    val: (kpi.slaBreachPct.value || 0).toFixed(1), delta: kpi.slaBreachPct.deltaPct, invert: true, unit: '%', color: kpi.slaBreachPct.value >= 10 ? '#EF4444' : (kpi.slaBreachPct.value > 0 ? '#F59E0B' : '#10B981') },
    { k: 'csatOverall',  l: 'CSAT 평균',     val: (kpi.csatOverall.value || 0).toFixed(1), delta: kpi.csatOverall.deltaPct, invert: false, unit: '/ 5', sub: '응답 ' + (kpi.csatOverall.respCount || 0) + '건', color: kpi.csatOverall.value >= 4 ? '#10B981' : (kpi.csatOverall.value >= 3 ? '#F59E0B' : '#EF4444') },
    { k: 'partsCost',    l: '부품 비용',     val: (kpi.partsCost.value || 0).toLocaleString(),                              unit: '원',  color: '#8B5CF6' }
  ];

  var h = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:12px">';
  cards.forEach(function (c) {
    var deltaTxt = '';
    if (c.delta != null && c.delta !== 0 && !isNaN(c.delta)) {
      var goodDir = c.invert ? (c.delta < 0) : (c.delta > 0);
      var arrow = c.delta > 0 ? '▲' : '▼';
      var deltaColor = goodDir ? '#10B981' : '#EF4444';
      deltaTxt = '<span style="margin-left:6px;font-size:11px;font-weight:700;color:' + deltaColor + '">' +
                 arrow + ' ' + Math.abs(c.delta).toFixed(1) + '%</span>';
    }
    h += '<div class="pnl" style="padding:14px 16px;border-top:3px solid ' + c.color + '">';
    h += '<div style="font-size:10px;color:var(--t5);margin-bottom:6px;font-weight:600">' + c.l + '</div>';
    h += '<div style="display:flex;align-items:baseline;gap:4px">';
    h += '<span style="font-size:24px;font-weight:700;color:' + c.color + '">' + c.val + '</span>';
    h += '<span style="font-size:11px;color:var(--t5)">' + c.unit + '</span>';
    h += deltaTxt;
    h += '</div>';
    if (c.sub) h += '<div style="margin-top:4px;font-size:9px;color:var(--t6)">' + c.sub + '</div>';
    h += '</div>';
  });
  h += '</div>';
  return h;
}

function _asStatsHtmlChartCell(canvasId, title, sub, drillKey, size, isDoughnut) {
  var height = size === 'large' ? 280 : 240;
  var h = '<div class="pnl" style="padding:14px 16px;display:flex;flex-direction:column' + (size === 'large' ? ';margin-bottom:12px' : '') + '">';
  h += '<div style="font-size:11px;font-weight:700;color:var(--t3);margin-bottom:2px">' + title + '</div>';
  if (sub) h += '<div style="font-size:9px;color:var(--t6);margin-bottom:8px">' + sub + '</div>';
  h += '<div style="position:relative;height:' + height + 'px"><canvas id="' + canvasId + '"></canvas></div>';
  h += '</div>';
  return h;
}

function _asStatsEsc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _asStatsFmtBucket(iso, groupBy) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  var y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  if (groupBy === 'day') return m + '/' + dd;
  if (groupBy === 'week') return m + '/' + dd + '~';
  return String(y).slice(2) + '.' + m;  // month
}

/* ─── 차트 그리기 ─── */
function _asStatsDrawAll(d) {
  var grid = (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  var gridColor = 'rgba(148,163,184,0.15)';
  var tickColor = 'rgba(148,163,184,0.85)';
  Chart.defaults.font.family = 'Noto Sans KR, Malgun Gothic, sans-serif';
  Chart.defaults.font.size = 11;
  Chart.defaults.color = tickColor;

  var commonOpts = {
    maintainAspectRatio: false,
    responsive: true,
    plugins: {
      legend: { labels: { boxWidth: 10, padding: 8, font: { size: 10 } } },
      tooltip: { titleFont: { size: 11 }, bodyFont: { size: 11 } }
    },
    scales: {
      x: { grid: { color: gridColor }, ticks: { font: { size: 10 } } },
      y: { grid: { color: gridColor }, ticks: { font: { size: 10 }, beginAtZero: true } }
    }
  };
  function deepMerge(a, b) { return Object.assign({}, a, b); }

  var groupBy = (d.period && d.period.groupBy) || 'month';

  // 1) 신규/종결 추이
  (function () {
    var ctx = document.getElementById('chart_trend');
    if (!ctx || !d.trend.labels.length) return;
    var c = new Chart(ctx, {
      type: 'line',
      data: {
        labels: d.trend.labels.map(function (b) { return _asStatsFmtBucket(b, groupBy); }),
        datasets: [
          { label: '신규 접수', data: d.trend.newCount, borderColor: '#6366F1', backgroundColor: '#6366F133', tension: 0.3, fill: true, borderWidth: 2 },
          { label: '종결', data: d.trend.closedCount, borderColor: '#10B981', backgroundColor: '#10B98133', tension: 0.3, fill: true, borderWidth: 2 }
        ]
      },
      options: commonOpts
    });
    _asStatsCharts.push(c);
  })();

  // 2) 카테고리 도넛
  (function () {
    var ctx = document.getElementById('chart_category');
    if (!ctx || !d.distribution.category.length) return;
    var palette = ['#3B82F6', '#EF4444', '#F59E0B', '#10B981', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#64748B', '#A855F7', '#14B8A6'];
    var c = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: d.distribution.category.map(function (x) { return (x.icon || '') + ' ' + x.label; }),
        datasets: [{
          data: d.distribution.category.map(function (x) { return x.value; }),
          backgroundColor: d.distribution.category.map(function (_, i) { return palette[i % palette.length]; }),
          borderWidth: 0
        }]
      },
      options: {
        maintainAspectRatio: false, responsive: true,
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 10, padding: 6, font: { size: 10 } } },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                var total = ctx.dataset.data.reduce(function (s, v) { return s + v; }, 0);
                var pct = total ? Math.round(ctx.parsed * 100 / total) : 0;
                return ctx.label + ': ' + ctx.parsed + '건 (' + pct + '%)';
              }
            }
          }
        }
      },
      onClick: function (evt, els) {
        if (!els || !els.length) return;
        var idx = els[0].index;
        var code = d.distribution.category[idx].code;
        _asStatsDrillDown({ category: code });
      }
    });
    _asStatsCharts.push(c);
  })();

  // 3) 긴급도 분포 (Bar, 색상 코딩)
  (function () {
    var ctx = document.getElementById('chart_priority');
    if (!ctx || !d.distribution.priority.length) return;
    var c = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: d.distribution.priority.map(function (x) { return x.code; }),
        datasets: [{
          label: '건수',
          data: d.distribution.priority.map(function (x) { return x.value; }),
          backgroundColor: d.distribution.priority.map(function (x) { return x.color; }),
          borderWidth: 0,
          borderRadius: 4
        }]
      },
      options: deepMerge(commonOpts, { plugins: { legend: { display: false } } }),
      onClick: function (evt, els) {
        if (!els || !els.length) return;
        _asStatsDrillDown({ priority: d.distribution.priority[els[0].index].code });
      }
    });
    _asStatsCharts.push(c);
  })();

  // 4) 상태 분포 (도넛)
  (function () {
    var ctx = document.getElementById('chart_status');
    if (!ctx || !d.distribution.status.length) return;
    var labelMap = (typeof AS_STATUS !== 'undefined') ? AS_STATUS : {};
    var c = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: d.distribution.status.map(function (x) { return (labelMap[x.code] || {}).label || x.code; }),
        datasets: [{
          data: d.distribution.status.map(function (x) { return x.value; }),
          backgroundColor: d.distribution.status.map(function (x) { return x.color; }),
          borderWidth: 0
        }]
      },
      options: {
        maintainAspectRatio: false, responsive: true,
        plugins: { legend: { position: 'right', labels: { boxWidth: 10, padding: 6, font: { size: 10 } } } }
      },
      onClick: function (evt, els) {
        if (!els || !els.length) return;
        _asStatsDrillDown({ status: d.distribution.status[els[0].index].code });
      }
    });
    _asStatsCharts.push(c);
  })();

  // 5) SLA 준수율 (Stacked Bar)
  (function () {
    var ctx = document.getElementById('chart_sla');
    if (!ctx || !d.sla.byPriority.length) return;
    var labels = d.sla.byPriority.map(function (x) { return x.priority; });
    var c = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { label: 'SLA 준수', data: d.sla.byPriority.map(function (x) { return x.withinSla; }), backgroundColor: '#10B981', borderWidth: 0, stack: 'sla' },
          { label: 'SLA 위반', data: d.sla.byPriority.map(function (x) { return x.breached; }), backgroundColor: '#EF4444', borderWidth: 0, stack: 'sla' }
        ]
      },
      options: {
        maintainAspectRatio: false, responsive: true, indexAxis: 'x',
        plugins: {
          legend: { labels: { boxWidth: 10, padding: 8 } },
          tooltip: {
            callbacks: {
              afterLabel: function (ctx) {
                var x = d.sla.byPriority[ctx.dataIndex];
                return '준수율: ' + (100 - x.breachPct).toFixed(1) + '%';
              }
            }
          }
        },
        scales: { x: { stacked: true, grid: { color: gridColor } }, y: { stacked: true, grid: { color: gridColor }, beginAtZero: true } }
      }
    });
    _asStatsCharts.push(c);
  })();

  // 6) 부서별 부하 (Horizontal Bar)
  (function () {
    var ctx = document.getElementById('chart_dept');
    if (!ctx || !d.deptLoad.length) return;
    var DEPT_MAP = typeof DEPT !== 'undefined' ? DEPT : {};
    var palette = ['#3B82F6', '#EF4444', '#F59E0B', '#10B981', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];
    var c = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: d.deptLoad.map(function (x) { return (DEPT_MAP[x.dept] || {}).label || x.dept; }),
        datasets: [{
          label: '소요(h)',
          data: d.deptLoad.map(function (x) { return x.hours; }),
          backgroundColor: d.deptLoad.map(function (x, i) { return (DEPT_MAP[x.dept] || {}).color || palette[i % palette.length]; }),
          borderWidth: 0, borderRadius: 4
        }]
      },
      options: {
        maintainAspectRatio: false, responsive: true, indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              afterLabel: function (ctx) { return '티켓 ' + d.deptLoad[ctx.dataIndex].ticketCount + '건'; }
            }
          }
        },
        scales: { x: { grid: { color: gridColor }, beginAtZero: true }, y: { grid: { display: false } } }
      }
    });
    _asStatsCharts.push(c);
  })();

  // 7) MTTR 추이
  (function () {
    var ctx = document.getElementById('chart_mttr');
    if (!ctx || !d.trend.labels.length) return;
    var c = new Chart(ctx, {
      type: 'line',
      data: {
        labels: d.trend.labels.map(function (b) { return _asStatsFmtBucket(b, groupBy); }),
        datasets: [{
          label: '평균 처리시간 (h)',
          data: d.trend.mttrHours,
          borderColor: '#F59E0B', backgroundColor: '#F59E0B22', tension: 0.3, fill: true, borderWidth: 2,
          pointRadius: 3, pointBackgroundColor: '#F59E0B'
        }]
      },
      options: deepMerge(commonOpts, {
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (ctx) { return '평균 ' + Number(ctx.parsed.y).toFixed(1) + 'h'; } } }
        }
      })
    });
    _asStatsCharts.push(c);
  })();

  // 8) Top 고객 (Horizontal Bar, Pareto)
  (function () {
    var ctx = document.getElementById('chart_topCustomers');
    if (!ctx || !d.topCustomers.length) return;
    var c = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: d.topCustomers.map(function (x) { return x.name; }),
        datasets: [{
          label: '건수',
          data: d.topCustomers.map(function (x) { return x.value; }),
          backgroundColor: d.topCustomers.map(function (x) { return x.urgentCount > 0 ? '#EF4444' : '#6366F1'; }),
          borderWidth: 0, borderRadius: 4
        }]
      },
      options: {
        maintainAspectRatio: false, responsive: true, indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              afterLabel: function (ctx) {
                var x = d.topCustomers[ctx.dataIndex];
                return x.urgentCount > 0 ? '🔴 P1·P2 ' + x.urgentCount + '건' : '';
              }
            }
          }
        },
        scales: { x: { grid: { color: gridColor }, beginAtZero: true }, y: { grid: { display: false } } }
      },
      onClick: function (evt, els) {
        if (!els || !els.length) return;
        _asStatsDrillDown({ customer: d.topCustomers[els[0].index].name });
      }
    });
    _asStatsCharts.push(c);
  })();

  // 9) Top 장비
  (function () {
    var ctx = document.getElementById('chart_topEquipment');
    if (!ctx || !d.topEquipment.length) return;
    var c = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: d.topEquipment.map(function (x) { return x.name; }),
        datasets: [{ label: '건수', data: d.topEquipment.map(function (x) { return x.value; }), backgroundColor: '#06B6D4', borderWidth: 0, borderRadius: 4 }]
      },
      options: {
        maintainAspectRatio: false, responsive: true, indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: { x: { grid: { color: gridColor }, beginAtZero: true }, y: { grid: { display: false } } }
      }
    });
    _asStatsCharts.push(c);
  })();

  // 10) RCA·완료분류
  (function () {
    var ctx = document.getElementById('chart_rca');
    if (!ctx || !d.rca.length) return;
    var c = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: d.rca.map(function (x) { return x.code; }),
        datasets: [{ label: '건수', data: d.rca.map(function (x) { return x.value; }), backgroundColor: '#8B5CF6', borderWidth: 0, borderRadius: 4 }]
      },
      options: deepMerge(commonOpts, { plugins: { legend: { display: false } } })
    });
    _asStatsCharts.push(c);
  })();

  // 11) CSAT 추이
  (function () {
    var ctx = document.getElementById('chart_csat');
    if (!ctx || !d.csat.labels.length) return;
    var c = new Chart(ctx, {
      type: 'line',
      data: {
        labels: d.csat.labels.map(function (b) { return _asStatsFmtBucket(b, groupBy); }),
        datasets: [
          { label: '전반 만족도', data: d.csat.overall, borderColor: '#10B981', backgroundColor: '#10B98122', tension: 0.3, borderWidth: 2.5, pointRadius: 3 },
          { label: '응답 속도',   data: d.csat.speed,   borderColor: '#3B82F6', backgroundColor: '#3B82F622', tension: 0.3, borderWidth: 1.5, pointRadius: 2, borderDash: [4, 3] },
          { label: '처리 품질',   data: d.csat.quality, borderColor: '#F59E0B', backgroundColor: '#F59E0B22', tension: 0.3, borderWidth: 1.5, pointRadius: 2, borderDash: [4, 3] }
        ]
      },
      options: deepMerge(commonOpts, {
        scales: { x: { grid: { color: gridColor } }, y: { grid: { color: gridColor }, min: 1, max: 5 } }
      })
    });
    _asStatsCharts.push(c);
  })();

  // 12) 부품 청구구분 도넛
  (function () {
    var ctx = document.getElementById('chart_partsBilling');
    if (!ctx || !d.parts.byBilling.length) return;
    var BILL = typeof AS_BILLING !== 'undefined' ? AS_BILLING : {};
    var c = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: d.parts.byBilling.map(function (x) { return (BILL[x.billing] || {}).label || x.billing; }),
        datasets: [{
          data: d.parts.byBilling.map(function (x) { return x.total; }),
          backgroundColor: d.parts.byBilling.map(function (x) { return (BILL[x.billing] || {}).color || '#94A3B8'; }),
          borderWidth: 0
        }]
      },
      options: {
        maintainAspectRatio: false, responsive: true,
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 10, padding: 6, font: { size: 10 } } },
          tooltip: {
            callbacks: {
              label: function (ctx) { return ctx.label + ': ' + Number(ctx.parsed).toLocaleString() + '원'; }
            }
          }
        }
      }
    });
    _asStatsCharts.push(c);
  })();

  // 13) 부품 월별 누적 (Stacked Bar)
  (function () {
    var ctx = document.getElementById('chart_partsMonth');
    if (!ctx || !d.parts.labels.length) return;
    var BILL = typeof AS_BILLING !== 'undefined' ? AS_BILLING : {};
    var c = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: d.parts.labels.map(function (b) { return _asStatsFmtBucket(b, groupBy); }),
        datasets: [
          { label: (BILL.warranty || {}).label || '보증', data: d.parts.warranty, backgroundColor: (BILL.warranty || {}).color || '#10B981', stack: 'p', borderWidth: 0 },
          { label: (BILL.paid || {}).label || '유상',     data: d.parts.paid,     backgroundColor: (BILL.paid || {}).color || '#F59E0B',     stack: 'p', borderWidth: 0 },
          { label: (BILL.goodwill || {}).label || 'Goodwill', data: d.parts.goodwill, backgroundColor: (BILL.goodwill || {}).color || '#3B82F6', stack: 'p', borderWidth: 0 },
          { label: (BILL.check || {}).label || '확인 필요', data: d.parts.check, backgroundColor: (BILL.check || {}).color || '#94A3B8', stack: 'p', borderWidth: 0 }
        ]
      },
      options: {
        maintainAspectRatio: false, responsive: true,
        plugins: {
          legend: { labels: { boxWidth: 10, padding: 8, font: { size: 10 } } },
          tooltip: {
            callbacks: { label: function (ctx) { return ctx.dataset.label + ': ' + Number(ctx.parsed.y).toLocaleString() + '원'; } }
          }
        },
        scales: { x: { stacked: true, grid: { color: gridColor } }, y: { stacked: true, grid: { color: gridColor }, beginAtZero: true } }
      }
    });
    _asStatsCharts.push(c);
  })();
}

/* ─── Drill-down: 차트 클릭 → A/S 목록 필터로 점프 ─── */
function _asStatsDrillDown(filter) {
  if (!filter) return;
  // 적용 가능한 필터만
  if (filter.category)  asFilterCategory = filter.category;
  if (filter.priority)  asFilterPriority = filter.priority;
  if (filter.status)    asFilterStatus = filter.status;
  if (filter.customer)  asSearchKw = filter.customer;
  asViewMode = 'all';
  renderAS();
  if (typeof showToast === 'function') {
    var keys = Object.keys(filter).map(function (k) { return k + '=' + filter[k]; }).join(', ');
    showToast('🔍 필터 적용: ' + keys, 'info');
  }
}
