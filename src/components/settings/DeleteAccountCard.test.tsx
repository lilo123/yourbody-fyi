import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DeleteAccountCard } from './DeleteAccountCard';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import * as wipeModule from '../../utils/wipeUserData';
import * as dataExportUtils from '../../utils/dataExport';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../hooks/useFeatureFlag');
vi.mock('../../hooks/useOnlineStatus');
vi.mock('../../hooks/useAuth');
vi.mock('../../lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(),
    },
  },
}));

describe('DeleteAccountCard', () => {
  let queryClient: QueryClient;
  const mockSignOut = vi.fn();
  const mockUser = { id: 'test-user-id', email: 'user@example.com' };
  const mockProfile = { id: 'test-user-id', username: 'TestUser', email: 'user@example.com' };

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    vi.mocked(useOnlineStatus).mockReturnValue(true);
    vi.mocked(useFeatureFlag).mockReturnValue(true);
    vi.mocked(useAuth).mockReturnValue({
      user: mockUser as any,
      profile: mockProfile as any,
      isCoachMode: false,
      signOut: mockSignOut,
    } as any);

    vi.spyOn(wipeModule, 'wipeUserData').mockResolvedValue();
    vi.spyOn(dataExportUtils, 'executeDataExport').mockResolvedValue([]);
    vi.spyOn(dataExportUtils, 'downloadExportFiles').mockImplementation(() => {});
  });

  const renderComponent = () =>
    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <DeleteAccountCard />
        </QueryClientProvider>
      </MemoryRouter>
    );

  it('card hidden when flag off', () => {
    vi.mocked(useFeatureFlag).mockReturnValue(false);
    renderComponent();

    expect(screen.queryByTestId('delete-account-card')).toBeNull();
  });

  it('confirm button disabled until DELETE typed', () => {
    renderComponent();

    const submitBtn = screen.getByTestId('delete-account-submit-btn');
    const input = screen.getByTestId('delete-account-confirm-input');

    // Initially disabled
    expect(submitBtn).toBeDisabled();

    // Incomplete text
    fireEvent.change(input, { target: { value: 'DEL' } });
    expect(submitBtn).toBeDisabled();

    // Lowercase text
    fireEvent.change(input, { target: { value: 'delete' } });
    expect(submitBtn).toBeDisabled();

    // Exact match 'DELETE'
    fireEvent.change(input, { target: { value: 'DELETE' } });
    expect(submitBtn).not.toBeDisabled();
  });

  it('disabled when offline', () => {
    vi.mocked(useOnlineStatus).mockReturnValue(false);
    renderComponent();

    const submitBtn = screen.getByTestId('delete-account-submit-btn');
    const input = screen.getByTestId('delete-account-confirm-input');

    fireEvent.change(input, { target: { value: 'DELETE' } });

    // Disabled due to offline state
    expect(submitBtn).toBeDisabled();
    expect(input).toBeDisabled();
    expect(screen.getByTestId('delete-account-offline-notice')).toBeInTheDocument();
  });

  it('success path calls invoke then wipe then signOut in order', async () => {
    const callOrder: string[] = [];

    vi.mocked(supabase.functions.invoke).mockImplementation(async (fnName) => {
      callOrder.push(`invoke:${fnName}`);
      return { data: { deleted: true }, error: null } as any;
    });

    vi.spyOn(wipeModule, 'wipeUserData').mockImplementation(async () => {
      callOrder.push('wipeUserData');
    });

    mockSignOut.mockImplementation(async () => {
      callOrder.push('signOut');
    });

    mockNavigate.mockImplementation(() => {
      callOrder.push('navigate');
    });

    renderComponent();

    const input = screen.getByTestId('delete-account-confirm-input');
    const submitBtn = screen.getByTestId('delete-account-submit-btn');

    fireEvent.change(input, { target: { value: 'DELETE' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login', expect.objectContaining({
        state: expect.objectContaining({ message: expect.any(String) }),
      }));
    });

    expect(callOrder).toEqual([
      'invoke:delete-account',
      'wipeUserData',
      'signOut',
      'navigate',
    ]);

    expect(wipeModule.wipeUserData).toHaveBeenCalledWith(mockUser.id, { queryClient });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('failure shows error and does not wipe', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: null,
      error: { message: 'Server deletion failed' } as any,
    } as any);

    renderComponent();

    const input = screen.getByTestId('delete-account-confirm-input');
    const submitBtn = screen.getByTestId('delete-account-submit-btn');

    fireEvent.change(input, { target: { value: 'DELETE' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId('delete-account-error-alert')).toBeInTheDocument();
    });

    expect(screen.getByText('Server deletion failed')).toBeInTheDocument();
    expect(wipeModule.wipeUserData).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('export button triggers data export', async () => {
    renderComponent();

    const exportBtn = screen.getByTestId('delete-account-export-btn');
    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(dataExportUtils.executeDataExport).toHaveBeenCalledWith(
        expect.objectContaining({
          targetUserId: mockProfile.id,
          isSelfExport: true,
          preset: 'all',
        })
      );
    });

    expect(dataExportUtils.downloadExportFiles).toHaveBeenCalled();
  });
});
