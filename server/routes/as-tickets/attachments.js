/**
 * A/S 첨부 (as_attachments) + 서명·CSAT (as_signatures)
 * routes/as-tickets.js 가 /api/as-tickets 아래(인증·테넌트 미들웨어 뒤)에 마운트한다.
 */
var express = require('express');
var router = express.Router();
var db = require('../../config/db');
var shared = require('./_shared');
var httpErr = require('../../lib/http-errors');
var ALLOWED_MIME = shared.ALLOWED_MIME;
var DENY_EXT = shared.DENY_EXT;
var MAX_FILE_BYTES = shared.MAX_FILE_BYTES;

// ────────────────────────────────────────────────────────────
// ── 첨부 (as_attachments) ──
// ────────────────────────────────────────────────────────────

router.get('/:id/attachments', async function (req, res) {
  try {
    var r = await db.query(
      'SELECT * FROM as_attachments WHERE ticket_id = $1 AND tenant_id = $2 ORDER BY uploaded_at DESC',
      [req.params.id, req.tenant.id]
    );
    res.json({ data: r.rows });
  } catch (e) {
    httpErr.serverError(res, '[as-attachments/list]', e);
  }
});

// POST — 메타데이터 등록. file_url은 외부 URL 또는 data URL 가정 (v1)
router.post('/:id/attachments', async function (req, res) {
  try {
    var b = req.body || {};
    var fileName = b.fileName || b.file_name;
    var fileUrl = b.fileUrl || b.file_url;
    var mimeType = b.mimeType || b.mime_type || null;
    var fileSize = b.fileSize != null ? b.fileSize : (b.file_size != null ? b.file_size : null);

    if (!fileName) return res.status(400).json({ error: 'VALIDATION', message: '파일 이름 필수' });
    if (!fileUrl) return res.status(400).json({ error: 'VALIDATION', message: '파일 URL 필수' });

    // 1) 위험 확장자 차단 (SVG/HTML/스크립트/실행파일)
    if (DENY_EXT.test(fileName)) {
      return res.status(400).json({ error: 'UNSAFE_EXT', message: '실행/스크립트 파일 확장자는 첨부할 수 없습니다.' });
    }

    // 2) URL 스킴 검증 — data: 또는 http(s):// 만 허용 (file:/javascript: 등 차단)
    var isDataUrl = /^data:/i.test(fileUrl);
    if (!isDataUrl) {
      if (!/^https?:\/\//i.test(fileUrl)) {
        return res.status(400).json({ error: 'INVALID_URL', message: '허용되지 않는 URL 스킴입니다.' });
      }
    } else {
      // dataURL: 헤더에서 mime 파싱 + 사이즈 추정
      var m = fileUrl.match(/^data:([^;,]+)[^,]*,(.*)$/i);
      if (!m) return res.status(400).json({ error: 'INVALID_DATA_URL', message: 'data URL 형식 오류' });
      var dataMime = m[1].toLowerCase();
      if (!mimeType) mimeType = dataMime;
      if (ALLOWED_MIME.indexOf(dataMime) < 0) {
        return res.status(400).json({ error: 'UNSAFE_MIME', message: '허용되지 않는 MIME 타입입니다: ' + dataMime });
      }
      // base64 페이로드 길이 → 실제 바이트 추정 (대략 길이 * 3/4)
      var payload = m[2] || '';
      var estBytes = Math.floor(payload.length * 3 / 4);
      if (fileSize == null) fileSize = estBytes;
      if (estBytes > MAX_FILE_BYTES) {
        return res.status(413).json({ error: 'TOO_LARGE', message: '파일 크기 한도(10MB) 초과' });
      }
    }

    // 3) MIME 검증 (제공된 경우 화이트리스트 검사)
    if (mimeType && ALLOWED_MIME.indexOf(mimeType) < 0) {
      return res.status(400).json({ error: 'UNSAFE_MIME', message: '허용되지 않는 MIME 타입입니다: ' + mimeType });
    }

    // 4) 사이즈 검증 (제공된 경우)
    if (fileSize != null && fileSize > MAX_FILE_BYTES) {
      return res.status(413).json({ error: 'TOO_LARGE', message: '파일 크기 한도(10MB) 초과' });
    }

    var id = b.id || ('asa-' + require('crypto').randomUUID().slice(0, 12));
    var r = await db.query(
      'INSERT INTO as_attachments ' +
      '(id, ticket_id, tenant_id, category, file_name, file_url, file_size, mime_type, note, uploaded_by) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
      [id, req.params.id, req.tenant.id,
       b.category || 'etc',
       fileName,
       fileUrl,
       fileSize,
       mimeType,
       b.note || null,
       req.user.sub]
    );
    res.status(201).json({ data: r.rows[0] });
  } catch (e) {
    httpErr.serverError(res, '[as-attachments/create]', e);
  }
});

