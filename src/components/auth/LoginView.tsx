import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { Zap, AlertCircle, Eye, EyeOff, CheckCircle2, ArrowLeft } from 'lucide-react';
import { StatusBanner } from '../common/StatusBanner';
import { isTermsConsentEnabled, CURRENT_TERMS_VERSION } from '../../config/features';

type AuthMode = 'signin' | 'register' | 'check_email' | 'forgot_password';

export const LoginView: React.FC = () => {
  const { signIn, signUp, requestPasswordReset, resendConfirmation } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [termsAccepted, setTermsAccepted] = useState(false);

  useEffect(() => {
    let timer: any;
    if (cooldown > 0) {
      timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfoMsg('');
    setLoading(true);

    if (mode === 'register') {
      if (password.length < 6) {
        setError('Password must be at least 6 characters');
        setLoading(false);
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match');
        setLoading(false);
        return;
      }
      if (isTermsConsentEnabled() && !termsAccepted) {
        setError('You must agree to the Terms of Service and Privacy Policy');
        setLoading(false);
        return;
      }
      const res = await signUp(
        email,
        password,
        'athlete',
        isTermsConsentEnabled() ? CURRENT_TERMS_VERSION : undefined
      );
      if (res.success && res.needsEmailConfirmation) {
        setInfoMsg(res.message || 'Account created! Please check your email to verify your account.');
        setMode('check_email');
      } else if (res.success) {
        navigate('/workout');
      } else {
        setError(res.error || 'Failed to sign up');
      }
    } else if (mode === 'forgot_password') {
      const res = await requestPasswordReset(email);
      if (res.success) {
        setInfoMsg('Password reset link sent! Check your inbox.');
      } else {
        setError(res.error || 'Failed to send reset link');
      }
    } else if (mode === 'signin') {
      const res = await signIn(email, password);
      // Wait, need to route coach to /coach and athlete to /workout on signIn according to the test!
      if (res.success) {
        if (res.role === 'coach') {
          navigate('/coach');
        } else {
          navigate('/workout');
        }
      } else {
        setError(res.error || 'Failed to sign in');
      }
    }
    setLoading(false);
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    setError('');
    setInfoMsg('');
    setLoading(true);
    const res = await resendConfirmation(email);
    if (res.success) {
      setInfoMsg('Confirmation email resent!');
      setCooldown(60);
    } else {
      setError(res.error || 'Failed to resend confirmation');
    }
    setLoading(false);
  };

  return (
    <div className="max-w-md w-full mx-auto px-4 py-8">
      {/* Brand card */}
      <div className="text-center mb-8">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-[0_0_25px_rgba(6,182,212,0.4)] mx-auto mb-3">
          <Zap className="w-8 h-8 text-zinc-950 fill-zinc-950" />
        </div>
        <h1 className="text-2xl font-bold tracking-wider bg-gradient-to-r from-white via-zinc-200 to-zinc-400 bg-clip-text text-transparent">
          Yourbody.fyi
        </h1>
        <p className="text-xs text-zinc-400 tracking-wider mt-1 uppercase">
          Fitness & Nutrition
        </p>
      </div>

      <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-3xl p-6 shadow-2xl backdrop-blur-xl">
        {(mode === 'signin' || mode === 'register') && (
          <div className="flex bg-zinc-950 p-1 rounded-2xl border border-zinc-800/80 mb-5 gap-1">
            <button
              type="button"
              onClick={() => {
                setMode('signin');
                setError('');
                setTermsAccepted(false);
              }}
              className={`flex-1 py-2 min-h-[44px] text-xs font-bold uppercase tracking-wider rounded-xl transition flex items-center justify-center touch-manipulation ${
                mode === 'signin'
                  ? 'bg-cyan-500 text-black shadow-neon-cyan'
                  : 'text-zinc-400 hover:text-white bg-transparent'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError('');
                setTermsAccepted(false);
              }}
              className={`flex-1 py-2 min-h-[44px] text-xs font-bold uppercase tracking-wider rounded-xl transition flex items-center justify-center touch-manipulation ${
                mode === 'register'
                  ? 'bg-cyan-500 text-black shadow-neon-cyan'
                  : 'text-zinc-400 hover:text-white bg-transparent'
              }`}
            >
              Register
            </button>
          </div>
        )}

        <StatusBanner
          message={error || null}
          tone="error"
          icon={<AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />}
          className="mb-4"
        />

        <StatusBanner
          message={infoMsg || null}
          tone="info"
          icon={
            mode === 'check_email' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            )
          }
          className="mb-4"
        />

        {mode === 'check_email' ? (
          <div className="space-y-6 text-center">
            <p className="text-zinc-300 text-sm">
              We've sent a verification link to <span className="font-bold text-white">{email}</span>.
            </p>
            <button
              onClick={handleResend}
              disabled={loading || cooldown > 0}
              className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-bold min-h-[44px] py-3 rounded-xl uppercase tracking-wider text-xs transition disabled:opacity-50"
            >
              {cooldown > 0 ? `Resend Available in ${cooldown}s` : 'Resend Confirmation Email'}
            </button>
            <button
              onClick={() => {
                setMode('signin');
                setError('');
                setInfoMsg('');
              }}
              className="w-full flex items-center justify-center gap-2 text-zinc-400 hover:text-white text-xs font-bold uppercase tracking-wider transition"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Sign In
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="login-email"
                className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1.5"
              >
                Email Address
              </label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="w-full bg-zinc-950 border border-border-interactive text-white rounded-xl p-3 text-base sm:text-sm font-semibold focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none transition"
                required
              />
            </div>

            {(mode === 'signin' || mode === 'register') && (
              <div>
                <label
                  htmlFor="login-password"
                  className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1.5"
                >
                  Password
                </label>
                <div className="relative">
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete={mode === 'register' ? "new-password" : "current-password"}
                    className="w-full bg-zinc-950 border border-border-interactive text-white rounded-xl p-3 pr-12 text-base sm:text-sm font-semibold focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none transition"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-1 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition touch-manipulation"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}

            {mode === 'register' && (
              <div>
                <label
                  htmlFor="login-confirm-password"
                  className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1.5"
                >
                  Confirm Password
                </label>
                <div className="relative">
                  <input
                    id="login-confirm-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    className="w-full bg-zinc-950 border border-border-interactive text-white rounded-xl p-3 pr-12 text-base sm:text-sm font-semibold focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none transition"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                    className="absolute right-1 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition touch-manipulation"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}

            {mode === 'register' && isTermsConsentEnabled() && (
              <div className="flex items-start gap-2.5 pt-1">
                <input
                  id="login-terms-consent"
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  required
                  className="mt-1 h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-zinc-900 cursor-pointer"
                />
                <label
                  htmlFor="login-terms-consent"
                  className="text-xs text-zinc-400 leading-relaxed cursor-pointer select-none"
                >
                  I agree to the{' '}
                  <a
                    href="/terms"
                    target="_blank"
                    rel="noopener"
                    className="text-cyan-400 hover:text-cyan-300 underline"
                  >
                    Terms of Service
                  </a>{' '}
                  and{' '}
                  <a
                    href="/privacy"
                    target="_blank"
                    rel="noopener"
                    className="text-cyan-400 hover:text-cyan-300 underline"
                  >
                    Privacy Policy
                  </a>
                </label>
              </div>
            )}

            {mode === 'signin' && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setMode('forgot_password');
                    setError('');
                    setInfoMsg('');
                  }}
                  className="text-xs font-bold text-cyan-500 hover:text-cyan-400 transition"
                >
                  Forgot Password?
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || (mode === 'register' && isTermsConsentEnabled() && !termsAccepted)}
              className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold py-3 min-h-[44px] rounded-xl uppercase tracking-wider text-xs shadow-[0_0_15px_rgba(6,182,212,0.3)] active:scale-95 transition disabled:opacity-50"
            >
              {loading ? (mode === 'register' ? 'Creating Account...' : mode === 'signin' ? 'Signing in...' : 'Processing...') : (
                mode === 'register' ? 'Create Account' : mode === 'signin' ? 'Sign In' : 'Send Reset Link'
              )}
            </button>
          </form>
        )}

        {mode === 'forgot_password' && (
          <div className="mt-6 text-center">
            <button
              onClick={() => {
                setMode('signin');
                setError('');
                setInfoMsg('');
              }}
              className="flex items-center justify-center gap-2 text-zinc-400 hover:text-white text-xs font-bold uppercase tracking-wider transition w-full"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Sign In
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
