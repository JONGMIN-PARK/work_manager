/* ═══════════════════════════════════════════════════════════════════════
   project-meetings.js — 프로젝트 상세 "회의" 탭 (v13.198, project-detail.js 에서 분리·재구성)
   ─────────────────────────────────────────────────────────────────────
   · 요약: 회의 수 · 미완료 액션 · 기한 지난 액션 + 미완료 액션 모아보기(전체 회의)
   · 회의 카드 = 회의록 양식: 기본 정보 · 안건(체크) · 논의 내용 · 결정 사항 · 액션 아이템 · 다음 회의
   · 미리 보기(서버가 만든 회의록 문서) → 인쇄/PDF · 메일 보내기(참석자 계정 메일 + 직접 입력)
   · 변경은 그 회의 카드만 다시 그린다 — 다른 회의에 쓰던 회의록 초안이 지워지지 않게(초안은 _pmt.drafts)
   서버: /api/meetings (title, meetDate, agenda[], attendees[], minutes / actions: title, assigneeName, dueDate, status)
   전역 의존: apiFetch, toCamel, eH, showToast, localDate, window._pdProj(담당자 추천)
   ═══════════════════════════════════════════════════════════════════════ */

var _pmt = null;   // { projId, list, open:{mid:true}, drafts:{mid:{field:value}}, filter:'all'|'upcoming'|'past', showActs, adding }

