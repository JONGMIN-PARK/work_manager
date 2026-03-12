var { Pool } = require('pg');
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

module.exports = { pool: pool, query: query, transaction: transaction };
