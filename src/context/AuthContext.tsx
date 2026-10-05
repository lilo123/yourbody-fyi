import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import type { User } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { UserProfile, UserRole } from '../types/database';
import type { PrMode } from '../lib/prComparator';

import { AuthContext, type AuthContextType } from './AuthContextTypes';
import { restTimerStore } from '../utils/restTimerStore';
import { dedupeInFlight } from '../utils/promiseDedupe';
import {
  setAuthRequiredStatus,
  getAuthRequiredStatus,
  initPersistForUser,
  stopPersisting,
  clearUserReadCache,
  flushNow,
  getCachedOutboxSummary,
  setFlusherSessionUser,
} from '../offline';

export const AUTH_STORAGE_PREFIX = 'yourbody_';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [profile, setProfile] = useState<UserProfile | null>(() => {
    try {
      const cached = localStorage.getItem('yourbody_user');
      return cached ? (JSON.parse(cached) as UserProfile) : null;
    } catch {
      return null;
    }
  });
  const [user, setUser] = useState<User | null>(() => {
    try {
      const cached = localStorage.getItem('yourbody_user');
      if (cached) {
        const parsed = JSON.parse(cached) as UserProfile;
        if (parsed?.id) {
          return {
            id: parsed.id,
            email: parsed.email,
            app_metadata: {},
            user_metadata: { username: parsed.username },
            aud: 'authenticated',
            created_at: '',
          } as unknown as User;
        }
      }
    } catch {
      // Fall through to null
    }
    return null;
  });
  const [loading, setLoading] = useState<boolean>(() => {
    try {
      const cached = localStorage.getItem('yourbody_user');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed?.id) return false;
      }
    } catch {
      // Fall through
    }
    return true;
  });
  const [viewMode, setViewMode] = useState<UserRole>(() => {
    return (localStorage.getItem('yourbody_view_mode') as UserRole) || 'coach';
  });

  const signedOutRef = useRef(false);
  const isRevalidatingRef = useRef(false);
  const userRef = useRef<User | null>(user);
  const queryClient = useQueryClient();

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const markAuthValid = useCallback((validUserId?: string | null) => {
    if (getAuthRequiredStatus()) {
      setAuthRequiredStatus(false);
      const targetId = validUserId || undefined;
      flushNow(targetId).catch((err) => {
        console.warn('[AuthContext] flushNow after auth recovery error:', err);
      });
    }
  }, []);

  const syncUserTimezone = useCallback(async (userId: string, force = false) => {
    return dedupeInFlight(`timezone:${userId}`, async () => {
      try {
        const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const storageKey = `yourbody_user_timezone_${userId}`;
        const cachedZone = typeof window !== 'undefined' && window.localStorage ? localStorage.getItem(storageKey) : null;
        if (deviceZone && (force || cachedZone !== deviceZone)) {
          const { error: tzErr } = await supabase
            .from('users')
            .update({ timezone: deviceZone })
            .eq('id', userId);

          if (tzErr) {
            console.warn('[AuthContext] Failed to sync timezone:', tzErr);
          } else if (typeof window !== 'undefined' && window.localStorage) {
            localStorage.setItem(storageKey, deviceZone);
          }
        }
      } catch (tzCatchErr) {
        console.warn('[AuthContext] Could not resolve device timezone:', tzCatchErr);
      }
    });
  }, []);

  const fetchProfile = useCallback(async (userId: string, email?: string) => {
    return dedupeInFlight(`profile:${userId}`, async () => {
      try {
        const { data, error } = await (supabase
          .from('users') as any)
          .select('id, email, username, role, target_calories, target_protein, target_carbs, target_fat, target_fiber, auto_rest_timer, is_coach_mode, coach_code, coach_tier, max_athletes, created_at, timezone, weight_unit, pr_mode')
          .eq('id', userId)
          .single();

        if (signedOutRef.current) return;

        if (data && !error) {
          let deviceZone: string | undefined;
          try {
            deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
          } catch {
            // ignore
          }
          if (deviceZone && data.timezone !== deviceZone) {
            syncUserTimezone(userId, true);
          }
          const prModeVal: PrMode = (data as any)?.pr_mode === 'e1rm' ? 'e1rm' : 'weight';

          const storedTz = typeof window !== 'undefined' && window.localStorage ? localStorage.getItem(`yourbody_user_timezone_${userId}`) : null;
          const userWithTz = {
            ...data,
            timezone: data.timezone || storedTz || deviceZone || null,
            pr_mode: prModeVal,
          } as UserProfile;
          setProfile(userWithTz);
          localStorage.setItem('yourbody_user', JSON.stringify(userWithTz));
          if (data.auto_rest_timer !== undefined && data.auto_rest_timer !== null) {
            localStorage.setItem('yourbody_auto_rest_timer', String(data.auto_rest_timer));
          }
          if (data.role === 'coach') {
            const savedMode = localStorage.getItem('yourbody_view_mode') as UserRole;
            if (!savedMode) {
              setViewMode('coach');
              localStorage.setItem('yourbody_view_mode', 'coach');
            }
          }
        } else {
          let deviceZone: string | undefined;
          try {
            deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
          } catch {
            // ignore
          }
          const fallbackProfile: UserProfile = {
            id: userId,
            email: email || 'user@example.com',
            username: email ? email.split('@')[0] : 'athlete',
            role: 'athlete',
            target_calories: 2200,
            target_protein: 160,
            target_carbs: 220,
            target_fat: 70,
            target_fiber: 30,
            auto_rest_timer: true,
            timezone: deviceZone || null,
            weight_unit: 'lb',
            pr_mode: 'weight',
          };
          setProfile(fallbackProfile);
          localStorage.setItem('yourbody_user', JSON.stringify(fallbackProfile));
        }
      } catch {
        // Retain current profile
      }
    });
  }, [syncUserTimezone]);

  useEffect(() => {
    let mounted = true;

    type SessionRaceResult =
      | { kind: 'session'; session: any }
      | { kind: 'timeout' };

    const resolveSession = async () => {
      if (isRevalidatingRef.current) return;
      isRevalidatingRef.current = true;

      try {
        const result: SessionRaceResult = await Promise.race([
          supabase.auth
            .getSession()
            .then(({ data: { session } }) => ({
              kind: 'session' as const,
              session,
            }))
            .catch((err) => {
              console.warn('[AuthContext] getSession rejection:', err);
              return { kind: 'timeout' as const };
            }),
          new Promise<SessionRaceResult>((resolve) =>
            setTimeout(
              () => resolve({ kind: 'timeout' as const }),
              3000
            )
          ),
        ]);

        if (!mounted) return;

        if (result.kind === 'session') {
          if (result.session?.user) {
            signedOutRef.current = false;
            userRef.current = result.session.user;
            setUser(result.session.user);
            markAuthValid(result.session.user.id);
            setLoading(false);
            syncUserTimezone(result.session.user.id);
            fetchProfile(result.session.user.id, result.session.user.email).catch((err) => {
              console.warn('[AuthContext] Background fetchProfile error:', err);
            });
            return;
          } else {
            // A8: Do NOT clear user when offline
            if (typeof navigator !== 'undefined' && !navigator.onLine) {
              setLoading(false);
              return;
            }
            // Explicitly unauthenticated or expired/invalid session while online
            userRef.current = null;
            setUser(null);
            setProfile(null);
            localStorage.removeItem('yourbody_user');
            setLoading(false);
            return;
          }
        }

        if (result.kind === 'timeout') {
          console.warn(
            '[AuthContext] getSession timed out after 3000ms. Utilizing cached credentials if available.'
          );
          try {
            const cached = localStorage.getItem('yourbody_user');
            const parsed = cached ? JSON.parse(cached) : null;
            if (!parsed?.id) {
              setUser(null);
              setProfile(null);
            }
          } catch {
            setUser(null);
            setProfile(null);
          }
          setLoading(false);
        }
      } catch (err) {
        console.error('[AuthContext] Unexpected session resolution error:', err);
        if (!mounted) return;
        setLoading(false);
      } finally {
        isRevalidatingRef.current = false;
      }
    };

    resolveSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      if (session?.user) {
        signedOutRef.current = false;
        userRef.current = session.user;
        setUser(session.user);
        markAuthValid(session.user.id);
        syncUserTimezone(session.user.id);
        fetchProfile(session.user.id, session.user.email).catch((err) => {
          console.warn('[AuthContext] Background fetchProfile error:', err);
        });
      } else if (_event === 'SIGNED_OUT') {
        signedOutRef.current = true;
        userRef.current = null;
        setUser(null);
        setProfile(null);
        localStorage.removeItem('yourbody_user');
      }
      setLoading(false);
    });

    const handleLifecycleResume = () => {
      if (document.visibilityState === 'visible') {
        if (isRevalidatingRef.current) return;
        // A8: Never clear user when offline
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          return;
        }
        isRevalidatingRef.current = true;

        supabase.auth
          .getSession()
          .then(({ data: { session } }) => {
            if (!mounted) return;
            if (session?.user) {
              signedOutRef.current = false;
              userRef.current = session.user;
              setUser(session.user);
              markAuthValid(session.user.id);
              syncUserTimezone(session.user.id);
              fetchProfile(session.user.id, session.user.email).catch((err) => {
                console.warn('[AuthContext] Background resume fetchProfile error:', err);
              });
            } else if (!session) {
              if (typeof navigator !== 'undefined' && !navigator.onLine) {
                return;
              }
              if (userRef.current) {
                setAuthRequiredStatus(true);
              }
              userRef.current = null;
              setUser(null);
              setProfile(null);
              localStorage.removeItem('yourbody_user');
            }
          })
          .catch((err) => {
            console.warn('[AuthContext] Background resume revalidation error:', err);
          })
          .finally(() => {
            isRevalidatingRef.current = false;
          });
      }
    };

    document.addEventListener('visibilitychange', handleLifecycleResume);
    window.addEventListener('pageshow', handleLifecycleResume);

    return () => {
      mounted = false;
      subscription.unsubscribe();
      document.removeEventListener('visibilitychange', handleLifecycleResume);
      window.removeEventListener('pageshow', handleLifecycleResume);
    };
  }, [fetchProfile, syncUserTimezone, markAuthValid]);

  const signIn = useCallback(
    async (email: string, password = 'password123') => {
      try {
        const sanitizedEmail = email.trim().toLowerCase();
        const { data, error } = await supabase.auth.signInWithPassword({
          email: sanitizedEmail,
          password,
        });
        if (error) {
          return { success: false, error: error.message };
        }
        if (data?.user) {
          signedOutRef.current = false;
          userRef.current = data.user;
          setUser(data.user);
          markAuthValid(data.user.id);
          syncUserTimezone(data.user.id);
          await fetchProfile(data.user.id, data.user.email);

          let userRole: UserRole = 'athlete';
          const { data: pData } = await supabase.from('users').select('role').eq('id', data.user.id).single();
          if (pData?.role) {
            userRole = pData.role as UserRole;
          }
          return { success: true, role: userRole };
        }
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
    [fetchProfile, syncUserTimezone, markAuthValid]
  );

  const signUp = useCallback(
    async (email: string, password = 'password123', _role: UserRole = 'athlete') => {
      try {
        const sanitizedEmail = email.trim().toLowerCase();
        const { data, error } = await supabase.auth.signUp({
          email: sanitizedEmail,
          password,
          options: {
            data: {
              username: sanitizedEmail.split('@')[0],
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            },
          },
        });
        if (error) {
          return { success: false, error: error.message };
        }
        if (data?.session && data?.user) {
          userRef.current = data.user;
          setUser(data.user);
          markAuthValid(data.user.id);
          syncUserTimezone(data.user.id);
          await fetchProfile(data.user.id, data.user.email);
          return { success: true };
        }
        return {
          success: true,
          needsEmailConfirmation: true,
          message: 'Account created! Please check your email to verify your account.',
        };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
    [fetchProfile, syncUserTimezone, markAuthValid]
  );

  useEffect(() => {
    if (user?.id) {
      setFlusherSessionUser(user.id);
      initPersistForUser(user.id, queryClient).catch((err) => {
        console.warn('[AuthContext] initPersistForUser error:', err);
      });
    } else {
      setFlusherSessionUser(null);
    }
    return () => {
      stopPersisting();
    };
  }, [user?.id, queryClient]);

  const signOut = useCallback(async () => {
    signedOutRef.current = true;
    userRef.current = null;
    const currentUserId = user?.id;

    // A9: signOut: if online and outbox non-empty -> try flush (<=8s).
    if (currentUserId && (typeof navigator === 'undefined' || navigator.onLine)) {
      const summary = getCachedOutboxSummary(currentUserId);
      if (summary.pending > 0) {
        try {
          await Promise.race([
            flushNow(currentUserId),
            new Promise((resolve) => setTimeout(resolve, 8000)),
          ]);
        } catch {
          // ignore flush errors during sign out
        }
      }
    }

    try {
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
    restTimerStore.stop();

    localStorage.removeItem('yourbody_user');
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith(AUTH_STORAGE_PREFIX)) {
        localStorage.removeItem(key);
      }
    });
    setUser(null);
    setProfile(null);
    queryClient.clear();

    // A9: on sign-out delete that user's rq store + queryClient.clear(), keep outbox/idmap
    if (currentUserId) {
      clearUserReadCache(currentUserId).catch((e) => {
        console.warn('[AuthContext] Failed to clear user rq store:', e);
      });
    }
    stopPersisting();
  }, [user?.id, queryClient]);

  const updateProfile = useCallback(async (updates: Partial<UserProfile>) => {
    if (!profile) return { success: false, error: 'Not authenticated' };
    // Strip role, coach_tier, and max_athletes mutations: client cannot modify protected fields
    const {
      role: _strippedRole,
      coach_tier: _strippedTier,
      max_athletes: _strippedMax,
      ...safeUpdates
    } = updates;
    const updated = { ...profile, ...safeUpdates };
    setProfile(updated);
    localStorage.setItem('yourbody_user', JSON.stringify(updated));
    if (safeUpdates.auto_rest_timer !== undefined) {
      localStorage.setItem('yourbody_auto_rest_timer', String(safeUpdates.auto_rest_timer));
    }

    try {
      const { error } = await (supabase
        .from('users') as any)
        .upsert(updated)
        .eq('id', updated.id);
      if (error) throw error;
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Update failed' };
    }
  }, [profile]);

  const switchRole = useCallback(async (newRole: UserRole) => {
    // Only verified coaches can toggle between Coach View and Athlete Preview
    if (profile?.role !== 'coach') return;
    setViewMode(newRole);
    localStorage.setItem('yourbody_view_mode', newRole);
  }, [profile?.role]);

  const refreshProfile = useCallback(async () => {
    signedOutRef.current = false;
    if (user) {
      await fetchProfile(user.id, user.email);
    }
  }, [user, fetchProfile]);

  const resendConfirmation = useCallback(async (email: string) => {
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim().toLowerCase(),
      });
      if (error) return { success: false, error: error.message };
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) return { success: false, error: error.message };
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }, []);

  const resetPassword = useCallback(async (newPassword: string) => {
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) return { success: false, error: error.message };
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }, []);

  const role: UserRole = profile?.role === 'coach' ? viewMode : 'athlete';
  const isCoachMode = Boolean(profile?.is_coach_mode || profile?.role === 'coach' || role === 'coach');

  const contextValue = useMemo<AuthContextType>(
    () => ({
      user,
      profile,
      role,
      viewMode,
      isCoachMode,
      loading,
      signIn,
      signUp,
      signOut,
      updateProfile,
      switchRole,
      refreshProfile,
      resendConfirmation,
      requestPasswordReset,
      resetPassword,
    }),
    [
      user,
      profile,
      role,
      viewMode,
      isCoachMode,
      loading,
      signIn,
      signUp,
      signOut,
      updateProfile,
      switchRole,
      refreshProfile,
      resendConfirmation,
      requestPasswordReset,
      resetPassword,
    ]
  );

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};
