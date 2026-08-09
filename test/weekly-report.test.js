// 주간업무 보고 — 파서 + 미리보기 렌더 테스트
// 실행: node --test  (Node 18+ 내장 러너, 별도 의존성 불필요)
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// ── 브라우저 IIFE(weekly-report-admin.js) 내부 함수 로드 ──
function loadClient() {
  const file = path.join(__dirname, '..', 'weekly-report-admin.js');
  let src = fs.readFileSync(file, 'utf8');
  // 마지막 })(); 직전에 내부 함수들을 window로 노출
  src = src.replace(/\}\)\(\);\s*$/,
    '\n  window.__weekly = { clientParseText, buildPreviewHTML, buildStandaloneHTML, inlineThemeVars, dday };\n})();\n');
  const sandbox = { window: {}, document: { getElementById() { return null; } } };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'weekly-report-admin.js' });
  return sandbox.window.__weekly;
}

const client = loadClient();
const server = require('../server/services/weekly-report-parser');

// vm 샌드박스 객체는 realm이 달라 deepStrictEqual의 프로토타입 검사에 걸림 → JSON 정규화
const plain = (x) => JSON.parse(JSON.stringify(x));

const SAMPLE = [
  '[개발]',
  '- [이노플렉스] SP3965-EPN ~09/16 70% @박종민 @심정현 #진행중',
  '  : UI 정리, Initial Process 모듈 구현',
  '- [사내개발] AniCAM ~11/30 95% @김태연',
  '[C/S]',
  '- [시그네틱스] 모듈 미사용 처리 @박성민 #완료',
  '- [한국비아테크] 요청 처리 @김경우 @김민수',
].join('\n');

// ─────────────────────────── 파서 ───────────────────────────
test('clientParseText: 섹션/항목 구조', () => {
  const p = client.clientParseText(SAMPLE);
  assert.deepStrictEqual(plain(p.sections.map(s => s.type)), ['dev', 'cs']);
  const dev = p.sections[0];
  assert.strictEqual(dev.items.length, 2);
  const a = dev.items[0];
  assert.strictEqual(a.client, '이노플렉스');
  assert.strictEqual(a.name, 'SP3965-EPN');
  assert.strictEqual(a.deadline, '~09/16');
  assert.strictEqual(a.pct, 70);
  assert.deepStrictEqual(plain(a.members), ['박종민', '심정현']);
  assert.strictEqual(a.status, 'in_progress');
  assert.strictEqual(a.details.length, 1);
});

test('clientParseText: 태그 없는 항목은 status none (=미리보기에서 예정 처리)', () => {
  const p = client.clientParseText('[개발]\n- [x] 할 일 @김');
  assert.strictEqual(p.sections[0].items[0].status, 'none');
});

test('clientParseText: 세부 상태 롤업', () => {
  const p = client.clientParseText('[개발]\n- [x] A\n  : 세부작업 #진행중');
  assert.strictEqual(p.sections[0].items[0].status, 'in_progress');
});

test('clientParseText: 별칭 CS → cs', () => {
  const p = client.clientParseText('[CS]\n- [x] A @y');
  assert.strictEqual(p.sections[0].type, 'cs');
});

