import { describe, it, expect } from 'vitest';
import { MIN_PASSWORD_LENGTH } from './auth';

describe('auth constants', () => {
  it('defines MIN_PASSWORD_LENGTH matching supabase auth configuration', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(6);
    expect(typeof MIN_PASSWORD_LENGTH).toBe('number');
  });
});
