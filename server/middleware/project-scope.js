/**
 * project-scope.js — (호환용) 프로젝트 가시성 서브쿼리.
 *
 * 규칙 정의는 lib/project-access.js 로 옮겨졌다. 기존 require 경로를 쓰는 코드를 위해
 * 같은 이름으로 다시 내보낸다. 새 코드는 lib/project-access 를 직접 쓸 것.
 */
var pa = require('../lib/project-access');

module.exports = {
  accessibleProjectsSubquery: pa.accessibleProjectsSubquery,
  accessibleOrderNosSubquery: pa.accessibleOrderNosSubquery
};
