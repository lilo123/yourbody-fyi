import { supabase } from './supabase';

export type CheckoutPlan = 'personal' | 'coach' | 'coach_pro';
export type CheckoutInterval = 'month' | 'year';

export type PlanDisplayLabel = 'Personal' | 'Coach' | 'Coach Pro' | 'Trial' | 'Free';

/**
 * Derives a human-facing tier display label from the database plan and coach tier.
 * DB users.plan values are only 'free' | 'basic' | 'pro'.
 * Display names:
 *   - 'basic' -> 'Personal'
 *   - 'pro' with coach_tier 'enterprise' (or 'enterprise_pro') -> 'Coach Pro'
 *   - 'pro' -> 'Coach'
 *   - 'trial' -> 'Trial'
 *   - 'free' or inactive -> 'Free'
 */
export function planLabel(
  plan?: string | null,
  coachTier?: string | null,
  isActive: boolean = true
): PlanDisplayLabel {
  if (!isActive) {
    return 'Free';
  }
  const normalizedPlan = plan?.toLowerCase();
  if (normalizedPlan === 'pro') {
    const normalizedTier = coachTier?.toLowerCase();
    if (normalizedTier === 'enterprise' || normalizedTier === 'enterprise_pro') {
      return 'Coach Pro';
    }
    return 'Coach';
  }
  if (normalizedPlan === 'basic' || normalizedPlan === 'personal') {
    return 'Personal';
  }
  if (normalizedPlan === 'coach_pro') {
    return 'Coach Pro';
  }
  if (normalizedPlan === 'coach') {
    return 'Coach';
  }
  if (normalizedPlan === 'trial') {
    return 'Trial';
  }
  return 'Free';
}

export interface CheckoutOptions {
  plan: CheckoutPlan;
  interval?: CheckoutInterval;
}

export interface BillingResult {
  ok: boolean;
  success: boolean;
  url?: string;
  error?: string;
}

export async function extractBillingErrorMessage(error: any): Promise<string> {
  let status = error?.status || error?.context?.status || 0;
  let code = error?.code || error?.context?.code || '';

  if (error?.context) {
    if (typeof error.context.clone === 'function' || typeof error.context.json === 'function') {
      try {
        const ctxClone =
          typeof error.context.clone === 'function' ? error.context.clone() : error.context;
        const errData = await ctxClone.json();
        if (errData?.code) code = errData.code;
        if (errData?.status) status = errData.status;
      } catch {
        // ignore JSON parse failure
      }
    }
  }

  if (status === 503 || code === 'billing_not_configured' || code === 'live_keys_refused') {
    return "Billing isn't available yet.";
  }

  if (status === 409 || code === 'no_billing_customer') {
    return 'No billing account yet.';
  }

  return 'Unable to process billing request. Please try again.';
}

export async function startCheckout(
  planOrOptions: CheckoutPlan | CheckoutOptions,
  maybeInterval?: CheckoutInterval
): Promise<BillingResult> {
  const plan = typeof planOrOptions === 'object' ? planOrOptions.plan : planOrOptions;
  const interval =
    (typeof planOrOptions === 'object' ? planOrOptions.interval : maybeInterval) || 'year';

  try {
    const { data, error } = await supabase.functions.invoke('create-checkout', {
      body: { plan, interval },
    });

    if (error) {
      const message = await extractBillingErrorMessage(error);
      return { ok: false, success: false, error: message };
    }

    if (!data?.url) {
      return {
        ok: false,
        success: false,
        error: 'Unable to process billing request. Please try again.',
      };
    }

    if (typeof window !== 'undefined' && window.location?.assign) {
      window.location.assign(data.url);
    }

    return { ok: true, success: true, url: data.url };
  } catch (err: any) {
    const message = await extractBillingErrorMessage(err);
    return { ok: false, success: false, error: message };
  }
}

export async function openBillingPortal(): Promise<BillingResult> {
  try {
    const { data, error } = await supabase.functions.invoke('create-portal-session');

    if (error) {
      const message = await extractBillingErrorMessage(error);
      return { ok: false, success: false, error: message };
    }

    if (!data?.url) {
      return {
        ok: false,
        success: false,
        error: 'Unable to process billing request. Please try again.',
      };
    }

    if (typeof window !== 'undefined' && window.location?.assign) {
      window.location.assign(data.url);
    }

    return { ok: true, success: true, url: data.url };
  } catch (err: any) {
    const message = await extractBillingErrorMessage(err);
    return { ok: false, success: false, error: message };
  }
}
