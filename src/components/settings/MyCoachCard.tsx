import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import type { UserProfile } from '../../types/database';
import {
  Users,
  UserMinus,
  UserPlus,
  AlertCircle,
} from 'lucide-react';
import { StatusBanner } from '../common/StatusBanner';
import { useToast } from '../../hooks/useToast';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { Skeleton } from '../common/Skeleton';
import { Button } from '../common/Button';
import { formatShortDate } from '../../utils/date';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

interface CoachJoinedInfo {
  username?: string | null;
  email?: string | null;
  coach_code?: string | null;
}

interface MyCoachCardProps {
  profile: UserProfile | null;
  refreshProfile?: () => Promise<void>;
}

export const MyCoachCard: React.FC<MyCoachCardProps> = ({
  profile,
  refreshProfile,
}) => {
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();

  // Athlete: My Coach Link query
  const {
    data: coachLink,
    isLoading: isCoachLinkLoading,
    isError: isCoachLinkError,
    error: coachLinkError,
    refetch: refetchCoachLink,
  } = useQuery({
    queryKey: ['my_coach_link', profile?.id],
    enabled: Boolean(profile?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coach_athlete_links')
        .select('id, coach_id, linked_at, coach:users!coach_id(username, email, coach_code)')
        .eq('athlete_id', profile!.id)
        .eq('status', 'active')
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Link / Disconnect Coach state
  const { show: showToast } = useToast();
  const [linkCodeInput, setLinkCodeInput] = useState('');
  const [linkStatus, setLinkStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isLinking, setIsLinking] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isDisconnectConfirmOpen, setIsDisconnectConfirmOpen] = useState(false);

  const handleLinkCoach = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOnline) {
      setLinkStatus({ type: 'error', message: 'Available when online' });
      return;
    }
    const trimmed = linkCodeInput.trim().toUpperCase();
    if (!trimmed) return;

    setIsLinking(true);
    setLinkStatus(null);
    try {
      const { data, error } = await supabase.rpc('link_to_coach', { input_code: trimmed });
      if (error) throw error;
      if (data && (data as any).success === false) {
        throw new Error((data as { error?: string } | null)?.error || 'Failed to link to coach.');
      }
      showToast({ message: 'Successfully linked to coach!', kind: 'success', testId: 'link-coach-status' });
      setLinkStatus(null);
      setLinkCodeInput('');
      
      queryClient.invalidateQueries({ queryKey: ['my_coach_link'] });
      queryClient.invalidateQueries({ queryKey: ['routine_templates'] });
      queryClient.invalidateQueries({ queryKey: ['workouts'] });
      queryClient.invalidateQueries({ queryKey: ['nutrition_logs'] });

      await refetchCoachLink();
      if (refreshProfile) await refreshProfile();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : (err as { message?: string })?.message || 'Failed to link to coach.';
      setLinkStatus({ type: 'error', message });
    } finally {
      setIsLinking(false);
    }
  };

  const handleConfirmDisconnect = async () => {
    if (!isOnline || isDisconnecting) return;
    setIsDisconnectConfirmOpen(false);
    setIsDisconnecting(true);
    setLinkStatus(null);
    try {
      const { error } = await supabase.rpc('disconnect_coach');
      if (error) throw error;
      showToast({ message: 'Successfully disconnected from coach.', kind: 'success', testId: 'link-coach-status' });
      setLinkStatus(null);
      
      queryClient.invalidateQueries({ queryKey: ['my_coach_link'] });
      queryClient.invalidateQueries({ queryKey: ['routine_templates'] });
      queryClient.invalidateQueries({ queryKey: ['workouts'] });
      queryClient.invalidateQueries({ queryKey: ['nutrition_logs'] });

      await refetchCoachLink();
      if (refreshProfile) await refreshProfile();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : (err as { message?: string })?.message || 'Failed to disconnect from coach.';
      setLinkStatus({ type: 'error', message });
    } finally {
      setIsDisconnecting(false);
    }
  };

  const coachData = (
    Array.isArray(coachLink?.coach) ? coachLink.coach[0] : coachLink?.coach
  ) as CoachJoinedInfo | null | undefined;
  const coachName = coachData?.username || coachData?.email || 'your coach';

  return (
    <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-3xl p-5 shadow-2xl space-y-4">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            My Coach
          </h3>
        </div>
        {coachLink && (
          <span className="text-xs font-bold bg-emerald-500/20 text-emerald-300 px-2.5 py-1 rounded-full border border-emerald-500/30">
            Linked
          </span>
        )}
      </div>

      {isCoachLinkError ? (
        <StatusBanner
          testId="coach-link-query-error"
          tone="error"
          message={coachLinkError instanceof Error ? coachLinkError.message : 'Failed to load coaching status.'}
          icon={<AlertCircle className="w-4 h-4 shrink-0 text-rose-400" aria-hidden="true" />}
          action={
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => refetchCoachLink()}
              testId="coach-link-retry-btn"
            >
              Retry
            </Button>
          }
        />
      ) : !profile?.id || isCoachLinkLoading ? (
        <Skeleton
          variant="card"
          ariaLabel="Loading coaching status..."
          testId="coach-link-loading"
        />
      ) : coachLink ? (
        <div className="space-y-3">
          <div className="bg-zinc-950/80 border border-zinc-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                Assigned Coach
              </div>
              <div className="text-sm font-bold text-white mt-0.5" data-testid="assigned-coach-name">
                {coachData?.username || coachData?.email || 'Coach'}
              </div>
              <div className="text-xs text-zinc-400 tabular-nums">
                Code: <span className="text-cyan-400 font-bold tracking-wider">{coachData?.coach_code || 'N/A'}</span>
                {coachLink.linked_at && (
                  <span className="ml-2 text-zinc-400">
                    • Linked {formatShortDate(coachLink.linked_at)}
                  </span>
                )}
              </div>
            </div>

            {!isOnline && (
              <p className="text-xs text-amber-400 font-semibold w-full" data-testid="offline-helper-text">
                Available when online
              </p>
            )}

            <button
              type="button"
              onClick={() => setIsDisconnectConfirmOpen(true)}
              disabled={isDisconnecting || !isOnline}
              title={!isOnline ? 'Available when online' : undefined}
              className="bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 px-4 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 min-h-[44px] touch-manipulation w-full sm:w-auto disabled:opacity-50"
              data-testid="disconnect-coach-btn"
            >
              <UserMinus className="w-4 h-4" />
              {isDisconnecting ? 'Disconnecting...' : 'Disconnect coach'}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleLinkCoach} className="space-y-3">
          <p className="text-xs text-zinc-400">
            Enter your coach's code to link your account. Your coach will configure your workout routines and monitor nutrition targets.
          </p>
          {!isOnline && (
            <p className="text-xs text-amber-400 font-semibold" data-testid="offline-helper-text">
              Available when online
            </p>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={linkCodeInput}
              onChange={(e) => setLinkCodeInput(e.target.value.toUpperCase())}
              placeholder="e.g. YB-DEMO01"
              maxLength={20}
              disabled={!isOnline || isLinking}
              title={!isOnline ? 'Available when online' : undefined}
              className="flex-1 min-w-0 bg-zinc-950 border border-border-interactive text-white rounded-xl px-3 py-2 text-base font-bold focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none uppercase min-h-[44px] disabled:opacity-50"
              data-testid="link-coach-code-input"
              required
            />
            <button
              type="submit"
              disabled={isLinking || !linkCodeInput.trim() || !isOnline}
              title={!isOnline ? 'Available when online' : undefined}
              className="shrink-0 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold px-4 py-2 min-h-[44px] rounded-xl text-xs shadow-neon-cyan transition disabled:opacity-50 touch-manipulation flex items-center gap-1.5"
              data-testid="link-coach-btn"
            >
              <UserPlus className="w-4 h-4" />
              {isLinking ? 'Linking...' : 'Link coach'}
            </button>
          </div>
        </form>
      )}

      <StatusBanner
        testId="link-coach-status"
        message={linkStatus?.type === 'error' ? linkStatus.message : null}
        tone="error"
        icon={<AlertCircle className="w-4 h-4 shrink-0 text-rose-400" aria-hidden="true" />}
      />

      <ConfirmDialog
        isOpen={isDisconnectConfirmOpen}
        onCancel={() => setIsDisconnectConfirmOpen(false)}
        onConfirm={handleConfirmDisconnect}
        title="Disconnect coach"
        consequence={`Are you sure you want to disconnect from ${coachName}? They will no longer be able to manage your workout routines or monitor your nutrition targets.`}
        confirmLabel="Disconnect"
        cancelLabel="Cancel"
        isDestructive
        isLoading={isDisconnecting}
        testId="disconnect-coach-confirm-dialog"
      />
    </div>
  );
};
