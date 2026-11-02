/**
 * 📓 노트북 공용 (v13.316) — 라우트 · 텔레그램 /memo · 메신저 [노트로] 가 같이 씀
 */
var crypto = require('crypto');
var db = require('../config/db');

var MAX_BODY = 400000, MAX_TITLE = 300, MAX_TAGS = 20, KEEP_VERSIONS = 60, SNAP_GAP_MS = 10 * 60 * 1000;

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
  var body = String(o.body || '').slice(0, MAX_BODY);
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
  if (!force) {
    var last = await db.query('SELECT created_at, body FROM nb_versions WHERE note_id = $1 ORDER BY id DESC LIMIT 1', [note.id]);
    if (last.rows.length && (Date.now() - new Date(last.rows[0].created_at).getTime() < SNAP_GAP_MS || last.rows[0].body === note.body)) return null;
  }
  var r = await db.query('INSERT INTO nb_versions (note_id, title, body, ink, words, label) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at',
    [note.id, note.title || '', note.body || '', JSON.stringify(note.ink || {}), note.words || 0, label || null]);
  await db.query('DELETE FROM nb_versions WHERE note_id = $1 AND label IS NULL AND id NOT IN (SELECT id FROM nb_versions WHERE note_id = $1 ORDER BY id DESC LIMIT $2)', [note.id, KEEP_VERSIONS]);
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

module.exports = { aiPrompt: aiPrompt, parseMail: parseMail, LANGS: LANGS, rid: rid, kstToday: kstToday, countWords: countWords, titleFrom: titleFrom, snippet: snippet, cleanTags: cleanTags, cleanInk: cleanInk,
  create: create, addInbox: addInbox, snapshot: snapshot, out: out, MAX_BODY: MAX_BODY, MAX_TITLE: MAX_TITLE };
