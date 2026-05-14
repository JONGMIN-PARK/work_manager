/**
 * 단순 TTL 메모리 캐시 — 외부 의존성 없음
 *
 * v13.59: A/S 통계 응답 캐싱용
 *
 * 사용:
 *   var cache = require('./ttl-cache.service').create({ ttlMs: 5*60*1000, max: 500 });
 *   cache.get(key)   → undefined or value (만료된 항목은 자동 삭제)
 *   cache.set(key, value)
 *   cache.invalidate(prefix?)  → prefix로 시작하는 키 일괄 삭제 (없으면 전체)
 *   cache.stats()    → { size, hits, misses, hitRate }
 *
 * 메모리 관리:
 *   - max 도달 시 가장 오래된 항목부터 제거 (FIFO).
 *   - 만료된 항목은 get 시점에 lazily 삭제. 별도 timer 안 둠 (Node 부담 적음).
 */
function create(opts) {
  opts = opts || {};
  var ttlMs = opts.ttlMs || 5 * 60 * 1000;  // 기본 5분
  var max = opts.max || 500;
  var store = new Map();
  var hits = 0;
  var misses = 0;

  function get(key) {
    var entry = store.get(key);
    if (!entry) { misses++; return undefined; }
    if (entry.expiresAt < Date.now()) {
      store.delete(key);
      misses++;
      return undefined;
    }
    hits++;
    return entry.value;
  }

  function set(key, value) {
    // FIFO eviction
    if (store.size >= max && !store.has(key)) {
      var oldestKey = store.keys().next().value;
      if (oldestKey) store.delete(oldestKey);
    }
    store.set(key, { value: value, expiresAt: Date.now() + ttlMs });
  }

  function invalidate(prefix) {
    if (!prefix) { store.clear(); return; }
    var toDelete = [];
    store.forEach(function (_, k) { if (k.indexOf(prefix) === 0) toDelete.push(k); });
    toDelete.forEach(function (k) { store.delete(k); });
    return toDelete.length;
  }

  function stats() {
    var total = hits + misses;
    return {
      size: store.size,
      hits: hits,
      misses: misses,
      hitRate: total ? Math.round(hits * 1000 / total) / 10 : 0
    };
  }

  function size() { return store.size; }

  return { get: get, set: set, invalidate: invalidate, stats: stats, size: size };
}

module.exports = { create: create };
