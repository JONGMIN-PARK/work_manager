/**
 * Orders API integration tests
 *   - POST /api/orders/bulk        — 엑셀 불러오기 (갱신 실패 회귀 테스트)
 *   - POST /api/orders/:no/renumber — 수주번호 변경 + 참조 일괄 갱신 + 감사 로그
 */
var h = require('./helpers');

describe('Orders API', () => {
  var manager;
  var member;

  beforeAll(async () => {
    await h.createTestTenant();
    manager = await h.createTestUser({ role: 'manager', email: 'ord-mgr@test.com' });
    member = await h.createTestUser({ role: 'member', email: 'ord-member@test.com' });
  });
  afterAll(async () => { await h.cleanup(); });

  beforeEach(async () => {
    await h.db.query('DELETE FROM orders WHERE tenant_id = $1', [h.TEST_TENANT_ID]);
  });

  // ─────────────────────────────────────────────
  // 엑셀 불러오기 (bulk upsert)
  // ─────────────────────────────────────────────
  describe('POST /api/orders/bulk', () => {
    test('같은 수주번호라도 수주일·거래처·프로젝트명이 바뀌면 갱신된다', async () => {
      await h.request(h.app).post('/api/orders/bulk')
        .set('Authorization', 'Bearer ' + manager.token)
        .send({ records: [{ orderNo: 'A25029', date: '2026-01-02', client: '구거래처', name: '구프로젝트', amount: 100 }] });

      var res = await h.request(h.app).post('/api/orders/bulk')
        .set('Authorization', 'Bearer ' + manager.token)
        .send({ records: [{ orderNo: 'A25029', date: '2026-03-03', client: '신거래처', name: '신프로젝트', amount: 200 }] });

      expect(res.status).toBe(201);
      expect(res.body.updated).toBe(1);

      var r = await h.db.query('SELECT * FROM orders WHERE order_no = $1 AND tenant_id = $2', ['A25029', h.TEST_TENANT_ID]);
      expect(r.rows[0].date).toBe('2026-03-03');
      expect(r.rows[0].client).toBe('신거래처');
      expect(r.rows[0].name).toBe('신프로젝트');
      expect(Number(r.rows[0].amount)).toBe(200);
    });

    // 회귀: 예전에는 엑셀 안에 같은 수주번호가 두 번 있으면 PostgreSQL 21000
    // ("cannot affect row a second time")으로 배치 전체가 롤백되어
    // 중복과 무관한 행까지 하나도 반영되지 않았다.
    test('엑셀에 중복 수주번호가 있어도 나머지 행이 모두 반영된다 (마지막 행이 이김)', async () => {
      var res = await h.request(h.app).post('/api/orders/bulk')
        .set('Authorization', 'Bearer ' + manager.token)
        .send({ records: [
          { orderNo: 'DUP-1', date: '2026-04-04', client: '첫줄', name: '첫줄건' },
          { orderNo: 'DUP-1', date: '2026-05-05', client: '둘째줄', name: '둘째줄건' },
          { orderNo: 'OK-1',  date: '2026-05-05', client: '정상', name: '정상건' }
        ] });

      expect(res.status).toBe(201);
      expect(res.body.duplicates).toContain('DUP-1');
      expect(res.body.count).toBe(2);

      var r = await h.db.query('SELECT order_no, client FROM orders WHERE tenant_id = $1 ORDER BY order_no', [h.TEST_TENANT_ID]);
      expect(r.rows.map(function (x) { return x.order_no; })).toEqual(['DUP-1', 'OK-1']);
      expect(r.rows[0].client).toBe('둘째줄');
    });

    // 회귀: 엑셀 날짜 셀이 시리얼(45815)이나 타임스탬프 문자열로 넘어오면
    // VARCHAR(10) 초과(22001)로 역시 배치 전체가 실패했다.
    test('엑셀 날짜(시리얼/타임스탬프)를 YYYY-MM-DD 로 정규화한다', async () => {
      var res = await h.request(h.app).post('/api/orders/bulk')
        .set('Authorization', 'Bearer ' + manager.token)
        .send({ records: [
          { orderNo: 'D-SER', date: 45815, client: 'c', name: 'n' },
          { orderNo: 'D-TS',  date: '2026-03-03 00:00:00', delivery: '2026/12/1', client: 'c', name: 'n' },
          { orderNo: 'D-DOT', date: '2026.7.9', client: 'c', name: 'n' }
        ] });

      expect(res.status).toBe(201);
      expect(res.body.count).toBe(3);

      var r = await h.db.query('SELECT order_no, date, delivery FROM orders WHERE tenant_id = $1 ORDER BY order_no', [h.TEST_TENANT_ID]);
      var byNo = {};
      r.rows.forEach(function (x) { byNo[x.order_no] = x; });
      expect(byNo['D-SER'].date).toBe('2025-06-07');
      expect(byNo['D-TS'].date).toBe('2026-03-03');
      expect(byNo['D-TS'].delivery).toBe('2026-12-01');
      expect(byNo['D-DOT'].date).toBe('2026-07-09');
    });

    test('수량이 섞인 금액 문자열도 숫자로 저장된다', async () => {
      await h.request(h.app).post('/api/orders/bulk')
        .set('Authorization', 'Bearer ' + manager.token)
        .send({ records: [{ orderNo: 'AMT-1', amount: '1,200', client: 'c', name: 'n' }] });
      var r = await h.db.query('SELECT amount FROM orders WHERE order_no = $1 AND tenant_id = $2', ['AMT-1', h.TEST_TENANT_ID]);
      expect(Number(r.rows[0].amount)).toBe(1200);
    });
  });

  // ─────────────────────────────────────────────
  // 수주번호 변경 (renumber)
  // ─────────────────────────────────────────────
  describe('POST /api/orders/:orderNo/renumber', () => {
    beforeEach(async () => {
      await h.db.query('DELETE FROM projects WHERE tenant_id = $1', [h.TEST_TENANT_ID]);
      await h.db.query('DELETE FROM issues WHERE tenant_id = $1', [h.TEST_TENANT_ID]);
      await h.db.query('DELETE FROM work_records WHERE tenant_id = $1', [h.TEST_TENANT_ID]);
      await h.db.query('DELETE FROM audit_logs WHERE tenant_id = $1', [h.TEST_TENANT_ID]);

      await h.request(h.app).post('/api/orders')
        .set('Authorization', 'Bearer ' + manager.token)
        .send({ orderNo: 'OLD-1', date: '2026-01-02', client: '코아비스', name: '1호기' });

      await h.db.query("INSERT INTO projects (id, name, order_no, tenant_id) VALUES ('p-ren-1','1호기','OLD-1',$1)", [h.TEST_TENANT_ID]);
      await h.db.query("INSERT INTO issues (id, title, order_no, tenant_id) VALUES ('i-ren-1','축 정렬 불량','OLD-1',$1)", [h.TEST_TENANT_ID]);
      await h.db.query("INSERT INTO work_records (date, name, order_no, hours, tenant_id) VALUES ('20260401','홍길동','OLD-1',8,$1)", [h.TEST_TENANT_ID]);
      await h.db.query("INSERT INTO work_records (date, name, order_no, hours, tenant_id) VALUES ('20260402','홍길동','OLD-1',4,$1)", [h.TEST_TENANT_ID]);
    });

    test('수주번호를 바꾸면 참조 레코드가 일괄 갱신되고 감사 로그가 남는다', async () => {
      var res = await h.request(h.app).post('/api/orders/OLD-1/renumber')
        .set('Authorization', 'Bearer ' + manager.token)
        .send({ newOrderNo: 'NEW-1', reason: '고객사 발주번호 정정 요청' });

      expect(res.status).toBe(200);
      expect(res.body.data.order_no).toBe('NEW-1');
      expect(res.body.affectedTotal).toBe(4); // 프로젝트 1 + 이슈 1 + 업무일지 2
      expect(res.body.affected.projects.count).toBe(1);
      expect(res.body.affected.work_records.count).toBe(2);

      // 옛 번호는 남아있지 않다
      var old = await h.db.query('SELECT 1 FROM orders WHERE order_no = $1 AND tenant_id = $2', ['OLD-1', h.TEST_TENANT_ID]);
      expect(old.rows.length).toBe(0);

      var p = await h.db.query("SELECT order_no FROM projects WHERE id = 'p-ren-1'");
      expect(p.rows[0].order_no).toBe('NEW-1');
      var i = await h.db.query("SELECT order_no FROM issues WHERE id = 'i-ren-1'");
      expect(i.rows[0].order_no).toBe('NEW-1');
      var w = await h.db.query('SELECT COUNT(*)::int AS n FROM work_records WHERE order_no = $1 AND tenant_id = $2', ['NEW-1', h.TEST_TENANT_ID]);
      expect(w.rows[0].n).toBe(2);

      // 감사 로그 — 누가·왜
      var a = await h.db.query("SELECT * FROM audit_logs WHERE action = 'order.renumber' AND tenant_id = $1", [h.TEST_TENANT_ID]);
      expect(a.rows.length).toBe(1);
      expect(a.rows[0].user_id).toBe(manager.user.id);
      expect(a.rows[0].target_id).toBe('NEW-1');
      expect(a.rows[0].detail.from).toBe('OLD-1');
      expect(a.rows[0].detail.to).toBe('NEW-1');
      expect(a.rows[0].detail.reason).toBe('고객사 발주번호 정정 요청');
      expect(a.rows[0].tenant_id).toBe(h.TEST_TENANT_ID);
    });

    test('변경 사유가 없으면 400', async () => {
      var res = await h.request(h.app).post('/api/orders/OLD-1/renumber')
        .set('Authorization', 'Bearer ' + manager.token)
        .send({ newOrderNo: 'NEW-2' });
      expect(res.status).toBe(400);

      var r = await h.db.query('SELECT 1 FROM orders WHERE order_no = $1 AND tenant_id = $2', ['OLD-1', h.TEST_TENANT_ID]);
      expect(r.rows.length).toBe(1);
    });

    test('이미 있는 수주번호로는 바꿀 수 없다 (409) — 아무것도 바뀌지 않는다', async () => {
      await h.request(h.app).post('/api/orders')
        .set('Authorization', 'Bearer ' + manager.token)
        .send({ orderNo: 'TAKEN-1', name: '다른 건' });

      var res = await h.request(h.app).post('/api/orders/OLD-1/renumber')
        .set('Authorization', 'Bearer ' + manager.token)
        .send({ newOrderNo: 'TAKEN-1', reason: '중복 테스트' });

      expect(res.status).toBe(409);
      var p = await h.db.query("SELECT order_no FROM projects WHERE id = 'p-ren-1'");
      expect(p.rows[0].order_no).toBe('OLD-1');
    });

    test('version 이 어긋나면 409 (낙관적 잠금)', async () => {
      var res = await h.request(h.app).post('/api/orders/OLD-1/renumber')
        .set('Authorization', 'Bearer ' + manager.token)
        .send({ newOrderNo: 'NEW-3', reason: '동시편집 테스트', version: 999 });
      expect(res.status).toBe(409);
    });

    test('공백·특수문자가 든 번호는 거절한다', async () => {
      var res = await h.request(h.app).post('/api/orders/OLD-1/renumber')
        .set('Authorization', 'Bearer ' + manager.token)
        .send({ newOrderNo: 'NEW 1!', reason: '형식 테스트' });
      expect(res.status).toBe(400);
    });

    test('일반 멤버는 변경할 수 없다 (403)', async () => {
      var res = await h.request(h.app).post('/api/orders/OLD-1/renumber')
        .set('Authorization', 'Bearer ' + member.token)
        .send({ newOrderNo: 'NEW-4', reason: '권한 테스트' });
      expect(res.status).toBe(403);
    });

    test('GET /references — 함께 갱신될 건수를 미리 알려준다', async () => {
      var res = await h.request(h.app).get('/api/orders/OLD-1/references')
        .set('Authorization', 'Bearer ' + member.token);
      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(4);
      expect(res.body.data.counts.work_records.count).toBe(2);
    });

    test('GET /history — 여러 번 바뀌어도 체인을 따라 전체 이력을 돌려준다', async () => {
      await h.request(h.app).post('/api/orders/OLD-1/renumber')
        .set('Authorization', 'Bearer ' + manager.token)
        .send({ newOrderNo: 'MID-1', reason: '1차 변경' });
      await h.request(h.app).post('/api/orders/MID-1/renumber')
        .set('Authorization', 'Bearer ' + manager.token)
        .send({ newOrderNo: 'FINAL-1', reason: '2차 변경' });

      var res = await h.request(h.app).get('/api/orders/FINAL-1/history')
        .set('Authorization', 'Bearer ' + manager.token);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      expect(res.body.data[0].detail.reason).toBe('2차 변경');
      expect(res.body.data[1].detail.reason).toBe('1차 변경');
      expect(res.body.data[0].user_name).toBe('TestUser');
    });
  });

  // ─────────────────────────────────────────────
  // PUT 은 번호를 바꾸지 않는다 (예전엔 조용히 무시하고 200)
  // ─────────────────────────────────────────────
  test('PUT /api/orders/:orderNo 로 수주번호를 바꾸려 하면 400', async () => {
    await h.request(h.app).post('/api/orders')
      .set('Authorization', 'Bearer ' + manager.token)
      .send({ orderNo: 'PUT-1', name: '테스트' });

    var res = await h.request(h.app).put('/api/orders/PUT-1')
      .set('Authorization', 'Bearer ' + manager.token)
      .send({ orderNo: 'PUT-2', name: '테스트' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ORDER_NO_IMMUTABLE');
  });
});
