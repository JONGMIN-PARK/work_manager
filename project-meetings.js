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
  c.agenda = (Array.isArray(c.agenda) ? c.agenda : []).map(function (g) { return typeof g === 'string' ? { text: g, done: false } : { text: String((g && g.text) || ''), done: !!(g && g.done) }; }).filter(function (g) { return g.text; });
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
  _pmt = keep || { projId: projId, list: [], open: {}, drafts: {}, filter: 'all', showActs: false, adding: false, firstOpenDone: false };
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
    '<span id="pmtSummary" style="font-size:11px;color:var(--t4)"><b style="color:var(--t2)">회의 ' + all.length + '</b> · 미완료 액션 <b style="color:var(--t2)">' + acts.length + '</b>' +
      (overdue ? ' · <b style="color:' + SEM_COLOR.danger + '">기한 지남 ' + overdue + '</b>' : '') + '</span>' +
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
    _pmtPeopleDatalist() +
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
/* datalist 는 탭 맨 위에 한 번만 (카드를 다시 그려도 남도록) — 카드 쪽 호출은 빈 문자열 */
function _pmtPeopleDatalist() { return ''; }
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

/* ── 회의 카드 = 회의록 양식 ─────────────────────────────────────────────
   기본 정보(제목·일시·장소·작성자·참석자) → 안건 → 논의 내용 → 결정 사항 → 액션 아이템 → 다음 회의
   양식 칸은 입력하면 _pmt.drafts[mid] 에 두고 "저장"으로 한 번에 보낸다. 안건·액션은 바로 저장된다. */
