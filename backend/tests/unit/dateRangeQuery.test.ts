import { parseQueryDateFrom, parseQueryDateTo, getIstCalendarDayBounds } from '../../src/utils/dateRangeQuery.js';

describe('dateRangeQuery IST calendar days', () => {
  test('20/08 is IST midnight to IST end, not UTC day', () => {
    const from = parseQueryDateFrom('2026-08-20');
    const to = parseQueryDateTo('2026-08-20');
    expect(from?.toISOString()).toBe('2026-08-19T18:30:00.000Z');
    expect(to?.toISOString()).toBe('2026-08-20T18:29:59.999Z');

    const early21AugIst = new Date('2026-08-20T18:30:19.000Z');
    expect(to!.getTime()).toBeLessThan(early21AugIst.getTime());
  });

  test('express-validator UTC-midnight Date keeps the YYYY-MM-DD calendar day', () => {
    const from = parseQueryDateFrom(new Date('2026-08-20T00:00:00.000Z'));
    expect(from?.toISOString()).toBe('2026-08-19T18:30:00.000Z');
  });

  test('getIstCalendarDayBounds uses +05:30', () => {
    const { start, end, day } = getIstCalendarDayBounds(new Date('2026-08-20T10:00:00.000Z'));
    expect(day).toBe('2026-08-20');
    expect(start.toISOString()).toBe('2026-08-19T18:30:00.000Z');
    expect(end.toISOString()).toBe('2026-08-20T18:29:59.999Z');
  });
});
