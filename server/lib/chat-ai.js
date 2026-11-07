/**
 * ✨ 메신저 AI 정리 (v13.364) — 안 읽은 대화 요약 · 요청 글 채우기 · 요청함 오늘 정리
 *   AI(Claude/Gemini, 테넌트 설정)가 있으면 AI 로, 없거나 실패 · 한도 넘으면 규칙으로 — 늘 무언가 돌려줌 (ai: true/false)
 *   결과는 부른 사람에게만 (방에 올리지 않음)
 */
var aiUsage = require('./ai-usage');

async function tryAI(tenantId, userId, label, prompt, opt) {
  try {
    var q = await aiUsage.checkQuota(tenantId);
    if (!q.ok || !aiUsage.takeHourly(userId)) return null;
    var g = await require('../services/ai-provider').generateText(Object.assign({ prompt: prompt.slice(0, 16000), tenantId: tenantId }, opt || {}));
    if (!g || !g.text) return null;
    await aiUsage.logUsage(tenantId, userId, label, g.provider);
    return g.text;
  } catch (e) { console.warn('[chat-ai]', label, e.message); return null; }
}
function hm(d) { d = new Date(d); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }

/* ─── 안 읽은 대화 요약 ─── rows: [{ who, body, kind, post, file, at, mentionsMe }] */
function catchupRule(rows, meName) {
  var by = {}, posts = [], qs = [], mention = [], files = [];
  rows.forEach(function (r) {
    if (r.kind === 'system') return;
    by[r.who] = (by[r.who] || 0) + 1;
    if (r.post) posts.push((r.post.cat === 'req' ? '🛠 ' : '📌 ') + r.post.title + (r.post.urgency === 'urgent' ? ' (🔴 긴급)' : ''));
    if (r.mentionsMe) mention.push(r.who + ': ' + String(r.body || '').slice(0, 80));
    if (r.file) files.push(r.file);
    String(r.body || '').split('\n').forEach(function (l) { if (/\?\s*$|까요\s*$|나요\s*$|인가요|주세요\s*$/.test(l.trim()) && l.trim().length > 4) qs.push(r.who + ': ' + l.trim().slice(0, 80)); });
  });
  var people = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; });
  var out = ['## 요점', '- 메시지 ' + rows.filter(function (r) { return r.kind !== 'system'; }).length + '개 · ' + people.slice(0, 5).map(function (p) { return p + ' ' + by[p]; }).join(' · ')];
  if (mention.length) out.push('## 나를 부른 것', mention.slice(-5).map(function (x) { return '- ' + x; }).join('\n'));
  if (posts.length) out.push('## 올라온 글 · 요청', posts.slice(-8).map(function (x) { return '- ' + x; }).join('\n'));
  if (qs.length) out.push('## 질문', qs.slice(-6).map(function (x) { return '- ' + x; }).join('\n'));
  if (files.length) out.push('## 파일 · 사진', '- ' + files.slice(-6).join(', '));
  return out.join('\n');
}
async function catchup(ctx, rows) {
  var lines = rows.filter(function (r) { return r.kind !== 'system'; }).map(function (r) {
    return '[' + hm(r.at) + '] ' + r.who + ': ' + (r.post ? '(' + (r.post.cat === 'req' ? '요청' : '글') + ') ' + r.post.title + ' — ' : '') + String(r.body || (r.file ? '(파일) ' + r.file : '')).slice(0, 400);
  }).join('\n');
  var text = rows.length >= 3 ? await tryAI(ctx.tenantId, ctx.userId, '✨ 안 읽은 요약',
    '다음은 사내 메신저에서 ' + ctx.name + ' 님이 아직 안 읽은 대화입니다. 한국어로 짧게 정리하세요.\n## 요점 (3줄 이내)\n## 나에게 필요한 것 (' + ctx.name + ' 님을 부르거나 맡긴 것)\n## 정한 것\n## 할 일 (누가 · 무엇을 · 언제)\n## 아직 답이 없는 질문\n없는 항목은 빼세요. 지어내지 마세요.\n\n' + lines) : null;
  return text ? { text: text, ai: true } : { text: catchupRule(rows, ctx.name), ai: false };
}

