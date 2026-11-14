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
    '\n  window.__weekly = { clientParseText, buildPreviewHTML, buildStandaloneHTML, inlineThemeVars, dday, paneCtx };\n})();\n');
  const sandbox = { window: {}, document: { getElementById() { return null; } } };
  vm.createContext(sandbox);
  // 공용 파서(전역 WeeklyReportParse)를 먼저 — 브라우저의 defer 순서와 같게
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'weekly-report-parse.js'), 'utf8'), sandbox, { filename: 'weekly-report-parse.js' });
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
test('buildPreviewHTML: 3색 상태 아이콘 + 13px 통일', () => {
  const html = client.buildPreviewHTML(client.clientParseText(
    '[개발]\n- [A] 예정건 @김\n- [B] 진행건 30% @박 #진행중\n[C/S]\n- [C] 완료건 @이 #완료'));
  // v13.349 SVG 도형 — 예정=파랑 빈 원
  assert.match(html, /class="wrp-st wrp-st-planned" width="13" height="13"[^>]*><circle[^>]*fill="none" stroke="#94A3B8"/);
  // 진행중=빨간 테 + 반쯤 찬 원
  assert.match(html, /class="wrp-st wrp-st-in_progress" width="13" height="13"[^>]*><circle[^>]*stroke="#2563EB"[^>]*\/><path[^>]*fill="#2563EB"/);
  // 완료=초록 원 + 흰 체크
  assert.match(html, /class="wrp-st wrp-st-done" width="13" height="13"[^>]*><circle[^>]*fill="#16A34A"\/><path[^>]*stroke="#fff"/);
});

test('buildPreviewHTML (v13.349): 칸이 전부 예정이면 도형 없음 · 섞이면 그대로', () => {
  const allPlan = client.buildPreviewHTML(client.clientParseText('[개발]\n- [A] 하나 @김\n- [B] 둘 @박\n  : 세부'));
  assert.match(allPlan, /class="wrp np"/);
  assert.ok(!/wrp-st-planned/.test(allPlan), '예정 동그라미 없음');
  assert.ok(!/class="wrp-dic"/.test(allPlan), '세부 줄 앞 표시 없음');
  assert.match(allPlan, /\.wrp\.np \.wrp-pgw,\.wrp\.np \.wrp-det\{grid-column:3\/5\}/);   // 이름과 같은 칸에서 시작
  assert.match(allPlan, /class="wrp-rule"/);              // 절 머리 막대 대신 가는 줄
  const mixed = client.buildPreviewHTML(client.clientParseText('[개발]\n- [A] 하나 @김\n- [B] 둘 @박 #완료'));
  assert.match(mixed, /class="wrp"/);
  assert.match(mixed, /wrp-st-planned/);
});

