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
 *   GET|PUT /print-settings              🖨 출력 머리글(회사 이름 · 로고) — 고치기는 관리자 (v13.319)
 *   GET    /bundle?src=daily|notes&from&to[&folderId&tag]   묶어 출력할 노트 (62개까지)
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
    var sc = await db.query('SELECT COUNT(*)::int AS n FROM nb_shares s JOIN nb_notes n ON n.id = s.note_id AND n.deleted_at IS NULL WHERE s.tenant_id = $1 AND s.user_id = $2', [T, U]);
    counts.shared = sc.rows[0].n;
    res.json({ data: { folders: f.rows, tags: t.rows, counts: counts } });
  } catch (e) { httpErr.serverError(res, '[notebook/meta]', e); }
});

/* ─── 목록 ─── */
router.get('/notes', async function (req, res) {
  try {
    var q = req.query, p = [req.tenant.id, me(req)], w = ['n.tenant_id = $1', 'n.user_id = $2'];
    var view = String(q.view || 'all');
    if (view === 'shared') {   // 👥 공유받은 노트 (v13.317)
      var sr = await db.query("SELECT n.id, n.title, n.tags, n.words, n.rev, n.created_at, n.updated_at, LEFT(n.body, 3000) AS body, (n.ink ? 'blocks' AND n.ink->'blocks' <> '{}'::jsonb) AS has_ink, " +
        'COALESCE(u.display_name, u.name) AS owner_name FROM nb_shares s JOIN nb_notes n ON n.id = s.note_id AND n.deleted_at IS NULL LEFT JOIN users u ON u.id = n.user_id ' +
        'WHERE s.tenant_id = $1 AND s.user_id = $2 ORDER BY n.updated_at DESC LIMIT 500', [req.tenant.id, me(req)]);
      return res.json({ data: sr.rows.map(function (n) { var o = nb.out(n); o.readOnly = true; o.ownerName = n.owner_name || ''; o.folderId = null; o.pinned = false; o.starred = false; o.inbox = false; return o; }) });
    }
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
    if (!n) {   // 👥 공유받은 노트 — 읽기 전용 (v13.317)
      var sh = await db.query('SELECT n.*, COALESCE(u.display_name, u.name) AS owner_name FROM nb_notes n JOIN nb_shares s ON s.note_id = n.id AND s.user_id = $2 LEFT JOIN users u ON u.id = n.user_id WHERE n.id = $1 AND n.tenant_id = $3 AND n.deleted_at IS NULL', [req.params.id, me(req), req.tenant.id]);
      if (!sh.rows.length) return notFound(res);
      var o = nb.out(sh.rows[0], true);
      o.readOnly = true; o.ownerName = sh.rows[0].owner_name || ''; o.folderId = null; o.pinned = false; o.starred = false;
      return res.json({ data: o });
    }
    var out = nb.out(n, true);
    var shc = await db.query('SELECT COUNT(*)::int AS n FROM nb_shares WHERE note_id = $1', [n.id]);
    out.shareN = shc.rows[0].n;
    res.json({ data: out });
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
    // 내 첨부 · 또는 나에게 공유된 노트 본문에 들어 있는 첨부 (v13.317)
    var r = await db.query("SELECT f.* FROM nb_files f WHERE f.id = $1 AND f.tenant_id = $2 AND (f.user_id = $3 OR EXISTS (SELECT 1 FROM nb_shares s JOIN nb_notes n ON n.id = s.note_id WHERE s.user_id = $3 AND n.deleted_at IS NULL AND n.user_id = f.user_id AND POSITION(('nbf:' || f.id) IN n.body) > 0))", [req.params.id, req.tenant.id, me(req)]);
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

/* ═══ v13.317 연결 · 공유 · 리포트 ═══ */

/* 👥 공유 (읽기 전용) — 새로 받은 사람에게 메신저 1:1 로 카드 */
router.get('/notes/:id/shares', async function (req, res) {
  try {
    var n = await noteOf(req, req.params.id);
    if (!n) return notFound(res);
    var r = await db.query('SELECT s.user_id, COALESCE(u.display_name, u.name) AS name FROM nb_shares s JOIN users u ON u.id = s.user_id WHERE s.note_id = $1 ORDER BY 2', [n.id]);
    res.json({ data: r.rows.map(function (x) { return { id: x.user_id, name: x.name }; }) });
  } catch (e) { httpErr.serverError(res, '[notebook/shares]', e); }
});
router.put('/notes/:id/shares', async function (req, res) {
  try {
    var n = await noteOf(req, req.params.id);
    if (!n) return notFound(res);
    if (n.deleted_at) return bad(res, '휴지통의 노트는 공유할 수 없습니다.');
    var want = Array.isArray((req.body || {}).userIds) ? req.body.userIds.map(String).filter(function (u) { return u !== me(req); }).slice(0, 100) : [];
    var ok = want.length ? (await db.query("SELECT id FROM users WHERE tenant_id = $1 AND status = 'active' AND id::text = ANY($2)", [req.tenant.id, want])).rows.map(function (x) { return x.id; }) : [];
    var before = (await db.query('SELECT user_id FROM nb_shares WHERE note_id = $1', [n.id])).rows.map(function (x) { return x.user_id; });
    await db.query('DELETE FROM nb_shares WHERE note_id = $1 AND NOT (user_id = ANY($2::uuid[]))', [n.id, ok]);
    for (var i = 0; i < ok.length; i++) await db.query('INSERT INTO nb_shares (note_id, user_id, tenant_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [n.id, ok[i], req.tenant.id]);
    var added = ok.filter(function (u) { return before.indexOf(u) < 0; });
    if (added.length && (req.body || {}).notify !== false) {
      var chat = require('./chat'), title = n.title || nb.titleFrom(n.body) || '제목 없음';
      for (var k = 0; k < added.length; k++) {
        try {
          var room = await chat.dmRoom(req.tenant.id, me(req), added[k], me(req));
          await chat.postMessage({ tenantId: req.tenant.id }, room, { userId: me(req), kind: 'text', body: '📓 노트를 공유했습니다 (읽기 전용)' + (req.body.message ? '\n' + String(req.body.message).slice(0, 500) : ''),
            cards: [{ type: 'note', id: n.id, title: title, sub: '📓 노트북 · 읽기 전용', nav: { nbId: n.id } }] });
        } catch (e2) { console.warn('[notebook/share→chat]', e2.message); }
      }
    }
    res.json({ data: { userIds: ok, added: added.length } });
  } catch (e) { httpErr.serverError(res, '[notebook/share]', e); }
});

/* ─── 🖨 출력 머리글 (v13.319) — 회사 이름 · 로고. 누구나 읽고 관리자만 고침 ─── */
var printSettings = require('../lib/print-settings');
function isAdmin(req) { return req.user.role === 'admin'; }
router.get('/print-settings', async function (req, res) {
  try {
    var x = await printSettings.get(req.tenant.id);
    x.canEdit = isAdmin(req);
    res.json({ data: x });
  } catch (e) { httpErr.serverError(res, '[notebook/print-settings]', e); }
});
router.put('/print-settings', async function (req, res) {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'FORBIDDEN', message: '회사 머리글은 관리자만 바꿀 수 있습니다.' });
    var r = await printSettings.save(req.tenant.id, me(req), req.body);
    if (r.error) return bad(res, r.error);
    r.canEdit = true;
    res.json({ data: r, message: '출력 머리글을 저장했습니다.' });
  } catch (e) { httpErr.serverError(res, '[notebook/print-settings/save]', e); }
});
/* 묶어 출력 — src=daily (일일 노트, 날짜) | notes (내 노트, 고친 날 · 폴더 · 태그). 날짜 순, 62개까지 */
router.get('/bundle', async function (req, res) {
  try {
    var q = req.query, D = /^\d{4}-\d{2}-\d{2}$/;
    var from = D.test(String(q.from || '')) ? q.from : null, to = D.test(String(q.to || '')) ? q.to : null;
    if (!from || !to || from > to) return bad(res, '기간을 골라 주세요.');
    if ((Date.parse(to) - Date.parse(from)) / 86400000 > 92) return bad(res, '한 번에 석 달(92일)까지 묶을 수 있습니다.');
    var T = req.tenant.id, U = me(req), r;
    if (q.src === 'daily') {
      r = await db.query("SELECT note_date, ref, body FROM my_notes WHERE tenant_id = $1 AND user_id = $2 AND body <> '' AND note_date BETWEEN $3 AND $4 ORDER BY note_date, ref LIMIT 62", [T, U, from, to]);
      return res.json({ data: r.rows.map(function (x) { return { kind: 'daily', date: x.note_date, ref: x.ref || '', title: '', body: x.body, ink: null }; }) });
    }
    var p = [T, U, from, to], w = '';
    if (q.folderId) { p.push(String(q.folderId)); w += ' AND folder_id = $' + p.length; }
    if (q.tag) { p.push(String(q.tag)); w += ' AND tags ? $' + p.length; }
    r = await db.query("SELECT id, title, body, ink, tags, to_char(updated_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS day FROM nb_notes " +
      "WHERE tenant_id = $1 AND user_id = $2 AND deleted_at IS NULL AND (updated_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN $3::date AND $4::date" + w +
      ' ORDER BY updated_at LIMIT 62', p);
    res.json({ data: r.rows.map(function (x) { return { kind: 'note', id: x.id, date: x.day, title: x.title || nb.titleFrom(x.body) || '', body: x.body, ink: x.ink || null, tags: x.tags || [] }; }) });
  } catch (e) { httpErr.serverError(res, '[notebook/bundle]', e); }
});

/* [[노트]] — 내 노트 제목 목록 (자동 완성 · 링크 찾기) */
router.get('/titles', async function (req, res) {
  try {
    var r = await db.query("SELECT id, title, LEFT(body, 200) AS body, updated_at FROM nb_notes WHERE tenant_id = $1 AND user_id = $2 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 3000", [req.tenant.id, me(req)]);
    res.json({ data: r.rows.map(function (x) { return { id: x.id, title: x.title || nb.titleFrom(x.body) || '', updatedAt: x.updated_at }; }).filter(function (x) { return x.title; }) });
  } catch (e) { httpErr.serverError(res, '[notebook/titles]', e); }
});
/* 이 노트를 가리키는 노트 — [[제목]] 또는 (wm:note:id) */
router.get('/notes/:id/backlinks', async function (req, res) {
  try {
    var n = await noteOf(req, req.params.id);
    if (!n) return notFound(res);
    var title = n.title || nb.titleFrom(n.body);
    var p = [req.tenant.id, me(req), n.id, 'wm:note:' + n.id + ')'];
    var cond = 'POSITION($4 IN body) > 0';
    if (title) { p.push('[[' + title + ']]', '[[' + title + '|'); cond = '(' + cond + ' OR POSITION($5 IN body) > 0 OR POSITION($6 IN body) > 0)'; }
    var r = await db.query('SELECT id, title, LEFT(body, 3000) AS body, updated_at FROM nb_notes WHERE tenant_id = $1 AND user_id = $2 AND id <> $3 AND deleted_at IS NULL AND ' + cond + ' ORDER BY updated_at DESC LIMIT 50', p);
    res.json({ data: r.rows.map(function (x) {
      var i = x.body.indexOf('[[' + title), j = i >= 0 ? i : x.body.indexOf('wm:note:' + n.id);
      return { id: x.id, title: x.title || nb.titleFrom(x.body) || '제목 없음', updatedAt: x.updated_at, ctx: j >= 0 ? nb.snippet(x.body.slice(Math.max(0, j - 50), j + 70), 120) : '' };
    }) });
  } catch (e) { httpErr.serverError(res, '[notebook/backlinks]', e); }
});

/* 🔗 업무 연결 칩 — 지금 상태 (권한 그대로: 볼 수 없으면 locked) */
router.post('/refs', async function (req, res) {
  try {
    var pa = require('../lib/project-access');
    var list = Array.isArray((req.body || {}).refs) ? req.body.refs.slice(0, 80) : [];
    var T = req.tenant.id, out = {};
    async function projOk(pid) { return !pid || await pa.canReadById(req, pid); }
    for (var i = 0; i < list.length; i++) {
      var t = String(list[i].t || ''), id = String(list[i].id || '').slice(0, 100), key = t + ':' + id, r, x;
      if (!id || out[key]) continue;
      try {
        if (t === 'project') {
          r = await db.query('SELECT id, name, progress, status, end_date FROM projects WHERE id = $1 AND tenant_id = $2', [id, T]); x = r.rows[0];
          out[key] = !x ? { missing: true } : !(await projOk(x.id)) ? { locked: true } : { title: x.name, progress: x.progress, status: x.status, due: x.end_date, nav: { projectId: x.id } };
        } else if (t === 'issue') {
          r = await db.query('SELECT id, title, status, urgency, project_id, created_by, due_date FROM issues WHERE id = $1 AND tenant_id = $2', [id, T]); x = r.rows[0];
          var okI = x && (x.project_id ? await projOk(x.project_id) : (x.created_by === me(req) || req.user.role === 'admin'));
          out[key] = !x ? { missing: true } : !okI ? { locked: true } : { title: x.title, status: x.status, urgency: x.urgency, due: x.due_date, done: ['resolved', 'closed'].indexOf(x.status) >= 0, nav: { issueId: x.id } };
        } else if (t === 'milestone') {
          r = await db.query('SELECT id, name, progress, status, end_date, project_id FROM milestones WHERE id = $1 AND tenant_id = $2', [id, T]); x = r.rows[0];
          out[key] = !x ? { missing: true } : !(await projOk(x.project_id)) ? { locked: true } : { title: x.name, progress: x.progress, status: x.status, due: x.end_date, nav: { projectId: x.project_id, tab: 'work' } };
        } else if (t === 'meeting') {
          r = await db.query('SELECT id, title, meet_date, project_id, created_by FROM meetings WHERE id = $1 AND tenant_id = $2', [id, T]); x = r.rows[0];
          var okM = x && (x.project_id ? await projOk(x.project_id) : x.created_by === me(req));
          out[key] = !x ? { missing: true } : !okM ? { locked: true } : { title: x.title || '회의', due: x.meet_date, nav: { projectId: x.project_id, meetingId: x.id } };
        } else if (t === 'todo') {
          r = await db.query('SELECT id, title, due_date, done_at, deleted_at FROM my_todos WHERE id = $1 AND tenant_id = $2 AND user_id = $3', [id, T, me(req)]); x = r.rows[0];
          out[key] = !x || x.deleted_at ? { missing: true } : { title: x.title, due: x.due_date, done: !!x.done_at, nav: { todoId: x.id } };
        } else if (t === 'note') {
          r = await db.query('SELECT id, title, LEFT(body, 200) AS body FROM nb_notes WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL AND (user_id = $3 OR EXISTS (SELECT 1 FROM nb_shares s WHERE s.note_id = nb_notes.id AND s.user_id = $3))', [id, T, me(req)]); x = r.rows[0];
          out[key] = !x ? { missing: true } : { title: x.title || nb.titleFrom(x.body) || '노트', nav: { nbId: x.id } };
        }
      } catch (e1) { out[key] = { error: true }; }
    }
    res.json({ data: out });
  } catch (e) { httpErr.serverError(res, '[notebook/refs]', e); }
});

/* 📊 리포트 — { from, to, folderId, tag, inbox, daily, style: raw|weekly|summary } */
router.post('/report', async function (req, res) {
  try {
    var b = req.body || {};
    var ymd = /^\d{4}-\d{2}-\d{2}$/;
    if (!ymd.test(b.from || '') || !ymd.test(b.to || '') || b.from > b.to) return bad(res, '기간을 바르게 골라 주세요.');
    var p = [req.tenant.id, me(req), b.from, b.to], w = ["n.tenant_id = $1", "n.user_id = $2", "n.deleted_at IS NULL", "(n.updated_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN $3::date AND $4::date"];
    if (!b.inbox) w.push('NOT n.inbox');
    if (b.folderId) { p.push(String(b.folderId)); w.push('n.folder_id = $' + p.length); }
    if (b.tag) { p.push(JSON.stringify([String(b.tag)])); w.push('n.tags @> $' + p.length + '::jsonb'); }
    if (Array.isArray(b.noteIds) && b.noteIds.length) { p.push(b.noteIds.map(String).slice(0, 200)); w.push('n.id = ANY($' + p.length + ')'); }
    var notes = (await db.query('SELECT n.* FROM nb_notes n WHERE ' + w.join(' AND ') + ' ORDER BY n.updated_at LIMIT 300', p)).rows;
    var daily = b.daily && !b.folderId && !b.tag ? (await db.query("SELECT note_date, ref, body, updated_at FROM my_notes WHERE tenant_id = $1 AND user_id = $2 AND body <> '' AND note_date BETWEEN $3 AND $4 ORDER BY note_date, ref", [req.tenant.id, me(req), b.from, b.to])).rows : [];
    if (!notes.length && !daily.length) return bad(res, '이 기간 · 범위에 노트가 없습니다.');
    var style = ['raw', 'weekly', 'summary'].indexOf(b.style) >= 0 ? b.style : 'raw';
    var title = (b.title || (style === 'weekly' ? '주간 업무 보고' : style === 'summary' ? '요약 보고서' : '노트 모음')) + ' (' + b.from.slice(5).replace('-', '/') + '~' + b.to.slice(5).replace('-', '/') + ')';
    var raw = nb.reportRaw(notes, daily, { title: title, from: b.from, to: b.to });
    if (style === 'raw') return res.json({ data: { title: title, body: raw.md, count: raw.count, style: style } });
    var aiUsage = require('../lib/ai-usage'), aiProvider = require('../services/ai-provider');
    var q = await aiUsage.checkQuota(req.tenant.id);
    if (!q.ok) return res.status(q.status).json({ error: q.error, message: q.message });
    var outAi = await aiProvider.generateText({ prompt: nb.reportPrompt(style, raw.md.slice(0, 30000), b), tenantId: req.tenant.id });
    if (!outAi) return res.status(503).json({ error: 'AI_NOT_CONFIGURED', message: 'AI 키가 설정되지 않았습니다. (관리자에게 문의) — "그대로 모으기" 는 쓸 수 있습니다.' });
    await aiUsage.logUsage(req.tenant.id, me(req), 'notebook:report', outAi.provider);
    var text = String(outAi.text || '').replace(/^```[a-z]*\n?|```\s*$/g, '').trim();
    res.json({ data: { title: title, body: style === 'summary' && !/^#\s/.test(text) ? '# ' + title + '\n\n' + text : text, count: raw.count, style: style, provider: aiProvider.label(outAi.provider) } });
  } catch (e) {
    try { require('../services/ai-provider').sendAiError(res, '[notebook/report]', e, '리포트 만들기 실패'); } catch (_) { httpErr.serverError(res, '[notebook/report]', e); }
  }
});

/* ═══ v13.318 ✍️ 글쓰기 코치 ═══ */
router.post('/coach', async function (req, res) {
  try {
    var b = req.body || {};
    var text = String(b.text || '').trim();
    if (text.replace(/\s/g, '').length < 30) return bad(res, '코치를 받으려면 30자 넘게 써 주세요.');
    var aiUsage = require('../lib/ai-usage'), aiProvider = require('../services/ai-provider');
    var q = await aiUsage.checkQuota(req.tenant.id);
    if (!q.ok) return res.status(q.status).json({ error: q.error, message: q.message });
    var out = await aiProvider.generateText({ prompt: nb.coachPrompt(text, String(b.kind || 'note'), Array.isArray(b.rules) ? b.rules.map(String) : []), tenantId: req.tenant.id });
    if (!out) return res.status(503).json({ error: 'AI_NOT_CONFIGURED', message: 'AI 키가 설정되지 않았습니다 — 규칙 검사는 그대로 쓸 수 있습니다.' });
    await aiUsage.logUsage(req.tenant.id, me(req), 'notebook:coach', out.provider);
    var c = nb.parseCoach(out.text, text);
    if (!c) return res.status(502).json({ error: 'AI_FORMAT', message: 'AI 답을 읽지 못했습니다. 다시 눌러 주세요.' });
    c.provider = aiProvider.label(out.provider);
    if (b.noteId) {
      await db.query("INSERT INTO nb_coach_logs (tenant_id, user_id, note_id, day, kind, scores, chars, ai, task) VALUES ($1,$2,$3,(NOW() AT TIME ZONE 'Asia/Seoul')::date,$4,$5,$6,TRUE,$7) " +
        'ON CONFLICT (user_id, note_id, day) DO UPDATE SET scores = EXCLUDED.scores, ai = TRUE, task = EXCLUDED.task, kind = EXCLUDED.kind',
        [req.tenant.id, me(req), String(b.noteId).slice(0, 60), String(b.kind || 'note').slice(0, 20), JSON.stringify(c.scores), text.replace(/\s/g, '').length, c.task || null]);
    }
    res.json({ data: c });
  } catch (e) {
    try { require('../services/ai-provider').sendAiError(res, '[notebook/coach]', e, 'AI 코치 실패'); } catch (_) { httpErr.serverError(res, '[notebook/coach]', e); }
  }
});
/* 규칙 검사 결과 기록 — 버릇 개수 · 규칙 점수 (AI 점수가 있으면 그대로 둠) */
router.post('/coach/log', async function (req, res) {
  try {
    var b = req.body || {};
    var noteId = String(b.noteId || '').slice(0, 60);
    if (!noteId) return bad(res, 'noteId 필요');
    var counts = {};
    Object.keys(b.counts || {}).slice(0, 40).forEach(function (k) { var v = +b.counts[k]; if (v > 0 && v < 10000) counts[String(k).slice(0, 30)] = Math.round(v); });
    var sc = {}; ['clarity', 'concise', 'structure', 'evidence', 'total'].forEach(function (k) { var v = +((b.scores || {})[k]); if (isFinite(v)) sc[k] = Math.max(0, Math.min(100, Math.round(v))); });
    await db.query("INSERT INTO nb_coach_logs (tenant_id, user_id, note_id, day, kind, scores, counts, chars) VALUES ($1,$2,$3,(NOW() AT TIME ZONE 'Asia/Seoul')::date,$4,$5,$6,$7) " +
      'ON CONFLICT (user_id, note_id, day) DO UPDATE SET counts = EXCLUDED.counts, chars = EXCLUDED.chars, kind = EXCLUDED.kind, scores = CASE WHEN nb_coach_logs.ai THEN nb_coach_logs.scores ELSE EXCLUDED.scores END',
      [req.tenant.id, me(req), noteId, String(b.kind || 'note').slice(0, 20), JSON.stringify(sc), JSON.stringify(counts), Math.max(0, Math.min(1000000, +b.chars || 0))]);
    res.json({ data: { ok: true } });
  } catch (e) { httpErr.serverError(res, '[notebook/coach-log]', e); }
});
/* 📈 나의 글쓰기 — 최근 8주 (주 = 월요일 시작) */
router.get('/coach/stats', async function (req, res) {
  try {
    var r = await db.query("SELECT to_char(date_trunc('week', day), 'YYYY-MM-DD') AS wk, COUNT(*)::int AS n, SUM(chars)::int AS chars, " +
      "ROUND(AVG((scores->>'total')::numeric))::int AS total, ROUND(AVG((scores->>'clarity')::numeric))::int AS clarity, ROUND(AVG((scores->>'concise')::numeric))::int AS concise, " +
      "ROUND(AVG((scores->>'structure')::numeric))::int AS structure, ROUND(AVG((scores->>'evidence')::numeric))::int AS evidence " +
      "FROM nb_coach_logs WHERE tenant_id = $1 AND user_id = $2 AND day >= (NOW() AT TIME ZONE 'Asia/Seoul')::date - 56 GROUP BY 1 ORDER BY 1", [req.tenant.id, me(req)]);
    var h = await db.query("SELECT to_char(date_trunc('week', day), 'YYYY-MM-DD') AS wk, k, SUM(v::int)::int AS n FROM nb_coach_logs, jsonb_each_text(counts) AS e(k, v) " +
      "WHERE tenant_id = $1 AND user_id = $2 AND day >= (NOW() AT TIME ZONE 'Asia/Seoul')::date - 14 GROUP BY 1, 2", [req.tenant.id, me(req)]);
    var t = await db.query("SELECT task, to_char(day, 'YYYY-MM-DD') AS day FROM nb_coach_logs WHERE tenant_id = $1 AND user_id = $2 AND task IS NOT NULL ORDER BY nb_coach_logs.day DESC, id DESC LIMIT 1", [req.tenant.id, me(req)]);
    var thisWk = await db.query("SELECT to_char(date_trunc('week', (NOW() AT TIME ZONE 'Asia/Seoul')::date), 'YYYY-MM-DD') AS wk");
    var cur = thisWk.rows[0].wk;   // 글자로 받음 — Date 로 받으면 시간대 따라 하루 밀림
    function wk(x) { return String(x instanceof Date ? new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString() : x).slice(0, 10); }
    var habits = {};
    h.rows.forEach(function (x) { var w0 = wk(x.wk); habits[x.k] = habits[x.k] || { k: x.k, now: 0, prev: 0 }; if (w0 === cur) habits[x.k].now += x.n; else habits[x.k].prev += x.n; });
    res.json({ data: {
      weeks: r.rows.map(function (x) { return { wk: wk(x.wk), n: x.n, chars: x.chars, total: x.total, clarity: x.clarity, concise: x.concise, structure: x.structure, evidence: x.evidence }; }),
      habits: Object.keys(habits).map(function (k) { return habits[k]; }).sort(function (a, b) { return b.now - a.now || b.prev - a.prev; }).slice(0, 12),
      task: t.rows[0] ? { text: t.rows[0].task, day: wk(t.rows[0].day) } : null, week: cur
    } });
  } catch (e) { httpErr.serverError(res, '[notebook/coach-stats]', e); }
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
