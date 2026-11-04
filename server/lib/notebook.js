/**
 * 📓 노트북 공용 (v13.316) — 라우트 · 텔레그램 /memo · 메신저 [노트로] 가 같이 씀
 */
var crypto = require('crypto');
var db = require('../config/db');

var MAX_BODY = 400000, MAX_TITLE = 300, MAX_TAGS = 20, KEEP_VERSIONS = 60, KEEP_NAMED = 50, SNAP_GAP_MS = 10 * 60 * 1000, MAX_NOTES = 20000;

/** jsonb ::text 는 키 순서 · 공백이 JSON.stringify 와 다를 수 있어 객체로 비교 */
function sameJson(a, b) {
  try { return JSON.stringify(canon(JSON.parse(a || '{}'))) === JSON.stringify(canon(JSON.parse(b || '{}'))); } catch (_) { return a === b; }
}
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') { var o = {}; Object.keys(v).sort().forEach(function (k) { o[k] = canon(v[k]); }); return o; }
  return v;
}

function rid(p) { return p + '-' + crypto.randomUUID().replace(/-/g, '').slice(0, 16); }
function kstToday() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }

/** 글자 수 (공백 뺀 글자 기준 — 한글 글쓰기 관례) · 마크다운 기호 · 첨부 주소는 뺌 */
function countWords(body) {
  var s = String(body || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^::ink\[[^\]]*\]\s*$/gm, ' ')
    .replace(/[#>*_`~=\-|[\]]/g, ' ');
  return s.replace(/\s+/g, '').length;
}

/** 첫 줄로 제목 만들기 (제목을 비워 둔 노트) */
function titleFrom(body) {
  var lines = String(body || '').split('\n');
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i].replace(/^#{1,6}\s+|^[-*+]\s+(\[[ xX]\]\s+)?|^>\s*|^\d+\.\s+/, '').replace(/[*_`~=]/g, '').trim();
    if (l && !/^::ink\[/.test(l)) return l.slice(0, 80);
  }
  return '';
}

/** 목록용 미리보기 — 마크다운 기호를 걷은 앞부분 */
function snippet(body, n) {
  return String(body || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*\|?[\s:|-]*-{3,}[\s:|-]*\|?\s*$/gm, ' ')   // 표 구분 줄 · 구분선
    .replace(/^::ink\[[^\]]*\]\s*$/gm, '✍️ ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '🖼 ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+|^>\s*(\[![A-Z]+\]\s*)?|^\s*[-*+]\s+(\[[ xX]\]\s+)?|^\s*\d+\.\s+/gm, '')
    .replace(/[*_`~=|]/g, '')
    .replace(/\s+/g, ' ').trim().slice(0, n || 160);
}

function cleanTags(t) {
  if (!Array.isArray(t)) return [];
  var seen = {}, out = [];
  t.forEach(function (x) {
    var s = String(x || '').replace(/^#+/, '').replace(/[,\s]+/g, ' ').trim().slice(0, 30);
    var k = s.toLowerCase();
    if (s && !seen[k] && out.length < MAX_TAGS) { seen[k] = 1; out.push(s); }
  });
  return out;
}

function cleanInk(ink) {
  if (!ink || typeof ink !== 'object' || Array.isArray(ink)) return {};
  var s = JSON.stringify(ink);
  if (s.length > 3000000) { var e = new Error('손글씨가 너무 큽니다 (3MB 까지).'); e.status = 413; throw e; }
  return ink;
}

/** 노트 하나 만들기 — 낙서장 · 양식 · 복제 모두 이 길로 */
async function create(tenantId, userId, o) {
  o = o || {};
  var id = rid('nb');
  var body = String(o.body || '');
  // 말없이 자르지 않음 — 고치기(PUT)와 같게 413 (v13.330) · 개수 한도도 만들기 길 하나에서 (복제 · 낙서장 포함)
  if (body.length > MAX_BODY) { var e1 = new Error('노트 한 장은 40만 자까지입니다. 나눠서 써 주세요.'); e1.status = 413; throw e1; }
  var cnt = await db.query('SELECT COUNT(*)::int AS n FROM nb_notes WHERE tenant_id = $1 AND user_id = $2', [tenantId, userId]);
  if (cnt.rows[0].n >= MAX_NOTES) { var e2 = new Error('노트는 20,000개까지입니다. 휴지통을 비우거나 정리해 주세요.'); e2.status = 400; throw e2; }
  var title = String(o.title || '').slice(0, MAX_TITLE);
  if (o.folderId) {
    var f = await db.query('SELECT 1 FROM nb_folders WHERE id = $1 AND tenant_id = $2 AND user_id = $3', [o.folderId, tenantId, userId]);
    if (!f.rows.length) o.folderId = null;
  }
  var r = await db.query(
    'INSERT INTO nb_notes (id, tenant_id, user_id, folder_id, title, body, ink, tags, pinned, starred, inbox, source, words) ' +
    'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',
    [id, tenantId, userId, o.folderId || null, title, body, JSON.stringify(cleanInk(o.ink)), JSON.stringify(cleanTags(o.tags)),
      !!o.pinned, !!o.starred, !!o.inbox, String(o.source || 'web').slice(0, 20), countWords(body)]);
  return r.rows[0];
}

/** 낙서장에 한 장 (텔레그램 /memo · 메신저 [노트로] · 빨리 적기) */
async function addInbox(tenantId, userId, body, source, title) {
  return create(tenantId, userId, { body: body, title: title || '', inbox: true, source: source || 'quick' });
}

/** 고친 기록 남기기 — 마지막 기록보다 10분 넘게 지났거나 직접 남길 때 (오래된 자동 기록은 정리) */
async function snapshot(note, label, force) {
  var ink = JSON.stringify(note.ink || {});
  if (!force) {
    // 같은 모습(제목 · 본문 · 손글씨 모두 같음)이면 또 남기지 않음 — 손글씨만 고친 것도 기록 (v13.330)
    var last = await db.query('SELECT created_at, title, body, ink::text AS ink FROM nb_versions WHERE note_id = $1 ORDER BY id DESC LIMIT 1', [note.id]);
    var L = last.rows[0];
    if (L && (Date.now() - new Date(L.created_at).getTime() < SNAP_GAP_MS || (L.body === (note.body || '') && L.title === (note.title || '') && sameJson(L.ink, ink)))) return null;
  }
  var r = await db.query('INSERT INTO nb_versions (note_id, title, body, ink, words, label) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at',
    [note.id, note.title || '', note.body || '', ink, note.words || 0, label || null]);
  await db.query('DELETE FROM nb_versions WHERE note_id = $1 AND label IS NULL AND id NOT IN (SELECT id FROM nb_versions WHERE note_id = $1 AND label IS NULL ORDER BY id DESC LIMIT $2)', [note.id, KEEP_VERSIONS]);
  // 이름 붙인 기록도 노트마다 KEEP_NAMED 개까지 — 끝없이 쌓이지 않게 (오래된 것부터)
  await db.query('DELETE FROM nb_versions WHERE note_id = $1 AND label IS NOT NULL AND id NOT IN (SELECT id FROM nb_versions WHERE note_id = $1 AND label IS NOT NULL ORDER BY id DESC LIMIT $2)', [note.id, KEEP_NAMED]);
  return r.rows[0];
}

function out(n, full) {
  var o = {
    id: n.id, folderId: n.folder_id, title: n.title, tags: n.tags || [], pinned: n.pinned, starred: n.starred, inbox: n.inbox,
    source: n.source, words: n.words, rev: n.rev, createdAt: n.created_at, updatedAt: n.updated_at, deletedAt: n.deleted_at
  };
  if (full) { o.body = n.body; o.ink = n.ink || {}; }
  else { o.snippet = n.snip != null ? n.snip : snippet(n.body); o.hasInk = !!(n.has_ink || (n.ink && n.ink.blocks && Object.keys(n.ink.blocks).length)); o.thumb = n.thumb || null; }
  return o;
}

/* ─── ✨ AI 글 도구 — 메일 초안 · 번역 · 다듬기 · 요약 ─── */
var LANGS = { en: '영어', ja: '일본어', zh: '중국어(간체)', ko: '한국어', vi: '베트남어', de: '독일어' };
var TONES = { polite: '공손하고 격식 있는 한국 업무 메일 말투', brief: '간결하고 핵심만 담은 업무 메일 말투', friendly: '부드럽고 친근하지만 예의 있는 말투', en: '자연스러운 영문 비즈니스 메일(Business English)' };
function aiPrompt(action, text, o) {
  o = o || {};
  var keep = '\n\n규칙: 원문에 없는 사실·숫자·날짜를 지어내지 마세요. 확인이 필요한 곳은 [확인 필요] 로 표시하세요.';
  var src = '\n\n--- 원문 ---\n' + text + '\n--- 끝 ---';
  if (action === 'mail') {
    return '당신은 제조·설비 회사의 숙련된 업무 담당자입니다. 아래 메모를 바탕으로 업무 메일 초안을 쓰세요.\n' +
      '- 말투: ' + (TONES[o.tone] || TONES.polite) + '\n' +
      (o.to ? '- 받는 사람: ' + String(o.to).slice(0, 80) + '\n' : '') +
      (o.purpose ? '- 메일 목적: ' + String(o.purpose).slice(0, 200) + '\n' : '') +
      '- 구성: 인사 → 용건 한 줄 요약(두괄식) → 세부 내용(필요하면 번호 목록) → 요청 사항과 기한 → 맺음말. 서명은 넣지 마세요.\n' +
      '- 출력 형식: 첫 줄은 "제목: ..." 한 줄, 빈 줄 하나, 그다음 본문만. 다른 설명은 쓰지 마세요.' + keep + src;
  }
  if (action === 'translate') {
    var lang = LANGS[o.lang] || '영어';
    return '아래 글을 ' + lang + '로 번역하세요. 업무 문서이므로 전문 용어는 업계에서 쓰는 표현으로, 문장은 자연스럽게.\n' +
      '- 마크다운 서식(제목 #, 목록, 체크 [ ], 표 |, **굵게**, 링크, 코드)과 줄 구성은 그대로 유지하세요.\n' +
      '- ::ink[...] 같은 줄과 (nbf:...) 주소는 그대로 두세요.\n- 번역문만 출력하세요.' + src;
  }
  if (action === 'polish') {
    return '아래 업무 글을 더 명확하고 간결하게 다듬으세요. 뜻과 사실은 바꾸지 말고, 군더더기·중복·모호한 표현을 고치고, 두괄식으로.\n' +
      '- 마크다운 서식과 ::ink[...] 줄은 유지하세요.\n- 다듬은 글만 출력하세요.' + keep + src;
  }
  if (action === 'summary') {
    return '아래 노트를 업무 보고용으로 요약하세요. 형식:\n## 요약\n(세 줄 이내)\n## 핵심 내용\n- …\n## 결정·할 일\n- [ ] …\n해당 없는 칸은 빼세요. 요약만 출력하세요.' + keep + src;
  }
  return null;
}
function parseMail(out) {
  var t = String(out || '').replace(/^```[a-z]*\n?|```\s*$/g, '').trim();
  var m = /^(?:\*\*)?(?:제목|Subject)\s*[:：]\s*(.+?)(?:\*\*)?\s*\n+([\s\S]*)$/i.exec(t);
  return m ? { subject: m[1].trim(), body: m[2].trim() } : { subject: '', body: t };
}

/* ─── 📊 리포트 — 기간 노트 모으기 ─── */
var KIND_LABEL = { weekly: '주간 업무 보고', summary: '요약 보고서', worklog: '업무 일지 모음' };
/** 노트들을 날짜 순으로 그대로 묶은 마크다운 (AI 없이) */
function reportRaw(notes, daily, o) {
  o = o || {};
  var all = [];
  notes.forEach(function (n) { all.push({ at: n.updated_at, day: kstDay(n.updated_at), title: n.title || titleFrom(n.body) || '제목 없음', body: n.body, tags: n.tags || [] }); });
  (daily || []).forEach(function (d) { all.push({ at: d.updated_at, day: d.note_date, title: (+d.note_date.slice(5, 7)) + '/' + (+d.note_date.slice(8, 10)) + (d.ref ? ' 회의 메모' : ' 일일 노트'), body: String(d.body || '').replace(/ ⟦[^⟧]*⟧/g, ''), tags: [] }); });
  all.sort(function (a, b) { return a.day === b.day ? new Date(a.at) - new Date(b.at) : a.day < b.day ? -1 : 1; });
  var md = '# ' + (o.title || '노트 모음') + '\n\n> [!NOTE] ' + o.from + ' ~ ' + o.to + ' · 노트 ' + all.length + '개\n\n';
  var lastDay = '';
  all.forEach(function (x) {
    if (x.day !== lastDay) { md += '## 📅 ' + x.day + ' (' + '일월화수목금토'[new Date(x.day + 'T00:00:00Z').getUTCDay()] + ')\n\n'; lastDay = x.day; }
    // 노트 안 제목은 한 단계씩 내려서 (리포트의 날짜 제목 아래로)
    var body = String(x.body || '').replace(/^::ink\[[^\]]*\]\s*$/gm, '*(✍️ 손글씨)*').replace(/^(#{1,4})\s/gm, '$1## ').trim();
    md += '### ' + x.title + (x.tags.length ? ' `' + x.tags.map(function (t) { return '#' + t; }).join(' ') + '`' : '') + '\n\n' + body + '\n\n';
  });
  return { md: md, count: all.length };
}
function kstDay(t) { return new Date(new Date(t).getTime() + 9 * 3600000).toISOString().slice(0, 10); }
function reportPrompt(style, raw, o) {
  var head = '아래는 ' + o.from + ' ~ ' + o.to + ' 동안 쓴 업무 노트입니다.\n';
  var keep = '\n규칙: 노트에 없는 사실 · 숫자 · 날짜를 지어내지 마세요. 애매하면 [확인 필요].';
  if (style === 'weekly') {
    return head + '이 노트로 주간 업무 보고를 아래 형식 그대로 쓰세요 (다른 설명 없이 보고 본문만).\n' +
      '형식:\n[개발]\n- [고객사/사이트] 업무명 ~MM/DD 50% #진행중\n  : 세부 내용\n[셋업]\n…\n[C/S]\n…\n[기타]\n…\n' +
      '- 섹션은 개발 · 셋업 · C/S · 기타 중 해당하는 것만. 진척률 · 마감은 노트에 있을 때만. 상태 태그는 #진행중 #완료 #지연 #대기 중 하나.' + keep + '\n\n--- 노트 ---\n' + raw;
  }
  if (style === 'summary') {
    return head + '팀장에게 올릴 요약 보고서를 마크다운으로 쓰세요.\n## 한 줄 요약\n## 주요 성과\n## 진행 중 · 위험\n## 결정 사항\n## 다음 할 일\n- [ ] …\n해당 없는 칸은 빼고, 두괄식으로 짧게.' + keep + '\n\n--- 노트 ---\n' + raw;
  }
  return null;
}

