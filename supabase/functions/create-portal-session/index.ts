import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { isAllowedOrigin, getCorsHeaders } from "../_shared/cors.ts";
import { resolveStripeConfig, LiveKeyRefusedError, createBillingErrorResponse } from "../_shared/stripeConfig.ts";

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

  try {
    // Read billing_customer_id using service client
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: userData } = await serviceClient
      .from("users")
      .select("billing_customer_id")
      .eq("id", user.id)
      .maybeSingle();

    if (!userData?.billing_customer_id) {
      return new Response(
        JSON.stringify({
          code: "no_billing_customer",
          error: "No billing customer found for user.",
        }),
        {
          status: 409,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    const portalSession = await config.stripe.billingPortal.sessions.create({
      customer: userData.billing_customer_id,
      return_url: `${origin}/settings`,
    });

    return new Response(
      JSON.stringify({ url: portalSession.url }),
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
    console.error("[create-portal-session] Failed to create portal session:", (err as Error)?.message || err);
    return new Response(
      JSON.stringify({ error: "Failed to create portal session" }),
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
