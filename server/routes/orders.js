var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var rbac = require('../middleware/rbac');
var lock = require('../middleware/optimistic-lock');
var { parsePagination } = require('../middleware/pagination');
var tenant = require('../middleware/tenant');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

// ────────────────────────────────────────────────────────────
// 수주번호(order_no)를 참조하는 테이블 목록.
//   - FK가 없는 느슨한 문자열 키라 수주번호를 바꾸면 여기 전부를 함께 갱신해야 한다.
//   - bump: version/updated_at/updated_by 컬럼이 있어 낙관적 잠금까지 올려야 하는 테이블
//     (work_records 는 세 컬럼이 모두 없어 order_no 만 갱신)
//   - table/col 은 코드에 고정된 상수 — 쿼리 문자열 조립에 사용해도 주입 위험 없음
// ────────────────────────────────────────────────────────────
var ORDER_REF_TABLES = [
  { table: 'projects',     col: 'order_no',        label: '프로젝트', bump: true },
  { table: 'issues',       col: 'order_no',        label: '이슈',     bump: true },
  { table: 'work_records', col: 'order_no',        label: '업무일지', bump: false },
  { table: 'as_tickets',   col: 'order_no',        label: 'A/S 접수', bump: true },
  { table: 'prestudies',   col: 'linked_order_no', label: '사전검토', bump: true }
];

// as_tickets.order_no 가 VARCHAR(40) — 전 테이블이 담을 수 있는 최대 길이
var ORDER_NO_MAX = 40;
// orders.date / orders.delivery 가 VARCHAR(10) — 초과 시 22001 로 INSERT 전체가 실패한다
var DATE_LEN = 10;

function httpErr(status, code, message, extra) {
  var e = new Error(message);
  e.httpStatus = status;
  e.code = code;
  e.extra = extra || null;
  return e;
}

function sendErr(res, e, tag) {
  if (e && e.httpStatus) {
    var body = { error: e.code, message: e.message };
    if (e.extra) Object.assign(body, e.extra);
    return res.status(e.httpStatus).json(body);
  }
  console.error(tag, e);
  return res.status(500).json({ error: 'SERVER_ERROR', message: (e && e.message) || '서버 오류' });
}

/**
 * 날짜 문자열 정규화 → 'YYYY-MM-DD' (최대 10자).
 * 엑셀 업로드는 셀 서식에 따라 다음이 섞여 들어온다:
 *   - 엑셀 시리얼 값: 45815      → 1899-12-30 기준 일수
 *   - 타임스탬프 문자열: '2026-03-03 00:00:00' / ISO 8601  → 10자 초과라 그대로 넣으면 INSERT 전체 실패
 *   - 구분자 변형: '2026.3.3', '2026/3/3'
 * 해석할 수 없으면 '' 을 돌려준다 (한 행 때문에 배치 전체가 죽지 않도록).
 */
function normDate(v) {
  if (v === null || v === undefined) return '';
  var s = String(v).trim();
  if (!s) return '';

  // 엑셀 시리얼 (1900-01-01 ~ 2199 범위만 취급)
  if (/^\d+(\.\d+)?$/.test(s)) {
    var serial = parseFloat(s);
    // 20000 = 1954-10-03, 80000 = 2119-01-24 — 이 밖의 숫자는 날짜로 보지 않는다
    // (연도만 적힌 '2026' 같은 값을 1905년으로 오역하지 않기 위함)
    if (serial >= 20000 && serial <= 80000) {
      var ms = Math.round((serial - 25569) * 86400 * 1000); // 25569 = 1970-01-01 의 엑셀 시리얼
      var d = new Date(ms);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
    return '';
  }

  var m = /^(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})/.exec(s);
  if (m) {
    return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  }
  return s.length > DATE_LEN ? '' : s;
}

function normAmount(v) {
  if (v === null || v === undefined || v === '') return 0;
  var n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : 0;
}