/* ─── ✍️ 글쓰기 코치 (AI) — 고쳐 주지 않고 이유 → 힌트 → 예시 순서로 가르침 ─── */
var COACH_KINDS = { weekly: '주간 업무 보고', meeting: '회의록', review: '기술 검토', trip: '출장 보고', why: '문제 분석', mail: '업무 메일', daily: '업무 일지', note: '업무 노트' };
function coachPrompt(text, kind, rules) {
  return '당신은 제조 · 설비 회사 직원에게 업무 글쓰기를 가르치는 코치입니다. 대신 써 주지 말고, 스스로 고칠 수 있게 짚어 주세요.\n' +
    '글 종류: ' + (COACH_KINDS[kind] || '업무 노트') + '\n' +
    (rules && rules.length ? '규칙 검사가 이미 찾은 것(겹치지 않게 다른 것을 찾으세요): ' + rules.slice(0, 12).join(' · ') + '\n' : '') +
    '아래 글을 보고 JSON 하나만 답하세요 (코드 블록 없이):\n' +
    '{"scores":{"clarity":0-100,"concise":0-100,"structure":0-100,"evidence":0-100},' +
    '"summary":"총평 두 문장 (잘한 점 하나 + 가장 먼저 고칠 점 하나)",' +
    '"items":[{"quote":"원문에서 그대로 옮긴 짧은 부분(30자 이내)","issue":"무엇이 문제인지 한 줄","why":"왜 문제인지 — 읽는 사람 입장에서","hint":"고치는 방향 힌트 (답을 주지 말 것)","example":"고친 예시 한 문장"}],' +
    '"task":"이번 주 연습 과제 하나 — 구체적으로 (예: 보고 첫 줄에 결론부터)"}\n' +
    '- items 는 중요한 순서로 3~7개. quote 는 반드시 원문에 있는 그대로.\n' +
    '- 기준: 명확성(한 문장 한 뜻 · 주어 · 모호어), 간결성(군더더기 · 중복), 구조(두괄식 · 순서 · 빠진 칸), 근거(숫자 · 날짜 · 담당).\n\n--- 글 ---\n' + String(text).slice(0, 12000);
}
function parseCoach(out, text) {
  var t = String(out || '').replace(/^```(?:json)?\s*|```\s*$/g, '').trim();
  var s = t.indexOf('{'), e = t.lastIndexOf('}');
  var j = null;
  try { j = JSON.parse(t.slice(s, e + 1)); } catch (_) { return null; }
  function n(v) { if (v == null || v === '') return null; v = Math.round(+v); return isFinite(v) ? Math.max(0, Math.min(100, v)) : null; }
  var sc = j.scores || {};
  var scores = { clarity: n(sc.clarity), concise: n(sc.concise), structure: n(sc.structure), evidence: n(sc.evidence) };
  var vals = Object.keys(scores).map(function (k) { return scores[k]; }).filter(function (v) { return v != null; });
  scores.total = vals.length ? Math.round(vals.reduce(function (a, b) { return a + b; }, 0) / vals.length) : null;
  var items = (Array.isArray(j.items) ? j.items : []).slice(0, 10).map(function (x) {
    var q = String(x.quote || '').slice(0, 120);
    return { quote: q, found: !!q && String(text).indexOf(q) >= 0, issue: String(x.issue || '').slice(0, 200), why: String(x.why || '').slice(0, 400), hint: String(x.hint || '').slice(0, 300), example: String(x.example || '').slice(0, 300) };
  }).filter(function (x) { return x.issue; });
  return { scores: scores, summary: String(j.summary || '').slice(0, 500), items: items, task: String(j.task || '').slice(0, 200) };
}

