// project-detail.js 테스트 하네스 — vm 샌드박스 + 가짜 DOM + 고정 픽스처
// (테스트 파일이 아님: test/*.test.js 글롭에 걸리지 않음)
'use strict';
process.env.TZ = 'Asia/Seoul';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
// 2026-09-27(일) 10:00 KST
const NOW = Date.UTC(2026, 8, 27, 1, 0);

function eH(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

/* ── 가짜 DOM ──
   실제 생성(createElement)된 요소는 트리로 보관, innerHTML 문자열 안의 id 는
   "스텁 요소"로 돌려준다 (스텁이 채운 innerHTML 도 스냅샷에 포함). */
function makeDom() {
  const stubs = new Map();   // key → stub element
  function mkEl(tag) {
    const e = {
      tagName: String(tag).toUpperCase(), id: '', className: '', textContent: '', _html: '',
      style: { cssText: '', setProperty(k, v) { this[k] = String(v); }, getPropertyValue(k) { return this[k] || ''; } }, children: [], parentNode: null, _listeners: {},
      get innerHTML() { return this._html; },
      set innerHTML(v) { this._html = String(v); this.children = []; },
      appendChild(c) { if (c.parentNode) c.remove(); this.children.push(c); c.parentNode = this; return c; },
      remove() { if (this.parentNode) { const i = this.parentNode.children.indexOf(this); if (i >= 0) this.parentNode.children.splice(i, 1); this.parentNode = null; } },
      addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
      removeEventListener() {},
      setAttribute(k, v) { this[k] = v; }, getAttribute(k) { return this[k]; },
      focus() {}, setSelectionRange() {},
      querySelector() { return null; }, querySelectorAll() { return []; },
      get isConnected() { let p = this; while (p) { if (p === body) return true; p = p.parentNode; } return false; },
    };
    return e;
  }
  const body = mkEl('body');
  function walk(e, fn) { fn(e); e.children.forEach((c) => walk(c, fn)); }
  function allHtml() { let s = ''; walk(body, (e) => { s += e._html; }); stubs.forEach((st) => { s += st._html; }); return s; }
  function stub(key) {
    if (!stubs.has(key)) { const s = mkEl('stub'); s.id = key; s.value = ''; stubs.set(key, s); }
    return stubs.get(key);
  }
  const document = {
    body,
    createElement: mkEl,
    getElementById(id) {
      let found = null;
      walk(body, (e) => { if (!found && e.id === id) found = e; });
      if (found) return found;
      if (allHtml().indexOf('id="' + id + '"') >= 0) return stub(id);
      return null;
    },
    querySelector(sel) {
      const m = /data-msid="([^"]+)"/.exec(sel);
      if (m && allHtml().indexOf('data-msid="' + m[1] + '"') >= 0) return stub('qs:' + sel);
      return null;
    },
    querySelectorAll(sel) {
      const out = [];
      if (sel.charAt(0) === '.') { const cls = sel.slice(1); walk(body, (e) => { if (e !== body && (' ' + e.className + ' ').indexOf(' ' + cls + ' ') >= 0) out.push(e); }); }
      return out;
    },
    addEventListener() {}, removeEventListener() {},
  };
  function ser(e) {
    return '<' + e.tagName.toLowerCase() + (e.id ? ' id="' + e.id + '"' : '') + (e.className ? ' class="' + e.className + '"' : '') +
      ' style="' + e.style.cssText + '">' + (e.textContent || '') + e._html + e.children.map(ser).join('') + '</' + e.tagName.toLowerCase() + '>';
  }
  // 스냅샷: body 트리 직렬화 + 스텁(키 정렬) 내용
  function snapshot() {
    let s = body.children.map(ser).join('\n') + '\n';
    [...stubs.keys()].sort().forEach((k) => {
      const st = stubs.get(k);
      s += '\n<!-- stub ' + k + (st.style.display != null ? ' display=' + st.style.display : '') + ' -->\n' + st._html + '\n';
    });
    return s;
  }
  return { document, body, stubs, snapshot, stub };
}

