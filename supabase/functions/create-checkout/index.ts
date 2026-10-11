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
  if (plan !== "basic" && plan !== "pro") {
    return new Response(
      JSON.stringify({ error: "Invalid plan: must be 'basic' or 'pro'" }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  const priceId = plan === "basic" ? config.stripePriceBasic : config.stripePricePro;
  if (!priceId) {
    return new Response(
      JSON.stringify({
        code: "billing_not_configured",
        error: `Stripe price for ${plan} plan is not configured.`,
      }),
      {
        status: 503,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  try {
    // Price mode check: fetch price object and verify livemode matches key mode
    const price = await config.stripe.prices.retrieve(priceId);
    if (!validatePriceMode(price, config.isLive)) {
      return createBillingErrorResponse("price_mode_mismatch", corsHeaders);
    }

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
      },
      subscription_data: {
        metadata: {
          user_id: user.id,
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