/* ═══ v13.323 🔤 AI 맞춤법 · 띄어쓰기 — 틀린 곳만 짚고 바른 말 · 규칙 한 줄 (문장을 바꿔 쓰지 않음) ═══ */
var SPELL_MAX = 8000;
function spellPrompt(text) {
  return '당신은 한국어 맞춤법 · 띄어쓰기 · 문법 검사기입니다. 업무 글을 보고 틀린 곳만 찾으세요.\n' +
    '- 고치지 말 것: 마크다운 기호(#, -, *, |, >, [ ], ``` 등), 코드 블록 안, 링크 주소, 영어 · 숫자 · 단위, 사람 이름 · 회사 · 제품 · 전문 용어 · 약어, 표의 칸 구분.\n' +
    '- 문체 다듬기 · 문장 바꿔 쓰기 · 높임말 바꾸기는 하지 말 것 — 맞춤법 · 띄어쓰기 · 명백한 문법(조사 · 어미)만.\n' +
    '- 개조식(~함 · ~임 · 명사로 끝남)은 업무 글 관례이므로 틀린 것이 아님.\n' +
    '- wrong 은 원문에서 글자 하나 다르지 않게 그대로 옮기고, 같은 말이 여러 번 나와도 찾을 수 있게 앞뒤 낱말을 1개씩 넣어 40자 이내로. right 는 wrong 과 같은 범위를 고친 것.\n' +
    'JSON 하나만 답하세요 (코드 블록 없이):\n' +
    '{"items":[{"wrong":"원문 그대로","right":"고친 것","type":"spell|space|grammar","why":"규칙 한 줄 (예: 의존 명사 \'수\'는 띄어 씀)"}]}\n' +
    '틀린 것이 없으면 {"items":[]}. 많아야 40개, 글 앞쪽부터.\n\n--- 글 ---\n' + String(text).slice(0, SPELL_MAX);
}
function parseSpell(out, text) {
  var t = String(out || '').replace(/^```(?:json)?\s*|```\s*$/g, '').trim();
  var s = t.indexOf('{'), e = t.lastIndexOf('}');
  var j = null;
  try { j = JSON.parse(t.slice(s, e + 1)); } catch (_) { return null; }
  var seen = {}, src = String(text);
  var items = (Array.isArray(j.items) ? j.items : []).map(function (x) {
    var w = String((x && x.wrong) || '').slice(0, 120), r = String((x && x.right) || '').slice(0, 160);
    var type = ['spell', 'space', 'grammar'].indexOf(x && x.type) >= 0 ? x.type : (w.replace(/\s/g, '') === r.replace(/\s/g, '') ? 'space' : 'spell');
    return { wrong: w, right: r, type: type, why: String((x && x.why) || '').slice(0, 200) };
  }).filter(function (x) {
    if (!x.wrong || !x.right || x.wrong === x.right || src.indexOf(x.wrong) < 0 || seen[x.wrong]) return false;
    seen[x.wrong] = true; return true;
  }).slice(0, 40);
  return { items: items, cut: src.length > SPELL_MAX };
}