/* ── 픽스처 ── */
function fixtures() {
  const proj = {
    id: 'p1', name: 'SP-100 <검사기> & 라인', color: '#123456', status: 'active', startDate: '2026-08-01', endDate: '2026-11-30',
    orderNo: 'OD-2026-01', memo: '메모 <b>본문</b>', assignees: ['김철수', '이영희'], progress: 45, actualHours: 30, estimatedHours: 120,
    currentPhase: 'design', phases: { order: { status: 'done' }, design: { status: 'active' } },
  };
  const milestones = [
    { id: 'm2', projectId: 'p1', name: '제작', order: 2, status: 'waiting', endDate: '2026-11-15', assigneeTargets: { '이영희': 20 }, progress: 0, reportedHours: 0 },
    { id: 'm1', projectId: 'p1', name: '설계 <1차>', order: 1, status: 'active', endDate: '2026-09-20', assigneeTargets: { '김철수': 10, '이영희': 5 },
      progress: 40, reportedHours: 18.5, progressNote: '- [ ] 배선 **점검**\n- [x] 도면 ==검토==\n[긴급] `code`', progressUpdatedBy: '김철수', progressUpdatedAt: '2026-09-27T07:00:00+09:00' },
    { id: 'm3', projectId: 'p1', name: '검수', order: 3, status: 'done', endDate: '2026-12-01', assigneeTargets: {}, progress: 100, reportedHours: 2 },
  ];
  const chk = [
    { id: 'c1', projectId: 'p1', phase: 'design', text: '도면 작성', done: true, doneDate: '2026-09-10', order: 2 },
    { id: 'c2', projectId: 'p1', phase: 'design', text: '검토 <회의>', done: false, order: 1, dueDate: '2026-09-01' },
    { id: 'c3', projectId: 'p1', phase: 'order', text: '계약', done: true, doneDate: '2026-08-02', order: 1 },
  ];
  const logs = {
    m1: [
      { id: 'l2', authorName: '김철수', hours: 8, progress: 40, note: '- [ ] 배선 **점검**', createdAt: '2026-09-27T07:00:00+09:00' },
      { id: 'l1', authorName: '이영희', hours: 6.5, progress: 20, note: '초기', createdAt: '2026-09-20T09:00:00+09:00' },
      { id: 'l0', authorName: '김철수', hours: 4, progress: 10, createdAt: '2026-09-10T09:00:00+09:00' },
    ],
    m2: [],
    m3: [{ id: 'l9', authorName: '박외부', hours: 2, progress: 100, createdAt: '2026-09-25T09:00:00+09:00' }, { id: 'l8', authorName: '', hours: 1 }],
  };
  const msHours = {
    m1: { hours: 12.34, people: { '김철수': 8, '이영희': 4.34 }, outPeople: { '외부인': 3 }, untagged: 2 },
    m2: { hours: 0, people: {}, untagged: 0 },
    m3: { hours: 5, people: { '김철수': 5 }, outPeople: { '외부인': 1, '협력사': 2.5 }, untagged: 0 },
    _meta: { untaggedCount: 2 },
  };
  const members = [{ userName: '김철수' }, { userName: '이영희' }, { userName: '최신입' }];
  const issues = [
    { id: 'i1', title: '누수 <긴급>', status: 'open', urgency: 'urgent', type: 'defect' },
    { id: 'i2', title: '문서', status: 'resolved', urgency: 'low', type: 'request' },
  ];
  return { proj, milestones, chk, logs, msHours, members, issues };
}

function clone(x) { return JSON.parse(JSON.stringify(x)); }

