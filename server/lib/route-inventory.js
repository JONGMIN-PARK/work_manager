/**
 * route-inventory.js — Express 앱에 등록된 모든 (METHOD, 경로) 목록을 뽑는다.
 *
 * 라우터 분할(예: as-tickets → 하위 라우터)·리팩터링 전후로 목록을 비교해
 * 경로가 사라지거나 바뀌지 않았는지 확인하는 데 쓴다.
 *   - __tests__/route-inventory.test.js 가 체크인된 스냅샷과 비교
 *   - `node scripts/dump-routes.js` 로 스냅샷 재생성
 *
 * 마운트 경로는 layer.regexp 에서 복원한다(Express 4 내부 구조).
 * 파라미터 마운트(`/:id/...` 에 router.use)도 layer.keys 로 복원한다.
 */

function mountPathOf(layer) {
  if (layer.path != null && typeof layer.path === 'string') return layer.path;
  var re = layer.regexp;
  if (!re) return '';
  if (re.fast_slash) return '';
  var src = re.source;
  // express 4: /^\/api\/users\/?(?=\/|$)/i
  src = src
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')   // 끝의 \/?(?=\/|$)
    .replace(/\(\?=\\\/\|\$\)$/, '')
    .replace(/\$$/, '');
  var keyIdx = 0;
  var keys = layer.keys || [];
  // 파라미터 그룹 (?:\/([^\/]+?)) → /:name
  src = src.replace(/\(\?:\\\/\(\[\^\\\/\]\+\?\)\)/g, function () {
    var k = keys[keyIdx++];
    return '/:' + (k ? k.name : 'param');
  });
  src = src.replace(/\\\//g, '/').replace(/\\\./g, '.').replace(/\\-/g, '-');
  return src;
}

function collect(stack, prefix, out) {
  stack.forEach(function (layer) {
    if (layer.route) {
      var paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      var methods = Object.keys(layer.route.methods).filter(function (m) { return layer.route.methods[m]; });
      paths.forEach(function (p) {
        methods.forEach(function (m) {
          var full = (prefix + (p === '/' && prefix ? '' : p)) || '/';
          out.push(m.toUpperCase() + ' ' + full);
        });
      });
    } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
      collect(layer.handle.stack, prefix + mountPathOf(layer), out);
    }
  });
  return out;
}

/**
 * @param {import('express').Application} app
 * @param {{sorted?: boolean}} [opts] sorted=false 면 등록(매칭) 순서 그대로 — 경로 우선순위 비교용
 * @returns {string[]} 정렬된 "METHOD /path" 목록 (중복 등록도 그대로 포함 — 순서 무관 비교용)
 */
function listRoutes(app, opts) {
  var router = app._router;
  if (!router) return [];
  var out = collect(router.stack, "", []);
  return (opts && opts.sorted === false) ? out : out.sort();
}

module.exports = { listRoutes: listRoutes };