/* ─── 첨부 정리 (v13.330) ─── */
var MAX_FILES_PER_USER = 1024 * 1024 * 1024;   // 사람마다 첨부 합계 1GB
var SAFE_INLINE = /^(image\/(png|jpeg|gif|webp|bmp|avif)|application\/pdf|text\/plain|audio\/[a-z0-9.+-]+|video\/(mp4|webm|ogg))(;|$)/i;

/** 어느 노트(휴지통 · 고친 기록 · 일일 노트 포함)에도 'nbf:<id>' 로 안 쓰이는 첨부를 지움 — 올린 지 1시간 안 된 건 남김(아직 저장 전일 수 있음) */
async function sweepFiles(tenantId, userId) {
  var r = await db.query(
    "DELETE FROM nb_files f WHERE f.tenant_id = $1 AND f.user_id = $2 AND f.created_at < NOW() - INTERVAL '1 hour' " +
    "AND NOT EXISTS (SELECT 1 FROM nb_notes n WHERE n.tenant_id = $1 AND n.user_id = $2 AND POSITION(('nbf:' || f.id) IN n.body) > 0) " +
    "AND NOT EXISTS (SELECT 1 FROM nb_versions v JOIN nb_notes n ON n.id = v.note_id WHERE n.tenant_id = $1 AND n.user_id = $2 AND POSITION(('nbf:' || f.id) IN v.body) > 0) " +
    "AND NOT EXISTS (SELECT 1 FROM my_notes m WHERE m.tenant_id = $1 AND m.user_id = $2 AND POSITION(('nbf:' || f.id) IN m.body) > 0) " +
    'RETURNING f.storage_key', [tenantId, userId]);
  var keys = r.rows.map(function (x) { return x.storage_key; }).filter(Boolean);
  if (keys.length) {
    var gcs = require('../services/gcs.service');
    for (var i = 0; i < keys.length; i++) { try { await gcs.deleteObject(keys[i]); } catch (e) { console.warn('[notebook] gcs delete', keys[i], e && e.message); } }
  }
  return r.rowCount;
}

