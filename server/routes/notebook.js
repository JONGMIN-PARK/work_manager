/**
 * 📓 노트북 (v13.316) — /api/notebook
 *   노트: 마크다운 본문 · ✍️ 손글씨(ink) · 폴더 · 태그 · 📌 고정 · ⭐ 즐겨찾기 · 📥 낙서장 · 🗑 휴지통(30일) · 고친 기록 · 첨부
 *   충돌: PUT 에 baseRev — 다른 창 · 기기에서 먼저 고쳤으면 409 (force 로 덮기)
 *   📅 일일 노트: 예전 📝 노트 서랍(my_notes)을 그대로 보여 줌 (쓰기는 /api/my-work/notes)
 *   권한: 본인 것만 (공유는 다음 단계)
 *
 *   GET    /meta                         폴더 · 태그 · 개수
 *   GET    /notes?view=&folder=&tag=&q=&sort=
 *   POST   /notes                        { title, body, folderId, tags, inbox, template, ink }
 *   GET    /notes/:id
 *   PUT    /notes/:id                    { title?, body?, ink?, tags?, folderId?, pinned?, starred?, inbox?, baseRev, force }
 *   DELETE /notes/:id[?purge=1]          휴지통으로 (휴지통에 있으면 purge 로 영구 삭제)
 *   POST   /notes/:id/restore · /notes/:id/duplicate · /trash/empty
 *   GET    /notes/:id/versions · /notes/:id/versions/:vid   POST /notes/:id/versions { label }   POST /notes/:id/versions/:vid/restore
 *   POST   /folders · PUT /folders/:id · DELETE /folders/:id · PUT /folders-order { ids }
 *   POST   /files?name=&noteId=  (본문 그대로) · GET /files/:id
 *   GET    /daily                        📅 일일 노트 목록
 *   GET    /template/daily?date=         그날 일정 · 할 일로 채운 일일 업무 양식
 */
var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var httpErr = require('../lib/http-errors');
var nb = require('../lib/notebook');

var MAX_FILE = 25 * 1024 * 1024;

function me(req) { return req.user.sub; }
function bad(res, msg, code) { return res.status(code || 400).json({ error: 'VALIDATION', message: msg }); }
function notFound(res) { return res.status(404).json({ error: 'NOT_FOUND', message: '노트가 없습니다.' }); }
async function noteOf(req, id) {
  var r = await db.query('SELECT * FROM nb_notes WHERE id = $1 AND tenant_id = $2 AND user_id = $3', [id, req.tenant.id, me(req)]);
  return r.rows[0] || null;
}
async function ownFolder(req, id) {
  if (!id) return true;
  var r = await db.query('SELECT 1 FROM nb_folders WHERE id = $1 AND tenant_id = $2 AND user_id = $3', [id, req.tenant.id, me(req)]);
  return r.rows.length > 0;
}

router.use(auth.authenticate);
router.use(tenant.tenantScope);

/* ─── 폴더 · 태그 · 개수 ─── */
router.get('/meta', async function (req, res) {
  try {
    var T = req.tenant.id, U = me(req);
    // 휴지통 30일 지난 것 정리
    await db.query("DELETE FROM nb_notes WHERE tenant_id = $1 AND user_id = $2 AND deleted_at < NOW() - INTERVAL '30 days'", [T, U]);
    var f = await db.query('SELECT f.id, f.name, f.color, f.icon, f.sort, (SELECT COUNT(*)::int FROM nb_notes n WHERE n.folder_id = f.id AND n.deleted_at IS NULL AND NOT n.inbox) AS n ' +
      'FROM nb_folders f WHERE f.tenant_id = $1 AND f.user_id = $2 ORDER BY f.sort, f.created_at', [T, U]);
    var t = await db.query("SELECT tag, COUNT(*)::int AS n FROM nb_notes n, jsonb_array_elements_text(n.tags) AS tag WHERE n.tenant_id = $1 AND n.user_id = $2 AND n.deleted_at IS NULL GROUP BY tag ORDER BY COUNT(*) DESC, tag LIMIT 200", [T, U]);
    var c = await db.query('SELECT COUNT(*) FILTER (WHERE deleted_at IS NULL AND NOT inbox)::int AS all, COUNT(*) FILTER (WHERE deleted_at IS NULL AND inbox)::int AS inbox, ' +
      'COUNT(*) FILTER (WHERE deleted_at IS NULL AND pinned)::int AS pinned, COUNT(*) FILTER (WHERE deleted_at IS NULL AND starred)::int AS starred, ' +
      'COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS trash FROM nb_notes WHERE tenant_id = $1 AND user_id = $2', [T, U]);
    var d = await db.query("SELECT COUNT(DISTINCT note_date)::int AS n FROM my_notes WHERE tenant_id = $1 AND user_id = $2 AND body <> ''", [T, U]);
    var counts = c.rows[0]; counts.daily = d.rows[0].n;
    res.json({ data: { folders: f.rows, tags: t.rows, counts: counts } });
  } catch (e) { httpErr.serverError(res, '[notebook/meta]', e); }
});

