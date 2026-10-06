import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getLocalDateStr,
  normalizeDateStr,
  getDayOfWeekAbbr,
  formatShortDate,
  formatCivilDate,
  isCivilDate,
  formatLocalTimestamp,
  getDayBounds,
  getStartOfDay,
  getEndOfDay,
  isWithinDayBounds,
  getTimezoneOffsetMinutes,
  localCivilToUtcMs,
} from './date';

describe('Canonical Date Utility (src/utils/date.ts)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getLocalDateStr', () => {
    it('returns local YYYY-MM-DD for a specific Date object', () => {
      const d = new Date(2026, 8, 8, 20, 30, 0); // Sept 8, 2026 20:30 local
      expect(getLocalDateStr(d)).toBe('2026-09-08');
    });

    it('handles single-digit months and days with zero-padding', () => {
      const d = new Date(2026, 0, 5, 9, 5, 0); // Jan 5, 2026
      expect(getLocalDateStr(d)).toBe('2026-01-05');
    });

    it('handles leap day (Feb 29, 2024)', () => {
      const d = new Date(2024, 1, 29, 12, 0, 0); // Feb 29, 2024
      expect(getLocalDateStr(d)).toBe('2024-02-29');
    });

    it('handles non-leap year (Feb 28, 2026)', () => {
      const d = new Date(2026, 1, 28, 23, 59, 59); // Feb 28, 2026
      expect(getLocalDateStr(d)).toBe('2026-02-28');
    });

    it('handles month boundary rollovers correctly', () => {
      // End of 31-day month to 1st of next month
      expect(getLocalDateStr(new Date(2026, 0, 31, 23, 59, 59))).toBe('2026-01-31');
      expect(getLocalDateStr(new Date(2026, 1, 1, 0, 0, 0))).toBe('2026-02-01');

      // End of 30-day month (April) to May 1
      expect(getLocalDateStr(new Date(2026, 3, 30, 23, 59, 59))).toBe('2026-04-30');
      expect(getLocalDateStr(new Date(2026, 4, 1, 0, 0, 0))).toBe('2026-05-01');

      // Leap year boundary: Feb 28 -> Feb 29 -> Mar 1
      expect(getLocalDateStr(new Date(2024, 1, 28, 23, 59, 59))).toBe('2024-02-28');
      expect(getLocalDateStr(new Date(2024, 1, 29, 12, 0, 0))).toBe('2024-02-29');
      expect(getLocalDateStr(new Date(2024, 2, 1, 0, 0, 0))).toBe('2024-03-01');
    });

    it('handles year boundary rollover (Dec 31 to Jan 1)', () => {
      const newYearsEve = new Date(2025, 11, 31, 23, 59, 59);
      const newYearsDay = new Date(2026, 0, 1, 0, 0, 0);
      expect(getLocalDateStr(newYearsEve)).toBe('2025-12-31');
      expect(getLocalDateStr(newYearsDay)).toBe('2026-01-01');
    });

    it('defaults to current system time when called without arguments', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 8, 8, 21, 15, 0));
      expect(getLocalDateStr()).toBe('2026-09-08');
    });

    it('preserves local date across late-night hours without rolling over into UTC tomorrow', () => {
      vi.useFakeTimers();
      // Suppose local time is 11:45 PM on Sept 8
      vi.setSystemTime(new Date(2026, 8, 8, 23, 45, 0));
      expect(getLocalDateStr()).toBe('2026-09-08');
    });

    it('returns empty string gracefully for invalid Date objects or null', () => {
      expect(getLocalDateStr(new Date('invalid date'))).toBe('');
      expect(getLocalDateStr(null as any)).toBe('');
    });
  });

  describe('Local date generation across timezones (PDT UTC-7, UTC, JST UTC+9)', () => {
    it('correctly models evening date divergence (8:30 PM PDT / 03:30 UTC / 12:30 JST)', () => {
      // Scenario 1: Physical instant 2026-09-09T03:30:00Z
      // In PDT (UTC-7): local clock is 20:30 on Sept 8
      const pdtClock = new Date(2026, 8, 8, 20, 30, 0);
      expect(getLocalDateStr(pdtClock)).toBe('2026-09-08');

      // In UTC: local clock is 03:30 on Sept 9
      const utcClock = new Date(2026, 8, 9, 3, 30, 0);
      expect(getLocalDateStr(utcClock)).toBe('2026-09-09');

      // In JST (UTC+9): local clock is 12:30 on Sept 9
      const jstClock = new Date(2026, 8, 9, 12, 30, 0);
      expect(getLocalDateStr(jstClock)).toBe('2026-09-09');
    });

    it('correctly models morning date divergence (4:30 PM PDT / 23:30 UTC / 08:30 JST next day)', () => {
      // Scenario 2: Physical instant 2026-09-08T23:30:00Z
      // In PDT (UTC-7): local clock is 16:30 on Sept 8
      const pdtClock = new Date(2026, 8, 8, 16, 30, 0);
      expect(getLocalDateStr(pdtClock)).toBe('2026-09-08');

      // In UTC: local clock is 23:30 on Sept 8
      const utcClock = new Date(2026, 8, 8, 23, 30, 0);
      expect(getLocalDateStr(utcClock)).toBe('2026-09-08');

      // In JST (UTC+9): local clock is 08:30 on Sept 9
      const jstClock = new Date(2026, 8, 9, 8, 30, 0);
      expect(getLocalDateStr(jstClock)).toBe('2026-09-09');
    });
  });

  describe('normalizeDateStr', () => {
    it('returns empty string for null, undefined, or empty input', () => {
      expect(normalizeDateStr(null)).toBe('');
      expect(normalizeDateStr(undefined)).toBe('');
      expect(normalizeDateStr('')).toBe('');
    });

    it('extracts YYYY-MM-DD prefix from ISO strings without timezone conversion', () => {
      expect(normalizeDateStr('2026-09-08T23:50:00.000Z')).toBe('2026-09-08');
      expect(normalizeDateStr('2026-09-08T00:00:00+00:00')).toBe('2026-09-08');
      expect(normalizeDateStr('2026-09-08T12:30:45-07:00')).toBe('2026-09-08');
      expect(normalizeDateStr('2026-09-08T20:30:00-07:00')).toBe('2026-09-08');
      expect(normalizeDateStr('2026-09-09T12:30:00+09:00')).toBe('2026-09-09');
    });

    it('returns YYYY-MM-DD string unchanged', () => {
      expect(normalizeDateStr('2026-09-08')).toBe('2026-09-08');
    });

    it('formats valid Date instances into local YYYY-MM-DD', () => {
      const d = new Date(2026, 8, 8, 15, 30, 0);
      expect(normalizeDateStr(d)).toBe('2026-09-08');
    });

    it('handles invalid Date instances gracefully', () => {
      const invalidDate = new Date('invalid date string');
      expect(normalizeDateStr(invalidDate)).toBe('Invalid Date');
    });

    it('handles non-ISO parseable strings', () => {
      expect(normalizeDateStr('September 8, 2026')).toBe('2026-09-08');
    });
  });

  describe('getDayOfWeekAbbr', () => {
    it('correctly maps dates to weekday abbreviations across full week', () => {
      expect(getDayOfWeekAbbr('2026-09-06')).toBe('Sun');
      expect(getDayOfWeekAbbr('2026-09-07')).toBe('Mon');
      expect(getDayOfWeekAbbr('2026-09-08')).toBe('Tue');
      expect(getDayOfWeekAbbr('2026-09-09')).toBe('Wed');
      expect(getDayOfWeekAbbr('2026-09-10')).toBe('Thu');
      expect(getDayOfWeekAbbr('2026-09-11')).toBe('Fri');
      expect(getDayOfWeekAbbr('2026-09-12')).toBe('Sat');
    });

    it('handles ISO timestamps with timezone offset cleanly', () => {
      expect(getDayOfWeekAbbr('2026-09-08T22:30:00Z')).toBe('Tue');
      expect(getDayOfWeekAbbr('2026-09-09T03:30:00+09:00')).toBe('Wed');
    });

    it('returns empty string for invalid date strings or non-existent dates', () => {
      expect(getDayOfWeekAbbr('')).toBe('');
      expect(getDayOfWeekAbbr('invalid-date')).toBe('');
      expect(getDayOfWeekAbbr('2026-02-31')).toBe(''); // Non-existent date
    });
  });

  describe('formatShortDate', () => {
    it('formats YYYY-MM-DD into "Month Day"', () => {
      expect(formatShortDate('2026-09-08')).toBe('Sep 8');
      expect(formatShortDate('2026-01-01')).toBe('Jan 1');
      expect(formatShortDate('2026-12-31')).toBe('Dec 31');
    });

    it('formats ISO timestamps via normalization', () => {
      expect(formatShortDate('2026-09-08T00:00:00+00:00')).toBe('Sep 8');
      expect(formatShortDate('2026-09-08T23:59:59Z')).toBe('Sep 8');
    });

    it('returns empty string for empty or non-string input', () => {
      expect(formatShortDate('')).toBe('');
      expect(formatShortDate(null as any)).toBe('');
      expect(formatShortDate(undefined as any)).toBe('');
    });

    it('returns unformatted string if splitting does not yield 3 parts', () => {
      expect(formatShortDate('invalid')).toBe('invalid');
    });
  });

  describe('formatLocalTimestamp', () => {
    it('generates a valid ISO-8601 UTC timestamp anchored to calendarDate and time', () => {
      const time = new Date(2026, 8, 8, 20, 31, 45); // 20:31:45
      const ts = formatLocalTimestamp('2026-09-08', time);
      expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
      expect(isWithinDayBounds(ts, '2026-09-08')).toBe(true);
    });

    it('falls back to valid timestamp when calendarDate is missing or null', () => {
      const time = new Date(2026, 8, 8, 14, 20, 10);
      expect(formatLocalTimestamp(null, time)).toMatch(/^2026-09-08T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
      expect(formatLocalTimestamp(undefined, time)).toMatch(/^2026-09-08T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
      expect(formatLocalTimestamp('', time)).toMatch(/^2026-09-08T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
    });

    it('falls back to valid timestamp when calendarDate is malformed', () => {
      const time = new Date(2026, 8, 8, 14, 20, 10);
      expect(formatLocalTimestamp('invalid-date', time)).toMatch(/^2026-09-08T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
      expect(formatLocalTimestamp('2026/09/08', time)).toMatch(/^2026-09-08T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
    });

    it('defaults to current system time if time parameter is omitted', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 8, 8, 19, 40, 30));
      const ts = formatLocalTimestamp('2026-09-08');
      expect(isWithinDayBounds(ts, '2026-09-08')).toBe(true);
      expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
    });

    it('gracefully handles invalid Date object passed as time parameter without throwing or outputting NaN', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 8, 8, 18, 0, 0));
      const invalidDate = new Date('invalid');
      const ts = formatLocalTimestamp('2026-09-08', invalidDate);
      expect(ts).not.toContain('NaN');
      expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
      expect(isWithinDayBounds(ts, '2026-09-08')).toBe(true);
    });

    it('extracts hours, minutes, and seconds in the specified timeZone via Intl.DateTimeFormat', () => {
      // 2026-09-23T14:30:00Z: In Asia/Tokyo (UTC+9), clock time is 23:30:00.
      const instant = new Date('2026-09-23T14:30:00Z');
      const ts = formatLocalTimestamp('2026-09-23', instant, 'Asia/Tokyo');
      // Anchoring to 2026-09-23 and clock time 23:30:00 in Tokyo corresponds to 14:30:00Z UTC.
      expect(ts).toBe('2026-09-23T14:30:00.000Z');

      // In America/New_York (EDT, UTC-4), clock time is 10:30:00.
      const tsNy = formatLocalTimestamp('2026-09-23', instant, 'America/New_York');
      // Anchoring to 2026-09-23 and clock time 10:30:00 EDT corresponds to 14:30:00Z UTC.
      expect(tsNy).toBe('2026-09-23T14:30:00.000Z');
    });
  });

  describe('formatLocalTimestamp and getDayBounds round-trip across timezones and dates', () => {
    it('accurately round-trips for all 24 hours x 6 dates with 144/144 retained and 0 leaked', () => {
      const dates = [
        '2026-03-08', // Spring Forward (23h day in US)
        '2026-11-01', // Fall Back (25h day in US)
        '2026-07-04', // Midsummer
        '2026-01-15', // Midwinter
        '2026-09-08', // Autumn
        '2026-10-04', // Spring Forward in Southern Hemisphere (Lord Howe)
      ];

      let totalRetained = 0;
      let totalLeaked = 0;

      for (const dStr of dates) {
        const [y, m, d] = dStr.split('-').map(Number);
        const prevDate = new Date(y, m - 1, d - 1);
        const nextDate = new Date(y, m - 1, d + 1);
        const prevStr = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}-${String(prevDate.getDate()).padStart(2, '0')}`;
        const nextStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`;

        for (let h = 0; h < 24; h++) {
          const localTime = new Date(y, m - 1, d, h, 30, 0, 0);
          const ts = formatLocalTimestamp(dStr, localTime);

          if (isWithinDayBounds(ts, dStr)) {
            totalRetained++;
          }
          if (isWithinDayBounds(ts, prevStr) || isWithinDayBounds(ts, nextStr)) {
            totalLeaked++;
          }
        }
      }

      expect(totalRetained).toBe(144);
      expect(totalLeaked).toBe(0);
    });
  });

  describe('getTimezoneOffsetMinutes', () => {
    it('accurately parses explicit offset strings', () => {
      expect(getTimezoneOffsetMinutes(new Date(), '+09:00')).toBe(540);
      expect(getTimezoneOffsetMinutes(new Date(), '-05:00')).toBe(-300);
      expect(getTimezoneOffsetMinutes(new Date(), '-04:00')).toBe(-240);
      expect(getTimezoneOffsetMinutes(new Date(), '+00:00')).toBe(0);
      expect(getTimezoneOffsetMinutes(new Date(), 'Z')).toBe(0);
      expect(getTimezoneOffsetMinutes(new Date(), 'UTC')).toBe(0);
    });

    it('resolves IANA timezone offsets for Asia/Tokyo and UTC', () => {
      const d = new Date(Date.UTC(2026, 8, 8, 12, 0, 0));
      expect(getTimezoneOffsetMinutes(d, 'UTC')).toBe(0);
      expect(getTimezoneOffsetMinutes(d, 'Asia/Tokyo')).toBe(540);
    });

    it('resolves standard and daylight saving offsets for America/New_York', () => {
      // Winter: EST (UTC-5)
      const winter = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));
      expect(getTimezoneOffsetMinutes(winter, 'America/New_York')).toBe(-300);

      // Summer: EDT (UTC-4)
      const summer = new Date(Date.UTC(2026, 8, 8, 12, 0, 0));
      expect(getTimezoneOffsetMinutes(summer, 'America/New_York')).toBe(-240);
    });

    it('falls back gracefully to local timezone offset on invalid timezone input', () => {
      const d = new Date();
      expect(getTimezoneOffsetMinutes(d, 'invalid-tz-name')).toBe(-d.getTimezoneOffset());
    });
  });

  describe('Day boundary generation (getDayBounds, getStartOfDay, getEndOfDay)', () => {
    it('computes exact ISO UTC boundaries for UTC timezone', () => {
      const bounds = getDayBounds('2026-09-08', 'UTC');
      expect(bounds.startOfDay).toBe('2026-09-08T00:00:00.000Z');
      expect(bounds.endOfDay).toBe('2026-09-08T23:59:59.999Z');

      expect(getStartOfDay('2026-09-08', 'UTC')).toBe('2026-09-08T00:00:00.000Z');
      expect(getEndOfDay('2026-09-08', 'UTC')).toBe('2026-09-08T23:59:59.999Z');
    });

    it('computes exact ISO UTC boundaries for negative offset (America/New_York UTC-5 in winter)', () => {
      // Jan 15 in EST (UTC-5): 00:00:00 EST is 05:00:00 UTC, 23:59:59.999 EST is next day 04:59:59.999 UTC
      const bounds = getDayBounds('2026-01-15', 'America/New_York');
      expect(bounds.startOfDay).toBe('2026-01-15T05:00:00.000Z');
      expect(bounds.endOfDay).toBe('2026-01-16T04:59:59.999Z');

      expect(getStartOfDay('2026-01-15', 'America/New_York')).toBe('2026-01-15T05:00:00.000Z');
      expect(getEndOfDay('2026-01-15', 'America/New_York')).toBe('2026-01-16T04:59:59.999Z');
    });

    it('computes exact ISO UTC boundaries for negative offset (America/New_York UTC-4 in summer)', () => {
      // Sept 8 in EDT (UTC-4): 00:00:00 EDT is 04:00:00 UTC, 23:59:59.999 EDT is next day 03:59:59.999 UTC
      const bounds = getDayBounds('2026-09-08', 'America/New_York');
      expect(bounds.startOfDay).toBe('2026-09-08T04:00:00.000Z');
      expect(bounds.endOfDay).toBe('2026-09-09T03:59:59.999Z');
    });

    it('computes exact ISO UTC boundaries for positive offset (Asia/Tokyo UTC+9)', () => {
      // Sept 8 in JST (UTC+9): 00:00:00 JST is previous day 15:00:00 UTC, 23:59:59.999 JST is 14:59:59.999 UTC
      const bounds = getDayBounds('2026-09-08', 'Asia/Tokyo');
      expect(bounds.startOfDay).toBe('2026-09-07T15:00:00.000Z');
      expect(bounds.endOfDay).toBe('2026-09-08T14:59:59.999Z');

      expect(getStartOfDay('2026-09-08', 'Asia/Tokyo')).toBe('2026-09-07T15:00:00.000Z');
      expect(getEndOfDay('2026-09-08', 'Asia/Tokyo')).toBe('2026-09-08T14:59:59.999Z');
    });

    it('computes exact ISO UTC boundaries for explicit offset strings (-05:00 and +09:00)', () => {
      const nyBounds = getDayBounds('2026-01-15', '-05:00');
      expect(nyBounds.startOfDay).toBe('2026-01-15T05:00:00.000Z');
      expect(nyBounds.endOfDay).toBe('2026-01-16T04:59:59.999Z');

      const tokyoBounds = getDayBounds('2026-09-08', '+09:00');
      expect(tokyoBounds.startOfDay).toBe('2026-09-07T15:00:00.000Z');
      expect(tokyoBounds.endOfDay).toBe('2026-09-08T14:59:59.999Z');
    });

    it('handles Date objects and invalid inputs gracefully', () => {
      const d = new Date(Date.UTC(2026, 8, 8, 12, 0, 0));
      const bounds = getDayBounds(d, 'UTC');
      expect(bounds.startOfDay).toBe('2026-09-08T00:00:00.000Z');
      expect(bounds.endOfDay).toBe('2026-09-08T23:59:59.999Z');

      const emptyBounds = getDayBounds(null, 'UTC');
      expect(emptyBounds.startOfDay).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
    });

    it('resolves current date in specified timezone when dateInput is null or undefined', () => {
      vi.useFakeTimers();
      // Set instant to 21:30:00 UTC on Sept 14 (which is 06:30:00 on Sept 15 in Tokyo)
      vi.setSystemTime(new Date(Date.UTC(2026, 8, 14, 21, 30, 0)));

      // In Tokyo (UTC+9), today is Sept 15
      const tokyoBounds = getDayBounds(null, 'Asia/Tokyo');
      expect(tokyoBounds.startOfDay).toBe('2026-09-14T15:00:00.000Z');
      expect(tokyoBounds.endOfDay).toBe('2026-09-15T14:59:59.999Z');

      // In New York (EDT UTC-4), today is Sept 14
      const nyBounds = getDayBounds(undefined, 'America/New_York');
      expect(nyBounds.startOfDay).toBe('2026-09-14T04:00:00.000Z');
      expect(nyBounds.endOfDay).toBe('2026-09-15T03:59:59.999Z');
    });
  });

  describe('Timezone-aware date normalization (normalizeDateStr with timeZone)', () => {
    it('normalizes UTC timestamps in UTC timezone', () => {
      expect(normalizeDateStr('2026-01-16T04:30:00.000Z', 'UTC')).toBe('2026-01-16');
      expect(normalizeDateStr('2026-09-07T22:00:00.000Z', 'UTC')).toBe('2026-09-07');
    });

    it('normalizes timestamps across negative timezone offset (America/New_York UTC-5)', () => {
      // 04:30 UTC on Jan 16 is 23:30 on Jan 15 EST
      expect(normalizeDateStr('2026-01-16T04:30:00.000Z', 'America/New_York')).toBe('2026-01-15');
      // 05:00:10 UTC on Jan 16 is 00:00:10 on Jan 16 EST
      expect(normalizeDateStr('2026-01-16T05:00:10.000Z', 'America/New_York')).toBe('2026-01-16');
      // Explicit offset string -05:00
      expect(normalizeDateStr('2026-01-16T04:30:00.000Z', '-05:00')).toBe('2026-01-15');
      expect(normalizeDateStr('2026-01-16T05:00:10.000Z', '-05:00')).toBe('2026-01-16');
    });

    it('normalizes timestamps across positive timezone offset (Asia/Tokyo UTC+9)', () => {
      // 22:00 UTC on Sept 7 is 07:00 on Sept 8 JST
      expect(normalizeDateStr('2026-09-07T22:00:00.000Z', 'Asia/Tokyo')).toBe('2026-09-08');
      // 14:59:50 UTC on Sept 7 is 23:59:50 on Sept 7 JST
      expect(normalizeDateStr('2026-09-07T14:59:50.000Z', 'Asia/Tokyo')).toBe('2026-09-07');
      // Explicit offset string +09:00
      expect(normalizeDateStr('2026-09-07T22:00:00.000Z', '+09:00')).toBe('2026-09-08');
    });

    it('leaves plain calendar date strings YYYY-MM-DD unchanged even when timezone is specified', () => {
      expect(normalizeDateStr('2026-01-15', 'America/New_York')).toBe('2026-01-15');
      expect(normalizeDateStr('2026-09-08', 'Asia/Tokyo')).toBe('2026-09-08');
      expect(normalizeDateStr('2026-09-08', 'UTC')).toBe('2026-09-08');
    });
  });

  describe('isWithinDayBounds and midnight boundary attribution across timezones', () => {
    describe('America/New_York (negative offset UTC-5)', () => {
      const tz = 'America/New_York';
      const targetDate = '2026-01-15';

      it('correctly attributes 1 millisecond before midnight to Jan 15', () => {
        // 23:59:59.999 EST = 2026-01-16T04:59:59.999Z
        const eveningLog = '2026-01-16T04:59:59.999Z';
        expect(isWithinDayBounds(eveningLog, targetDate, tz)).toBe(true);
        expect(isWithinDayBounds(eveningLog, '2026-01-16', tz)).toBe(false);
      });

      it('correctly attributes midnight instant to Jan 16, not Jan 15', () => {
        // 00:00:00.000 EST = 2026-01-16T05:00:00.000Z
        const midnightLog = '2026-01-16T05:00:00.000Z';
        expect(isWithinDayBounds(midnightLog, targetDate, tz)).toBe(false);
        expect(isWithinDayBounds(midnightLog, '2026-01-16', tz)).toBe(true);
      });

      it('correctly attributes start-of-day midnight instant to Jan 15', () => {
        // 00:00:00.000 EST on Jan 15 = 2026-01-15T05:00:00.000Z
        const morningLog = '2026-01-15T05:00:00.000Z';
        expect(isWithinDayBounds(morningLog, targetDate, tz)).toBe(true);
        expect(isWithinDayBounds(morningLog, '2026-01-14', tz)).toBe(false);
      });

      it('ensures no log is dropped or double-counted between consecutive days', () => {
        const logs = [
          '2026-01-15T04:59:59.999Z', // 23:59:59.999 Jan 14
          '2026-01-15T05:00:00.000Z', // 00:00:00.000 Jan 15
          '2026-01-15T17:00:00.000Z', // 12:00:00.000 Jan 15
          '2026-01-16T04:59:59.999Z', // 23:59:59.999 Jan 15
          '2026-01-16T05:00:00.000Z', // 00:00:00.000 Jan 16
        ];

        const jan14Count = logs.filter((l) => isWithinDayBounds(l, '2026-01-14', tz)).length;
        const jan15Count = logs.filter((l) => isWithinDayBounds(l, '2026-01-15', tz)).length;
        const jan16Count = logs.filter((l) => isWithinDayBounds(l, '2026-01-16', tz)).length;

        expect(jan14Count).toBe(1);
        expect(jan15Count).toBe(3);
        expect(jan16Count).toBe(1);
        expect(jan14Count + jan15Count + jan16Count).toBe(logs.length);
      });
    });

    describe('Asia/Tokyo (positive offset UTC+9)', () => {
      const tz = 'Asia/Tokyo';
      const targetDate = '2026-09-08';

      it('correctly attributes start-of-day midnight instant to Sept 8', () => {
        // 00:00:00.000 JST on Sept 8 = 2026-09-07T15:00:00.000Z
        const midnightLog = '2026-09-07T15:00:00.000Z';
        expect(isWithinDayBounds(midnightLog, targetDate, tz)).toBe(true);
        expect(isWithinDayBounds(midnightLog, '2026-09-07', tz)).toBe(false);
      });

      it('correctly attributes 1 millisecond before midnight to Sept 7', () => {
        // 23:59:59.999 JST on Sept 7 = 2026-09-07T14:59:59.999Z
        const eveningLog = '2026-09-07T14:59:59.999Z';
        expect(isWithinDayBounds(eveningLog, targetDate, tz)).toBe(false);
        expect(isWithinDayBounds(eveningLog, '2026-09-07', tz)).toBe(true);
      });

      it('correctly attributes end-of-day 23:59:59.999 instant to Sept 8', () => {
        // 23:59:59.999 JST on Sept 8 = 2026-09-08T14:59:59.999Z
        const lateEveningLog = '2026-09-08T14:59:59.999Z';
        expect(isWithinDayBounds(lateEveningLog, targetDate, tz)).toBe(true);
        expect(isWithinDayBounds(lateEveningLog, '2026-09-09', tz)).toBe(false);
      });

      it('ensures no log is dropped or double-counted between consecutive days in Tokyo', () => {
        const logs = [
          '2026-09-07T14:59:59.999Z', // 23:59:59.999 Sept 7
          '2026-09-07T15:00:00.000Z', // 00:00:00.000 Sept 8
          '2026-09-08T03:00:00.000Z', // 12:00:00.000 Sept 8
          '2026-09-08T14:59:59.999Z', // 23:59:59.999 Sept 8
          '2026-09-08T15:00:00.000Z', // 00:00:00.000 Sept 9
        ];

        const sept7Count = logs.filter((l) => isWithinDayBounds(l, '2026-09-07', tz)).length;
        const sept8Count = logs.filter((l) => isWithinDayBounds(l, '2026-09-08', tz)).length;
        const sept9Count = logs.filter((l) => isWithinDayBounds(l, '2026-09-09', tz)).length;

        expect(sept7Count).toBe(1);
        expect(sept8Count).toBe(3);
        expect(sept9Count).toBe(1);
        expect(sept7Count + sept8Count + sept9Count).toBe(logs.length);
      });
    });

    describe('UTC (zero offset)', () => {
      const tz = 'UTC';
      const targetDate = '2026-09-08';

      it('correctly attributes start-of-day and end-of-day instants', () => {
        expect(isWithinDayBounds('2026-09-08T00:00:00.000Z', targetDate, tz)).toBe(true);
        expect(isWithinDayBounds('2026-09-08T23:59:59.999Z', targetDate, tz)).toBe(true);

        expect(isWithinDayBounds('2026-09-07T23:59:59.999Z', targetDate, tz)).toBe(false);
        expect(isWithinDayBounds('2026-09-09T00:00:00.000Z', targetDate, tz)).toBe(false);
      });
    });

    describe('Server query bounds and client rendering consistency', () => {
      it('guarantees rows transferred per day view equal rows rendered across negative, zero, and positive offsets', () => {
        const timezones = ['UTC', 'America/New_York', 'Asia/Tokyo'];
        const testDate = '2026-01-15';

        timezones.forEach((tz) => {
          const { startOfDay, endOfDay } = getDayBounds(testDate, tz);
          const startMs = new Date(startOfDay).getTime();
          const endMs = new Date(endOfDay).getTime();

          // Simulate database rows spanning across the day and neighboring days
          const simulatedDbRows = [
            { id: '1', logged_at: new Date(startMs - 1000).toISOString() }, // Prior day
            { id: '2', logged_at: startOfDay }, // Exact start of day
            { id: '3', logged_at: new Date(startMs + 3600000).toISOString() }, // Morning
            { id: '4', logged_at: new Date((startMs + endMs) / 2).toISOString() }, // Midday
            { id: '5', logged_at: new Date(endMs - 3600000).toISOString() }, // Evening
            { id: '6', logged_at: endOfDay }, // Exact end of day
            { id: '7', logged_at: new Date(endMs + 1000).toISOString() }, // Next day
          ];

          // Server query filters with gte(startOfDay) and lte(endOfDay)
          const rowsTransferred = simulatedDbRows.filter(
            (row) => row.logged_at >= startOfDay && row.logged_at <= endOfDay
          );

          // Client rendering filters with authoritative isWithinDayBounds
          const rowsRendered = rowsTransferred.filter((row) =>
            isWithinDayBounds(row.logged_at, testDate, tz)
          );

          // Verification: rows transferred per day view MUST strictly equal rows rendered
          expect(rowsTransferred.length).toBe(5);
          expect(rowsRendered.length).toBe(rowsTransferred.length);
          expect(rowsRendered.map((r) => r.id)).toEqual(['2', '3', '4', '5', '6']);
        });
      });

      describe('Strict midnight boundary non-leakage without string-prefix fallback', () => {
        it('does not leak previous day evening meals into next day despite matching ISO string date prefix', () => {
          // In America/New_York (EDT UTC-4):
          // 2026-09-08T03:00:00.000Z has date prefix "2026-09-08" in UTC string,
          // but local time is Sept 7 at 23:00:00 EDT (prior day!)
          const sept7EveningMeal = '2026-09-08T03:00:00.000Z';
          expect(isWithinDayBounds(sept7EveningMeal, '2026-09-07', 'America/New_York')).toBe(true);
          expect(isWithinDayBounds(sept7EveningMeal, '2026-09-08', 'America/New_York')).toBe(false);
        });

        it('does not leak next day morning meals into previous day despite matching ISO string date prefix', () => {
          // In Asia/Tokyo (JST UTC+9):
          // 2026-09-08T23:00:00.000Z has date prefix "2026-09-08" in UTC string,
          // but local time is Sept 9 at 08:00:00 JST (next day breakfast!)
          const sept9Breakfast = '2026-09-08T23:00:00.000Z';
          expect(isWithinDayBounds(sept9Breakfast, '2026-09-08', 'Asia/Tokyo')).toBe(false);
          expect(isWithinDayBounds(sept9Breakfast, '2026-09-09', 'Asia/Tokyo')).toBe(true);
        });

        it('guarantees zero double-counting for all meals across consecutive days in positive and negative offsets', () => {
          const nyTz = 'America/New_York';
          const tokyoTz = 'Asia/Tokyo';

          // Boundary timestamps for New York
          const nyLogs = [
            '2026-09-08T03:59:59.999Z', // 23:59:59.999 Sept 7 EDT
            '2026-09-08T04:00:00.000Z', // 00:00:00.000 Sept 8 EDT
            '2026-09-09T03:59:59.999Z', // 23:59:59.999 Sept 8 EDT
            '2026-09-09T04:00:00.000Z', // 00:00:00.000 Sept 9 EDT
          ];

          nyLogs.forEach((log) => {
            const inSept7 = isWithinDayBounds(log, '2026-09-07', nyTz);
            const inSept8 = isWithinDayBounds(log, '2026-09-08', nyTz);
            const inSept9 = isWithinDayBounds(log, '2026-09-09', nyTz);
            expect(Number(inSept7) + Number(inSept8) + Number(inSept9)).toBe(1);
          });

          // Boundary timestamps for Tokyo
          const tokyoLogs = [
            '2026-09-08T14:59:59.999Z', // 23:59:59.999 Sept 8 JST
            '2026-09-08T15:00:00.000Z', // 00:00:00.000 Sept 9 JST
            '2026-09-09T14:59:59.999Z', // 23:59:59.999 Sept 9 JST
            '2026-09-09T15:00:00.000Z', // 00:00:00.000 Sept 10 JST
          ];

          tokyoLogs.forEach((log) => {
            const inSept8 = isWithinDayBounds(log, '2026-09-08', tokyoTz);
            const inSept9 = isWithinDayBounds(log, '2026-09-09', tokyoTz);
            const inSept10 = isWithinDayBounds(log, '2026-09-10', tokyoTz);
            expect(Number(inSept8) + Number(inSept9) + Number(inSept10)).toBe(1);
          });
        });
      });
    });

    describe('Multi-Timezone 24-Hour Sweep and DST Transition Calculations', () => {
      describe('24 hourly timestamps sweep across UTC, NY, Tokyo, Lord Howe, and London', () => {
        const timezones = [
          { tz: 'UTC', label: 'UTC' },
          { tz: 'America/New_York', label: 'America/New_York (UTC-4 summer EDT)' },
          { tz: 'Asia/Tokyo', label: 'Asia/Tokyo (UTC+9 JST)' },
          { tz: 'Australia/Lord_Howe', label: 'Australia/Lord_Howe (UTC+10:30 winter LHST)' },
          { tz: 'Europe/London', label: 'Europe/London (UTC+1 summer BST)' },
        ];
        const sweepDate = '2026-07-04';

        timezones.forEach(({ tz, label }) => {
          it(`keeps 24/24 hourly meals and leaks 0 across boundary for ${label}`, () => {
            const bounds = getDayBounds(sweepDate, tz);
            const startMs = new Date(bounds.startOfDay).getTime();
            const endMs = new Date(bounds.endOfDay).getTime();

            // Total civil duration for standard 24-hour day
            expect(endMs - startMs + 1).toBe(24 * 3600000);

            // Generate 24 hourly timestamps at local XX:30:00
            const hourlyTimestamps: string[] = [];
            for (let h = 0; h < 24; h++) {
              const utcMs = localCivilToUtcMs(2026, 7, 4, h, 30, 0, 0, tz);
              hourlyTimestamps.push(new Date(utcMs).toISOString());
            }

            // Verify ALL 24 hourly timestamps fall within day bounds
            const insideCount = hourlyTimestamps.filter((ts) => isWithinDayBounds(ts, sweepDate, tz)).length;
            expect(insideCount).toBe(24);

            // Boundary checks: exact start and end are inside
            expect(isWithinDayBounds(bounds.startOfDay, sweepDate, tz)).toBe(true);
            expect(isWithinDayBounds(bounds.endOfDay, sweepDate, tz)).toBe(true);

            // Negative controls: previous day 23:30 and next day 00:30 do NOT leak
            const prevDayMeal = new Date(localCivilToUtcMs(2026, 7, 3, 23, 30, 0, 0, tz)).toISOString();
            const nextDayMeal = new Date(localCivilToUtcMs(2026, 7, 5, 0, 30, 0, 0, tz)).toISOString();
            expect(isWithinDayBounds(prevDayMeal, sweepDate, tz)).toBe(false);
            expect(isWithinDayBounds(nextDayMeal, sweepDate, tz)).toBe(false);

            // Immediate 1ms outside bounds do not leak
            const msBeforeStart = new Date(startMs - 1).toISOString();
            const msAfterEnd = new Date(endMs + 1).toISOString();
            expect(isWithinDayBounds(msBeforeStart, sweepDate, tz)).toBe(false);
            expect(isWithinDayBounds(msAfterEnd, sweepDate, tz)).toBe(false);
          });
        });
      });

      describe('America/New_York DST transitions (23-hour spring forward and 25-hour fall back)', () => {
        it('calculates exact bounds and keeps all hours for Spring Forward (2026-03-08, 23h day)', () => {
          const tz = 'America/New_York';
          const targetDate = '2026-03-08';
          const bounds = getDayBounds(targetDate, tz);

          // 00:00:00.000 EST = 05:00:00.000 UTC
          expect(bounds.startOfDay).toBe('2026-03-08T05:00:00.000Z');
          // 23:59:59.999 EDT = 03:59:59.999 UTC next day
          expect(bounds.endOfDay).toBe('2026-03-09T03:59:59.999Z');

          // Exactly 23 hours in day
          const durationMs = new Date(bounds.endOfDay).getTime() - new Date(bounds.startOfDay).getTime() + 1;
          expect(durationMs).toBe(23 * 3600000);

          // Test all 23 valid local hours: 0, 1, 3..23 (hour 2 does not exist due to 2am->3am skip)
          const validHours = [0, 1, ...Array.from({ length: 21 }, (_, i) => i + 3)];
          expect(validHours.length).toBe(23);

          validHours.forEach((h) => {
            const ts = new Date(localCivilToUtcMs(2026, 3, 8, h, 30, 0, 0, tz)).toISOString();
            expect(isWithinDayBounds(ts, targetDate, tz)).toBe(true);
          });

          // Negative control: Previous day 23:30:00 EST (2026-03-08T04:30:00.000Z) MUST NOT leak into March 8
          const prevDayLateMeal = '2026-03-08T04:30:00.000Z';
          expect(isWithinDayBounds(prevDayLateMeal, targetDate, tz)).toBe(false);

          // Negative control: Next day 00:30:00 EDT (2026-03-09T04:30:00.000Z) MUST NOT leak into March 8
          const nextDayEarlyMeal = '2026-03-09T04:30:00.000Z';
          expect(isWithinDayBounds(nextDayEarlyMeal, targetDate, tz)).toBe(false);
        });

        it('calculates exact bounds and retains first hour for Fall Back (2026-11-01, 25h day)', () => {
          const tz = 'America/New_York';
          const targetDate = '2026-11-01';
          const bounds = getDayBounds(targetDate, tz);

          // 00:00:00.000 EDT = 04:00:00.000 UTC
          expect(bounds.startOfDay).toBe('2026-11-01T04:00:00.000Z');
          // 23:59:59.999 EST = 04:59:59.999 UTC next day
          expect(bounds.endOfDay).toBe('2026-11-02T04:59:59.999Z');

          // Exactly 25 hours in day
          const durationMs = new Date(bounds.endOfDay).getTime() - new Date(bounds.startOfDay).getTime() + 1;
          expect(durationMs).toBe(25 * 3600000);

          // Crucial bug fix check: first hour meal (00:30 EDT = 04:30 UTC) was dropped by old logic
          const firstHourMeal = '2026-11-01T04:30:00.000Z';
          expect(isWithinDayBounds(firstHourMeal, targetDate, tz)).toBe(true);

          // Repeated hour: 01:30 EDT (05:30 UTC) and 01:30 EST (06:30 UTC) both fall within day
          const repeatedEdTHour = '2026-11-01T05:30:00.000Z';
          const repeatedEstHour = '2026-11-01T06:30:00.000Z';
          expect(isWithinDayBounds(repeatedEdTHour, targetDate, tz)).toBe(true);
          expect(isWithinDayBounds(repeatedEstHour, targetDate, tz)).toBe(true);

          // Generate all 25 hourly timestamps across the 25-hour day
          const startMs = new Date(bounds.startOfDay).getTime();
          for (let h = 0; h < 25; h++) {
            const sampleTs = new Date(startMs + h * 3600000 + 1800000).toISOString();
            expect(isWithinDayBounds(sampleTs, targetDate, tz)).toBe(true);
          }

          // Negative control: Previous day 23:30:00 EDT (2026-11-01T03:30:00.000Z) MUST NOT leak into Nov 1
          const prevDayLateMeal = '2026-11-01T03:30:00.000Z';
          expect(isWithinDayBounds(prevDayLateMeal, targetDate, tz)).toBe(false);

          // Negative control: Next day 00:30:00 EST (2026-11-02T05:30:00.000Z) MUST NOT leak into Nov 1
          const nextDayEarlyMeal = '2026-11-02T05:30:00.000Z';
          expect(isWithinDayBounds(nextDayEarlyMeal, targetDate, tz)).toBe(false);
        });
      });

      describe('Europe/London DST transitions (23-hour spring forward and 25-hour fall back)', () => {
        const tz = 'Europe/London';

        it('handles London Spring Forward (2026-03-29, 23h day)', () => {
          const bounds = getDayBounds('2026-03-29', tz);
          // 00:00:00 GMT = 00:00:00 UTC
          expect(bounds.startOfDay).toBe('2026-03-29T00:00:00.000Z');
          // 23:59:59.999 BST = 22:59:59.999 UTC
          expect(bounds.endOfDay).toBe('2026-03-29T22:59:59.999Z');

          const durationMs = new Date(bounds.endOfDay).getTime() - new Date(bounds.startOfDay).getTime() + 1;
          expect(durationMs).toBe(23 * 3600000);

          // All 23 valid hours
          const validHours = [0, ...Array.from({ length: 22 }, (_, i) => i + 2)];
          validHours.forEach((h) => {
            const ts = new Date(localCivilToUtcMs(2026, 3, 29, h, 30, 0, 0, tz)).toISOString();
            expect(isWithinDayBounds(ts, '2026-03-29', tz)).toBe(true);
          });
        });

        it('handles London Fall Back (2026-10-25, 25h day)', () => {
          const bounds = getDayBounds('2026-10-25', tz);
          // 00:00:00 BST = 23:00:00 UTC previous day
          expect(bounds.startOfDay).toBe('2026-10-24T23:00:00.000Z');
          // 23:59:59.999 GMT = 23:59:59.999 UTC
          expect(bounds.endOfDay).toBe('2026-10-25T23:59:59.999Z');

          const durationMs = new Date(bounds.endOfDay).getTime() - new Date(bounds.startOfDay).getTime() + 1;
          expect(durationMs).toBe(25 * 3600000);

          const startMs = new Date(bounds.startOfDay).getTime();
          for (let h = 0; h < 25; h++) {
            const sampleTs = new Date(startMs + h * 3600000 + 1800000).toISOString();
            expect(isWithinDayBounds(sampleTs, '2026-10-25', tz)).toBe(true);
          }
        });
      });

      describe('Australia/Lord_Howe fractional offset and 30-min DST transition', () => {
        const tz = 'Australia/Lord_Howe';

        it('computes exact bounds for standard winter day with +10:30 fractional offset', () => {
          const bounds = getDayBounds('2026-07-04', tz);
          // 00:00:00 LHST (UTC+10:30) = 13:30:00 UTC previous day
          expect(bounds.startOfDay).toBe('2026-07-03T13:30:00.000Z');
          // 23:59:59.999 LHST = 13:29:59.999 UTC
          expect(bounds.endOfDay).toBe('2026-07-04T13:29:59.999Z');
        });

        it('computes exact bounds for 30-minute Spring Forward transition (2026-10-04, 23.5h day)', () => {
          const bounds = getDayBounds('2026-10-04', tz);
          // 00:00:00 LHST (UTC+10:30) = 13:30:00 UTC previous day
          expect(bounds.startOfDay).toBe('2026-10-03T13:30:00.000Z');
          // 23:59:59.999 LHDT (UTC+11:00) = 12:59:59.999 UTC
          expect(bounds.endOfDay).toBe('2026-10-04T12:59:59.999Z');

          // 23.5 hours
          const durationMs = new Date(bounds.endOfDay).getTime() - new Date(bounds.startOfDay).getTime() + 1;
          expect(durationMs).toBe(23.5 * 3600000);
        });
      });
    });
  });


  describe("Civil date helpers", () => {
    it("isCivilDate correctly validates YYYY-MM-DD format", () => {
      expect(isCivilDate("2026-09-15")).toBe(true);
      expect(isCivilDate("2026-01-01")).toBe(true);
      expect(isCivilDate("2026-09-15T00:00:00.000Z")).toBe(false);
      expect(isCivilDate("Sep 15")).toBe(false);
      expect(isCivilDate("")).toBe(false);
    });

    it("formatCivilDate formats YYYY-MM-DD directly without timezone shifts (acceptance)", () => {
      expect(formatCivilDate("2026-09-15")).toBe("Sep 15");
      expect(formatCivilDate("2026-01-01")).toBe("Jan 1");
      expect(formatCivilDate("2026-12-31")).toBe("Dec 31");
    });

    it("formatCivilDate falls back to formatShortDate for ISO timestamps", () => {
      expect(formatCivilDate("2026-09-15T12:00:00.000Z")).toBe("Sep 15");
    });
  });

  describe("ghostSets date re-exports identity", () => {
    it("re-exports pure date helpers with identical references from ghostSets", async () => {
      const ghostSets = await import("./ghostSets");
      const dateModule = await import("./date");
      expect(ghostSets.getLocalDateStr).toBe(dateModule.getLocalDateStr);
      expect(ghostSets.normalizeDateStr).toBe(dateModule.normalizeDateStr);
      expect(ghostSets.getDayOfWeekAbbr).toBe(dateModule.getDayOfWeekAbbr);
      expect(ghostSets.formatShortDate).toBe(dateModule.formatShortDate);
      expect(ghostSets.formatLocalTimestamp).toBe(dateModule.formatLocalTimestamp);
    });
  });
});