/* 샌드박스 로드. opts.fx: 픽스처 덮어쓰기, opts.user: currentUser, opts.src: project-detail.js 대체 소스 */
function load(opts) {
  opts = opts || {};
  const fx = Object.assign(fixtures(), opts.fx || {});
  const RealDate = Date;
  function FakeDate(...a) { return a.length ? new RealDate(...a) : new RealDate(NOW); }
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = () => NOW;
  FakeDate.UTC = RealDate.UTC; FakeDate.parse = RealDate.parse;
  const dom = makeDom();
  const calls = [];
  const sandbox = {
    console: { log() {}, warn() {}, error: (...a) => { calls.push(['console.error', a.map(String).join(' ')]); } },
    setTimeout, clearTimeout, Promise, JSON, Math, Object, Array, String, Number, Set, Map, RegExp, Error, isNaN, parseInt, parseFloat,
    Date: FakeDate,
    document: dom.document,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    confirm: () => true,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of ['config.js', 'project-data.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  }
  const src = opts.src != null ? opts.src : fs.readFileSync(path.join(ROOT, 'project-detail.js'), 'utf8');
  vm.runInContext(src, sandbox, { filename: 'project-detail.js' });

  // ── 데이터 게터/외부 모듈 스텁 (로드 후 덮어쓰기) ──
  const P = (v) => Promise.resolve(clone(v));
  Object.assign(sandbox, {
    eH,
    apiFetch: () => Promise.resolve(null),
    pmGetProjects: () => P([fx.proj].filter(Boolean)),
    projGetAll: () => P([fx.proj].filter(Boolean)),
    projGet: () => P(fx.proj),
    msGetAll: () => P(fx.milestones),
    msGetByProject: () => P(fx.milestones),
    chkGetByProject: () => P(fx.chk),
    projMembersGet: () => P(fx.members),
    msLogsGet: (mid) => P(fx.logs[mid] || []),
    calcHoursByMilestone: (pid, o) => { calls.push(['calcHoursByMilestone', pid, (o.memberNames || []).join(',')]); return P(fx.msHours); },
    issueGetByProject: () => P(fx.issues),
    getOrderInfo: (no) => ({ date: '2026-07-01', client: '거래처 <A>', delivery: '2026-12-01' }),
    shortName: (n) => String(n).slice(-2),
    getProgressHistory: () => P([]),
    techByTarget: () => P([{ status: 'available', techCode: 'T-01', techName: '비전 <검사>', techVersion: 'v2' }, { status: 'x', techName: '모션' }]),
    renderCommentThread: (k, id, cid) => { calls.push(['renderCommentThread', k, id, cid]); },
    isOperator: () => false,
    openCommentModal: () => {},
    showToast: (m, t) => { calls.push(['toast', m, t || '']); },
    userLookup: () => P([{ id: 'u1', displayName: '김철수' }, { id: 'u2', name: '이영희' }]),
    currentUser: opts.user !== undefined ? opts.user : { name: '김철수', display_name: '김철수', role: 'member' },
  });
  if (opts.after) opts.after(sandbox);
  return { s: sandbox, dom, calls, fx };
}

// 대기 중 promise / setTimeout(0) 소진
async function flush(n) { for (let i = 0; i < (n || 20); i++) await new Promise((r) => setTimeout(r, 0)); }

// 모달 오버레이 → 내용 HTML (수작업 오버레이 / createModal 공통)
function modalInner(ov) {
  if (!ov) return null;
  if (ov.children.length) {  // createModal: overlay > box > (header?) body div
    const box = ov.children[0];
    const bodyDiv = box.children[box.children.length - 1];
    return bodyDiv._html;
  }
  const m = /^<div style="[^"]*">([\s\S]*)<\/div>$/.exec(ov._html);
  return m ? m[1] : ov._html;
}

// 스냅샷 비교 (UPDATE_SNAPSHOTS=1 이면 기록)
function matchSnapshot(assert, name, actual) {
  const file = path.join(__dirname, 'project-detail-' + name + '.html');
  if (process.env.UPDATE_SNAPSHOTS === '1') { fs.writeFileSync(file, actual, 'utf8'); return; }
  assert.ok(fs.existsSync(file), 'snapshot missing (UPDATE_SNAPSHOTS=1 로 생성): ' + file);
  const expected = fs.readFileSync(file, 'utf8');
  assert.strictEqual(actual, expected, 'snapshot mismatch: ' + name);
}

module.exports = { load, flush, fixtures, modalInner, matchSnapshot, NOW };
