// v13.431 DB 전체 백업 — 판정(backup-report) · 오래된 것 정리(backup-gcs) · 볼 수 있는 사람(data-export)
// 실행: node --test test/db-backup.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const report = require('../server/scripts/backup-report');
const { pickExpired } = require('../server/scripts/backup-gcs');

test('판정 — 같으면 성공, 테이블 빠지면 실패', () => {
  assert.strictEqual(report.judge({ a: 10, b: 5 }, { a: 10, b: 5 }).ok, true);
  const j = report.judge({ a: 10, b: 5 }, { a: 10 });
  assert.strictEqual(j.ok, false);
  assert.deepStrictEqual(j.missing, ['b']);
});

test('판정 — 백업 중 몇 줄 차이는 성공, 크게 모자라면 실패', () => {
  const small = report.judge({ logs: 1000 }, { logs: 997 });
  assert.strictEqual(small.ok, true);
  assert.strictEqual(small.diffs.length, 1);
  assert.strictEqual(report.judge({ logs: 1000 }, { logs: 500 }).ok, false);
  assert.strictEqual(report.judge({ tiny: 10 }, { tiny: 0 }).ok, true, '20줄 이하 차이는 실패로 보지 않음');
  assert.strictEqual(report.judge({}, {}).ok, false, '원본을 하나도 못 읽으면 실패');
});

test('보고서 — 파일 크기 · sha256 · 합계 · 요약', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-bk-'));
  fs.writeFileSync(path.join(dir, 's.csv'), 'users,3\nmindmap_images,2\n');
  fs.writeFileSync(path.join(dir, 'r.csv'), 'users,3\nmindmap_images,2\n');
  fs.writeFileSync(path.join(dir, 'wm-x.dump'), Buffer.alloc(2048, 7));
  const r = report.build(path.join(dir, 's.csv'), path.join(dir, 'r.csv'), path.join(dir, 'wm-x.dump'), '0', '12');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.tables, 2);
  assert.strictEqual(r.rows, 5);
  assert.strictEqual(r.bytes, 2048);
  assert.match(r.sha256, /^[0-9a-f]{64}$/);
  assert.match(r.summaryMd, /DB 백업 성공/);
});

test('정리 — 30일 지난 것만, 최근 7개는 늘 남김', () => {
  const now = Date.parse('2026-12-31T00:00:00Z');
  const objs = [];
  for (let i = 0; i < 10; i++) {
    const d = new Date(now - (i * 10) * 86400000);   // 0, 10, 20 … 90일 전
    const name = 'backups/db/wm-' + d.toISOString().slice(0, 10) + 'T0330';
    objs.push({ key: name + '.dump', updated: d.toISOString() }, { key: name + '.json', updated: d.toISOString() });
  }
  objs.push({ key: 'backups/db/latest.json', updated: new Date(now - 100 * 86400000).toISOString() });
  const del = pickExpired(objs, 'backups/db/', 30, now);
  // 최근 7개(0~60일 전)는 날짜가 지나도 남고, 70 · 80 · 90일 전 3개만 지움 (.dump + .json)
  assert.strictEqual(del.length, 6);
  assert.ok(del.every((k) => /wm-2026-(10-22|10-12|10-02)T0330\.(dump|json)$/.test(k)), del.join(','));
  assert.ok(!del.includes('backups/db/latest.json'));
  assert.strictEqual(pickExpired(objs.slice(0, 6), 'backups/db/', 30, now).length, 0);
});

test('볼 수 있는 사람 — 기본 회사 관리자 · 또는 BACKUP_ADMIN_EMAILS', () => {
  const { canSeeBackups } = require('../server/routes/data-export');
  const DEF = '00000000-0000-0000-0000-000000000001';
  const old = process.env.BACKUP_ADMIN_EMAILS;
  try {
    delete process.env.BACKUP_ADMIN_EMAILS;
    assert.strictEqual(canSeeBackups({ role: 'admin', tenantId: DEF, email: 'a@t.com' }), true);
    assert.strictEqual(canSeeBackups({ role: 'admin', tenantId: 'other', email: 'a@t.com' }), false, '다른 회사 관리자는 못 봄');
    assert.strictEqual(canSeeBackups({ role: 'member', tenantId: DEF }), false);
    process.env.BACKUP_ADMIN_EMAILS = 'Boss@T.com, ops@t.com';
    assert.strictEqual(canSeeBackups({ role: 'admin', tenantId: DEF, email: 'a@t.com' }), false, '목록이 있으면 목록만');
    assert.strictEqual(canSeeBackups({ role: 'admin', tenantId: 'x', email: 'boss@t.com' }), true);
    assert.strictEqual(canSeeBackups({ role: 'member', tenantId: DEF, email: 'ops@t.com' }), false, '관리자여야 함');
  } finally {
    if (old === undefined) delete process.env.BACKUP_ADMIN_EMAILS; else process.env.BACKUP_ADMIN_EMAILS = old;
  }
});