/** 휴지통 30일 지난 노트 영구 삭제 + 첨부 정리 — 하루에 한 번 사람마다 (목록 열 때 매번 돌지 않게) */
var _purgedAt = {};
async function purgeOld(tenantId, userId) {
  var k = tenantId + ':' + userId, now = Date.now();
  if (_purgedAt[k] && now - _purgedAt[k] < 24 * 3600000) return;
  _purgedAt[k] = now;
  var d = await db.query("DELETE FROM nb_notes WHERE tenant_id = $1 AND user_id = $2 AND deleted_at < NOW() - INTERVAL '30 days'", [tenantId, userId]);
  if (d.rowCount) await sweepFiles(tenantId, userId);
}

module.exports = { spellPrompt: spellPrompt, parseSpell: parseSpell, SPELL_MAX: SPELL_MAX, aiPrompt: aiPrompt, parseMail: parseMail, LANGS: LANGS, reportRaw: reportRaw, reportPrompt: reportPrompt, kstDay: kstDay, KIND_LABEL: KIND_LABEL,
  coachPrompt: coachPrompt, parseCoach: parseCoach, COACH_KINDS: COACH_KINDS, rid: rid, kstToday: kstToday, countWords: countWords, titleFrom: titleFrom, snippet: snippet, cleanTags: cleanTags, cleanInk: cleanInk,
  create: create, addInbox: addInbox, snapshot: snapshot, out: out, MAX_BODY: MAX_BODY, MAX_TITLE: MAX_TITLE,
  MAX_FILES_PER_USER: MAX_FILES_PER_USER, SAFE_INLINE: SAFE_INLINE, sweepFiles: sweepFiles, purgeOld: purgeOld };
