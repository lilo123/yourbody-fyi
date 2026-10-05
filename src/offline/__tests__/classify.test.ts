import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { classifyError } from '../classify';

describe('Error Classification Matrix (§A4)', () => {
  const originalOnLine = navigator.onLine;

  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      writable: true,
      value: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      writable: true,
      value: originalOnLine,
    });
  });

  describe('TRANSIENT errors', () => {
    it('classifies navigator.onLine === false as TRANSIENT', () => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, writable: true, value: false });
      const res = classifyError(new Error('Any error while offline'));
      expect(res.kind).toBe('TRANSIENT');
      expect(res.reason).toBe('Device is offline');
    });

    it('classifies TypeError (fetch failure) as TRANSIENT', () => {
      const res = classifyError(new TypeError('Failed to fetch'));
      expect(res.kind).toBe('TRANSIENT');
    });

    it('classifies HTTP 408 Request Timeout as TRANSIENT', () => {
      const res = classifyError({ status: 408, message: 'Request Timeout' });
      expect(res.kind).toBe('TRANSIENT');
    });

    it('classifies HTTP 429 Rate Limit as TRANSIENT', () => {
      const res = classifyError({ status: 429, message: 'Too Many Requests' });
      expect(res.kind).toBe('TRANSIENT');
    });

    it('classifies 5xx Server Errors (500, 502, 503, 504) as TRANSIENT', () => {
      for (const status of [500, 502, 503, 504]) {
        const res = classifyError({ status, message: 'Server down' });
        expect(res.kind).toBe('TRANSIENT');
      }
    });

    it('classifies PGRST statement timeout (57014) as TRANSIENT', () => {
      const res = classifyError({
        code: '57014',
        message: 'canceling statement due to statement timeout',
      });
      expect(res.kind).toBe('TRANSIENT');
    });
  });

  describe('AUTH errors', () => {
    it('classifies HTTP 401 as AUTH (refreshable)', () => {
      const res = classifyError({ status: 401, message: 'Unauthorized' });
      expect(res.kind).toBe('AUTH');
      expect(res.isInvalidRefreshToken).toBeFalsy();
    });

    it('classifies "JWT expired" message as AUTH (refreshable)', () => {
      const res = classifyError({ message: 'JWT expired' });
      expect(res.kind).toBe('AUTH');
      expect(res.isInvalidRefreshToken).toBeFalsy();
    });

    it('classifies invalid refresh token as AUTH with isInvalidRefreshToken: true', () => {
      const res1 = classifyError({
        status: 400,
        message: 'Invalid Refresh Token: Refresh Token Not Found',
      });
      expect(res1.kind).toBe('AUTH');
      expect(res1.isInvalidRefreshToken).toBe(true);

      const res2 = classifyError({
        code: 'refresh_token_not_found',
        message: 'Invalid refresh token',
      });
      expect(res2.kind).toBe('AUTH');
      expect(res2.isInvalidRefreshToken).toBe(true);
    });
  });

  describe('PERMANENT errors', () => {
    it('classifies Postgres 23503 (FK violation e.g. exercise deleted) as PERMANENT', () => {
      const res = classifyError({
        code: '23503',
        message: 'insert or update on table "sets" violates foreign key constraint "sets_exercise_id_fkey"',
      });
      expect(res.kind).toBe('PERMANENT');
      expect(res.code).toBe('23503');
    });

    it('classifies Postgres 23514 (check constraint violation) as PERMANENT', () => {
      const res = classifyError({
        code: '23514',
        message: 'new row for relation "sets" violates check constraint "sets_reps_check"',
      });
      expect(res.kind).toBe('PERMANENT');
      expect(res.code).toBe('23514');

      const nutritionRes = classifyError({
        code: '23514',
        message: 'new row for relation "nutrition_logs" violates check constraint "chk_nl_parent_equals_items_sum"',
      });
      expect(nutritionRes.kind).toBe('PERMANENT');
      expect(nutritionRes.code).toBe('23514');
    });

    it('classifies Postgres 22P02 (invalid UUID or text representation) as PERMANENT', () => {
      const res = classifyError({
        code: '22P02',
        message: 'invalid input syntax for type uuid',
      });
      expect(res.kind).toBe('PERMANENT');
      expect(res.code).toBe('22P02');
    });

    it('classifies Postgres 42501 (RLS violation) as PERMANENT', () => {
      const res = classifyError({
        code: '42501',
        message: 'new row violates row-level security policy for table "sets"',
      });
      expect(res.kind).toBe('PERMANENT');
      expect(res.code).toBe('42501');
    });

    it('classifies unexpected 23505 (unique violation) as PERMANENT', () => {
      const res = classifyError({
        code: '23505',
        message: 'duplicate key value violates unique constraint',
      });
      expect(res.kind).toBe('PERMANENT');
    });

    it('classifies pre-image conflict "deleted elsewhere" as PERMANENT', () => {
      const res = classifyError(new Error('deleted elsewhere'));
      expect(res.kind).toBe('PERMANENT');
      expect(res.reason).toBe('deleted elsewhere');
    });

    it('classifies pre-image conflict "changed elsewhere" as PERMANENT', () => {
      const res = classifyError(new Error('changed elsewhere'));
      expect(res.kind).toBe('PERMANENT');
      expect(res.reason).toBe('changed elsewhere');
    });

    it('classifies general 4xx client errors (e.g. 422 Unprocessable) as PERMANENT', () => {
      const res = classifyError({ status: 422, message: 'Unprocessable Entity' });
      expect(res.kind).toBe('PERMANENT');
    });
  });
});
