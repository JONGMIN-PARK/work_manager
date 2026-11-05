// 테스트 DB 를 실행마다 깨끗하게 — 깨끗한 템플릿(wm_tpl)에서 wm 을 다시 만든다 (몇 초)
//   템플릿이 없거나 마이그레이션 파일 목록이 바뀌었으면: wm 을 비우고 setup.js 로 새로 만든 뒤 템플릿으로 떠 둔다
//   예전엔 .pgdata 가 실행 사이에 계속 쌓여서 달력 칸이 "+15 더보기"로 넘쳐 e2e28 · 29 · 40 이 실패했다
// 실행: node reset.js  (run.sh 가 부름 · KEEP=1 이면 run.sh 가 건너뜀)
var path = require('path');
var fs = require('fs');
var cp = require('child_process');
var SRV = path.join(__dirname, '../../server');
var pg = require(path.join(SRV, 'node_modules', 'pg'));
var ADMIN = 'postgres://postgres:pw@localhost:54329/postgres';
var SIG_FILE = path.join(__dirname, '.pgdata', 'wm-tpl.sig');

function migSig() {
  var list = function (d) { try { return fs.readdirSync(d).filter(function (f) { return /\.(sql|js)$/.test(f); }).sort(); } catch (e) { return []; } };
  return JSON.stringify([list(path.join(__dirname, '../../migrations')), list(path.join(SRV, 'migrations'))]);
}
async function kick(c, db) {
  await c.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [db]);
}

(async function () {
  var c = new pg.Client({ connectionString: ADMIN });
  await c.connect();
  var has = async function (db) { return (await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [db])).rowCount > 0; };
  var sig = migSig(), old = null;
  try { old = fs.readFileSync(SIG_FILE, 'utf8'); } catch (e) { /* 없음 */ }
  var tplOk = (await has('wm_tpl')) && old === sig;

  await kick(c, 'wm');
  await c.query('DROP DATABASE IF EXISTS wm');
  if (tplOk) {
    await c.query('CREATE DATABASE wm TEMPLATE wm_tpl');
    console.log('RESET wm ← wm_tpl');
  } else {
    await c.query('CREATE DATABASE wm');
    var r = cp.spawnSync(process.execPath, [path.join(__dirname, 'setup.js')], { encoding: 'utf8' });
    fs.writeFileSync(path.join(__dirname, 'setup.log'), (r.stdout || '') + (r.stderr || ''));
    if (r.status !== 0) { console.error('setup 실패 — setup.log 참고'); process.exit(1); }
    await kick(c, 'wm');
    if (await has('wm_tpl')) await c.query('DROP DATABASE wm_tpl');
    await c.query('CREATE DATABASE wm_tpl TEMPLATE wm');
    fs.writeFileSync(SIG_FILE, sig);
    console.log('RESET wm 새로 만들고 wm_tpl 저장');
  }
  await c.end();
})().catch(function (e) { console.error('reset 실패', e.message); process.exit(1); });
