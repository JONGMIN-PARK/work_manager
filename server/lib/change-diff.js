/**
 * 저장 전·후 비교 → 텔레그램 알림용 변경 항목 (순수 함수, DB 없음) — v13.215
 *
 * 항목 형식 (services/notification/change-feed.js 가 모아서 합친다)
 *  { key, label, from, to }  값 변경 — 같은 key 가 다시 오면 처음 from · 마지막 to 로 합치고, 같아지면 버린다
 *  { key, text }             문장 그대로 — 같은 key 는 마지막 것
 *  { key, label, list }      목록 누적 — 같은 key 는 합집합 (사양서 항목 이름 등)
 */

var PROJECT_STATUS = { waiting: '대기', active: '진행중', delayed: '지연', done: '완료', hold: '보류' };
var PHASE = require('./project-defaults').PHASE_LABEL;   // 단계 이름 단일 정의 (옛 'as' 도 완료로)
var MS_STATUS = { waiting: '대기', active: '진행', in_progress: '진행', progress: '진행', done: '완료', delayed: '지연', hold: '보류' };
var WR_STATUS = { done: '완료', in_progress: '진행중', none: '' };

function str(v) { return v == null ? '' : String(v); }
function clip(s, n) { s = str(s).replace(/\s+/g, ' ').trim(); n = n || 60; return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function md(ymd) { var s = str(ymd); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(5, 7) + '/' + s.slice(8, 10) : s; }
function range(a, b) { return (a || b) ? md(a) + '~' + md(b) : '-'; }
function parseJson(v, dflt) {
  if (v == null || v === '') return dflt;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (_) { return dflt; }
}
/** 키 순서와 무관한 JSON 문자열 (jsonb 는 키 순서를 바꿔 저장한다) */
function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + stable(v[k]); }).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
function personName(a) { return a && typeof a === 'object' ? str(a.name || a.userName || a.id) : str(a); }

/**
 * 프로젝트 PUT — prev(DB 행) vs clean(저장한 컬럼, JSON 컬럼은 문자열)
 */
function diffProject(prev, clean) {
  var out = [];
  prev = prev || {};
  function val(k, fmt) {
    if (clean[k] === undefined) return;
    var o = str(prev[k]), n = str(clean[k]);
    if (o === n) return;
    out.push({ key: 'p:' + k, label: fmt.label, from: fmt.f ? fmt.f(prev[k]) : o, to: fmt.f ? fmt.f(clean[k]) : n });
  }
  val('name', { label: '이름' });
  val('order_no', { label: '수주번호' });
  val('status', { label: '상태', f: function (v) { return PROJECT_STATUS[v] || str(v); } });
  val('current_phase', { label: '단계', f: function (v) { return PHASE[v] || str(v); } });
  val('progress', { label: '진척률', f: function (v) { return v == null || v === '' ? '' : (+v) + '%'; } });
  val('start_date', { label: '시작일' });
  val('end_date', { label: '종료일' });
  val('estimated_hours', { label: '예상시간', f: function (v) { return v == null || v === '' ? '' : (+v) + 'h'; } });
  val('visibility', { label: '공개범위', f: function (v) { return ({ private: '비공개', dept: '부서', tenant: '전체' })[v] || str(v); } });

  if (clean.assignees !== undefined) {
    var oa = parseJson(prev.assignees, []).map(personName).filter(Boolean);
    var na = parseJson(clean.assignees, []).map(personName).filter(Boolean);
    var added = na.filter(function (x) { return oa.indexOf(x) < 0; });
    var removed = oa.filter(function (x) { return na.indexOf(x) < 0; });
    if (added.length || removed.length) {
      out.push({ key: 'p:assignees', text: '담당자 ' + [added.length ? '+' + added.join(', +') : '', removed.length ? '-' + removed.join(', -') : ''].filter(Boolean).join(' ') });
    }
  }
  if (clean.memo !== undefined && str(clean.memo) !== str(prev.memo)) {
    out.push({ key: 'p:memo', text: '메모 수정' + (str(clean.memo).trim() ? ': ' + clip(clean.memo, 80) : ' (비움)') });
  }
  if (clean.phases !== undefined && stable(parseJson(clean.phases, {})) !== stable(parseJson(prev.phases, {}))) {
    out.push({ key: 'p:phases', text: '단계별 일정 수정' });
  }
  if (clean.dependencies !== undefined && stable(parseJson(clean.dependencies, [])) !== stable(parseJson(prev.dependencies, []))) {
    out.push({ key: 'p:deps', text: '선행 프로젝트 변경' });
  }
  if (clean.specs !== undefined && stable(parseJson(clean.specs, {})) !== stable(parseJson(prev.specs, {}))) {
    out.push({ key: 'p:specs', text: '사양서 수정' });
  }
  return out;
}