// GET /api/orders — v13.36 정책: 수주대장은 tenant 전체 공개 (누구나 조회).
//   수정/생성/삭제는 RBAC(order.edit)에서 admin/manager/executive로 제한.
router.get('/', async function (req, res) {
  try {
    var pg = parsePagination(req.query, 100);
    var r = await db.query(
      'SELECT *, COUNT(*) OVER() AS _total FROM orders WHERE tenant_id = $1 ORDER BY date DESC, order_no LIMIT $2 OFFSET $3',
      [req.tenant.id, pg.limit, pg.offset]
    );
    var total = r.rows.length > 0 ? parseInt(r.rows[0]._total, 10) : 0;
    r.rows.forEach(function(row) { delete row._total; });
    res.json({ data: r.rows, total: total, limit: pg.limit, offset: pg.offset });
  } catch (e) {
    console.error('[orders/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/orders/bulk — 일괄 저장 (upsert). 엑셀 불러오기가 사용한다.
//
// v13.182 — "같은 수주번호인데 수주일·거래처·프로젝트명이 안 바뀐다" 수정:
//   1) 한 INSERT 안에 같은 order_no 가 두 번 있으면 PostgreSQL 이
//      "ON CONFLICT DO UPDATE command cannot affect row a second time"(21000)로
//      **배치 전체**를 롤백한다 → 중복 없는 행까지 하나도 반영되지 않았다. 서버에서 먼저 dedupe.
//   2) 엑셀 날짜 셀이 시리얼/타임스탬프로 들어오면 VARCHAR(10) 초과(22001)로 역시 배치 전체가 실패했다 → normDate.
//   3) 충돌 갱신에 tenant 가드가 없어 다른 테넌트의 동명 수주를 덮어썼다 → WHERE 절 추가.
router.post('/bulk', rbac.checkPermission('order.edit'), async function (req, res) {
  try {
    var records = req.body.records || [];
    if (!records.length) return res.json({ data: [], count: 0, inserted: 0, updated: 0, skipped: 0, duplicates: [] });
    if (records.length > 1000) {
      return res.status(400).json({ error: 'TOO_MANY', message: '한 번에 최대 1000건까지 저장할 수 있습니다. 나눠서 요청하세요.' });
    }

    // ── 1) order_no 중복 제거 (뒤에 오는 행이 이긴다) ──
    var byNo = {};
    var order = [];
    var duplicates = [];
    records.forEach(function (b) {
      var no = String(b.orderNo || b.order_no || '').trim();
      if (!no) return;
      if (byNo[no] === undefined) order.push(no);
      else if (duplicates.indexOf(no) === -1) duplicates.push(no);
      byNo[no] = b;
    });
    if (!order.length) return res.json({ data: [], count: 0, inserted: 0, updated: 0, skipped: 0, duplicates: duplicates });

    var values = [];
    var params = [];
    var idx = 1;
    order.forEach(function (no) {
      var b = byNo[no];
      values.push('($' + idx++ + ',$' + idx++ + ',$' + idx++ + ',$' + idx++ + ',$' + idx++ + ',$' + idx++ + ',$' + idx++ + ',$' + idx++ + ',$' + idx++ + ',$' + idx++ + ')');
      params.push(
        no.slice(0, 100),
        normDate(b.date),
        b.client || '',
        b.name || '',
        normAmount(b.amount),
        b.manager || '',
        normDate(b.delivery),
        b.memo || '',
        req.user.sub,
        req.tenant.id
      );
    });
    var userIdx = idx++;
    params.push(req.user.sub);

    var sql = 'INSERT INTO orders (order_no, date, client, name, amount, manager, delivery, memo, created_by, tenant_id) VALUES ' +
      values.join(',') +
      ' ON CONFLICT (order_no) DO UPDATE SET date=EXCLUDED.date, client=EXCLUDED.client, name=EXCLUDED.name,' +
      ' amount=EXCLUDED.amount, manager=EXCLUDED.manager, delivery=EXCLUDED.delivery,' +
      ' version=orders.version+1, updated_at=now(), updated_by=$' + userIdx +
      // 다른 테넌트가 이미 쓰고 있는 수주번호는 건드리지 않는다 (반영 건수에서 빠지고 skipped 로 보고된다)
      ' WHERE orders.tenant_id = EXCLUDED.tenant_id' +
      ' RETURNING *';
    var result = await db.query(sql, params);

    var saved = result.rows.length;
    var inserted = result.rows.filter(function (r) { return r.version === 1; }).length;
    res.status(201).json({
      data: result.rows,
      count: saved,
      inserted: inserted,
      updated: saved - inserted,
      skipped: order.length - saved,
      duplicates: duplicates
    });
  } catch (e) {
    console.error('[orders/bulk]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: e.message || '서버 오류' });
  }
});

// GET /api/orders/:orderNo
router.get('/:orderNo', async function (req, res) {
  try {
    var r = await db.query('SELECT * FROM orders WHERE order_no = $1 AND tenant_id = $2', [req.params.orderNo, req.tenant.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0] });
  } catch (e) {
    console.error('[orders/get]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// GET /api/orders/:orderNo/references — 이 수주번호를 참조하는 레코드 건수
//   번호 변경 전 "무엇이 함께 바뀌는지" 미리보기에 사용한다.
router.get('/:orderNo/references', async function (req, res) {
  try {
    var counts = {};
    var total = 0;
    for (var i = 0; i < ORDER_REF_TABLES.length; i++) {
      var t = ORDER_REF_TABLES[i];
      var r = await db.query(
        'SELECT COUNT(*)::int AS n FROM ' + t.table + ' WHERE ' + t.col + ' = $1 AND tenant_id = $2',
        [req.params.orderNo, req.tenant.id]
      );
      counts[t.table] = { label: t.label, count: r.rows[0].n };
      total += r.rows[0].n;
    }
    res.json({ data: { orderNo: req.params.orderNo, counts: counts, total: total } });
  } catch (e) {
    console.error('[orders/references]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// GET /api/orders/:orderNo/history — 이 수주의 번호 변경 이력 (누가·언제·왜)
//   audit_logs 를 재사용한다. A→B→C 로 여러 번 바뀐 경우도 체인을 따라가 전부 보여준다.
router.get('/:orderNo/history', async function (req, res) {
  try {
    var r = await db.query(
      'SELECT a.id, a.action, a.detail, a.created_at, u.name AS user_name, u.email AS user_email' +
      ' FROM audit_logs a LEFT JOIN users u ON a.user_id = u.id' +
      " WHERE a.action = 'order.renumber' AND a.tenant_id = $1" +
      ' ORDER BY a.created_at DESC LIMIT 1000',
      [req.tenant.id]
    );

    // 번호 체인 추적: {현재번호} 에서 시작해 from/to 로 연결된 로그를 고정점까지 모은다.
    var seen = {};
    seen[req.params.orderNo] = true;
    var picked = [];
    var pickedIds = {};
    var grew = true;
    while (grew) {
      grew = false;
      for (var i = 0; i < r.rows.length; i++) {
        var row = r.rows[i];
        if (pickedIds[row.id]) continue;
        var d = row.detail || {};
        if (typeof d === 'string') { try { d = JSON.parse(d); } catch (_) { d = {}; } }
        if (!seen[d.from] && !seen[d.to]) continue;
        pickedIds[row.id] = true;
        picked.push(row);
        if (d.from && !seen[d.from]) { seen[d.from] = true; grew = true; }
        if (d.to && !seen[d.to]) { seen[d.to] = true; grew = true; }
      }
    }
    picked.sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    res.json({ data: picked });
  } catch (e) {
    console.error('[orders/history]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/orders — 신규 등록 (기존 번호면 내용 갱신)
router.post('/', rbac.checkPermission('order.edit'), async function (req, res) {
  try {
    var b = req.body;
    var r = await db.query(
      "INSERT INTO orders (order_no, date, client, name, amount, manager, delivery, memo, created_by, tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (order_no) DO UPDATE SET date=$2, client=$3, name=$4, amount=$5, manager=$6, delivery=$7, memo=$8, version=orders.version+1, updated_at=now(), updated_by=$9 WHERE orders.tenant_id = $10 RETURNING *",
      [String(b.orderNo || b.order_no || '').trim(), normDate(b.date), b.client || '', b.name || '', normAmount(b.amount), b.manager || '', normDate(b.delivery), b.memo || '', req.user.sub, req.tenant.id]
    );
    if (!r.rows.length) {
      return res.status(409).json({ error: 'DUPLICATE', message: '이미 사용 중인 수주번호입니다.' });
    }
    res.status(201).json({ data: r.rows[0] });
  } catch (e) {
    console.error('[orders/create]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/orders/:orderNo/renumber — 수주번호 변경 + 참조 레코드 일괄 갱신 + 감사 로그
//
//   order_no 는 FK 없는 문자열 키로 5개 테이블에 흩어져 있어, orders 만 고치면
//   프로젝트·이슈·업무일지·A/S·사전검토의 연결이 조용히 끊긴다.
//   변경·전파·기록을 한 트랜잭션으로 묶어 부분 적용을 막는다.
router.post('/:orderNo/renumber', rbac.checkPermission('order.edit'), async function (req, res) {
  var oldNo = String(req.params.orderNo || '').trim();
  var b = req.body || {};
  var newNo = String(b.newOrderNo || b.new_order_no || '').trim();
  var reason = String(b.reason || '').trim();

  if (!newNo) return res.status(400).json({ error: 'VALIDATION', message: '새 수주번호를 입력하세요.' });
  if (newNo === oldNo) return res.status(400).json({ error: 'VALIDATION', message: '기존 수주번호와 동일합니다.' });
  if (newNo.length > ORDER_NO_MAX) {
    return res.status(400).json({ error: 'VALIDATION', message: '수주번호는 ' + ORDER_NO_MAX + '자를 넘을 수 없습니다.' });
  }
  if (!/^[\w.\-\/가-힣]+$/.test(newNo)) {
    return res.status(400).json({ error: 'VALIDATION', message: '수주번호에 공백이나 특수문자는 쓸 수 없습니다. (영문·숫자·한글·- _ . / 만 허용)' });
  }
  if (reason.length < 2) return res.status(400).json({ error: 'VALIDATION', message: '변경 사유를 2자 이상 입력하세요.' });
  if (reason.length > 500) return res.status(400).json({ error: 'VALIDATION', message: '변경 사유는 500자 이내로 입력하세요.' });

  try {
    var out = await db.transaction(async function (client) {
      var cur = await client.query('SELECT * FROM orders WHERE order_no = $1 AND tenant_id = $2 FOR UPDATE', [oldNo, req.tenant.id]);
      if (!cur.rows.length) throw httpErr(404, 'NOT_FOUND', '수주번호 ' + oldNo + ' 을(를) 찾을 수 없습니다.');
      var row = cur.rows[0];

      // 낙관적 잠금 — version 을 보냈을 때만 검사 (하위호환)
      if (b.version !== undefined && b.version !== null && Number(b.version) !== Number(row.version)) {
        throw httpErr(409, 'CONFLICT', '다른 사용자가 이 수주를 먼저 수정했습니다. 새로고침 후 다시 시도하세요.', { latest: row, yourVersion: b.version });
      }

      // order_no 는 전역 PK — 다른 테넌트가 쓰고 있어도 충돌한다
      var dup = await client.query('SELECT order_no FROM orders WHERE order_no = $1', [newNo]);
      if (dup.rows.length) throw httpErr(409, 'DUPLICATE', '이미 사용 중인 수주번호입니다: ' + newNo);

      var upd = await client.query(
        'UPDATE orders SET order_no = $1, version = version + 1, updated_at = now(), updated_by = $2 WHERE order_no = $3 AND tenant_id = $4 RETURNING *',
        [newNo, req.user.sub, oldNo, req.tenant.id]
      );

      var affected = {};
      var total = 0;
      for (var i = 0; i < ORDER_REF_TABLES.length; i++) {
        var t = ORDER_REF_TABLES[i];
        var sql, params;
        if (t.bump) {
          sql = 'UPDATE ' + t.table + ' SET ' + t.col + ' = $1, version = version + 1, updated_at = now(), updated_by = $2' +
                ' WHERE ' + t.col + ' = $3 AND tenant_id = $4';
          params = [newNo, req.user.sub, oldNo, req.tenant.id];
        } else {
          sql = 'UPDATE ' + t.table + ' SET ' + t.col + ' = $1 WHERE ' + t.col + ' = $2 AND tenant_id = $3';
          params = [newNo, oldNo, req.tenant.id];
        }
        var r = await client.query(sql, params);
        affected[t.table] = { label: t.label, count: r.rowCount };
        total += r.rowCount;
      }

      // 감사 로그 — authService.auditLog 는 tenant_id 를 채우지 않아
      // /api/audit 의 테넌트 필터에서 누락되므로 여기서 직접 넣는다.
      var detail = {
        from: oldNo, to: newNo, reason: reason,
        name: row.name || '', client: row.client || '',
        affected: affected, affectedTotal: total
      };
      await client.query(
        'INSERT INTO audit_logs (user_id, action, target_type, target_id, detail, ip_address, user_agent, tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          req.user.sub, 'order.renumber', 'order', newNo, JSON.stringify(detail),
          req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
          req.headers['user-agent'] || '',
          req.tenant.id
        ]
      );

      return { row: upd.rows[0], affected: affected, affectedTotal: total };
    });

    res.json({
      data: out.row,
      from: oldNo,
      to: newNo,
      reason: reason,
      affected: out.affected,
      affectedTotal: out.affectedTotal,
      message: '수주번호를 ' + oldNo + ' → ' + newNo + ' 로 변경하고 연결된 ' + out.affectedTotal + '건을 갱신했습니다.'
    });
  } catch (e) {
    if (e && e.code === '23505') {
      return res.status(409).json({ error: 'DUPLICATE', message: '이미 사용 중인 수주번호입니다: ' + newNo });
    }
    sendErr(res, e, '[orders/renumber]');
  }
});

// PUT /api/orders/:orderNo
router.put('/:orderNo', rbac.checkPermission('order.edit'), async function (req, res) {
  try {
    var b = req.body;

    // order_no 는 이 API로 바꿀 수 없다. 예전에는 화이트리스트에서 조용히 빠져
    // 200 을 돌려주면서 아무것도 바뀌지 않았다 → 명시적으로 거절한다.
    var reqNo = String(b.orderNo || b.order_no || '').trim();
    if (reqNo && reqNo !== String(req.params.orderNo).trim()) {
      return res.status(400).json({
        error: 'ORDER_NO_IMMUTABLE',
        message: '수주번호는 이 API로 변경할 수 없습니다. POST /api/orders/:orderNo/renumber 를 사용하세요.'
      });
    }

    var clean = {};
    if (b.date !== undefined) clean.date = normDate(b.date);
    if (b.client !== undefined) clean.client = b.client;
    if (b.name !== undefined) clean.name = b.name;
    if (b.amount !== undefined) clean.amount = normAmount(b.amount);
    if (b.manager !== undefined) clean.manager = b.manager;
    if (b.delivery !== undefined) clean.delivery = normDate(b.delivery);
    if (b.memo !== undefined) clean.memo = b.memo;

    var result = await lock.optimisticUpdate(db, 'orders', 'order_no', req.params.orderNo, b.version, clean, req.user.sub, { clause: 'AND tenant_id = $NEXT1', values: [req.tenant.id] });
    if (result.conflict) return lock.sendConflict(res, result.latest, result.yourVersion);
    if (!result.success) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: result.row });
  } catch (e) {
    console.error('[orders/update]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// DELETE /api/orders/:orderNo
router.delete('/:orderNo', rbac.checkPermission('order.edit'), async function (req, res) {
  try {
    var r = await db.query('DELETE FROM orders WHERE order_no = $1 AND tenant_id = $2 RETURNING order_no', [req.params.orderNo, req.tenant.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ message: '삭제 완료' });
  } catch (e) {
    console.error('[orders/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
module.exports.ORDER_REF_TABLES = ORDER_REF_TABLES;
module.exports._normDate = normDate;
