/**
 * print-settings.js — 🖨 출력 머리글(회사 이름 · 로고) 한 곳 (v13.319~)
 * 노트 출력(/api/notebook/print-settings)과 회의록 문서(/api/meetings/*)가 같이 쓴다. 회사(tenant)마다 한 줄.
 */
var db = require('../config/db');

var LOGO_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
var LOGO_MAX = 400000;

async function get(tenantId) {
  var r = await db.query('SELECT company, logo, updated_at FROM doc_print_settings WHERE tenant_id = $1', [tenantId]);
  var x = r.rows[0] || {};
  return { company: x.company || '', logo: x.logo || '', updatedAt: x.updated_at || null };
}
/** 검사 후 저장 — 잘못된 로고면 { error } */
async function save(tenantId, userId, b) {
  var company = String((b && b.company) || '').trim().slice(0, 120);
  var logo = String((b && b.logo) || '');
  if (logo && (!LOGO_RE.test(logo) || logo.length > LOGO_MAX)) return { error: '로고는 PNG · JPG · WEBP · GIF 그림, 300KB 까지입니다.' };
  await db.query('INSERT INTO doc_print_settings (tenant_id, company, logo, updated_by, updated_at) VALUES ($1, $2, $3, $4, NOW()) ' +
    'ON CONFLICT (tenant_id) DO UPDATE SET company = $2, logo = $3, updated_by = $4, updated_at = NOW()', [tenantId, company || null, logo || null, userId]);
  return { company: company, logo: logo };
}

module.exports = { get: get, save: save, LOGO_RE: LOGO_RE };