/* ─── 목록 ─── */
router.get('/notes', async function (req, res) {
  try {
    var q = req.query, p = [req.tenant.id, me(req)], w = ['n.tenant_id = $1', 'n.user_id = $2'];
    var view = String(q.view || 'all');
    if (view === 'trash') w.push('n.deleted_at IS NOT NULL'); else w.push('n.deleted_at IS NULL');
    if (view === 'inbox') w.push('n.inbox');
    else if (view === 'pinned') w.push('n.pinned');
    else if (view === 'starred') w.push('n.starred');
    else if (view === 'all') w.push('NOT n.inbox');
    if (q.folder) { p.push(String(q.folder)); w.push('n.folder_id = $' + p.length); if (view === 'folder') w.push('NOT n.inbox'); }
    if (q.folder === '') w.push('n.folder_id IS NULL');
    if (q.tag) { p.push(JSON.stringify([String(q.tag)])); w.push('n.tags @> $' + p.length + '::jsonb'); }
    var qs = String(q.q || '').trim().slice(0, 100);
    if (qs) { p.push('%' + qs.replace(/[\\%_]/g, '\\$&') + '%'); w.push('(n.title ILIKE $' + p.length + ' OR n.body ILIKE $' + p.length + ' OR n.tags::text ILIKE $' + p.length + ')'); }
    var sort = { created: 'n.created_at DESC', title: "NULLIF(n.title, '') ASC NULLS LAST, n.updated_at DESC", updated: 'n.updated_at DESC' }[q.sort] || 'n.updated_at DESC';
    if (view === 'trash') sort = 'n.deleted_at DESC';
    var r = await db.query('SELECT n.id, n.folder_id, n.title, n.tags, n.pinned, n.starred, n.inbox, n.source, n.words, n.rev, n.created_at, n.updated_at, n.deleted_at, ' +
      "LEFT(n.body, 3000) AS body, (n.ink ? 'blocks' AND n.ink->'blocks' <> '{}'::jsonb) AS has_ink, " +
      "SUBSTRING(n.body FROM '!\\[[^\\]]*\\]\\(nbf:([A-Za-z0-9-]+)\\)') AS thumb " +
      'FROM nb_notes n WHERE ' + w.join(' AND ') + ' ORDER BY ' + (view === 'trash' ? '' : 'n.pinned DESC, ') + sort + ' LIMIT 1000', p);
    var hits = null;
    if (qs) {   // 찾은 자리 한 조각
      var low = qs.toLowerCase();
      hits = {};
      r.rows.forEach(function (n) {
        var i = String(n.body || '').toLowerCase().indexOf(low);
        if (i >= 0) hits[n.id] = String(n.body).slice(Math.max(0, i - 30), i + qs.length + 60).replace(/\s+/g, ' ');
      });
    }
    res.json({ data: r.rows.map(function (n) { var o = nb.out(n); if (hits && hits[n.id]) o.hit = hits[n.id]; return o; }) });
  } catch (e) { httpErr.serverError(res, '[notebook/list]', e); }
});

