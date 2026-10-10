import { supabase } from './supabase';

export type CheckoutPlan = 'basic' | 'pro';

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

export async function startCheckout(plan: CheckoutPlan): Promise<BillingResult> {
  try {
    const { data, error } = await supabase.functions.invoke('create-checkout', {
      body: { plan },
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
