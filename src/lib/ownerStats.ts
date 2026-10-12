import { supabase } from './supabase';

export interface TierCounts {
  paying: number;
  grandfathered: number;
  unpaid: number;
  total: number;
}

export interface AiPlanUsage {
  plan: string;
  uses: number;
}

export interface OwnerStatsResponse {
  generated_at: string;
  tiers: {
    personal: TierCounts;
    coach: TierCounts;
    coach_pro: TierCounts;
    trial: TierCounts;
    free: TierCounts;
  };
  ai_today: {
    total_uses: number;
    distinct_users: number;
    by_plan: AiPlanUsage[];
  };
}

export interface FetchOwnerStatsResult {
  data: OwnerStatsResponse | null;
  isForbidden: boolean;
  error: Error | null;
}

export async function fetchOwnerStats(): Promise<FetchOwnerStatsResult> {
  try {
    const { data, error } = await supabase.functions.invoke<OwnerStatsResponse>('owner-stats', {
      method: 'GET',
    });

    if (error) {
      let isForbidden = false;
      const status = (error as any)?.context?.status || (error as any)?.status;
      if (status === 403) {
        isForbidden = true;
      } else if (error.message && error.message.includes('403')) {
        isForbidden = true;
      } else if ((error as any)?.context) {
        try {
          const ctxClone =
            typeof (error as any).context.clone === 'function'
              ? (error as any).context.clone()
              : (error as any).context;
          if (typeof ctxClone.json === 'function') {
            const errBody = await ctxClone.json();
            if (errBody?.code === 'forbidden' || errBody?.code === 'feature_disabled') {
              isForbidden = true;
            }
          }
        } catch {
          // ignore parsing error
        }
      }

      return {
        data: null,
        isForbidden,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }

    if (!data) {
      return {
        data: null,
        isForbidden: false,
        error: new Error('Empty owner stats response'),
      };
    }

    return {
      data,
      isForbidden: false,
      error: null,
    };
  } catch (err: unknown) {
    const errorInstance = err instanceof Error ? err : new Error(String(err));
    const isForbidden = errorInstance.message.includes('403');
    return {
      data: null,
      isForbidden,
      error: errorInstance,
    };
  }
}
