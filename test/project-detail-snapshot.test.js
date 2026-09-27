// project-detail.js — showProjectDetail / pdLoadWork / 모달 출력 스냅샷 (리팩토링 안전망)
// 실행: node --test   · 스냅샷 갱신: UPDATE_SNAPSHOTS=1 node --test test/project-detail-snapshot.test.js
'use strict';
process.env.TZ = 'Asia/Seoul';

const test = require('node:test');
const assert = require('node:assert');
const H = require('./fixtures/project-detail-harness');

async function openDetail(opts) {
  const ctx = H.load(opts);
  await ctx.s.showProjectDetail('p1');
  await H.flush();
  return ctx;
}

test('showProjectDetail: 전체 패널(헤더·탭·개요·라이프사이클·푸터) 스냅샷', async () => {
  const { dom, calls } = await openDetail();
  H.matchSnapshot(assert, 'detail-full', dom.snapshot());
  assert.ok(calls.some((c) => c[0] === 'renderCommentThread' && c[3] === 'pdCommentsSection'));
});

test('showProjectDetail: 최소 프로젝트(마일스톤·수주·메모·진척 없음, 마지막 단계) 스냅샷', async () => {
  const fx = H.fixtures();
  const proj = { id: 'p1', name: '빈 프로젝트', color: '#abcdef', status: 'waiting', currentPhase: 'as' };
  const { dom } = await openDetail({ fx: { proj, milestones: [], chk: [] }, after: (s) => { s.getOrderInfo = undefined; } });
  H.matchSnapshot(assert, 'detail-minimal', dom.snapshot());
  void fx;
});

test('showProjectDetail: 프로젝트 없으면 아무것도 붙이지 않음 + 재호출 가능', async () => {
  const { s, dom } = await openDetail({ fx: { proj: null } });
  assert.strictEqual(dom.body.children.length, 0);
  assert.strictEqual(s._pdDetailBusy, false);
});

test('pdSwitchTab: 이슈/투입실적 탭 로딩 스냅샷', async () => {
  const { s, dom } = await openDetail();
  s.pdSwitchTab('issues', 'p1');
  s.pdSwitchTab('work', 'p1');
  await H.flush();
  H.matchSnapshot(assert, 'tabs-issues-work', dom.snapshot());
});

test('pdLoadWork: 멤버·시간 단위 스냅샷', async () => {
  const { s, dom } = await openDetail();
  s.pdLoadWork('p1');
  await H.flush();
  const h = dom.stub('pdWork').innerHTML;
  s.window.pdUnit = 'd';
  s.pdLoadWork('p1');
  await H.flush();
  const d = dom.stub('pdWork').innerHTML;
  H.matchSnapshot(assert, 'work-hours', h + '\n<!-- unit d -->\n' + d);
});

test('pdLoadWork: 비멤버·목표 미설정·할당 외 없음 스냅샷', async () => {
  const fx = H.fixtures();
  fx.milestones.forEach((m) => { m.assigneeTargets = {}; delete m.progressNote; });
  Object.keys(fx.msHours).forEach((k) => { if (fx.msHours[k]) delete fx.msHours[k].outPeople; });
  delete fx.proj.estimatedHours;
  const { s, dom } = await openDetail({ fx, user: { name: '외부', role: 'viewer' } });
  s.pdLoadWork('p1');
  await H.flush();
  H.matchSnapshot(assert, 'work-nontarget', dom.stub('pdWork').innerHTML);
});

test('pdLoadWork: 데이터 없음 / msLogsGet 미정의', async () => {
  const fx = H.fixtures();
  const { s, dom } = await openDetail({ fx: { milestones: [], msHours: { _meta: {} } }, after: (x) => { x.msLogsGet = undefined; } });
  s.pdLoadWork('p1');
  await H.flush();
  assert.strictEqual(dom.stub('pdWork').innerHTML, '<div style="text-align:center;color:var(--t6);font-size:11px;padding:20px 0">투입실적 데이터가 없습니다.</div>');
  void fx;
});

test('pdLoadWork: calcHoursByMilestone 미정의 시 안내', async () => {
  const { s, dom } = await openDetail();
  s.calcHoursByMilestone = undefined;
  s.pdLoadWork('p1');
  assert.strictEqual(dom.stub('pdWork').innerHTML, '<div style="text-align:center;color:var(--t6);font-size:11px;padding:20px 0">투입실적 데이터를 가져올 수 없습니다.</div>');
});

test('pdLoadWork: 에러 시 토스트', async () => {
  const { s, calls } = await openDetail();
  s.calcHoursByMilestone = () => Promise.reject(new Error('boom'));
  s.pdLoadWork('p1');
  await H.flush();
  assert.ok(calls.some((c) => c[0] === 'toast' && c[1] === '❌ 오류: boom'));
});

test('pdMsProgressUpdate: 진척률 모달 내용·id·z-index', async () => {
  const { s, dom } = await openDetail();
  const ok = await s.pdMsProgressUpdate('m1', 'p1', 40);
  await H.flush();
  assert.strictEqual(ok, true);
  const ov = s.document.getElementById('pdMsProgModal');
  assert.ok(ov, 'wmGuardedModal 이 기다리는 id');
  assert.match(ov.style.cssText, /z-index:10001/);
  assert.match(ov.style.cssText, /background:rgba\(0,0,0,\.6\)/);
  const stubsHtml = ['pdProgAlloc', 'pdProgHist', 'pdMsAssignSection'].map((k) => '<!-- ' + k + ' -->\n' + dom.stub(k).innerHTML).join('\n');
  H.matchSnapshot(assert, 'modal-progress', H.modalInner(ov) + '\n' + stubsHtml);
  // 닫기 버튼(인라인 onclick) 이 참조하는 id 로 제거 가능
  ov.remove();
  assert.strictEqual(s.document.getElementById('pdMsProgModal'), null);
});

test('_pdAssignAction: 담당 배정 모달 내용·id·z-index', async () => {
  for (const kind of ['add', 'replace', 'cover']) {
    const { s } = await openDetail();
    s._pdAssignAction(kind, 'm1', 'p1', 'u1');
    await H.flush();
    const ov = s.document.getElementById('pdAssignModal');
    assert.ok(ov);
    assert.match(ov.style.cssText, /z-index:10002/);
    H.matchSnapshot(assert, 'modal-assign-' + kind, H.modalInner(ov));
  }
});