router.delete('/:id/attachments/:aid', async function (req, res) {
  try {
    var r = await db.query(
      'DELETE FROM as_attachments WHERE id = $1 AND ticket_id = $2 AND tenant_id = $3 RETURNING id',
      [req.params.aid, req.params.id, req.tenant.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ message: '삭제 완료' });
  } catch (e) {
    httpErr.serverError(res, '[as-attachments/delete]', e);
  }
});

// ────────────────────────────────────────────────────────────
// ── 서명·CSAT (as_signatures) ──
// ────────────────────────────────────────────────────────────

router.get('/:id/signatures', async function (req, res) {
  try {
    var r = await db.query(
      'SELECT * FROM as_signatures WHERE ticket_id = $1 AND tenant_id = $2 ORDER BY role ASC',
      [req.params.id, req.tenant.id]
    );
    res.json({ data: r.rows });
  } catch (e) {
    httpErr.serverError(res, '[as-signatures/list]', e);
  }
});

// POST — UPSERT (role 기준)
router.post('/:id/signatures', async function (req, res) {
  try {
    var b = req.body || {};
    if (!b.role) return res.status(400).json({ error: 'VALIDATION', message: '서명 역할 필수' });

    // 티켓이 이 테넌트 소속인지 먼저 확인 — 다른 테넌트 티켓에 서명을 붙이지 못하게
    var own = await db.query('SELECT 1 FROM as_tickets WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    if (!own.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });

    var id = b.id || ('ass-' + require('crypto').randomUUID().slice(0, 12));
    // UPSERT
    var r = await db.query(
      'INSERT INTO as_signatures ' +
      '(id, ticket_id, tenant_id, role, signer_name, signer_id, signed_at, signature_url, ' +
      ' csat_speed, csat_quality, csat_overall, comment, created_by) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,NOW()),$8,$9,$10,$11,$12,$13) ' +
      'ON CONFLICT (ticket_id, role) DO UPDATE SET ' +
      '  signer_name = EXCLUDED.signer_name, signer_id = EXCLUDED.signer_id, ' +
      '  signed_at = EXCLUDED.signed_at, signature_url = EXCLUDED.signature_url, ' +
      '  csat_speed = EXCLUDED.csat_speed, csat_quality = EXCLUDED.csat_quality, ' +
      '  csat_overall = EXCLUDED.csat_overall, comment = EXCLUDED.comment ' +
      // 다른 테넌트의 (ticket_id, role) 행을 덮어쓰지 않도록 가드
      'WHERE as_signatures.tenant_id = EXCLUDED.tenant_id ' +
      'RETURNING *',
      [id, req.params.id, req.tenant.id, b.role,
       b.signerName || b.signer_name || null,
       b.signerId || b.signer_id || null,
       b.signedAt || b.signed_at || null,
       b.signatureUrl || b.signature_url || null,
       b.csatSpeed || b.csat_speed || null,
       b.csatQuality || b.csat_quality || null,
       b.csatOverall || b.csat_overall || null,
       b.comment || null,
       req.user.sub]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });

    // 고객 현장 서명이 들어오면 status를 customer_wait → approved → closed 보조 자동 전이
    if (b.role === 'customer_field') {
      await db.query(
        "UPDATE as_tickets SET status = 'customer_wait', updated_at = NOW(), updated_by = $3 " +
        "WHERE id = $1 AND tenant_id = $2 AND status IN ('reporting','approved')",
        [req.params.id, req.tenant.id, req.user.sub]
      );
    }

    res.status(201).json({ data: r.rows[0] });
  } catch (e) {
    httpErr.serverError(res, '[as-signatures/upsert]', e);
  }
});

router.delete('/:id/signatures/:sid', async function (req, res) {
  try {
    var r = await db.query(
      'DELETE FROM as_signatures WHERE id = $1 AND ticket_id = $2 AND tenant_id = $3 RETURNING id',
      [req.params.sid, req.params.id, req.tenant.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ message: '삭제 완료' });
  } catch (e) {
    httpErr.serverError(res, '[as-signatures/delete]', e);
  }
});


module.exports = router;
