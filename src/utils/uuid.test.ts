import { describe, it, expect } from 'vitest';
import * as newUuidModule from './uuid';
import * as oldWorkoutEngineHelpers from '../components/workout/workoutEngineHelpers';

describe('UUID Utilities (src/utils/uuid.ts)', () => {
  describe('Re-export reference identity', () => {
    it('re-exports identical function and regex references from workoutEngineHelpers', () => {
      expect(oldWorkoutEngineHelpers.isValidUUID).toBe(newUuidModule.isValidUUID);
      expect(oldWorkoutEngineHelpers.isUUID).toBe(newUuidModule.isUUID);
      expect(oldWorkoutEngineHelpers.UUID_REGEX).toBe(newUuidModule.UUID_REGEX);
    });
  });

  describe('isValidUUID / isUUID behaviour', () => {
    it('returns true for valid standard RFC 4122 UUIDs', () => {
      const valid = [
        '00000000-0000-4000-8000-000000000001',
        'a540a224-10c4-4116-bb8f-45b2def0f2ac',
        'cff134bc-62a0-4196-9f6e-c6a1f864c6d4',
        '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
        'A540A224-10C4-4116-BB8F-45B2DEF0F2AC',
      ];
      for (const id of valid) {
        expect(newUuidModule.isValidUUID(id)).toBe(true);
        expect(newUuidModule.isUUID(id)).toBe(true);
      }
    });

    it('returns false for invalid UUID strings and non-UUID values', () => {
      const invalidStrings = [
        'not-a-uuid',
        'test-user-id',
        '',
        '123e4567-e89b-12d3-a456-42661417400', // short
        '00000000-0000-4000-8000-000000000001,is_master.eq.true',
        '00000000-0000-4000-8000-000000000001),role.eq.admin',
        "00000000-0000-4000-8000-000000000001' OR '1'='1",
        '00000000-0000-4000-8000-000000000001.user_id.neq.null',
        "x' or is_master.eq.true--",
      ];
      for (const val of invalidStrings) {
        expect(newUuidModule.isValidUUID(val)).toBe(false);
        expect(newUuidModule.isUUID(val)).toBe(false);
      }
    });

    it('returns false for non-string types safely', () => {
      expect(newUuidModule.isValidUUID(null)).toBe(false);
      expect(newUuidModule.isValidUUID(undefined)).toBe(false);
      expect(newUuidModule.isValidUUID(12345)).toBe(false);
      expect(newUuidModule.isValidUUID({})).toBe(false);
      expect(newUuidModule.isValidUUID([])).toBe(false);
      expect(newUuidModule.isValidUUID(true)).toBe(false);
    });
  });
});