/* ─── 만들기 ─── */
router.post('/notes', async function (req, res) {
  try {
    var b = req.body || {};
    var cnt = await db.query('SELECT COUNT(*)::int AS n FROM nb_notes WHERE tenant_id = $1 AND user_id = $2', [req.tenant.id, me(req)]);
    if (cnt.rows[0].n >= 20000) return bad(res, '노트는 20,000개까지입니다. 휴지통을 비우거나 정리해 주세요.');
    var n = await nb.create(req.tenant.id, me(req), { title: b.title, body: b.body, folderId: b.folderId, tags: b.tags, inbox: b.inbox, source: ['quick', 'chat'].indexOf(b.source) >= 0 ? b.source : 'web', ink: b.ink, pinned: b.pinned, starred: b.starred });
    res.status(201).json({ data: nb.out(n, true) });
  } catch (e) { if (e.status) return bad(res, e.message, e.status); httpErr.serverError(res, '[notebook/create]', e); }
});

router.get('/notes/:id', async function (req, res) {
  try {
    var n = await noteOf(req, req.params.id);
    if (!n) return notFound(res);
    res.json({ data: nb.out(n, true) });
  } catch (e) { httpErr.serverError(res, '[notebook/get]', e); }
});

/* ─── 고치기 (부분) ─── */
router.put('/notes/:id', async function (req, res) {
  try {
    var b = req.body || {};
    var n = await noteOf(req, req.params.id);
    if (!n) return notFound(res);
    var content = b.body !== undefined || b.title !== undefined || b.ink !== undefined;
    if (content && b.baseRev != null && +b.baseRev !== n.rev && !b.force) {
      return res.status(409).json({ error: 'CONFLICT', message: '다른 창이나 기기에서 이 노트를 먼저 고쳤습니다.', data: nb.out(n, true) });
    }
    var set = [], p = [];
    function put(col, v) { p.push(v); set.push(col + ' = $' + p.length); }
    if (b.title !== undefined) put('title', String(b.title || '').slice(0, nb.MAX_TITLE));
    if (b.body !== undefined) {
      var body = String(b.body || '');
      if (body.length > nb.MAX_BODY) return bad(res, '노트 한 장은 40만 자까지입니다. 나눠서 써 주세요.', 413);
      put('body', body); put('words', nb.countWords(body));
    }
    if (b.ink !== undefined) put('ink', JSON.stringify(nb.cleanInk(b.ink)));
    if (b.tags !== undefined) put('tags', JSON.stringify(nb.cleanTags(b.tags)));
    if (b.folderId !== undefined) {
      if (b.folderId && !await ownFolder(req, b.folderId)) return bad(res, '폴더가 없습니다.');
      put('folder_id', b.folderId || null);
    }
    ['pinned', 'starred', 'inbox'].forEach(function (k) { if (b[k] !== undefined) put(k, !!b[k]); });
    if (!set.length) return res.json({ data: nb.out(n) });
    if (content && ((b.body !== undefined && b.body !== n.body) || (b.title !== undefined && b.title !== n.title))) await nb.snapshot(n);   // 고치기 전 모습을 (10분에 한 번)
    if (content) set.push('rev = rev + 1');
    set.push('updated_at = NOW()');
    p.push(n.id);
    var r = await db.query('UPDATE nb_notes SET ' + set.join(', ') + ' WHERE id = $' + p.length + ' RETURNING *', p);
    res.json({ data: nb.out(r.rows[0]) });
  } catch (e) { if (e.status) return bad(res, e.message, e.status); httpErr.serverError(res, '[notebook/put]', e); }
});

