/**
 * 스케줄러 유틸리티 — 반복 작업 등록
 */

/** 매일 지정 시각(UTC)에 실행 */
function scheduleDaily(utcHour, utcMinute, callback, label) {
  var now = new Date();
  var next = new Date(now);
  next.setUTCHours(utcHour, utcMinute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  var delay = next.getTime() - now.getTime();
  setTimeout(function () {
    callback().catch(function (e) {
      console.error('[Scheduler] ' + label + ' error:', e.message);
    });
    setInterval(function () {
      callback().catch(function (e) {
        console.error('[Scheduler] ' + label + ' error:', e.message);
      });
    }, 24 * 60 * 60 * 1000);
  }, delay);
  console.log('[Scheduler] ' + label + ' scheduled, next run in ' + Math.round(delay / 60000) + ' min');
}

/** 매주 특정 요일+시각(UTC)에 실행 (dayOfWeek: 0=일, 1=월, ...) */
function scheduleWeekly(dayOfWeek, utcHour, utcMinute, callback, label) {
  var now = new Date();
  var currentDay = now.getDay();
  var diff = dayOfWeek - currentDay;
  if (diff < 0) diff += 7;
  var next = new Date(now);
  next.setDate(now.getDate() + diff);
  next.setUTCHours(utcHour, utcMinute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 7);
  var delay = next.getTime() - now.getTime();
  setTimeout(function () {
    callback().catch(function (e) {
      console.error('[Scheduler] ' + label + ' error:', e.message);
    });
    setInterval(function () {
      callback().catch(function (e) {
        console.error('[Scheduler] ' + label + ' error:', e.message);
      });
    }, 7 * 24 * 60 * 60 * 1000);
  }, delay);
  console.log('[Scheduler] ' + label + ' scheduled, next run in ' + Math.round(delay / 60000) + ' min');
}

module.exports = {
  scheduleDaily: scheduleDaily,
  scheduleWeekly: scheduleWeekly
};
