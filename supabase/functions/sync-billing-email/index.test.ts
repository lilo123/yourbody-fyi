import { assertEquals } from "jsr:@std/assert@1.0.19";
import app from "./index.ts";

const ALLOWED_ORIGIN = "https://www.yourbody.fyi";
const DISALLOWED_ORIGIN = "https://malicious-site.example.com";
const TEST_USER_ID = "22222222-2222-4222-a222-222222222222";
const TEST_EMAIL = "athlete2@yourbody.fyi";
const TEST_CUSTOMER_ID = "cus_sync_test_789";

const TEST_STRIPE_KEY = "sk_" + "test_sync_mock_123";
const LIVE_STRIPE_KEY = "sk_" + "live_sync_mock_123";

function setupEnv() {
  Deno.env.set("SUPABASE_URL", "https://mock.supabase.co");
  Deno.env.set("SUPABASE_ANON_KEY", "mock-anon-key");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "mock-service-role-key");
  Deno.env.set("STRIPE_SECRET_KEY", TEST_STRIPE_KEY);
  Deno.env.delete("STRIPE_LIVE_ENABLED");
}

Deno.test("sync-billing-email: rejects disallowed origin with 400", async () => {
  setupEnv();

  const req = new Request("http://localhost/sync-billing-email", {
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

Deno.test("sync-billing-email: handles OPTIONS request with 200 ok and CORS headers", async () => {
  setupEnv();

  const req = new Request("http://localhost/sync-billing-email", {
    method: "OPTIONS",
    headers: {
      "Origin": ALLOWED_ORIGIN,
    },
  });

  const res = await app.fetch(req);
  assertEquals(res.status, 200);
  const text = await res.text();
  assertEquals(text, "ok");
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), ALLOWED_ORIGIN);
});

Deno.test("sync-billing-email: rejects non-POST methods with 405", async () => {
  setupEnv();

  const req = new Request("http://localhost/sync-billing-email", {
    method: "GET",
    headers: {
      "Origin": ALLOWED_ORIGIN,
      "Authorization": "Bearer valid-token",
    },
  });

  const res = await app.fetch(req);
  assertEquals(res.status, 405);
  const data = await res.json();
  assertEquals(data.error, "Method not allowed");
});

Deno.test("sync-billing-email: rejects missing Authorization header with 401", async () => {
  setupEnv();

  const req = new Request("http://localhost/sync-billing-email", {
    method: "POST",
    headers: {
      "Origin": ALLOWED_ORIGIN,
      "Content-Type": "application/json",
    },
  });

  const res = await app.fetch(req);
  assertEquals(res.status, 401);
});

Deno.test("sync-billing-email: rejects invalid Authorization token with 401", async () => {
  setupEnv();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input);
  };

  try {
    const req = new Request("http://localhost/sync-billing-email", {
      method: "POST",
      headers: {
        "Origin": ALLOWED_ORIGIN,
        "Authorization": "Bearer invalid-token",
        "Content-Type": "application/json",
      },
    });

    const res = await app.fetch(req);
    assertEquals(res.status, 401);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("sync-billing-email: returns 200 {synced:false, reason:'no_customer'} if user has no billing_customer_id", async () => {
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
    const req = new Request("http://localhost/sync-billing-email", {
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
    assertEquals(data, { synced: false, reason: "no_customer" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("sync-billing-email: missing config returns 503 with billing_not_configured", async () => {
  setupEnv();
  Deno.env.delete("STRIPE_SECRET_KEY");

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
      return new Response(JSON.stringify({ billing_customer_id: TEST_CUSTOMER_ID }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input);
  };

  try {
    const req = new Request("http://localhost/sync-billing-email", {
      method: "POST",
      headers: {
        "Origin": ALLOWED_ORIGIN,
        "Authorization": "Bearer valid-token",
        "Content-Type": "application/json",
      },
    });

    const res = await app.fetch(req);
    assertEquals(res.status, 503);
    const data = await res.json();
    assertEquals(data.code, "billing_not_configured");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("sync-billing-email: refuses live key starting with sk_live_ without flag (503 live_keys_refused)", async () => {
  setupEnv();
  Deno.env.set("STRIPE_SECRET_KEY", LIVE_STRIPE_KEY);

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
      return new Response(JSON.stringify({ billing_customer_id: TEST_CUSTOMER_ID }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input);
  };

  try {
    const req = new Request("http://localhost/sync-billing-email", {
      method: "POST",
      headers: {
        "Origin": ALLOWED_ORIGIN,
        "Authorization": "Bearer valid-token",
        "Content-Type": "application/json",
      },
    });

    const res = await app.fetch(req);
    assertEquals(res.status, 503);
    const data = await res.json();
    assertEquals(data.code, "live_keys_refused");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("sync-billing-email: returns 200 {synced:false, reason:'unchanged'} if customer.email already equals auth email", async () => {
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
      return new Response(JSON.stringify({ billing_customer_id: TEST_CUSTOMER_ID }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("api.stripe.com/v1/customers/" + TEST_CUSTOMER_ID)) {
      return new Response(
        JSON.stringify({
          id: TEST_CUSTOMER_ID,
          email: TEST_EMAIL,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    return originalFetch(input);
  };

  try {
    const req = new Request("http://localhost/sync-billing-email", {
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
    assertEquals(data, { synced: false, reason: "unchanged" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("sync-billing-email: updates customer and returns 200 {synced:true}, asserting POST body email=...", async () => {
  setupEnv();

  let capturedStripeMethod = "";
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
      return new Response(JSON.stringify({ billing_customer_id: TEST_CUSTOMER_ID }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("api.stripe.com/v1/customers/" + TEST_CUSTOMER_ID)) {
      const method = init?.method || "GET";
      if (method === "GET") {
        return new Response(
          JSON.stringify({
            id: TEST_CUSTOMER_ID,
            email: "old-address@example.com",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      if (method === "POST") {
        capturedStripeMethod = method;
        capturedStripeBody = (init?.body as string) || "";
        return new Response(
          JSON.stringify({
            id: TEST_CUSTOMER_ID,
            email: TEST_EMAIL,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
    }
    return originalFetch(input, init);
  };

  try {
    const req = new Request("http://localhost/sync-billing-email", {
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
    assertEquals(data, { synced: true });

    assertEquals(capturedStripeMethod, "POST");
    const params = new URLSearchParams(capturedStripeBody);
    assertEquals(params.get("email"), TEST_EMAIL);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("sync-billing-email: body email ignored and confirmed auth email used", async () => {
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
      return new Response(JSON.stringify({ billing_customer_id: TEST_CUSTOMER_ID }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("api.stripe.com/v1/customers/" + TEST_CUSTOMER_ID)) {
      const method = init?.method || "GET";
      if (method === "GET") {
        return new Response(
          JSON.stringify({
            id: TEST_CUSTOMER_ID,
            email: "prior@example.com",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      if (method === "POST") {
        capturedStripeBody = (init?.body as string) || "";
        return new Response(
          JSON.stringify({
            id: TEST_CUSTOMER_ID,
            email: TEST_EMAIL,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
    }
    return originalFetch(input, init);
  };

  try {
    const req = new Request("http://localhost/sync-billing-email", {
      method: "POST",
      headers: {
        "Origin": ALLOWED_ORIGIN,
        "Authorization": "Bearer valid-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: "attacker-payload@example.com" }),
    });

    const res = await app.fetch(req);
    assertEquals(res.status, 200);
    const data = await res.json();
    assertEquals(data, { synced: true });

    const params = new URLSearchParams(capturedStripeBody);
    assertEquals(params.get("email"), TEST_EMAIL);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("sync-billing-email: maps Stripe 404 to 200 {synced:false, reason:'no_customer'}", async () => {
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
      return new Response(JSON.stringify({ billing_customer_id: TEST_CUSTOMER_ID }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("api.stripe.com/v1/customers/" + TEST_CUSTOMER_ID)) {
      return new Response(
        JSON.stringify({
          error: {
            type: "invalid_request_error",
            message: "No such customer",
            code: "resource_missing",
          },
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    return originalFetch(input);
  };

  try {
    const req = new Request("http://localhost/sync-billing-email", {
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
    assertEquals(data, { synced: false, reason: "no_customer" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("sync-billing-email: maps deleted customer to 200 {synced:false, reason:'no_customer'}", async () => {
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
      return new Response(JSON.stringify({ billing_customer_id: TEST_CUSTOMER_ID }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("api.stripe.com/v1/customers/" + TEST_CUSTOMER_ID)) {
      return new Response(
        JSON.stringify({
          id: TEST_CUSTOMER_ID,
          deleted: true,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    return originalFetch(input);
  };

  try {
    const req = new Request("http://localhost/sync-billing-email", {
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
    assertEquals(data, { synced: false, reason: "no_customer" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("sync-billing-email: maps Stripe 500 error to 502 {code:'stripe_error'}", async () => {
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
      return new Response(JSON.stringify({ billing_customer_id: TEST_CUSTOMER_ID }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("api.stripe.com/v1/customers/" + TEST_CUSTOMER_ID)) {
      return new Response(
        JSON.stringify({
          error: {
            type: "api_error",
            message: "Internal server error from Stripe",
          },
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    return originalFetch(input);
  };

  try {
    const req = new Request("http://localhost/sync-billing-email", {
      method: "POST",
      headers: {
        "Origin": ALLOWED_ORIGIN,
        "Authorization": "Bearer valid-token",
        "Content-Type": "application/json",
      },
    });

    const res = await app.fetch(req);
    assertEquals(res.status, 502);
    const data = await res.json();
    assertEquals(data.code, "stripe_error");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
