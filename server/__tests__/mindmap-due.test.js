/**
 * 마인드맵 마감 알림 — 사람별 묶기 · 오늘/내일/지연(1·3·7·14일째만) · 완료 제외
 */
var due = require('../lib/mindmap-due');

function doc(nodes) { return { sheets: [{ id: 's', root: { id: 'r', text: '루트', children: nodes } }] }; }
var N = function (id, extra, kids) { return Object.assign({ id: id, text: id + '\n둘째 줄', children: kids || [] }, extra || {}); };

describe('mindmap due reminders', function () {
  test('오늘 · 내일 · 지연 1/3/7/14일째만, 완료 · 100% · 담당 없음 제외', function () {
    var d = doc([
      N('a', { assigneeId: 'u1', dueDate: '2026-10-27' }),
      N('b', { assigneeId: 'u1', dueDate: '2026-10-28' }, [N('b1', { assigneeId: 'u2', dueDate: '2026-10-24' })]),
      N('c', { assigneeId: 'u1', dueDate: '2026-10-25' }),               // 2일 지남 → 안 보냄
      N('d', { assigneeId: 'u1', dueDate: '2026-10-20' }),               // 7일 지남
      N('e', { assigneeId: 'u1', dueDate: '2026-10-27', done: true }),
      N('f', { assigneeId: 'u1', dueDate: '2026-10-27', progress: 100 }),
      N('g', { dueDate: '2026-10-27' }),
      N('h', { assigneeId: 'u1', dueDate: '2026-11-27' })
    ]);
    var r = due.collectDue(d, '2026-10-27');
    expect(r.map(function (x) { return [x.userId, x.kind, x.text, x.lateDays]; })).toEqual([
      ['u1', 'today', 'a', 0], ['u1', 'tomorrow', 'b', 0], ['u2', 'late', 'b1', 3], ['u1', 'late', 'd', 7]
    ]);
  });

  test('여러 맵 → 사람별, 오늘 · 내일 · 지연(오래된 것 먼저) 순', function () {
    var maps = [
      { id: 'm1', title: '맵1', doc: doc([N('x', { assigneeId: 'u1', dueDate: '2026-10-26' })]) },
      { id: 'm2', title: '맵2', doc: doc([N('y', { assigneeId: 'u1', dueDate: '2026-10-27' }), N('z', { assigneeId: 'u1', dueDate: '2026-10-13' })]) }
    ];
    var g = due.groupDueByUser(maps, '2026-10-27');
    expect(Object.keys(g)).toEqual(['u1']);
    expect(g.u1.map(function (x) { return x.mapTitle + ':' + x.text + ':' + x.kind; })).toEqual(['맵2:y:today', '맵2:z:late', '맵1:x:late']);
  });

  test('잘못된 날짜 · 빈 문서는 무시', function () {
    expect(due.collectDue(doc([N('a', { assigneeId: 'u1', dueDate: '10/27' })]), '2026-10-27')).toEqual([]);
    expect(due.collectDue(null, '2026-10-27')).toEqual([]);
  });
});
