var { Pool } = require('pg');
var path = require('path');
var fs = require('fs');
var config = require('./index');

// v13.59: 100명 동시 사용 대비 풀 확대
//   - max: 20 → 50 (통계 1회 = 18 병렬 쿼리이므로 동시 30명도 안정적 처리)
//   - idleTimeout 30s → 45s (잦은 재연결 방지)
//   - connectionTimeout 5s → 8s (피크 시 짧은 대기 허용)
//   - 환경변수 DB_POOL_MAX 로 운영 중 튜닝 가능 (Render 등 Postgres 플랜 max 100 이하로 유지)
var poolOpts = {
  connectionString: config.db.connectionString,
  max: parseInt(process.env.DB_POOL_MAX, 10) || 50,
  min: parseInt(process.env.DB_POOL_MIN, 10) || 2,
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_MS, 10) || 45000,
  connectionTimeoutMillis: parseInt(process.env.DB_CONN_MS, 10) || 8000
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

/**
 * SQL 파일을 문장 단위로 분리한다.
 *
 * 단순 `sql.split(';')` 은 다음을 모두 깨뜨린다:
 *   - dollar-quote 본문:  CREATE FUNCTION ... AS $$ ... ; ... $$ LANGUAGE plpgsql;
 *   - 문자열 리터럴 안의 세미콜론:  INSERT ... VALUES ('a;b')
 *   - 주석 안의 세미콜론
 * 실제로 020_as_activity_logs / 032_issue_assignees 등의 트리거 함수가 이 때문에
 * 쪼개져 "unterminated dollar-quoted string" 으로 실패해 왔다(운영·CI 공통).
 *
 * @param {string} sql
 * @returns {string[]} 실행 가능한 문장 배열 (주석만 있는 조각은 제외)
 */
function splitSqlStatements(sql) {
  var stmts = [];
  var buf = '';
  var i = 0;
  var n = sql.length;

  while (i < n) {
    var ch = sql[i];
    var two = sql.substr(i, 2);

    // 줄 주석 -- ... \n
    if (two === '--') {
      var nl = sql.indexOf('\n', i);
      if (nl === -1) { i = n; } else { buf += '\n'; i = nl + 1; }
      continue;
    }
    // 블록 주석 /* ... */ (PostgreSQL은 중첩 허용)
    if (two === '/*') {
      var depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql.substr(i, 2) === '/*') { depth++; i += 2; }
        else if (sql.substr(i, 2) === '*/') { depth--; i += 2; }
        else { i++; }
      }
      buf += ' ';
      continue;
    }
    // 작은따옴표 문자열 ('' 는 이스케이프된 따옴표)
    if (ch === "'") {
      buf += ch; i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") { buf += "''"; i += 2; continue; }
        if (sql[i] === "'") { buf += "'"; i++; break; }
        buf += sql[i]; i++;
      }
      continue;
    }
    // dollar-quote  $$ ... $$  또는  $tag$ ... $tag$
    if (ch === '$') {
      var m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
      if (m) {
        var tag = m[0];
        var end = sql.indexOf(tag, i + tag.length);
        if (end === -1) { buf += sql.slice(i); i = n; continue; }   // 닫히지 않음 → 통째로
        buf += sql.slice(i, end + tag.length);
        i = end + tag.length;
        continue;
      }
    }
    // 문장 종료
    if (ch === ';') {
      if (buf.trim()) stmts.push(buf.trim());
      buf = '';
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  if (buf.trim()) stmts.push(buf.trim());
  return stmts;
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
        // 전용 클라이언트로 실행한다. 다중 문장 안의 BEGIN 이후 오류가 나면 그 세션은
        // "aborted transaction" 상태로 남는데, pool.query 로 실행하면 그 연결이 그대로
        // 풀에 반납되어 다음 사용자의 쿼리가 25P02 로 실패한다. 실패 시 ROLLBACK 필수.
        var mc = await pool.connect();
        try {
          await mc.query(sql);
        } catch (e) {
          await mc.query('ROLLBACK').catch(function () {});
          console.warn('[DB] Migration ' + files[i] + ' (transaction) failed:', e.message);
        } finally {
          mc.release();
        }
      } else {
        // 트랜잭션 없는 파일은 문장별 개별 실행 (부분 실패 허용)
        // dollar-quote·문자열·주석을 인식하는 분리기 사용 — 단순 split(';') 은 함수 본문을 깨뜨림
        var stmts = splitSqlStatements(sql);
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

// 마이그레이션은 프로세스(풀)당 한 번만 실행하고, 그 완료 시점을 promise 로 노출한다.
// 테스트는 이것을 기다린 뒤 시작해야 한다 — 기다리지 않으면 마이그레이션(예: 032 의
// DROP/CREATE TRIGGER ON issues)이 테스트 쿼리와 동시에 돌며 교착(deadlock)이 나고,
// PostgreSQL 이 테스트 쪽을 희생시키면 테스트가 간헐적으로 실패한다.
var _migrationsPromise = null;
function migrationsReady() {
  if (!_migrationsPromise) _migrationsPromise = runMigrations();
  return _migrationsPromise;
}

// 풀 준비 시 마이그레이션 실행 (첫 연결 시 한 번만)
pool.on('connect', function () {
  migrationsReady();
});

module.exports = { pool: pool, query: query, transaction: transaction, migrationsReady: migrationsReady };
