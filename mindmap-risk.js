/* mindmap-risk.js — 리스크 점검 (v13.243)
 * 규칙 점검(AI 없이): 지연 · 담당 없음 · 마감 없음 · 한 사람에게 몰림 · 하위 마감이 상위보다 늦음 · 선후 관계 역전 · 진척 정체(지난 기록 대비).
 * AI 가 설정돼 있으면 점검 결과 + 맵 개요로 위험 요약 · 대응 제안을 받는다 (/api/mindmaps/ai action 'risk').
 * 진입: 거르기 막대의 [🩺 점검] · 명령 찾기 riskCheck.
 */
var MM_RISK_KINDS = [
  { k: 'late', l: '지연', sev: 3 }, { k: 'reverse', l: '선후 관계 역전', sev: 2 }, { k: 'parentdue', l: '하위 마감이 상위보다 늦음', sev: 2 },
  { k: 'stuck', l: '진척 정체 (지난 기록 이후 그대로)', sev: 2 }, { k: 'overload', l: '한 사람에게 몰림', sev: 2 },
  { k: 'noowner', l: '담당 없음', sev: 1 }, { k: 'nodue', l: '마감 없음', sev: 1 }
];
var MM_RISK_LOAD = { open: 8, week: 4 };   // 몰림 기준: 진행 중 8개 이상 또는 이번 주 마감 4개 이상

function _mmRiskDays(a, b) {   // b - a (일)
  return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000);
}
function _mmRiskText(n) { return String(n.text || '').split('\n')[0].trim() || '(빈 주제)'; }

/**
 * 규칙 점검 (순수). facts = mmTaskFacts, prog = _mmProgressMap, relations = 시트 관계선, today 'YYYY-MM-DD',
 * old = { prog, days } (지난 기록의 진행률 표 · 며칠 전인지) 또는 null
 * 반환 [{ kind, id(주제 · 사람이면 null), text, detail }]
 */
function mmRiskFindings(root, facts, prog, relations, today, old) {
  var out = [];
  var byId = {};
  mmWalk(root, function (n, parent, depth) {
    byId[n.id] = n;
    if (!depth) return;
    var f = facts[n.id];
    if (!f) return;
    var t = _mmRiskText(n);
    if (f.late) out.push({ kind: 'late', id: n.id, text: t, detail: '마감 ' + n.dueDate.slice(5) + ' · ' + (-_mmRiskDays(today, n.dueDate)) + '일 지남' + (f.who ? ' · ' + f.who : '') });
    var leaf = !(n.children || []).length;
    if (leaf && !f.done && !f.who && (n.startDate || n.dueDate || (prog[n.id] && prog[n.id].own))) out.push({ kind: 'noowner', id: n.id, text: t, detail: n.dueDate ? '마감 ' + n.dueDate.slice(5) : '일정 · 진행률은 있음' });
    if (leaf && !f.done && f.who && !n.dueDate) out.push({ kind: 'nodue', id: n.id, text: t, detail: f.who });
    if (parent && depth > 1 && n.dueDate && parent.dueDate && n.dueDate > parent.dueDate && !f.done)
      out.push({ kind: 'parentdue', id: n.id, text: t, detail: n.dueDate.slice(5) + ' > 상위 「' + _mmRiskText(parent) + '」 ' + parent.dueDate.slice(5) });
    if (old && old.prog && prog[n.id] && prog[n.id].own && old.prog[n.id] && old.prog[n.id].own && !f.done &&
        prog[n.id].p === old.prog[n.id].p && n.dueDate && _mmRiskDays(today, n.dueDate) <= 14)
      out.push({ kind: 'stuck', id: n.id, text: t, detail: prog[n.id].p + '% 그대로 · ' + old.days + '일 전 기록 대비 · 마감 ' + n.dueDate.slice(5) });
  });
  (relations || []).forEach(function (r) {
    var a = byId[r.from], b = byId[r.to];
    if (!a || !b) return;
    var bStart = b.startDate || b.dueDate;
    if (a.dueDate && bStart && a.dueDate > bStart && !(facts[a.id] && facts[a.id].done))
      out.push({ kind: 'reverse', id: b.id, text: _mmRiskText(a) + ' → ' + _mmRiskText(b), detail: '앞 작업 마감 ' + a.dueDate.slice(5) + ' > 뒤 작업 시작 ' + bStart.slice(5) });
  });
  var load = {};
  Object.keys(facts).forEach(function (id) {
    var f = facts[id];
    if (!f.task || !f.who || f.done) return;
    var s = load[f.who] || (load[f.who] = { open: 0, week: 0 });
    s.open++;
    if (f.week) s.week++;
  });
  Object.keys(load).forEach(function (w) {
    var s = load[w];
    if (s.open >= MM_RISK_LOAD.open || s.week >= MM_RISK_LOAD.week) out.push({ kind: 'overload', id: null, who: w, text: w, detail: '진행 중 ' + s.open + '개 · 이번 주 마감 ' + s.week + '개' });
  });
  var order = {};
  MM_RISK_KINDS.forEach(function (k, i) { order[k.k] = i; });
  return out.sort(function (x, y) { return order[x.kind] - order[y.kind]; });
}

