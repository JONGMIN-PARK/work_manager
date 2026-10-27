// 루트 migrations(기본 스키마) 적용 → 서버 migrations 실행 → 테스트 사용자 3명 생성
// 실행: node setup.js (server/node_modules 사용)
process.env.DATABASE_URL = 'postgres://postgres:pw@localhost:54329/wm';
var path = require('path');
var fs = require('fs');
var SRV = path.join(__dirname, '../../server');
var req = function (m) { return require(path.join(SRV, 'node_modules', m)); };
var pg = req('pg');
var bcrypt = req('bcryptjs');

(async function () {
  var c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  var dir = path.join(__dirname, '../../migrations');
  var failed = [];
  for (var f of fs.readdirSync(dir).filter(function (x) { return x.endsWith('.sql'); }).sort()) {
    try { await c.query(fs.readFileSync(path.join(dir, f), 'utf8')); console.log('root ok', f); }
    catch (e) { console.log('root fail', f, e.message); failed.push(f); }
  }
  var db = require(path.join(SRV, 'config/db'));
  await db.migrationsReady();
  // 루트 마이그레이션 일부(004~006)는 서버 마이그레이션이 만든 tenants 등을 전제 — 서버 쪽을 돌린 뒤 한 번 더
  for (var f2 of failed) {
    try { await c.query(fs.readFileSync(path.join(dir, f2), 'utf8')); console.log('root retry ok', f2); }
    catch (e) { console.log('root retry fail', f2, e.message); }
  }
  await c.end();
  var T = '00000000-0000-0000-0000-000000000001';
  await db.query("INSERT INTO tenants (id, name, slug, plan, max_users) VALUES ($1,'기본','default','pro',50) ON CONFLICT (id) DO NOTHING", [T]);
  var hash = await bcrypt.hash('Test1234!', 10);
  var users = [['admin@t.com', '관리자', 'admin'], ['kim@t.com', '김팀원', 'member'], ['lee@t.com', '이팀원', 'member']];
  for (var u of users) {
    await db.query(
      "INSERT INTO users (email, password_hash, name, role, status, tenant_id) VALUES ($1,$2,$3,$4,'active',$5) ON CONFLICT (email) DO NOTHING",
      [u[0], hash, u[1], u[2], T]
    );
  }
  var r = await db.query('SELECT id, email, role FROM users');
  console.log(r.rows);
  process.exit(0);
})().catch(function (e) { console.error(e); process.exit(1); });
