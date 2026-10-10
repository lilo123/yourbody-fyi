import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@17.7.0";

export class LiveKeyRefusedError extends Error {
  readonly code = "live_keys_refused" as const;
  constructor(message = "Live Stripe keys are not allowed in this environment.") {
    super(message);
    this.name = "LiveKeyRefusedError";
  }
}

export interface StripeConfig {
  stripeSecretKey: string;
  stripeWebhookSecret: string | null;
  stripePriceBasic: string | null;
  stripePricePro: string | null;
  stripe: Stripe;
}

export function getStripeConfig(): StripeConfig | null {
  const secretKey = Deno.env.get("STRIPE_SECRET_KEY")?.trim();
  if (!secretKey) {
    return null;
  }

  if (secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_")) {
    throw new LiveKeyRefusedError();
  }

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
  };
}

export function createBillingErrorResponse(
  code: "billing_not_configured" | "live_keys_refused",
  corsHeaders: Record<string, string> = {},
): Response {
  const errorMsg =
    code === "live_keys_refused"
      ? "Live Stripe keys are not allowed in this environment."
      : "Billing is not configured.";

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
