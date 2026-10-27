// mindmap-layout.js — 트리 조작 · 배치 · Markdown 변환 (순수 함수)
// 실행: node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const L = require('../mindmap-layout.js');

function tree() {
  return {
    id: 'r', text: '중심', children: [
      { id: 'a', text: 'A', children: [{ id: 'a1', text: 'A1', children: [] }, { id: 'a2', text: 'A2', children: [] }] },
      { id: 'b', text: 'B', children: [] },
      { id: 'c', text: 'C', children: [] },
      { id: 'd', text: 'D', children: [] }
    ]
  };
}
const SIZE = new Proxy({}, { get: () => ({ w: 60, h: 20 }) });

test('mmFind — 부모·위치·깊이', () => {
  const f = L.mmFind(tree(), 'a2');
  assert.strictEqual(f.parent.id, 'a');
  assert.strictEqual(f.index, 1);
  assert.strictEqual(f.depth, 2);
  assert.strictEqual(L.mmFind(tree(), 'zz'), null);
});

test('mmMoveNode — 다른 부모로 이동 · 자기 하위로는 이동 불가', () => {
  const t = tree();
  assert.ok(L.mmMoveNode(t, 'b', 'a', 0));
  assert.deepStrictEqual(t.children[0].children.map((n) => n.id), ['b', 'a1', 'a2']);
  assert.strictEqual(L.mmMoveNode(t, 'a', 'a1'), false, '자기 하위');
  assert.strictEqual(L.mmMoveNode(t, 'r', 'a'), false, '루트');
});

test('mmMoveNode — 같은 부모 안에서 뒤로 이동해도 위치가 한 칸 밀리지 않는다', () => {
  const t = tree();
  assert.ok(L.mmMoveNode(t, 'a', 'r', 3));   // a 를 c 와 d 사이로
  assert.deepStrictEqual(t.children.map((n) => n.id), ['b', 'c', 'a', 'd']);
});

test('mmMoveNode — 1단계에서 빠지면 좌우 지정(side) 해제', () => {
  const t = tree();
  t.children[1].side = 'left';
  L.mmMoveNode(t, 'b', 'a');
  assert.strictEqual(L.mmFind(t, 'b').node.side, undefined);
});

test('mmCloneBranch — 하위까지 새 id', () => {
  const t = tree();
  const c = L.mmCloneBranch(t.children[0]);
  const ids = []; L.mmWalk(c, (n) => { ids.push(n.id); });
  assert.strictEqual(ids.length, 3);
  assert.ok(ids.every((id) => !['a', 'a1', 'a2'].includes(id)));
});

test('mmLayout balanced — 1단계가 좌우로 나뉘고 오른쪽은 루트 오른편, 왼쪽은 왼편', () => {
  const { pos } = L.mmLayout(tree(), 'balanced', SIZE);
  const sides = tree().children.map((n) => pos[n.id].side);
  assert.ok(sides.includes('left') && sides.includes('right'));
  for (const id of ['a', 'b', 'c', 'd']) {
    const p = pos[id];
    if (p.side === 'right') assert.ok(p.x > pos.r.x + pos.r.w);
    else assert.ok(p.x + p.w < pos.r.x);
  }
  // 하위는 부모와 같은 쪽
  assert.strictEqual(pos.a1.side, pos.a.side);
});

test('mmLayout balanced — side 지정은 그대로 존중', () => {
  const t = tree();
  t.children.forEach((n) => { n.side = 'left'; });
  const { pos } = L.mmLayout(t, 'balanced', SIZE);
  assert.ok(t.children.every((n) => pos[n.id].side === 'left'));
});

test('mmLayout — 형제 노드끼리 겹치지 않는다 (right / down)', () => {
  for (const st of ['right', 'down']) {
    const { pos } = L.mmLayout(tree(), st, SIZE);
    const ids = ['a', 'b', 'c', 'd'];
    for (let i = 1; i < ids.length; i++) {
      const p = pos[ids[i - 1]], q = pos[ids[i]];
      if (st === 'right') assert.ok(q.y >= p.y + p.h, st + ' 세로 간격');
      else assert.ok(q.x >= p.x + p.w, st + ' 가로 간격');
    }
  }
});

test('mmLayout — 접힌 노드의 하위는 배치하지 않음', () => {
  const t = tree();
  t.children[0].collapsed = true;
  const { pos } = L.mmLayout(t, 'right', SIZE);
  assert.ok(pos.a && !pos.a1 && !pos.a2);
});

