/**
 * 말로 등록 (v13.303) — "내일 3시 SK 미팅", "B2024-001 배선 3시간" 처럼 쓰면
 *   AI 가 할 일 · 일정 · 업무일지 중 무엇인지 고르고 → 미리보기 + [✅ 등록][종류 바꾸기][🤖 질문으로][✖]
 *   확인을 눌러야 등록된다 (AI 가 혼자 저장하지 않음). 실제 저장은 기존 /todo · /event · /log 와 같은 함수.
 *   질문처럼 보이는 글은 지금처럼 AI 질답으로.
 */
var QuickParse = require('../../quick-parse');
var refs = require('./refs');
var escHtml = require('./util/escape').escHtml;

var AM = { A: 'CS현장', B: '수주', D: '개발', G: '공통', M: '양산', R: '제안', S: '영업지원', V: '휴가' };
var KIND_LABEL = { meeting: '🤝 회의', trip: '✈️ 출장', fieldService: '🔧 외근', dayoff: '🌴 연차', amoff: '🌅 오전반차', pmoff: '🌇 오후반차', review: '🔍 검토', etc: '📌 일정' };
var PRI_LABEL = { 1: '🔴 긴급', 2: '🟠 높음', 4: '⚪ 낮음' };
var WD = ['일', '월', '화', '수', '목', '금', '토'];

function kstToday() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }
function md(d) { return d ? (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) + '(' + WD[new Date(d + 'T00:00:00Z').getUTCDay()] + ')' : ''; }

var HOURS_RE = /(\d+(?:\.\d+)?)\s*(?:h\b|시간)/i;
/** 질문처럼 보이나 */
function looksLikeQuestion(t) {
  return /[?？]\s*$/.test(t) ||
    /(뭐야|뭐지|뭐가|뭐 있|무엇|어때|어떻게|어떤|알려|보여|누가|누구|몇\s?(개|건|명|시간|시|일|%)?|얼마|언제|어디|왜|요약|분석|비교|현황|상황|있어\?|있나|인가요?|할까|되나|됐나|했나|추천|정리해)/.test(t);
}
/** 등록할 것처럼 보이나 */
function looksLikeEntry(t) {
  if (HOURS_RE.test(t)) return true;
  if (/(등록|추가|넣어|잡아|적어|기록|메모|해야|할\s*일|일정|회의|미팅|출장|외근|연차|반차|휴가|마감|까지|약속)/.test(t)) return true;
  var q = QuickParse.parse(t, kstToday());
  return !!(q.due || q.time || q.kind || q.priority);
}
/** 'entry' | 'question' */
function classify(t) {
  t = String(t || '').trim();
  if (t.length < 2) return 'question';
  var entry = looksLikeEntry(t);
  if (entry && !looksLikeQuestion(t)) return 'entry';
  if (entry && /(등록|추가|넣어|잡아|적어|기록)/.test(t)) return 'entry';
  return 'question';
}

