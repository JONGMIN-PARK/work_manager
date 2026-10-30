/**
 * 프로젝트 단계 · 기본 체크리스트 · 상태 규칙 — 서버 단일 정의 (v13.283, 순수 함수 · DB 없음)
 *
 *  저장 상태(projects.status) 는 active · hold · done 셋만.
 *   '대기(waiting)' · '지연(delayed)' 는 날짜로 계산해 보여 주기만 한다 (computeStatus / computeStatusSql).
 *  마일스톤 저장 상태는 waiting · active · done 셋만.
 *  단계: 수주 → 설계 → 제작 → 검수 → 납품 → 완료 (v13.277 마지막 단계 A/S → 완료. 옛 기록의 'as' 는 완료로 읽음)
 *  화면 쪽 같은 정의: project-data.js DEFAULT_CHECKLIST · PROJ_PHASE — 바꾸면 같이 바꾼다.
 */
var crypto = require('crypto');

var PHASES = [
  { key: 'order', label: '수주' },
  { key: 'design', label: '설계' },
  { key: 'manufacture', label: '제작' },
  { key: 'inspect', label: '검수' },
  { key: 'deliver', label: '납품' },
  { key: 'done', label: '완료' }
];
var PHASE_SEQ = PHASES.map(function (p) { return p.key; });
// 옛 기록('as' = A/S, v13.277 전) 도 완료로 읽는다
var PHASE_LABEL = PHASES.reduce(function (o, p) { o[p.key] = p.label; return o; }, {});
PHASE_LABEL.as = '완료';

var DEFAULT_CHECKLIST = {
  order: ['견적서 발행', '계약서 체결', '선급금 수령', '킥오프 미팅 완료', '요구사항 정의서 작성'],
  design: ['기구 설계 완료', '전장 설계 완료', 'SW 설계 완료', '설계 검토(DR) 완료', '자재 발주'],
  manufacture: ['자재 입고 확인', '기구 가공/조립 완료', '전장 배선 완료', 'SW 개발/탑재 완료', '단품 시험 완료'],
  inspect: ['자체 검수 완료', '검수 성적서 작성', '고객 입회 검수(FAT) 완료', '불량 시정 완료'],
  deliver: ['출하 검사 완료', '운송/설치 완료', '시운전 완료(SAT)', '운전 교육 완료', '인수인계서 서명'],
  done: ['잔금 수령', '하자보증 기간 설정', '정기점검 일정 등록', 'A/S 연락처 공유']
};

var STATUSES = ['active', 'hold', 'done'];
var MS_STATUSES = ['waiting', 'active', 'done'];

/** 한국 날짜 'YYYY-MM-DD' (서버는 UTC) */
function todayKST() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }
/** 'YYYYMMDD'(옛 형식) · 'YYYY-MM-DD…' → 'YYYY-MM-DD', 그 밖은 '' */
function ymd(v) {
  var s = v == null ? '' : String(v).trim();
  if (/^\d{8}$/.test(s)) return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

/** 기본 단계 일정 — 수주 단계는 진행(시작일 = startDate), 나머지는 대기 */
function defaultPhases(startDate) {
  var sd = ymd(startDate);
  var o = {};
  PHASE_SEQ.forEach(function (k, i) { o[k] = { status: i === 0 && sd ? 'active' : 'waiting', startDate: i === 0 ? sd : '', endDate: '' }; });
  return o;
}

/** 단계별 기본 체크리스트 [{ phase, items }] — items 는 화면(project-data.js createDefaultChecklists)과 같은 모양 */
function defaultChecklists() {
  return PHASE_SEQ.map(function (k) {
    return { phase: k, items: DEFAULT_CHECKLIST[k].map(function (text, idx) {
      return { iid: 'i' + crypto.randomBytes(5).toString('hex').slice(0, 8), text: text, done: false, doneDate: null, doneBy: null, order: idx };
    }) };
  });
}

/** 보여 줄 상태: 완료·보류는 그대로, 종료일 지남 → delayed, 시작 전 → waiting, 그 밖 active.
 *  p: { status, start_date|startDate, end_date|endDate } · today: 'YYYY-MM-DD' (생략 시 KST 오늘) */
function computeStatus(p, today) {
  p = p || {};
  var st = normalizeStatus(p.status);
  if (st === 'done' || st === 'hold') return st;
  var t = ymd(today) || todayKST();
  var ed = ymd(p.end_date !== undefined ? p.end_date : p.endDate);
  var sd = ymd(p.start_date !== undefined ? p.start_date : p.startDate);
  if (ed && ed < t) return 'delayed';
  if (sd && sd > t) return 'waiting';
  return 'active';
}

/** computeStatus 와 같은 규칙의 SQL 식. a: 테이블 별칭, todayRef: 오늘 날짜 자리('$1' 등) */
function computeStatusSql(a, todayRef) {
  var p = a ? a + '.' : '';
  function d(col) { return "(CASE WHEN " + p + col + " ~ '^[0-9]{8}$' THEN substr(" + p + col + ",1,4)||'-'||substr(" + p + col + ",5,2)||'-'||substr(" + p + col + ",7,2) ELSE substr(COALESCE(" + p + col + ",''),1,10) END)"; }
  return "(CASE WHEN " + p + "status IN ('done','hold') THEN " + p + "status " +
    "WHEN COALESCE(" + p + "end_date,'') <> '' AND " + d('end_date') + " < " + todayRef + " THEN 'delayed' " +
    "WHEN COALESCE(" + p + "start_date,'') <> '' AND " + d('start_date') + " > " + todayRef + " THEN 'waiting' ELSE 'active' END)";
}

/** 저장할 프로젝트 상태 — waiting · delayed · 모르는 값 → active */
function normalizeStatus(s) { return s === 'hold' || s === 'done' ? s : 'active'; }
/** 저장할 마일스톤 상태 — delayed → active, hold · 모르는 값 → waiting */
function normalizeMsStatus(s) {
  if (s === 'active' || s === 'done' || s === 'waiting') return s;
  if (s === 'delayed' || s === 'in_progress' || s === 'progress') return 'active';
  return 'waiting';
}

module.exports = {
  PHASES: PHASES, PHASE_SEQ: PHASE_SEQ, PHASE_LABEL: PHASE_LABEL, DEFAULT_CHECKLIST: DEFAULT_CHECKLIST,
  STATUSES: STATUSES, MS_STATUSES: MS_STATUSES,
  todayKST: todayKST, ymd: ymd, defaultPhases: defaultPhases, defaultChecklists: defaultChecklists,
  computeStatus: computeStatus, computeStatusSql: computeStatusSql,
  normalizeStatus: normalizeStatus, normalizeMsStatus: normalizeMsStatus
};