/** 마일스톤 수정 — prev/next 는 DB 행. 완료(done) 전환은 milestone_complete 알림이 따로 가므로 뺀다 */
function diffMilestone(prev, next) {
  var out = [];
  if (!prev || !next) return out;
  var nm = '마일스톤 \'' + clip(next.name || prev.name, 30) + '\'';
  if (str(prev.name) !== str(next.name)) out.push({ key: 'ms:' + next.id + ':name', label: '마일스톤 이름', from: str(prev.name), to: str(next.name) });
  if (str(prev.start_date) !== str(next.start_date) || str(prev.end_date) !== str(next.end_date)) {
    out.push({ key: 'ms:' + next.id + ':date', label: nm + ' 일정', from: range(prev.start_date, prev.end_date), to: range(next.start_date, next.end_date) });
  }
  if (str(prev.status) !== str(next.status) && next.status !== 'done') {
    out.push({ key: 'ms:' + next.id + ':status', label: nm + ' 상태', from: MS_STATUS[prev.status] || str(prev.status), to: MS_STATUS[next.status] || str(next.status) });
  }
  return out;
}

function msCreated(row) {
  return { key: 'ms:' + row.id + ':life', text: '마일스톤 추가: ' + clip(row.name, 40) + ((row.start_date || row.end_date) ? ' (' + range(row.start_date, row.end_date) + ')' : '') };
}
function msDeleted(row) {
  return { key: 'ms:' + row.id + ':life', text: '마일스톤 삭제: ' + clip(row.name, 40) };
}

/** 체크리스트 items 비교 — 항목 고유 iid 로 맞추고, 없으면 글자로 */
function diffChecklist(prevItems, nextItems, phase) {
  var pre = phase ? '[' + (PHASE[phase] || phase) + '] ' : '';
  var a = parseJson(prevItems, []) || [], b = parseJson(nextItems, []) || [];
  function idOf(it) { return it && (it.iid || ('t:' + str(it.text))); }
  var pm = {};
  a.forEach(function (it) { if (it) pm[idOf(it)] = it; });
  var seen = {};
  var out = [];
  b.forEach(function (it) {
    if (!it) return;
    var id = idOf(it);
    seen[id] = true;
    var o = pm[id];
    if (!o) { out.push({ key: 'chk:' + id + ':life', text: '체크리스트 추가: ' + pre + clip(it.text) }); return; }
    if (!!o.done !== !!it.done) {
      out.push({ key: 'chk:' + id + ':done', label: '체크리스트 ' + pre + clip(it.text), from: o.done ? '☑' : '☐', to: it.done ? '☑' : '☐' });
    }
    if (str(o.text) !== str(it.text)) out.push({ key: 'chk:' + id + ':text', label: '체크리스트 수정', from: clip(o.text, 40), to: clip(it.text, 40) });
    if (str(o.dueDate) !== str(it.dueDate)) out.push({ key: 'chk:' + id + ':due', label: '체크리스트 기한 ' + pre + clip(it.text, 30), from: md(o.dueDate) || '없음', to: md(it.dueDate) || '없음' });
  });
  a.forEach(function (it) {
    if (it && !seen[idOf(it)]) out.push({ key: 'chk:' + idOf(it) + ':life', text: '체크리스트 삭제: ' + pre + clip(it.text) });
  });
  return out;
}

