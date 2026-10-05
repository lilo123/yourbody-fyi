import { describe, it, expect, beforeEach, vi } from 'vitest';
import { dedupeInFlight, getInFlightCount, clearInFlight } from './promiseDedupe';

describe('promiseDedupe - In-Flight Deduplication (F-15)', () => {
  beforeEach(() => {
    clearInFlight();
  });

  it('executes factory only once when multiple concurrent callers request the same key', async () => {
    const factory = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { data: 'profile-payload' };
    });

    const call1 = dedupeInFlight('profile:user123', factory);
    const call2 = dedupeInFlight('profile:user123', factory);
    const call3 = dedupeInFlight('profile:user123', factory);

    expect(getInFlightCount()).toBe(1);
    expect(factory).toHaveBeenCalledTimes(1);

    const [res1, res2, res3] = await Promise.all([call1, call2, call3]);

    expect(res1).toEqual({ data: 'profile-payload' });
    expect(res2).toEqual({ data: 'profile-payload' });
    expect(res3).toEqual({ data: 'profile-payload' });
    expect(factory).toHaveBeenCalledTimes(1);

    // After completion, the in-flight entry must be cleared
    expect(getInFlightCount()).toBe(0);
  });

  it('executes fresh factory invocation after prior promise has settled (staleness preservation)', async () => {
    const factory = vi.fn().mockImplementation(async () => {
      return { data: 'run-' + factory.mock.calls.length };
    });

    const res1 = await dedupeInFlight('profile:user123', factory);
    expect(res1).toEqual({ data: 'run-1' });
    expect(factory).toHaveBeenCalledTimes(1);

    // Second call after completion
    const res2 = await dedupeInFlight('profile:user123', factory);
    expect(res2).toEqual({ data: 'run-2' });
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('handles distinct keys concurrently without interference', async () => {
    const factoryA = vi.fn().mockResolvedValue('user-A');
    const factoryB = vi.fn().mockResolvedValue('user-B');

    const [resA, resB] = await Promise.all([
      dedupeInFlight('profile:userA', factoryA),
      dedupeInFlight('profile:userB', factoryB),
    ]);

    expect(resA).toBe('user-A');
    expect(resB).toBe('user-B');
    expect(factoryA).toHaveBeenCalledTimes(1);
    expect(factoryB).toHaveBeenCalledTimes(1);
  });

  it('propagates errors to all concurrent callers and clears in-flight entry upon rejection', async () => {
    const factory = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      throw new Error('Network error');
    });

    const call1 = dedupeInFlight('profile:failingUser', factory);
    const call2 = dedupeInFlight('profile:failingUser', factory);

    await expect(call1).rejects.toThrow('Network error');
    await expect(call2).rejects.toThrow('Network error');
    expect(factory).toHaveBeenCalledTimes(1);
    expect(getInFlightCount()).toBe(0);

    // Retry succeeds if subsequent call succeeds
    const retryFactory = vi.fn().mockResolvedValue('recovered');
    const retryRes = await dedupeInFlight('profile:failingUser', retryFactory);
    expect(retryRes).toBe('recovered');
    expect(retryFactory).toHaveBeenCalledTimes(1);
  });
});
