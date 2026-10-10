import { assertEquals, assertExists } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import Stripe from "npm:stripe@17.7.0";
import app from "./index.ts";

const WEBHOOK_SECRET = "whsec_test_secret_for_tests_123";
const TEST_USER_ID = "33333333-3333-4333-a333-333333333333";
const CUSTOMER_ID = "cus_webhook_test_123";

function setupEnv() {
  Deno.env.set("SUPABASE_URL", "https://mock.supabase.co");
  Deno.env.set("SUPABASE_ANON_KEY", "mock-anon-key");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "mock-service-role-key");
  Deno.env.set("STRIPE_SECRET_KEY", "sk_test_mock_webhook_key");
  Deno.env.set("STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET);
  Deno.env.set("STRIPE_PRICE_BASIC", "price_basic_env_123");
  Deno.env.set("STRIPE_PRICE_PRO", "price_pro_env_456");
}

async function createSignedHeader(payload: string, secret = WEBHOOK_SECRET): Promise<string> {
  const stripe = new Stripe("sk_test_mock", { httpClient: Stripe.createFetchHttpClient() });
  return await stripe.webhooks.generateTestHeaderStringAsync({
    payload,
    secret,
    cryptoProvider: Stripe.createSubtleCryptoProvider(),
  });
}

Deno.test("stripe-webhook: missing config returns 503 with billing_not_configured", async () => {
  setupEnv();
  Deno.env.delete("STRIPE_SECRET_KEY");

  const payload = JSON.stringify({ id: "evt_test", type: "invoice.paid" });
  const sig = await createSignedHeader(payload);

  const req = new Request("http://localhost/stripe-webhook", {
    method: "POST",
    headers: {
      "Stripe-Signature": sig,
      "Content-Type": "application/json",
    },
    body: payload,
  });

  const res = await app.fetch(req);
  assertEquals(res.status, 503);
  const data = await res.json();
  assertEquals(data.code, "billing_not_configured");
});

Deno.test("stripe-webhook: refuses live key starting with sk_live_ (503 live_keys_refused)", async () => {
  setupEnv();
  Deno.env.set("STRIPE_SECRET_KEY", "sk_live_webhook_prod_key");

  const payload = JSON.stringify({ id: "evt_test", type: "invoice.paid" });
  const sig = await createSignedHeader(payload);

  const req = new Request("http://localhost/stripe-webhook", {
    method: "POST",
    headers: {
      "Stripe-Signature": sig,
      "Content-Type": "application/json",
    },
    body: payload,
  });

  const res = await app.fetch(req);
  assertEquals(res.status, 503);
  const data = await res.json();
  assertEquals(data.code, "live_keys_refused");
});

Deno.test("stripe-webhook: missing or bad signature returns 400 with no details", async () => {
  setupEnv();

  // Missing header
  const reqNoSig = new Request("http://localhost/stripe-webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "evt_test", type: "invoice.paid" }),
  });
  const resNoSig = await app.fetch(reqNoSig);
  assertEquals(resNoSig.status, 400);
  const dataNoSig = await resNoSig.json();
  assertEquals(dataNoSig.error, "Invalid signature");

  // Invalid / corrupted signature
  const reqBadSig = new Request("http://localhost/stripe-webhook", {
    method: "POST",
    headers: {
      "Stripe-Signature": "t=1700000000,v1=bad_signature_hash",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id: "evt_test", type: "invoice.paid" }),
  });
  const resBadSig = await app.fetch(reqBadSig);
  assertEquals(resBadSig.status, 400);
  const dataBadSig = await resBadSig.json();
  assertEquals(dataBadSig.error, "Invalid signature");
});

