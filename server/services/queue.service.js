/**
 * 큐 서비스 (pg-boss + 인라인 fallback)
 *
 * 사용 예 (notification.service.js 통합 가이드 — 별도 라운드):
 *   var queue = require('./queue.service');
 *   await queue.start();
 *   queue.subscribe('telegram_send', async function(job) {
 *     await telegramService.sendMessage(job.data.chatId, job.data.text);
 *   });
 *   await queue.publish('telegram_send', { chatId, text });
 *
 * 환경변수:
 *   QUEUE_ENABLED=1   — pg-boss 활성. 그 외/미설정: 인라인 fallback
 *   DATABASE_URL      — pg-boss 접속 (PostgreSQL)
 *
 * 설계 원칙:
 *   - pg-boss 모듈 부재 / DB 연결 실패 / QUEUE_ENABLED 미설정 — 모두 인라인 fallback
 *   - 인라인 fallback: 메모리 핸들러 맵 + publish 시 즉시 실행 (pg-boss와 동일한 job 객체 시뮬레이션)
 *   - 모든 async 함수는 throw하지 않고 우아하게 전환
 *   - 호출자는 큐 활성/비활성 여부와 무관하게 동일한 코드 사용
 */

'use strict';

// ───────────────────────────────────────────────────────────────
// 모듈 동적 로드
// ───────────────────────────────────────────────────────────────
var PgBoss;
try {
  PgBoss = require('pg-boss');
} catch (e) {
  PgBoss = null;
}

var logger;
try {
  var _log = require('../lib/logger');
  if (_log && typeof _log.child === 'function') {
    logger = _log.child({ label: 'queue' });
  } else if (_log && typeof _log.info === 'function') {
    logger = _log;
  } else {
    logger = console;
  }
} catch (e) {
  logger = console;
}

// 로거 메서드 보강 (console 폴백 시 child 등 없을 수 있음)
function _logWarn(msg) {
  if (logger && typeof logger.warn === 'function') logger.warn(msg);
  else console.warn(msg);
}
function _logInfo(msg) {
  if (logger && typeof logger.info === 'function') logger.info(msg);
  else console.log(msg);
}
function _logError(msg, err) {
  if (logger && typeof logger.error === 'function') logger.error(msg, err || '');
  else console.error(msg, err || '');
}

// ───────────────────────────────────────────────────────────────
// 내부 상태
// ───────────────────────────────────────────────────────────────
var _boss = null;          // pg-boss 인스턴스 (활성 시)
var _enabled = false;      // 활성 여부 (start 성공 시 true)
var _started = false;      // start() 이미 호출됨
var _handlers = {};        // jobName -> handler 함수 (fallback 및 활성 모두 보관)

function _isEnabledByEnv() {
  var v = process.env.QUEUE_ENABLED;
  return v === '1' || v === 'true';
}

// ───────────────────────────────────────────────────────────────
// 인라인 fallback 핸들러 실행기
// ───────────────────────────────────────────────────────────────
function _inlinePublish(jobName, data) {
  var h = _handlers[jobName];
  if (!h) {
    _logWarn('[queue] no handler for ' + jobName + ', dropping job');
    return Promise.resolve(null);
  }
  // pg-boss job 객체 시뮬레이션: { id, name, data }
  var job = {
    id: 'inline-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    name: jobName,
    data: data
  };
  return Promise.resolve()
    .then(function () { return h(job); })
    .catch(function (e) {
      _logError('[queue/inline] handler error for ' + jobName + ': ' + (e && e.message ? e.message : e));
      return null;
    });
}

// ───────────────────────────────────────────────────────────────
// 공개 API
// ───────────────────────────────────────────────────────────────

/**
 * pg-boss 부팅. 활성 조건 미충족 시 fallback (no-op).
 * 다중 호출 안전.
 */
async function start() {
  if (_started) return _enabled;
  _started = true;

  // 1) 환경변수 체크
  if (!_isEnabledByEnv()) {
    _logInfo('[queue] QUEUE_ENABLED 미설정 — 인라인 fallback 모드');
    _enabled = false;
    return false;
  }

  // 2) 모듈 로드 체크
  if (!PgBoss) {
    _logWarn('[queue] pg-boss 모듈 로드 실패 — 인라인 fallback 모드');
    _enabled = false;
    return false;
  }

  // 3) DATABASE_URL 체크
  var connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    _logWarn('[queue] DATABASE_URL 미설정 — 인라인 fallback 모드');
    _enabled = false;
    return false;
  }

  // 4) pg-boss 인스턴스 부팅
  try {
    _boss = new PgBoss({
      connectionString: connectionString,
      schema: 'pgboss',
      retryLimit: 3,
      retryDelay: 60,
      retryBackoff: true
    });

    // pg-boss 자체 에러 로깅
    if (typeof _boss.on === 'function') {
      _boss.on('error', function (err) {
        _logError('[queue/pg-boss] error: ' + (err && err.message ? err.message : err));
      });
    }

    await _boss.start();

    // 이전에 subscribe로 등록된 핸들러를 pg-boss에도 재등록
    var jobNames = Object.keys(_handlers);
    for (var i = 0; i < jobNames.length; i++) {
      var name = jobNames[i];
      try {
        if (typeof _boss.work === 'function') {
          await _boss.work(name, _handlers[name]);
        } else if (typeof _boss.subscribe === 'function') {
          // pg-boss 9.x 이하 호환
          await _boss.subscribe(name, _handlers[name]);
        }
      } catch (subErr) {
        _logWarn('[queue] 핸들러 재등록 실패 (' + name + '): ' + (subErr && subErr.message ? subErr.message : subErr));
      }
    }

    _enabled = true;
    _logInfo('[queue] pg-boss 활성화 완료 (schema=pgboss)');
    return true;
  } catch (e) {
    _logWarn('[queue] pg-boss start 실패 — 인라인 fallback 전환: ' + (e && e.message ? e.message : e));
    _boss = null;
    _enabled = false;
    return false;
  }
}