router.delete('/notes/:id', async function (req, res) {
  try {
    var n = await noteOf(req, req.params.id);
    if (!n) return notFound(res);
    if (req.query.purge && n.deleted_at) {
      await db.query('DELETE FROM nb_notes WHERE id = $1', [n.id]);
      return res.json({ data: { id: n.id, purged: true } });
    }
    await db.query('UPDATE nb_notes SET deleted_at = NOW() WHERE id = $1', [n.id]);
    res.json({ data: { id: n.id } });
  } catch (e) { httpErr.serverError(res, '[notebook/delete]', e); }
});
router.post('/notes/:id/restore', async function (req, res) {
  try {
    var n = await noteOf(req, req.params.id);
    if (!n) return notFound(res);
    var r = await db.query('UPDATE nb_notes SET deleted_at = NULL, updated_at = NOW() WHERE id = $1 RETURNING *', [n.id]);
    res.json({ data: nb.out(r.rows[0]) });
  } catch (e) { httpErr.serverError(res, '[notebook/restore]', e); }
});
router.post('/notes/:id/duplicate', async function (req, res) {
  try {
    var n = await noteOf(req, req.params.id);
    if (!n) return notFound(res);
    var c = await nb.create(req.tenant.id, me(req), { title: (n.title || nb.titleFrom(n.body) || '제목 없음') + ' (사본)', body: n.body, ink: n.ink, tags: n.tags, folderId: n.folder_id, inbox: n.inbox });
    res.status(201).json({ data: nb.out(c, true) });
  } catch (e) { httpErr.serverError(res, '[notebook/duplicate]', e); }
});
router.post('/trash/empty', async function (req, res) {
  try {
    var r = await db.query('DELETE FROM nb_notes WHERE tenant_id = $1 AND user_id = $2 AND deleted_at IS NOT NULL', [req.tenant.id, me(req)]);
    res.json({ data: { n: r.rowCount } });
  } catch (e) { httpErr.serverError(res, '[notebook/empty]', e); }
});

/* ─── 고친 기록 ─── */
router.get('/notes/:id/versions', async function (req, res) {
  try {
    var n = await noteOf(req, req.params.id);
    if (!n) return notFound(res);
    var r = await db.query('SELECT id, title, words, label, created_at, LENGTH(body) AS len FROM nb_versions WHERE note_id = $1 ORDER BY id DESC LIMIT 100', [n.id]);
    res.json({ data: r.rows.map(function (v) { return { id: +v.id, title: v.title, words: v.words, label: v.label, createdAt: v.created_at, len: v.len }; }) });
  } catch (e) { httpErr.serverError(res, '[notebook/versions]', e); }
});
router.get('/notes/:id/versions/:vid', async function (req, res) {
  try {
    var n = await noteOf(req, req.params.id);
    if (!n) return notFound(res);
    var r = await db.query('SELECT * FROM nb_versions WHERE id = $1 AND note_id = $2', [+req.params.vid || 0, n.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '기록이 없습니다.' });
    var v = r.rows[0];
    res.json({ data: { id: +v.id, title: v.title, body: v.body, ink: v.ink || {}, words: v.words, label: v.label, createdAt: v.created_at } });
  } catch (e) { httpErr.serverError(res, '[notebook/version]', e); }
});
router.post('/notes/:id/versions', async function (req, res) {
  try {
    var n = await noteOf(req, req.params.id);
    if (!n) return notFound(res);
    var v = await nb.snapshot(n, String((req.body || {}).label || '').trim().slice(0, 80) || '직접 저장', true);
    res.status(201).json({ data: { id: +v.id, createdAt: v.created_at } });
  } catch (e) { httpErr.serverError(res, '[notebook/version-save]', e); }
});
router.post('/notes/:id/versions/:vid/restore', async function (req, res) {
  try {
    var n = await noteOf(req, req.params.id);
    if (!n) return notFound(res);
    var r = await db.query('SELECT * FROM nb_versions WHERE id = $1 AND note_id = $2', [+req.params.vid || 0, n.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '기록이 없습니다.' });
    var v = r.rows[0];
    await nb.snapshot(n, '되돌리기 전', true);   // 되돌리기도 되돌릴 수 있게
    var u = await db.query('UPDATE nb_notes SET title = $1, body = $2, ink = COALESCE($3, ink), words = $4, rev = rev + 1, updated_at = NOW() WHERE id = $5 RETURNING *',
      [v.title, v.body, v.ink ? JSON.stringify(v.ink) : null, nb.countWords(v.body), n.id]);
    res.json({ data: nb.out(u.rows[0], true) });
  } catch (e) { httpErr.serverError(res, '[notebook/version-restore]', e); }
});

