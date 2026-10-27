/**
 * 회의록 → 맵 트리 (lib/mindmap-data meetingTree) — 안건 · 논의 · 결정 · 액션(담당 · 마감 · 완료) · 참석자 · 다음 회의
 */
var mmData = require('../lib/mindmap-data');

function texts(n) { return n.children.map(function (c) { return c.text; }); }

describe('meeting → mindmap tree', function () {
  test('가지 구성과 액션 아이템 속성', function () {
    var m = {
      id: 'mt-1', title: '주간 회의', meet_date: '2026-10-27',
      agenda: [{ text: '일정 점검', done: true, note: '- 지연 2건', result: '1. 금요일까지 회복' }, '예산', { text: '' }],
      minutes: '-. 장비 입고 지연\n\n• 고객 요청 확인',
      attendees: ['김팀원', '이팀원'],
      form: { decisions: '1) 2호기 출하 연기\n2) 추가 인력 투입', nextDate: '2026-11-03', nextNote: '- 결과 보고' }
    };
    var acts = [
      { title: '일정표 수정', assignee_id: 'u1', due_date: '2026-10-30', status: 'open' },
      { title: '견적 요청', assignee_name: '외주', status: 'done' }
    ];
    var r = mmData.meetingTree(m, acts);
    expect(r.ref).toEqual({ type: 'meeting', id: 'mt-1' });
    expect(r.text).toBe('주간 회의 (2026-10-27)');
    expect(texts(r)).toEqual(['📋 안건', '💬 논의', '✅ 결정 사항', '🎯 액션 아이템', '👥 참석자', '📅 다음 회의 2026-11-03']);
    var ag = r.children[0];
    expect(texts(ag)).toEqual(['일정 점검', '예산']);
    expect(ag.children[0].done).toBe(true);
    expect(texts(ag.children[0])).toEqual(['💬 지연 2건', '✅ 금요일까지 회복']);
    expect(texts(r.children[1])).toEqual(['장비 입고 지연', '고객 요청 확인']);
    expect(texts(r.children[2])).toEqual(['2호기 출하 연기', '추가 인력 투입']);
    var ax = r.children[3].children;
    expect([ax[0].assigneeId, ax[0].dueDate, ax[0].done]).toEqual(['u1', '2026-10-30', undefined]);
    expect([ax[1].assigneeName, ax[1].done]).toEqual(['외주', true]);
    expect(r.children[4].collapsed).toBe(true);
    expect(texts(r.children[5])).toEqual(['결과 보고']);
  });

  test('빈 회의는 루트만', function () {
    var r = mmData.meetingTree({ id: 'x', title: '빈 회의', agenda: [], attendees: [], form: {} }, []);
    expect(r.children).toEqual([]);
  });
});
