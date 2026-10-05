import { describe, it, expect, vi, afterEach } from 'vitest';
import { nutritionDayKey } from './nutritionDayKey';
import { normalizeDateStr } from './date';

describe('nutritionDayKey (src/utils/nutritionDayKey.ts)', () => {
  // The device-zone test below stubs Intl.DateTimeFormat; restore it so the stub cannot
  // leak into the edge-case tests that follow (or into normalizeDateStr's internals).
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('stamped rows (logged_date set)', () => {
    it('returns immutable civil logged_date regardless of timeZone, even for travelled rows', () => {
      // Meal logged at 21:00 EDT on 2026-09-21 in New York (= 2026-09-22T01:00:00Z UTC).
      // When athlete or viewer travels to Tokyo (UTC+9), that instant is 10:00 on 2026-09-22.
      // The authoritative civil diary date remains 2026-09-21 across all zones.
      const travelledRow = {
        logged_date: '2026-09-21',
        logged_at: '2026-09-22T01:00:00Z',
      };

      const zones = [
        'America/New_York',
        'Asia/Tokyo',
        'UTC',
        'Pacific/Kiritimati',
        'America/Los_Angeles',
      ];

      for (const tz of zones) {
        expect(nutritionDayKey(travelledRow, tz)).toBe('2026-09-21');
      }
    });

    it('returns logged_date when timeZone is omitted', () => {
      const stampedRow = {
        logged_date: '2026-07-04',
        logged_at: '2026-07-05T03:00:00Z',
      };

      expect(nutritionDayKey(stampedRow)).toBe('2026-07-04');
    });
  });

  describe('legacy rows (logged_date null or undefined)', () => {
    it('falls back to converting logged_at to calendar day in the specified timeZone', () => {
      // 2026-09-22T02:00:00Z
      // In America/Los_Angeles (PDT, UTC-7): 2026-09-21 19:00 -> 2026-09-21
      // In Asia/Tokyo (JST, UTC+9): 2026-09-22 11:00 -> 2026-09-22
      // In UTC: 2026-09-22 02:00 -> 2026-09-22
      const legacyNull = {
        logged_date: null,
        logged_at: '2026-09-22T02:00:00Z',
      };
      const legacyUndefined = {
        logged_at: '2026-09-22T02:00:00Z',
      };

      expect(nutritionDayKey(legacyNull, 'America/Los_Angeles')).toBe('2026-09-21');
      expect(nutritionDayKey(legacyUndefined, 'America/Los_Angeles')).toBe('2026-09-21');

      expect(nutritionDayKey(legacyNull, 'Asia/Tokyo')).toBe('2026-09-22');
      expect(nutritionDayKey(legacyUndefined, 'Asia/Tokyo')).toBe('2026-09-22');

      expect(nutritionDayKey(legacyNull, 'UTC')).toBe('2026-09-22');
      expect(nutritionDayKey(legacyUndefined, 'UTC')).toBe('2026-09-22');
    });

    it('falls back to runtime resolved timezone when timeZone is omitted', () => {
      const systemZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const legacyRow = {
        logged_date: null,
        logged_at: '2026-09-22T02:00:00Z',
      };

      const expected = normalizeDateStr(legacyRow.logged_at, systemZone);
      expect(nutritionDayKey(legacyRow)).toBe(expected);
      expect(nutritionDayKey(legacyRow, undefined)).toBe(expected);
    });

    it('PRODUCTION PATH: with timeZone omitted, buckets by the DEVICE zone, not the raw UTC prefix', () => {
      // This is the path that actually runs in the app: NutritionEngine never passes a
      // timeZone to useNutritionData, so it is always undefined there. The previous
      // implementation called normalizeDateStr(logged_at) with no zone, which returns the
      // raw UTC date prefix -- disagreeing with History/Coach, who resolve the device zone.
      //
      // The test above cannot catch that regression: it derives its expectation from the
      // same system zone, so on a UTC CI runner old and new behaviour are identical.
      // Stub the zero-arg Intl call to pin a non-UTC device zone and make the difference
      // observable on any runner. Calls WITH arguments still hit the real implementation,
      // which normalizeDateStr depends on internally for offset computation.
      const RealDateTimeFormat = Intl.DateTimeFormat;
      vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(((...args: unknown[]) => {
        if (args.length === 0) {
          return { resolvedOptions: () => ({ timeZone: 'Asia/Tokyo' }) };
        }
        return new (RealDateTimeFormat as unknown as new (
          ...a: unknown[]
        ) => Intl.DateTimeFormat)(...args);
      }) as unknown as typeof Intl.DateTimeFormat);

      // 2026-09-21T16:00:00Z is 2026-09-22 01:00 in Tokyo (UTC+9).
      // Device-zone bucketing -> 2026-09-22. Raw UTC prefix -> 2026-09-21.
      const legacyRow = { logged_date: null, logged_at: '2026-09-21T16:00:00Z' };

      expect(nutritionDayKey(legacyRow)).toBe('2026-09-22');
      expect(nutritionDayKey(legacyRow)).not.toBe('2026-09-21');
    });
  });

  describe('fallback semantics & edge cases', () => {
    it('preserves || fallback semantics when logged_date is empty string', () => {
      // Under || semantics, '' is falsy and falls back to normalizeDateStr
      const emptyDateRow = {
        logged_date: '',
        logged_at: '2026-09-22T12:00:00Z',
      };

      expect(nutritionDayKey(emptyDateRow, 'UTC')).toBe('2026-09-22');
    });

    it('handles missing logged_at gracefully when logged_date is null', () => {
      const incompleteRow = {
        logged_date: null,
        logged_at: undefined,
      };

      expect(nutritionDayKey(incompleteRow, 'UTC')).toBe('');
    });
  });
});