// ─────────────────────── 미리보기 렌더 ───────────────────────
test('buildPreviewHTML: 3색 상태 아이콘 + 12px 통일', () => {
  const html = client.buildPreviewHTML(client.clientParseText(
    '[개발]\n- [A] 예정건 @김\n- [B] 진행건 30% @박 #진행중\n[C/S]\n- [C] 완료건 @이 #완료'));
  // 예정=파랑 빈 원
  assert.match(html, /width:12px;height:12px;border-radius:50%;box-sizing:border-box;border:2px solid #4f74c9/);
  // 진행중=빨간 원
  assert.match(html, /width:12px;height:12px;border-radius:50%;box-sizing:border-box;background:#d03030/);
  // 완료=녹색 체크(원 + svg)
  assert.match(html, /width:12px;height:12px;border-radius:50%;box-sizing:border-box;background:#1a8a40"><svg/);
});

test('buildPreviewHTML: 완료율 구간별 히트색', () => {
  const html = client.buildPreviewHTML(client.clientParseText(
    '[개발]\n- [A] x 90% @a #진행중\n- [B] y 50% @b #진행중\n- [C] z 10% @c #진행중'));
  assert.match(html, /color:#1a8a40">90%/); // high
  assert.match(html, /color:#c8730a">50%/); // mid
  assert.match(html, /color:#d21f1f">10%/); // low
});

test('buildPreviewHTML: 사이트 배지 폭 통일(전 항목 동일 width)', () => {
  const html = client.buildPreviewHTML(client.clientParseText(
    '[개발]\n- [짧] a @x\n- [아주긴사이트명] b @y'));
  const widths = [...html.matchAll(/box-sizing:border-box;width:(\d+)px/g)].map(m => m[1]);
  assert.strictEqual(widths.length, 2);
  assert.strictEqual(widths[0], widths[1]);
});

test('buildPreviewHTML: 담당자는 배지 title 툴팁으로', () => {
  const html = client.buildPreviewHTML(client.clientParseText('[개발]\n- [사이트] 업무 @박종민 @심정현'));
  assert.match(html, /title="담당자: @박종민, @심정현"/);
});

test('buildPreviewHTML: HTML 이스케이프(XSS 방지)', () => {
  const html = client.buildPreviewHTML(client.clientParseText('[개발]\n- [<b>x</b>] <script>alert(1)</script>'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('buildStandaloneHTML: 테마 :root 라이트/다크', () => {
  const p = client.clientParseText(SAMPLE);
  assert.match(client.buildStandaloneHTML(p, { theme: 'light' }), /:root\{--bg:#F4F5FB;/);
  assert.match(client.buildStandaloneHTML(p, { theme: 'dark' }), /:root\{--bg:#0B0E14;/);
});

test('inlineThemeVars: var(--*) 치환, 잔여 없음', () => {
  const out = client.inlineThemeVars('a var(--bg-p) b var(--bg-i) c var(--bd) d var(--t2)', 'light');
  assert.ok(!/var\(--/.test(out));
});

test('dday: 형식/부호(D-day, D+ 오버)', () => {
  assert.strictEqual(client.dday(''), null);
  assert.strictEqual(client.dday('없음'), null);
  const d = client.dday('~12/31');
  assert.ok(d && /^D[-+]/.test(d.label));
});

// ─────────────── 클라이언트 ↔ 서버 파서 parity ───────────────
function coreItems(items) {
  return items.map(it => ({
    section: it.section, client: it.client, name: it.name,
    deadline: it.deadline, pct: it.pct, members: it.members, status: it.status,
    details: (it.details || []).map(d => ({ text: d.text, status: d.status })),
  }));
}
function clientItems(parsed) {
  return parsed.sections.reduce((acc, s) => acc.concat(s.items), []);
}

test('parity: 태그 기반 입력은 클라이언트/서버 파서 핵심필드 동일', () => {
  const c = coreItems(clientItems(client.clientParseText(SAMPLE)));
  const s = coreItems(server.parseText(SAMPLE).items);
  assert.deepStrictEqual(plain(c), plain(s));
});

// 알려진 divergence: 서버는 태그 없는 "완료"도 done, 클라이언트는 none.
// ④(파서 단일화)에서 통일되면 이 테스트를 동일성으로 바꿀 것.
test('divergence(문서화): 태그 없는 "완료" 처리 차이', () => {
  const input = '[개발]\n- [x] 작업 완료 @김';
  const c = clientItems(client.clientParseText(input))[0].status;
  const s = server.parseText(input).items[0].status;
  assert.strictEqual(c, 'none');   // 클라이언트: #완료만 인식
  assert.strictEqual(s, 'done');   // 서버: 바 "완료"도 done
});
