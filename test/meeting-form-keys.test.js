// 회의록 양식 칸 목록 — 화면(project-meetings.js PMT_FORM_KEYS)과 서버(routes/meetings.js FORM_KEYS)가 같아야
// 한쪽에만 칸을 추가하면 그 칸이 조용히 저장되지 않는다.
// 실행: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function listOf(file, name) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const m = src.match(new RegExp('var ' + name + ' = (\\[[^\\]]*\\])'));
  assert.ok(m, file + ' 에서 ' + name + ' 를 찾지 못함');
  return JSON.parse(m[1].replace(/'/g, '"'));
}

test('화면 양식 칸 = 서버 FORM_KEYS − 작성 완료 표시', () => {
  const client = listOf('project-meetings.js', 'PMT_FORM_KEYS');
  const server = listOf('server/routes/meetings.js', 'FORM_KEYS');
  assert.deepStrictEqual(server.filter((k) => k !== 'completedAt' && k !== 'completedBy'), client);
  assert.ok(server.includes('completedAt') && server.includes('completedBy'));
});
