import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AccountCard } from './AccountCard';
import * as authModule from '../../hooks/useAuth';
import * as onlineModule from '../../hooks/useOnlineStatus';
import * as toastModule from '../../hooks/useToast';

vi.mock('../../hooks/useAuth');
vi.mock('../../hooks/useOnlineStatus');
vi.mock('../../hooks/useToast');

describe('AccountCard component', () => {
  const mockShowToast = vi.fn();
  const mockChangePassword = vi.fn();
  const mockChangeEmail = vi.fn();
  const mockRefreshSession = vi.fn();
  const mockRefreshProfile = vi.fn();

  const defaultUser = {
    id: 'test-user-id',
    email: 'athlete@example.com',
    new_email: undefined,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(toastModule.useToast).mockReturnValue({
      show: mockShowToast,
    } as any);

    vi.mocked(onlineModule.useOnlineStatus).mockReturnValue(true);

    vi.mocked(authModule.useAuth).mockReturnValue({
      user: defaultUser as any,
      profile: null,
      role: 'athlete',
      viewMode: 'athlete',
      isCoachMode: false,
      loading: false,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      updateProfile: vi.fn(),
      switchRole: vi.fn(),
      refreshProfile: mockRefreshProfile,
      resendConfirmation: vi.fn(),
      requestPasswordReset: vi.fn(),
      resetPassword: vi.fn(),
      changePassword: mockChangePassword,
      changeEmail: mockChangeEmail,
      refreshSession: mockRefreshSession,
    });
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/settings');
  });

  describe('Password Change', () => {
    it('shows error and does not call changePassword if new password is too short', async () => {
      render(<AccountCard />);

      const currentInput = screen.getByLabelText(/^current password$/i, { selector: 'input' });
      const newInput = screen.getByLabelText(/^new password$/i, { selector: 'input' });
      const confirmInput = screen.getByLabelText(/^confirm new password$/i, { selector: 'input' });

      fireEvent.change(currentInput, { target: { value: 'current123' } });
      fireEvent.change(newInput, { target: { value: '123' } });
      fireEvent.change(confirmInput, { target: { value: '123' } });

      const submitBtn = screen.getByRole('button', { name: /^change password$/i });
      fireEvent.click(submitBtn);

      const errors = await screen.findAllByText('Password must be at least 6 characters');
      expect(errors.length).toBeGreaterThan(0);
      expect(mockChangePassword).not.toHaveBeenCalled();
    });

    it('shows error and does not call changePassword if passwords do not match', async () => {
      render(<AccountCard />);

      const currentInput = screen.getByLabelText(/^current password$/i, { selector: 'input' });
      const newInput = screen.getByLabelText(/^new password$/i, { selector: 'input' });
      const confirmInput = screen.getByLabelText(/^confirm new password$/i, { selector: 'input' });

      fireEvent.change(currentInput, { target: { value: 'current123' } });
      fireEvent.change(newInput, { target: { value: 'newpassword123' } });
      fireEvent.change(confirmInput, { target: { value: 'mismatch123' } });

      const submitBtn = screen.getByRole('button', { name: /^change password$/i });
      fireEvent.click(submitBtn);

      const errors = await screen.findAllByText('Passwords do not match');
      expect(errors.length).toBeGreaterThan(0);
      expect(mockChangePassword).not.toHaveBeenCalled();
    });

    it('shows inline error when current password is wrong', async () => {
      mockChangePassword.mockResolvedValueOnce({
        success: false,
        error: 'Current password is incorrect',
      });

      render(<AccountCard />);

      const currentInput = screen.getByLabelText(/^current password$/i, { selector: 'input' });
      const newInput = screen.getByLabelText(/^new password$/i, { selector: 'input' });
      const confirmInput = screen.getByLabelText(/^confirm new password$/i, { selector: 'input' });

      fireEvent.change(currentInput, { target: { value: 'wrongpassword' } });
      fireEvent.change(newInput, { target: { value: 'validPassword1' } });
      fireEvent.change(confirmInput, { target: { value: 'validPassword1' } });

      const submitBtn = screen.getByRole('button', { name: /^change password$/i });
      fireEvent.click(submitBtn);

      const errors = await screen.findAllByText('Current password is incorrect');
      expect(errors.length).toBeGreaterThan(0);
      expect(mockChangePassword).toHaveBeenCalledWith('wrongpassword', 'validPassword1', undefined);
      expect(mockShowToast).not.toHaveBeenCalled();
    });

    it('handles password change success: calls changePassword, shows toast, and clears fields', async () => {
      mockChangePassword.mockResolvedValueOnce({ success: true });

      render(<AccountCard />);

      const currentInput = screen.getByLabelText(/^current password$/i, { selector: 'input' }) as HTMLInputElement;
      const newInput = screen.getByLabelText(/^new password$/i, { selector: 'input' }) as HTMLInputElement;
      const confirmInput = screen.getByLabelText(/^confirm new password$/i, { selector: 'input' }) as HTMLInputElement;

      fireEvent.change(currentInput, { target: { value: 'oldPass123' } });
      fireEvent.change(newInput, { target: { value: 'newPass123' } });
      fireEvent.change(confirmInput, { target: { value: 'newPass123' } });

      const submitBtn = screen.getByRole('button', { name: /^change password$/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockChangePassword).toHaveBeenCalledWith('oldPass123', 'newPass123', undefined);
        expect(mockShowToast).toHaveBeenCalledWith({
          message: 'Password changed',
          kind: 'success',
        });
      });

      expect(currentInput.value).toBe('');
      expect(newInput.value).toBe('');
      expect(confirmInput.value).toBe('');
    });

    it('handles reauthentication flow (nonce required)', async () => {
      mockChangePassword.mockResolvedValueOnce({
        success: false,
        needsReauthentication: true,
      });

      render(<AccountCard />);

      const currentInput = screen.getByLabelText(/^current password$/i, { selector: 'input' });
      const newInput = screen.getByLabelText(/^new password$/i, { selector: 'input' });
      const confirmInput = screen.getByLabelText(/^confirm new password$/i, { selector: 'input' });

      fireEvent.change(currentInput, { target: { value: 'oldPass123' } });
      fireEvent.change(newInput, { target: { value: 'newPass123' } });
      fireEvent.change(confirmInput, { target: { value: 'newPass123' } });

      const submitBtn = screen.getByRole('button', { name: /^change password$/i });
      fireEvent.click(submitBtn);

      // Now nonce input should appear
      expect(await screen.findByText(/Enter the code we emailed you/i)).toBeDefined();
      const nonceInput = screen.getByLabelText(/^confirmation code$/i, { selector: 'input' });
      expect(nonceInput).toBeDefined();

      // Submit nonce
      mockChangePassword.mockResolvedValueOnce({ success: true });
      fireEvent.change(nonceInput, { target: { value: '123456' } });

      const confirmBtn = screen.getByRole('button', { name: /confirm code & update password/i });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(mockChangePassword).toHaveBeenCalledWith('oldPass123', 'newPass123', '123456');
        expect(mockShowToast).toHaveBeenCalledWith({
          message: 'Password changed',
          kind: 'success',
        });
      });
    });

    it('has reveal toggles with min-h-[44px] touch target sizes', () => {
      render(<AccountCard />);

      const toggles = screen.getAllByRole('button', { name: /show|hide/i });
      expect(toggles.length).toBeGreaterThanOrEqual(3);
      for (const toggle of toggles) {
        expect(toggle.className).toContain('min-h-[44px]');
        expect(toggle.className).toContain('min-w-[44px]');
      }
    });
  });

  describe('Email Change', () => {
    it('validates invalid email format and does not call changeEmail', async () => {
      render(<AccountCard />);

      const emailInput = screen.getByLabelText(/^new email$/i, { selector: 'input' });
      fireEvent.change(emailInput, { target: { value: 'not-an-email' } });

      const updateBtn = screen.getByRole('button', { name: /update email/i });
      fireEvent.click(updateBtn);

      const errors = await screen.findAllByText('Please enter a valid email address');
      expect(errors.length).toBeGreaterThan(0);
      expect(mockChangeEmail).not.toHaveBeenCalled();
    });

    it('validates same email as current and does not call changeEmail', async () => {
      render(<AccountCard />);

      const emailInput = screen.getByLabelText(/^new email$/i, { selector: 'input' });
      fireEvent.change(emailInput, { target: { value: 'athlete@example.com' } });

      const updateBtn = screen.getByRole('button', { name: /update email/i });
      fireEvent.click(updateBtn);

      const errors = await screen.findAllByText('New email cannot be the same as current email');
      expect(errors.length).toBeGreaterThan(0);
      expect(mockChangeEmail).not.toHaveBeenCalled();
    });

    it('submits email update, shows pending copy and success toast', async () => {
      mockChangeEmail.mockResolvedValueOnce({
        success: true,
        user: { ...defaultUser, new_email: 'newathlete@example.com' },
      });

      render(<AccountCard />);

      const emailInput = screen.getByLabelText(/^new email$/i, { selector: 'input' }) as HTMLInputElement;
      fireEvent.change(emailInput, { target: { value: 'newathlete@example.com' } });

      const updateBtn = screen.getByRole('button', { name: /update email/i });
      fireEvent.click(updateBtn);

      await waitFor(() => {
        expect(mockChangeEmail).toHaveBeenCalledWith('newathlete@example.com');
        expect(mockShowToast).toHaveBeenCalledWith({
          message: 'Confirmation link sent to your email',
          kind: 'success',
        });
      });

      expect(emailInput.value).toBe('');
      expect(await screen.findByText(/Pending: newathlete@example.com — check your inbox/i)).toBeDefined();
    });

    it('displays pending email on load if user.new_email is set', () => {
      vi.mocked(authModule.useAuth).mockReturnValue({
        user: { ...defaultUser, new_email: 'pending_existing@example.com' } as any,
        profile: null,
        role: 'athlete',
        viewMode: 'athlete',
        isCoachMode: false,
        loading: false,
        signIn: vi.fn(),
        signUp: vi.fn(),
        signOut: vi.fn(),
        updateProfile: vi.fn(),
        switchRole: vi.fn(),
        refreshProfile: mockRefreshProfile,
        resendConfirmation: vi.fn(),
        requestPasswordReset: vi.fn(),
        resetPassword: vi.fn(),
        changePassword: mockChangePassword,
        changeEmail: mockChangeEmail,
        refreshSession: mockRefreshSession,
      });

      render(<AccountCard />);
      expect(screen.getByText(/Pending: pending_existing@example.com — check your inbox/i)).toBeDefined();
    });

    it('handles return with ?email=changed when confirmation completed', async () => {
      window.history.replaceState({}, '', '/settings?email=changed');
      mockRefreshSession.mockResolvedValueOnce({ ...defaultUser, new_email: undefined });

      render(<AccountCard />);

      await waitFor(() => {
        expect(mockRefreshSession).toHaveBeenCalled();
        expect(mockRefreshProfile).toHaveBeenCalled();
        expect(mockShowToast).toHaveBeenCalledWith({
          message: 'Email updated',
          kind: 'success',
        });
      });

      expect(window.location.search).toBe('');
    });

    it('handles return with ?email=changed when one confirmation is still pending', async () => {
      window.history.replaceState({}, '', '/settings?email=changed');
      mockRefreshSession.mockResolvedValueOnce({
        ...defaultUser,
        new_email: 'pending@example.com',
      });

      render(<AccountCard />);

      await waitFor(() => {
        expect(mockRefreshSession).toHaveBeenCalled();
        expect(mockRefreshProfile).toHaveBeenCalled();
        expect(mockShowToast).toHaveBeenCalledWith({
          message: 'Confirm the link sent to your other address',
          kind: 'success',
        });
      });

      expect(window.location.search).toBe('');
    });
  });

  describe('Offline handling', () => {
    it('disables inputs and buttons and shows offline message when offline', () => {
      vi.mocked(onlineModule.useOnlineStatus).mockReturnValue(false);

      render(<AccountCard />);

      expect(screen.getByText(/Account changes are disabled while offline/i)).toBeDefined();

      const emailInput = screen.getByLabelText(/^new email$/i, { selector: 'input' }) as HTMLInputElement;
      const currentPasswordInput = screen.getByLabelText(/^current password$/i, { selector: 'input' }) as HTMLInputElement;
      const newPasswordInput = screen.getByLabelText(/^new password$/i, { selector: 'input' }) as HTMLInputElement;
      const confirmPasswordInput = screen.getByLabelText(/^confirm new password$/i, { selector: 'input' }) as HTMLInputElement;

      expect(emailInput.disabled).toBe(true);
      expect(currentPasswordInput.disabled).toBe(true);
      expect(newPasswordInput.disabled).toBe(true);
      expect(confirmPasswordInput.disabled).toBe(true);

      const updateEmailBtn = screen.getByRole('button', { name: /update email/i }) as HTMLButtonElement;
      const changePasswordBtn = screen.getByRole('button', { name: /change password/i }) as HTMLButtonElement;

      expect(updateEmailBtn.disabled).toBe(true);
      expect(changePasswordBtn.disabled).toBe(true);
    });
  });
});
