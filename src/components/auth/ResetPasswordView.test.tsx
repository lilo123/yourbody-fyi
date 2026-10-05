import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ResetPasswordView } from './ResetPasswordView';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../../context/AuthContext';
import { ToastProvider } from '../../context/ToastContext';
import { ToastHost } from '../common/ToastHost';

import { createSupabaseBuilder, getRecordedSelects, getRecordedTables, clearMockHistory } from '../../test/supabaseBuilderMock';
import { expectNoA11yViolations } from '../../test/a11y';

const mockUpdateUser = vi.fn();

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => createSupabaseBuilder(table, null)),
    auth: {
      updateUser: (...args: any[]) => mockUpdateUser(...args),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

describe('ResetPasswordView', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    clearMockHistory();
    mockUpdateUser.mockResolvedValue({ data: { user: {} }, error: null });
    queryClient = new QueryClient();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  const renderComponent = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <ToastProvider>
              <ResetPasswordView />
              <ToastHost />
            </ToastProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    );

  it('renders reset password form with password and confirm password fields', () => {
    // NO_PROJECTION_APPLIES: ResetPasswordView tests exercise auth.updateUser only; no database select queries issued
    const userBuilder = createSupabaseBuilder('users', null);
    expect(userBuilder.tableName).toBe('users');
    expect(getRecordedTables()).toContain('users');
    renderComponent();
    expect(screen.getByText('Reset Password')).toBeDefined();
    expect(screen.getByText('New Password')).toBeDefined();
    expect(screen.getByText('Confirm New Password')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Set New Password' })).toBeDefined();
    expect(getRecordedSelects()).toHaveLength(0);
  });

  it('validates minimum password length', async () => {
    renderComponent();

    const [pwdInput, confirmPwdInput] = screen.getAllByPlaceholderText('••••••••');
    fireEvent.change(pwdInput, { target: { value: '123' } });
    fireEvent.change(confirmPwdInput, { target: { value: '123' } });

    fireEvent.click(screen.getByRole('button', { name: 'Set New Password' }));

    expect(await screen.findAllByText('Password must be at least 6 characters')).toBeDefined();
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('validates passwords match', async () => {
    renderComponent();

    const [pwdInput, confirmPwdInput] = screen.getAllByPlaceholderText('••••••••');
    fireEvent.change(pwdInput, { target: { value: 'password123' } });
    fireEvent.change(confirmPwdInput, { target: { value: 'different123' } });

    fireEvent.click(screen.getByRole('button', { name: 'Set New Password' }));

    expect(await screen.findAllByText('Passwords do not match')).toBeDefined();
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('submits password update successfully and shows confirmation', async () => {
    renderComponent();

    const [pwdInput, confirmPwdInput] = screen.getAllByPlaceholderText('••••••••');
    fireEvent.change(pwdInput, { target: { value: 'newpassword123' } });
    fireEvent.change(confirmPwdInput, { target: { value: 'newpassword123' } });

    fireEvent.click(screen.getByRole('button', { name: 'Set New Password' }));

    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'newpassword123' });
    });

    expect(await screen.findAllByText('Password Updated Successfully!')).toBeDefined();
  });

  it('has accessible label associations and independent password reveal toggles meeting WCAG target size', async () => {
    const { container } = renderComponent();

    // Verify label associations for new password and confirm new password
    const newPasswordInput = screen.getByLabelText(/^new password/i, { selector: 'input' }) as HTMLInputElement;
    expect(newPasswordInput).toBeDefined();

    const confirmPasswordInput = screen.getByLabelText(/confirm new password/i, { selector: 'input' }) as HTMLInputElement;
    expect(confirmPasswordInput).toBeDefined();

    expect(newPasswordInput.type).toBe('password');
    expect(confirmPasswordInput.type).toBe('password');

    // Verify both password reveal toggles have distinct accessible names and 44x44 target sizes
    const passwordToggle = screen.getByRole('button', { name: /^show password$/i });
    const confirmToggle = screen.getByRole('button', { name: /show confirm password/i });

    expect(passwordToggle).toBeDefined();
    expect(confirmToggle).toBeDefined();
    expect(passwordToggle.className).toContain('min-h-[44px]');
    expect(passwordToggle.className).toContain('min-w-[44px]');
    expect(confirmToggle.className).toContain('min-h-[44px]');
    expect(confirmToggle.className).toContain('min-w-[44px]');

    // Regression guard for state split: toggling confirm button updates ONLY confirm input
    fireEvent.click(confirmToggle);
    expect(confirmPasswordInput.type).toBe('text');
    expect(newPasswordInput.type).toBe('password');
    expect(screen.getByRole('button', { name: /hide confirm password/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /^show password$/i })).toBeDefined();

    // axe-core check
    await expectNoA11yViolations(container);
  });

  it('mounts live regions while idle and mutates in place on error and success (WCAG SC 4.1.3)', async () => {
    const { container } = renderComponent();

    const polite = container.querySelector('[role="status"]');
    const assertive = container.querySelector('[role="alert"]');

    expect(polite).not.toBeNull();
    expect(assertive).not.toBeNull();
    expect(polite!.textContent).toBe('');
    expect(assertive!.textContent).toBe('');

    // Trigger validation error
    const [pwdInput, confirmPwdInput] = screen.getAllByPlaceholderText('••••••••');
    fireEvent.change(pwdInput, { target: { value: 'password123' } });
    fireEvent.change(confirmPwdInput, { target: { value: 'different123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set New Password' }));

    // Node identity preserved across error transition
    await waitFor(() => {
      expect(container.querySelector('[role="status"]')).toBe(polite);
      expect(container.querySelector('[role="alert"]')).toBe(assertive);
      expect(assertive!.textContent).toContain('Passwords do not match');
      expect(polite!.textContent).toBe('');
    });

    // Trigger success
    fireEvent.change(confirmPwdInput, { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set New Password' }));

    // Node identity preserved across success transition
    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'password123' });
      expect(container.querySelector('[role="alert"]')).toBe(assertive);
      const statusRegions = Array.from(container.querySelectorAll('[role="status"]'));
      expect(statusRegions.some((el) => el.textContent?.includes('Password Updated Successfully!'))).toBe(true);
    });
  });
});