function _pmtEsc(s) { return (typeof eH === 'function') ? eH(s == null ? '' : String(s)) : String(s == null ? '' : s); }
function _pmtJs(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
function _pmtToast(m, t) { if (typeof showToast === 'function') showToast(m, t); }
function _pmtErr(e, d) { return (e && e.data && e.data.message) || (e && e.message) || d; }
function _pmtToday() { return (typeof localDate === 'function') ? localDate() : new Date().toISOString().slice(0, 10); }
function _pmtDate(d) { return d ? String(d).slice(0, 10) : ''; }

/* ── 데이터 ─────────────────────────────────────────────────────────────── */
function _pmtNorm(m) {
  var c = toCamel(m);
  c.meetDate = _pmtDate(c.meetDate);
  c.actionItems = (m.action_items || m.actionItems || []).map(function (a) { var x = toCamel(a); x.dueDate = _pmtDate(x.dueDate); return x; });
  c.form = (c.form && typeof c.form === 'object') ? c.form : {};
  c.attendees = Array.isArray(c.attendees) ? c.attendees.filter(Boolean).map(String) : [];
  // 안건: 예전 데이터는 문자열 배열일 수 있다 → { text, done }
  c.agenda = (Array.isArray(c.agenda) ? c.agenda : []).map(function (g) {
    return typeof g === 'string' ? { text: g, done: false, note: '', result: '' }
      : { text: String((g && g.text) || ''), done: !!(g && g.done), note: String((g && g.note) || ''), result: String((g && g.result) || '') };
  }).filter(function (g) { return g.text; });
  return c;
}
function _pmtFind(mid) { return (_pmt.list || []).filter(function (m) { return String(m.id) === String(mid); })[0]; }
function _pmtReplace(m) { _pmt.list = _pmt.list.map(function (x) { return String(x.id) === String(m.id) ? m : x; }); }
/* 회의 한 건 새로 받기 (액션 포함) */
function _pmtRefetch(mid) {
  return apiFetch('/api/meetings/' + encodeURIComponent(mid)).then(function (r) { var m = _pmtNorm(r.data); _pmtReplace(m); return m; });
}

/* ═══ 진입점 — pdSwitchTab('meeting') ═══ */
function pdLoadMeetings(projId) {
  var el = document.getElementById('pdMeeting'); if (!el) return;
  var keep = (_pmt && _pmt.projId === projId) ? _pmt : null;   // 같은 프로젝트면 펼침·초안 유지
  _pmt = keep || { projId: projId, list: [], open: {}, drafts: {}, filter: 'all', showActs: false, adding: false, editing: {}, docs: {}, docLoading: {}, firstOpenDone: false };
  el.innerHTML = '<div style="color:var(--t6);font-size:11px;padding:10px 0">로딩 중...</div>';
  apiFetch('/api/meetings?projectId=' + encodeURIComponent(projId)).then(function (r) {
    if (!_pmt || _pmt.projId !== projId) return;
    _pmt.list = ((r && r.data) || []).map(_pmtNorm);
    if (!_pmt.firstOpenDone) {   // 처음 열 때: 오늘 이후 가장 가까운 회의, 없으면 가장 최근 회의 하나만 펼침
      var t = _pmtToday();
      var next = _pmt.list.filter(function (m) { return m.meetDate && m.meetDate >= t; }).sort(function (a, b) { return a.meetDate.localeCompare(b.meetDate); })[0];
      var pick = next || _pmt.list[0];
      if (pick) _pmt.open[pick.id] = true;
      _pmt.firstOpenDone = true;
    }
    pdRenderMeetings();
  }).catch(function (e) {
    el.innerHTML = '<div style="color:var(--t6);font-size:11px;padding:10px 0">회의 목록을 불러오지 못했습니다. <button class="btn btn-g btn-s" style="font-size:10px" onclick="pdLoadMeetings(\'' + _pmtJs(projId) + '\')">다시 시도</button></div>';
    console.warn('[pdLoadMeetings]', e);
  });
}

/* ═══ 렌더 ═══ */
function pdRenderMeetings() {
  var el = document.getElementById('pdMeeting'); if (!el || !_pmt) return;
  var t = _pmtToday();
  var all = _pmt.list;
  var acts = [];
  all.forEach(function (m) { (m.actionItems || []).forEach(function (a) { if (a.status !== 'done') acts.push({ m: m, a: a }); }); });
  var overdue = acts.filter(function (x) { return x.a.dueDate && x.a.dueDate < t; }).length;
  var list = all.filter(function (m) {
    if (_pmt.filter === 'upcoming') return m.meetDate && m.meetDate >= t;
    if (_pmt.filter === 'past') return !m.meetDate || m.meetDate < t;
    return true;
  });
  var h = _pmtPeopleDatalistTop();
  // 요약 + 새 회의
  h += '<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:6px;margin-bottom:8px">' +
    '<span id="pmtSummary" style="font-size:11px;color:var(--t4)">' + _pmtSummaryHtml(all.length, acts.length, overdue) + '</span>' +
    '<span style="display:flex;gap:4px">' +
      (acts.length ? '<button class="btn btn-g btn-s" style="font-size:10px" onclick="pmtToggleActs()">' + (_pmt.showActs ? '▾' : '▸') + ' 미완료 액션 모아보기</button>' : '') +
      '<button class="btn btn-p btn-s" style="font-size:10px" onclick="pmtToggleAdd()">+ 새 회의</button>' +
    '</span></div>';
  if (_pmt.adding) h += _pmtAddFormHtml();
  if (_pmt.showActs && acts.length) h += _pmtAllActsHtml(acts, t);
  // 필터
  if (all.length) {
    h += '<div style="display:flex;gap:4px;margin:4px 0 8px">' + [['all', '전체'], ['upcoming', '예정'], ['past', '지난 회의']].map(function (f) {
      var on = _pmt.filter === f[0];
      return '<button class="btn btn-s" onclick="pmtSetFilter(\'' + f[0] + '\')" style="font-size:10px;padding:2px 9px;border:1px solid ' + (on ? 'var(--ac)' : 'var(--bd)') + ';background:' + (on ? 'var(--ac-bg, var(--bg-i))' : 'transparent') + ';color:' + (on ? 'var(--t1)' : 'var(--t4)') + ';font-weight:' + (on ? 700 : 400) + '">' + f[1] + '</button>';
    }).join('') + '</div>';
  }
  if (!all.length) h += '<div style="font-size:11px;color:var(--t6);padding:14px 0;text-align:center">등록된 회의가 없습니다. "+ 새 회의"로 추가하세요. 날짜를 넣으면 캘린더에도 일정이 등록됩니다.</div>';
  else if (!list.length) h += '<div style="font-size:11px;color:var(--t6);padding:8px 0">해당하는 회의가 없습니다.</div>';
  h += list.map(function (m) { return '<div id="pmt-card-' + _pmtEsc(m.id) + '">' + _pmtCardHtml(m, t) + '</div>'; }).join('');
  el.innerHTML = h;
  if (_pmt.adding) { var ti = document.getElementById('pmtNewTitle'); if (ti) ti.focus(); }
}

function _pmtAddFormHtml() {
  return '<div style="border:1px dashed var(--ac);border-radius:8px;padding:8px 10px;margin-bottom:10px">' +
    '<div style="display:flex;gap:4px;flex-wrap:wrap">' +
      '<input id="pmtNewTitle" class="si" placeholder="회의 제목 (예: 설계 검토 회의)" style="flex:2 1 160px;font-size:11px;padding:5px 8px" onkeydown="if(event.key===\'Enter\')pmtCreate();if(event.key===\'Escape\')pmtToggleAdd()">' +
      '<input id="pmtNewDate" type="date" class="si" value="' + _pmtToday() + '" style="flex:0 0 auto;width:auto;font-size:11px;padding:4px">' +
    '</div>' +
    '<input id="pmtNewAtt" class="si" list="pmtPeople" placeholder="참석자 (쉼표로 구분, 선택)" style="width:100%;box-sizing:border-box;font-size:11px;padding:5px 8px;margin-top:4px">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">' +
      '<span style="font-size:9.5px;color:var(--t6)">날짜를 넣으면 캘린더에 회의 일정이 자동 등록됩니다.</span>' +
      '<span style="display:flex;gap:4px"><button class="btn btn-g btn-s" style="font-size:10px" onclick="pmtToggleAdd()">취소</button><button class="btn btn-p btn-s" style="font-size:10px" onclick="pmtCreate()">등록</button></span>' +
    '</div></div>';
}
/* 담당자·참석자 입력 추천 — 프로젝트 담당자 */
function _pmtPeople() {
  var p = window._pdProj;
  var names = (p && Array.isArray(p.assignees)) ? p.assignees.slice() : [];
  (_pmt.list || []).forEach(function (m) { (m.attendees || []).forEach(function (n) { if (names.indexOf(n) < 0) names.push(n); }); });
  return names.filter(Boolean);
}
/* datalist 는 탭 맨 위에 한 번만 (카드를 다시 그려도 남도록) */
function _pmtPeopleDatalistTop() {
  return '<datalist id="pmtPeople">' + _pmtPeople().map(function (n) { return '<option value="' + _pmtEsc(n) + '">'; }).join('') + '</datalist>';
}

function _pmtAllActsHtml(acts, t) {
  acts.sort(function (x, y) { return (x.a.dueDate || '9999').localeCompare(y.a.dueDate || '9999'); });
  return '<div style="border:1px solid var(--bd);border-radius:8px;padding:6px 10px;margin-bottom:10px;background:var(--bg-i)">' +
    acts.map(function (x) {
      var late = x.a.dueDate && x.a.dueDate < t;
      return '<div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:10.5px;border-bottom:1px solid var(--bd)">' +
        '<span style="cursor:pointer" title="완료로 표시" onclick="pmtActToggle(\'' + _pmtJs(x.m.id) + '\',\'' + _pmtJs(x.a.id) + '\',\'done\')">☐</span>' +
        '<span style="flex:1;color:var(--t2);word-break:break-word">' + _pmtEsc(x.a.title) + (x.a.assigneeName ? ' <span style="color:var(--t5)">@' + _pmtEsc(x.a.assigneeName) + '</span>' : '') + '</span>' +
        (x.a.dueDate ? '<span style="white-space:nowrap;color:' + (late ? SEM_COLOR.danger : 'var(--t5)') + ';font-weight:' + (late ? 700 : 400) + '">' + _pmtEsc(x.a.dueDate) + (late ? ' 지남' : '') + '</span>' : '') +
        '<span onclick="pmtOpenCard(\'' + _pmtJs(x.m.id) + '\')" title="회의로 이동" style="cursor:pointer;white-space:nowrap;color:var(--t6);font-size:9.5px;max-width:110px;overflow:hidden;text-overflow:ellipsis">🤝 ' + _pmtEsc(x.m.title) + '</span>' +
      '</div>';
    }).join('') + '</div>';
}

/* ── 회의 카드 = 회의록 양식 (문서와 같은 순서) ─────────────────────────
   1 회의 개요(회의명·일시·장소·작성자·참석자·회의 목적) → 2 안건 및 논의(안건별 논의·결과 + 기타 논의)
   → 3 결정 사항 → 4 액션 아이템 → 5 다음 회의
   양식 칸은 입력하면 _pmt.drafts[mid] 에 두고 "저장"으로 한 번에 보낸다. 안건 추가·체크·삭제와 액션은 바로 저장된다.
   drafts.agenda = 안건 배열의 JSON (안건별 논의·결과 초안) */
/* form(jsonb) 에 담는 양식 칸 — 서버 routes/meetings.js FORM_KEYS 와 같아야 한다(작성 완료 표시 completedAt·completedBy 는 따로).
   test/meeting-form-keys.test.js 가 두 목록을 비교한다 */
var PMT_FORM_KEYS = ['timeStart', 'timeEnd', 'place', 'writer', 'purpose', 'decisions', 'nextDate', 'nextNote'];
function _pmtSaved(m, k) {
  if (k === 'title' || k === 'meetDate' || k === 'minutes') return m[k] || '';
  if (k === 'attendees') return m.attendees.join(', ');
  if (k === 'agenda') return JSON.stringify(m.agenda);
  return (m.form && m.form[k]) || '';
}
function _pmtVal(m, k) { var d = _pmt.drafts[m.id]; return (d && d[k] != null) ? d[k] : _pmtSaved(m, k); }
function _pmtAgendaOf(m) { try { return JSON.parse(_pmtVal(m, 'agenda')) || []; } catch (e) { return m.agenda.slice(); } }
function _pmtDirty(mid) {
  var m = _pmtFind(mid), d = _pmt.drafts[mid];
  if (!m || !d) return false;
  return Object.keys(d).some(function (k) { return d[k] !== _pmtSaved(m, k); });
}
function _pmtMarkDirty(mid) {
  var dirty = _pmtDirty(mid);
  ['pmtDirtyDot-', 'pmtDirtyTxt-'].forEach(function (p) { var n = document.getElementById(p + mid); if (n) n.style.display = dirty ? 'inline' : 'none'; });
}
function _pmtCardHtml(m, t) {
  var open = !!_pmt.open[m.id], mid = _pmtJs(m.id);
  var acts = m.actionItems || [];
  var openCnt = acts.filter(function (a) { return a.status !== 'done'; }).length;
  var upcoming = m.meetDate && m.meetDate >= t;
  var badge = !m.meetDate ? '<span style="font-size:9px;color:var(--t6)">날짜 없음</span>'
    : m.meetDate === t ? '<span style="font-size:9px;font-weight:700;color:#fff;background:' + SEM_COLOR.info + ';border-radius:8px;padding:0 6px">오늘</span>'
    : upcoming ? '<span style="font-size:9px;font-weight:700;color:' + SEM_COLOR.info + ';border:1px solid ' + SEM_COLOR.info + ';border-radius:8px;padding:0 6px">예정</span>' : '';
  var dirty = _pmtDirty(m.id);
  var h = '<div style="border:1px solid var(--bd);border-left:3px solid ' + (upcoming ? SEM_COLOR.info : 'var(--bd)') + ';border-radius:8px;margin-bottom:8px;overflow:hidden">';
  h += '<div onclick="pmtToggleCard(\'' + mid + '\')" style="cursor:pointer;display:flex;align-items:center;gap:6px;padding:7px 10px;background:var(--bg-i)">' +
    '<span style="font-size:10px;color:var(--t5)">' + (open ? '▾' : '▸') + '</span>' +
    '<span style="flex:1;min-width:0;font-size:12px;font-weight:700;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + _pmtEsc(m.title) + '">' + _pmtEsc(m.title) + '</span>' +
    (_pmtDone(m) ? '<span style="font-size:9px;font-weight:700;color:#fff;background:' + SEM_COLOR.ok + ';border-radius:8px;padding:0 6px" title="' + _pmtEsc('작성 완료 · ' + _pmtFmtWhen(m.form.completedAt) + ' · ' + (m.form.completedBy || '')) + '">✔ 완료</span>' : '<span style="font-size:9px;color:var(--t6);border:1px solid var(--bd);border-radius:8px;padding:0 6px">작성 중</span>') +
    badge +
    (m.meetDate ? '<span style="font-size:10px;color:var(--t5);white-space:nowrap">' + _pmtEsc(m.meetDate) + '</span>' : '') +
    (m.attendees.length ? '<span style="font-size:10px;color:var(--t5);white-space:nowrap" title="' + _pmtEsc(m.attendees.join(', ')) + '">👥 ' + m.attendees.length + '</span>' : '') +
    (acts.length ? '<span style="font-size:10px;white-space:nowrap;color:' + (openCnt ? SEM_COLOR.warn : SEM_COLOR.ok) + '" title="완료 / 전체 액션">✔ ' + (acts.length - openCnt) + '/' + acts.length + '</span>' : '') +
    (m.mailedAt ? '<span style="font-size:10px;color:var(--t5)" title="' + _pmtEsc('메일 발송 ' + _pmtFmtWhen(m.mailedAt) + ' · ' + (m.mailedByName || '')) + '">✉</span>' : '') +
    '<span id="pmtDirtyDot-' + _pmtEsc(m.id) + '" style="font-size:9.5px;color:' + SEM_COLOR.warn + ';display:' + (dirty ? 'inline' : 'none') + '" title="저장하지 않은 내용">●</span>' +
  '</div>';
  if (!open) return h + '</div>';
  if (_pmtDone(m) && !_pmt.editing[m.id]) return h + _pmtDocViewHtml(m) + '</div>';
  h += '<div style="padding:8px 10px">';
  if (_pmtDone(m)) {
    h += '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;padding:6px 9px;margin-bottom:6px;border:1px solid ' + SEM_COLOR.warn + ';background:' + SEM_COLOR.warn + '14;border-radius:6px;font-size:10.5px;color:var(--t2)">' +
      '<span>✏️ <b>완료된 회의록을 수정하는 중</b> — 저장하면 문서에 반영됩니다.' +
        '<br><span style="color:var(--t5)">안건 추가·체크·삭제와 액션 아이템은 누르는 즉시 저장되며, 취소해도 되돌아가지 않습니다.</span></span>' +
      '<button class="btn btn-g btn-s" style="font-size:10px;white-space:nowrap" onclick="pmtEditCancel(\'' + mid + '\')">취소 (문서 보기)</button></div>';
  }
  var agNow = _pmtAgendaOf(m);
  h += _pmtSectionTitle('1. 회의 개요', '');
  h += _pmtFormInfoHtml(m);
  h += _pmtSectionTitle('2. 안건 및 논의', agNow.length ? '완료 ' + agNow.filter(function (g) { return g.done; }).length + '/' + agNow.length : '');
  h += _pmtAgendaHtml(m);
  h += '<div style="font-size:10px;font-weight:600;color:var(--t5);margin:8px 0 3px">기타 논의</div>';
  h += _pmtTextarea(m, 'minutes', '안건 밖에서 논의한 내용·메모 (Ctrl+S 저장)', 52);
  h += _pmtSectionTitle('3. 결정 사항', '');
  h += _pmtTextarea(m, 'decisions', '확정된 결정·합의 사항', 52);
  h += _pmtSectionTitle('4. 액션 아이템', acts.length ? '미완료 ' + openCnt + ' / ' + acts.length : '');
  h += _pmtActsHtml(m, t);
  h += _pmtSectionTitle('5. 다음 회의', '');
  h += '<div style="display:flex;gap:4px;flex-wrap:wrap">' + _pmtInput(m, 'nextDate', '', 'date', 'flex:0 0 auto') + _pmtInput(m, 'nextNote', '다음 회의 안건·메모', 'text', 'flex:1 1 160px') + '</div>';
  // 하단 버튼
  h += '<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:6px;margin-top:12px;padding-top:8px;border-top:1px solid var(--bd)">' +
    '<button class="btn btn-d btn-s" style="font-size:10px" onclick="pmtDelete(\'' + mid + '\')">회의 삭제</button>' +
    '<span style="display:flex;gap:4px;align-items:center">' +
      '<span id="pmtDirtyTxt-' + _pmtEsc(m.id) + '" style="font-size:9.5px;color:' + SEM_COLOR.warn + ';display:' + (dirty ? 'inline' : 'none') + '">● 저장 안 됨</span>' +
      '<button class="btn btn-g btn-s" style="font-size:10px" onclick="pmtPreview(\'' + mid + '\')" title="회의록 양식으로 보기 · 인쇄(PDF) · 메일">🖨 출력 미리보기</button>' +
      (_pmtDone(m)
        ? '<button class="btn btn-p btn-s" style="font-size:10px" onclick="pmtSaveAndView(\'' + mid + '\')">💾 저장 후 문서 보기</button>'
        : '<button class="btn btn-g btn-s" style="font-size:10px" onclick="pmtSaveForm(\'' + mid + '\')">💾 저장</button>' +
          '<button class="btn btn-p btn-s" style="font-size:10px" onclick="pmtComplete(\'' + mid + '\')" title="저장하고 완성된 회의록 문서로 표시합니다">✔ 작성 완료</button>') +
    '</span></div>';
  h += '</div></div>';
  return h;
}
function _pmtSectionTitle(label, extra) {
  return '<div style="font-size:11px;font-weight:800;color:var(--t2);margin:14px 0 5px;padding-left:6px;border-left:3px solid var(--ac)">' + label + (extra ? ' <span style="font-weight:400;color:var(--t6)">' + _pmtEsc(extra) + '</span>' : '') + '</div>';
}
function _pmtFieldAttrs(m, k) {
  var mid = _pmtJs(m.id);
  return 'data-m="' + _pmtEsc(m.id) + '" data-f="' + k + '" oninput="pmtFormInput(this)" onchange="pmtFormInput(this)" onkeydown="if((event.ctrlKey||event.metaKey)&&event.key===\'s\'){event.preventDefault();pmtSaveForm(\'' + mid + '\')}"';
}
function _pmtInput(m, k, ph, type, style, list) {
  if (type === 'date' || type === 'time') style = 'width:auto;' + (style || '');   // .si 의 width:100% 를 풀어 한 줄에
  return '<input class="si" type="' + (type || 'text') + '" ' + _pmtFieldAttrs(m, k) + (list ? ' list="' + list + '"' : '') + ' value="' + _pmtEsc(_pmtVal(m, k)) + '" placeholder="' + _pmtEsc(ph || '') + '" style="font-size:11px;padding:4px 7px;box-sizing:border-box;min-width:0;' + (style || '') + '">';
}
function _pmtTextarea(m, k, ph, minH) {
  var v = _pmtVal(m, k);
  return '<textarea class="si" ' + _pmtFieldAttrs(m, k) + ' placeholder="' + _pmtEsc(ph) + '" style="width:100%;box-sizing:border-box;font-size:11px;padding:6px 8px;min-height:' + (v ? Math.max(minH, 90) : minH) + 'px;resize:vertical;line-height:1.5">' + _pmtEsc(v) + '</textarea>';
}
/* 1. 회의 개요 — 양식 표처럼 라벨 | 칸 */
function _pmtFormInfoHtml(m) {
  var lbl = 'font-size:10px;color:var(--t5);font-weight:600;white-space:nowrap';
  var att = _pmtSplit(_pmtVal(m, 'attendees'));
  return '<div style="display:grid;grid-template-columns:56px 1fr;gap:5px 8px;align-items:center">' +
    '<span style="' + lbl + '">회의명</span>' + _pmtInput(m, 'title', '회의 제목', 'text', 'width:100%') +
    '<span style="' + lbl + '">일시</span><span style="display:flex;gap:4px;flex-wrap:wrap;align-items:center">' +
      _pmtInput(m, 'meetDate', '', 'date', 'flex:0 0 auto') + _pmtInput(m, 'timeStart', '', 'time', 'flex:0 0 auto') +
      '<span style="color:var(--t6);font-size:10px">~</span>' + _pmtInput(m, 'timeEnd', '', 'time', 'flex:0 0 auto') + '</span>' +
    '<span style="' + lbl + '">장소</span>' + _pmtInput(m, 'place', '회의실·온라인 링크 등', 'text', 'width:100%') +
    '<span style="' + lbl + '">작성자</span>' + _pmtInput(m, 'writer', '', 'text', 'width:100%', 'pmtPeople') +
    '<span style="' + lbl + ';align-self:start;padding-top:5px">참석자<br><span style="font-weight:400;color:var(--t6)" id="pmtAttN-' + _pmtEsc(m.id) + '">' + att.length + '명</span></span>' +
      '<div id="pmtAtt-' + _pmtEsc(m.id) + '">' + _pmtAttendeesHtml(m) + '</div>' +
    '<span style="' + lbl + ';align-self:start;padding-top:5px">회의 목적</span>' + _pmtTextareaSm(m, 'purpose', '이 회의에서 정하려는 것') +
  '</div>';
}
/* 참석자 칩 — 이름 하나는 끊지 않고, 많아지면 칩 단위로 다음 줄로. Enter·쉼표로 추가, ✕ 로 빼기 */
function _pmtAttendeesHtml(m) {
  var mid = _pmtJs(m.id), att = _pmtSplit(_pmtVal(m, 'attendees'));
  return '<div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;border:1px solid var(--bd);border-radius:6px;padding:3px 5px;background:var(--bg-i)">' +
    att.map(function (n, i) {
      return '<span style="display:inline-flex;align-items:center;gap:3px;white-space:nowrap;font-size:10.5px;background:var(--bg-p,var(--bg));border:1px solid var(--bd);border-radius:10px;padding:1px 4px 1px 8px;color:var(--t2)">' + _pmtEsc(n) +
        '<button onclick="pmtAttDel(\'' + mid + '\',' + i + ')" title="빼기" style="border:none;background:none;color:var(--t6);cursor:pointer;font-size:10px;padding:0 2px">✕</button></span>';
    }).join('') +
    '<input id="pmtAttIn-' + _pmtEsc(m.id) + '" list="pmtPeople" placeholder="' + (att.length ? '+ 추가' : '이름 입력 후 Enter (쉼표로 여러 명)') + '" onkeydown="if(event.key===\'Enter\'||event.key===\',\'){event.preventDefault();pmtAttAdd(\'' + mid + '\')}" onchange="pmtAttAdd(\'' + mid + '\')" ' +
      'style="flex:1 1 90px;min-width:80px;border:none;background:transparent;outline:none;font-size:10.5px;padding:2px 3px;color:var(--t2)">' +
  '</div>';
}
function _pmtSetAttendees(mid, list) {
  var m = _pmtFind(mid); if (!m) return;
  var d = _pmt.drafts[mid] = _pmt.drafts[mid] || {};
  d.attendees = list.join(', ');
  var box = document.getElementById('pmtAtt-' + mid); if (box) box.innerHTML = _pmtAttendeesHtml(m);
  var n = document.getElementById('pmtAttN-' + mid); if (n) n.textContent = list.length + '명';
  _pmtMarkDirty(mid);
  var inp = document.getElementById('pmtAttIn-' + mid); if (inp) inp.focus();
}
function pmtAttAdd(mid) {
  var m = _pmtFind(mid), inp = document.getElementById('pmtAttIn-' + mid); if (!m || !inp) return;
  var add = _pmtSplit(inp.value); if (!add.length) return;
  var cur = _pmtSplit(_pmtVal(m, 'attendees'));
  add.forEach(function (n) { if (cur.indexOf(n) < 0) cur.push(n); });
  _pmtSetAttendees(mid, cur);
}
function pmtAttDel(mid, i) {
  var m = _pmtFind(mid); if (!m) return;
  var cur = _pmtSplit(_pmtVal(m, 'attendees')); cur.splice(i, 1);
  _pmtSetAttendees(mid, cur);
}
function _pmtTextareaSm(m, k, ph) {
  var v = _pmtVal(m, k);
  return '<textarea class="si" rows="' + Math.min(4, Math.max(1, String(v).split('\n').length)) + '" ' + _pmtFieldAttrs(m, k) + ' placeholder="' + _pmtEsc(ph) + '" style="width:100%;box-sizing:border-box;font-size:11px;padding:4px 7px;resize:vertical;line-height:1.5">' + _pmtEsc(v) + '</textarea>';
}

function _pmtAgendaHtml(m) {
  var mid = _pmtJs(m.id), ag = _pmtAgendaOf(m);
  var cell = 'width:100%;box-sizing:border-box;font-size:10.5px;padding:3px 6px;resize:vertical;line-height:1.5;min-width:0';
  return ag.map(function (g, i) {
    return '<div style="border:1px solid var(--bd);border-radius:6px;padding:5px 7px;margin-bottom:5px">' +
      '<div style="display:flex;align-items:center;gap:6px;font-size:11px">' +
        '<span style="cursor:pointer" title="완료 표시" onclick="pmtAgendaToggle(\'' + mid + '\',' + i + ')">' + (g.done ? '☑' : '☐') + '</span>' +
        '<span style="flex:1;min-width:0;font-weight:600;word-break:keep-all;color:' + (g.done ? 'var(--t5);text-decoration:line-through' : 'var(--t2)') + '">' + (i + 1) + '. ' + _pmtEsc(g.text) + '</span>' +
        '<button class="btn btn-g btn-s" style="font-size:9px;padding:0 5px" title="안건 삭제" onclick="pmtAgendaDel(\'' + mid + '\',' + i + ')">✕</button>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:4px;margin-top:4px">' +
        '<textarea class="si" rows="' + Math.min(4, Math.max(1, String(g.note || '').split('\n').length)) + '" placeholder="논의 내용" oninput="pmtAgendaNote(\'' + mid + '\',' + i + ',\'note\',this.value)" style="' + cell + '">' + _pmtEsc(g.note || '') + '</textarea>' +
        '<textarea class="si" rows="' + Math.min(4, Math.max(1, String(g.result || '').split('\n').length)) + '" placeholder="결과" oninput="pmtAgendaNote(\'' + mid + '\',' + i + ',\'result\',this.value)" style="' + cell + '">' + _pmtEsc(g.result || '') + '</textarea>' +
      '</div></div>';
  }).join('') +
  '<div style="display:flex;gap:3px;margin-top:3px"><input id="pmtAg-' + _pmtEsc(m.id) + '" class="si" placeholder="안건 추가 후 Enter" style="flex:1;font-size:10.5px;padding:3px 6px" onkeydown="if(event.key===\'Enter\')pmtAgendaAdd(\'' + mid + '\')">' +
  '<button class="btn btn-g btn-s" style="font-size:10px" onclick="pmtAgendaAdd(\'' + mid + '\')">+</button></div>';
}
function pmtAgendaNote(mid, i, field, v) {
  var m = _pmtFind(mid); if (!m) return;
  var ag = _pmtAgendaOf(m); if (!ag[i]) return;
  ag[i][field] = v;
  var d = _pmt.drafts[mid] = _pmt.drafts[mid] || {};
  d.agenda = JSON.stringify(ag);
  _pmtMarkDirty(mid);
}

function _pmtActsHtml(m, t) {
  var mid = _pmtJs(m.id);
  var acts = (m.actionItems || []).slice().sort(function (x, y) { return (x.status === 'done') - (y.status === 'done'); });
  // 줄바꿈 없이 한 줄 — 내용은 남는 폭을 모두 쓰고 넘치면 말줄임(마우스를 올리면 전체), 담당·기한은 필요한 폭만
  var h = acts.length ? '<div style="border:1px solid var(--bd);border-radius:6px;overflow:hidden">' + acts.map(function (a, i) {
    var aid = _pmtJs(a.id), done = a.status === 'done', late = !done && a.dueDate && a.dueDate < t;
    var linked = a.linkedIssueId ? '<span style="font-size:9px;color:#06B6D4;white-space:nowrap">→ 이슈</span>' : (a.linkedDevItemId ? '<span style="font-size:9px;color:' + SEM_COLOR.ok + ';white-space:nowrap">→ 개발</span>' : '');
    var full = a.title + (a.assigneeName ? ' · 담당 ' + a.assigneeName : '') + (a.dueDate ? ' · 기한 ' + a.dueDate : '');
    return '<div style="display:flex;align-items:center;gap:6px;padding:4px 7px;font-size:10.5px;white-space:nowrap;' + (i ? 'border-top:1px solid var(--bd);' : '') + (done ? 'opacity:.6' : '') + '">' +
      '<span style="cursor:pointer;flex:0 0 auto" onclick="pmtActToggle(\'' + mid + '\',\'' + aid + '\',\'' + (done ? 'open' : 'done') + '\')">' + (done ? '☑' : '☐') + '</span>' +
      '<span title="' + _pmtEsc(full) + '" style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;color:' + (done ? 'var(--t5);text-decoration:line-through' : 'var(--t2)') + '">' + _pmtEsc(a.title) + '</span>' +
      (a.assigneeName ? '<span style="flex:0 0 auto;max-width:120px;overflow:hidden;text-overflow:ellipsis;font-size:10px;background:var(--bg-i);border:1px solid var(--bd);border-radius:9px;padding:0 7px;color:var(--t3)" title="' + _pmtEsc(a.assigneeName) + '">' + _pmtEsc(a.assigneeName) + '</span>' : '') +
      (a.dueDate ? '<span style="flex:0 0 auto;font-size:10px;color:' + (late ? SEM_COLOR.danger : 'var(--t6)') + ';font-weight:' + (late ? 700 : 400) + '">' + _pmtEsc(a.dueDate.slice(5)) + (late ? ' 지남' : '') + '</span>' : '') +
      linked +
      (a.linkedIssueId || a.linkedDevItemId || done ? '' :
        '<button class="btn btn-g btn-s" style="flex:0 0 auto;font-size:9px;padding:0 4px" title="이슈로 전환" onclick="pmtActConvert(\'' + mid + '\',\'' + aid + '\',\'issue\')">이슈</button>' +
        '<button class="btn btn-g btn-s" style="flex:0 0 auto;font-size:9px;padding:0 4px" title="개발 아이템으로 전환" onclick="pmtActConvert(\'' + mid + '\',\'' + aid + '\',\'dev\')">개발</button>') +
      '<button class="btn btn-g btn-s" style="flex:0 0 auto;font-size:9px;padding:0 4px" title="삭제" onclick="pmtActDel(\'' + mid + '\',\'' + aid + '\')">✕</button>' +
    '</div>';
  }).join('') + '</div>' : '';
  h += '<div style="display:grid;grid-template-columns:minmax(0,1fr) 96px auto auto;gap:3px;margin-top:5px">' +
    '<input id="pmtActT-' + _pmtEsc(m.id) + '" class="si" placeholder="할 일 (Enter 로 추가)" style="min-width:0;font-size:10.5px;padding:3px 6px" onkeydown="if(event.key===\'Enter\')pmtActAdd(\'' + mid + '\')">' +
    '<input id="pmtActA-' + _pmtEsc(m.id) + '" class="si" list="pmtPeople" placeholder="담당" style="min-width:0;font-size:10.5px;padding:3px 6px" onkeydown="if(event.key===\'Enter\')pmtActAdd(\'' + mid + '\')">' +
    '<input id="pmtActD-' + _pmtEsc(m.id) + '" type="date" class="si" style="width:auto;font-size:10.5px;padding:2px">' +
    '<button class="btn btn-g btn-s" style="font-size:10px;white-space:nowrap" onclick="pmtActAdd(\'' + mid + '\')">+ 추가</button></div>';
  return h;
}

/* ═══ 작성 완료 — 완성된 회의록 문서로 표시, 편집을 누르면 양식 (v13.201) ═══
   완료 여부 = form.completedAt (+ completedBy). _pmt.editing[mid] = 완료된 회의를 양식으로 여는 중
   문서는 서버가 만든 한 벌(미리 보기·메일과 같음) — _pmt.docs[mid] = { key: updatedAt, html } */
/* 문서 캐시 키 — 회의 수정 시각 + 액션(액션 변경은 회의 updated_at 을 바꾸지 않는다) */
function _pmtDocKey(m) { return (m.updatedAt || '') + '|' + (m.actionItems || []).map(function (a) { return a.id + ':' + a.status + ':' + a.title + ':' + (a.assigneeName || '') + ':' + (a.dueDate || ''); }).join(','); }
function _pmtDone(m) { return !!(m && m.form && m.form.completedAt); }
function _pmtFmtWhen(t) { if (!t) return ''; var d = new Date(t); return isNaN(d) ? String(t) : d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function _pmtDocViewHtml(m) {
  var mid = _pmtJs(m.id);
  var bar = '<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:6px;padding:7px 10px;border-bottom:1px solid var(--bd)">' +
    '<span style="font-size:10.5px;color:var(--t4)">✔ <b style="color:' + SEM_COLOR.ok + '">작성 완료</b> · ' + _pmtEsc(_pmtFmtWhen(m.form.completedAt)) + (m.form.completedBy ? ' · ' + _pmtEsc(m.form.completedBy) : '') +
      (m.mailedAt ? ' · ✉ ' + _pmtEsc(_pmtFmtWhen(m.mailedAt)) + ' 공유' : '') + '</span>' +
    '<span style="display:flex;gap:4px;flex-wrap:wrap">' +
      '<button class="btn btn-g btn-s" style="font-size:10px" onclick="pmtEdit(\'' + mid + '\')" title="양식으로 바꿔 내용을 고칩니다">✏️ 편집</button>' +
      '<button class="btn btn-g btn-s" style="font-size:10px" onclick="pmtPreview(\'' + mid + '\')" title="A4 출력 · PDF 저장">🖨 출력 미리보기</button>' +
      '<button class="btn btn-g btn-s" style="font-size:10px" onclick="pmtPreview(\'' + mid + '\',true)">✉ 메일</button>' +
      '<button class="btn btn-g btn-s" style="font-size:10px" onclick="pmtUncomplete(\'' + mid + '\')" title="완료 표시를 풀고 작성 중으로">작성 중으로</button>' +
    '</span></div>';
  var doc = _pmt.docs && _pmt.docs[m.id];
  var fresh = doc && doc.key === _pmtDocKey(m);
  if (!fresh) setTimeout(function () { _pmtLoadDoc(m.id); }, 0);
  // 문서는 종이처럼 흰 바탕 — 다크 모드에서도 출력물과 같은 모습
  return bar + '<div style="background:#e5e7eb;padding:10px;overflow-x:auto"><div id="pmtDoc-' + _pmtEsc(m.id) + '" class="pmt-doc" style="background:#fff;min-width:560px;max-width:794px;margin:0 auto;padding:18px 20px;box-shadow:0 1px 6px rgba(0,0,0,.15);color:#0f172a">' +
    (fresh ? doc.html : '<div style="font-size:11px;color:#64748b;padding:20px;text-align:center">회의록 문서를 불러오는 중...</div>') + '</div></div>';
}
/* 서버가 만든 회의록 문서 한 벌 — opts: { sign?, message? } → { subject, html, docNo, mailedAt, … } */
function _pmtRender(mid, opts) {
  return apiFetch('/api/meetings/' + encodeURIComponent(mid) + '/render', { method: 'POST', body: JSON.stringify(opts || {}) }).then(function (r) { return r.data; });
}
/* 카드 안 문서 보기 — 같은 내용(key)을 받는 중이면 다시 요청하지 않고, 늦게 온 옛 문서는 버린다 */
function _pmtLoadDoc(mid) {
  var m = _pmtFind(mid); if (!m) return;
  var key = _pmtDocKey(m);
  if (_pmt.docLoading[mid] === key) return;
  _pmt.docLoading[mid] = key;
  _pmtRender(mid).then(function (doc) {
    if (_pmt.docLoading[mid] === key) delete _pmt.docLoading[mid];
    var cur = _pmtFind(mid);
    if (!cur || _pmtDocKey(cur) !== key) return;   // 그사이 내용이 바뀜 — 새 요청이 그린다
    _pmt.docs[mid] = { key: key, html: doc.html };
    var box = document.getElementById('pmtDoc-' + mid);
    if (box) box.innerHTML = doc.html;
  }).catch(function (e) {
    if (_pmt.docLoading[mid] === key) delete _pmt.docLoading[mid];
    var box = document.getElementById('pmtDoc-' + mid);
    if (box) box.innerHTML = '<div style="font-size:11px;color:#64748b;padding:20px;text-align:center">문서를 불러오지 못했습니다. ' + _pmtEsc(_pmtErr(e, '')) + '</div>';
  });
}
function _pmtMe() { return (typeof currentUser !== 'undefined' && currentUser) ? (currentUser.displayName || currentUser.name || '') : ''; }
/* 작성 완료 — 양식 저장과 완료 표시를 한 번에 → 문서 보기 */
function pmtComplete(mid) {
  var m = _pmtFind(mid); if (!m) return;
  var patch = _pmtFormPatch(m); if (!patch) return;
  patch.form.completedAt = new Date().toISOString();
  patch.form.completedBy = _pmtMe();
  _pmtUpdate(mid, patch).then(function (ok) {
    if (!ok) return;
    delete _pmt.drafts[mid];
    _pmt.editing[mid] = false;
    _pmtPaintCard(mid);
    _pmtToast('✔ 회의록 작성 완료 — 완성된 문서로 표시합니다.', 'success');
  });
}
function pmtUncomplete(mid) {
  var m = _pmtFind(mid); if (!m) return;
  if (!confirm('완료 표시를 풀고 "작성 중"으로 되돌릴까요?')) return;
  var form = Object.assign({}, m.form); delete form.completedAt; delete form.completedBy;
  _pmtUpdate(mid, { form: form }).then(function (ok) { if (ok) { _pmt.editing[mid] = false; _pmtPaintCard(mid); _pmtToast('작성 중으로 되돌렸습니다.'); } });
}
/* 완료된 회의를 양식으로 열기 / 취소 / 저장 후 문서 보기 */
function pmtEdit(mid) { if (!_pmt) return; _pmt.editing[mid] = true; _pmtPaintCard(mid); }
function pmtEditCancel(mid) {
  if (_pmtDirty(mid) && !confirm('저장하지 않은 수정 내용이 있습니다. 버리고 문서 보기로 돌아갈까요?')) return;
  delete _pmt.drafts[mid];
  _pmt.editing[mid] = false;
  _pmtPaintCard(mid);
}
function pmtSaveAndView(mid) {
  pmtSaveForm(mid, true).then(function (ok) {
    if (!ok) return;
    _pmt.editing[mid] = false;
    _pmtPaintCard(mid);
    _pmtToast('저장했습니다 — 문서에 반영됨', 'success');
  });
}

/* 한 카드만 다시 그림 (다른 카드의 입력·초안 보존) */
function _pmtPaintCard(mid) {
  var box = document.getElementById('pmt-card-' + mid);
  var m = _pmtFind(mid);
  if (!box || !m) { pdRenderMeetings(); return; }
  box.innerHTML = _pmtCardHtml(m, _pmtToday());
}

/* ═══ 동작 ═══ */
function pmtToggleAdd() { if (!_pmt) return; _pmt.adding = !_pmt.adding; pdRenderMeetings(); }
function pmtToggleActs() { if (!_pmt) return; _pmt.showActs = !_pmt.showActs; pdRenderMeetings(); }
function pmtSetFilter(f) { if (!_pmt) return; _pmt.filter = f; pdRenderMeetings(); }
function pmtToggleCard(mid) { if (!_pmt) return; _pmt.open[mid] = !_pmt.open[mid]; _pmtPaintCard(mid); }
function pmtOpenCard(mid) {
  if (!_pmt) return;
  _pmt.open[mid] = true; _pmt.filter = 'all';
  pdRenderMeetings();
  var el = document.getElementById('pmt-card-' + mid); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function _pmtSplit(v) { return String(v || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); }

function pmtCreate() {
  if (!_pmt) return;
  var title = ((document.getElementById('pmtNewTitle') || {}).value || '').trim();
  if (!title) { _pmtToast('회의 제목을 입력하세요.', 'warn'); return; }
  var date = (document.getElementById('pmtNewDate') || {}).value || null;
  var att = _pmtSplit((document.getElementById('pmtNewAtt') || {}).value);
  var projId = _pmt.projId;
  var me = _pmtMe();
  apiFetch('/api/meetings', { method: 'POST', body: JSON.stringify({ projectId: projId, title: title, meetDate: date, attendees: att, form: me ? { writer: me } : {} }) }).then(function (r) {
    if (!_pmt || _pmt.projId !== projId) return;
    var m = _pmtNorm(r.data);
    _pmt.list.unshift(m);
    _pmt.list.sort(function (a, b) { return (b.meetDate || '').localeCompare(a.meetDate || ''); });   // 서버와 같은 순서(날짜 최신 먼저)
    _pmt.open[m.id] = true; _pmt.adding = false; _pmt.filter = 'all';
    pdRenderMeetings();
    _pmtToast('회의 등록됨' + (date ? ' · 캘린더 일정 발행' : ''), 'success');
  }).catch(function (e) { _pmtToast('❌ ' + _pmtErr(e, '등록 실패'), 'error'); });
}
/* 양식 입력 → 초안 */
function pmtFormInput(el) {
  if (!_pmt) return;
  var mid = el.getAttribute('data-m'), k = el.getAttribute('data-f');
  var d = _pmt.drafts[mid] = _pmt.drafts[mid] || {};
  d[k] = el.value;
  _pmtMarkDirty(mid);
}
/* 양식 저장 — 제목·일시·참석자·논의 내용·양식 칸을 한 번에. 성공 여부 */
/* 양식(초안 + 저장된 값) → PUT 본문. 완료 표시는 그대로 유지. 회의명이 비었으면 null */
function _pmtFormPatch(m) {
  var title = String(_pmtVal(m, 'title')).trim();
  if (!title) { _pmtToast('회의명을 입력하세요.', 'warn'); return null; }
  var form = {};
  PMT_FORM_KEYS.forEach(function (k) { form[k] = _pmtVal(m, k); });
  if (m.form.completedAt) { form.completedAt = m.form.completedAt; form.completedBy = m.form.completedBy || ''; }
  var patch = { title: title, meetDate: _pmtVal(m, 'meetDate') || null, attendees: _pmtSplit(_pmtVal(m, 'attendees')), minutes: _pmtVal(m, 'minutes'), form: form };
  if (_pmt.drafts[m.id] && _pmt.drafts[m.id].agenda != null) patch.agenda = _pmtAgendaOf(m);
  return patch;
}
function pmtSaveForm(mid, quiet) {
  var m = _pmtFind(mid); if (!m) return Promise.resolve(false);
  if (!_pmtDirty(mid)) { if (!quiet) _pmtToast('바뀐 내용이 없습니다.'); return Promise.resolve(true); }
  var patch = _pmtFormPatch(m); if (!patch) return Promise.resolve(false);
  return _pmtUpdate(mid, patch).then(function (ok) {
    if (!ok) return false;
    delete _pmt.drafts[mid];
    _pmtPaintCard(mid);
    if (!quiet) _pmtToast('회의록 저장됨', 'success');
    return true;
  });
}
/* 회의 필드 저장 → 서버 응답으로 갱신(액션은 그대로 유지). 성공 여부
   version 을 함께 보낸다(v13.202) — 그사이 다른 사람이 저장했으면 409 + 최신 회의: 최신 내용으로 바꾸고
   이쪽 초안(_pmt.drafts)은 남겨 두어, 확인 후 다시 저장하면 고친 칸만 덮어쓴다 */
function _pmtUpdate(mid, patch) {
  var cur = _pmtFind(mid);
  var body = Object.assign({}, patch, cur && cur.version != null ? { version: cur.version } : {});
  return apiFetch('/api/meetings/' + encodeURIComponent(mid), { method: 'PUT', body: JSON.stringify(body) }).then(function (r) {
    var old = _pmtFind(mid); if (!old) return false;
    var m = _pmtNorm(r.data); m.actionItems = old.actionItems;
    _pmtReplace(m);
    return true;
  }).catch(function (e) {
    if (e && e.status === 409 && e.data && e.data.data) {
      _pmtReplace(_pmtNorm(e.data.data));
      _pmtPaintCard(mid);
      _pmtToast('⚠ 다른 사람이 먼저 저장해 최신 내용을 불러왔습니다. 내가 고친 칸은 남아 있으니 확인 후 다시 저장하세요.', 'warn');
      return false;
    }
    _pmtToast('❌ ' + _pmtErr(e, '저장 실패'), 'error'); return false;
  });
}
function pmtDelete(mid) {
  var m = _pmtFind(mid); if (!m) return;
  if (!confirm('회의 "' + m.title + '" 을(를) 삭제할까요? (연결된 캘린더 일정도 삭제됩니다)')) return;
  apiFetch('/api/meetings/' + encodeURIComponent(mid), { method: 'DELETE' }).then(function () {
    _pmt.list = _pmt.list.filter(function (x) { return String(x.id) !== String(mid); });
    delete _pmt.drafts[mid];
    pdRenderMeetings();
    _pmtToast('삭제했습니다.');
  }).catch(function (e) { _pmtToast('❌ ' + _pmtErr(e, '삭제 실패'), 'error'); });
}

/* ═══ 미리 보기 · 인쇄 · 메일 — 문서는 서버가 만든 한 벌(미리 보기 = 메일 본문) ═══ */
function pmtPreview(mid, focusMail) {
  return wmGuardedModal('pmtPreview', function () {
    return pmtSaveForm(mid, true).then(function (ok) {
      if (!ok) throw new Error('회의록을 저장하지 못해 미리 볼 수 없습니다.');
      return Promise.all([
        _pmtRender(mid, { sign: _pmtSignOn() }),
        apiFetch('/api/meetings/' + encodeURIComponent(mid) + '/mail-recipients').catch(function () { return { data: [] }; })
      ]);
    }).then(function (res) { _pmtBuildPreview(mid, res[0], res[1].data || [], focusMail); });
  }, 'pmtPreviewModal', { timeoutMs: 15000 });
}
function _pmtBuildPreview(mid, doc, recips, focusMail) {
  window._pmtDoc = doc;   // 메일 앱으로 보내기 — 클릭 직후 바로 복사하려고 미리 받은 문서를 둔다
  var sent = doc.mailedAt ? '<div style="font-size:10px;color:var(--t5);margin-top:4px">마지막 발송: ' + _pmtEsc(_pmtFmtWhen(doc.mailedAt)) + ' · ' + _pmtEsc(doc.mailedByName || '') + ' · ' + (doc.mailedTo || []).length + '명</div>' : '';
  var people = recips.map(function (r, i) {
    return '<label style="display:inline-flex;align-items:center;gap:3px;font-size:11px;border:1px solid var(--bd);border-radius:12px;padding:2px 8px;margin:0 4px 4px 0;' + (r.hasEmail ? '' : 'opacity:.5') + '" title="' + _pmtEsc(r.hasEmail ? r.masked : '계정·메일 주소를 찾지 못함 — 아래에 주소를 직접 넣으세요') + '">' +
      '<input type="checkbox" class="pmt-rc" data-name="' + _pmtEsc(r.name) + '" data-email="' + _pmtEsc(r.email || '') + '"' + (r.hasEmail ? ' checked' : ' disabled') + '> ' + _pmtEsc(r.name) + (r.hasEmail ? '' : ' (메일 없음)') + '</label>';
  }).join('');
  var html =
    '<div style="display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:12px">' +
      // 종이 미리 보기 — 회색 바탕 위 A4 폭(794px) 한 장, 높이는 문서 길이에 맞춤
      '<div style="background:#e5e7eb;border-radius:8px;padding:14px;max-height:76vh;overflow:auto"><iframe id="pmtPreviewFrame" style="display:block;width:794px;max-width:100%;height:600px;margin:0 auto;border:0;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.18)"></iframe></div>' +
      '<div style="display:flex;flex-direction:column;gap:8px;position:sticky;top:0;align-self:start">' +
        '<div style="display:flex;gap:6px;align-items:center"><button class="btn btn-g btn-s" style="flex:1;font-size:11px" onclick="pmtPrint()">🖨 인쇄 / PDF 저장</button>' +
          '<label style="font-size:10.5px;color:var(--t4);white-space:nowrap;cursor:pointer" title="작성·검토·승인 서명란"><input type="checkbox" id="pmtSignChk"' + (_pmtSignOn() ? ' checked' : '') + ' onchange="pmtToggleSign(\'' + _pmtJs(mid) + '\',this.checked)"> 결재란</label></div>' +
        '<div style="border:1px solid var(--bd);border-radius:8px;padding:8px 10px">' +
          '<div style="font-size:11.5px;font-weight:700;color:var(--t2);margin-bottom:6px">✉ 메일 보내기</div>' +
          '<div style="font-size:10px;color:var(--t5);margin-bottom:3px">참석자</div>' +
          (people || '<div style="font-size:10px;color:var(--t6);margin-bottom:4px">참석자가 없습니다.</div>') +
          '<div style="font-size:10px;color:var(--t5);margin:6px 0 3px">직접 입력 (쉼표로 구분)</div>' +
          '<input id="pmtMailExtra" class="si" placeholder="name@company.com, …" style="width:100%;box-sizing:border-box;font-size:11px;padding:4px 7px">' +
          '<div style="font-size:10px;color:var(--t5);margin:6px 0 3px">머리말 (선택)</div>' +
          '<textarea id="pmtMailMsg" class="si" rows="3" placeholder="예: 오늘 회의 내용 공유드립니다." style="width:100%;box-sizing:border-box;font-size:11px;padding:4px 7px;resize:vertical"></textarea>' +
          // v13.199 메일 서버 없이: ① 메일 앱(본문 복사 + 새 메일 창) ② Outlook 초안(.eml) — ③ 서버 발송은 SMTP 가 설정된 경우만
          '<button class="btn btn-p btn-s" style="width:100%;margin-top:8px;font-size:11px" onclick="pmtMailApp(\'' + _pmtJs(mid) + '\')" title="회의록 문서를 복사하고 받는 사람·제목이 채워진 새 메일 창을 엽니다">📋 메일 앱으로 보내기</button>' +
          '<div style="font-size:9.5px;color:var(--t6);margin:3px 0 0;line-height:1.5">새 메일 창이 열리면 본문에 <b>Ctrl+V</b> 로 붙여넣고 보내세요 (표 서식 유지).</div>' +
          '<button class="btn btn-g btn-s" style="width:100%;margin-top:6px;font-size:11px" onclick="pmtMailEml(\'' + _pmtJs(mid) + '\')" title="받는 사람·제목·본문이 들어간 메일 파일 — 더블클릭하면 Outlook 에서 보내기 전 초안으로 열립니다">⬇ Outlook 초안 (.eml)</button>' +
          (doc.smtp
            ? '<button class="btn btn-g btn-s" id="pmtMailBtn" style="width:100%;margin-top:6px;font-size:11px" onclick="pmtSendMail(\'' + _pmtJs(mid) + '\')">🚀 바로 보내기 (서버 발송)</button>' +
              '<div style="font-size:9.5px;color:var(--t6);margin-top:3px;line-height:1.5">서버 발송은 받는 사람끼리 주소가 보이지 않게 숨은 참조로 보냅니다.</div>'
            : '') +
          sent +
        '</div>' +
      '</div>' +
    '</div>';
  createModal({ id: 'pmtPreviewModal', titleText: '📄 회의록 미리 보기' + (doc.docNo ? ' · ' + doc.docNo : ''), html: html, width: '1140px', boxStyle: 'max-height:94vh', closeOnEsc: true });
  _pmtPaintFrame(doc);
  if (focusMail) { var ex = document.getElementById('pmtMailExtra'); if (ex) setTimeout(function () { ex.focus(); }, 50); }
}
/* ── 메일 서버 없이 보내기 (v13.199) ─────────────────────────────────── */
function _pmtPickedEmails() {
  var list = Array.prototype.slice.call(document.querySelectorAll('#pmtPreviewModal .pmt-rc:checked')).map(function (c) { return c.getAttribute('data-email'); }).filter(Boolean);
  _pmtSplit((document.getElementById('pmtMailExtra') || {}).value).forEach(function (e) { list.push(e); });
  var seen = {}, bad = [];
  var out = list.filter(function (e) {
    if (!/^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/.test(e)) { bad.push(e); return false; }
    var k = e.toLowerCase(); if (seen[k]) return false; seen[k] = true; return true;
  });
  return { to: out, bad: bad };
}
/* 머리말을 넣은 문서 — 서버가 만든 한 벌 그대로 */
function _pmtDocWithMessage(mid) {
  return _pmtRender(mid, { message: (document.getElementById('pmtMailMsg') || {}).value || '' });
}
function _pmtMailLog(mid, to, method) {
  return apiFetch('/api/meetings/' + encodeURIComponent(mid) + '/mail-log', { method: 'POST', body: JSON.stringify({ to: to, method: method }) }).then(function (r) {
    var m = _pmtFind(mid); if (m) { m.mailedAt = r.data.mailedAt; _pmtPaintCard(mid); }
  }).catch(function () {});
}
/* 서식 있는 HTML 을 클립보드로 — ClipboardItem 이 안 되면 문서 영역을 선택해 복사 */
function _pmtCopyHtml(html, plain) {
  if (navigator.clipboard && window.ClipboardItem && window.isSecureContext) {
    try {
      return navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) })]).then(function () { return true; }, function () { return _pmtCopyFallback(html); });
    } catch (e) { /* 아래로 */ }
  }
  return Promise.resolve(_pmtCopyFallback(html));
}
function _pmtCopyFallback(html) {
  var box = document.createElement('div');
  box.setAttribute('contenteditable', 'true');
  box.style.cssText = 'position:fixed;left:-10000px;top:0;background:#fff';
  box.innerHTML = html;
  document.body.appendChild(box);
  var range = document.createRange(); range.selectNodeContents(box);
  var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  sel.removeAllRanges(); box.remove();
  return ok;
}
function _pmtPlainOf(html) { var d = document.createElement('div'); d.innerHTML = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(tr|p|div|li|h1)>/gi, '\n'); return (d.textContent || '').replace(/\n{3,}/g, '\n\n').trim(); }