test('buildPreviewHTML (v13.349): 테마 — 절 색 · 바탕색이 테마를 따름, 모르는 테마는 라이트', () => {
  const parsed = client.clientParseText('[개발]\n- [A] 하나 @김 #완료');
  const mid = client.inlineThemeVars(client.buildPreviewHTML(parsed, 'midnight'), 'midnight');
  assert.match(mid, /border-left-color:#60A5FA/);        // 미드나잇 개발 색
  assert.match(mid, /\.wrp-card\{background:#111A2E/);   // 미드나잇 카드 바탕
  const unk = client.inlineThemeVars(client.buildPreviewHTML(parsed, 'nope'), 'nope');
  assert.match(unk, /\.wrp-card\{background:#FFFFFF/);
  const doc = client.buildStandaloneHTML(parsed, { theme: 'paper' });
  assert.match(doc, /data-report-theme="paper"/);
  assert.match(doc, /--bg:#F5F0E6/);
});

test('buildPreviewHTML: 완료율 구간별 히트색', () => {
  const html = client.buildPreviewHTML(client.clientParseText(
    '[개발]\n- [A] x 90% @a #진행중\n- [B] y 50% @b #진행중\n- [C] z 10% @c #진행중'));
  assert.match(html, /color:#16A34A">90%/); // high
  assert.match(html, /color:#2563EB">50%/); // mid
  assert.match(html, /color:#60A5FA">10%/); // low
});

test('buildPreviewHTML: 사이트 배지 폭 통일(전 항목 동일 width)', () => {
  const html = client.buildPreviewHTML(client.clientParseText(
    '[개발]\n- [짧] a @x\n- [아주긴사이트명] b @y'));
  const widths = [...html.matchAll(/--sw:(\d+)px/g)].map(m => m[1]);   // v13.309 격자 — 사이트 칸 폭을 --sw 로
  assert.strictEqual(widths.length, 2);
  assert.strictEqual(widths[0], widths[1]);
});

test('buildPreviewHTML: 담당자는 보이게 (2명 넘으면 "외 N") + title 에 전체', () => {
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

// 여러 fixture로 클라이언트↔서버 파서 핵심필드 완전 일치 강제 (④ 통일 보장)
const PARITY_FIXTURES = [
  SAMPLE,
  '[개발]\n- [A사] 프로젝트X ~09/16 70% @박 @김 #진행중\n  : 세부1 #완료\n  : 세부2\n- [B사] 완료건 @이\n[C/S]\n- [C사] 작업 완료 @최\n- [D사] 미완료 검토 30% @정\n[기타]\n- [E사] 예정건 @한',
  '잡음줄\n[CS]\n- [Z] zz @q #진행중\n  : dd',
];
test('parity: 클라이언트/서버 파서 핵심필드 완전 일치', () => {
  for (const f of PARITY_FIXTURES) {
    const c = coreItems(clientItems(client.clientParseText(f)));
    const s = coreItems(server.parseText(f).items);
    assert.deepStrictEqual(plain(c), plain(s));
  }
});

// ④ 통일: 태그 없는 "완료"도 양쪽 모두 done
test('통일: 태그 없는 "완료"도 클라이언트/서버 모두 done', () => {
  const input = '[개발]\n- [x] 작업 완료 @김';
  const c = clientItems(client.clientParseText(input))[0].status;
  const s = server.parseText(input).items[0].status;
  assert.strictEqual(c, 'done');
  assert.strictEqual(s, 'done');
});

// ─────────────── v13.250 공용 파서 · 해 넘김 ───────────────
test('공용 파서: 서버 모듈 = 루트 weekly-report-parse.js (한 벌)', () => {
  assert.strictEqual(server, require('../weekly-report-parse.js'));
});

test('항목 이름 공백 정리 — 예전엔 서버만 겹친 공백을 남겼다', () => {
  const input = '[개발]\n- [A] 검사기   개조 @김 50%';
  assert.strictEqual(server.parseText(input).items[0].name, '검사기 개조');
  assert.strictEqual(clientItems(client.clientParseText(input))[0].name, '검사기 개조');
});

test('parseName: 해를 넘기는 주 (25W01 = 2024-12-30 ~ 2025-01-03)', () => {
  assert.deepStrictEqual(server.parseName('팀_25W01_12/30~01/03_R2'),
    { team: '팀', weekLabel: '25W01', weekStart: '2024-12-30', weekEnd: '2025-01-03' });
  assert.strictEqual(server.parseName('팀_26W53_12/28~01/01_R1').weekEnd, '2027-01-01');
  assert.strictEqual(server.parseName('소프트웨어팀_26W17_04/20~04/24_R1').weekStart, '2026-04-20');
});

test('namePrefix: ISO 주차의 해 (예전 서버는 시작일의 해를 붙여 24W01)', () => {
  assert.deepStrictEqual(server.namePrefix('팀', '2024-12-30', '2025-01-03'), { weekLabel: '25W01', prefix: '팀_25W01_12/30~01/03' });
  assert.strictEqual(server.namePrefix('팀', '2026-10-26', '2026-10-30').prefix, '팀_26W44_10/26~10/30');
  assert.strictEqual(server.namePrefix('팀', 'x', '2026-10-30'), null);
});

test('dday: 반년 넘게 차이 나면 해를 넘긴 것으로', () => {
  const md = (d) => '~' + String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0');
  const ahead = new Date(); ahead.setDate(ahead.getDate() + 250);
  const behind = new Date(); behind.setDate(behind.getDate() - 250);
  assert.match(client.dday(md(ahead)).label, /^D\+/);   // 250일 뒤 날짜 = 실은 지난해의 그 날
  assert.match(client.dday(md(behind)).label, /^D-/);   // 250일 전 날짜 = 실은 내년의 그 날
});

test('buildPreviewHTML (v13.346): 위 정렬 격자 · 담당 칸 고정 · 진행 줄 · 세부 줄은 상태 칸부터 · 3명 이상은 "외 N"', () => {
  const html = client.buildPreviewHTML(client.clientParseText('[개발]\n- [A사] 긴 업무 ~12/04 30% @가 @나 @다\n  : 세부 하나'));
  assert.match(html, /\.wrp-it\{display:grid;grid-template-columns:var\(--sw,auto\) 14px minmax\(0,1fr\) auto;[^}]*align-items:start/);
  assert.match(html, /\.wrp-mem\{grid-column:4;grid-row:1/);   // 담당은 늘 첫 줄 오른쪽
  assert.match(html, /\.wrp-det\{grid-column:2\/5/);
  assert.match(html, /<span class="wrp-mn">가<span class="wrp-mx"> 외 2<\/span>/);   // v13.350 사람 아이콘 하나 + 보통 글자색 이름
  assert.ok(!/wrp-av/.test(html), '사람별 색 동그라미 없음');
  assert.match(html, /class="wrp-it has-d"/);
  assert.match(html, /class="wrp-pg"><span class="wrp-bar">/);   // 기한 · 진행률 → 진행 줄
});

test('buildPreviewHTML (v13.346): 절 머리 — 건수 · 완료/진행/예정 개수 · 비율 막대', () => {
  const html = client.buildPreviewHTML(client.clientParseText('[셋업]\n- [A] 하나 #완료\n- [B] 둘 #완료\n- [C] 셋 #진행중\n- [D] 넷'));
  assert.match(html, /class="wrp-cnt"[^>]*>4건/);
  assert.match(html, /완료 2<\/b>/);
  assert.match(html, /진행 1<\/b>/);
  assert.match(html, /예정 1<\/b>/);
  assert.match(html, /class="wrp-sbar"[^>]*><span style="width:50%;background:#16A34A">/);
});

test('buildPreviewHTML (v13.352): 절 머리는 할 일(세부 줄) 단위로 셈 — 하위 줄 └ 은 세지 않음', () => {
  const html = client.buildPreviewHTML(client.clientParseText(
    '[기타]\n- [SDC] 챔퍼링 @박성민 @정재훈\n  : UV 대구경 셋업 #진행중\n  : Hole Align, QC 검사 개선 작업 #진행중\n    └ 하위 설명\n'
    + '- [애플트리] 이니셜 프로세스 대응 @김민수 #완료\n- [대덕전자] EES 업체 선정 @김민수 #완료'));
  assert.match(html, /class="wrp-cnt" title="할 일 4건 \(업무 3개\)">4건/);
  assert.match(html, /완료 2<\/b>/);
  assert.match(html, /진행 2<\/b>/);
  assert.ok(!/예정 \d+<\/b>/.test(html));
  // 세부 줄에 태그가 없으면 항목 태그를 따름
  const inh = client.buildPreviewHTML(client.clientParseText('[개발]\n- [A] 업무 #진행중\n  : 하나\n  : 둘 #완료'));
  assert.match(inh, /진행 1<\/b>/);
  assert.match(inh, /완료 1<\/b>/);
});

test('보고용 표시 (v13.487): #지연 · #중요 · → 결과 · 요약 띠 · 지난주↔금주 잇기', () => {
  // 파서: 태그는 이름에서 빠지고 risk · star 로
  const p = client.clientParseText('[C/S]\n- [SDC] 챔퍼링 #중요 @박성민\n  : 홀 얼라인 개선 #진행중 #지연\n- [디오] A1 대응 #이슈');
  assert.strictEqual(p.items[0].name, '챔퍼링');
  assert.strictEqual(p.items[0].star, true);
  assert.strictEqual(p.items[0].details[0].risk, '지연');
  assert.strictEqual(p.items[1].name, 'A1 대응');
  assert.strictEqual(p.items[1].risk, '이슈');
  assert.strictEqual(server.parseText('- [X] 일 #위험').items[0].risk, '위험');

  const last = client.clientParseText('[개발]\n- [SENKO] PICAlign 60% #진행중\n- [A] 끝 안 난 일 #진행중\n[C/S]\n- [디오] A1 Fault 대응 → 재발 0건 #완료\n- [SDC] 챔퍼링 #진행중 #지연');
  const cur = client.clientParseText('[개발]\n- [SENKO] PICAlign 65%\n- [B] 새 일');
  const lh = client.buildPreviewHTML(last, 'light', client.paneCtx('last', cur, '2026-11-09', '2026-11-13'));
  assert.match(lh, /wrp-sum-t">지난주 실적<\/span><span class="wrp-sum-r">11\/02 ~ 11\/06/);
  assert.match(lh, /wrp-res">→ 재발 0건/);
  assert.match(lh, /wrp-alert">⚠ <b>SDC<\/b> 챔퍼링/);
  assert.match(lh, /wrp-it rk/);
  assert.match(lh, /wrp-st-risk/);
  assert.match(lh, /끝 안 난 일<\/span><span class="wrp-chip miss"/);     // 금주에 없음
  assert.ok(!/PICAlign<\/span><span class="wrp-chip miss"/.test(lh));     // 금주에 이어짐
  const ch = client.buildPreviewHTML(cur, 'light', client.paneCtx('cur', last, '2026-11-09', '2026-11-13'));
  assert.match(ch, /wrp-sum-t">금주 계획<\/span><span class="wrp-sum-r">11\/09 ~ 11\/13/);
  assert.match(ch, /PICAlign<\/span><span class="wrp-chip cont"/);
  assert.match(ch, /새 일<\/span><span class="wrp-chip new"/);
  assert.match(ch, /wrp-pprev">60 →<\/span> 65%/);
  // ★ 핵심은 절 맨 위로
  const st = client.buildPreviewHTML(client.clientParseText('[기타]\n- [A] 보통\n- [B] 핵심 ★'));
  assert.ok(st.indexOf('핵심') < st.indexOf('보통'));
  // 맥락 없이 부르면 요약 띠 없음 (예전 모양)
  assert.ok(!/wrp-sum/.test(client.buildPreviewHTML(cur).replace(/<style>[\s\S]*?<\/style>/, '')));
});
