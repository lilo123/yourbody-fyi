import { assertEquals, assertExists } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import app from "./index.ts";

const ALLOWED_ORIGIN = "https://www.yourbody.fyi";
const DISALLOWED_ORIGIN = "https://malicious-site.example.com";
const TEST_USER_ID = "22222222-2222-4222-a222-222222222222";
const TEST_EMAIL = "athlete2@yourbody.fyi";

function setupEnv() {
  Deno.env.set("SUPABASE_URL", "https://mock.supabase.co");
  Deno.env.set("SUPABASE_ANON_KEY", "mock-anon-key");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "mock-service-role-key");
  Deno.env.set("STRIPE_SECRET_KEY", "sk_test_mock_portal_123");
}

Deno.test("create-portal-session: missing config returns 503 with billing_not_configured", async () => {
  setupEnv();
  Deno.env.delete("STRIPE_SECRET_KEY");

  const req = new Request("http://localhost/create-portal-session", {
    method: "POST",
    headers: {
      "Origin": ALLOWED_ORIGIN,
      "Authorization": "Bearer valid-token",
      "Content-Type": "application/json",
    },
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: TEST_USER_ID, email: TEST_EMAIL }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input);
  };

  try {
    const res = await app.fetch(req);
    assertEquals(res.status, 503);
    const data = await res.json();
    assertEquals(data.code, "billing_not_configured");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("create-portal-session: refuses live key starting with sk_live_ (503 live_keys_refused)", async () => {
  setupEnv();
  Deno.env.set("STRIPE_SECRET_KEY", "sk_live_live_secret");

  const req = new Request("http://localhost/create-portal-session", {
    method: "POST",
    headers: {
      "Origin": ALLOWED_ORIGIN,
      "Authorization": "Bearer valid-token",
      "Content-Type": "application/json",
    },
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: TEST_USER_ID, email: TEST_EMAIL }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input);
  };

  try {
    const res = await app.fetch(req);
    assertEquals(res.status, 503);
    const data = await res.json();
    assertEquals(data.code, "live_keys_refused");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("create-portal-session: rejects disallowed origin with 400", async () => {
  setupEnv();

  const req = new Request("http://localhost/create-portal-session", {
    method: "POST",
    headers: {
      "Origin": DISALLOWED_ORIGIN,
      "Authorization": "Bearer valid-token",
      "Content-Type": "application/json",
    },
  });

  const res = await app.fetch(req);
  assertEquals(res.status, 400);
  const data = await res.json();
  assertEquals(data.error, "Invalid or disallowed origin");
});

Deno.test("create-portal-session: rejects missing Authorization header with 401", async () => {
  setupEnv();

  const req = new Request("http://localhost/create-portal-session", {
    method: "POST",
    headers: {
      "Origin": ALLOWED_ORIGIN,
      "Content-Type": "application/json",
    },
  });

  const res = await app.fetch(req);
  assertEquals(res.status, 401);
});

Deno.test("create-portal-session: returns 409 no_billing_customer if user has no customer ID", async () => {
  setupEnv();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: TEST_USER_ID, email: TEST_EMAIL }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/users")) {
      return new Response(JSON.stringify({ billing_customer_id: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input);
  };

  try {
    const req = new Request("http://localhost/create-portal-session", {
      method: "POST",
      headers: {
        "Origin": ALLOWED_ORIGIN,
        "Authorization": "Bearer valid-token",
        "Content-Type": "application/json",
      },
    });

    const res = await app.fetch(req);
    assertEquals(res.status, 409);
    const data = await res.json();
    assertEquals(data.code, "no_billing_customer");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("create-portal-session: passes customer and return_url to Stripe billingPortal", async () => {
  setupEnv();

  const CUSTOMER_ID = "cus_portal_test_789";
  let capturedStripeBody = "";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: TEST_USER_ID, email: TEST_EMAIL }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/users")) {
      return new Response(JSON.stringify({ billing_customer_id: CUSTOMER_ID }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("api.stripe.com/v1/billing_portal/sessions")) {
      capturedStripeBody = (init?.body as string) || "";
      return new Response(
        JSON.stringify({
          id: "bps_test_123",
          url: "https://billing.stripe.com/p/session/bps_test_123",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    return originalFetch(input, init);
  };

  try {
    const req = new Request("http://localhost/create-portal-session", {
      method: "POST",
      headers: {
        "Origin": ALLOWED_ORIGIN,
        "Authorization": "Bearer valid-token",
        "Content-Type": "application/json",
      },
    });

    const res = await app.fetch(req);
    assertEquals(res.status, 200);
    const data = await res.json();
    assertEquals(data.url, "https://billing.stripe.com/p/session/bps_test_123");

    const params = new URLSearchParams(capturedStripeBody);
    assertEquals(params.get("customer"), CUSTOMER_ID);
    assertEquals(params.get("return_url"), `${ALLOWED_ORIGIN}/settings`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