Deno.test("stripe-webhook: duplicate event returns 200 duplicate:true without updates", async () => {
  setupEnv();

  let userUpdated = false;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/rest/v1/billing_events")) {
      // Simulate conflict: no rows returned from upsert ignoreDuplicates
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/users")) {
      userUpdated = true;
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input);
  };

  try {
    const payload = JSON.stringify({
      id: "evt_duplicate_123",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_123",
          customer: CUSTOMER_ID,
          client_reference_id: TEST_USER_ID,
        },
      },
    });
    const sig = await createSignedHeader(payload);

    const req = new Request("http://localhost/stripe-webhook", {
      method: "POST",
      headers: {
        "Stripe-Signature": sig,
        "Content-Type": "application/json",
      },
      body: payload,
    });

    const res = await app.fetch(req);
    assertEquals(res.status, 200);
    const data = await res.json();
    assertEquals(data.duplicate, true);
    assertEquals(userUpdated, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("stripe-webhook: checkout.session.completed sets billing_customer_id", async () => {
  setupEnv();

  let userUpdatePayload: any = null;
  let eventRecorded = false;
  let processedAtSet = false;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/rest/v1/billing_events")) {
      if (init?.method === "PATCH") {
        processedAtSet = true;
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      eventRecorded = true;
      return new Response(JSON.stringify([{ event_id: "evt_checkout_1" }]), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/users")) {
      if (init?.method === "PATCH") {
        userUpdatePayload = JSON.parse(init.body as string);
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input, init);
  };

  try {
    const payload = JSON.stringify({
      id: "evt_checkout_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_session_1",
          customer: CUSTOMER_ID,
          client_reference_id: TEST_USER_ID,
        },
      },
    });
    const sig = await createSignedHeader(payload);

    const req = new Request("http://localhost/stripe-webhook", {
      method: "POST",
      headers: {
        "Stripe-Signature": sig,
        "Content-Type": "application/json",
      },
      body: payload,
    });

    const res = await app.fetch(req);
    assertEquals(res.status, 200);
    const data = await res.json();
    assertEquals(data.received, true);
    assertEquals(eventRecorded, true);
    assertEquals(processedAtSet, true);
    assertEquals(userUpdatePayload?.billing_customer_id, CUSTOMER_ID);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("stripe-webhook: invoice.paid updates plan and paid_until by billing_customer_id", async () => {
  setupEnv();

  let userUpdatePayload: any = null;
  const linePeriodEnd = 1761955200; // 2025-10-31T00:00:00.000Z

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/rest/v1/billing_events")) {
      return new Response(JSON.stringify([{ event_id: "evt_invoice_1" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/users")) {
      if (init?.method === "PATCH") {
        userUpdatePayload = JSON.parse(init.body as string);
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // User lookup by billing_customer_id
      return new Response(JSON.stringify({ id: TEST_USER_ID }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input, init);
  };

  try {
    const payload = JSON.stringify({
      id: "evt_invoice_1",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_test_1",
          customer: CUSTOMER_ID,
          lines: {
            data: [
              {
                price: { id: "price_basic_env_123" },
                period: { end: linePeriodEnd },
              },
            ],
          },
        },
      },
    });
    const sig = await createSignedHeader(payload);

    const req = new Request("http://localhost/stripe-webhook", {
      method: "POST",
      headers: {
        "Stripe-Signature": sig,
        "Content-Type": "application/json",
      },
      body: payload,
    });

    const res = await app.fetch(req);
    assertEquals(res.status, 200);
    const data = await res.json();
    assertEquals(data.received, true);
    assertEquals(userUpdatePayload?.plan, "basic");
    assertEquals(userUpdatePayload?.paid_until, new Date(linePeriodEnd * 1000).toISOString());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("stripe-webhook: invoice.paid resolves user via subscription metadata fallback", async () => {
  setupEnv();

  let userUpdatePayload: any = null;
  const linePeriodEnd = 1761955200;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/rest/v1/billing_events")) {
      return new Response(JSON.stringify([{ event_id: "evt_invoice_meta" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/users")) {
      if (init?.method === "PATCH") {
        userUpdatePayload = JSON.parse(init.body as string);
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // Customer lookup returns null
      return new Response(JSON.stringify(null), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input, init);
  };

  try {
    const payload = JSON.stringify({
      id: "evt_invoice_meta",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_test_meta",
          customer: "cus_unindexed_new",
          subscription_details: {
            metadata: {
              user_id: TEST_USER_ID,
            },
          },
          lines: {
            data: [
              {
                price: { id: "price_pro_env_456" },
                period: { end: linePeriodEnd },
              },
            ],
          },
        },
      },
    });
    const sig = await createSignedHeader(payload);

    const req = new Request("http://localhost/stripe-webhook", {
      method: "POST",
      headers: {
        "Stripe-Signature": sig,
        "Content-Type": "application/json",
      },
      body: payload,
    });

    const res = await app.fetch(req);
    assertEquals(res.status, 200);
    const data = await res.json();
    assertEquals(data.received, true);
    assertEquals(userUpdatePayload?.plan, "pro");
    assertEquals(userUpdatePayload?.paid_until, new Date(linePeriodEnd * 1000).toISOString());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("stripe-webhook: customer.subscription.deleted does not mutate user", async () => {
  setupEnv();

  let userUpdated = false;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/rest/v1/billing_events")) {
      return new Response(JSON.stringify([{ event_id: "evt_sub_del" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/users")) {
      if (init?.method === "PATCH") {
        userUpdated = true;
      }
      return new Response(JSON.stringify({ id: TEST_USER_ID }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input, init);
  };

  try {
    const payload = JSON.stringify({
      id: "evt_sub_del",
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_123",
          customer: CUSTOMER_ID,
        },
      },
    });
    const sig = await createSignedHeader(payload);

    const req = new Request("http://localhost/stripe-webhook", {
      method: "POST",
      headers: {
        "Stripe-Signature": sig,
        "Content-Type": "application/json",
      },
      body: payload,
    });

    const res = await app.fetch(req);
    assertEquals(res.status, 200);
    const data = await res.json();
    assertEquals(data.received, true);
    assertEquals(userUpdated, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("stripe-webhook: charge.refunded sets paid_until to now()", async () => {
  setupEnv();

  let userUpdatePayload: any = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/rest/v1/billing_events")) {
      return new Response(JSON.stringify([{ event_id: "evt_refund_1" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/users")) {
      if (init?.method === "PATCH") {
        userUpdatePayload = JSON.parse(init.body as string);
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input, init);
  };

  try {
    const payload = JSON.stringify({
      id: "evt_refund_1",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_123",
          customer: CUSTOMER_ID,
        },
      },
    });
    const sig = await createSignedHeader(payload);

    const before = Date.now();
    const req = new Request("http://localhost/stripe-webhook", {
      method: "POST",
      headers: {
        "Stripe-Signature": sig,
        "Content-Type": "application/json",
      },
      body: payload,
    });

    const res = await app.fetch(req);
    const after = Date.now();

    assertEquals(res.status, 200);
    const data = await res.json();
    assertEquals(data.received, true);
    assertExists(userUpdatePayload?.paid_until);

    const paidUntilTs = new Date(userUpdatePayload.paid_until).getTime();
    assertEquals(paidUntilTs >= before - 1000 && paidUntilTs <= after + 1000, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("stripe-webhook: unknown event type returns 200 ignored:true", async () => {
  setupEnv();

  let userUpdated = false;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/rest/v1/billing_events")) {
      return new Response(JSON.stringify([{ event_id: "evt_unknown_1" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/users")) {
      if (init?.method === "PATCH") {
        userUpdated = true;
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input, init);
  };

  try {
    const payload = JSON.stringify({
      id: "evt_unknown_1",
      type: "payment_intent.created",
      data: {
        object: {
          id: "pi_123",
        },
      },
    });
    const sig = await createSignedHeader(payload);

    const req = new Request("http://localhost/stripe-webhook", {
      method: "POST",
      headers: {
        "Stripe-Signature": sig,
        "Content-Type": "application/json",
      },
      body: payload,
    });

    const res = await app.fetch(req);
    assertEquals(res.status, 200);
    const data = await res.json();
    assertEquals(data.ignored, true);
    assertEquals(userUpdated, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