test('Markdown 왕복 — 구조·완료 표시 보존', () => {
  const t = tree();
  t.children[1].done = true;
  const md = L.mmToMarkdown(t);
  assert.match(md, /^# 중심/);
  assert.match(md, /^ {2}- A1$/m);
  assert.match(md, /^- \[x\] B$/m);
  const back = L.mmFromMarkdown(md);
  assert.strictEqual(back.text, '중심');
  assert.deepStrictEqual(back.children.map((n) => n.text), ['A', 'B', 'C', 'D']);
  assert.deepStrictEqual(back.children[0].children.map((n) => n.text), ['A1', 'A2']);
  assert.strictEqual(back.children[1].done, true);
});

test('mmFromMarkdown — 제목 계층 + 그 아래 목록, 탭 들여쓰기, 번호 목록', () => {
  const md = '# 프로젝트\n## 설계\n- 기구\n\t- 프레임\n## 제작\n1. 가공\n2. 조립\n';
  const r = L.mmFromMarkdown(md);
  assert.strictEqual(r.text, '프로젝트');
  assert.deepStrictEqual(r.children.map((n) => n.text), ['설계', '제작']);
  assert.strictEqual(r.children[0].children[0].children[0].text, '프레임');
  assert.deepStrictEqual(r.children[1].children.map((n) => n.text), ['가공', '조립']);
});

test('mmFromMarkdown — 제목 없이 목록만 있으면 기본 중심 주제', () => {
  const r = L.mmFromMarkdown('- 하나\n- 둘');
  assert.strictEqual(r.text, '중심 주제');
  assert.strictEqual(r.children.length, 2);
  assert.strictEqual(L.mmFromMarkdown('  \n'), null);
});

test('경계 — 블록에 여백이 생겨 형제와 겹치지 않고, 상자가 하위 전체를 감싼다', () => {
  const t = tree();
  t.children[0].boundary = { title: '설계' };
  const lay = L.mmLayout(t, 'right', SIZE);
  const deco = L.mmDecorations(t, 'right', lay, SIZE);
  const bd = deco.boundaries[0];
  for (const id of ['a', 'a1', 'a2']) {
    const p = lay.pos[id];
    assert.ok(p.x >= bd.x && p.y >= bd.y && p.x + p.w <= bd.x + bd.w && p.y + p.h <= bd.y + bd.h, id + ' 경계 안');
  }
  const b = lay.pos.b;
  assert.ok(b.y >= bd.y + bd.h, '다음 형제는 경계 밖 아래');
});

test('요약 — 하위 묶음 바깥(오른쪽 가지는 오른쪽, 왼쪽 가지는 왼쪽)에 글상자', () => {
  const t = tree();
  t.children[0].summary = { text: '요약' };
  t.children[0].side = 'left';
  const sizes = new Proxy({}, { get: () => ({ w: 60, h: 20 }) });
  const lay = L.mmLayout(t, 'balanced', sizes);
  const s = L.mmDecorations(t, 'balanced', lay, sizes).summaries[0];
  assert.strictEqual(s.side, 'left');
  assert.ok(s.x + 60 <= Math.min(lay.pos.a1.x, lay.pos.a2.x), '왼쪽 바깥');
  assert.ok(lay.bounds.minX <= s.x, 'bounds 확장');
});

test('mmNumbering — 켜진 주제 아래 1 · 1.1', () => {
  const t = tree();
  t.numbering = true;
  const num = L.mmNumbering(t);
  assert.strictEqual(num.a, '1');
  assert.strictEqual(num.a2, '1.2');
  assert.strictEqual(num.d, '4');
  assert.strictEqual(num.r, undefined);
});

test('mmFromXmindSheets — 제목·노트·마커·진척·접힘·경계·요약·관계선·구조', () => {
  const sheets = [{
    title: '시트A', relationships: [{ end1Id: 'x1', end2Id: 'x2', title: '영향' }],
    rootTopic: {
      id: 'r', title: '중심', structureClass: 'org.xmind.ui.logic.right',
      children: { attached: [
        { id: 'x1', title: '하나', notes: { plain: { content: '메모' } }, markers: [{ markerId: 'priority-2' }, { markerId: 'task-half' }, { markerId: 'flag-red' }], labels: ['L'], branch: 'folded',
          children: { attached: [{ id: 'x11', title: '하나-1' }], summary: [{ id: 's1', title: '정리' }] }, summaries: [{ range: '(0,0)', topicId: 's1' }] },
        { id: 'x2', title: '둘', href: 'https://a.b' }
      ] },
      boundaries: [{ range: '(1,1)', title: '묶음' }]
    }
  }];
  const doc = L.mmFromXmindSheets(sheets);
  const sh = doc.sheets[0];
  assert.strictEqual(sh.title, '시트A');
  assert.strictEqual(sh.structure, 'right');
  const [one, two] = sh.root.children;
  assert.strictEqual(one.note, '메모');
  assert.deepStrictEqual(one.markers, ['priority-2', 'flag']);
  assert.strictEqual(one.progress, 50);
  assert.strictEqual(one.collapsed, true);
  assert.deepStrictEqual(one.labels, ['L']);
  assert.strictEqual(one.summary.text, '정리');
  assert.strictEqual(two.link, 'https://a.b');
  assert.strictEqual(two.boundary.title, '묶음');
  assert.strictEqual(sh.relations.length, 1);
  assert.strictEqual(sh.relations[0].from, one.id);
  assert.strictEqual(sh.relations[0].to, two.id);
  assert.strictEqual(sh.relations[0].label, '영향');
});

test('mmToOpml — 이스케이프 · 계층', () => {
  const t = tree();
  t.children[0].text = 'A & <B>';
  const x = L.mmToOpml(t, '제목');
  assert.match(x, /<outline text="A &amp; &lt;B&gt;">/);
  assert.match(x, /<outline text="A1"\/>/);
  assert.match(x, /<title>제목<\/title>/);
});