/**
 * 정상 종료. fallback이면 no-op.
 */
async function stop() {
  if (!_enabled || !_boss) {
    _enabled = false;
    _started = false;
    return;
  }
  try {
    await _boss.stop({ graceful: true, timeout: 30000 });
    _logInfo('[queue] pg-boss 종료 완료');
  } catch (e) {
    _logWarn('[queue] pg-boss stop 실패: ' + (e && e.message ? e.message : e));
  } finally {
    _boss = null;
    _enabled = false;
    _started = false;
  }
}

/**
 * 작업 발행.
 *   - pg-boss 활성: 큐 enqueue
 *   - fallback: 등록된 핸들러 즉시 실행 (없으면 warn + drop)
 */
async function publish(jobName, data, opts) {
  if (!jobName || typeof jobName !== 'string') {
    _logWarn('[queue] publish: invalid jobName');
    return null;
  }

  // pg-boss 활성 시
  if (_enabled && _boss) {
    try {
      var sendOpts = opts || {};
      // pg-boss 10.x: send(name, data, options)
      if (typeof _boss.send === 'function') {
        return await _boss.send(jobName, data || {}, sendOpts);
      }
      // 9.x 호환: publish
      if (typeof _boss.publish === 'function') {
        return await _boss.publish(jobName, data || {}, sendOpts);
      }
      _logWarn('[queue] pg-boss API 미지원 — 인라인 fallback');
      return await _inlinePublish(jobName, data);
    } catch (e) {
      _logError('[queue] publish 실패, 인라인 fallback: ' + (e && e.message ? e.message : e));
      return await _inlinePublish(jobName, data);
    }
  }

  // fallback 인라인 실행
  return await _inlinePublish(jobName, data);
}

/**
 * 핸들러 등록.
 *   - pg-boss 활성: boss.work(jobName, handler)
 *   - fallback: 메모리 맵에 등록 (publish 시 호출)
 *   - 어느 경우든 메모리 맵에도 보관 (start 이후 활성화 대비)
 */
function subscribe(jobName, handler) {
  if (!jobName || typeof jobName !== 'string') {
    _logWarn('[queue] subscribe: invalid jobName');
    return;
  }
  if (typeof handler !== 'function') {
    _logWarn('[queue] subscribe: handler is not a function (' + jobName + ')');
    return;
  }

  _handlers[jobName] = handler;

  if (_enabled && _boss) {
    try {
      if (typeof _boss.work === 'function') {
        // pg-boss 10.x
        Promise.resolve(_boss.work(jobName, handler)).catch(function (e) {
          _logWarn('[queue] boss.work 실패 (' + jobName + '): ' + (e && e.message ? e.message : e));
        });
      } else if (typeof _boss.subscribe === 'function') {
        // 9.x 호환
        Promise.resolve(_boss.subscribe(jobName, handler)).catch(function (e) {
          _logWarn('[queue] boss.subscribe 실패 (' + jobName + '): ' + (e && e.message ? e.message : e));
        });
      } else {
        _logWarn('[queue] pg-boss work/subscribe API 미지원 — 인라인 폴백 유지');
      }
    } catch (e) {
      _logWarn('[queue] subscribe 실패 (' + jobName + '): ' + (e && e.message ? e.message : e));
    }
  }
}

/**
 * 활성 상태.
 */
function isEnabled() {
  return _enabled === true;
}

/**
 * 큐 통계.
 *   - 활성: pg-boss 큐 상태(created/active/completed/failed) — 등록된 핸들러별
 *   - fallback: { mode: 'inline', handlers: N }
 */
async function getStats() {
  if (!_enabled || !_boss) {
    return {
      mode: 'inline',
      handlers: Object.keys(_handlers).length,
      jobs: Object.keys(_handlers)
    };
  }

  var stats = {
    mode: 'pg-boss',
    handlers: Object.keys(_handlers).length,
    queues: {}
  };

  var jobNames = Object.keys(_handlers);
  for (var i = 0; i < jobNames.length; i++) {
    var name = jobNames[i];
    try {
      // pg-boss 10.x: getQueueSize / countStates
      if (typeof _boss.getQueueSize === 'function') {
        stats.queues[name] = { size: await _boss.getQueueSize(name) };
      }
      if (typeof _boss.countStates === 'function') {
        var counts = await _boss.countStates();
        // countStates는 전체 합계 + 큐별 통계를 반환 (pg-boss 10.x)
        if (counts && counts.queues && counts.queues[name]) {
          stats.queues[name] = Object.assign(stats.queues[name] || {}, counts.queues[name]);
        } else if (counts) {
          stats.queues[name] = Object.assign(stats.queues[name] || {}, { totals: counts });
        }
      }
    } catch (e) {
      stats.queues[name] = { error: (e && e.message ? e.message : String(e)) };
    }
  }

  return stats;
}

// ───────────────────────────────────────────────────────────────
// Export
// ───────────────────────────────────────────────────────────────
module.exports = {
  start: start,
  stop: stop,
  publish: publish,
  subscribe: subscribe,
  isEnabled: isEnabled,
  getStats: getStats
};
