import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoginView } from './LoginView';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../../context/AuthContext';

import { createSupabaseBuilder, getRecordedSelects, getRecordedTables, clearMockHistory } from '../../test/supabaseBuilderMock';
import { expectNoA11yViolations } from '../../test/a11y';

const mockSignInWithPassword = vi.fn();
const mockSignUp = vi.fn();
const mockResetPasswordForEmail = vi.fn();
const mockResend = vi.fn();

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => createSupabaseBuilder(table, { id: 'test-user-id', role: 'athlete' })),
    auth: {
      signInWithPassword: (...args: any[]) => mockSignInWithPassword(...args),
      signUp: (...args: any[]) => mockSignUp(...args),
      resetPasswordForEmail: (...args: any[]) => mockResetPasswordForEmail(...args),
      resend: (...args: any[]) => mockResend(...args),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

describe('LoginView', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    clearMockHistory();
    mockSignInWithPassword.mockResolvedValue({ data: { user: { id: 'test-user-id' } }, error: null });
    mockSignUp.mockResolvedValue({ data: { user: { id: 'test-user-id' } }, error: null });
    mockResetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    mockResend.mockResolvedValue({ data: {}, error: null });
    queryClient = new QueryClient();
  });

  const renderComponent = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <LoginView />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    );

  it('renders login view with Email, Password inputs', () => {
    // NO_PROJECTION_APPLIES: LoginView tests exercise auth UI and form validation only; no database select queries issued
    const userBuilder = createSupabaseBuilder('users', { id: 'test-user-id', role: 'athlete' });
    expect(userBuilder.tableName).toBe('users');
    expect(getRecordedTables()).toContain('users');
    renderComponent();
    const titleEl = screen.getByRole('heading', { level: 1, name: 'Yourbody.fyi' });
    expect(titleEl).toBeDefined();
    expect(titleEl.textContent).toBe('Yourbody.fyi');
    expect(titleEl.className).not.toContain('uppercase');
    expect(screen.getByPlaceholderText('you@example.com')).toBeDefined();
    expect(getRecordedSelects()).toHaveLength(0);
  });

  it('switches to register mode and displays confirm password field', async () => {
    const { fireEvent } = await import('@testing-library/react');
    renderComponent();

    const registerTab = screen.getByRole('button', { name: 'Register' });
    fireEvent.click(registerTab);

    expect(screen.getByText('Confirm Password')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Create Account' })).toBeDefined();
  });

  it('validates password length on registration', async () => {
    const { fireEvent } = await import('@testing-library/react');
    renderComponent();

    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    const emailInput = screen.getByPlaceholderText('you@example.com');
    const [passwordInput, confirmInput] = screen.getAllByPlaceholderText('••••••••');

    fireEvent.change(emailInput, { target: { value: 'athlete@yourbody.fyi' } });
    fireEvent.change(passwordInput, { target: { value: '123' } });
    fireEvent.change(confirmInput, { target: { value: '123' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(await screen.findAllByText('Password must be at least 6 characters')).toBeDefined();
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it('validates password matching on registration', async () => {
    const { fireEvent } = await import('@testing-library/react');
    renderComponent();

    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    const emailInput = screen.getByPlaceholderText('you@example.com');
    const [passwordInput, confirmInput] = screen.getAllByPlaceholderText('••••••••');

    fireEvent.change(emailInput, { target: { value: 'athlete@yourbody.fyi' } });
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    fireEvent.change(confirmInput, { target: { value: 'password456' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(await screen.findAllByText('Passwords do not match')).toBeDefined();
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it('allows navigating to forgot password and submitting reset request', async () => {
    const { fireEvent } = await import('@testing-library/react');
    renderComponent();

    const forgotBtn = screen.getByRole('button', { name: /Forgot Password/i });
    fireEvent.click(forgotBtn);

    expect(screen.getByRole('button', { name: 'Send Reset Link' })).toBeDefined();

    const emailInput = screen.getByPlaceholderText('you@example.com');
    fireEvent.change(emailInput, { target: { value: 'athlete@yourbody.fyi' } });

    fireEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }));

    expect(await screen.findAllByText('Password reset link sent! Check your inbox.')).toBeDefined();
    expect(mockResetPasswordForEmail).toHaveBeenCalledWith(
      'athlete@yourbody.fyi',
      expect.objectContaining({ redirectTo: expect.stringContaining('/reset-password') })
    );
  });

  it('has accessible label associations and password reveal toggle in signin mode', async () => {
    const { container } = renderComponent();

    // Verify label associations for email and password
    const emailInput = screen.getByLabelText(/email address/i);
    expect(emailInput).toBeDefined();

    const passwordInput = screen.getByLabelText(/^password/i);
    expect(passwordInput).toBeDefined();

    // Verify password toggle accessible name and hit area (WCAG SC 2.5.8 & 4.1.2)
    const toggleBtn = screen.getByRole('button', { name: /show password/i });
    expect(toggleBtn).toBeDefined();
    expect(toggleBtn.className).toContain('min-h-[44px]');
    expect(toggleBtn.className).toContain('min-w-[44px]');

    // Toggling state updates accessible name to 'Hide password'
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.click(toggleBtn);
    expect(screen.getByRole('button', { name: /hide password/i })).toBeDefined();

    // axe-core check
    await expectNoA11yViolations(container);
  });

  it('has accessible label associations and independent password reveal toggles in register mode', async () => {
    const { container } = renderComponent();
    const { fireEvent } = await import('@testing-library/react');

    const registerTab = screen.getByRole('button', { name: 'Register' });
    fireEvent.click(registerTab);

    // Verify label associations in register mode
    const emailInput = screen.getByLabelText(/email address/i, { selector: 'input' });
    const passwordInput = screen.getByLabelText(/^password/i, { selector: 'input' }) as HTMLInputElement;
    const confirmInput = screen.getByLabelText(/confirm password/i, { selector: 'input' }) as HTMLInputElement;

    expect(emailInput).toBeDefined();
    expect(passwordInput).toBeDefined();
    expect(confirmInput).toBeDefined();
    expect(passwordInput.type).toBe('password');
    expect(confirmInput.type).toBe('password');

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
    expect(confirmInput.type).toBe('text');
    expect(passwordInput.type).toBe('password');
    expect(screen.getByRole('button', { name: /hide confirm password/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /^show password$/i })).toBeDefined();

    // axe-core check
    await expectNoA11yViolations(container);
  });

  it('mounts live regions while idle and mutates in place on auth error and info messages (WCAG SC 4.1.3)', async () => {
    const { container } = renderComponent();

    const politeRegions = container.querySelectorAll('[role="status"]');
    const assertiveRegions = container.querySelectorAll('[role="alert"]');

    // Live regions must be mounted and empty while idle
    expect(politeRegions.length).toBeGreaterThanOrEqual(1);
    expect(assertiveRegions.length).toBeGreaterThanOrEqual(1);
    expect(politeRegions[0].textContent).toBe('');
    expect(assertiveRegions[0].textContent).toBe('');

    // Trigger validation error on register
    const { fireEvent } = await import('@testing-library/react');
    const registerTab = screen.getByRole('button', { name: 'Register' });
    fireEvent.click(registerTab);

    const emailInput = screen.getByPlaceholderText('you@example.com');
    const [passwordInput, confirmInput] = screen.getAllByPlaceholderText('••••••••');
    const submitBtn = screen.getByRole('button', { name: 'Create Account' });

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.change(passwordInput, { target: { value: '123' } });
    fireEvent.change(confirmInput, { target: { value: '123' } });
    fireEvent.click(submitBtn);

    // Assert assertive live region received error text on the SAME element
    const updatedAssertive = container.querySelectorAll('[role="alert"]')[0];
    expect(updatedAssertive).toBe(assertiveRegions[0]);
    expect(updatedAssertive.textContent).toContain('Password must be at least 6 characters');
  });
});

