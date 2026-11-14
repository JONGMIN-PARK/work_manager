/* weekly-plan-actual.js — 주간 업무 › 🎯 계획 대비 실적 (v13.492)
 * 놓치는 업무가 없게: 계획(금주 칸) ↔ 실적(다음 주 보고서의 지난주 칸)을 짝지어 이행률 · 완료율 · 계획 외 · 못 한 일 · 보고 누락을 보고,
 * 업무일지 시간과 함께 무엇이 모자라는지(인력 · 일정 · 계획 · 집중 · 보고)를 근거 숫자로 짚는다.
 * 기간 + 업체 · 프로젝트 · 인원 · 분야를 골라 조합(⭐ 조합 저장 — 이 브라우저)으로 본다. 서버: GET /api/weekly-reports/plan-actual
 * 그리기만 이 파일 — 계산은 server/lib/weekly-plan-actual.js
 */
(function () {
  'use strict';
  var RES = {   // 결과 색 — 주간 보고 상태 색과 같은 뜻 (빨강은 못 한 일에만)
    done:       { l: '완료',     c: '#16A34A', tip: '실적 칸에 #완료 · 100%' },
    progressed: { l: '진척',     c: '#2563EB', tip: '실적 칸에 있고 나아감(#진행 · 진행률 올라감)' },
    unreported: { l: '보고 누락', c: '#D97706', tip: '실적 칸엔 없지만 그 주 업무일지에 시간이 있음' },
    stalled:    { l: '정체',     c: '#64748B', tip: '실적 칸에 있는데 나아간 표시가 없음' },
    missed:     { l: '못 함',    c: '#DC2626', tip: '실적 칸에도 업무일지에도 없음' },
    unplanned:  { l: '계획 외',  c: '#8B5CF6', tip: '계획에 없이 실적 칸에만 나온 일' }
  };
  var PLAN_KEYS = ['done', 'progressed', 'unreported', 'stalled', 'missed'];
  var DIAG = { people: ['👥', '인력'], time: ['⏱', '일정'], plan: ['🗓', '계획'], focus: ['🎯', '집중'], report: ['📝', '보고'], stall: ['⏸', '정체'], slack: ['🪫', '여유'], trend: ['📉', '추세'], good: ['✅', '잘 됨'] };
  var SEC = { dev: '개발', setup: '셋업', cs: 'C/S', etc: '기타' };
  var LS = 'wr-pa-state', LS_SETS = 'wr-pa-sets';

  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function esc(s) { return s == null ? '' : String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(id) { return document.getElementById(id); }
  function md(w) { return w ? w.slice(5).replace('-', '/') : ''; }
  function pv(v) { return v == null ? '–' : v + '%'; }
  function emptyFilter() { return { clients: [], members: [], projects: [], sections: [] }; }

  var saved = lsGet(LS, {});
  var S = { team: saved.team || '', weeks: saved.weeks || 12, from: '', to: '', capacity: saved.capacity || 40,
    filter: Object.assign(emptyFilter(), saved.filter || {}), data: null, pop: null, recRes: '', seq: 0 };
  function remember() { lsSet(LS, { team: S.team, weeks: S.weeks, capacity: S.capacity, filter: S.filter }); }

  /* ─── 틀 ─── */
  window.wrPaRender = function (box) {
    box.innerHTML = '<div class="wpa">'
      + '<div class="wri-bar wpa-bar">'
      +   '<select id="wpaTeam" class="wr-inp" title="팀"><option value="">모든 팀</option></select>'
      +   '<span class="wm-seg" id="wpaWeeks">' + [4, 8, 12, 26, 52].map(function (n) { return '<button data-w="' + n + '"' + (!S.from && n === S.weeks ? ' class="on"' : '') + '>' + (n >= 52 ? '1년' : n + '주') + '</button>'; }).join('')
      +     '<button data-w="custom"' + (S.from ? ' class="on"' : '') + '>직접</button></span>'
      +   '<span id="wpaRange" class="wpa-range"' + (S.from ? '' : ' hidden') + '><input id="wpaFrom" type="date" class="wr-inp" value="' + esc(S.from) + '"> ~ <input id="wpaTo" type="date" class="wr-inp" value="' + esc(S.to) + '"></span>'
      +   '<label class="wpa-cap" title="1인 주당 기준 시간 — 이보다 많으면 과부하, 적으면 여유로 봄">기준 <input id="wpaCap" type="number" min="10" max="80" step="1" class="wr-inp" value="' + S.capacity + '">h/주</label>'
      +   '<span style="flex:1"></span>'
      +   '<button class="btn btn-g btn-s" id="wpaCsv" title="계획 ↔ 실적 기록 전체 — 엑셀에서 열기">⬇ CSV</button>'
      + '</div>'
      + '<div class="wpa-fbar" id="wpaFbar"></div>'
      + '<div id="wpaPop" class="wpa-pop" hidden></div>'
      + '<div id="wpaBody"><div class="wr-msg">⏳ 분석 중...</div></div>'
      + '</div>';
    $('wpaTeam').addEventListener('change', function () { S.team = this.value; remember(); run(); });
    $('wpaWeeks').addEventListener('click', function (e) {
      var b = e.target.closest('[data-w]'); if (!b) return;
      this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
      if (b.dataset.w === 'custom') {
        $('wpaRange').hidden = false;
        if (!S.from && S.data && S.data.query) { S.from = S.data.query.from; S.to = S.data.query.to; $('wpaFrom').value = S.from; $('wpaTo').value = S.to; }
        return;
      }
      S.weeks = +b.dataset.w; S.from = S.to = ''; $('wpaRange').hidden = true; remember(); run();
    });
    ['wpaFrom', 'wpaTo'].forEach(function (id) { $(id).addEventListener('change', function () { S.from = $('wpaFrom').value; S.to = $('wpaTo').value; if (S.from && S.to) run(); }); });
    $('wpaCap').addEventListener('change', function () { S.capacity = Math.max(10, Math.min(80, +this.value || 40)); this.value = S.capacity; remember(); run(); });
    $('wpaCsv').addEventListener('click', downloadCsv);
    if (!window._wpaPopBound) { document.addEventListener('mousedown', closePopOutside); window._wpaPopBound = true; }
    drawFilterBar();
    run();
  };
  function closePopOutside(e) {
    var p = $('wpaPop'); if (!p || p.hidden) return;
    if (e.target.closest('#wpaPop') || e.target.closest('[data-fopen]')) return;
    p.hidden = true; S.pop = null; drawFilterBar();
  }

  function qs() {
    var q = '?capacity=' + S.capacity + (S.team ? '&team=' + encodeURIComponent(S.team) : '');
    q += S.from && S.to ? '&from=' + S.from + '&to=' + S.to : '&weeks=' + S.weeks;
    var f = S.filter;
    if (f.clients.length || f.members.length || f.projects.length || f.sections.length) q += '&filter=' + encodeURIComponent(JSON.stringify(f));
    return q;
  }
  async function run() {
    var box = $('wpaBody'); if (!box) return;
    var my = ++S.seq;
    box.classList.add('wpa-loading');
    try {
      var r = await apiFetch('/api/weekly-reports/plan-actual' + qs());
      if (my !== S.seq) return;
      S.data = r.data;
      var sel = $('wpaTeam');
      if (sel && sel.options.length <= 1) (S.data.teams || []).forEach(function (t) { var o = document.createElement('option'); o.value = t; o.textContent = t; if (t === S.team) o.selected = true; sel.appendChild(o); });
      drawFilterBar();
      box.innerHTML = bodyHtml(S.data);
      bindBody(box);
    } catch (e) {
      if (my !== S.seq) return;
      box.innerHTML = '<div class="wr-msg" style="color:#d03030">불러오기 실패: ' + esc((e && e.data && e.data.message) || e.message || e) + '</div>';
    } finally { box.classList.remove('wpa-loading'); }
  }

  /* ─── 거르기 막대 — 업체 · 프로젝트 · 인원 · 분야 + 고른 것 칩 + ⭐ 조합 ─── */
  var AXES = [['clients', '🏢 업체'], ['projects', '📁 프로젝트'], ['members', '👤 인원'], ['sections', '🧩 분야']];
  function labelOf(axis, v) { return axis === 'projects' ? v.replace('|', ' · ') : axis === 'sections' ? (SEC[v] || v) : v; }
  function drawFilterBar() {
    var bar = $('wpaFbar'); if (!bar) return;
    var f = S.filter, sets = lsGet(LS_SETS, []);
    var chips = [];
    AXES.forEach(function (a) { f[a[0]].forEach(function (v) { chips.push('<span class="wpa-chip">' + a[1].split(' ')[0] + ' ' + esc(labelOf(a[0], v)) + '<button type="button" data-fdel="' + a[0] + '" data-v="' + esc(v) + '" title="빼기">✕</button></span>'); }); });
    bar.innerHTML = AXES.map(function (a) {
      var n = f[a[0]].length;
      return '<button type="button" class="btn btn-g btn-s wpa-fbtn' + (n ? ' on' : '') + (S.pop === a[0] ? ' open' : '') + '" data-fopen="' + a[0] + '">' + a[1] + (n ? ' <b>' + n + '</b>' : '') + ' ▾</button>';
    }).join('')
      + (chips.length ? '<span class="wpa-chips">' + chips.join('') + '<button type="button" class="btn btn-g btn-s" data-fclear>모두 지우기</button></span>' : '<span class="wpa-hint">고르지 않으면 전체 — 축끼리는 「그리고」, 한 축 안에서는 「또는」</span>')
      + '<span style="flex:1"></span>'
      + '<select class="wr-inp wpa-sets" id="wpaSets" title="저장한 조합 불러오기"><option value="">⭐ 저장한 조합' + (sets.length ? ' (' + sets.length + ')' : '') + '</option>'
      +   sets.map(function (x, i) { return '<option value="' + i + '">' + esc(x.name) + '</option>'; }).join('')
      +   (sets.length ? '<option value="__del">🗑 저장한 조합 지우기…</option>' : '') + '</select>'
      + '<button type="button" class="btn btn-g btn-s" id="wpaSave" title="지금 고른 업체 · 프로젝트 · 인원 · 분야 · 기간을 이름 붙여 저장 (이 브라우저)">⭐ 조합 저장</button>';
    bar.querySelectorAll('[data-fopen]').forEach(function (b) { b.addEventListener('click', function () { openPop(b.dataset.fopen); }); });
    bar.querySelectorAll('[data-fdel]').forEach(function (b) {
      b.addEventListener('click', function () { var a = b.dataset.fdel; S.filter[a] = S.filter[a].filter(function (x) { return x !== b.dataset.v; }); remember(); drawFilterBar(); run(); });
    });
    var cl = bar.querySelector('[data-fclear]'); if (cl) cl.addEventListener('click', function () { S.filter = emptyFilter(); remember(); drawFilterBar(); run(); });
    $('wpaSave').addEventListener('click', saveSet);
    $('wpaSets').addEventListener('change', async function () {
      var v = this.value; this.value = '';
      var list = lsGet(LS_SETS, []);
      if (v === '__del') {
        var nm = await wmPrompt('지울 조합 이름 (' + list.map(function (x) { return x.name; }).join(', ') + ')', '');
        if (nm == null) return;
        lsSet(LS_SETS, list.filter(function (x) { return x.name !== nm.trim(); })); drawFilterBar(); return;
      }
      var x = list[+v]; if (!x) return;
      S.filter = Object.assign(emptyFilter(), x.filter); S.team = x.team || ''; S.weeks = x.weeks || S.weeks; S.from = x.from || ''; S.to = x.to || '';
      var t = $('wpaTeam'); if (t) t.value = S.team;
      remember(); window.wrPaRender($('wpaBody').closest('.wpa').parentNode);
    });
  }
  async function saveSet() {
    var f = S.filter, auto = AXES.map(function (a) { return f[a[0]].map(function (v) { return labelOf(a[0], v); }).join('+'); }).filter(Boolean).join(' / ') || '전체';
    var nm = await wmPrompt('이 조합의 이름', auto.slice(0, 40)); if (!nm || !nm.trim()) return;
    var list = lsGet(LS_SETS, []).filter(function (x) { return x.name !== nm.trim(); });
    list.unshift({ name: nm.trim(), filter: f, team: S.team, weeks: S.weeks, from: S.from, to: S.to });
    lsSet(LS_SETS, list.slice(0, 20));
    drawFilterBar();
    if (typeof showToast === 'function') showToast('⭐ 「' + nm.trim() + '」 조합을 저장했습니다', 'ok');
  }
  function openPop(axis) {
    var p = $('wpaPop'), d = S.data;
    if (S.pop === axis) { p.hidden = true; S.pop = null; drawFilterBar(); return; }
    S.pop = axis; drawFilterBar();
    var opts = !d ? [] : axis === 'clients' ? d.options.clients.map(function (c) { return { v: c.name, l: c.name, n: c.n }; })
      : axis === 'members' ? d.options.members.map(function (m) { return { v: m.name, l: m.name, n: m.n }; })
      : axis === 'projects' ? d.options.projects.map(function (x) { return { v: x.key, l: x.client + ' · ' + x.name, n: x.n }; })
      : ['dev', 'setup', 'cs', 'etc'].map(function (k) { return { v: k, l: SEC[k] }; });
    var sel = {}; S.filter[axis].forEach(function (v) { sel[v] = true; });
    p.hidden = false;
    p.innerHTML = '<div class="wpa-pop-h"><input type="search" class="wr-inp" id="wpaPopQ" placeholder="찾기" autocomplete="off">'
      + '<button type="button" class="btn btn-g btn-s" data-pall>보이는 것 모두</button><button type="button" class="btn btn-g btn-s" data-pnone>해제</button></div>'
      + '<div class="wpa-pop-l" id="wpaPopL"></div>'
      + '<div class="wpa-pop-f"><span class="wpa-hint">여러 개 고르면 「또는」</span><span style="flex:1"></span><button type="button" class="wm-pri" data-papply>적용</button></div>';
    function draw() {
      var q = ($('wpaPopQ').value || '').toLowerCase();
      var list = opts.filter(function (o) { return !q || o.l.toLowerCase().indexOf(q) >= 0; });
      $('wpaPopL').innerHTML = list.length ? list.map(function (o) {
        return '<label class="wpa-opt"><input type="checkbox" value="' + esc(o.v) + '"' + (sel[o.v] ? ' checked' : '') + '><span>' + esc(o.l) + '</span>' + (o.n != null ? '<small>' + o.n + '</small>' : '') + '</label>';
      }).join('') : '<div class="wpa-hint" style="padding:8px">' + (opts.length ? '찾는 것이 없습니다' : '이 기간에 고를 것이 없습니다') + '</div>';
      return list;
    }
    var shown = draw();
    $('wpaPopQ').addEventListener('input', function () { shown = draw(); });
    $('wpaPopQ').focus();
    $('wpaPopL').addEventListener('change', function (e) { var c = e.target; if (c.checked) sel[c.value] = true; else delete sel[c.value]; });
    p.querySelector('[data-pall]').addEventListener('click', function () { shown.forEach(function (o) { sel[o.v] = true; }); shown = draw(); });
    p.querySelector('[data-pnone]').addEventListener('click', function () { sel = {}; shown = draw(); });
    p.querySelector('[data-papply]').addEventListener('click', function () {
      S.filter[axis] = Object.keys(sel); remember(); p.hidden = true; S.pop = null; drawFilterBar(); run();
    });
  }
  function addFilter(axis, v) {
    if (S.filter[axis].indexOf(v) < 0) S.filter[axis].push(v);
    remember(); drawFilterBar(); run();
    if (typeof showToast === 'function') showToast('거르기에 넣음: ' + labelOf(axis, v), 'info');
  }

  /* ─── 본문 ─── */
  function bodyHtml(d) {
    var k = d.kpi;
    if (!d.range.weeks.length) {
      return '<div class="wr-msg wr-box">비교할 주가 없습니다 — 계획(그 주 보고서의 금주 칸)과 실적(다음 주 보고서의 지난주 칸)이 둘 다 저장된 주부터 셉니다.'
        + (d.range.pending.length ? '<br>실적 보고를 기다리는 주: ' + d.range.pending.map(md).join(', ') : '') + '</div>';
    }
    var filtered = AXES.some(function (a) { return S.filter[a[0]].length; });
    return '<div class="wpa-head">' + md(d.range.from) + ' ~ ' + md(d.range.to) + ' 주 · <b>' + d.range.weeks.length + '주</b> 비교'
        + (d.range.pending.length ? ' <span class="wpa-hint">(실적 보고 대기: ' + d.range.pending.map(md).join(', ') + ')</span>' : '')
        + (filtered ? ' · <span class="wpa-on">거른 결과</span>' : '') + '</div>'
      + (!k.planned && !k.unplanned ? '<div class="wr-msg wr-box">이 조합에 해당하는 계획 · 실적이 없습니다 — 거르기를 넓혀 보세요</div>' : '')
      + kpiHtml(k, d.capacity)
      + diagHtml(d.diagnostics)
      + '<div class="wpa-grid2">'
      +   '<section class="wpa-card"><h4>주별 이행률 · 완료율 · 계획 외 <span class="wpa-hint">— 점에 마우스</span></h4>' + rateChart(d.weekly) + '</section>'
      +   '<section class="wpa-card"><h4>주별 계획 결과 <span class="wpa-hint">— 계획한 일이 어떻게 됐나 + 계획 외</span></h4>' + stackChart(d.weekly) + '</section>'
      + '</div>'
      + '<section class="wpa-card"><h4>1인 주당 투입 시간 <span class="wpa-hint">— 업무일지 · 기준 ' + d.capacity + 'h 선</span></h4>' + hoursChart(d.weekly, d.capacity) + '</section>'
      + tableHtml('👤 사람별', 'members', d.byMember, true, d.capacity)
      + tableHtml('🏢 업체별', 'clients', d.byClient, false)
      + projectHtml(d.projects)
      + sectionHtml(d.bySection)
      + recordsHtml(d.records);
  }

  function trendArrow(t) {
    if (!t || t[0] == null || t[1] == null) return '';
    var dlt = Math.round((t[1] - t[0]) * 10) / 10;
    if (Math.abs(dlt) < 3) return '<small class="wpa-tr">→ 그대로</small>';
    return '<small class="wpa-tr ' + (dlt > 0 ? 'up' : 'dn') + '" title="앞 절반 ' + t[0] + '% → 뒤 절반 ' + t[1] + '%">' + (dlt > 0 ? '▲ +' : '▼ ') + dlt + '%p</small>';
  }
  function kpiHtml(k, cap) {
    var tr = k.trend || {};
    function tile(label, val, sub, tip, cls) { return '<div class="wpa-kpi' + (cls ? ' ' + cls : '') + '" title="' + esc(tip) + '"><span>' + label + '</span><b>' + val + '</b><small>' + sub + '</small></div>'; }
    return '<div class="wpa-kpis">'
      + tile('이행률', pv(k.execRate), trendArrow(tr.execRate) || '완료 + 진척 + 보고 누락', '계획한 일 중 손을 댄 비율 = (완료 + 진척 + 보고 누락) / 계획', k.execRate != null && k.execRate < 70 ? 'warn' : '')
      + tile('완료율', pv(k.doneRate), trendArrow(tr.doneRate) || '계획 중 끝낸 것', '계획한 일 중 그 주에 끝낸 비율')
      + tile('계획 ' + k.planned + '건', k.done + ' / ' + (k.progressed + k.unreported) + ' / ' + k.stalled + ' / ' + k.missed, '완료 / 진척 / 정체 / 못 함', '계획 결과 — 진척에는 보고 누락 ' + k.unreported + '건 포함', k.missed ? 'warn' : '')
      + tile('계획 외', k.unplanned + '건', '실적 칸의 ' + pv(k.unplannedRate), '실적 칸에만 나온 일 — 실적 칸 전체 대비', k.unplannedRate >= 30 ? 'warn' : '')
      + tile('보고 누락', k.unreported + '건', '업무일지엔 시간 있음', '계획했는데 실적 칸엔 없지만 업무일지에 시간이 있는 일', k.unreported ? 'warn' : '')
      + tile('1인 주당', k.perHeadWeek == null ? '–' : k.perHeadWeek + 'h', k.load == null ? '업무일지 없음' : '기준 ' + cap + 'h의 ' + k.load + '%', '업무일지 시간 / 기록 있는 사람 / 주 (휴가 뺌)', k.load > 105 ? 'warn' : '')
      + tile('투입 시간', k.hours == null ? '–' : k.hours + 'h', k.heads + '명', '이 조합의 업무일지 시간 합')
      + '</div>';
  }
  function diagHtml(list) {
    if (!list || !list.length) return '';
    return '<section class="wpa-card wpa-diag"><h4>🔍 무엇이 모자라나 — 부족 요인 · 개선</h4><div class="wpa-dgrid">' + list.map(function (x) {
      var k = DIAG[x.kind] || ['•', x.kind];
      return '<div class="wpa-d ' + x.level + '"><div class="wpa-dt"><span class="wpa-dk">' + k[0] + ' ' + k[1] + '</span><b>' + esc(x.title) + '</b></div>'
        + '<p>' + esc(x.detail) + '</p>'
        + (x.items && x.items.length ? '<ul>' + x.items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>' : '') + '</div>';
    }).join('') + '</div></section>';
  }

  /* ─── 차트 (SVG · 한 축 · 마우스 올리면 값) ─── */
  var CW = 560, CH = 190, PL = 40, PR = 40, PT = 12, PB = 26;
  // 주마다 같은 너비의 칸 · 점과 막대는 칸 가운데 (양 끝 막대가 축 글자를 가리지 않게)
  function band(n) { return (CW - PL - PR) / Math.max(1, n); }
  function xPos(i, n) { return PL + (i + 0.5) * band(n); }
  function axisY(max, unit, fmt) {
    var h = '', steps = 4;
    for (var i = 0; i <= steps; i++) {
      var v = max * i / steps, y = PT + (CH - PT - PB) * (1 - i / steps);
      h += '<line x1="' + PL + '" x2="' + (CW - PR) + '" y1="' + y + '" y2="' + y + '" class="wpa-gl"/><text x="' + (PL - 5) + '" y="' + (y + 3) + '" class="wpa-ax" text-anchor="end">' + (fmt ? fmt(v) : Math.round(v)) + unit + '</text>';
    }
    return h;
  }
  function axisX(weekly) {
    var n = weekly.length, every = Math.ceil(n / 8);
    return weekly.map(function (w, i) { return i % every && i !== n - 1 ? '' : '<text x="' + xPos(i, n) + '" y="' + (CH - 8) + '" class="wpa-ax" text-anchor="middle">' + md(w.week) + '</text>'; }).join('');
  }
  function yPos(v, max) { return PT + (CH - PT - PB) * (1 - v / max); }
  function hoverCols(weekly, tipFn) {
    var n = weekly.length, w = band(n);
    return weekly.map(function (wk, i) {
      return '<rect class="wpa-hit" x="' + (xPos(i, n) - w / 2) + '" y="' + PT + '" width="' + w + '" height="' + (CH - PT - PB) + '" data-tip="' + esc(tipFn(wk)) + '" data-x="' + xPos(i, n) + '"/>';
    }).join('');
  }
  function svgWrap(inner, legend) {
    return '<div class="wpa-chart"><svg viewBox="0 0 ' + CW + ' ' + CH + '" role="img" preserveAspectRatio="xMidYMid meet">' + inner + '<line class="wpa-xh" x1="0" x2="0" y1="' + PT + '" y2="' + (CH - PB) + '" hidden/></svg><div class="wpa-tip" hidden></div></div>'
      + (legend ? '<div class="wpa-leg">' + legend + '</div>' : '');
  }
  function leg(c, l, dash) { return '<span><i style="background:' + c + (dash ? ';height:0;border-top:2px dashed ' + c : '') + '"></i>' + l + '</span>'; }
  function rateChart(weekly) {
    var n = weekly.length;
    var series = [['execRate', '이행률', RES.progressed.c], ['doneRate', '완료율', RES.done.c], ['unplannedRate', '계획 외 비율', RES.unplanned.c]];
    var ends = [];
    var lines = series.map(function (s) {
      var pts = weekly.map(function (w, i) { return w[s[0]] == null ? null : [xPos(i, n), yPos(w[s[0]], 100)]; });
      var d = '', on = false;
      pts.forEach(function (p) { if (!p) { on = false; return; } d += (on ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); on = true; });
      var last = pts.filter(Boolean).pop();
      return '<path d="' + d + '" fill="none" stroke="' + s[2] + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>'
        + pts.map(function (p) { return p ? '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3.5" fill="' + s[2] + '" stroke="var(--bg-p)" stroke-width="2"/>' : ''; }).join('')
        + (last && weekly[n - 1][s[0]] != null ? (ends.push({ x: last[0], y: last[1], v: weekly[n - 1][s[0]], c: s[2] }), '') : '');
    }).join('');
    // 끝 값 표시 — 오른쪽 여백에, 겹치면 12px 씩 벌림
    //   아래(0% 쪽)부터 위로 밀어 올려 축 글자와도 안 겹치게
    ends.sort(function (a, b) { return b.y - a.y; });
    for (var e = 1; e < ends.length; e++) if (ends[e - 1].y - ends[e].y < 12) ends[e].y = ends[e - 1].y - 12;
    lines += ends.map(function (t) { return '<text x="' + (t.x + 8) + '" y="' + (t.y + 3.5) + '" class="wpa-dl">' + t.v + '%</text>'; }).join('');
    var tip = function (w) { return md(w.week) + ' 주 · 계획 ' + w.planned + '건\n이행률 ' + pv(w.execRate) + '\n완료율 ' + pv(w.doneRate) + '\n계획 외 ' + pv(w.unplannedRate) + ' (' + w.unplanned + '건)'; };
    return svgWrap(axisY(100, '%') + axisX(weekly) + lines + hoverCols(weekly, tip), series.map(function (s) { return leg(s[2], s[1]); }).join(''));
  }
  function stackChart(weekly) {
    var n = weekly.length, max = 1;
    weekly.forEach(function (w) { max = Math.max(max, w.planned + w.unplanned); });
    max = Math.ceil(max / 4) * 4 || 4;
    var bw = Math.max(6, Math.min(34, (CW - PL - PR) / n * 0.55));
    var bars = weekly.map(function (w, i) {
      var x = xPos(i, n) - bw / 2, acc = 0, h = '';
      PLAN_KEYS.concat(['unplanned']).forEach(function (k) {
        var v = w[k]; if (!v) return;
        var y0 = yPos(acc, max), y1 = yPos(acc + v, max);
        h += '<rect x="' + x.toFixed(1) + '" y="' + (y1 + 1).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(1, y0 - y1 - 2).toFixed(1) + '" rx="2" fill="' + RES[k].c + '"' + (k === 'unplanned' ? ' fill-opacity=".85"' : '') + '/>';
        acc += v;
      });
      return h;
    }).join('');
    var tip = function (w) { return md(w.week) + ' 주\n' + PLAN_KEYS.concat(['unplanned']).filter(function (k) { return w[k]; }).map(function (k) { return RES[k].l + ' ' + w[k]; }).join('\n'); };
    return svgWrap(axisY(max, '건') + axisX(weekly) + bars + hoverCols(weekly, tip), PLAN_KEYS.concat(['unplanned']).map(function (k) { return '<span title="' + esc(RES[k].tip) + '"><i style="background:' + RES[k].c + '"></i>' + RES[k].l + '</span>'; }).join(''));
  }
  function hoursChart(weekly, cap) {
    var n = weekly.length, max = cap * 1.25;
    weekly.forEach(function (w) { if (w.perHead != null) max = Math.max(max, w.perHead); });
    max = Math.ceil(max / 10) * 10;
    var bw = Math.max(6, Math.min(34, (CW - PL - PR) / n * 0.55));
    var bars = weekly.map(function (w, i) {
      if (w.perHead == null) return '';
      var y = yPos(w.perHead, max), over = w.perHead > cap * 1.1;
      return '<rect x="' + (xPos(i, n) - bw / 2).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(1, yPos(0, max) - y).toFixed(1) + '" rx="3" fill="' + (over ? RES.missed.c : '#0EA5E9') + '"/>';
    }).join('');
    var cy = yPos(cap, max);
    var capLine = '<line x1="' + PL + '" x2="' + (CW - PR) + '" y1="' + cy + '" y2="' + cy + '" stroke="var(--t5)" stroke-dasharray="5 4" stroke-width="1.5"/><text x="' + (CW - PR) + '" y="' + (cy - 4) + '" class="wpa-ax" text-anchor="end">기준 ' + cap + 'h</text>';
    var tip = function (w) { return md(w.week) + ' 주\n1인 ' + (w.perHead == null ? '기록 없음' : w.perHead + 'h (' + w.load + '%)') + '\n' + (w.hours || 0) + 'h · ' + w.heads + '명'; };
    return svgWrap(axisY(max, 'h') + axisX(weekly) + bars + capLine + hoverCols(weekly, tip),
      leg('#0EA5E9', '1인 주당 시간') + leg(RES.missed.c, '기준의 110% 넘음') + leg('var(--t5)', '기준 시간', true));
  }
  function bindCharts(box) {
    box.querySelectorAll('.wpa-chart').forEach(function (ch) {
      var tip = ch.querySelector('.wpa-tip'), xh = ch.querySelector('.wpa-xh'), svg = ch.querySelector('svg');
      ch.querySelectorAll('.wpa-hit').forEach(function (r) {
        function show() {
          tip.textContent = r.getAttribute('data-tip'); tip.hidden = false;
          var x = +r.getAttribute('data-x'); xh.setAttribute('x1', x); xh.setAttribute('x2', x); xh.removeAttribute('hidden');
          var rect = svg.getBoundingClientRect(), px = x / CW * rect.width;
          tip.style.left = Math.max(4, Math.min(rect.width - tip.offsetWidth - 4, px + 12)) + 'px';
        }
        r.addEventListener('mouseenter', show); r.addEventListener('focus', show);
        r.addEventListener('click', show);
        r.addEventListener('mouseleave', function () { tip.hidden = true; xh.setAttribute('hidden', ''); });
      });
    });
  }

  /* ─── 표 ─── */
  function rateBar(v) {
    if (v == null) return '<span class="wpa-hint">–</span>';
    var c = v >= 80 ? RES.done.c : v >= 60 ? RES.progressed.c : RES.unreported.c;
    return '<span class="wpa-rb"><i style="width:' + Math.min(100, v) + '%;background:' + c + '"></i></span><b>' + v + '%</b>';
  }
  function tableHtml(title, axis, rows, people, cap) {
    if (!rows || !rows.length) return '';
    return '<section class="wpa-card"><h4>' + title + ' <span class="wpa-hint">— 이름을 누르면 거르기에 넣음</span></h4><div class="wpa-tw"><table class="wpa-t"><thead><tr>'
      + '<th>' + (people ? '이름' : '업체') + '</th><th title="계획한 일">계획</th>' + PLAN_KEYS.map(function (k) { return '<th title="' + esc(RES[k].tip) + '"><i class="wpa-dot" style="background:' + RES[k].c + '"></i>' + RES[k].l + '</th>'; }).join('')
      + '<th title="' + esc(RES.unplanned.tip) + '"><i class="wpa-dot" style="background:' + RES.unplanned.c + '"></i>계획 외</th><th>이행률</th><th>완료율</th><th>시간</th>' + (people ? '<th title="기록 있는 주 평균">주당</th><th title="기준 ' + cap + 'h 대비">부하</th>' : '')
      + '</tr></thead><tbody>' + rows.map(function (r) {
        var hot = people && r.load != null && r.load > 110;
        return '<tr' + (hot ? ' class="hot"' : '') + '><td><button type="button" class="wpa-link" data-add="' + axis + '" data-v="' + esc(r.key) + '">' + esc(r.key) + '</button></td><td>' + r.planned + '</td>'
          + PLAN_KEYS.map(function (k) { return '<td class="n' + (r[k] ? '' : ' z') + '">' + r[k] + '</td>'; }).join('')
          + '<td class="n' + (r.unplanned ? '' : ' z') + '">' + r.unplanned + '</td><td class="wpa-rc">' + rateBar(r.execRate) + '</td><td>' + pv(r.doneRate) + '</td><td>' + (r.hours || 0) + 'h</td>'
          + (people ? '<td>' + (r.perWeek == null ? '–' : r.perWeek + 'h') + '</td><td>' + (r.load == null ? '–' : (hot ? '🔥 ' : '') + r.load + '%') + '</td>' : '') + '</tr>';
      }).join('') + '</tbody></table></div></section>';
  }
  var STATE = { overdue: ['납기 지남', 'bad'], at_risk: ['뒤처짐', 'warn'], stalled: ['정체', 'warn'], on_track: ['순조', 'ok'], open: ['진행', ''], done: ['완료', 'ok'], done_late: ['늦게 완료', 'warn'], dropped: ['사라짐', 'bad'] };
  function projectHtml(list) {
    if (!list || !list.length) return '';
    return '<section class="wpa-card"><h4>📁 프로젝트 — 진척 속도 vs 필요 속도 <span class="wpa-hint">— 진행률 · 납기가 있는 일 · 이름을 누르면 거르기</span></h4><div class="wpa-tw"><table class="wpa-t"><thead><tr>'
      + '<th>업체 · 일</th><th>진행률</th><th title="납기까지 일정대로라면 지금 있어야 할 진행률">일정상</th><th title="주당 진행률 증가 (처음 → 지금)">주당 속도</th><th title="남은 진행률 / 남은 주">필요 속도</th><th>납기</th><th title="납기를 미룬 횟수">연기</th><th>계획 이행</th><th>상태</th>'
      + '</tr></thead><tbody>' + list.map(function (p) {
        var st = STATE[p.state] || [p.state, ''];
        var slow = p.velocity != null && p.needPerWeek != null && p.velocity < p.needPerWeek;
        return '<tr><td><button type="button" class="wpa-link" data-add="projects" data-v="' + esc(p.client + '|' + p.name) + '">' + esc(p.client) + ' · ' + esc(p.name) + '</button></td>'
          + '<td class="wpa-rc">' + (p.pct == null ? '–' : '<span class="wpa-rb"><i style="width:' + p.pct + '%;background:' + RES.progressed.c + '"></i></span><b>' + p.pct + '%</b>') + '</td>'
          + '<td>' + pv(p.expected) + '</td><td class="' + (slow ? 'bad' : '') + '">' + (p.velocity == null ? '–' : '+' + p.velocity) + '</td><td>' + (p.needPerWeek == null ? '–' : '+' + p.needPerWeek) + '</td>'
          + '<td>' + (p.deadline ? md(p.deadline) + (p.weeksLeft != null ? ' <small>(' + p.weeksLeft + '주)</small>' : '') : '–') + '</td><td>' + (p.slips || '') + '</td>'
          + '<td>' + rateBar(p.plan.execRate) + '</td><td><span class="wpa-st ' + st[1] + '">' + st[0] + '</span></td></tr>';
      }).join('') + '</tbody></table></div></section>';
  }
  function sectionHtml(list) {
    if (!list || !list.length) return '';
    return '<section class="wpa-card"><h4>🧩 분야별</h4><div class="wpa-secs">' + list.map(function (s) {
      return '<button type="button" class="wpa-sec" data-add="sections" data-v="' + s.key + '"><b>' + esc(s.label) + '</b><span>계획 ' + s.planned + ' · 계획 외 ' + s.unplanned + ' · ' + (s.hours || 0) + 'h</span>' + rateBar(s.execRate) + '</button>';
    }).join('') + '</div></section>';
  }
  function recordsHtml(list) {
    if (!list || !list.length) return '';
    var cnt = {}; list.forEach(function (r) { cnt[r.res] = (cnt[r.res] || 0) + 1; });
    var rows = S.recRes ? list.filter(function (r) { return r.res === S.recRes; }) : list;
    return '<details class="wpa-card wpa-recs"' + (S.recRes ? ' open' : '') + '><summary><h4>📋 계획 ↔ 실적 기록 ' + list.length + '건 <span class="wpa-hint">— 펼쳐서 하나하나</span></h4></summary>'
      + '<div class="wpa-rf"><button type="button" class="btn btn-g btn-s' + (!S.recRes ? ' on' : '') + '" data-rres="">전체</button>'
      + PLAN_KEYS.concat(['unplanned']).filter(function (k) { return cnt[k]; }).map(function (k) { return '<button type="button" class="btn btn-g btn-s' + (S.recRes === k ? ' on' : '') + '" data-rres="' + k + '"><i class="wpa-dot" style="background:' + RES[k].c + '"></i>' + RES[k].l + ' ' + cnt[k] + '</button>'; }).join('') + '</div>'
      + '<div class="wpa-tw"><table class="wpa-t"><thead><tr><th>주</th><th>결과</th><th>업체</th><th>일</th><th>담당</th><th>진행률</th><th>분야</th></tr></thead><tbody>'
      + rows.slice(0, 400).map(function (r) {
        return '<tr><td>' + md(r.w) + '</td><td><span class="wpa-res" style="--c:' + RES[r.res].c + '">' + RES[r.res].l + '</span>' + (r.hours ? ' <small>' + r.hours + 'h</small>' : '') + '</td>'
          + '<td>' + esc(r.client) + '</td><td>' + esc(r.name) + (r.planName && r.planName !== r.name ? ' <small class="wpa-hint">(계획: ' + esc(r.planName) + ')</small>' : '') + '</td>'
          + '<td>' + esc(r.members.join('·')) + '</td><td>' + (r.pctFrom == null && r.pctTo == null ? '' : (r.pctFrom == null ? '–' : r.pctFrom) + ' → ' + (r.pctTo == null ? '–' : r.pctTo) + '%') + '</td><td>' + (SEC[r.section] || '') + '</td></tr>';
      }).join('') + '</tbody></table>' + (rows.length > 400 ? '<div class="wpa-hint" style="padding:6px">처음 400건만 — 전체는 ⬇ CSV</div>' : '') + '</div></details>';
  }

  function bindBody(box) {
    bindCharts(box);
    box.querySelectorAll('[data-add]').forEach(function (b) { b.addEventListener('click', function () { addFilter(b.dataset.add, b.dataset.v); }); });
    box.querySelectorAll('[data-rres]').forEach(function (b) {
      b.addEventListener('click', function () { S.recRes = b.dataset.rres; var d = box.querySelector('.wpa-recs'); d.outerHTML = recordsHtml(S.data.records); bindBody(box); box.querySelector('.wpa-recs').open = true; });
    });
  }

  function downloadCsv() {
    var d = S.data; if (!d || !d.records) return;
    var head = ['주', '결과', '팀', '업체', '일', '계획 때 이름', '담당', '분야', '진행률(계획)', '진행률(실적)', '납기', '업무일지 시간'];
    var lines = [head].concat(d.records.map(function (r) {
      return [r.w, RES[r.res].l, r.team, r.client, r.name, r.planName, r.members.join('·'), SEC[r.section] || r.section, r.pctFrom == null ? '' : r.pctFrom, r.pctTo == null ? '' : r.pctTo, r.deadline, r.hours || ''];
    })).map(function (row) { return row.map(function (c) { c = String(c == null ? '' : c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); });
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = '계획대비실적_' + (d.query.from || '') + '_' + (d.query.to || '') + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
})();