function pmtMailApp(mid) {
  var r = _pmtPickedEmails();
  if (r.bad.length) { _pmtToast('메일 주소 형식 오류: ' + r.bad.slice(0, 3).join(', '), 'warn'); return; }
  // 메일 창은 사용자 클릭 직후에 열어야 팝업 차단을 피한다 → 문서는 미리 보기에서 받은 것 사용, 머리말이 있으면 새로 받는다
  var msg = (document.getElementById('pmtMailMsg') || {}).value || '';
  var docP = msg.trim() ? _pmtDocWithMessage(mid) : Promise.resolve(window._pmtDoc);
  docP.then(function (doc) {
    return _pmtCopyHtml(doc.html, _pmtPlainOf(doc.html)).then(function (copied) {
      var url = 'mailto:' + r.to.map(encodeURIComponent).join(',') + '?subject=' + encodeURIComponent(doc.subject) +
        '&body=' + encodeURIComponent(copied ? '(여기에 Ctrl+V 로 회의록을 붙여넣으세요)\n\n' : _pmtPlainOf(doc.html).slice(0, 1500));
      window.location.href = url;
      _pmtToast(copied ? '회의록을 복사했습니다. 열린 메일 창 본문에 Ctrl+V 로 붙여넣으세요.' : '복사가 막혀 본문을 글자로만 넣었습니다. 서식이 필요하면 Outlook 초안(.eml)을 쓰세요.', copied ? 'success' : 'warn');
      _pmtMailLog(mid, r.to, 'app');
    });
  }).catch(function (e) { _pmtToast('❌ ' + _pmtErr(e, '메일 준비 실패'), 'error'); });
}

