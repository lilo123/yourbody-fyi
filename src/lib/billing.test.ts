import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { supabase } from './supabase';
import { startCheckout, openBillingPortal, extractBillingErrorMessage } from './billing';

vi.mock('./supabase', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(),
    },
  },
}));

describe('billing client helpers', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();
    delete (window as any).location;
    window.location = {
      ...originalLocation,
      assign: vi.fn(),
    } as any;
  });

  afterEach(() => {
    (window as any).location = originalLocation;
  });

  describe('startCheckout', () => {
    it('invokes create-checkout with personal plan and yearly default', async () => {
      vi.spyOn(supabase.functions, 'invoke').mockResolvedValueOnce({
        data: { url: 'https://checkout.stripe.test/personal_yearly_123' },
        error: null,
      });

      const result = await startCheckout('personal');

      expect(supabase.functions.invoke).toHaveBeenCalledWith('create-checkout', {
        body: { plan: 'personal', interval: 'year' },
      });
      expect(window.location.assign).toHaveBeenCalledWith('https://checkout.stripe.test/personal_yearly_123');
      expect(result).toEqual({
        ok: true,
        success: true,
        url: 'https://checkout.stripe.test/personal_yearly_123',
      });
    });

    it('invokes create-checkout with coach plan and monthly interval', async () => {
      vi.spyOn(supabase.functions, 'invoke').mockResolvedValueOnce({
        data: { url: 'https://checkout.stripe.test/coach_monthly_123' },
        error: null,
      });

      const result = await startCheckout('coach', 'month');

      expect(supabase.functions.invoke).toHaveBeenCalledWith('create-checkout', {
        body: { plan: 'coach', interval: 'month' },
      });
      expect(window.location.assign).toHaveBeenCalledWith('https://checkout.stripe.test/coach_monthly_123');
      expect(result).toEqual({
        ok: true,
        success: true,
        url: 'https://checkout.stripe.test/coach_monthly_123',
      });
    });

    it('invokes create-checkout with options object { plan, interval }', async () => {
      vi.spyOn(supabase.functions, 'invoke').mockResolvedValueOnce({
        data: { url: 'https://checkout.stripe.test/coach_pro_yearly_123' },
        error: null,
      });

      const result = await startCheckout({ plan: 'coach_pro', interval: 'year' });

      expect(supabase.functions.invoke).toHaveBeenCalledWith('create-checkout', {
        body: { plan: 'coach_pro', interval: 'year' },
      });
      expect(window.location.assign).toHaveBeenCalledWith('https://checkout.stripe.test/coach_pro_yearly_123');
      expect(result).toEqual({
        ok: true,
        success: true,
        url: 'https://checkout.stripe.test/coach_pro_yearly_123',
      });
    });

    it('maps 503 billing_not_configured error to friendly message', async () => {
      vi.spyOn(supabase.functions, 'invoke').mockResolvedValueOnce({
        data: null,
        error: {
          status: 503,
          code: 'billing_not_configured',
          message: 'Stripe configuration missing',
        } as any,
      });

      const result = await startCheckout('coach');

      expect(window.location.assign).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      expect(result.error).toBe("Billing isn't available yet.");
    });

    it('maps live_keys_refused error to billing unavailable message', async () => {
      vi.spyOn(supabase.functions, 'invoke').mockResolvedValueOnce({
        data: null,
        error: {
          status: 503,
          code: 'live_keys_refused',
        } as any,
      });

      const result = await startCheckout('personal');

      expect(window.location.assign).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      expect(result.error).toBe("Billing isn't available yet.");
    });

    it('maps 409 no_billing_customer error to friendly message', async () => {
      vi.spyOn(supabase.functions, 'invoke').mockResolvedValueOnce({
        data: null,
        error: {
          status: 409,
          code: 'no_billing_customer',
        } as any,
      });

      const result = await startCheckout('personal');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('No billing account yet.');
    });

    it('maps generic and network errors to retryable message', async () => {
      vi.spyOn(supabase.functions, 'invoke').mockRejectedValueOnce(
        new Error('Network connection timeout')
      );

      const result = await startCheckout('coach_pro');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Unable to process billing request. Please try again.');
    });
  });

  describe('openBillingPortal', () => {
    it('invokes create-portal-session and redirects to returned url', async () => {
      vi.spyOn(supabase.functions, 'invoke').mockResolvedValueOnce({
        data: { url: 'https://billing.stripe.test/portal_session_123' },
        error: null,
      });

      const result = await openBillingPortal();

      expect(supabase.functions.invoke).toHaveBeenCalledWith('create-portal-session');
      expect(window.location.assign).toHaveBeenCalledWith('https://billing.stripe.test/portal_session_123');
      expect(result).toEqual({
        ok: true,
        success: true,
        url: 'https://billing.stripe.test/portal_session_123',
      });
    });

    it('maps 409 no_billing_customer to friendly message', async () => {
      vi.spyOn(supabase.functions, 'invoke').mockResolvedValueOnce({
        data: null,
        error: {
          status: 409,
          code: 'no_billing_customer',
        } as any,
      });

      const result = await openBillingPortal();

      expect(window.location.assign).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      expect(result.error).toBe('No billing account yet.');
    });

    it('maps 503 billing_not_configured on portal session', async () => {
      vi.spyOn(supabase.functions, 'invoke').mockResolvedValueOnce({
        data: null,
        error: {
          status: 503,
          code: 'billing_not_configured',
        } as any,
      });

      const result = await openBillingPortal();

      expect(result.ok).toBe(false);
      expect(result.error).toBe("Billing isn't available yet.");
    });
  });

  describe('extractBillingErrorMessage context parsing', () => {
    it('extracts status and code from context Response-like objects', async () => {
      const errorWithContext = {
        context: {
          json: async () => ({ code: 'billing_not_configured', status: 503 }),
        },
      };

      const msg = await extractBillingErrorMessage(errorWithContext);
      expect(msg).toBe("Billing isn't available yet.");
    });
  });
});