/* ─── 요청 글 채우기 ─── */
var URGENT = /긴급|급함|급해|급합|당장|즉시|라인\s*정지|설비\s*정지|가동\s*중지|멈춤|멈췄|stop|비상/i;
var REQ = /안\s*됨|안\s*돼|안돼|에러|오류|error|고장|끊김|끊겨|알람|alarm|이상|불량|안\s*켜|안\s*움직|튕|재부팅|확인\s*부탁|수정\s*요청|요청/i;
var QNA = /\?|까요|나요|인가요|궁금|어떻게|무엇|뭔가요/;
var NOTICE = /공지|안내|알려\s*드립|일정\s*변경|점검\s*예정/;
var EQ_SUF = '조립기|포장기|검사기|사출기|세척기|절단기|용접기|가공기|측정기|성형기|코터|프레스|컨베이어|로봇|PLC|설비|장비|호기|라인';
var EQ_RE = new RegExp('((?:[가-힣A-Za-z0-9]{1,10}\\s)?[가-힣A-Za-z]{0,6}(?:' + EQ_SUF + ')(?:\\s?(?:#\\s?\\d{1,3}|[A-Z]{1,4}-?\\d{1,4}|\\d{1,3}호기|[A-Z]\\b))?)');
function equipOf(t) {
  var m = EQ_RE.exec(t) || /\b([A-Z]{2,6}-\d{1,4})\b/.exec(t);
  return m ? m[1].trim().slice(0, 40) : '';
}
function suggestRule(text) {
  var t = String(text || '').trim(), first = (t.split('\n').filter(function (l) { return l.trim() && !/^(현상|언제부터|재현|기대|로그)/.test(l.trim()); })[0] || t).replace(/^[#\-*\s]+/, '').trim();
  var cat = NOTICE.test(t) ? 'notice' : REQ.test(t) ? 'req' : QNA.test(first) ? 'qna' : 'data';
  return { title: first.slice(0, 60), cat: cat, equip: equipOf(t), urgency: URGENT.test(t) ? 'urgent' : 'normal' };
}
async function suggest(ctx, text) {
  var rule = suggestRule(text);
  var raw = String(text || '').trim().length >= 8 ? await tryAI(ctx.tenantId, ctx.userId, '✨ 요청 채우기',
    '사내 메신저 게시판 글입니다. 아래 글을 보고 JSON 하나만 답하세요. 키: title(40자 안 한 줄 요약), cat(notice|data|qna|req 중 — 고장·오류·수정 부탁이면 req, 물음이면 qna, 알림이면 notice, 자료 공유면 data), equip(장비·설비 이름, 없으면 ""), urgency(normal|urgent — 라인 정지·당장·안전 문제면 urgent).\n\n' + String(text).slice(0, 4000), { json: true }) : null;
  if (raw) {
    try {
      var j = JSON.parse(String(raw).replace(/^```(?:json)?|```$/g, '').trim().replace(/^[^{]*/, '').replace(/[^}]*$/, ''));
      return { title: String(j.title || rule.title).slice(0, 80), cat: ['notice', 'data', 'qna', 'req'].indexOf(j.cat) >= 0 ? j.cat : rule.cat, equip: String(j.equip || rule.equip || '').slice(0, 60), urgency: j.urgency === 'urgent' ? 'urgent' : 'normal', ai: true };
    } catch (_) { /* 규칙으로 */ }
  }
  return Object.assign(rule, { ai: false });
}

/* ─── 요청함 오늘 정리 ─── items: shape() 된 요청 글 (roomName 포함) */
function briefRule(items) {
  var open = items.filter(function (m) { return m.post.status !== 'done'; });
  var score = function (m) { var p = m.post, s = 0; if (p.urgency === 'urgent') s += 100; if (p.due) { var d = (new Date(p.due + 'T00:00:00') - new Date()) / 86400000; s += d < 0 ? 80 : d < 1 ? 60 : d < 3 ? 30 : 0; } if (p.status === 'open') s += 10; return s; };
  open.sort(function (a, b) { return score(b) - score(a); });
  if (!open.length) return '## 오늘\n- 나에게 남은 요청이 없습니다 🎉';
  var late = open.filter(function (m) { return m.post.due && new Date(m.post.due + 'T23:59:59') < new Date(); });
  return ['## 오늘 먼저 할 것',
    open.slice(0, 7).map(function (m, i) { var p = m.post; return (i + 1) + '. ' + (p.urgency === 'urgent' ? '🔴 ' : '') + p.title + (p.equip ? ' · 🏭 ' + p.equip : '') + (p.due ? ' · 📅 ' + p.due.slice(5) : '') + ' · ' + (p.status === 'doing' ? '처리 중' : '접수') + ' · 💬 ' + (m.roomName || ''); }).join('\n'),
    '## 한눈에', '- 남은 요청 ' + open.length + '개 · 긴급 ' + open.filter(function (m) { return m.post.urgency === 'urgent'; }).length + ' · 기한 지남 ' + late.length + ' · 아직 접수 ' + open.filter(function (m) { return m.post.status === 'open'; }).length].join('\n');
}
async function brief(ctx, items) {
  var open = items.filter(function (m) { return m.post.status !== 'done'; });
  var text = open.length >= 2 ? await tryAI(ctx.tenantId, ctx.userId, '✨ 요청 정리',
    ctx.name + ' 님에게 온 사내 요청(장비 · 프로그램) 목록입니다. 오늘 할 순서를 정해 한국어로 짧게.\n## 오늘 먼저 할 것 (번호 · 이유 한 마디)\n## 묶어서 하면 좋은 것 (같은 장비 · 같은 방)\n## 막힌 것 · 물어볼 것\n지어내지 마세요.\n\n' +
    open.map(function (m) { var p = m.post; return '- [' + (p.urgency === 'urgent' ? '긴급' : '보통') + '/' + (p.status === 'doing' ? '처리 중' : '접수') + '] ' + p.title + (p.equip ? ' (장비: ' + p.equip + ')' : '') + (p.due ? ' 기한 ' + p.due : '') + ' — 방: ' + (m.roomName || '') + ' — ' + String(m.body || '').replace(/\s+/g, ' ').slice(0, 200); }).join('\n')) : null;
  return text ? { text: text, ai: true } : { text: briefRule(items), ai: false };
}

module.exports = { catchup: catchup, catchupRule: catchupRule, suggest: suggest, suggestRule: suggestRule, brief: brief, briefRule: briefRule, equipOf: equipOf };
