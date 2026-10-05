import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { pendingBeforeSignOut } from '../../offline';
import { SyncStatusSheet } from '../sync/SyncStatusSheet';
import { useOutboxStatus } from '../sync/useOutboxStatus';
import { ConfirmDialog } from './ConfirmDialog';
import { Zap, Shield, LogOut, LayoutDashboard } from 'lucide-react';

export const Header: React.FC = () => {
  const { user, profile, role, signOut, switchRole } = useAuth();
  const isOnline = useOnlineStatus();
  const navigate = useNavigate();
  const location = useLocation();

  const summary = useOutboxStatus(user?.id);
  const pending = summary.pending;
  const attention = summary.attention;
  const syncing = summary.syncing;
  const authRequired = summary.authRequired;

  const [isSyncSheetOpen, setIsSyncSheetOpen] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [unsyncedSignOutCount, setUnsyncedSignOutCount] = useState(0);

  const isVerifiedCoach = profile?.role === 'coach';
  const isCoachMode = role === 'coach';
  const isOffCoach = location.pathname.replace(/\/$/, '') !== '/coach';
  const showCoachDashboard = Boolean(user && isVerifiedCoach && isCoachMode && isOffCoach);

  const handleToggleRole = () => {
    const nextRole = role === 'coach' ? 'athlete' : 'coach';
    switchRole(nextRole);
    if (nextRole === 'coach') {
      navigate('/coach');
    } else {
      navigate('/workout');
    }
  };

  let statusText = 'Online';
  let badgeTone: 'online' | 'offline' | 'syncing' | 'attention' | 'authRequired' = 'online';

  if (authRequired) {
    statusText = 'Sign in to sync';
    badgeTone = 'authRequired';
  } else if (attention > 0) {
    statusText = `${attention} need attention`;
    badgeTone = 'attention';
  } else if (!isOnline) {
    statusText = pending > 0 ? `Offline · ${pending} pending` : 'Offline';
    badgeTone = 'offline';
  } else if (syncing) {
    statusText = `Syncing · ${pending}`;
    badgeTone = 'syncing';
  } else {
    statusText = 'Online';
    badgeTone = 'online';
  }

  const handleSignOutClick = async () => {
    if (!user?.id) {
      await signOut();
      return;
    }

    try {
      const dbCount = await pendingBeforeSignOut(user.id);
      const cachedCount = summary.pending + summary.attention;
      const count = Math.max(dbCount, cachedCount);
      if (count === 0) {
        await signOut();
      } else {
        setUnsyncedSignOutCount(count);
        setShowSignOutConfirm(true);
      }
    } catch (e) {
      console.warn('[Header] Error checking pending outbox before sign out', e);
      setUnsyncedSignOutCount(1);
      setShowSignOutConfirm(true);
    }
  };

  const handleConfirmSignOut = async () => {
    setShowSignOutConfirm(false);
    await signOut();
  };

  return (
    <>
      <header className="bg-zinc-900/90 backdrop-blur-xl border-b border-zinc-800/80 sticky top-0 z-30 pt-[max(env(safe-area-inset-top),12px)] pb-3 shadow-lg">
        <div className="max-w-xl mx-auto px-4 flex items-center justify-between">
          {/* Brand */}
          <Link
            to="/workout"
            className="flex items-center gap-2 min-w-0 min-h-[44px] group relative before:absolute before:inset-0 before:min-w-[44px] before:min-h-[44px] before:content-['']"
          >
            <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <Zap className="w-3.5 h-3.5 text-zinc-950 fill-zinc-950" />
            </div>
            <div className="min-w-0">
              <h1 className="font-bold tracking-tight sm:tracking-normal text-sm sm:text-base text-zinc-50 leading-none">
                Yourbody.fyi
              </h1>
              <div
                className={`text-xs font-semibold tracking-normal text-cyan-400/70 mt-0.5 truncate max-[359px]:hidden ${
                  showCoachDashboard ? 'max-[379px]:hidden' : ''
                }`}
              >
                Fitness & Nutrition
              </div>
            </div>
          </Link>

          {/* Right Action Badges */}
          <div className="flex items-center gap-0 min-[360px]:gap-1 sm:gap-2 shrink-0">
            {showCoachDashboard && (
              <Link
                to="/coach"
                data-testid="coach-dashboard-link"
                aria-label="Coach dashboard"
                title="Coach dashboard"
                className="min-w-[44px] min-h-[44px] flex items-center justify-center transition touch-manipulation focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 focus:ring-offset-zinc-900 group"
              >
                <span className="w-9 h-9 rounded-full flex items-center justify-center text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors">
                  <LayoutDashboard className="w-4 h-4" aria-hidden="true" />
                </span>
              </Link>
            )}

            {/* Connection Status Badge Button (A10) */}
            <button
              type="button"
              onClick={() => setIsSyncSheetOpen(true)}
              data-testid="connection-status"
              title={statusText}
              aria-label={`Connection status: ${statusText}`}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center transition touch-manipulation cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 focus:ring-offset-zinc-900"
            >
              {badgeTone === 'online' ? (
                <span className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-zinc-800 transition-colors">
                  <span
                    aria-hidden="true"
                    className="w-2 h-2 rounded-full bg-emerald-500 inline-block shrink-0"
                  />
                  <span
                    role="status"
                    aria-live="polite"
                    className="sr-only"
                  >
                    {statusText}
                  </span>
                </span>
              ) : (
                <span
                  className={`h-9 rounded-full border text-xs font-bold flex items-center justify-center gap-1.5 px-2.5 ${
                    isCoachMode ? 'max-sm:w-9 max-sm:px-0' : 'max-[359px]:w-9 max-[359px]:px-0'
                  } transition-colors ${
                    badgeTone === 'syncing'
                      ? 'text-cyan-300 bg-cyan-500/15 border-cyan-500/30'
                      : 'text-amber-400 bg-amber-500/10 border-amber-500/30'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`w-2 h-2 rounded-full inline-block shrink-0 ${
                      badgeTone === 'syncing'
                        ? 'bg-cyan-400 animate-spin'
                        : 'bg-amber-500'
                    }`}
                  />
                  <span
                    role="status"
                    aria-live="polite"
                    className={`${
                      isCoachMode ? 'max-sm:sr-only' : 'max-[359px]:sr-only'
                    } inline`}
                  >
                    {statusText}
                  </span>
                </span>
              )}
            </button>

            {/* Role Pill Switcher (Interactive only for verified coaches) */}
            {user && (
              isVerifiedCoach ? (
                <button
                  type="button"
                  onClick={handleToggleRole}
                  data-testid="role-switch-button"
                  aria-label={
                    role === 'coach'
                      ? 'Coach mode active. Switch to Athlete mode.'
                      : 'Athlete mode active. Switch to Coach mode.'
                  }
                  title={role === 'coach' ? 'Switch to Athlete mode' : 'Switch to Coach mode'}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center transition touch-manipulation focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 focus:ring-offset-zinc-900"
                >
                  <span
                    className={`h-9 rounded-full text-xs font-bold flex items-center justify-center w-9 sm:w-auto sm:px-3.5 sm:gap-1.5 transition-colors ${
                      role === 'coach'
                        ? 'text-cyan-300 bg-cyan-500/15 border border-cyan-500/30 hover:bg-cyan-500/25'
                        : 'text-zinc-300 hover:text-white hover:bg-zinc-800'
                    }`}
                  >
                    {role === 'coach' ? (
                      <>
                        <Shield className="w-4 h-4 text-cyan-400 shrink-0" aria-hidden="true" />
                        <span className="max-sm:sr-only">Coach</span>
                      </>
                    ) : (
                      <>
                        <Zap className="w-4 h-4 text-zinc-400 shrink-0" aria-hidden="true" />
                        <span className="max-sm:sr-only">Athlete</span>
                      </>
                    )}
                  </span>
                </button>
              ) : (
                <div
                  className="hidden sm:flex text-xs font-bold px-2.5 h-9 rounded-full border text-zinc-400 bg-zinc-800/80 border-zinc-700/80 items-center gap-1.5 select-none"
                  title="Athlete Account"
                >
                  <Zap className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
                  <span>Athlete</span>
                </div>
              )
            )}

            {/* User / Sign Out */}
            {user && (
              <button
                type="button"
                onClick={handleSignOutClick}
                data-testid="sign-out-button"
                className="min-w-[44px] min-h-[44px] flex items-center justify-center transition touch-manipulation focus:outline-none focus:ring-2 focus:ring-rose-500"
                title="Sign Out"
                aria-label="Sign Out"
              >
                <span className="w-9 h-9 rounded-full flex items-center justify-center text-zinc-300 hover:text-rose-400 hover:bg-rose-500/10 transition-colors">
                  <LogOut className="w-4 h-4" aria-hidden="true" />
                </span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Sync Status Sheet (A10) */}
      <SyncStatusSheet
        isOpen={isSyncSheetOpen}
        onClose={() => setIsSyncSheetOpen(false)}
      />

      {/* Sign Out Unsynced Warning Dialog (A9) */}
      <ConfirmDialog
        isOpen={showSignOutConfirm}
        title="Unsynced changes"
        consequence={`${unsyncedSignOutCount} unsynced changes stay on this device and sync the next time you sign in as ${user?.email || 'this user'}. Sign out?`}
        confirmLabel="Sign out anyway"
        cancelLabel="Stay signed in"
        isDestructive={true}
        testId="sign-out-confirm-dialog"
        onConfirm={handleConfirmSignOut}
        onCancel={() => setShowSignOutConfirm(false)}
      />
    </>
  );
};

export default Header;
