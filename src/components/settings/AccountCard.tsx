import React, { useState, useEffect, useId } from 'react';
import { Shield, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { StatusBanner } from '../common/StatusBanner';
import { MIN_PASSWORD_LENGTH } from '../../constants/auth';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const AccountCard: React.FC = () => {
  const {
    user,
    changePassword,
    changeEmail,
    refreshSession,
    refreshProfile,
  } = useAuth();
  const { show: showToast } = useToast();
  const isOnline = useOnlineStatus();

  // Email state
  const [newEmail, setNewEmail] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [pendingEmailState, setPendingEmailState] = useState<string | null>(null);

  // Password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [nonce, setNonce] = useState('');
  const [needsReauth, setNeedsReauth] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Visibility toggles
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNextPassword, setShowNextPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Form input IDs
  const newEmailInputId = useId();
  const currentPasswordInputId = useId();
  const nextPasswordInputId = useId();
  const confirmPasswordInputId = useId();
  const nonceInputId = useId();

  // Detect pending email from user object or local state
  const pendingEmail =
    pendingEmailState ||
    (user as { new_email?: string } | null)?.new_email ||
    null;

  // Handle return redirect with ?email=changed
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const emailParam = params.get('email');
    if (!emailParam) return;

    if (emailParam === 'changed') {
      const handleReturn = async () => {
        let refreshedUser: { new_email?: string } | null = null;
        if (refreshSession) {
          refreshedUser = (await refreshSession()) as { new_email?: string } | null;
        }
        if (refreshProfile) {
          await refreshProfile();
        }

        const stillPending =
          refreshedUser?.new_email ||
          (user as { new_email?: string } | null)?.new_email;

        if (stillPending) {
          showToast({
            message: 'Confirm the link sent to your other address',
            kind: 'success',
          });
        } else {
          showToast({
            message: 'Email updated',
            kind: 'success',
          });
        }
      };
      void handleReturn();
    }

    params.delete('email');
    const newSearch = params.toString();
    const newUrl =
      window.location.pathname + (newSearch ? `?${newSearch}` : '') + window.location.hash;
    window.history.replaceState({}, '', newUrl);
  }, [refreshSession, refreshProfile, showToast, user]);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError(null);

    const trimmed = newEmail.trim().toLowerCase();
    if (!trimmed) {
      setEmailError('Please enter an email address');
      return;
    }

    if (!EMAIL_REGEX.test(trimmed)) {
      setEmailError('Please enter a valid email address');
      return;
    }

    if (user?.email && trimmed === user.email.toLowerCase()) {
      setEmailError('New email cannot be the same as current email');
      return;
    }

    if (!changeEmail) {
      setEmailError('Email change service unavailable');
      return;
    }

    setEmailLoading(true);
    const res = await changeEmail(trimmed);
    setEmailLoading(false);

    if (res.success) {
      const returnedPending = (res.user as { new_email?: string } | undefined)?.new_email || trimmed;
      setPendingEmailState(returnedPending);
      setNewEmail('');
      showToast({
        message: 'Confirmation link sent to your email',
        kind: 'success',
      });
    } else {
      setEmailError(res.error || 'Failed to update email');
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);

    if (!needsReauth) {
      if (!currentPassword) {
        setPasswordError('Please enter your current password');
        return;
      }

      if (nextPassword.length < MIN_PASSWORD_LENGTH) {
        setPasswordError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
        return;
      }

      if (nextPassword !== confirmPassword) {
        setPasswordError('Passwords do not match');
        return;
      }
    } else {
      if (!nonce.trim()) {
        setPasswordError('Enter the code we emailed you');
        return;
      }
    }

    if (!changePassword) {
      setPasswordError('Password change service unavailable');
      return;
    }

    setPasswordLoading(true);
    const res = await changePassword(
      currentPassword,
      nextPassword,
      needsReauth ? nonce.trim() : undefined
    );
    setPasswordLoading(false);

    if (res.success) {
      showToast({ message: 'Password changed', kind: 'success' });
      setCurrentPassword('');
      setNextPassword('');
      setConfirmPassword('');
      setNonce('');
      setNeedsReauth(false);
      setPasswordError(null);
    } else if (res.needsReauthentication) {
      setNeedsReauth(true);
      setPasswordError(null);
    } else {
      setPasswordError(res.error || 'Failed to change password');
    }
  };

  return (
    <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-3xl p-5 shadow-2xl space-y-6">
      <div className="flex items-center gap-2 border-b border-zinc-800 pb-3">
        <Shield className="w-4 h-4 text-cyan-400" />
        <h3 className="text-sm font-bold text-white uppercase tracking-wider">
          Account
        </h3>
      </div>

      {!isOnline && (
        <p className="text-xs text-amber-400 font-medium">
          Account changes are disabled while offline.
        </p>
      )}

      {/* Change Email Section */}
      <div className="space-y-3">
        <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
          Change Email
        </h4>
        <p className="text-xs text-zinc-400">
          We'll send a confirmation link to both your current and new address. The change takes effect after you confirm both.
        </p>

        {pendingEmail && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
            <p className="text-xs text-amber-400 font-medium">
              Pending: {pendingEmail} — check your inbox
            </p>
          </div>
        )}

        <StatusBanner
          message={emailError}
          tone="error"
          icon={<AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />}
        />

        <form onSubmit={handleEmailSubmit} noValidate className="space-y-3">
          <div>
            <label
              htmlFor={newEmailInputId}
              className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1"
            >
              New Email
            </label>
            <input
              id={newEmailInputId}
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="new.email@example.com"
              disabled={!isOnline || emailLoading}
              required
              className="w-full bg-zinc-950 border border-border-interactive text-white rounded-xl p-2.5 text-base font-semibold focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none transition disabled:opacity-50 min-h-[44px]"
            />
          </div>

          <button
            type="submit"
            disabled={!isOnline || emailLoading}
            className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-bold py-2.5 px-4 min-h-[44px] rounded-xl uppercase tracking-wider text-xs border border-zinc-700 active:scale-95 transition disabled:opacity-50 touch-manipulation"
          >
            {emailLoading ? 'Updating Email...' : 'Update Email'}
          </button>
        </form>
      </div>

      <div className="border-t border-zinc-800" />

      {/* Change Password Section */}
      <div className="space-y-3">
        <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
          Change Password
        </h4>

        <StatusBanner
          message={passwordError}
          tone="error"
          icon={<AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />}
        />

        <form onSubmit={handlePasswordSubmit} noValidate className="space-y-3">
          {!needsReauth ? (
            <>
              <div>
                <label
                  htmlFor={currentPasswordInputId}
                  className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1"
                >
                  Current Password
                </label>
                <div className="relative">
                  <input
                    id={currentPasswordInputId}
                    type={showCurrentPassword ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="••••••••"
                    disabled={!isOnline || passwordLoading}
                    required
                    className="w-full bg-zinc-950 border border-border-interactive text-white rounded-xl p-2.5 pr-12 text-base font-semibold focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none transition disabled:opacity-50 min-h-[44px]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    aria-label={showCurrentPassword ? 'Hide current password' : 'Show current password'}
                    disabled={!isOnline || passwordLoading}
                    className="absolute right-1 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition touch-manipulation disabled:opacity-50"
                  >
                    {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor={nextPasswordInputId}
                  className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1"
                >
                  New Password
                </label>
                <div className="relative">
                  <input
                    id={nextPasswordInputId}
                    type={showNextPassword ? 'text' : 'password'}
                    value={nextPassword}
                    onChange={(e) => setNextPassword(e.target.value)}
                    placeholder="••••••••"
                    disabled={!isOnline || passwordLoading}
                    required
                    className="w-full bg-zinc-950 border border-border-interactive text-white rounded-xl p-2.5 pr-12 text-base font-semibold focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none transition disabled:opacity-50 min-h-[44px]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNextPassword(!showNextPassword)}
                    aria-label={showNextPassword ? 'Hide new password' : 'Show new password'}
                    disabled={!isOnline || passwordLoading}
                    className="absolute right-1 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition touch-manipulation disabled:opacity-50"
                  >
                    {showNextPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor={confirmPasswordInputId}
                  className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1"
                >
                  Confirm New Password
                </label>
                <div className="relative">
                  <input
                    id={confirmPasswordInputId}
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    disabled={!isOnline || passwordLoading}
                    required
                    className="w-full bg-zinc-950 border border-border-interactive text-white rounded-xl p-2.5 pr-12 text-base font-semibold focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none transition disabled:opacity-50 min-h-[44px]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                    disabled={!isOnline || passwordLoading}
                    className="absolute right-1 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition touch-manipulation disabled:opacity-50"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div>
              <p className="text-xs text-cyan-400 font-medium mb-2">
                Enter the code we emailed you
              </p>
              <label
                htmlFor={nonceInputId}
                className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1"
              >
                Confirmation Code
              </label>
              <input
                id={nonceInputId}
                type="text"
                value={nonce}
                onChange={(e) => setNonce(e.target.value)}
                placeholder="Enter the code we emailed you"
                disabled={!isOnline || passwordLoading}
                required
                className="w-full bg-zinc-950 border border-border-interactive text-white rounded-xl p-2.5 text-base font-semibold focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none transition disabled:opacity-50 min-h-[44px]"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={!isOnline || passwordLoading}
            className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-bold py-2.5 px-4 min-h-[44px] rounded-xl uppercase tracking-wider text-xs border border-zinc-700 active:scale-95 transition disabled:opacity-50 touch-manipulation"
          >
            {passwordLoading
              ? 'Changing Password...'
              : needsReauth
              ? 'Confirm Code & Update Password'
              : 'Change Password'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default AccountCard;
