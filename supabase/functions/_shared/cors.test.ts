import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { isAllowedOrigin, getCorsHeaders } from "./cors.ts";

Deno.test("cors: allowed origins matrix", () => {
  const allowed = [
    "https://www.yourbody.fyi",
    "https://yourbody.fyi",
    "https://yourbody-fyi.pages.dev",
    "https://d41d8cd9.yourbody-fyi.pages.dev",
    "https://preview-123.yourbody-fyi.pages.dev",
    "capacitor://localhost",
    "https://fitness-tracking-app-silk.vercel.app",
    "https://fitness-tracking-app-git-v2-rewrite-preview.vercel.app",
    "https://fitness-tracking-app-feat-123.vercel.app",
    "https://fitness-tracking-j5kms8fj7-lilo123-2112s-projects.vercel.app",
    "https://fitness-tracking-app-git-main-lilo123-2112s-projects.vercel.app",
  ];

  for (const origin of allowed) {
    assertEquals(isAllowedOrigin(origin), true, `Expected ${origin} to be allowed`);
  }
});

Deno.test("cors: rejected origins matrix", () => {
  const legacyOrigin = ["https://", "cyber", "gym", ".app"].join("");
  const rejected = [
    legacyOrigin,
    "https://yourbody.fyi.attacker.com",
    "https://evil-yourbody.fyi",
    "http://www.yourbody.fyi",
    "http://yourbody.fyi",
    "https://other-project.pages.dev",
    "https://evil-yourbody-fyi.pages.dev",
    "https://a.b.yourbody-fyi.pages.dev",
    "http://yourbody-fyi.pages.dev",
    "http://preview-123.yourbody-fyi.pages.dev",
    "https://yourbody-fyi.pages.dev.attacker.com",
    "null",
    "https://www.yourbody.fyi/",
    "https://WWW.YOURBODY.FYI",
    "",
    "https://other-project.vercel.app",
    "https://fitness-tracking-app.attacker.com",
    "http://fitness-tracking-app-silk.vercel.app",
    "https://fitness-tracking-app_preview.vercel.app",
    "https://fitness-tracking-app-silk.vercel.app.attacker.com",
    "https://fitness-tracking-app.vercel.app.evil.com",
    "https://fitness-tracking-abc123-other-team-projects.vercel.app",
    "https://evil-fitness-tracking-abc123-lilo123-2112s-projects.vercel.app",
    "https://fitness-tracking-abc123-lilo123-2112s-projects.vercel.app.attacker.com",
    "http://fitness-tracking-abc123-lilo123-2112s-projects.vercel.app",
    "https://fitness-tracking--lilo123-2112s-projects.vercel.app.evil.com",
  ];

  for (const origin of rejected) {
    assertEquals(isAllowedOrigin(origin), false, `Expected ${origin} to be rejected`);
  }

  assertEquals(isAllowedOrigin(null), false, "Expected null to be rejected");
  assertEquals(isAllowedOrigin(undefined), false, "Expected undefined to be rejected");
});

Deno.test("cors: ALLOWED_ORIGINS env origin support", () => {
  Deno.env.set("ALLOWED_ORIGINS", "https://custom.domain.io, https://staging.yourbody.fyi/");
  try {
    assertEquals(isAllowedOrigin("https://custom.domain.io"), true);
    assertEquals(isAllowedOrigin("https://staging.yourbody.fyi"), true);
    assertEquals(isAllowedOrigin("https://unlisted.domain.io"), false);
  } finally {
    Deno.env.delete("ALLOWED_ORIGINS");
  }
});

Deno.test("cors: dev origins allowed when not in production", () => {
  assertEquals(isAllowedOrigin("http://localhost:5173"), true);
  assertEquals(isAllowedOrigin("http://127.0.0.1:3000"), true);
  assertEquals(isAllowedOrigin("http://localhost"), true);
  assertEquals(isAllowedOrigin("http://localhost.attacker.com"), false);
  assertEquals(isAllowedOrigin("http://127.0.0.1.attacker.com"), false);
});

Deno.test("cors: dev origins rejected when DENO_ENV=production", () => {
  Deno.env.set("DENO_ENV", "production");
  try {
    assertEquals(isAllowedOrigin("http://localhost:5173"), false);
    assertEquals(isAllowedOrigin("http://127.0.0.1:3000"), false);
    assertEquals(isAllowedOrigin("https://www.yourbody.fyi"), true);
  } finally {
    Deno.env.delete("DENO_ENV");
  }
});

Deno.test("cors: dev origins rejected when ENVIRONMENT=production", () => {
  Deno.env.set("ENVIRONMENT", "production");
  try {
    assertEquals(isAllowedOrigin("http://localhost:5173"), false);
    assertEquals(isAllowedOrigin("http://127.0.0.1:3000"), false);
    assertEquals(isAllowedOrigin("https://www.yourbody.fyi"), true);
  } finally {
    Deno.env.delete("ENVIRONMENT");
  }
});

Deno.test("cors: getCorsHeaders builder behavior", () => {
  // Allowed origin echoes ACAO and Vary
  const allowedHeaders = getCorsHeaders("https://www.yourbody.fyi");
  assertEquals(allowedHeaders["Access-Control-Allow-Origin"], "https://www.yourbody.fyi");
  assertEquals(allowedHeaders["Vary"], "Origin");
  assertEquals(
    allowedHeaders["Access-Control-Allow-Headers"],
    "authorization, x-client-info, apikey, content-type",
  );

  // Disallowed origin omits ACAO
  const legacyOrigin = ["https://", "cyber", "gym", ".app"].join("");
  const disallowedHeaders = getCorsHeaders(legacyOrigin);
  assertEquals(disallowedHeaders["Access-Control-Allow-Origin"], undefined);
  assertEquals(disallowedHeaders["Vary"], "Origin");

  // Extra headers passthrough
  const extraHeaders = getCorsHeaders("https://www.yourbody.fyi", {
    "Access-Control-Expose-Headers": "Retry-After",
    "Access-Control-Max-Age": "86400",
  });
  assertEquals(extraHeaders["Access-Control-Allow-Origin"], "https://www.yourbody.fyi");
  assertEquals(extraHeaders["Access-Control-Expose-Headers"], "Retry-After");
  assertEquals(extraHeaders["Access-Control-Max-Age"], "86400");
});
