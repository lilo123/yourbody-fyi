import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { isAllowedOrigin, getCorsHeaders } from "../_shared/cors.ts";
import {
  resolveStripeConfig,
  LiveKeyRefusedError,
  createBillingErrorResponse,
} from "../_shared/stripeConfig.ts";

function isNotFoundError(err: unknown): boolean {
  const errorObj = err as Record<string, unknown> | null;
  return (
    errorObj?.status === 404 ||
    errorObj?.statusCode === 404 ||
    errorObj?.code === "resource_missing" ||
    (typeof errorObj?.raw === "object" &&
      errorObj?.raw !== null &&
      ((errorObj.raw as Record<string, unknown>).statusCode === 404 ||
        (errorObj.raw as Record<string, unknown>).code === "resource_missing"))
  );
}

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
      JSON.stringify({
        error: "Missing or invalid Authorization header. Authentication required.",
      }),
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

  // Obtain confirmed email strictly from Supabase Auth; never read or trust request body
  const confirmedEmail = user.email?.trim().toLowerCase();
  if (!confirmedEmail) {
    return new Response(
      JSON.stringify({ error: "User has no confirmed email address" }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  try {
    // Read billing_customer_id using service client
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: userData, error: dbError } = await serviceClient
      .from("users")
      .select("billing_customer_id")
      .eq("id", user.id)
      .maybeSingle();

    if (dbError) {
      console.error(
        "[sync-billing-email] Failed to query user record:",
        dbError.message,
      );
      return new Response(
        JSON.stringify({ error: "Database query failed" }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    if (!userData?.billing_customer_id) {
      return new Response(
        JSON.stringify({ synced: false, reason: "no_customer" }),
        {
          status: 200,
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

    // Retrieve customer from Stripe
    let customer: { id: string; email?: string | null; deleted?: boolean } | null = null;
    try {
      customer = await config.stripe.customers.retrieve(
        userData.billing_customer_id,
      ) as { id: string; email?: string | null; deleted?: boolean };
    } catch (stripeErr: unknown) {
      if (isNotFoundError(stripeErr)) {
        return new Response(
          JSON.stringify({ synced: false, reason: "no_customer" }),
          {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          },
        );
      }
      console.error(
        "[sync-billing-email] Stripe retrieve error:",
        (stripeErr as Error)?.message || stripeErr,
      );
      return new Response(
        JSON.stringify({
          code: "stripe_error",
          error: "Failed to retrieve Stripe customer",
        }),
        {
          status: 502,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    if (!customer || customer.deleted) {
      return new Response(
        JSON.stringify({ synced: false, reason: "no_customer" }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    const currentCustomerEmail = customer.email?.trim().toLowerCase();
    if (currentCustomerEmail === confirmedEmail) {
      return new Response(
        JSON.stringify({ synced: false, reason: "unchanged" }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    try {
      await config.stripe.customers.update(userData.billing_customer_id, {
        email: confirmedEmail,
      });
    } catch (stripeErr: unknown) {
      console.error(
        "[sync-billing-email] Stripe update error:",
        (stripeErr as Error)?.message || stripeErr,
      );
      return new Response(
        JSON.stringify({
          code: "stripe_error",
          error: "Failed to update Stripe customer email",
        }),
        {
          status: 502,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    return new Response(
      JSON.stringify({ synced: true }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (err: unknown) {
    if (
      err instanceof LiveKeyRefusedError ||
      (err as Record<string, unknown>)?.code === "live_keys_refused"
    ) {
      return createBillingErrorResponse("live_keys_refused", corsHeaders);
    }
    console.error(
      "[sync-billing-email] Unexpected error:",
      (err as Error)?.message || err,
    );
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
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
