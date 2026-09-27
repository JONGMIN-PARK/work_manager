/**
 * 각 테스트 파일 시작 전에 앱의 자동 마이그레이션(config/db.js)이 끝나기를 기다린다.
 *
 * jest 는 파일마다 모듈 레지스트리를 새로 만들므로 파일마다 새 풀이 생기고, 첫 연결 때
 * server/migrations/*.sql 전체가 다시 실행된다. 이를 기다리지 않으면 마이그레이션이
 * 테스트 쿼리와 동시에 돌아 교착이 난다 — 예: 032_issue_assignees 트랜잭션
 * (issue_assignees 인덱스 락 보유 → issues 에 AccessExclusive 요청) 과
 * orders.test 의 INSERT INTO issues (issues RowExclusive 보유 → 트리거가 issue_assignees 대기).
 * PostgreSQL 이 테스트 쪽을 희생시키면 "deadlock detected" 로 간헐 실패한다(CI 07661a3).
 * 또한 앞 파일의 마이그레이션이 다음 파일 실행 중까지 이어지는 것도 막는다.
 */
var db = require('./config/db');

beforeAll(function () {
  return db.migrationsReady();
}, 120000);
