// 알림 작업의 날짜 계산 — 스케줄은 UTC 로 돌지만 날짜는 한국(KST) 기준이어야 한다
var jobs = require('../services/notification/jobs');

describe('notification jobs — KST 날짜', function () {
  afterEach(function () { jest.useRealTimers(); });

  test('일일 브리핑 시각(23:30 UTC = KST 08:30)에 "오늘"은 KST 날짜', function () {
    jest.useFakeTimers({ now: new Date('2026-09-27T23:30:00Z') });
    expect(jobs._kstYmd(0)).toBe('2026-09-28');
    expect(jobs._kstYmd(3)).toBe('2026-10-01');
  });

  test('납기 리마인더 시각(00:00 UTC = KST 09:00)', function () {
    jest.useFakeTimers({ now: new Date('2026-09-30T00:00:00Z') });
    expect(jobs._kstYmd(0)).toBe('2026-09-30');
    expect(jobs._kstYmd(1)).toBe('2026-10-01');
  });

  test('_parseYmd: YYYY-MM-DD 와 옛 YYYYMMDD 모두, 잘못된 값은 Invalid', function () {
    expect(jobs._parseYmd('2026-09-30').toISOString().slice(0, 10)).toBe('2026-09-30');
    expect(jobs._parseYmd('20260930').toISOString().slice(0, 10)).toBe('2026-09-30');
    expect(isNaN(jobs._parseYmd('2026-9-3'))).toBe(true);
    expect(isNaN(jobs._parseYmd(null))).toBe(true);
  });
});
