import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { isAllowedOrigin, getCorsHeaders } from "../_shared/cors.ts";

export async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get("Origin") || req.headers.get("origin");

  // Validate request origin against CORS allowlist
  if (!origin || !isAllowedOrigin(origin)) {
    return new Response(
      JSON.stringify({ error: "Invalid or disallowed origin", code: "cors_not_allowed" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const corsHeaders = getCorsHeaders(origin, {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed", code: "method_not_allowed" }),
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
      JSON.stringify({ error: "Missing or invalid Authorization header. Authentication required.", code: "unauthorized" }),
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
      JSON.stringify({ error: "Supabase configuration missing", code: "config_missing" }),
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
      JSON.stringify({ error: "Unauthorized: Invalid token", code: "unauthorized" }),
      {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  // Owner check: caller's user id must be in OWNER_USER_IDS secret
  const ownerUserIdsRaw = Deno.env.get("OWNER_USER_IDS") || "";
  const ownerUserIds = ownerUserIdsRaw
    .split(",")
    .map((ownerId) => ownerId.trim())
    .filter(Boolean);

  if (ownerUserIds.length === 0 || !ownerUserIds.includes(user.id)) {
    return new Response(
      JSON.stringify({ error: "Forbidden: Not an owner", code: "forbidden" }),
      {
        status: 403,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  // Flag check: app_config key owner_dashboard_enabled must be true
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: configRow, error: configError } = await serviceClient
    .from("app_config")
    .select("value")
    .eq("key", "owner_dashboard_enabled")
    .maybeSingle();

  if (configError || !configRow || configRow.value !== true) {
    return new Response(
      JSON.stringify({ error: "Feature disabled", code: "feature_disabled" }),
      {
        status: 403,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  // Execute read-only RPC
  const { data: statsData, error: statsError } = await serviceClient.rpc("get_owner_stats");

  if (statsError || !statsData) {
    console.error("[owner-stats] Failed to fetch owner stats:", statsError?.message || statsError);
    return new Response(
      JSON.stringify({ error: "Failed to fetch owner statistics", code: "stats_fetch_failed" }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  return new Response(
    JSON.stringify(statsData),
    {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    },
  );
}

export default {
  fetch: handler,
};