/* ═══ 화면 ═══ */
function _mmRiskToday() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function mmRiskModal() {
  if (!_mm.doc) return;
  return wmGuardedModal('mmRisk', function () {
    var root = _mmRoot(), sheetId = _mmSheet().id;
    var prog = _mmProgressMap(root);
    var facts = mmTaskFacts(root, prog, _mmRiskToday());
    // 진척 정체는 6일 이상 지난 기록과 비교 (없으면 그 점검만 빠짐)
    var oldP = apiFetch('/api/mindmaps/' + encodeURIComponent(_mm.mapId) + '/snapshots').then(function (r) {
      var list = (r && r.data) || [];
      var cut = Date.now() - 6 * 86400000;
      var s = list.filter(function (x) { return new Date(x.created_at).getTime() <= cut; })[0];
      if (!s) return null;
      return apiFetch('/api/mindmaps/' + encodeURIComponent(_mm.mapId) + '/snapshots/' + encodeURIComponent(s.id)).then(function (x) {
        var sh = ((x.data.doc || {}).sheets || []).filter(function (q) { return q.id === sheetId; })[0];
        return sh && sh.root ? { prog: _mmProgressMap(sh.root), days: Math.round((Date.now() - new Date(s.created_at).getTime()) / 86400000) } : null;
      });
    }).catch(function () { return null; });
    return oldP.then(function (old) {
      var list = mmRiskFindings(root, facts, prog, _mmSheet().relations || [], _mmRiskToday(), old);
      _mm.riskList = list;
      var groups = MM_RISK_KINDS.map(function (k) {
        var its = list.filter(function (x) { return x.kind === k.k; });
        if (!its.length) return '';
        return '<details class="mm-risk-g mm-risk-sev' + k.sev + '"' + (k.sev >= 2 ? ' open' : '') + '><summary>' + k.l + ' <b>' + its.length + '</b></summary>' +
          its.map(function (x) {
            return '<button class="mm-risk-row" ' + (x.id ? 'data-risk-node="' + _mmEsc(x.id) + '"' : 'data-risk-who="' + _mmEsc(x.who) + '"') + '>' +
              '<span>' + _mmEsc(x.text) + '</span><span class="mm-hint">' + _mmEsc(x.detail) + '</span></button>';
          }).join('') + '</details>';
      }).join('');
      var html = '<div class="mm-form mm-risk">' +
        '<div class="mm-risk-sum">' + (list.length ? '살펴볼 것 <b>' + list.length + '</b>개' : '✅ 규칙 점검에서 걸린 것이 없습니다') +
        (old ? '' : ' <span class="mm-hint">· 진척 정체는 6일 넘은 버전 기록이 있어야 봅니다</span>') + '</div>' +
        groups +
        (_mm.aiReady ? '<div class="mm-risk-ai"><button class="btn btn-p btn-s" id="mmRiskAi">✨ AI 의견 받기</button><span class="mm-hint">점검 결과와 맵 개요로 위험 요약 · 대응 제안</span><div id="mmRiskAiOut"></div></div>' : '') +
        '</div>';
      var md = createModal({ id: 'mmRiskModal', title: '🩺 리스크 점검', html: html, width: '620px', closeOnEsc: true });
      var box = _mmEl('mmRiskModal');
      box.addEventListener('click', function (e) {
        var r = e.target.closest('[data-risk-node],[data-risk-who]');
        if (!r) return;
        if (r.hasAttribute('data-risk-node')) {
          var id = r.getAttribute('data-risk-node');
          var f = mmFind(_mmRoot(), id), opened = false;
          while (f && f.parent) { if (f.parent.collapsed) { f.parent.collapsed = false; opened = true; } f = mmFind(_mmRoot(), f.parent.id); }
          if (opened) { _mmPaint(); if (!_mm.readOnly) _mmMarkDirty(); }
          md.close();   // 창이 지도를 가리지 않게 — 다시 보려면 [🩺 점검]
          _mmSelect(id);
        } else if (typeof _mmVf === 'function') {
          var vf = _mmVf(); vf.who = r.getAttribute('data-risk-who'); vf.st = null; vf.idx = -1; md.close(); _mmPaint();
        }
      });
      var aiBtn = _mmEl('mmRiskAi');
      if (aiBtn) aiBtn.onclick = function () {
        aiBtn.disabled = true; aiBtn.textContent = '✨ 살펴보는 중…';
        var findings = list.slice(0, 60).map(function (x) {
          var k = MM_RISK_KINDS.filter(function (q) { return q.k === x.kind; })[0];
          return '- [' + k.l + '] ' + x.text + ' — ' + x.detail;
        }).join('\n');
        apiFetch('/api/mindmaps/ai', { method: 'POST', timeoutMs: 60000, body: JSON.stringify({ action: 'risk', mapId: _mm.mapId, outline: mmToMarkdown(root).slice(0, 12000), findings: findings, today: _mmRiskToday() }) })
          .then(function (r) {
            var d = r.data || {};
            _mmEl('mmRiskAiOut').innerHTML = (d.summary ? '<p class="mm-risk-aisum">' + _mmEsc(d.summary) + '</p>' : '') +
              (d.risks || []).map(function (x) {
                return '<div class="mm-risk-aiitem"><b>' + _mmEsc(x.title) + '</b><div>' + _mmEsc(x.why || '') + '</div>' + (x.action ? '<div class="mm-risk-act">→ ' + _mmEsc(x.action) + '</div>' : '') + '</div>';
              }).join('');
            aiBtn.textContent = '✨ 다시 받기'; aiBtn.disabled = false;
          })
          .catch(function (e) { _mmToast('❌ AI 의견 실패 — ' + _mmErr(e), 'error'); aiBtn.textContent = '✨ AI 의견 받기'; aiBtn.disabled = false; });
      };
    });
  }, 'mmRiskModal');
}

if (typeof module !== 'undefined') module.exports = { mmRiskFindings: mmRiskFindings };
