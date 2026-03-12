/**
 * 초기 관리자 계정 시드 스크립트
 *
 * 사용법:
 *   node scripts/seed-admin.js --email admin@company.com --name "관리자" --password "SecureP@ss1"
 *
 * 또는 환경변수:
 *   ADMIN_EMAIL=admin@company.com ADMIN_NAME=관리자 ADMIN_PASSWORD=SecureP@ss1 node scripts/seed-admin.js
 */

var path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

var db = require('../config/db');
var authService = require('../services/auth.service');

function parseArgs() {
  var args = process.argv.slice(2);
  var opts = {};
  for (var i = 0; i < args.length; i += 2) {
    var key = args[i].replace(/^--/, '');
    opts[key] = args[i + 1] || '';
  }
  return opts;
}

async function seed() {
  var args = parseArgs();
  var email = (args.email || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  var name = args.name || process.env.ADMIN_NAME || '시스템관리자';
  var password = args.password || process.env.ADMIN_PASSWORD || '';

  if (!email || !password) {
    console.error('사용법: node scripts/seed-admin.js --email <이메일> --name <이름> --password <비밀번호>');
    process.exit(1);
  }

  var pwErr = authService.validatePassword(password);
  if (pwErr) {
    console.error('비밀번호 정책 오류:', pwErr);
    process.exit(1);
  }

  try {
    // 이미 존재하는지 확인
    var existing = await authService.findUserByEmail(email);
    if (existing) {
      console.log('이미 존재하는 이메일입니다:', email);
      console.log('역할:', existing.role, '/ 상태:', existing.status);
      process.exit(0);
    }

    var hash = await authService.hashPassword(password);

    var result = await db.query(
      "INSERT INTO users (email, password_hash, name, role, status) VALUES ($1, $2, $3, 'admin', 'active') RETURNING id, email, name, role, status",
      [email, hash, name]
    );

    var user = result.rows[0];

    await db.query(
      'INSERT INTO password_history (user_id, password_hash) VALUES ($1, $2)',
      [user.id, hash]
    );

    console.log('관리자 계정 생성 완료:');
    console.log('  ID:', user.id);
    console.log('  이메일:', user.email);
    console.log('  이름:', user.name);
    console.log('  역할:', user.role);
    console.log('  상태:', user.status);

    process.exit(0);
  } catch (e) {
    console.error('시드 오류:', e.message);
    process.exit(1);
  }
}

seed();
