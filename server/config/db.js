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
      // BEGIN/COMMIT 트랜잭션이 있는 파일은 통째로 실행
      if (/^\s*BEGIN\s*;/im.test(sql)) {
        try {
          await pool.query(sql);
        } catch (e) {
          console.warn('[DB] Migration ' + files[i] + ' (transaction) failed:', e.message);
        }
      } else {
        // 트랜잭션 없는 파일은 문장별 개별 실행 (부분 실패 허용)
        var stmts = sql.split(';').map(function (s) { return s.replace(/--[^\n]*/g, '').trim(); }).filter(function (s) { return s.length > 0; });
        for (var j = 0; j < stmts.length; j++) {
          try {
            await pool.query(stmts[j]);
          } catch (e) {
            console.warn('[DB] Migration ' + files[i] + ' stmt ' + (j + 1) + ' skipped:', e.message);
          }
        }
      }
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