/** 사양서 PATCH 의 적용된 변경 → 항목 이름 목록 하나 */
function specChanges(applied) {
  var names = [];
  (applied || []).forEach(function (c) {
    var p = c.path || [];
    if (p[0] === 'templateId' || p[0] === 'templateVersion') { if (names.indexOf('템플릿') < 0) names.push('템플릿'); return; }
    var nm = str(c.label) || p.filter(function (x) { return typeof x === 'string' && !/^r[0-9a-z]+$/i.test(x); }).slice(-1)[0] || '';
    if (nm && names.indexOf(nm) < 0) names.push(nm);
  });
  return names.length ? [{ key: 'spec', label: '사양서 수정', list: names }] : [];
}

/**
 * 주간업무보고 — 이전 저장본 vs 이번 저장본의 이번 주(cur) 항목.
 * 반환 [{ kind: 'add'|'del'|'mod', client, name, detail }]
 */
function diffWeeklyItems(prevItems, curItems) {
  function keyOf(it) { return str(it.client).trim() + '|' + str(it.name).replace(/\s+/g, ' ').trim(); }
  function stat(it) {
    var s = [];
    if (WR_STATUS[it.status]) s.push(WR_STATUS[it.status]);
    if (typeof it.pct === 'number' && it.pct >= 0) s.push(it.pct + '%');
    if (it.deadline) s.push(it.deadline);
    if ((it.members || []).length) s.push('@' + it.members.join(' @'));
    return s.join(' · ');
  }
  var pm = {};
  (prevItems || []).forEach(function (it) { pm[keyOf(it)] = it; });
  var seen = {};
  var out = [];
  (curItems || []).forEach(function (it) {
    var k = keyOf(it);
    if (seen[k]) return;
    seen[k] = true;
    var o = pm[k];
    if (!o) { out.push({ kind: 'add', client: it.client, name: it.name, detail: stat(it) }); return; }
    var ch = [];
    if (o.status !== it.status) ch.push((WR_STATUS[o.status] || '미표시') + '→' + (WR_STATUS[it.status] || '미표시'));
    if (o.pct !== it.pct) ch.push((o.pct >= 0 ? o.pct + '%' : '-') + '→' + (it.pct >= 0 ? it.pct + '%' : '-'));
    if (str(o.deadline) !== str(it.deadline)) ch.push('기한 ' + (o.deadline || '-') + '→' + (it.deadline || '-'));
    var om = (o.members || []).join(','), nmb = (it.members || []).join(',');
    if (om !== nmb) ch.push('담당 ' + (nmb ? '@' + (it.members || []).join(' @') : '없음'));
    var od = (o.details || []).map(function (d) { return str(d.text); });
    var nd = (it.details || []).map(function (d) { return str(d.text); });
    var addD = nd.filter(function (t) { return od.indexOf(t) < 0; });
    var delD = od.filter(function (t) { return nd.indexOf(t) < 0; });
    if (addD.length) ch.push('+ ' + clip(addD[0], 50) + (addD.length > 1 ? ' 외 ' + (addD.length - 1) + '줄' : ''));
    if (delD.length && !addD.length) ch.push('세부 ' + delD.length + '줄 삭제');
    if (ch.length) out.push({ kind: 'mod', client: it.client, name: it.name, detail: ch.join(' · ') });
  });
  (prevItems || []).forEach(function (it) {
    if (!seen[keyOf(it)]) out.push({ kind: 'del', client: it.client, name: it.name, detail: '' });
  });
  return out;
}

module.exports = {
  diffProject: diffProject,
  diffMilestone: diffMilestone,
  msCreated: msCreated,
  msDeleted: msDeleted,
  diffChecklist: diffChecklist,
  specChanges: specChanges,
  diffWeeklyItems: diffWeeklyItems,
  stable: stable
};
