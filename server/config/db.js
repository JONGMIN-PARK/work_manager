var { Pool } = require('pg');
var path = require('path');
var fs = require('fs');
var config = require('./index');

var poolOpts = {
  connectionString: config.db.connectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
};

// Supabase 등 외부 DB는 SSL 필요
if (config.env === 'production' || (config.db.connectionString && config.db.connectionString.indexOf('supabase') >= 0)) {
  poolOpts.ssl = { rejectUnauthorized: false };
}

var pool = new Pool(poolOpts);

pool.on('error', function (err) {
  console.error('[DB] Unexpected pool error:', err.message);
});

// 쿼리 헬퍼
function query(text, params) {
  return pool.query(text, params);
}

// 트랜잭션 헬퍼
async function transaction(fn) {
  var client = await pool.connect();
  try {
    await client.query('BEGIN');
    var result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// 마이그레이션 자동 실행
async function runMigrations() {
  try {
    var migrationDir = path.join(__dirname, '..', 'migrations');
    if (!fs.existsSync(migrationDir)) return;

    var files = fs.readdirSync(migrationDir).filter(function (f) { return f.endsWith('.sql'); }).sort();
    for (var i = 0; i < files.length; i++) {
      var filePath = path.join(migrationDir, files[i]);
      var sql = fs.readFileSync(filePath, 'utf8');
      await pool.query(sql);
      console.log('[DB] Migration applied:', files[i]);
    }
  } catch (e) {
    console.error('[DB] Migration error:', e.message);
  }
}

// 풀 준비 시 마이그레이션 실행
pool.on('connect', function () {
  // 첫 연결 시 한 번만 실행
  if (!runMigrations._ran) {
    runMigrations._ran = true;
    runMigrations();
  }
});

module.exports = { pool: pool, query: query, transaction: transaction };
