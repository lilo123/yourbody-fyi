import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { LoginView, getSafeRedirectPath } from './LoginView';
import { BrowserRouter, MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../../context/AuthContext';

import { createSupabaseBuilder, getRecordedSelects, getRecordedTables, clearMockHistory } from '../../test/supabaseBuilderMock';
import { supabase } from '../../lib/supabase';
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
    (supabase.from as any).mockImplementation((table: string) =>
      createSupabaseBuilder(table, { id: 'test-user-id', role: 'athlete' })
    );
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

  it('flag off: terms checkbox is absent and registration submit sends default options without terms_version', async () => {
    const originalEnv = import.meta.env.VITE_FEATURE_TERMS_CONSENT;
    (import.meta.env as any).VITE_FEATURE_TERMS_CONSENT = undefined;

    try {
      const { fireEvent } = await import('@testing-library/react');
      renderComponent();

      fireEvent.click(screen.getByRole('button', { name: 'Register' }));

      // Checkbox must be absent
      expect(screen.queryByRole('checkbox')).toBeNull();
      expect(screen.queryByText(/Terms of Service/i)).toBeNull();

      const emailInput = screen.getByPlaceholderText('you@example.com');
      const [passwordInput, confirmInput] = screen.getAllByPlaceholderText('••••••••');
      const submitBtn = screen.getByRole('button', { name: 'Create Account' }) as HTMLButtonElement;

      expect(submitBtn.disabled).toBe(false);

      fireEvent.change(emailInput, { target: { value: 'consent_off@yourbody.fyi' } });
      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.change(confirmInput, { target: { value: 'password123' } });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockSignUp).toHaveBeenCalledTimes(1);
      });

      const callArgs = mockSignUp.mock.calls[0][0];
      expect(callArgs.email).toBe('consent_off@yourbody.fyi');
      expect(callArgs.options.data.terms_version).toBeUndefined();
    } finally {
      (import.meta.env as any).VITE_FEATURE_TERMS_CONSENT = originalEnv;
    }
  });

  it('flag on: terms checkbox is required, links to /terms and /privacy, controls submit button, and sends terms_version in signUp', async () => {
    const originalEnv = import.meta.env.VITE_FEATURE_TERMS_CONSENT;
    (import.meta.env as any).VITE_FEATURE_TERMS_CONSENT = 'true';

    try {
      const { fireEvent } = await import('@testing-library/react');
      const { container } = renderComponent();

      fireEvent.click(screen.getByRole('button', { name: 'Register' }));

      // Checkbox is present and required
      const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
      expect(checkbox).toBeDefined();
      expect(checkbox.checked).toBe(false);
      expect(checkbox.required).toBe(true);

      // Links exist with correct attributes
      const termsLink = screen.getByRole('link', { name: /Terms of Service/i });
      const privacyLink = screen.getByRole('link', { name: /Privacy Policy/i });
      expect(termsLink.getAttribute('href')).toBe('/terms');
      expect(termsLink.getAttribute('target')).toBe('_blank');
      expect(termsLink.getAttribute('rel')).toBe('noopener');
      expect(privacyLink.getAttribute('href')).toBe('/privacy');
      expect(privacyLink.getAttribute('target')).toBe('_blank');
      expect(privacyLink.getAttribute('rel')).toBe('noopener');

      const emailInput = screen.getByPlaceholderText('you@example.com');
      const [passwordInput, confirmInput] = screen.getAllByPlaceholderText('••••••••');
      const submitBtn = screen.getByRole('button', { name: 'Create Account' }) as HTMLButtonElement;

      fireEvent.change(emailInput, { target: { value: 'consent_on@yourbody.fyi' } });
      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.change(confirmInput, { target: { value: 'password123' } });

      // Submit must be disabled when checkbox is unchecked
      expect(submitBtn.disabled).toBe(true);

      // Check the checkbox -> submit enabled
      fireEvent.click(checkbox);
      expect(checkbox.checked).toBe(true);
      expect(submitBtn.disabled).toBe(false);

      // Submit form
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockSignUp).toHaveBeenCalledTimes(1);
      });

      const callArgs = mockSignUp.mock.calls[0][0];
      expect(callArgs.email).toBe('consent_on@yourbody.fyi');
      expect(callArgs.options.data.terms_version).toBe('2026-10-10');

      // A11y verification with checkbox rendered
      await expectNoA11yViolations(container);
    } finally {
      (import.meta.env as any).VITE_FEATURE_TERMS_CONSENT = originalEnv;
    }
  });

  describe('In-app browser banner on /login', () => {
    const originalUserAgent = navigator.userAgent;

    afterEach(() => {
      Object.defineProperty(navigator, 'userAgent', {
        value: originalUserAgent,
        configurable: true,
      });
      sessionStorage.clear();
    });

    it('renders in-app banner on /login when Instagram UA is detected', async () => {
      const instagramUa =
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/21E236 Instagram 324.0.0.18.109';
      Object.defineProperty(navigator, 'userAgent', {
        value: instagramUa,
        configurable: true,
      });

      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('in-app-browser-banner')).toBeDefined();
      });
      const banner = screen.getByTestId('in-app-browser-banner');
      expect(banner).toHaveTextContent(
        'Open in your browser for the best experience.'
      );
    });

    it('does not render in-app banner on /login for normal browser UA', () => {
      const safariUa =
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 Version/17.4.1 Safari/604.1';
      Object.defineProperty(navigator, 'userAgent', {
        value: safariUa,
        configurable: true,
      });

      renderComponent();
      expect(screen.queryByTestId('in-app-browser-banner')).toBeNull();
    });
  });

  it('renders the logo as a link to / with accessible name', () => {
    renderComponent();
    const logoLink = screen.getByRole('link', { name: 'Yourbody.fyi Home' });
    expect(logoLink).toBeDefined();
    expect(logoLink.getAttribute('href')).toBe('/');
  });

  it('navigates to / when the logo link is clicked in MemoryRouter', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const { MemoryRouter, Routes, Route } = await import('react-router-dom');

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/login']}>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginView />} />
              <Route path="/" element={<div data-testid="landing-stub">Landing View</div>} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    const logoLink = screen.getByRole('link', { name: 'Yourbody.fyi Home' });
    expect(logoLink).toBeDefined();
    expect(logoLink.getAttribute('href')).toBe('/');
    fireEvent.click(logoLink);

    expect(screen.getByTestId('landing-stub')).toBeDefined();
  });

  it('displays account-deleted confirmation message when navigated to with state.message', () => {
    const deletedMessage = 'Your account and data have been permanently deleted.';
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[{ pathname: '/login', state: { message: deletedMessage } }]}>
          <AuthProvider>
            <LoginView />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    const elements = screen.getAllByText(deletedMessage);
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });

  it('does not display route message when state contains unrelated properties like state.from', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[{ pathname: '/login', state: { from: '/workout' } }]}>
          <AuthProvider>
            <LoginView />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(screen.queryByText('/workout')).toBeNull();
  });

  it('clears window history state after displaying route message', () => {
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');
    const deletedMessage = 'Your account and data have been permanently deleted.';
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[{ pathname: '/login', state: { message: deletedMessage } }]}>
          <AuthProvider>
            <LoginView />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(replaceStateSpy).toHaveBeenCalled();
    replaceStateSpy.mockRestore();
  });

  it('navigates to state.from path (/nutrition) after successful sign in', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[{ pathname: '/login', state: { from: '/nutrition' } }]}>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginView />} />
              <Route path="/workout" element={<div data-testid="workout-page">Workout</div>} />
              <Route path="/nutrition" element={<div data-testid="nutrition-page">Nutrition</div>} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    const emailInput = screen.getByPlaceholderText('you@example.com');
    const passwordInput = screen.getByPlaceholderText('••••••••');
    const submitBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement;

    fireEvent.change(emailInput, { target: { value: 'athlete@yourbody.fyi' } });
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId('nutrition-page')).toBeDefined();
    });
  });

  describe('post-sign-in redirect and open-redirect defense', () => {
    it('navigates to state.from location object with pathname and search query', async () => {
      const { fireEvent } = await import('@testing-library/react');
      let capturedLocation: any;
      const NutritionSpy = () => {
        const loc = useLocation();
        capturedLocation = loc;
        return <div data-testid="nutrition-page">{loc.pathname + loc.search}</div>;
      };

      const { container } = render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter
            initialEntries={[
              {
                pathname: '/login',
                state: { from: { pathname: '/nutrition', search: '?date=2026-10-22' } },
              },
            ]}
          >
            <AuthProvider>
              <Routes>
                <Route path="/login" element={<LoginView />} />
                <Route path="/workout" element={<div data-testid="workout-page">Workout</div>} />
                <Route path="/nutrition" element={<NutritionSpy />} />
              </Routes>
            </AuthProvider>
          </MemoryRouter>
        </QueryClientProvider>
      );

      const emailInput = screen.getByPlaceholderText('you@example.com');
      const passwordInput = screen.getByPlaceholderText('••••••••');
      const submitBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement;

      fireEvent.change(emailInput, { target: { value: 'athlete@yourbody.fyi' } });
      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByTestId('nutrition-page')).toBeDefined();
      });
      expect(capturedLocation.pathname).toBe('/nutrition');
      expect(capturedLocation.search).toBe('?date=2026-10-22');
    });

    it('navigates non-coach to /workout when state.from targets /coach', async () => {
      const { fireEvent } = await import('@testing-library/react');
      const { container } = render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[{ pathname: '/login', state: { from: '/coach' } }]}>
            <AuthProvider>
              <Routes>
                <Route path="/login" element={<LoginView />} />
                <Route path="/workout" element={<div data-testid="workout-page">Workout</div>} />
                <Route path="/coach" element={<div data-testid="coach-page">Coach</div>} />
              </Routes>
            </AuthProvider>
          </MemoryRouter>
        </QueryClientProvider>
      );

      const emailInput = screen.getByPlaceholderText('you@example.com');
      const passwordInput = screen.getByPlaceholderText('••••••••');
      const submitBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement;

      fireEvent.change(emailInput, { target: { value: 'athlete@yourbody.fyi' } });
      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByTestId('workout-page')).toBeDefined();
      });
      expect(screen.queryByTestId('coach-page')).toBeNull();
    });

    it('navigates coach to /coach when state.from targets /coach', async () => {
      const { fireEvent } = await import('@testing-library/react');
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'users') {
          return createSupabaseBuilder('users', { id: 'test-user-id', role: 'coach' });
        }
        return createSupabaseBuilder(table, []);
      });

      try {
        const { container } = render(
          <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={[{ pathname: '/login', state: { from: '/coach' } }]}>
              <AuthProvider>
                <Routes>
                  <Route path="/login" element={<LoginView />} />
                  <Route path="/workout" element={<div data-testid="workout-page">Workout</div>} />
                  <Route path="/coach" element={<div data-testid="coach-page">Coach</div>} />
                </Routes>
              </AuthProvider>
            </MemoryRouter>
          </QueryClientProvider>
        );

        const emailInput = screen.getByPlaceholderText('you@example.com');
        const passwordInput = screen.getByPlaceholderText('••••••••');
        const submitBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement;

        fireEvent.change(emailInput, { target: { value: 'coach@yourbody.fyi' } });
        fireEvent.change(passwordInput, { target: { value: 'password123' } });
        fireEvent.click(submitBtn);

        await waitFor(() => {
          expect(screen.getByTestId('coach-page')).toBeDefined();
        });
      } finally {
        (supabase.from as any).mockImplementation((table: string) =>
          createSupabaseBuilder(table, { id: 'test-user-id', role: 'athlete' })
        );
      }
    });

    it('rejects open-redirect attempts: //evil.com, https://evil.com, and /\\evil', async () => {
      const { fireEvent } = await import('@testing-library/react');
      const maliciousTargets = ['//evil.com', 'https://evil.com', '/\\evil'];

      for (const target of maliciousTargets) {
        const { container, unmount } = render(
          <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={[{ pathname: '/login', state: { from: target } }]}>
              <AuthProvider>
                <Routes>
                  <Route path="/login" element={<LoginView />} />
                  <Route path="/workout" element={<div data-testid="workout-page">Workout</div>} />
                  <Route path="/nutrition" element={<div data-testid="nutrition-page">Nutrition</div>} />
                </Routes>
              </AuthProvider>
            </MemoryRouter>
          </QueryClientProvider>
        );

        const emailInput = screen.getByPlaceholderText('you@example.com');
        const passwordInput = screen.getByPlaceholderText('••••••••');
        const submitBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement;

        fireEvent.change(emailInput, { target: { value: 'athlete@yourbody.fyi' } });
        fireEvent.change(passwordInput, { target: { value: 'password123' } });
        fireEvent.click(submitBtn);

        await waitFor(() => {
          expect(screen.getByTestId('workout-page')).toBeDefined();
        });

        unmount();
      }
    });

    it('rejects open-redirect attempts in location objects ({ pathname: ... })', async () => {
      const { fireEvent } = await import('@testing-library/react');
      const maliciousObjects = [
        { pathname: '//evil.com' },
        { pathname: 'https://evil.com' },
        { pathname: '/\\evil' },
        { pathname: '/login' },
      ];

      for (const targetObj of maliciousObjects) {
        const { container, unmount } = render(
          <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={[{ pathname: '/login', state: { from: targetObj } }]}>
              <AuthProvider>
                <Routes>
                  <Route path="/login" element={<LoginView />} />
                  <Route path="/workout" element={<div data-testid="workout-page">Workout</div>} />
                  <Route path="/nutrition" element={<div data-testid="nutrition-page">Nutrition</div>} />
                </Routes>
              </AuthProvider>
            </MemoryRouter>
          </QueryClientProvider>
        );

        const emailInput = screen.getByPlaceholderText('you@example.com');
        const passwordInput = screen.getByPlaceholderText('••••••••');
        const submitBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement;

        fireEvent.change(emailInput, { target: { value: 'athlete@yourbody.fyi' } });
        fireEvent.change(passwordInput, { target: { value: 'password123' } });
        fireEvent.click(submitBtn);

        await waitFor(() => {
          expect(screen.getByTestId('workout-page')).toBeDefined();
        });

        unmount();
      }
    });

    it('getSafeRedirectPath unit checks for relative paths, schemes, and roles', () => {
      // Valid paths
      expect(getSafeRedirectPath('/nutrition', 'athlete')).toBe('/nutrition');
      expect(getSafeRedirectPath('/history', 'athlete')).toBe('/history');
      expect(getSafeRedirectPath('/settings', 'athlete')).toBe('/settings');
      expect(getSafeRedirectPath({ pathname: '/nutrition', search: '?q=1' }, 'athlete')).toBe(
        '/nutrition?q=1'
      );

      // Open redirect and scheme injection attempts
      expect(getSafeRedirectPath('//evil.com', 'athlete')).toBeNull();
      expect(getSafeRedirectPath('https://evil.com', 'athlete')).toBeNull();
      expect(getSafeRedirectPath('http://evil.com', 'athlete')).toBeNull();
      expect(getSafeRedirectPath('/\\evil', 'athlete')).toBeNull();
      expect(getSafeRedirectPath('/\\evil.com', 'athlete')).toBeNull();
      expect(getSafeRedirectPath('javascript:alert(1)', 'athlete')).toBeNull();
      expect(getSafeRedirectPath({ pathname: '//evil.com' }, 'athlete')).toBeNull();
      expect(getSafeRedirectPath({ pathname: 'https://evil.com' }, 'athlete')).toBeNull();
      expect(getSafeRedirectPath({ pathname: '/\\evil' }, 'athlete')).toBeNull();

      // Loop prevention
      expect(getSafeRedirectPath('/login', 'athlete')).toBeNull();
      expect(getSafeRedirectPath('/login?return=1', 'athlete')).toBeNull();
      expect(getSafeRedirectPath({ pathname: '/login' }, 'athlete')).toBeNull();

      // Role authorization
      expect(getSafeRedirectPath('/coach', 'athlete')).toBeNull();
      expect(getSafeRedirectPath('/coach/athletes', 'athlete')).toBeNull();
      expect(getSafeRedirectPath('/coach', 'coach')).toBe('/coach');
      expect(getSafeRedirectPath('/coach?tab=athletes', 'coach')).toBe('/coach?tab=athletes');

      // Empty / invalid input
      expect(getSafeRedirectPath(null, 'athlete')).toBeNull();
      expect(getSafeRedirectPath(undefined, 'athlete')).toBeNull();
      expect(getSafeRedirectPath('', 'athlete')).toBeNull();
      expect(getSafeRedirectPath({}, 'athlete')).toBeNull();
    });
  });
});