function planPrompt(text) {
  var today = kstToday();
  return '오늘은 ' + today + '(' + WD[new Date(today + 'T00:00:00Z').getUTCDay()] + ') 입니다. 사용자가 업무 메신저에 쓴 글을 업무 관리 시스템에 등록하려 합니다.\n' +
    '종류: todo(앞으로 할 일), event(정해진 날 · 시각의 일정 — 회의 · 미팅 · 출장 · 외근 · 연차), worklog(이미 한 일과 들인 시간 — "3시간", "4h"), none(등록할 것이 아님)\n' +
    'JSON 하나만 답하세요: {"kind":"todo|event|worklog|none","text":"","hours":0,"abbr":"","orderNo":"","content":""}\n' +
    '- todo · event 의 text 는 이 형식으로: [날짜] [시각] [#종류] [!중요도] 제목\n' +
    '  날짜: 오늘 · 내일 · 모레 · 금요일 · 다음주 월 · 10/30 / 시각: 14:00 또는 15:00~16:00 / 종류(일정만): #회의 #출장 #외근 #연차 #오전반차 #오후반차 #검토 / 중요도(할 일만): !긴급 !높음 !낮음\n' +
    '  제목은 사용자가 쓴 말을 살려 짧게. 없는 날짜 · 시각을 지어내지 마세요.\n' +
    '- worklog: hours 는 숫자, abbr 는 업무 분장 한 글자 — A(CS현장) B(수주) D(개발) G(공통) M(양산) R(제안) S(영업지원) V(휴가) 중 가장 가까운 것, ' +
    'orderNo 는 B2024-001 같은 수주번호가 글에 있을 때만, content 는 한 일.\n' +
    '사용자 글: """' + String(text).slice(0, 500).replace(/"""/g, '"') + '"""';
}

function parseJson(s) {
  s = String(s || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  var a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch (_) { return null; }
}

/** AI 결과 검사 → 초안 data (등록할 게 없으면 null) */
function cleanPlan(p, raw) {
  if (!p || typeof p !== 'object') return null;
  var kind = ['todo', 'event', 'worklog'].indexOf(p.kind) >= 0 ? p.kind : null;
  if (!kind) return null;
  var d = { raw: String(raw).slice(0, 500), kind: kind, text: String(p.text || '').replace(/\s+/g, ' ').trim().slice(0, 300) || String(raw).slice(0, 300) };
  var h = parseFloat(p.hours);
  var abbr = String(p.abbr || '').trim().toUpperCase().slice(0, 1);
  if (h > 0 && h <= 24 && AM[abbr]) {
    d.log = {
      hours: Math.round(h * 10) / 10, abbr: abbr,
      orderNo: /^[A-Za-z0-9][\w-]{2,29}$/.test(String(p.orderNo || '')) ? String(p.orderNo) : '',
      content: String(p.content || '').replace(/\s+/g, ' ').trim().slice(0, 300) || String(raw).slice(0, 300)
    };
  }
  if (kind === 'worklog' && !d.log) d.kind = 'todo';
  return d;
}

/** AI 없이 — 시간이 있으면 일정, 아니면 할 일 */
function fallbackPlan(raw) {
  var q = QuickParse.parse(raw, kstToday());
  return { raw: String(raw).slice(0, 500), kind: q.time || q.kind ? 'event' : 'todo', text: String(raw).slice(0, 300) };
}

function preview(d) {
  var head = '📝 <b>이렇게 등록할까요?</b>\n\n';
  if (d.kind === 'worklog' && d.log) {
    return head + '⏱ <b>업무일지</b> (오늘)\n' + d.log.hours + '시간 · ' + d.log.abbr + '(' + AM[d.log.abbr] + ')' + (d.log.orderNo ? ' · ' + escHtml(d.log.orderNo) : '') +
      '\n' + escHtml(d.log.content);
  }
  var q = QuickParse.parse(d.text, kstToday());
  if (d.kind === 'event') {
    var kind = q.kind && q.kind !== 'todo' ? q.kind : 'etc';
    var title = q.title || (KIND_LABEL[kind] || '일정').replace(/^\S+\s/, '');
    return head + '📅 <b>일정</b> — ' + (KIND_LABEL[kind] || '📌') + ' ' + escHtml(title) +
      '\n🕒 ' + md(q.due || kstToday()) + (q.time ? ' ' + q.time + (q.timeEnd ? '~' + q.timeEnd : '') : ' 하루 종일');
  }
  return head + '✏️ <b>할 일</b> — ' + escHtml(q.title || d.text) +
    (q.due ? '\n📅 ' + md(q.due) + (q.time ? ' ' + q.time : '') : '\n📅 날짜 없음') +
    (q.priority && PRI_LABEL[q.priority] ? '\n' + PRI_LABEL[q.priority] : '');
}

function keyboard(key, d) {
  var row2 = [];
  if (d.kind !== 'todo') row2.push({ text: '✏️ 할 일로', callback_data: 'cp:todo:' + key });
  if (d.kind !== 'event') row2.push({ text: '📅 일정으로', callback_data: 'cp:event:' + key });
  if (d.kind !== 'worklog' && d.log) row2.push({ text: '⏱ 업무일지로', callback_data: 'cp:log:' + key });
  return { inline_keyboard: [
    [{ text: '✅ 등록', callback_data: 'cp:ok:' + key }, { text: '✖ 취소', callback_data: 'cp:x:' + key }],
    row2.concat([{ text: '🤖 질문으로', callback_data: 'cp:ask:' + key }])
  ] };
}

/**
 * 글 → 초안 미리보기 보내기
 * @param {object} c { chatId, user, text, send, ai: async (prompt) => text|null }
 */
async function propose(c) {
  var d = null;
  try {
    var out = c.ai ? await c.ai(planPrompt(c.text)) : null;
    if (out !== null && out !== undefined) {
      var p = parseJson(out);
      if (p && p.kind === 'none') return false;   // 등록할 게 아님 → 질답으로
      d = cleanPlan(p, c.text);
    }
  } catch (e) {
    if (e && (e.code === 'CREDIT_LOW' || e.code === 'AI_KEY_INVALID')) throw e;
    console.warn('[tg-compose] plan', e && e.message);
  }
  if (!d) d = fallbackPlan(c.text);
  var key = await refs.putDraft(c.user, c.chatId, d);
  await c.send(c.chatId, preview(d) + '\n\n<i>맞으면 ✅ 등록 — 아니면 종류를 바꾸거나 질문으로 보내세요.</i>', { reply_markup: JSON.stringify(keyboard(key, d)) });
  return true;
}

/**
 * 버튼 처리 — cp:<동작>:<키>
 * @param {object} c { chatId, user, messageId, action, key, send, edit(text, markup), run: { todo, event, log, ask } }
 * @returns {Promise<string>} 버튼 자리 안내
 */
async function onButton(c) {
  if (c.action === 'x') {
    await refs.dropDraft(c.user, c.key);
    await c.edit('✖ 등록하지 않았습니다.');
    return '취소했습니다';
  }
  if (c.action === 'todo' || c.action === 'event' || c.action === 'log') {
    var d0 = await refs.peekDraft(c.user, c.key);
    if (!d0) { await c.edit('⌛ 시간이 지나 다시 적어 주세요.'); return '시간이 지났습니다'; }
    d0.kind = c.action === 'log' ? 'worklog' : c.action;
    if (d0.kind !== 'worklog' && !d0.text) d0.text = d0.raw;
    await refs.dropDraft(c.user, c.key);
    var key2 = await refs.putDraft(c.user, c.chatId, d0);
    await c.edit(preview(d0) + '\n\n<i>맞으면 ✅ 등록 — 아니면 종류를 바꾸거나 질문으로 보내세요.</i>', keyboard(key2, d0));
    return '바꿨습니다';
  }
  var d = await refs.takeDraft(c.user, c.key);   // 한 번만 — 두 번 눌러도 한 번 등록
  if (!d) { await c.edit('⌛ 이미 처리했거나 시간이 지났습니다.'); return '이미 처리했습니다'; }
  if (c.action === 'ask') {
    await c.edit('🤖 질문으로 보냈습니다 — ' + escHtml(d.raw));
    await c.run.ask(c.chatId, c.user, d.raw);
    return '질문으로 보냈습니다';
  }
  // ok
  await c.edit(preview(d).replace('📝 <b>이렇게 등록할까요?</b>', '✅ <b>등록했습니다</b>'));
  if (d.kind === 'worklog' && d.log) {
    await c.run.log(c.chatId, c.user, d.log);
  } else if (d.kind === 'event') {
    await c.run.event(c.chatId, c.user, d.text);
  } else {
    await c.run.todo(c.chatId, c.user, d.text);
  }
  return '등록했습니다';
}

module.exports = {
  classify: classify, looksLikeQuestion: looksLikeQuestion, looksLikeEntry: looksLikeEntry,
  planPrompt: planPrompt, parseJson: parseJson, cleanPlan: cleanPlan, fallbackPlan: fallbackPlan,
  preview: preview, keyboard: keyboard, propose: propose, onButton: onButton
};