/* ─── 폴더 ─── */
router.post('/folders', async function (req, res) {
  try {
    var b = req.body || {}, name = String(b.name || '').trim().slice(0, 80);
    if (!name) return bad(res, '폴더 이름을 적어 주세요.');
    var c = await db.query('SELECT COUNT(*)::int AS n, COALESCE(MAX(sort), 0) AS s FROM nb_folders WHERE tenant_id = $1 AND user_id = $2', [req.tenant.id, me(req)]);
    if (c.rows[0].n >= 200) return bad(res, '폴더는 200개까지입니다.');
    var r = await db.query('INSERT INTO nb_folders (id, tenant_id, user_id, name, color, icon, sort) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, name, color, icon, sort',
      [nb.rid('nbf'), req.tenant.id, me(req), name, b.color ? String(b.color).slice(0, 20) : null, b.icon ? String(b.icon).slice(0, 16) : null, c.rows[0].s + 1]);
    res.status(201).json({ data: Object.assign(r.rows[0], { n: 0 }) });
  } catch (e) { httpErr.serverError(res, '[notebook/folder-create]', e); }
});
router.put('/folders/:id', async function (req, res) {
  try {
    var b = req.body || {};
    if (!await ownFolder(req, req.params.id)) return res.status(404).json({ error: 'NOT_FOUND', message: '폴더가 없습니다.' });
    var set = [], p = [];
    if (b.name !== undefined) { var name = String(b.name || '').trim().slice(0, 80); if (!name) return bad(res, '폴더 이름을 적어 주세요.'); p.push(name); set.push('name = $' + p.length); }
    if (b.color !== undefined) { p.push(b.color ? String(b.color).slice(0, 20) : null); set.push('color = $' + p.length); }
    if (b.icon !== undefined) { p.push(b.icon ? String(b.icon).slice(0, 16) : null); set.push('icon = $' + p.length); }
    if (!set.length) return bad(res, '바꿀 것이 없습니다.');
    p.push(req.params.id);
    var r = await db.query('UPDATE nb_folders SET ' + set.join(', ') + ' WHERE id = $' + p.length + ' RETURNING id, name, color, icon, sort', p);
    res.json({ data: r.rows[0] });
  } catch (e) { httpErr.serverError(res, '[notebook/folder-put]', e); }
});
router.delete('/folders/:id', async function (req, res) {
  try {
    if (!await ownFolder(req, req.params.id)) return res.status(404).json({ error: 'NOT_FOUND', message: '폴더가 없습니다.' });
    await db.query('DELETE FROM nb_folders WHERE id = $1', [req.params.id]);   // 안의 노트는 '폴더 없음' 으로 (ON DELETE SET NULL)
    res.json({ data: { id: req.params.id } });
  } catch (e) { httpErr.serverError(res, '[notebook/folder-delete]', e); }
});
router.put('/folders-order', async function (req, res) {
  try {
    var ids = Array.isArray((req.body || {}).ids) ? req.body.ids.slice(0, 200) : [];
    for (var i = 0; i < ids.length; i++) await db.query('UPDATE nb_folders SET sort = $1 WHERE id = $2 AND tenant_id = $3 AND user_id = $4', [i + 1, String(ids[i]), req.tenant.id, me(req)]);
    res.json({ data: { n: ids.length } });
  } catch (e) { httpErr.serverError(res, '[notebook/folder-order]', e); }
});

