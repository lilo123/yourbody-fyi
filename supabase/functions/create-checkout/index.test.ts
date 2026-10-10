import { assertEquals, assertExists } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import app from "./index.ts";

const ALLOWED_ORIGIN = "https://www.yourbody.fyi";
const DISALLOWED_ORIGIN = "https://malicious-site.example.com";
const TEST_USER_ID = "11111111-1111-4111-a111-111111111111";
const TEST_EMAIL = "athlete@yourbody.fyi";

function setupEnv() {
  Deno.env.set("SUPABASE_URL", "https://mock.supabase.co");
  Deno.env.set("SUPABASE_ANON_KEY", "mock-anon-key");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "mock-service-role-key");
  Deno.env.set("STRIPE_SECRET_KEY", "sk_test_mock_123");
  Deno.env.set("STRIPE_PRICE_BASIC", "price_basic_123");
  Deno.env.set("STRIPE_PRICE_PRO", "price_pro_456");
}

Deno.test("create-checkout: missing config returns 503 with billing_not_configured", async () => {
  setupEnv();
  Deno.env.delete("STRIPE_SECRET_KEY");

  const req = new Request("http://localhost/create-checkout", {
    method: "POST",
    headers: {
      "Origin": ALLOWED_ORIGIN,
      "Authorization": "Bearer valid-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ plan: "basic" }),
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

Deno.test("create-checkout: refuses live key starting with sk_live_ (503 live_keys_refused)", async () => {
  setupEnv();
  Deno.env.set("STRIPE_SECRET_KEY", "sk_live_dangerous_secret_key");

  const req = new Request("http://localhost/create-checkout", {
    method: "POST",
    headers: {
      "Origin": ALLOWED_ORIGIN,
      "Authorization": "Bearer valid-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ plan: "basic" }),
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

Deno.test("create-checkout: refuses restricted live key starting with rk_live_ (503 live_keys_refused)", async () => {
  setupEnv();
  Deno.env.set("STRIPE_SECRET_KEY", "rk_live_restricted_key");

  const req = new Request("http://localhost/create-checkout", {
    method: "POST",
    headers: {
      "Origin": ALLOWED_ORIGIN,
      "Authorization": "Bearer valid-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ plan: "basic" }),
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

Deno.test("create-checkout: rejects disallowed origin with 400", async () => {
  setupEnv();

  const req = new Request("http://localhost/create-checkout", {
    method: "POST",
    headers: {
      "Origin": DISALLOWED_ORIGIN,
      "Authorization": "Bearer valid-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ plan: "basic" }),
  });

  const res = await app.fetch(req);
  assertEquals(res.status, 400);
  const data = await res.json();
  assertEquals(data.error, "Invalid or disallowed origin");
});

Deno.test("create-checkout: rejects missing Authorization header with 401", async () => {
  setupEnv();

  const req = new Request("http://localhost/create-checkout", {
    method: "POST",
    headers: {
      "Origin": ALLOWED_ORIGIN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ plan: "basic" }),
  });

  const res = await app.fetch(req);
  assertEquals(res.status, 401);
});

Deno.test("create-checkout: rejects invalid plan with 400", async () => {
  setupEnv();

  const req = new Request("http://localhost/create-checkout", {
    method: "POST",
    headers: {
      "Origin": ALLOWED_ORIGIN,
      "Authorization": "Bearer valid-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ plan: "invalid_tier" }),
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
    assertEquals(res.status, 400);
    const data = await res.json();
    assertExists(data.error);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("create-checkout: passes client_reference_id and basic price for new customer", async () => {
  setupEnv();

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
      return new Response(JSON.stringify({ billing_customer_id: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("api.stripe.com/v1/checkout/sessions")) {
      capturedStripeBody = (init?.body as string) || "";
      return new Response(
        JSON.stringify({
          id: "cs_test_mock_session",
          url: "https://checkout.stripe.com/c/pay/cs_test_mock_session",
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
    const req = new Request("http://localhost/create-checkout", {
      method: "POST",
      headers: {
        "Origin": ALLOWED_ORIGIN,
        "Authorization": "Bearer valid-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ plan: "basic" }),
    });

    const res = await app.fetch(req);
    assertEquals(res.status, 200);
    const data = await res.json();
    assertEquals(data.url, "https://checkout.stripe.com/c/pay/cs_test_mock_session");

    const params = new URLSearchParams(capturedStripeBody);
    assertEquals(params.get("client_reference_id"), TEST_USER_ID);
    assertEquals(params.get("metadata[user_id]"), TEST_USER_ID);
    assertEquals(params.get("subscription_data[metadata][user_id]"), TEST_USER_ID);
    assertEquals(params.get("customer_email"), TEST_EMAIL);
    assertEquals(params.get("line_items[0][price]"), "price_basic_123");
    assertEquals(params.get("success_url"), `${ALLOWED_ORIGIN}/settings?billing=success`);
    assertEquals(params.get("cancel_url"), `${ALLOWED_ORIGIN}/settings?billing=cancelled`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("create-checkout: passes existing billing_customer_id and pro price", async () => {
  setupEnv();

  const EXISTING_CUSTOMER_ID = "cus_existing_999";
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
      return new Response(JSON.stringify({ billing_customer_id: EXISTING_CUSTOMER_ID }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("api.stripe.com/v1/checkout/sessions")) {
      capturedStripeBody = (init?.body as string) || "";
      return new Response(
        JSON.stringify({
          id: "cs_test_pro_session",
          url: "https://checkout.stripe.com/c/pay/cs_test_pro_session",
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
    const req = new Request("http://localhost/create-checkout", {
      method: "POST",
      headers: {
        "Origin": ALLOWED_ORIGIN,
        "Authorization": "Bearer valid-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ plan: "pro" }),
    });

    const res = await app.fetch(req);
    assertEquals(res.status, 200);
    const data = await res.json();
    assertEquals(data.url, "https://checkout.stripe.com/c/pay/cs_test_pro_session");

    const params = new URLSearchParams(capturedStripeBody);
    assertEquals(params.get("client_reference_id"), TEST_USER_ID);
    assertEquals(params.get("customer"), EXISTING_CUSTOMER_ID);
    assertEquals(params.get("customer_email"), null);
    assertEquals(params.get("line_items[0][price]"), "price_pro_456");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
