import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@17.7.0";

export class LiveKeyRefusedError extends Error {
  readonly code = "live_keys_refused" as const;
  constructor(message = "Live Stripe keys are not allowed in this environment.") {
    super(message);
    this.name = "LiveKeyRefusedError";
  }
}

export class PriceModeMismatchError extends Error {
  readonly code = "price_mode_mismatch" as const;
  constructor(message = "Price livemode does not match Stripe key mode.") {
    super(message);
    this.name = "PriceModeMismatchError";
  }
}

export type BillingErrorCode =
  | "billing_not_configured"
  | "live_keys_refused"
  | "price_mode_mismatch";

export interface StripeConfig {
  stripeSecretKey: string;
  stripeWebhookSecret: string | null;
  stripePriceBasic: string | null;
  stripePricePro: string | null;
  stripe: Stripe;
  isLive: boolean;
}

export function validatePriceMode(
  price: { livemode: boolean },
  isLive: boolean,
): boolean {
  return price.livemode === isLive;
}

export function assertPriceMode(
  price: { livemode: boolean },
  isLive: boolean,
): void {
  if (price.livemode !== isLive) {
    throw new PriceModeMismatchError();
  }
}

export function getStripeConfig(): StripeConfig | null {
  const secretKey = Deno.env.get("STRIPE_SECRET_KEY")?.trim();
  if (!secretKey) {
    return null;
  }

  const isLiveKey = secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_");
  const liveEnabled = Deno.env.get("STRIPE_LIVE_ENABLED") === "true";

  if (isLiveKey && !liveEnabled) {
    throw new LiveKeyRefusedError();
  }

  const isLive = isLiveKey && liveEnabled;

  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")?.trim() || null;
  const priceBasic = Deno.env.get("STRIPE_PRICE_BASIC")?.trim() || null;
  const pricePro = Deno.env.get("STRIPE_PRICE_PRO")?.trim() || null;

  const stripe = new Stripe(secretKey, {
    httpClient: Stripe.createFetchHttpClient(),
  });

  return {
    stripeSecretKey: secretKey,
    stripeWebhookSecret: webhookSecret,
    stripePriceBasic: priceBasic,
    stripePricePro: pricePro,
    stripe,
    isLive,
  };
}

export function createBillingErrorResponse(
  code: BillingErrorCode,
  corsHeaders: Record<string, string> = {},
): Response {
  let errorMsg = "Billing is not configured.";
  if (code === "live_keys_refused") {
    errorMsg = "Live Stripe keys are not allowed in this environment.";
  } else if (code === "price_mode_mismatch") {
    errorMsg = "Price livemode does not match Stripe key mode.";
  }

  return new Response(
    JSON.stringify({ code, error: errorMsg }),
    {
      status: 503,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    },
  );
}

export function resolveStripeConfig(corsHeaders: Record<string, string> = {}):
  | { config: StripeConfig; response: null }
  | { config: null; response: Response } {
  try {
    const config = getStripeConfig();
    if (!config) {
      return {
        config: null,
        response: createBillingErrorResponse("billing_not_configured", corsHeaders),
      };
    }
    return { config, response: null };
  } catch (err) {
    if (err instanceof LiveKeyRefusedError || (err as any)?.code === "live_keys_refused") {
      return {
        config: null,
        response: createBillingErrorResponse("live_keys_refused", corsHeaders),
      };
    }
    throw err;
  }
}
