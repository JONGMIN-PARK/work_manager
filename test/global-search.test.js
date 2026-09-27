// search-notif.js 통합 검색 — 카테고리 매처 레지스트리(GS_MATCHERS) + 렌더러(gsRenderResults)
// 실행: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load() {
  const dd = { style: { display: 'none' }, innerHTML: '' };
  const sandbox = {
    console, setTimeout, clearTimeout, Promise, JSON, Math, Object, Array, String, Number, Set, Date, RegExp,
    window: {},
    document: { getElementById(id) { return id === 'globalSearchDropdown' ? dd : null; }, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    // wm-state.js 와 같은 eH
    eH: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    aliasMap: {}, memberGroups: [],
  };
  vm.createContext(sandbox);
  for (const f of ['config.js', 'search-notif.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), sandbox, { filename: f });
  }
  sandbox.dd = dd;
  return sandbox;
}

function seed(s, d) {
  vm.runInContext('_gsCache=null', s);
  s.projGetAll = async () => d.projects || [];
  s.msGetAll = async () => d.milestones || [];
  s.issueGetAll = async () => d.issues || [];
  s.orderGetAll = async () => d.orders || [];
  s.evtGetAll = async () => d.events || [];
  s.aliasMap = d.aliasMap || {};
  s.memberGroups = d.memberGroups || [];
}

test('레지스트리: 카테고리 순서·상한', () => {
  const s = load();
  const keys = vm.runInContext('GS_MATCHERS.map(function(m){return m.key+":"+m.limit})', s);
  assert.deepStrictEqual(Array.from(keys), ['project:5', 'milestone:4', 'issue:5', 'order:5', 'event:4', 'archive:3', 'member:4', 'group:3']);
});

test('결과 없음 → gs-empty', async () => {
  const s = load();
  seed(s, {});
  await s.globalSearch('없는말');
  assert.strictEqual(s.dd.innerHTML, '<div class="gs-empty">검색 결과 없음</div>');
  assert.strictEqual(s.dd.style.display, 'block');
});

test('빈 검색어 → 드롭다운 숨김', async () => {
  const s = load();
  s.dd.style.display = 'block';
  await s.globalSearch('   ');
  assert.strictEqual(s.dd.style.display, 'none');
});

test('카테고리별 매칭·상한·필드 힌트·색상', async () => {
  const s = load();
  const projects = [];
  for (let i = 0; i < 7; i++) projects.push({ id: 'p' + i, name: '검토 ' + i, orderNo: 'AM-' + i, status: 'active' });
  projects.push({ id: 'px', name: '다른것', orderNo: 'X', memo: '검토 메모', status: 'done' });
  seed(s, {
    projects,
    milestones: [{ id: 'm1', projectId: 'p0', name: '설계 검토' }],
    issues: [{ id: 'i1', title: '긴급 건', urgency: 'urgent', status: 'open', description: '검토 필요' }],
    orders: [{ orderNo: 'AM-9', name: '수주', client: '검토사' }],
    events: [{ id: 'e1', title: '검토 회의', type: 'meeting', startDate: '2026-09-24' }],
    aliasMap: { '검토자': 'RV' },
    memberGroups: [{ id: 'g1', name: '팀', members: ['검토자'] }],
  });
  await s.globalSearch('검토');
  const html = s.dd.innerHTML;
  // 프로젝트는 5건으로 잘림 (8건 매칭)
  assert.match(html, /📁 프로젝트 \(5\)/);
  assert.match(html, /◆ 마일스톤 \(1\)/);
  assert.match(html, /🎫 이슈 \(1\)/);
  assert.match(html, /📋 수주 \(1\)/);
  assert.match(html, /📅 일정 \(1\)/);
  assert.match(html, /👤 팀원 \(1\)/);
  assert.match(html, /👥 그룹 \(1\)/);
  assert.doesNotMatch(html, /아카이브/);
  assert.match(html, />11건 발견</);
  // 표시 순서
  const order = ['📁', '◆ 마일스톤', '🎫 이슈', '📋 수주', '📅 일정', '👤 팀원', '👥 그룹'].map((k) => html.indexOf('<div class="gs-group">' + k));
  assert.deepStrictEqual(order.slice().sort((a, b) => a - b), order);
  // 이슈는 description 으로 걸림 → [설명] 힌트, urgent → danger 색
  assert.match(html, /\[설명\]/);
  assert.match(html, /style="color:#EF4444">🎫/);
  // 마일스톤 아이콘 = purple, 수주 거래처 힌트
  assert.match(html, /style="color:#8B5CF6">◆/);
  assert.match(html, /\[거래처\]/);
  // 하이라이트
  assert.match(html, /<mark [^>]*>검토<\/mark> 0/);
});

test('gsRenderResults: 헤더 + 그룹 순서대로', () => {
  const s = load();
  const out = vm.runInContext(`gsRenderResults(GS_MATCHERS.map(function(m){return {m:m,hits:m.key==='member'?[{realName:'가',alias:''}]:[]}}),'가',{})`, s);
  assert.ok(out.startsWith('<div style="padding:6px 10px;'));
  assert.match(out, />1건 발견</);
  assert.match(out, /<div class="gs-group">👤 팀원 \(1\)<\/div><div class="gs-item" onclick="globalSearchNav\('member','가'\)">/);
});
