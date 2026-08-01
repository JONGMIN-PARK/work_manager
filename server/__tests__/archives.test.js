/**
 * Work Records (Archives) API integration tests
 */
var h = require('./helpers');

describe('Work Records API', () => {
  var user;

  beforeAll(async () => {
    await h.createTestTenant();
    user = await h.createTestUser({ role: 'manager', email: 'wr-test@test.com' });
  });
  afterAll(async () => { await h.cleanup(); });

  // 1. POST /api/archives/records — 단일 레코드 생성
  test('POST /api/archives/records — 단일 레코드 생성', async () => {
    var res = await h.request(h.app)
      .post('/api/archives/records')
      .set('Authorization', 'Bearer ' + user.token)
      .send({
        date: '20260401',
        name: '홍길동',
        orderNo: 'ORD-001',
        hours: 8,
        taskType: '개발',
        abbr: 'DEV',
        content: '테스트 작업 내용',
        ocmt: '비고 메모',
        oclient: '고객사A'
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.date).toBe('20260401');
    expect(res.body.data.name).toBe('홍길동');
    expect(res.body.data.order_no).toBe('ORD-001');
    // hours 는 NUMERIC(5,1) — pg 드라이버가 정밀도 보존을 위해 "8.0" 문자열로 반환한다.
    // 프런트(_toWrRecord)도 parseFloat 로 받는 게 기존 계약이므로 값으로 비교한다.
    expect(Number(res.body.data.hours)).toBe(8);
    expect(res.body.data.task_type).toBe('개발');
    expect(res.body.data.abbr).toBe('DEV');
    expect(res.body.data.content).toBe('테스트 작업 내용');
    expect(res.body.data.ocmt).toBe('비고 메모');
    expect(res.body.data.oclient).toBe('고객사A');
  });

  // 2. GET /api/archives/records — 생성된 레코드 조회
  test('GET /api/archives/records — 생성된 레코드 조회', async () => {
    var res = await h.request(h.app)
      .get('/api/archives/records')
      .set('Authorization', 'Bearer ' + user.token);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);

    var rec = res.body.data.find(function (r) { return r.order_no === 'ORD-001'; });
    expect(rec).toBeDefined();
    expect(rec.name).toBe('홍길동');
  });

  // 3. POST /api/archives/records/bulk — 다건 일괄 저장
  test('POST /api/archives/records/bulk — 다건 일괄 저장', async () => {
    var records = [
      { date: '20260402', name: '김철수', orderNo: 'ORD-100', hours: 4, taskType: '설계', abbr: 'DSG', content: '설계 작업' },
      { date: '20260402', name: '이영희', orderNo: 'ORD-101', hours: 6, taskType: '검토', abbr: 'REV', content: '검토 작업' },
      { date: '20260403', name: '박민수', orderNo: 'ORD-102', hours: 3, taskType: '테스트', abbr: 'TST', content: '테스트 작업' }
    ];

    var res = await h.request(h.app)
      .post('/api/archives/records/bulk')
      .set('Authorization', 'Bearer ' + user.token)
      .send({ records: records });

    expect(res.status).toBe(201);
    expect(res.body.count).toBe(3);
  });

  // 4. GET /api/archives/records/count — 카운트 확인
  test('GET /api/archives/records/count — 카운트 확인', async () => {
    var res = await h.request(h.app)
      .get('/api/archives/records/count')
      .set('Authorization', 'Bearer ' + user.token);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.count).toBe(3); // bulk가 기존 레코드를 모두 교체하므로 3건
  });

  // 5. PATCH /api/archives/records/batch — 레코드 수정 (ocmt, oclient)
  test('PATCH /api/archives/records/batch — 레코드 수정 (ocmt, oclient)', async () => {
    // 먼저 현재 레코드 목록에서 ID 가져오기
    var listRes = await h.request(h.app)
      .get('/api/archives/records')
      .set('Authorization', 'Bearer ' + user.token);

    expect(listRes.body.data.length).toBeGreaterThanOrEqual(1);
    var target = listRes.body.data[0];

    var res = await h.request(h.app)
      .patch('/api/archives/records/batch')
      .set('Authorization', 'Bearer ' + user.token)
      .send({
        updates: [{
          id: target.id,
          date: target.date,
          name: target.name,
          order_no: target.order_no,
          hours: target.hours,
          task_type: target.task_type,
          abbr: target.abbr,
          content: target.content,
          ocmt: '수정된 비고',
          oclient: '수정된 고객사'
        }]
      });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);

    // 수정 결과 확인
    var verifyRes = await h.request(h.app)
      .get('/api/archives/records')
      .set('Authorization', 'Bearer ' + user.token);

    var updated = verifyRes.body.data.find(function (r) { return r.id === target.id; });
    expect(updated).toBeDefined();
    expect(updated.ocmt).toBe('수정된 비고');
    expect(updated.oclient).toBe('수정된 고객사');
  });

  // 6. DELETE /api/archives/records/batch — 선택 삭제
  test('DELETE /api/archives/records/batch — 선택 삭제', async () => {
    // 현재 레코드 목록에서 ID 가져오기
    var listRes = await h.request(h.app)
      .get('/api/archives/records')
      .set('Authorization', 'Bearer ' + user.token);

    var beforeCount = listRes.body.data.length;
    expect(beforeCount).toBeGreaterThanOrEqual(1);

    var targetId = listRes.body.data[0].id;

    var res = await h.request(h.app)
      .delete('/api/archives/records/batch')
      .set('Authorization', 'Bearer ' + user.token)
      .send({ ids: [targetId] });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);

    // 삭제 후 카운트 확인
    var countRes = await h.request(h.app)
      .get('/api/archives/records/count')
      .set('Authorization', 'Bearer ' + user.token);

    expect(countRes.body.data.count).toBe(beforeCount - 1);
  });

  // 7. Bulk 저장 시 기존 레코드 교체 (user_id 기준)
  test('POST /api/archives/records/bulk — 기존 레코드 교체 (user_id 기준)', async () => {
    // 먼저 bulk로 2건 저장
    var res1 = await h.request(h.app)
      .post('/api/archives/records/bulk')
      .set('Authorization', 'Bearer ' + user.token)
      .send({
        records: [
          { date: '20260410', name: 'AAA', orderNo: 'X-1', hours: 1, taskType: 'A', abbr: 'A', content: 'first' },
          { date: '20260410', name: 'BBB', orderNo: 'X-2', hours: 2, taskType: 'B', abbr: 'B', content: 'second' }
        ]
      });
    expect(res1.status).toBe(201);
    expect(res1.body.count).toBe(2);

    // 다시 bulk로 3건 저장 — 기존 2건은 삭제되고 3건만 남아야 함
    var res2 = await h.request(h.app)
      .post('/api/archives/records/bulk')
      .set('Authorization', 'Bearer ' + user.token)
      .send({
        records: [
          { date: '20260411', name: 'CCC', orderNo: 'Y-1', hours: 3, taskType: 'C', abbr: 'C', content: 'third' },
          { date: '20260411', name: 'DDD', orderNo: 'Y-2', hours: 4, taskType: 'D', abbr: 'D', content: 'fourth' },
          { date: '20260411', name: 'EEE', orderNo: 'Y-3', hours: 5, taskType: 'E', abbr: 'E', content: 'fifth' }
        ]
      });
    expect(res2.status).toBe(201);
    expect(res2.body.count).toBe(3);

    // 카운트 확인 — 3건이어야 함 (이전 2건은 교체됨)
    var countRes = await h.request(h.app)
      .get('/api/archives/records/count')
      .set('Authorization', 'Bearer ' + user.token);

    expect(countRes.body.data.count).toBe(3);

    // 이전 레코드(AAA, BBB)가 없는지 확인
    var listRes = await h.request(h.app)
      .get('/api/archives/records')
      .set('Authorization', 'Bearer ' + user.token);

    var names = listRes.body.data.map(function (r) { return r.name; });
    expect(names).not.toContain('AAA');
    expect(names).not.toContain('BBB');
    expect(names).toContain('CCC');
    expect(names).toContain('DDD');
    expect(names).toContain('EEE');
  });

  // 8. ocmt/oclient 값이 저장 후에도 유지되는지 확인
  test('ocmt/oclient 값이 저장 후에도 유지되는지 확인', async () => {
    // bulk로 ocmt/oclient 포함 레코드 저장
    var res = await h.request(h.app)
      .post('/api/archives/records/bulk')
      .set('Authorization', 'Bearer ' + user.token)
      .send({
        records: [
          { date: '20260415', name: '테스트유저', orderNo: 'OC-1', hours: 8, taskType: '개발', abbr: 'DEV', content: '작업', ocmt: '특별 비고', oclient: 'ABC주식회사' },
          { date: '20260415', name: '테스트유저', orderNo: 'OC-2', hours: 4, taskType: '회의', abbr: 'MTG', content: '회의 참석', ocmt: null, oclient: null }
        ]
      });

    expect(res.status).toBe(201);

    // 조회하여 ocmt/oclient 유지 확인
    var listRes = await h.request(h.app)
      .get('/api/archives/records')
      .set('Authorization', 'Bearer ' + user.token);

    var withOcmt = listRes.body.data.find(function (r) { return r.order_no === 'OC-1'; });
    var withoutOcmt = listRes.body.data.find(function (r) { return r.order_no === 'OC-2'; });

    expect(withOcmt).toBeDefined();
    expect(withOcmt.ocmt).toBe('특별 비고');
    expect(withOcmt.oclient).toBe('ABC주식회사');

    expect(withoutOcmt).toBeDefined();
    expect(withoutOcmt.ocmt).toBeNull();
    expect(withoutOcmt.oclient).toBeNull();
  });

});
