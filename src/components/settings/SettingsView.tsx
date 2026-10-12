import React, { useState, useId } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import type { UserProfile, UserRole } from '../../types/database';
import {
  Settings,
  User,
  Shield,
  Dumbbell,
  Timer,
  FileText,
  Utensils,
} from 'lucide-react';
import { CoachSettingsCard } from './CoachSettingsCard';
import { MyCoachCard } from './MyCoachCard';
import { MacroGoalsCard } from './MacroGoalsCard';
import { DataExportCard } from './DataExportCard';
import { DeleteAccountCard } from './DeleteAccountCard';
import { useToast } from '../../hooks/useToast';
import { WeightUnitCard } from './WeightUnitCard';
import { PrModeCard } from './PrModeCard';
import { SegmentedTabs, type TabItem } from '../common/SegmentedTabs';
import {
  useNutritionParserMode,
  type NutritionParserMode,
} from '../../hooks/useNutritionParserMode';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';

const REST_TIMER_OPTIONS: readonly { readonly value: number; readonly label: string }[] = [
  { value: 30, label: '30 s' },
  { value: 45, label: '45 s' },
  { value: 60, label: '60 s' },
  { value: 75, label: '75 s' },
  { value: 90, label: '90 s' },
  { value: 120, label: '2 min' },
  { value: 150, label: '2 min 30 s' },
  { value: 180, label: '3 min' },
  { value: 240, label: '4 min' },
  { value: 300, label: '5 min' },
] as const;

const SubscriptionCard = React.lazy(() => import('./SubscriptionCard'));
const AccountCard = React.lazy(() => import('./AccountCard'));
const OwnerDashboardCard = React.lazy(() => import('./OwnerDashboardCard'));

export const NutritionParserModeCard: React.FC = () => {
  const { mode, setMode } = useNutritionParserMode();

  const tabs: TabItem<NutritionParserMode>[] = [
    { id: 'auto', label: 'Auto', testId: 'nutrition-parser-mode-auto' },
    { id: 'always_ai', label: 'Always AI', testId: 'nutrition-parser-mode-always-ai' },
    { id: 'on_device', label: 'On-device only', testId: 'nutrition-parser-mode-on-device' },
  ];

  return (
    <div
      data-testid="nutrition-parser-mode-card"
      className="bg-zinc-900/90 border border-zinc-800/80 rounded-3xl p-5 shadow-2xl space-y-4"
    >
      <div className="flex items-center gap-2 border-b border-zinc-800 pb-3">
        <Utensils className="w-4 h-4 text-cyan-400" aria-hidden="true" />
        <h3 className="text-sm font-bold text-white uppercase tracking-wider">
          Nutrition parsing
        </h3>
      </div>

      <p className="text-xs text-zinc-400 leading-relaxed">
        Choose how meals and foods are parsed from text.
      </p>

      <SegmentedTabs<NutritionParserMode>
        ariaLabel="Nutrition parsing"
        tabs={tabs}
        activeTab={mode}
        onChange={(tabId) => setMode(tabId)}
        className="[&_button]:normal-case [&_button]:tracking-normal text-center [&_button]:leading-snug [&_button]:px-1.5"
      />
    </div>
  );
};

interface SettingsFormProps {
  profile: UserProfile | null;
  role: UserRole;
  isCoachMode?: boolean;
  updateProfile: (updates: Partial<UserProfile>) => Promise<{ success: boolean; error?: string }>;
  switchRole: (newRole: UserRole) => Promise<void>;
  refreshProfile?: () => Promise<void>;
}

