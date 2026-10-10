import { useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { AuthContext } from '../context/AuthContextTypes';

export interface EntitlementRpcResponse {
  plan_effective: string;
  plan: string | null;
  paid_until: string | null;
  trial_ends_at_effective: string | null;
  has_pro: boolean;
}

export interface UseEntitlementReturn {
  plan: string;
  isPro: boolean;
  isPaid: boolean;
  trialEndsAt: string | null;
  paidUntil: string | null;
  isLoading: boolean;
}

export const ENTITLEMENT_DEFAULTS: UseEntitlementReturn = {
  plan: 'free',
  isPro: false,
  isPaid: false,
  trialEndsAt: null,
  paidUntil: null,
  isLoading: false,
};

/**
 * Access user entitlement state and subscription tier via get_my_entitlement RPC.
 * Stable query key ['entitlement', userId] enables caching and offline retention.
 * Enabled only when a user session exists.
 * Returns safe defaults ('free', false) when unauthenticated or on error.
 */
export const ENTITLEMENT_QUERY_KEY_ROOT = 'entitlement' as const;

export const getEntitlementQueryKey = (userId: string | null | undefined) =>
  [ENTITLEMENT_QUERY_KEY_ROOT, userId ?? null] as const;

export function useEntitlement(): UseEntitlementReturn {
  const auth = useContext(AuthContext);
  const userId = auth?.user?.id ?? null;
  const hasSession = Boolean(userId);
  const queryKey = getEntitlementQueryKey(userId);

  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_my_entitlement');
      if (error) {
        throw error;
      }
      return data as unknown as EntitlementRpcResponse;
    },
    enabled: hasSession,
    staleTime: 5 * 60 * 1000,
    gcTime: 8 * 24 * 60 * 60 * 1000,
  });

  if (!hasSession || isError) {
    return ENTITLEMENT_DEFAULTS;
  }

  if (isLoading || !data) {
    return {
      ...ENTITLEMENT_DEFAULTS,
      isLoading: true,
    };
  }

  const isPro = Boolean(data.has_pro);
  const isPaid = isPro || data.plan_effective === 'basic' || (
    data.plan === 'basic' &&
    Boolean(data.paid_until && new Date(data.paid_until).getTime() > Date.now())
  );

  return {
    plan: data.plan_effective || 'free',
    isPro,
    isPaid,
    trialEndsAt: data.trial_ends_at_effective ?? null,
    paidUntil: data.paid_until ?? null,
    isLoading: false,
  };
}
