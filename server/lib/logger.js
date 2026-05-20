// server/lib/logger.js
// 구조화 로깅 모듈 (winston 기반, 미설치 시 console fallback)
// - 환경변수: LOG_LEVEL(기본 info), LOG_DIR(기본 ./logs 절대경로), NODE_ENV
// - 인터페이스: info / warn / error / debug / child({label})
// - winston 또는 winston-daily-rotate-file 미설치/초기화 실패 시 동일 API의 console 로거로 폴백

var path = require('path');
var fs = require('fs');

var LOG_LEVEL = process.env.LOG_LEVEL || 'info';
var LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '..', 'logs');
var NODE_ENV = process.env.NODE_ENV || 'development';
var IS_TEST = NODE_ENV === 'test';
var IS_PROD = NODE_ENV === 'production';

// debug 레벨 우선순위 비교용
var LEVEL_PRIORITY = { error: 0, warn: 1, info: 2, debug: 3 };

// Asia/Seoul 타임스탬프 생성기
function seoulTimestamp() {
  try {
    // en-CA 로케일은 'YYYY-MM-DD HH:mm:ss' 포맷에 가까움
    return new Date().toLocaleString('en-CA', {
      timeZone: 'Asia/Seoul',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).replace(',', '');
  } catch (e) {
    return new Date().toISOString();
  }
}

// meta 1단계 직렬화 (순환참조/예외 안전)
function safeMeta(meta) {
  if (meta === undefined || meta === null) return '';
  try {
    if (typeof meta === 'string') return meta;
    return JSON.stringify(meta);
  } catch (e) {
    try {
      return String(meta);
    } catch (_) {
      return '[unserializable meta]';
    }
  }
}

// ─────────────────────────────────────────────
// Fallback 로거 (winston 부재/실패 시 사용)
// ─────────────────────────────────────────────
function fallbackLogger(label) {
  function shouldLog(level) {
    var cur = LEVEL_PRIORITY[LOG_LEVEL];
    var want = LEVEL_PRIORITY[level];
    if (cur === undefined) cur = LEVEL_PRIORITY.info;
    if (want === undefined) want = LEVEL_PRIORITY.info;
    return want <= cur;
  }
  function fmt(level, msg, meta) {
    var prefix = '[' + seoulTimestamp() + '] [' + level.toUpperCase() + ']'
      + (label ? ' [' + label + ']' : '');
    var line = prefix + ' ' + (msg === undefined ? '' : msg);
    var m = safeMeta(meta);
    return m ? line + ' ' + m : line;
  }
  return {
    info: function (m, meta) { if (shouldLog('info')) console.log(fmt('info', m, meta)); },
    warn: function (m, meta) { if (shouldLog('warn')) console.warn(fmt('warn', m, meta)); },
    error: function (m, meta) { if (shouldLog('error')) console.error(fmt('error', m, meta)); },
    debug: function (m, meta) { if (shouldLog('debug')) console.log(fmt('debug', m, meta)); },
    child: function (opts) {
      var nextLabel = (opts && opts.label) || label;
      return fallbackLogger(nextLabel);
    }
  };
}

// ─────────────────────────────────────────────
// winston 로딩 시도
// ─────────────────────────────────────────────
var winston = null;
var DailyRotateFile = null;
try {
  winston = require('winston');
} catch (e) {
  winston = null;
}
try {
  DailyRotateFile = require('winston-daily-rotate-file');
} catch (e) {
  DailyRotateFile = null;
}

// 모듈 export 변수
var mod;

if (!winston) {
  // winston 미설치 → 폴백 로거 export
  mod = fallbackLogger();
} else {
  try {
    // 로그 디렉터리 생성 (test 모드 또는 파일 transport 사용 안 할 땐 skip)
    var enableFileTransport = !IS_TEST;
    if (enableFileTransport) {
      try {
        if (!fs.existsSync(LOG_DIR)) {
          fs.mkdirSync(LOG_DIR, { recursive: true });
        }
      } catch (dirErr) {
        // 디렉터리 생성 실패 → 파일 transport 비활성
        enableFileTransport = false;
        try { console.warn('[logger] LOG_DIR 생성 실패, 파일 transport 비활성:', dirErr && dirErr.message); } catch (_) {}
      }
    } else {
      enableFileTransport = false;
    }

    // 공통 포맷: timestamp(Seoul) + level + label + message + meta
    var printf = winston.format.printf(function (info) {
      var label = info.label ? ' [' + info.label + ']' : '';
      var ts = info.timestamp || seoulTimestamp();
      var lvl = (info.level || 'info').toUpperCase();
      var msg = info.message === undefined ? '' : info.message;

      // meta 추출: timestamp/level/label/message/Symbol 키 제외
      var meta = {};
      var hasMeta = false;
      Object.keys(info).forEach(function (k) {
        if (k === 'timestamp' || k === 'level' || k === 'label' || k === 'message' || k === 'splat') return;
        meta[k] = info[k];
        hasMeta = true;
      });
      var metaStr = hasMeta ? ' ' + safeMeta(meta) : '';
      return '[' + ts + '] [' + lvl + ']' + label + ' ' + msg + metaStr;
    });

    var baseFormat = winston.format.combine(
      winston.format.timestamp({ format: seoulTimestamp }),
      printf
    );

    var transports = [];

    // 콘솔 transport (항상)
    try {
      transports.push(new winston.transports.Console({
        level: LOG_LEVEL,
        handleExceptions: false
      }));
    } catch (consoleErr) {
      try { console.warn('[logger] Console transport 초기화 실패:', consoleErr && consoleErr.message); } catch (_) {}
    }

    // 파일 transport (production/development 모두 — test 제외)
    if (enableFileTransport && DailyRotateFile) {
      try {
        transports.push(new DailyRotateFile({
          dirname: LOG_DIR,
          filename: 'app-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          zippedArchive: true,
          maxSize: '20m',
          maxFiles: '14d',
          level: LOG_LEVEL
        }));
      } catch (fileErr) {
        try { console.warn('[logger] 파일 transport 초기화 실패:', fileErr && fileErr.message); } catch (_) {}
      }
    } else if (enableFileTransport && !DailyRotateFile) {
      try { console.warn('[logger] winston-daily-rotate-file 미설치 — 파일 transport 비활성'); } catch (_) {}
    }

    if (!transports.length) {
      throw new Error('no transports available');
    }

    var winstonLogger = winston.createLogger({
      level: LOG_LEVEL,
      levels: winston.config.npm.levels,
      format: baseFormat,
      transports: transports,
      exitOnError: false
    });

    // child 지원 래퍼 — winston.createLogger 인스턴스의 child는 defaultMeta 병합형이지만
    // label을 printf에서 직접 처리하므로, 우리는 wrap 객체에서 label 주입을 보장한다.
    function wrap(label) {
      function emit(level, m, meta) {
        var info = { level: level, message: m === undefined ? '' : m };
        if (label) info.label = label;
        if (meta !== undefined && meta !== null) {
          if (typeof meta === 'object') {
            Object.keys(meta).forEach(function (k) {
              if (k === 'level' || k === 'message' || k === 'label') return;
              info[k] = meta[k];
            });
          } else {
            info.meta = meta;
          }
        }
        try {
          winstonLogger.log(info);
        } catch (logErr) {
          // 로깅 실패 시 console fallback
          try {
            console.error('[logger] log 실패:', logErr && logErr.message);
            console.log('[' + seoulTimestamp() + '] [' + level.toUpperCase() + ']'
              + (label ? ' [' + label + ']' : '') + ' ' + m + (meta ? ' ' + safeMeta(meta) : ''));
          } catch (_) {}
        }
      }
      return {
        info: function (m, meta) { emit('info', m, meta); },
        warn: function (m, meta) { emit('warn', m, meta); },
        error: function (m, meta) { emit('error', m, meta); },
        debug: function (m, meta) { emit('debug', m, meta); },
        child: function (opts) {
          var nextLabel = (opts && opts.label) || label;
          return wrap(nextLabel);
        }
      };
    }

    mod = wrap(null);
  } catch (initErr) {
    // winston 초기화 자체가 실패 → 폴백
    try { console.error('[logger] winston 초기화 실패, fallback 사용:', initErr && initErr.message); } catch (_) {}
    mod = fallbackLogger();
  }
}

module.exports = mod;
