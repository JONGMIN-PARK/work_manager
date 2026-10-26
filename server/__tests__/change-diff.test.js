/**
 * lib/change-diff + change-feed 합치기 — 저장 전·후 비교 → 텔레그램 변경 줄 (v13.215)
 */
var cd = require('../lib/change-diff');
var feed = require('../services/notification/change-feed');
var templates = require('../services/notification/templates');

function lines(entries) { return entries.map(feed.lineOf).filter(Boolean); }

describe('change-diff', function () {
  test('프로젝트: 바뀐 필드만, 라벨·단위 붙여서', function () {
    var prev = { status: 'active', progress: 30, end_date: '2026-11-30', name: 'A', assignees: ['김', '이'], memo: '', phases: { design: { s: 1 }, order: { s: 0 } } };
    var clean = { status: 'done', progress: 30, end_date: '2026-12-15', name: 'A', assignees: JSON.stringify(['김', '박']), memo: '고객 요청 반영', phases: JSON.stringify({ order: { s: 0 }, design: { s: 1 } }) };
    expect(lines(cd.diffProject(prev, clean))).toEqual([
      '상태: 진행중 → 완료',
      '종료일: 2026-11-30 → 2026-12-15',
      '담당자 +박 -이',
      '메모 수정: 고객 요청 반영'
    ]);
  });

  test('프로젝트: 그대로 저장하면 없음', function () {
    expect(cd.diffProject({ name: 'A', progress: 0 }, { name: 'A', progress: 0 })).toEqual([]);
  });

  test('마일스톤: 일정·상태 (완료 전환은 따로 알림 → 제외)', function () {
    var a = { id: 'm1', name: '설계', start_date: '2026-06-01', end_date: '2026-06-30', status: 'waiting' };
    expect(lines(cd.diffMilestone(a, Object.assign({}, a, { end_date: '2026-07-10', status: 'active' })))).toEqual([
      "마일스톤 '설계' 일정: 06/01~06/30 → 06/01~07/10",
      "마일스톤 '설계' 상태: 대기 → 진행"
    ]);
    expect(cd.diffMilestone(a, Object.assign({}, a, { status: 'done' }))).toEqual([]);
  });

  test('체크리스트: iid 로 추가·삭제·체크·수정', function () {
    var a = [{ iid: 'i1', text: '도면 승인', done: false }, { iid: 'i2', text: '자재 발주', done: false }];
    var b = [{ iid: 'i1', text: '도면 승인', done: true }, { iid: 'i3', text: '검수 일정', done: false }];
    expect(lines(cd.diffChecklist(a, b, 'design'))).toEqual([
      '체크리스트 [설계] 도면 승인: ☐ → ☑',
      '체크리스트 추가: [설계] 검수 일정',
      '체크리스트 삭제: [설계] 자재 발주'
    ]);
  });

  test('사양서: 항목 이름 목록', function () {
    expect(lines(cd.specChanges([{ path: ['values', 'stroke'], label: '행정거리' }, { path: ['values', 'axes', 'r1', 'motor'] }]))).toEqual(['사양서 수정: 행정거리, motor']);
  });

  test('주간업무보고: 업무 단위 추가·수정·삭제', function () {
    var prev = [
      { client: 'A사', name: '라인 설계', status: 'in_progress', pct: 50, deadline: '', members: ['김'], details: [{ text: '1차 검토' }] },
      { client: 'B사', name: '견적', status: 'none', pct: -1, members: [], details: [] }
    ];
    var cur = [
      { client: 'A사', name: '라인 설계', status: 'done', pct: 100, deadline: '', members: ['김'], details: [{ text: '1차 검토' }, { text: '고객 승인' }] },
      { client: 'C사', name: '설치', status: 'in_progress', pct: 10, deadline: '~11/05', members: ['박'], details: [] }
    ];
    expect(cd.diffWeeklyItems(prev, cur)).toEqual([
      { kind: 'mod', client: 'A사', name: '라인 설계', detail: '진행중→완료 · 50%→100% · + 고객 승인' },
      { kind: 'add', client: 'C사', name: '설치', detail: '진행중 · 10% · ~11/05 · @박' },
      { kind: 'del', client: 'B사', name: '견적', detail: '' }
    ]);
    expect(cd.diffWeeklyItems(cur, cur)).toEqual([]);
  });
});

describe('change-feed 묶기', function () {
  afterEach(function () { feed._reset(); });
  var req = { tenant: { id: 't1' }, user: { sub: 'u1', name: '홍길동' } };

  test('같은 값 여러 번 → 처음 → 마지막, 되돌리면 빠짐', function () {
    feed.record(req, 'p1', [{ key: 'p:progress', label: '진척률', from: '30%', to: '40%' }]);
    feed.record(req, 'p1', [{ key: 'p:progress', label: '진척률', from: '40%', to: '60%' }]);
    feed.record(req, 'p1', [{ key: 'chk:i1:done', label: '체크리스트 X', from: '☐', to: '☑' }]);
    feed.record(req, 'p1', [{ key: 'chk:i1:done', label: '체크리스트 X', from: '☑', to: '☐' }]);
    feed.record(req, 'p1', [{ key: 'spec', label: '사양서 수정', list: ['A'] }, { key: 'spec', label: '사양서 수정', list: ['B', 'A'] }]);
    expect(feed._peek('t1', 'p1', 'u1')).toEqual(['진척률: 30% → 60%', '사양서 수정: A, B']);
  });
});

describe('템플릿', function () {
  test('project_updated: 작성자·변경 줄 (HTML 이스케이프)', function () {
    var t = templates.TEMPLATES.project_updated({ projectName: 'X<1>', orderNo: 'O-1', actorName: '홍', lines: ['상태: 진행중 → 완료'], more: 2 });
    expect(t).toBe('✏️ <b>프로젝트 수정</b>\n[O-1] X&lt;1&gt; · 홍\n• 상태: 진행중 → 완료\n… 외 2건');
  });
  test('weekly_report_uploaded: 변경 업무 목록', function () {
    var t = templates.TEMPLATES.weekly_report_uploaded({ team: '설계팀', weekLabel: '26W44', count: 5, done: 2, uploader: '홍', changes: [{ kind: 'add', client: 'C사', name: '설치', detail: '10%' }] });
    expect(t).toContain('주간업무보고 수정');
    expect(t).toContain('🆕 [C사] 설치\n    10%');
  });
});
