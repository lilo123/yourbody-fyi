import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import type Stripe from "npm:stripe@17.7.0";
import { isAllowedOrigin, getCorsHeaders } from "../_shared/cors.ts";
import {
  resolveStripeConfig,
  LiveKeyRefusedError,
  PriceModeMismatchError,
  validatePriceMode,
  createBillingErrorResponse,
} from "../_shared/stripeConfig.ts";

export const VALID_PLANS = ["personal", "coach", "coach_pro"] as const;
export type ValidPlan = (typeof VALID_PLANS)[number];

export const VALID_INTERVALS = ["month", "year"] as const;
export type ValidInterval = (typeof VALID_INTERVALS)[number];

export async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get("Origin") || req.headers.get("origin");

  // Validate request origin against CORS allowlist
  if (!origin || !isAllowedOrigin(origin)) {
    return new Response(
      JSON.stringify({ error: "Invalid or disallowed origin" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const corsHeaders = getCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  // Verify caller authentication via Supabase Auth
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Missing or invalid Authorization header. Authentication required." }),
      {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: "Supabase configuration missing" }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return new Response(
      JSON.stringify({ error: "Unauthorized: Invalid token" }),
      {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  // Verify Stripe configuration
  const stripeGuard = resolveStripeConfig(corsHeaders);
  if (stripeGuard.response) {
    return stripeGuard.response;
  }
  const { config } = stripeGuard;

  // Validate request body
  let body: any;
  try {
    body = await req.json();
  } catch (_jsonErr) {
    return new Response(
      JSON.stringify({ error: "Malformed JSON payload" }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  const plan = body?.plan;
  const interval = body?.interval;

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    typeof plan !== "string" ||
    typeof interval !== "string" ||
    !VALID_PLANS.includes(plan as ValidPlan) ||
    !VALID_INTERVALS.includes(interval as ValidInterval)
  ) {
    return new Response(
      JSON.stringify({ error: "invalid_plan", code: "invalid_plan" }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  const lookupKey = `${plan}_${interval === "month" ? "monthly" : "yearly"}`;

  try {
    // 1. Query Stripe for active price matching lookup key (with data.product expanded)
    const pricesList = await config.stripe.prices.list({
      lookup_keys: [lookupKey],
      active: true,
      expand: ["data.product"],
    });

    let price: Stripe.Price | undefined = pricesList.data?.[0];

    // 2. Fallback when not found via lookup key:
    // personal + year -> STRIPE_PRICE_BASIC
    // coach + year -> STRIPE_PRICE_PRO
    // otherwise 503 price_not_configured
    if (!price) {
      let fallbackPriceId: string | null = null;
      if (plan === "personal" && interval === "year") {
        fallbackPriceId = config.stripePriceBasic;
      } else if (plan === "coach" && interval === "year") {
        fallbackPriceId = config.stripePricePro;
      }

      if (!fallbackPriceId) {
        return createBillingErrorResponse("price_not_configured", corsHeaders);
      }

      price = await config.stripe.prices.retrieve(fallbackPriceId);
    }

    // 3. Apply price-mode check to resolved price
    if (!validatePriceMode(price, config.isLive)) {
      return createBillingErrorResponse("price_mode_mismatch", corsHeaders);
    }

    const priceId = price.id;

    // Read existing billing_customer_id using service client
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: userData } = await serviceClient
      .from("users")
      .select("billing_customer_id")
      .eq("id", user.id)
      .maybeSingle();

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: "subscription",
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      client_reference_id: user.id,
      metadata: {
        user_id: user.id,
        plan,
        interval,
      },
      subscription_data: {
        metadata: {
          user_id: user.id,
          plan,
          interval,
        },
      },
      success_url: `${origin}/settings?billing=success`,
      cancel_url: `${origin}/settings?billing=cancelled`,
    };

    if (userData?.billing_customer_id) {
      sessionParams.customer = userData.billing_customer_id;
    } else if (user.email) {
      sessionParams.customer_email = user.email;
    }

    const session = await config.stripe.checkout.sessions.create(sessionParams);

    return new Response(
      JSON.stringify({ url: session.url }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (err) {
    if (err instanceof LiveKeyRefusedError || (err as any)?.code === "live_keys_refused") {
      return createBillingErrorResponse("live_keys_refused", corsHeaders);
    }
    if (err instanceof PriceModeMismatchError || (err as any)?.code === "price_mode_mismatch") {
      return createBillingErrorResponse("price_mode_mismatch", corsHeaders);
    }
    console.error("[create-checkout] Failed to create checkout session:", (err as Error)?.message || err);
    return new Response(
      JSON.stringify({ error: "Failed to create checkout session" }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }
}

export default {
  fetch: handler,
};