var PMT_FIELDS = ['title', 'meetDate', 'timeStart', 'timeEnd', 'place', 'writer', 'attendees', 'minutes', 'decisions', 'nextDate', 'nextNote'];
function _pmtSaved(m, k) {
  if (k === 'title' || k === 'meetDate' || k === 'minutes') return m[k] || '';
  if (k === 'attendees') return m.attendees.join(', ');
  return (m.form && m.form[k]) || '';
}
function _pmtVal(m, k) { var d = _pmt.drafts[m.id]; return (d && d[k] != null) ? d[k] : _pmtSaved(m, k); }
function _pmtDirty(mid) {
  var m = _pmtFind(mid), d = _pmt.drafts[mid];
  if (!m || !d) return false;
  return Object.keys(d).some(function (k) { return d[k] !== _pmtSaved(m, k); });
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
    badge +
    (m.meetDate ? '<span style="font-size:10px;color:var(--t5);white-space:nowrap">' + _pmtEsc(m.meetDate) + '</span>' : '') +
    (m.attendees.length ? '<span style="font-size:10px;color:var(--t5);white-space:nowrap" title="' + _pmtEsc(m.attendees.join(', ')) + '">👥 ' + m.attendees.length + '</span>' : '') +
    (acts.length ? '<span style="font-size:10px;white-space:nowrap;color:' + (openCnt ? SEM_COLOR.warn : SEM_COLOR.ok) + '" title="완료 / 전체 액션">✔ ' + (acts.length - openCnt) + '/' + acts.length + '</span>' : '') +
    (m.mailedAt ? '<span style="font-size:10px;color:var(--t5)" title="' + _pmtEsc('메일 발송 ' + String(m.mailedAt).slice(0, 16).replace('T', ' ') + ' · ' + (m.mailedByName || '')) + '">✉</span>' : '') +
    '<span id="pmtDirtyDot-' + _pmtEsc(m.id) + '" style="font-size:9.5px;color:' + SEM_COLOR.warn + ';display:' + (dirty ? 'inline' : 'none') + '" title="저장하지 않은 내용">●</span>' +
  '</div>';
  if (!open) return h + '</div>';
  h += '<div style="padding:8px 10px">';
  h += _pmtFormInfoHtml(m);
  h += _pmtSectionTitle('안건', m.agenda.length ? m.agenda.filter(function (g) { return g.done; }).length + '/' + m.agenda.length : '');
  h += _pmtAgendaHtml(m);
  h += _pmtSectionTitle('논의 내용', '');
  h += _pmtTextarea(m, 'minutes', '논의한 내용을 적습니다 (Ctrl+S 저장)', 90);
  h += _pmtSectionTitle('결정 사항', '');
  h += _pmtTextarea(m, 'decisions', '확정된 결정·합의 사항', 52);
  h += _pmtSectionTitle('액션 아이템', acts.length ? '미완료 ' + openCnt : '');
  h += _pmtActsHtml(m, t);
  h += _pmtSectionTitle('다음 회의', '');
  h += '<div style="display:flex;gap:4px;flex-wrap:wrap">' + _pmtInput(m, 'nextDate', '', 'date', 'flex:0 0 auto') + _pmtInput(m, 'nextNote', '다음 회의 안건·메모', 'text', 'flex:1 1 160px') + '</div>';
  // 하단 버튼
  h += '<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:6px;margin-top:12px;padding-top:8px;border-top:1px solid var(--bd)">' +
    '<button class="btn btn-d btn-s" style="font-size:10px" onclick="pmtDelete(\'' + mid + '\')">회의 삭제</button>' +
    '<span style="display:flex;gap:4px;align-items:center">' +
      '<span id="pmtDirtyTxt-' + _pmtEsc(m.id) + '" style="font-size:9.5px;color:' + SEM_COLOR.warn + ';display:' + (dirty ? 'inline' : 'none') + '">● 저장 안 됨</span>' +
      '<button class="btn btn-g btn-s" style="font-size:10px" onclick="pmtPreview(\'' + mid + '\')" title="회의록 양식으로 보기 · 인쇄(PDF) · 메일">📄 미리 보기</button>' +
      '<button class="btn btn-g btn-s" style="font-size:10px" onclick="pmtPreview(\'' + mid + '\',true)" title="회의록을 메일로 보내기">✉ 메일 보내기</button>' +
      '<button class="btn btn-p btn-s" style="font-size:10px" onclick="pmtSaveForm(\'' + mid + '\')">💾 저장</button>' +
    '</span></div>';
  h += '</div></div>';
  return h;
}
function _pmtSectionTitle(label, extra) {
  return '<div style="font-size:10.5px;font-weight:700;color:var(--t3);margin:12px 0 4px">' + label + (extra ? ' <span style="font-weight:400;color:var(--t6)">' + _pmtEsc(extra) + '</span>' : '') + '</div>';
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
/* 기본 정보 — 양식 표처럼 라벨 | 칸 */
function _pmtFormInfoHtml(m) {
  var lbl = 'font-size:10px;color:var(--t5);font-weight:600;white-space:nowrap';
  return '<div style="display:grid;grid-template-columns:52px 1fr;gap:5px 8px;align-items:center">' +
    '<span style="' + lbl + '">회의명</span>' + _pmtInput(m, 'title', '회의 제목', 'text', 'width:100%') +
    '<span style="' + lbl + '">일시</span><span style="display:flex;gap:4px;flex-wrap:wrap;align-items:center">' +
      _pmtInput(m, 'meetDate', '', 'date', 'flex:0 0 auto') + _pmtInput(m, 'timeStart', '', 'time', 'flex:0 0 auto') +
      '<span style="color:var(--t6);font-size:10px">~</span>' + _pmtInput(m, 'timeEnd', '', 'time', 'flex:0 0 auto') + '</span>' +
    '<span style="' + lbl + '">장소</span>' + _pmtInput(m, 'place', '회의실·온라인 링크 등', 'text', 'width:100%') +
    '<span style="' + lbl + '">작성자</span>' + _pmtInput(m, 'writer', '', 'text', 'width:100%', 'pmtPeople') +
    '<span style="' + lbl + '">참석자</span>' + _pmtInput(m, 'attendees', '쉼표로 구분 (예: 박설계, 김전장)', 'text', 'width:100%', 'pmtPeople') +
  '</div>' + _pmtPeopleDatalist();
}

function _pmtAgendaHtml(m) {
  var mid = _pmtJs(m.id);
  return m.agenda.map(function (g, i) {
    return '<div style="display:flex;align-items:center;gap:6px;padding:2px 0;font-size:11px">' +
      '<span style="cursor:pointer" onclick="pmtAgendaToggle(\'' + mid + '\',' + i + ')">' + (g.done ? '☑' : '☐') + '</span>' +
      '<span style="flex:1;word-break:break-word;color:' + (g.done ? 'var(--t5);text-decoration:line-through' : 'var(--t2)') + '">' + (i + 1) + '. ' + _pmtEsc(g.text) + '</span>' +
      '<button class="btn btn-g btn-s" style="font-size:9px;padding:0 5px" title="안건 삭제" onclick="pmtAgendaDel(\'' + mid + '\',' + i + ')">✕</button></div>';
  }).join('') +
  '<div style="display:flex;gap:3px;margin-top:3px"><input id="pmtAg-' + _pmtEsc(m.id) + '" class="si" placeholder="안건 추가 후 Enter" style="flex:1;font-size:10.5px;padding:3px 6px" onkeydown="if(event.key===\'Enter\')pmtAgendaAdd(\'' + mid + '\')">' +
  '<button class="btn btn-g btn-s" style="font-size:10px" onclick="pmtAgendaAdd(\'' + mid + '\')">+</button></div>';
}

function _pmtActsHtml(m, t) {
  var mid = _pmtJs(m.id);
  var acts = (m.actionItems || []).slice().sort(function (x, y) { return (x.status === 'done') - (y.status === 'done'); });
  var h = acts.map(function (a) {
    var aid = _pmtJs(a.id), done = a.status === 'done', late = !done && a.dueDate && a.dueDate < t;
    var linked = a.linkedIssueId ? '<span style="font-size:9px;color:#06B6D4;white-space:nowrap">→ 이슈</span>' : (a.linkedDevItemId ? '<span style="font-size:9px;color:' + SEM_COLOR.ok + ';white-space:nowrap">→ 개발</span>' : '');
    return '<div style="display:flex;align-items:center;gap:5px;padding:3px 0;font-size:10.5px;border-bottom:1px solid var(--bd)">' +
      '<span style="cursor:pointer" onclick="pmtActToggle(\'' + mid + '\',\'' + aid + '\',\'' + (done ? 'open' : 'done') + '\')">' + (done ? '☑' : '☐') + '</span>' +
      '<span style="flex:1;word-break:break-word;color:' + (done ? 'var(--t5);text-decoration:line-through' : 'var(--t2)') + '">' + _pmtEsc(a.title) +
        (a.assigneeName ? ' <span style="color:var(--t5)">@' + _pmtEsc(a.assigneeName) + '</span>' : '') + '</span>' +
      (a.dueDate ? '<span style="white-space:nowrap;color:' + (late ? SEM_COLOR.danger : 'var(--t6)') + ';font-weight:' + (late ? 700 : 400) + '">' + _pmtEsc(a.dueDate) + '</span>' : '') +
      linked +
      (a.linkedIssueId || a.linkedDevItemId || done ? '' :
        '<button class="btn btn-g btn-s" style="font-size:9px;padding:0 4px" title="이슈로 전환" onclick="pmtActConvert(\'' + mid + '\',\'' + aid + '\',\'issue\')">이슈</button>' +
        '<button class="btn btn-g btn-s" style="font-size:9px;padding:0 4px" title="개발 아이템으로 전환" onclick="pmtActConvert(\'' + mid + '\',\'' + aid + '\',\'dev\')">개발</button>') +
      '<button class="btn btn-g btn-s" style="font-size:9px;padding:0 4px" title="삭제" onclick="pmtActDel(\'' + mid + '\',\'' + aid + '\')">✕</button>' +
    '</div>';
  }).join('');
  h += '<div style="display:flex;gap:3px;margin-top:5px;flex-wrap:wrap">' +
    '<input id="pmtActT-' + _pmtEsc(m.id) + '" class="si" placeholder="할 일 (Enter 로 추가)" style="flex:2 1 120px;font-size:10.5px;padding:3px 6px" onkeydown="if(event.key===\'Enter\')pmtActAdd(\'' + mid + '\')">' +
    '<input id="pmtActA-' + _pmtEsc(m.id) + '" class="si" list="pmtPeople" placeholder="담당" style="flex:1 1 70px;font-size:10.5px;padding:3px 6px" onkeydown="if(event.key===\'Enter\')pmtActAdd(\'' + mid + '\')">' + _pmtPeopleDatalist() +
    '<input id="pmtActD-' + _pmtEsc(m.id) + '" type="date" class="si" style="width:auto;font-size:10.5px;padding:2px">' +
    '<button class="btn btn-g btn-s" style="font-size:10px" onclick="pmtActAdd(\'' + mid + '\')">+ 추가</button></div>';
  return h;
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
  var me = (typeof currentUser !== 'undefined' && currentUser) ? (currentUser.displayName || currentUser.name || '') : '';
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
  var dirty = _pmtDirty(mid);
  ['pmtDirtyDot-', 'pmtDirtyTxt-'].forEach(function (p) { var n = document.getElementById(p + mid); if (n) n.style.display = dirty ? 'inline' : 'none'; });
}
/* 양식 저장 — 제목·일시·참석자·논의 내용·양식 칸을 한 번에. 성공 여부 */
function pmtSaveForm(mid, quiet) {
  var m = _pmtFind(mid); if (!m) return Promise.resolve(false);
  if (!_pmtDirty(mid)) { if (!quiet) _pmtToast('바뀐 내용이 없습니다.'); return Promise.resolve(true); }
  var title = String(_pmtVal(m, 'title')).trim();
  if (!title) { _pmtToast('회의명을 입력하세요.', 'warn'); return Promise.resolve(false); }
  var form = {};
  ['timeStart', 'timeEnd', 'place', 'writer', 'decisions', 'nextDate', 'nextNote'].forEach(function (k) { form[k] = _pmtVal(m, k); });
  var patch = { title: title, meetDate: _pmtVal(m, 'meetDate') || null, attendees: _pmtSplit(_pmtVal(m, 'attendees')), minutes: _pmtVal(m, 'minutes'), form: form };
  return _pmtUpdate(mid, patch).then(function (ok) {
    if (!ok) return false;
    delete _pmt.drafts[mid];
    _pmtPaintCard(mid);
    if (!quiet) _pmtToast('회의록 저장됨', 'success');
    return true;
  });
}
/* 회의 필드 저장 → 서버 응답으로 갱신(액션은 그대로 유지). 성공 여부 */
function _pmtUpdate(mid, patch) {
  return apiFetch('/api/meetings/' + encodeURIComponent(mid), { method: 'PUT', body: JSON.stringify(patch) }).then(function (r) {
    var old = _pmtFind(mid); if (!old) return false;
    var m = _pmtNorm(r.data); m.actionItems = old.actionItems;
    _pmtReplace(m);
    return true;
  }).catch(function (e) { _pmtToast('❌ ' + _pmtErr(e, '저장 실패'), 'error'); return false; });
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
        apiFetch('/api/meetings/' + encodeURIComponent(mid) + '/render', { method: 'POST', body: '{}' }),
        apiFetch('/api/meetings/' + encodeURIComponent(mid) + '/mail-recipients').catch(function () { return { data: [] }; })
      ]);
    }).then(function (res) { _pmtBuildPreview(mid, res[0].data, res[1].data || [], focusMail); });
  }, 'pmtPreviewModal', { timeoutMs: 15000 });
}
function _pmtBuildPreview(mid, doc, recips, focusMail) {
  var sent = doc.mailedAt ? '<div style="font-size:10px;color:var(--t5);margin-top:4px">마지막 발송: ' + _pmtEsc(String(doc.mailedAt).slice(0, 16).replace('T', ' ')) + ' · ' + _pmtEsc(doc.mailedByName || '') + ' · ' + (doc.mailedTo || []).length + '명</div>' : '';
  var people = recips.map(function (r, i) {
    return '<label style="display:inline-flex;align-items:center;gap:3px;font-size:11px;border:1px solid var(--bd);border-radius:12px;padding:2px 8px;margin:0 4px 4px 0;' + (r.hasEmail ? '' : 'opacity:.5') + '" title="' + _pmtEsc(r.hasEmail ? r.masked : '계정·메일 주소를 찾지 못함 — 아래에 주소를 직접 넣으세요') + '">' +
      '<input type="checkbox" class="pmt-rc" data-name="' + _pmtEsc(r.name) + '"' + (r.hasEmail ? ' checked' : ' disabled') + '> ' + _pmtEsc(r.name) + (r.hasEmail ? '' : ' (메일 없음)') + '</label>';
  }).join('');
  var html =
    '<div style="display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:12px">' +
      '<div style="border:1px solid var(--bd);border-radius:8px;overflow:hidden;background:#fff"><iframe id="pmtPreviewFrame" style="width:100%;height:68vh;border:0;background:#fff"></iframe></div>' +
      '<div style="display:flex;flex-direction:column;gap:8px">' +
        '<button class="btn btn-g btn-s" style="font-size:11px" onclick="pmtPrint()">🖨 인쇄 / PDF 저장</button>' +
        '<div style="border:1px solid var(--bd);border-radius:8px;padding:8px 10px">' +
          '<div style="font-size:11.5px;font-weight:700;color:var(--t2);margin-bottom:6px">✉ 메일 보내기</div>' +
          '<div style="font-size:10px;color:var(--t5);margin-bottom:3px">참석자</div>' +
          (people || '<div style="font-size:10px;color:var(--t6);margin-bottom:4px">참석자가 없습니다.</div>') +
          '<div style="font-size:10px;color:var(--t5);margin:6px 0 3px">직접 입력 (쉼표로 구분)</div>' +
          '<input id="pmtMailExtra" class="si" placeholder="name@company.com, …" style="width:100%;box-sizing:border-box;font-size:11px;padding:4px 7px">' +
          '<div style="font-size:10px;color:var(--t5);margin:6px 0 3px">머리말 (선택)</div>' +
          '<textarea id="pmtMailMsg" class="si" rows="3" placeholder="예: 오늘 회의 내용 공유드립니다." style="width:100%;box-sizing:border-box;font-size:11px;padding:4px 7px;resize:vertical"></textarea>' +
          '<button class="btn btn-p btn-s" id="pmtMailBtn" style="width:100%;margin-top:6px;font-size:11px" onclick="pmtSendMail(\'' + _pmtJs(mid) + '\')">보내기</button>' +
          '<div style="font-size:9.5px;color:var(--t6);margin-top:5px;line-height:1.5">받는 사람끼리는 주소가 보이지 않게 숨은 참조로 보냅니다. 답장은 보낸 사람에게 갑니다.</div>' +
          sent +
        '</div>' +
      '</div>' +
    '</div>';
  createModal({ id: 'pmtPreviewModal', titleText: '📄 회의록 미리 보기', html: html, width: '1080px', boxStyle: 'max-height:92vh', closeOnEsc: true });
  var fr = document.getElementById('pmtPreviewFrame');
  if (fr) fr.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><title>' + _pmtEsc(doc.subject) + '</title><style>@page{margin:16mm}body{margin:18px;background:#fff}</style></head><body>' + doc.html + '</body></html>';
  if (focusMail) { var ex = document.getElementById('pmtMailExtra'); if (ex) setTimeout(function () { ex.focus(); }, 50); }
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
  var btn = document.getElementById('pmtMailBtn'); if (btn) { btn.disabled = true; btn.textContent = '보내는 중...'; }
  apiFetch('/api/meetings/' + encodeURIComponent(mid) + '/mail', { method: 'POST', body: JSON.stringify({ attendees: names, emails: emails, message: msg }), timeoutMs: 45000 }).then(function (r) {
    var m = _pmtFind(mid); if (m) { m.mailedAt = r.data.mailedAt; _pmtPaintCard(mid); }
    var ov = document.getElementById('pmtPreviewModal'); if (ov) ov.remove();
    _pmtToast('✉ ' + (r.message || '보냈습니다.'), 'success');
  }).catch(function (e) {
    if (btn) { btn.disabled = false; btn.textContent = '보내기'; }
    _pmtToast('❌ ' + _pmtErr(e, '메일 전송 실패'), 'error');
  });
}

/* 안건 */
function _pmtSaveAgenda(mid, agenda) {
  return _pmtUpdate(mid, { agenda: agenda }).then(function (ok) { if (ok) _pmtPaintCard(mid); return ok; });
}
function pmtAgendaAdd(mid) {
  var inp = document.getElementById('pmtAg-' + mid), text = inp ? inp.value.trim() : '';
  if (!text) return;
  var m = _pmtFind(mid); if (!m) return;
  _pmtSaveAgenda(mid, m.agenda.concat([{ text: text, done: false }])).then(function (ok) { if (ok) { var n = document.getElementById('pmtAg-' + mid); if (n) n.focus(); } });
}
function pmtAgendaToggle(mid, i) {
  var m = _pmtFind(mid); if (!m || !m.agenda[i]) return;
  var ag = m.agenda.map(function (g, j) { return j === i ? { text: g.text, done: !g.done } : g; });
  _pmtSaveAgenda(mid, ag);
}
function pmtAgendaDel(mid, i) {
  var m = _pmtFind(mid); if (!m) return;
  _pmtSaveAgenda(mid, m.agenda.filter(function (g, j) { return j !== i; }));
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
  span.innerHTML = '<b style="color:var(--t2)">회의 ' + _pmt.list.length + '</b> · 미완료 액션 <b style="color:var(--t2)">' + n + '</b>' + (late ? ' · <b style="color:' + SEM_COLOR.danger + '">기한 지남 ' + late + '</b>' : '');
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