/* .eml — 받는 사람·제목(UTF-8)·HTML 본문. X-Unsent: 1 이면 Outlook 이 보내기 전 초안으로 연다 */
function _pmtB64(str) {
  var bytes = new TextEncoder().encode(str), bin = '';
  for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function _pmtBuildEml(to, subject, html) {
  var body = '<!doctype html><html><head><meta charset="utf-8"></head><body>' + html + '</body></html>';
  var b64 = _pmtB64(body).replace(/.{76}/g, '$&\r\n');
  return [
    'To: ' + to.join(', '),
    'Subject: =?UTF-8?B?' + _pmtB64(subject) + '?=',
    'X-Unsent: 1',
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64,
    ''
  ].join('\r\n');
}
function pmtMailEml(mid) {
  var r = _pmtPickedEmails();
  if (r.bad.length) { _pmtToast('메일 주소 형식 오류: ' + r.bad.slice(0, 3).join(', '), 'warn'); return; }
  _pmtDocWithMessage(mid).then(function (doc) {
    var blob = new Blob([_pmtBuildEml(r.to, doc.subject, doc.html)], { type: 'message/rfc822' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = doc.subject.replace(/[\\\/:*?"<>|]/g, '_').slice(0, 80) + '.eml';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    _pmtToast('메일 파일을 내려받았습니다. 더블클릭하면 Outlook 에서 초안으로 열립니다.', 'success');
    _pmtMailLog(mid, r.to, 'eml');
  }).catch(function (e) { _pmtToast('❌ ' + _pmtErr(e, '메일 파일 만들기 실패'), 'error'); });
}

/* 미리 보기 문서 그리기 — A4 인쇄 설정, 배경색 인쇄, 높이 자동 */
function _pmtPaintFrame(doc) {
  var fr = document.getElementById('pmtPreviewFrame'); if (!fr) return;
  fr.onload = function () {
    try { var b = fr.contentDocument.body; fr.style.height = Math.max(400, b.scrollHeight + 8) + 'px'; } catch (e) { /* 무시 */ }
  };
  fr.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><title>' + _pmtEsc(doc.subject) + '</title>' +
    '<style>@page{size:A4;margin:14mm 12mm}html,body{margin:0;background:#fff}body{padding:28px 30px;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '@media print{body{padding:0}}</style></head><body>' + doc.html + '</body></html>';
}
function _pmtSignOn() { try { return localStorage.getItem('pmtSign') === '1'; } catch (e) { return false; } }
function pmtToggleSign(mid, on) {
  try { localStorage.setItem('pmtSign', on ? '1' : '0'); } catch (e) { /* 무시 */ }
  _pmtRender(mid, { sign: on })
    .then(function (doc) { window._pmtDoc = doc; _pmtPaintFrame(doc); })
    .catch(function (e) { _pmtToast('❌ ' + _pmtErr(e, '미리 보기 실패'), 'error'); });
}
function pmtPrint() {
  var fr = document.getElementById('pmtPreviewFrame');
  if (fr && fr.contentWindow) { fr.contentWindow.focus(); fr.contentWindow.print(); }
}
function pmtSendMail(mid) {
  var names = Array.prototype.slice.call(document.querySelectorAll('#pmtPreviewModal .pmt-rc:checked')).map(function (c) { return c.getAttribute('data-name'); });
  var emails = _pmtSplit((document.getElementById('pmtMailExtra') || {}).value);
  var msg = (document.getElementById('pmtMailMsg') || {}).value || '';
  if (!names.length && !emails.length) { _pmtToast('받는 사람을 고르거나 주소를 입력하세요.', 'warn'); return; }
  if (!confirm((names.length + emails.length) + '곳에 회의록을 보낼까요?')) return;
  var btn = document.getElementById('pmtMailBtn'), label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '보내는 중...'; }
  apiFetch('/api/meetings/' + encodeURIComponent(mid) + '/mail', { method: 'POST', body: JSON.stringify({ attendees: names, emails: emails, message: msg }), timeoutMs: 45000 }).then(function (r) {
    var m = _pmtFind(mid); if (m) { m.mailedAt = r.data.mailedAt; _pmtPaintCard(mid); }
    var ov = document.getElementById('pmtPreviewModal'); if (ov) ov.remove();
    _pmtToast('✉ ' + (r.message || '보냈습니다.'), 'success');
  }).catch(function (e) {
    if (btn) { btn.disabled = false; btn.textContent = label; }
    _pmtToast('❌ ' + _pmtErr(e, '메일 전송 실패'), 'error');
  });
}

/* 안건 */
function _pmtSaveAgenda(mid, agenda) {
  return _pmtUpdate(mid, { agenda: agenda }).then(function (ok) {
    if (ok) { if (_pmt.drafts[mid]) delete _pmt.drafts[mid].agenda; _pmtPaintCard(mid); }
    return ok;
  });
}
function pmtAgendaAdd(mid) {
  var inp = document.getElementById('pmtAg-' + mid), text = inp ? inp.value.trim() : '';
  if (!text) return;
  var m = _pmtFind(mid); if (!m) return;
  _pmtSaveAgenda(mid, _pmtAgendaOf(m).concat([{ text: text, done: false, note: '', result: '' }])).then(function (ok) { if (ok) { var n = document.getElementById('pmtAg-' + mid); if (n) n.focus(); } });
}
function pmtAgendaToggle(mid, i) {
  var m = _pmtFind(mid); if (!m) return;
  var ag = _pmtAgendaOf(m); if (!ag[i]) return;
  ag[i].done = !ag[i].done;
  _pmtSaveAgenda(mid, ag);
}
function pmtAgendaDel(mid, i) {
  var m = _pmtFind(mid); if (!m) return;
  var ag = _pmtAgendaOf(m); if (!ag[i]) return;
  if ((ag[i].note || ag[i].result) && !confirm('안건 "' + ag[i].text + '" 과 적어 둔 논의·결과를 삭제할까요?')) return;
  ag.splice(i, 1);
  _pmtSaveAgenda(mid, ag);
}

/* 액션아이템 — 변경 후 그 회의만 새로 받아 다시 그림 */
function _pmtAfterAct(mid, msg) {
  return _pmtRefetch(mid).then(function () {
    if (_pmt.showActs) pdRenderMeetings(); else { _pmtPaintCard(mid); _pmtPaintSummary(); }
    if (msg) _pmtToast(msg, 'success');
  });
}
/* 요약 줄만 갱신 — 전체를 다시 그리면 다른 카드의 입력이 사라지므로 */
function _pmtPaintSummary() {
  var span = document.getElementById('pmtSummary'); if (!span) return;
  var t = _pmtToday(), n = 0, late = 0;
  _pmt.list.forEach(function (m) { (m.actionItems || []).forEach(function (a) { if (a.status !== 'done') { n++; if (a.dueDate && a.dueDate < t) late++; } }); });
  span.innerHTML = _pmtSummaryHtml(_pmt.list.length, n, late);
}
function _pmtSummaryHtml(meetings, open, late) {
  return '<b style="color:var(--t2)">회의 ' + meetings + '</b> · 미완료 액션 <b style="color:var(--t2)">' + open + '</b>' +
    (late ? ' · <b style="color:' + SEM_COLOR.danger + '">기한 지남 ' + late + '</b>' : '');
}
function pmtActAdd(mid) {
  var t = ((document.getElementById('pmtActT-' + mid) || {}).value || '').trim();
  if (!t) { var n0 = document.getElementById('pmtActT-' + mid); if (n0) n0.focus(); return; }
  var a = ((document.getElementById('pmtActA-' + mid) || {}).value || '').trim();
  var d = (document.getElementById('pmtActD-' + mid) || {}).value || null;
  apiFetch('/api/meetings/' + encodeURIComponent(mid) + '/actions', { method: 'POST', body: JSON.stringify({ title: t, assigneeName: a || null, dueDate: d }) })
    .then(function () { return _pmtAfterAct(mid); })
    .then(function () { var n = document.getElementById('pmtActT-' + mid); if (n) n.focus(); })
    .catch(function (e) { _pmtToast('❌ ' + _pmtErr(e, '추가 실패'), 'error'); });
}
function pmtActToggle(mid, aid, status) {
  apiFetch('/api/meetings/' + encodeURIComponent(mid) + '/actions/' + encodeURIComponent(aid), { method: 'PUT', body: JSON.stringify({ status: status }) })
    .then(function () { return _pmtAfterAct(mid); })
    .catch(function (e) { _pmtToast('❌ ' + _pmtErr(e, '변경 실패'), 'error'); });
}
function pmtActDel(mid, aid) {
  if (!confirm('이 액션아이템을 삭제할까요?')) return;
  apiFetch('/api/meetings/' + encodeURIComponent(mid) + '/actions/' + encodeURIComponent(aid), { method: 'DELETE' })
    .then(function () { return _pmtAfterAct(mid); })
    .catch(function (e) { _pmtToast('❌ ' + _pmtErr(e, '삭제 실패'), 'error'); });
}
function pmtActConvert(mid, aid, target) {
  var label = target === 'dev' ? '개발 아이템' : '이슈';
  if (!confirm('이 액션아이템을 ' + label + '(으)로 전환할까요?')) return;
  apiFetch('/api/meetings/' + encodeURIComponent(mid) + '/actions/' + encodeURIComponent(aid) + '/convert', { method: 'POST', body: JSON.stringify({ target: target }) })
    .then(function () { return _pmtAfterAct(mid, label + '(으)로 전환됨'); })
    .catch(function (e) { _pmtToast('❌ ' + _pmtErr(e, '전환 실패'), 'error'); });
}

/* 저장하지 않은 회의록이 있으면 페이지를 떠날 때 확인 */
if (typeof window !== 'undefined' && !window._pmtUnloadBound) {
  window._pmtUnloadBound = true;
  window.addEventListener('beforeunload', function (e) {
    if (!_pmt || !document.getElementById('pdMeeting')) return;
    var dirty = Object.keys(_pmt.drafts).some(_pmtDirty);
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });
}
