import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { SyncToastBridge } from './SyncToastBridge';
import { onSynced } from '../../offline';
import { useToast } from '../../hooks/useToast';

vi.mock('../../offline', () => ({
  onSynced: vi.fn(),
}));

vi.mock('../../hooks/useToast', () => ({
  useToast: vi.fn(),
}));

describe('SyncToastBridge', () => {
  let mockShow: ReturnType<typeof vi.fn>;
  let syncCallback: ((count: number) => void) | null = null;
  let mockUnsubscribe: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    mockShow = vi.fn();
    mockUnsubscribe = vi.fn();

    vi.mocked(useToast).mockReturnValue({
      show: mockShow,
    } as any);

    vi.mocked(onSynced).mockImplementation((cb: (count: number) => void) => {
      syncCallback = cb;
      return () => {
        mockUnsubscribe();
      };
    });
  });

  it('subscribes to onSynced on mount and unregisters on unmount', () => {
    const { unmount } = render(<SyncToastBridge />);
    expect(onSynced).toHaveBeenCalledTimes(1);
    expect(syncCallback).toBeDefined();

    unmount();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('fires toast "Synced 1 change" when 1 item synced', () => {
    render(<SyncToastBridge />);
    expect(syncCallback).toBeDefined();

    syncCallback!(1);
    expect(mockShow).toHaveBeenCalledWith({
      message: 'Synced 1 change',
      kind: 'success',
    });
  });

  it('fires toast "Synced N changes" when multiple items synced', () => {
    render(<SyncToastBridge />);
    expect(syncCallback).toBeDefined();

    syncCallback!(4);
    expect(mockShow).toHaveBeenCalledWith({
      message: 'Synced 4 changes',
      kind: 'success',
    });
  });

  it('does not fire toast when 0 items synced', () => {
    render(<SyncToastBridge />);
    expect(syncCallback).toBeDefined();

    syncCallback!(0);
    expect(mockShow).not.toHaveBeenCalled();
  });
});
