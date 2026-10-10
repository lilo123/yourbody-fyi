import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ALLOWED_STATIC_ORIGINS = new Set([
  "https://www.yourbody.fyi",
  "https://yourbody.fyi",
  "https://yourbody-fyi.pages.dev",
  "capacitor://localhost",
  "https://fitness-tracking-app-silk.vercel.app",
]);

const PREVIEW_ORIGIN_REGEX = /^https:\/\/fitness-tracking-app[a-z0-9-]*\.vercel\.app$/;
// Per-deployment and branch preview URLs carry the team scope as a suffix,
// e.g. https://fitness-tracking-<hash>-lilo123-2112s-projects.vercel.app.
const SCOPED_PREVIEW_ORIGIN_REGEX =
  /^https:\/\/fitness-tracking-[a-z0-9-]+-lilo123-2112s-projects\.vercel\.app$/;
const CF_PAGES_PREVIEW_ORIGIN_REGEX =
  /^https:\/\/[a-z0-9-]+\.yourbody-fyi\.pages\.dev$/;
const DEV_ORIGIN_REGEX = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/;

export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin || origin === "null") {
    return false;
  }

  if (ALLOWED_STATIC_ORIGINS.has(origin)) {
    return true;
  }

  if (
    PREVIEW_ORIGIN_REGEX.test(origin) ||
    SCOPED_PREVIEW_ORIGIN_REGEX.test(origin) ||
    CF_PAGES_PREVIEW_ORIGIN_REGEX.test(origin)
  ) {
    return true;
  }

  const allowedOriginsEnv = Deno.env.get("ALLOWED_ORIGINS");
  if (allowedOriginsEnv) {
    const extraOrigins = allowedOriginsEnv
      .split(",")
      .map((o) => o.trim().replace(/\/+$/, ""))
      .filter(Boolean);
    if (extraOrigins.includes(origin)) {
      return true;
    }
  }

  const denoEnv = Deno.env.get("DENO_ENV");
  const environment = Deno.env.get("ENVIRONMENT");
  const isProduction = denoEnv === "production" || environment === "production";

  if (!isProduction && DEV_ORIGIN_REGEX.test(origin)) {
    return true;
  }

  return false;
}

export function getCorsHeaders(
  origin: string | null | undefined,
  extraHeaders?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
    ...extraHeaders,
  };

  if (origin && isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}
