/**
 * ai-mindmap.service.js — 마인드맵 AI 보조 (PRD_마인드맵 3.5)
 *   expand(input)     선택 주제의 하위 주제 후보
 *   fromText(input)   자유 텍스트(회의 메모·요구사항·메일) → 구조화된 트리
 *   wbs(input)        프로젝트 개요 → 단계 · 작업 · 산출물 WBS 초안 (+ 기간 추정)
 *   summarize(input)  가지 내용 → 한두 문장 요약
 * 트리는 재귀 스키마 대신 평평한 목록 { text, parent } 으로 받는다 (parent = 앞선 항목의 번호, -1 = 최상위).
 */
var aiClaude = require('./ai-claude.service');

var SYSTEM =
  '당신은 제조·자동화 장비 회사의 업무를 돕는 마인드맵 정리 도우미입니다. ' +
  '주제는 짧은 명사구(2~20자)로, 한국어로 씁니다. 같은 뜻을 반복하지 말고, 형제 주제는 서로 겹치지 않게(MECE) 나눕니다. ' +
  '사용자가 준 내용에 없는 사실(고객명·수치·날짜)을 지어내지 마세요.';

var FLAT_SCHEMA = {
  type: 'object',
  properties: {
    nodes: {
      type: 'array',
      description: '주제 목록. parent 는 이 목록에서 부모의 번호(0부터), 최상위는 -1. 부모는 항상 자식보다 앞에 온다.',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '주제 (짧은 명사구)' },
          parent: { type: 'integer', description: '부모 번호, 최상위는 -1' },
          note: { type: 'string', description: '필요할 때만 한 문장 보충 설명' },
          days: { type: 'integer', description: 'WBS 에서만: 예상 소요 일수 (작업일)' }
        },
        required: ['text', 'parent'],
        additionalProperties: false
      }
    }
  },
  required: ['nodes'],
  additionalProperties: false
};

function clip(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…' : s; }

/** 평평한 목록 → 정리된 목록 (잘못된 parent·빈 글자 제거, 개수 제한) */
function cleanFlat(list, max) {
  var out = [];
  var map = {};   // 원래 번호 → 새 번호
  (list || []).forEach(function (n, i) {
    if (out.length >= max) return;
    var text = String((n && n.text) || '').trim().slice(0, 120);
    if (!text) return;
    var p = parseInt(n.parent, 10);
    var np = (p >= 0 && map[p] != null) ? map[p] : -1;
    if (p >= 0 && map[p] == null) return;   // 부모가 버려졌으면 같이 버림
    map[i] = out.length;
    var o = { text: text, parent: np };
    if (n.note) o.note = String(n.note).trim().slice(0, 300);
    if (n.days != null && !isNaN(n.days)) o.days = Math.max(0, Math.min(365, parseInt(n.days, 10)));
    out.push(o);
  });
  return out;
}

async function expand(input) {
  var path = (input.path || []).map(function (t) { return clip(t, 60); }).join(' › ');
  var user =
    '마인드맵에서 아래 주제의 하위 주제를 3~7개 제안하세요. 한 단계만(모두 parent -1).\n\n' +
    '## 경로 (중심 → 선택 주제)\n' + path + '\n\n' +
    (input.siblings && input.siblings.length ? '## 같은 단계의 다른 주제 (참고)\n' + input.siblings.map(function (s) { return '- ' + clip(s, 60); }).join('\n') + '\n\n' : '') +
    (input.existing && input.existing.length ? '## 이미 있는 하위 주제 (겹치지 말 것)\n' + input.existing.map(function (s) { return '- ' + clip(s, 60); }).join('\n') + '\n\n' : '') +
    (input.note ? '## 선택 주제 노트\n' + clip(input.note, 800) + '\n' : '');
  var r = await aiClaude.callJson({ system: SYSTEM, messages: [{ role: 'user', content: user }], schema: FLAT_SCHEMA, maxTokens: 2048 });
  return { nodes: cleanFlat(r.data.nodes, 7).map(function (n) { n.parent = -1; return n; }), usage: r.usage };
}

async function fromText(input) {
  var user =
    '아래 글을 마인드맵으로 정리하세요. 최상위(parent -1)는 3~8개의 큰 갈래, 그 아래 2단계까지. 전체 80개 이내.\n' +
    '할 일은 "누가 · 무엇" 이 드러나게, 결정 사항은 결정 내용 그대로.\n\n' +
    (input.title ? '## 맵 제목\n' + clip(input.title, 100) + '\n\n' : '') +
    '## 원문\n' + clip(input.text, 12000);
  var r = await aiClaude.callJson({ system: SYSTEM, messages: [{ role: 'user', content: user }], schema: FLAT_SCHEMA, maxTokens: 6000 });
  return { nodes: cleanFlat(r.data.nodes, 80), usage: r.usage };
}

async function wbs(input) {
  var p = input.project || {};
  var user =
    '아래 장비 프로젝트의 WBS 초안을 만드세요. 최상위(parent -1)는 단계(예: 사양 확정 · 설계 · 구매/가공 · 조립 · 시운전 · 납품/셋업), ' +
    '그 아래 작업, 필요하면 그 아래 산출물. 작업에는 예상 소요 일수(days)를 넣으세요. 전체 60개 이내.\n' +
    '이미 있는 마일스톤은 겹치지 않게 참고만 하세요.\n\n' +
    '## 프로젝트\n- 이름: ' + clip(p.name, 120) + '\n' +
    (p.orderNo ? '- 수주번호: ' + p.orderNo + '\n' : '') +
    (p.start || p.end ? '- 기간: ' + (p.start || '?') + ' ~ ' + (p.end || '?') + '\n' : '') +
    (p.phase ? '- 현재 단계: ' + p.phase + '\n' : '') +
    (p.memo ? '- 메모: ' + clip(p.memo, 1500) + '\n' : '') +
    (p.specs ? '\n## 사양 요약\n' + clip(p.specs, 3000) + '\n' : '') +
    (input.milestones && input.milestones.length ? '\n## 이미 있는 마일스톤\n' + input.milestones.map(function (m) { return '- ' + clip(m, 80); }).join('\n') + '\n' : '') +
    (input.extra ? '\n## 추가 요청\n' + clip(input.extra, 1000) + '\n' : '');
  var r = await aiClaude.callJson({ system: SYSTEM, messages: [{ role: 'user', content: user }], schema: FLAT_SCHEMA, maxTokens: 6000 });
  return { nodes: cleanFlat(r.data.nodes, 60), usage: r.usage };
}

async function summarize(input) {
  var schema = {
    type: 'object',
    properties: { summary: { type: 'string', description: '가지 전체를 한두 문장(80자 이내)으로 요약' } },
    required: ['summary'],
    additionalProperties: false
  };
  var user = '아래 마인드맵 가지를 한두 문장으로 요약하세요. 핵심 결론·할 일이 드러나게.\n\n' + clip(input.outline, 8000);
  var r = await aiClaude.callJson({ system: SYSTEM, messages: [{ role: 'user', content: user }], schema: schema, maxTokens: 1024 });
  return { summary: String(r.data.summary || '').trim().slice(0, 200), usage: r.usage };
}

module.exports = { isReady: aiClaude.isReady, expand: expand, fromText: fromText, wbs: wbs, summarize: summarize, cleanFlat: cleanFlat };