const SettingsForm: React.FC<SettingsFormProps> = ({
  profile,
  role,
  isCoachMode = false,
  updateProfile,
  switchRole,
  refreshProfile,
}) => {
  const { show: showToast } = useToast();
  const isOnline = useOnlineStatus();
  const paywallEnabled = useFeatureFlag('paywall_enabled');
  const ownerDashboardEnabled = useFeatureFlag('owner_dashboard_enabled');
  const [username, setUsername] = useState(profile?.username || '');
  const [targetCalories, setTargetCalories] = useState(profile?.target_calories || 2200);
  const [targetProtein, setTargetProtein] = useState(profile?.target_protein || 160);
  const [targetCarbs, setTargetCarbs] = useState(profile?.target_carbs || 220);
  const [targetFat, setTargetFat] = useState(profile?.target_fat || 70);
  const [targetFiber, setTargetFiber] = useState(profile?.target_fiber ?? 30);
  const [autoRestTimer, setAutoRestTimer] = useState<boolean>(() => {
    if (profile?.auto_rest_timer !== undefined) return profile.auto_rest_timer;
    const localVal = localStorage.getItem('yourbody_auto_rest_timer');
    return localVal !== null ? localVal !== 'false' : true;
  });
  const [restTimerSeconds, setRestTimerSeconds] = useState<number>(() => {
    if (profile?.rest_timer_seconds !== undefined && profile.rest_timer_seconds !== null) {
      return profile.rest_timer_seconds;
    }
    const localVal = typeof localStorage !== 'undefined' ? localStorage.getItem('yourbody_rest_timer_seconds') : null;
    if (localVal !== null) {
      const parsed = Number(localVal);
      if (Number.isFinite(parsed) && parsed >= 15 && parsed <= 600) {
        return parsed;
      }
    }
    return 90;
  });
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const displayNameId = useId();
  const restTimerLabelId = useId();
  const restDurationSelectId = useId();

  // Coach Mode capability
  const hasCoachCapability = Boolean(profile?.role === 'coach' || profile?.is_coach_mode || isCoachMode);

  const handleToggleAutoTimer = async () => {
    if (!isOnline) return;
    const nextVal = !autoRestTimer;
    setAutoRestTimer(nextVal);
    localStorage.setItem('yourbody_auto_rest_timer', String(nextVal));

    try {
      await updateProfile({ auto_rest_timer: nextVal });
    } catch {
      // Graceful fallback: local state and localStorage already updated
    }
  };

  const handleRestDurationChange = async (nextVal: number) => {
    if (!isOnline) return;
    setRestTimerSeconds(nextVal);
    localStorage.setItem('yourbody_rest_timer_seconds', String(nextVal));

    try {
      await updateProfile({ rest_timer_seconds: nextVal });
    } catch {
      // Graceful fallback: local state and localStorage already updated
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatus(null);

    const res = await updateProfile({
      username,
      target_calories: Number(targetCalories),
      target_protein: Number(targetProtein),
      target_carbs: Number(targetCarbs),
      target_fat: Number(targetFat),
      target_fiber: Number(targetFiber),
      auto_rest_timer: autoRestTimer,
      rest_timer_seconds: restTimerSeconds,
    });

    if (res.success) {
      showToast({ message: 'Settings saved', kind: 'success', testId: 'settings-status-banner' });
      setStatus(null);
    } else {
      setStatus({ type: 'error', message: 'Failed to save settings: ' + (res.error || 'Unknown error') });
    }
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-cyan-500/10 via-blue-500/10 to-transparent border border-cyan-500/20 rounded-3xl p-5 shadow-2xl">
        <div className="flex items-center gap-2 mb-2">
          <Settings className="w-5 h-5 text-cyan-400" />
          <h2 className="text-base font-bold text-white uppercase tracking-wider">
            Settings
          </h2>
        </div>
        <p className="text-xs text-zinc-400">
          Manage your daily nutrition targets, account profile, and view mode.
        </p>
      </div>

      {/* Account Info & Role Switcher */}
      <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-3xl p-5 shadow-2xl space-y-4">
        <div className="flex items-center gap-2 border-b border-zinc-800 pb-3">
          <User className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Profile & Mode
          </h3>
        </div>

        <div className="space-y-3">
          <dl>
            <dt className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">
              Email Address
            </dt>
            <dd className="text-sm text-zinc-300 ml-0 py-1">
              {profile?.email || ''}
            </dd>
          </dl>

          <div>
            <label htmlFor={displayNameId} className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">
              Display Name
            </label>
            <input
              id={displayNameId}
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-zinc-950 border border-border-interactive text-white rounded-xl p-2.5 text-base font-semibold focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">
              {profile?.role === 'coach' ? 'Preview Mode (Coach Only)' : 'Account Role'}
            </label>
            {profile?.role === 'coach' ? (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => switchRole('athlete')}
                  className={`p-3 min-h-[44px] rounded-xl border flex items-center justify-center gap-2 text-xs font-bold transition touch-manipulation ${
                    role === 'athlete'
                      ? 'bg-cyan-500/15 border-cyan-500 text-cyan-300 shadow-neon-cyan'
                      : 'bg-zinc-950 border-border-interactive text-zinc-400 hover:border-zinc-700'
                  }`}
                >
                  <Dumbbell className="w-4 h-4" /> Athlete view
                </button>
                <button
                  type="button"
                  onClick={() => switchRole('coach')}
                  className={`p-3 min-h-[44px] rounded-xl border flex items-center justify-center gap-2 text-xs font-bold transition touch-manipulation ${
                    role === 'coach'
                      ? 'bg-cyan-500/15 border-cyan-500 text-cyan-300 shadow-neon-cyan'
                      : 'bg-zinc-950 border-border-interactive text-zinc-400 hover:border-zinc-700'
                  }`}
                >
                  <Shield className="w-4 h-4" /> Coach view
                </button>
              </div>
            ) : (
              <div className="p-3 min-h-[44px] bg-zinc-950/50 border border-zinc-800 rounded-xl text-xs font-bold text-zinc-400 flex items-center gap-2">
                <Dumbbell className="w-4 h-4 text-cyan-400" />
                <span className="capitalize">{profile?.role || 'Athlete'}</span>
                <span className="text-xs text-zinc-400 ml-auto">(Managed by Coach)</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Subscription Card */}
      {paywallEnabled && (
        <React.Suspense fallback={null}>
          <SubscriptionCard />
        </React.Suspense>
      )}

      {/* Owner Dashboard Card */}
      {ownerDashboardEnabled && (
        <React.Suspense fallback={null}>
          <OwnerDashboardCard />
        </React.Suspense>
      )}

      {/* Coach Mode Card */}
      <CoachSettingsCard
        profile={profile}
        hasCoachCapability={hasCoachCapability}
        refreshProfile={refreshProfile}
      />

      {/* My Coach Card */}
      <MyCoachCard
        profile={profile}
        refreshProfile={refreshProfile}
      />

      {/* Workout Preferences */}
      <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-3xl p-5 shadow-2xl space-y-4">
        <div className="flex items-center gap-2 border-b border-zinc-800 pb-3">
          <Timer className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Workout Preferences
          </h3>
        </div>

        <div className="flex items-center justify-between gap-4 p-3 bg-zinc-950/80 border border-zinc-800/80 rounded-2xl">
          <div className="space-y-0.5">
            <div id={restTimerLabelId} className="text-xs font-bold text-white">Auto-start Rest Timer on Set Log</div>
            <div className="text-xs text-zinc-400 leading-relaxed">
              Automatically start the countdown timer when logging any set.
            </div>
            {!isOnline && (
              <p className="text-xs text-amber-400 font-semibold" data-testid="offline-helper-text">
                Available when online
              </p>
            )}
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={autoRestTimer}
            aria-labelledby={restTimerLabelId}
            disabled={!isOnline}
            title={!isOnline ? 'Available when online' : undefined}
            data-testid="toggle-auto-timer"
            onClick={handleToggleAutoTimer}
            className={`relative inline-flex before:absolute before:-inset-y-2.5 before:inset-x-0 before:inset-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:min-w-[44px] before:min-h-[44px] before:content-[''] h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none touch-manipulation ${
              !isOnline ? 'opacity-50 cursor-not-allowed ' : 'cursor-pointer '
            }${
              autoRestTimer ? 'bg-cyan-500' : 'bg-zinc-800'
            }`}
          >
            <span
              aria-hidden="true"
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                autoRestTimer ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        <div className="flex items-center justify-between gap-4 p-3 bg-zinc-950/80 border border-zinc-800/80 rounded-2xl">
          <div className="space-y-0.5 min-w-0 flex-1">
            <label htmlFor={restDurationSelectId} className="block text-xs font-bold text-white">
              Rest timer length
            </label>
            <div className="text-xs text-zinc-400 leading-relaxed">
              Default duration for the rest countdown timer.
            </div>
            {!isOnline && (
              <p className="text-xs text-amber-400 font-semibold" data-testid="offline-helper-text-rest-duration">
                Available when online
              </p>
            )}
          </div>

          <select
            id={restDurationSelectId}
            data-testid="select-rest-duration"
            aria-label="Rest timer length"
            value={restTimerSeconds}
            disabled={!isOnline}
            title={!isOnline ? 'Available when online' : undefined}
            onChange={(e) => void handleRestDurationChange(Number(e.target.value))}
            className={`min-h-[44px] bg-zinc-900 border border-zinc-800 text-white text-xs font-bold rounded-xl px-3 py-2 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none shrink-0 touch-manipulation ${
              !isOnline ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
            }`}
          >
            {REST_TIMER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-zinc-950 text-white">
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Weight Unit Preference */}
      <WeightUnitCard />
      <PrModeCard />
      <NutritionParserModeCard />

      {/* Target Macros Form */}
      <MacroGoalsCard
        targetCalories={targetCalories}
        setTargetCalories={setTargetCalories}
        targetProtein={targetProtein}
        setTargetProtein={setTargetProtein}
        targetCarbs={targetCarbs}
        setTargetCarbs={setTargetCarbs}
        targetFat={targetFat}
        setTargetFat={setTargetFat}
        targetFiber={targetFiber}
        setTargetFiber={setTargetFiber}
        loading={loading}
        status={status}
        onSave={handleSave}
      />

      {/* Account Settings Card */}
      <React.Suspense fallback={null}>
        <AccountCard />
      </React.Suspense>

      {/* Data Export / Backup Card */}
      <DataExportCard
        profile={profile}
        hasCoachCapability={hasCoachCapability}
      />

      {/* Legal & Policies */}
      <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-3xl p-5 shadow-2xl space-y-3">
        <div className="flex items-center gap-2 border-b border-zinc-800 pb-3">
          <FileText className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Legal & Policies
          </h3>
        </div>
        <div className="flex flex-wrap gap-4 text-xs font-semibold text-zinc-400 pt-1">
          <Link to="/terms" className="inline-flex items-center min-h-[44px] hover:text-cyan-300 transition underline underline-offset-4">
            Terms of Service
          </Link>
          <Link to="/privacy" className="inline-flex items-center min-h-[44px] hover:text-cyan-300 transition underline underline-offset-4">
            Privacy Policy
          </Link>
          <Link to="/refunds" className="inline-flex items-center min-h-[44px] hover:text-cyan-300 transition underline underline-offset-4">
            Refund Policy
          </Link>
        </div>
      </div>

      {/* Delete Account Card (Danger Zone) */}
      <DeleteAccountCard />
    </div>
  );
};

export const SettingsView: React.FC = () => {
  const { profile, role, isCoachMode, updateProfile, switchRole, refreshProfile } = useAuth();

  return (
    <SettingsForm
      key={`${profile?.id || 'default'}-${profile?.target_calories}-${profile?.target_protein}-${profile?.target_carbs}-${profile?.target_fat}-${profile?.target_fiber}`}
      profile={profile}
      role={role}
      isCoachMode={isCoachMode}
      updateProfile={updateProfile}
      switchRole={switchRole}
      refreshProfile={refreshProfile}
    />
  );
};
