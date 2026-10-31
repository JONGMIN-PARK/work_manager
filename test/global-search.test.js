// search-notif.js 통합 검색 (v13.291) — 서버 /api/search 결과 렌더 · 범주 칩 · 최근 검색어 · 그룹(로컬)
// 서버 쪽 snippet · LIKE 이스케이프는 server/routes/search.js 의 _test 로 함께 확인.
// 실행: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(apiResult) {
  const dd = { style: { display: 'none' }, innerHTML: '' };
  const store = {};
  const sandbox = {
    console, setTimeout, clearTimeout, Promise, JSON, Math, Object, Array, String, Number, Set, Date, RegExp, encodeURIComponent,
    window: {},
    document: { getElementById(id) { return id === 'globalSearchDropdown' ? dd : null; }, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    eH: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    eA: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    lsGetJSON: (k, d) => (k in store ? JSON.parse(store[k]) : d),
    lsSetJSON: (k, v) => { store[k] = JSON.stringify(v); },
    memberGroups: [],
    calls: [],
  };
  sandbox.apiFetch = async (url) => { sandbox.calls.push(url); return { data: typeof apiResult === 'function' ? apiResult(url) : apiResult }; };
  vm.createContext(sandbox);
  for (const f of ['config.js', 'search-notif.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), sandbox, { filename: f });
  }
  sandbox.dd = dd;
  return sandbox;
}

const RES = { q: '과열', groups: [
  { key: 'work', total: 12, items: [{ id: '1', title: '모터 과열 원인 검토', sub: '2026-10-30 · 김팀원', nav: {} }] },
  { key: 'meeting', total: 1, items: [{ id: 'm1', title: '설계 회의', sub: '2026-10-29', snippet: '[회의록] …모터 과열 대책…', nav: { projectId: 'p1', meetingId: 'm1' } }] }
] };

test('서버 결과 → 범주 칩 · 그룹 · 문맥 줄 · 더 보기', async () => {
  const s = load(RES);
  await s.globalSearch('과열');
  const h = s.dd.innerHTML;
  assert.strictEqual(s.calls[0], '/api/search?q=%EA%B3%BC%EC%97%B4');
  assert.strictEqual(s.dd.style.display, 'flex');
  assert.match(h, /<span>13건<\/span>/);
  assert.match(h, /class="gs-chip on" onclick="gsOnly\(null\)">전체/);
  assert.match(h, /📒 업무일지 <b>12<\/b>/);
  assert.match(h, /모터 <mark>과열<\/mark> 원인 검토/);
  assert.match(h, /class="gs-snip">\[회의록\] …모터 <mark>과열<\/mark> 대책…/);
  assert.match(h, /gs-more" onclick="gsOnly\('work'\)">\+11건 더 보기/);
  assert.ok(h.indexOf('📒 업무일지') < h.indexOf('🗓 회의'), '서버 순서대로');
});

test('결과 없음 · 검색어 HTML 이스케이프', async () => {
  const s = load({ q: '<x>', groups: [] });
  await s.globalSearch('<x>');
  assert.match(s.dd.innerHTML, /「&lt;x&gt;」 검색 결과 없음/);
});

test('범주 칩 → cat 으로 그 범주만 다시 받고, 다른 칩 숫자는 유지', async () => {
  const s = load((url) => /cat=work/.test(url)
    ? { q: '과열', groups: [{ key: 'work', total: 12, items: Array.from({ length: 12 }, (_, i) => ({ id: String(i), title: '과열 ' + i, nav: {} })) }] }
    : RES);
  await s.globalSearch('과열');
  await s.globalSearch('과열', 'work');
  assert.match(s.calls[1], /&cat=work$/);
  const h = s.dd.innerHTML;
  assert.match(h, /class="gs-chip on" onclick="gsOnly\('work'\)"/);
  assert.match(h, /🗓 회의 <b>1<\/b>/, '회의 칩 숫자 유지');
  assert.strictEqual((h.match(/class="gs-item"/g) || []).length, 12);
  assert.ok(!/gs-more/.test(h));
});

test('그룹은 설정(memberGroups)에서 로컬로 찾아 붙임', async () => {
  const s = load({ q: '설계', groups: [] });
  s.memberGroups = [{ id: 'g1', name: '설계팀', members: ['가', '나'] }];
  await s.globalSearch('설계');
  assert.match(s.dd.innerHTML, /👥 그룹 <b>1<\/b>/);
  assert.match(s.dd.innerHTML, /<mark>설계<\/mark>팀/);
});

test('최근 검색어 — 고르면 기억, 빈 칸에서 보여 줌', async () => {
  const s = load(RES);
  await s.globalSearch('과열');
  s.globalSearchNav = () => {};   // 화면 이동은 여기서 안 봄
  s.gsPick('work', 0);
  await s.globalSearch('');
  assert.match(s.dd.innerHTML, /최근 검색/);
  assert.match(s.dd.innerHTML, /data-q="과열"/);
});

test('늦게 온 앞 검색 응답은 버림', async () => {
  let release;
  const slow = new Promise((r) => { release = r; });
  const s = load(RES);
  s.apiFetch = async (url) => { s.calls.push(url); if (/q=a$/.test(url)) { await slow; return { data: { q: 'a', groups: [{ key: 'order', total: 1, items: [{ id: 'o', title: 'aaa', nav: {} }] }] } }; } return { data: RES }; };
  const p1 = s.globalSearch('a');
  await s.globalSearch('과열');
  release(); await p1;
  assert.match(s.dd.innerHTML, /과열/);
  assert.ok(!/aaa/.test(s.dd.innerHTML));
});

test('서버 도우미 — LIKE 이스케이프 · 문맥 줄 · 트리에서 노드 찾기', () => {
  const t = require(path.join(__dirname, '..', 'server', 'routes', 'search.js'))._test;
  assert.strictEqual(t.likeOf('50%_a\\b'), '%50\\%\\_a\\\\b%');
  assert.strictEqual(t.snippetOf('가'.repeat(50) + '과열' + '나'.repeat(50), '과열'), '…' + '가'.repeat(34) + '과열' + '나'.repeat(34) + '…');
  assert.strictEqual(t.snippetOf('없음', '과열'), null);
  const doc = { root: { id: 'r', text: '루트', children: [{ id: 'a', text: '하위', children: [{ id: 'b', text: '모터 과열', children: [] }] }] } };
  assert.deepStrictEqual(t.findNode(doc, '과열'), { id: 'b', text: '모터 과열' });
  assert.strictEqual(t.firstSnip('과열', [['과열 메모', '메모']], '과열 제목'), null, '제목에서 걸리면 문맥 생략');
  assert.strictEqual(t.firstSnip('과열', [[null, 'x'], [['가', '과열'], '태그']], '제목'), '[태그] 가, 과열');
});