/* ─── 첨부 (사진 · 파일) — GCS 켜져 있으면 GCS, 아니면 DB ─── */
router.post('/files', express.raw({ type: function () { return true; }, limit: MAX_FILE }), async function (req, res) {
  try {
    var buf = req.body;
    if (!Buffer.isBuffer(buf) || !buf.length) return bad(res, '파일이 비었습니다.');
    var name = String(req.query.name || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 200) || 'file';
    var mime = String(req.headers['content-type'] || 'application/octet-stream').slice(0, 120);
    if (/^(text\/html|application\/x-msdownload)/i.test(mime) || /\.(exe|bat|cmd|com|scr|js|vbs|ps1|msi|html?)$/i.test(name)) return bad(res, '실행 파일 · 스크립트는 올릴 수 없습니다.');
    var noteId = req.query.noteId ? String(req.query.noteId).slice(0, 40) : null;
    if (noteId && !await noteOf(req, noteId)) noteId = null;
    var fid = nb.rid('nbf').replace('nbf-', 'nf-'), key = null, gcs = require('../services/gcs.service');
    if (gcs.isEnabled() && gcs.uploadBuffer) {
      key = 'tenants/' + req.tenant.id + '/notebook/' + me(req) + '/' + fid + (/\.[A-Za-z0-9]{1,8}$/.exec(name) || [''])[0].toLowerCase();
      await gcs.uploadBuffer(key, buf, mime);
    }
    await db.query('INSERT INTO nb_files (id, tenant_id, user_id, note_id, name, mime, size, storage_key, data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [fid, req.tenant.id, me(req), noteId, name, mime, buf.length, key, key ? null : buf]);
    res.status(201).json({ data: { id: fid, name: name, mime: mime, size: buf.length } });
  } catch (e) {
    if (e && e.type === 'entity.too.large') return bad(res, '25MB 까지 올릴 수 있습니다.', 413);
    httpErr.serverError(res, '[notebook/file]', e);
  }
});
router.get('/files/:id', async function (req, res) {
  try {
    var r = await db.query('SELECT * FROM nb_files WHERE id = $1 AND tenant_id = $2 AND user_id = $3', [req.params.id, req.tenant.id, me(req)]);
    var f = r.rows[0];
    if (!f) return res.status(404).json({ error: 'NOT_FOUND', message: '파일이 없습니다.' });
    if (f.storage_key) {
      var url = await require('../services/gcs.service').signDownloadUrl(f.storage_key, req.query.dl ? f.name : null, 10 * 60 * 1000);
      return res.json({ data: { url: url, name: f.name, mime: f.mime } });
    }
    res.setHeader('Content-Type', f.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', (req.query.dl ? 'attachment' : 'inline') + "; filename*=UTF-8''" + encodeURIComponent(f.name));
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(f.data);
  } catch (e) { httpErr.serverError(res, '[notebook/file-get]', e); }
});

/* ─── 📅 일일 노트 (예전 노트 서랍) ─── */
router.get('/daily', async function (req, res) {
  try {
    var r = await db.query("SELECT note_date, ref, LEFT(body, 2000) AS body, updated_at FROM my_notes WHERE tenant_id = $1 AND user_id = $2 AND body <> '' ORDER BY note_date DESC, ref LIMIT 500", [req.tenant.id, me(req)]);
    res.json({ data: r.rows.map(function (x) { return { date: x.note_date, ref: x.ref, snippet: nb.snippet(x.body.replace(/ ⟦[^⟧]*⟧/g, '')), updatedAt: x.updated_at }; }) });
  } catch (e) { httpErr.serverError(res, '[notebook/daily]', e); }
});

/* ─── ✨ AI 글 도구 — { action: mail|translate|polish|summary, text, lang, tone, to, purpose } ─── */
router.post('/ai', async function (req, res) {
  try {
    var b = req.body || {};
    var text = String(b.text || '').trim();
    if (!text) return bad(res, '내용이 비었습니다.');
    if (text.length > 30000) return bad(res, '한 번에 3만 자까지 처리합니다. 부분을 골라서 해 주세요.');
    var prompt = nb.aiPrompt(String(b.action || ''), text, b);
    if (!prompt) return bad(res, '모르는 작업입니다.');
    var aiUsage = require('../lib/ai-usage'), aiProvider = require('../services/ai-provider');
    var q = await aiUsage.checkQuota(req.tenant.id);
    if (!q.ok) return res.status(q.status).json({ error: q.error, message: q.message });
    var out = await aiProvider.generateText({ prompt: prompt, tenantId: req.tenant.id });
    if (!out) return res.status(503).json({ error: 'AI_NOT_CONFIGURED', message: 'AI 키가 설정되지 않았습니다. (관리자에게 문의)' });
    await aiUsage.logUsage(req.tenant.id, me(req), 'notebook:' + b.action, out.provider);
    var data = { text: String(out.text || '').trim(), provider: aiProvider.label(out.provider) };
    if (b.action === 'mail') Object.assign(data, nb.parseMail(data.text));
    res.json({ data: data });
  } catch (e) {
    try { require('../services/ai-provider').sendAiError(res, '[notebook/ai]', e, 'AI 처리 실패'); } catch (_) { httpErr.serverError(res, '[notebook/ai]', e); }
  }
});

/* ─── 데이터로 채운 양식 — 📋 일일 업무 ─── */
router.get('/template/daily', async function (req, res) {
  try {
    var d = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? req.query.date : nb.kstToday();
    var u = { id: me(req), name: req.user.name || '' };
    var items = [], evs = [];
    try { items = await require('../lib/my-work').collect(req, [u], { done: true }); } catch (e) { console.warn('[notebook/template] items', e.message); }
    try {
      var me2 = require('../lib/my-events');
      var rows = await me2.eventsFor(req, u, d, d);
      evs = rows.filter(function (e) { return me2.occurrences(e, d, d).length > 0; });   // 반복 일정도 그날 회차가 있으면
    } catch (e) { console.warn('[notebook/template] events', e.message); }
    var ICON = { issue: '🐞', action: '🤝', prestudy: '🔍', milestone: '🏁', dev: '🛠', todo: '✏️', mindmap: '🧠' };
    var doneToday = items.filter(function (it) { return it.done && it.doneAt && new Date(new Date(it.doneAt).getTime() + 9 * 3600000).toISOString().slice(0, 10) === d; });
    var open = items.filter(function (it) { return !it.done; });
    var late = open.filter(function (it) { return it.due && it.due < d; });
    var due = open.filter(function (it) { return it.due === d; });
    var focus = open.filter(function (it) { return it.focus === d && due.indexOf(it) < 0 && late.indexOf(it) < 0; });
    function line(it, chk) { return '- [' + (chk ? 'x' : ' ') + '] ' + (ICON[it.src] || '•') + ' ' + String(it.title || '').replace(/\n/g, ' ') + (it.ctx ? ' — ' + it.ctx : '') + (it.due && it.due !== d ? ' (마감 ' + it.due.slice(5).replace('-', '/') + ')' : ''); }
    var wd = '일월화수목금토'[new Date(d + 'T00:00:00Z').getUTCDay()];
    var md = '# ' + d.replace(/-/g, '.') + ' (' + wd + ') 업무 일지\n\n';
    md += '## 🗓 오늘 일정\n' + (evs.length ? evs.sort(function (a, b) { return String(a.start_time || '').localeCompare(String(b.start_time || '')); })
      .map(function (e) { return '- ' + (e.start_time ? '**' + e.start_time + '** ' : '') + (e.type === 'meeting' ? '🤝 ' : '') + (e.title || '일정'); }).join('\n') : '- 없음') + '\n\n';
    md += '## 🎯 오늘 할 일\n' + (due.concat(focus).length ? due.concat(focus).map(function (it) { return line(it); }).join('\n') : '- [ ] ') + '\n\n';
    if (late.length) md += '## ⚠️ 밀린 일 (' + late.length + ')\n' + late.slice(0, 15).map(function (it) { return line(it); }).join('\n') + '\n\n';
    if (doneToday.length) md += '## ✅ 끝낸 일\n' + doneToday.map(function (it) { return line(it, true); }).join('\n') + '\n\n';
    md += '## 📝 메모\n- \n\n## 🔜 내일 이어서\n- [ ] \n';
    res.json({ data: { title: d.slice(5).replace('-', '/') + ' (' + wd + ') 업무 일지', body: md, counts: { events: evs.length, due: due.length, late: late.length, done: doneToday.length } } });
  } catch (e) { httpErr.serverError(res, '[notebook/template]', e); }
});

module.exports = router;
