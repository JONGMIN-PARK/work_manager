// settings.js 백업/복원 — 서버 데이터 스냅샷 + 환경설정(localStorage) 왕복
// 실행: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function memStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    get length() { return m.size; },
    key(i) { return Array.from(m.keys())[i] ?? null; },
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
    dump() { return Object.fromEntries(m); },
  };
}

function load(storage) {
  const sandbox = {
    console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, Promise, JSON, Math, Object, Array, String, Number, Date,
    window: {},
    document: { getElementById() { return null; }, addEventListener() {}, createElement() { return { style: {} }; } },
    localStorage: storage,
    eH: (s) => String(s == null ? '' : s),
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'settings.js'), 'utf8'), sandbox, { filename: 'settings.js' });
  return sandbox;
}

const ROWS = {
  projGetAll: [{ id: 'p1', name: '장비 A' }], msGetAll: [{ id: 'm1' }, { id: 'm2' }], evtGetAll: [], orderGetAll: [{ orderNo: 'SO-1' }],
  issueGetAll: [{ id: 'i1' }], wrGetAll: [{ date: '2026-09-27', name: '김철수' }], folderGetAll: [], fileGetAll: [{ id: 'f1' }],
};
function getters(overrides) {
  const g = {};
  for (const k of Object.keys(ROWS)) g[k] = () => Promise.resolve(ROWS[k]);
  return Object.assign(g, overrides || {});
}

test('내보내기: 서버 스냅샷 + wa- 환경설정만 (토큰 등 다른 키 제외)', async () => {
  const ls = memStorage({ 'wa-aliases': '{"kim":"김철수"}', 'wa-theme': 'dark', wm_refresh: 'SECRET', accessToken: 'SECRET2' });
  const s = load(ls);
  const b = await s.buildBackupData({ getters: getters() });
  assert.strictEqual(b.version, 9);
  assert.strictEqual(b.source, 'server');
  assert.deepStrictEqual(Object.keys(b.localStorage).sort(), ['wa-aliases', 'wa-theme']);
  assert.strictEqual(b.stores.milestones.length, 2);
  assert.strictEqual(b.stores.projectFiles[0].id, 'f1');
  assert.deepStrictEqual(Array.from(b.errors), []);
});

test('내보내기: 실패하거나 없는 getter 는 errors 에 기록하고 나머지는 계속', async () => {
  const s = load(memStorage());
  const b = await s.buildBackupData({ getters: getters({ issueGetAll: () => Promise.reject(new Error('500')), fileGetAll: undefined }) });
  assert.deepStrictEqual(Array.from(b.errors).sort(), ['issues', 'projectFiles']);
  assert.strictEqual(b.stores.projects.length, 1);
  assert.ok(!('issues' in b.stores));
});

test('왕복: 내보낸 JSON 을 다른 브라우저에 복원 — 환경설정 복구 + 서버 동기화 설정 저장', async () => {
  const src = memStorage({ 'wa-aliases': '{"kim":"김철수"}', 'wa-groups': '[{"id":"g1","members":["a"]}]', 'wa-theme': 'dark', 'wa-abbrColors': 'not json' });
  const exported = JSON.stringify(await load(src).buildBackupData({ getters: getters() }));

  const dst = memStorage({ 'wa-theme': 'light', other: 'keep' });
  const s = load(dst);
  const backup = s.parseBackupText(exported);
  const puts = [];
  const res = await s.applyBackupPrefs(backup, { serverPut: (k, v) => { puts.push([k, v]); return Promise.resolve(true); } });

  assert.strictEqual(res.restored, 4);
  assert.strictEqual(res.serverSynced, 2);
  assert.deepStrictEqual(Array.from(res.failed), ['wa-abbrColors'], 'JSON 이 아닌 서버 설정은 실패로 보고');
  assert.deepStrictEqual(dst.dump(), {
    'wa-theme': 'dark', other: 'keep', 'wa-aliases': '{"kim":"김철수"}', 'wa-groups': '[{"id":"g1","members":["a"]}]', 'wa-abbrColors': 'not json',
  });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(puts)), [['aliases', { kim: '김철수' }], ['groups', [{ id: 'g1', members: ['a'] }]]]);
});

test('복원: wa- 가 아닌 키(토큰 주입 등)는 무시, 서버 저장 불가(false)면 로컬만', async () => {
  const dst = memStorage();
  const s = load(dst);
  const res = await s.applyBackupPrefs({ localStorage: { wm_refresh: 'EVIL', 'wa-aliases': '{}' } }, { serverPut: () => Promise.resolve(false) });
  assert.strictEqual(res.restored, 1);
  assert.strictEqual(res.serverSynced, 0);
  assert.strictEqual(dst.getItem('wm_refresh'), null);
});

test('parseBackupText: 옛 v8 파일 허용, 형식 틀리면 오류', () => {
  const s = load(memStorage());
  assert.ok(s.parseBackupText(JSON.stringify({ version: 8, stores: { projects: [] }, localStorage: { 'wa-x': '1' } })));
  assert.throws(() => s.parseBackupText('{"foo":1}'), /유효하지 않은/);
  assert.throws(() => s.parseBackupText('not json'));
});
