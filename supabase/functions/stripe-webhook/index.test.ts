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
    if (url.includes("/v1/charges/ch_test_1")) {
      return new Response(
        JSON.stringify({
          id: "ch_test_1",
          customer: CUSTOMER_ID,
          amount: 2000,
          amount_refunded: 0,
          disputed: false,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    if (url.includes("/rest/v1/billing_grandfather")) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
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
          charge: "ch_test_1",
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
    if (url.includes("/v1/charges/ch_test_meta")) {
      return new Response(
        JSON.stringify({
          id: "ch_test_meta",
          amount: 2000,
          amount_refunded: 0,
          disputed: false,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    if (url.includes("/rest/v1/billing_grandfather")) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
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
          charge: "ch_test_meta",
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
    if (url.includes("/v1/subscriptions")) {
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
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
          amount: 5000,
          amount_refunded: 5000,
          refunds: {
            data: [],
          },
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

Deno.test("stripe-webhook: full refund revokes access by updating paid_until", async () => {
  setupEnv();

  let userUpdatePayload: any = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/v1/subscriptions")) {
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/billing_events")) {
      return new Response(JSON.stringify([{ event_id: "evt_full_refund_1" }]), {
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
      return new Response(
        JSON.stringify({ id: TEST_USER_ID, paid_until: "2030-01-01T00:00:00.000Z" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    return originalFetch(input, init);
  };

  try {
    const payload = JSON.stringify({
      id: "evt_full_refund_1",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_full_123",
          customer: CUSTOMER_ID,
          amount: 5000,
          amount_refunded: 5000,
          refunds: {
            data: [],
          },
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

Deno.test("stripe-webhook: partial refund does not mutate user paid_until", async () => {
  setupEnv();

  let userUpdated = false;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/rest/v1/billing_events")) {
      return new Response(JSON.stringify([{ event_id: "evt_partial_refund_1" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/users")) {
      if (init?.method === "PATCH") {
        userUpdated = true;
      }
      return new Response(
        JSON.stringify({ id: TEST_USER_ID, paid_until: "2030-01-01T00:00:00.000Z" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    return originalFetch(input, init);
  };

  try {
    const payload = JSON.stringify({
      id: "evt_partial_refund_1",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_partial_123",
          customer: CUSTOMER_ID,
          amount: 5000,
          amount_refunded: 2000,
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

Deno.test("stripe-webhook: full refund with refund metadata keep_access=true does not revoke", async () => {
  setupEnv();

  let userUpdated = false;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/rest/v1/billing_events")) {
      return new Response(JSON.stringify([{ event_id: "evt_goodwill_refund_1" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/users")) {
      if (init?.method === "PATCH") {
        userUpdated = true;
      }
      return new Response(
        JSON.stringify({ id: TEST_USER_ID, paid_until: "2030-01-01T00:00:00.000Z" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    return originalFetch(input, init);
  };

  try {
    const payload = JSON.stringify({
      id: "evt_goodwill_refund_1",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_goodwill_123",
          customer: CUSTOMER_ID,
          amount: 5000,
          amount_refunded: 5000,
          refunds: {
            data: [
              {
                id: "re_goodwill_1",
                metadata: {
                  keep_access: "true",
                },
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
    assertEquals(userUpdated, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("stripe-webhook: full refund with PaymentIntent metadata keep_access=true does not revoke", async () => {
  setupEnv();

  let userUpdated = false;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/v1/payment_intents/pi_goodwill_456")) {
      return new Response(
        JSON.stringify({
          id: "pi_goodwill_456",
          metadata: { keep_access: "true" },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    if (url.includes("/rest/v1/billing_events")) {
      return new Response(JSON.stringify([{ event_id: "evt_goodwill_pi_1" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/users")) {
      if (init?.method === "PATCH") {
        userUpdated = true;
      }
      return new Response(
        JSON.stringify({ id: TEST_USER_ID, paid_until: "2030-01-01T00:00:00.000Z" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    return originalFetch(input, init);
  };

  try {
    const payload = JSON.stringify({
      id: "evt_goodwill_pi_1",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_goodwill_pi_123",
          customer: CUSTOMER_ID,
          amount: 5000,
          amount_refunded: 5000,
          payment_intent: "pi_goodwill_456",
          refunds: {
            data: [],
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
    assertEquals(userUpdated, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("stripe-webhook: full refund with refunds API lookup keep_access=true does not revoke", async () => {
  setupEnv();

  let userUpdated = false;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/v1/refunds")) {
      return new Response(
        JSON.stringify({
          object: "list",
          data: [
            {
              id: "re_api_goodwill_1",
              metadata: { keep_access: "true" },
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    if (url.includes("/rest/v1/billing_events")) {
      return new Response(JSON.stringify([{ event_id: "evt_goodwill_api_refund_1" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/users")) {
      if (init?.method === "PATCH") {
        userUpdated = true;
      }
      return new Response(
        JSON.stringify({ id: TEST_USER_ID, paid_until: "2030-01-01T00:00:00.000Z" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    return originalFetch(input, init);
  };

  try {
    const payload = JSON.stringify({
      id: "evt_goodwill_api_refund_1",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_goodwill_api_123",
          customer: CUSTOMER_ID,
          amount: 5000,
          amount_refunded: 5000,
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

Deno.test("stripe-webhook: charge.dispute.created resolves customer via charge, revokes access, and records user_id", async () => {
  setupEnv();

  let userUpdatePayload: any = null;
  let recordedUserId: string | null = null;
  let processedAtSet = false;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/v1/charges/ch_dispute_target_789")) {
      return new Response(
        JSON.stringify({
          id: "ch_dispute_target_789",
          customer: CUSTOMER_ID,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    if (url.includes("/v1/subscriptions")) {
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/billing_events")) {
      if (init?.method === "PATCH") {
        processedAtSet = true;
        const patchBody = JSON.parse(init.body as string);
        if (patchBody.user_id) {
          recordedUserId = patchBody.user_id;
        }
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify([{ event_id: "evt_dispute_123" }]), {
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
      return new Response(
        JSON.stringify({ id: TEST_USER_ID, paid_until: "2030-01-01T00:00:00.000Z" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    return originalFetch(input, init);
  };

  try {
    const payload = JSON.stringify({
      id: "evt_dispute_123",
      type: "charge.dispute.created",
      data: {
        object: {
          id: "dp_dispute_123",
          charge: "ch_dispute_target_789",
          amount: 5000,
          currency: "usd",
          status: "needs_response",
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
    assertEquals(processedAtSet, true);
    assertEquals(recordedUserId, TEST_USER_ID);
    assertExists(userUpdatePayload?.paid_until);

    const paidUntilTs = new Date(userUpdatePayload.paid_until).getTime();
    assertEquals(paidUntilTs >= before - 1000 && paidUntilTs <= after + 1000, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("stripe-webhook: Stripe API lookup failure returns non-2xx and event is not marked processed", async () => {
  setupEnv();

  let processedAtSet = false;
  let billingEventDeleted = false;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/v1/charges/ch_failing_charge_999")) {
      return new Response(
        JSON.stringify({ error: { message: "Simulated Stripe API outage" } }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    if (url.includes("/rest/v1/billing_events")) {
      if (init?.method === "DELETE") {
        billingEventDeleted = true;
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (init?.method === "PATCH") {
        processedAtSet = true;
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify([{ event_id: "evt_failing_lookup_1" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input, init);
  };

  try {
    const payload = JSON.stringify({
      id: "evt_failing_lookup_1",
      type: "charge.dispute.created",
      data: {
        object: {
          id: "dp_failing_123",
          charge: "ch_failing_charge_999",
          amount: 5000,
          currency: "usd",
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
    assertEquals(res.status >= 500, true);
    assertEquals(processedAtSet, false);
    assertEquals(billingEventDeleted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("stripe-webhook: user update database error returns 502 and event is not marked processed", async () => {
  setupEnv();

  let processedAtSet = false;
  let billingEventDeleted = false;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/rest/v1/billing_events")) {
      if (init?.method === "DELETE") {
        billingEventDeleted = true;
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (init?.method === "PATCH") {
        processedAtSet = true;
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify([{ event_id: "evt_db_error_1" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/users")) {
      if (init?.method === "PATCH") {
        return new Response(
          JSON.stringify({ message: "relation error", code: "PGRST500" }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      return new Response(
        JSON.stringify({ id: TEST_USER_ID, paid_until: "2030-01-01T00:00:00.000Z" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    return originalFetch(input, init);
  };

  try {
    const payload = JSON.stringify({
      id: "evt_db_error_1",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_db_error_1",
          customer: CUSTOMER_ID,
          amount: 5000,
          amount_refunded: 5000,
          refunds: {
            data: [],
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
    assertEquals(res.status, 502);
    assertEquals(processedAtSet, false);
    assertEquals(billingEventDeleted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("stripe-webhook: invoice.paid resolves plan from pricing.price_details.price (new shape)", async () => {
  setupEnv();

  let userUpdatePayload: any = null;
  const linePeriodEnd = 1761955200;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/v1/charges/ch_new_shape_1")) {
      return new Response(
        JSON.stringify({
          id: "ch_new_shape_1",
          customer: CUSTOMER_ID,
          amount: 2000,
          amount_refunded: 0,
          disputed: false,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    if (url.includes("/rest/v1/billing_grandfather")) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/billing_events")) {
      return new Response(JSON.stringify([{ event_id: "evt_new_shape_1" }]), {
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
      return new Response(JSON.stringify({ id: TEST_USER_ID }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input, init);
  };

  try {
    const payload = JSON.stringify({
      id: "evt_new_shape_1",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_new_shape_1",
          customer: CUSTOMER_ID,
          charge: "ch_new_shape_1",
          lines: {
            data: [
              {
                pricing: {
                  price_details: {
                    price: "price_pro_env_456",
                  },
                },
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

Deno.test("stripe-webhook: invoice.paid resolves plan via subscription item fallback", async () => {
  setupEnv();

  let userUpdatePayload: any = null;
  const linePeriodEnd = 1761955200;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/v1/subscriptions/sub_item_fallback_1")) {
      return new Response(
        JSON.stringify({
          id: "sub_item_fallback_1",
          items: {
            data: [
              {
                pricing: {
                  price_details: {
                    price: "price_basic_env_123",
                  },
                },
              },
            ],
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    if (url.includes("/v1/charges/ch_sub_fallback_1")) {
      return new Response(
        JSON.stringify({
          id: "ch_sub_fallback_1",
          customer: CUSTOMER_ID,
          amount: 2000,
          amount_refunded: 0,
          disputed: false,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    if (url.includes("/rest/v1/billing_grandfather")) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/billing_events")) {
      return new Response(JSON.stringify([{ event_id: "evt_sub_fallback_1" }]), {
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
      return new Response(JSON.stringify({ id: TEST_USER_ID }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input, init);
  };

  try {
    const payload = JSON.stringify({
      id: "evt_sub_fallback_1",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_sub_fallback_1",
          customer: CUSTOMER_ID,
          charge: "ch_sub_fallback_1",
          parent: {
            subscription_details: {
              subscription: "sub_item_fallback_1",
            },
          },
          lines: {
            data: [
              {
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

Deno.test("stripe-webhook: invoice.paid with unresolvable plan leaves user unchanged", async () => {
  setupEnv();

  let userUpdated = false;
  let processedAtSet = false;
  const linePeriodEnd = 1761955200;

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
      return new Response(JSON.stringify([{ event_id: "evt_unresolvable_1" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/users")) {
      if (init?.method === "PATCH") {
        userUpdated = true;
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
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
      id: "evt_unresolvable_1",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_unresolvable_1",
          customer: CUSTOMER_ID,
          lines: {
            data: [
              {
                pricing: {
                  price_details: {
                    price: "price_unmapped_tier_999",
                  },
                },
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
    assertEquals(userUpdated, false);
    assertEquals(processedAtSet, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("stripe-webhook: invoice.paid after a disputed charge skips grant", async () => {
  setupEnv();

  let userUpdated = false;
  let processedAtSet = false;
  let recordedUserId: string | null = null;
  const linePeriodEnd = 1761955200;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/v1/invoices/in_dispute_1")) {
      return new Response(
        JSON.stringify({
          id: "in_dispute_1",
          payments: {
            object: "list",
            data: [
              {
                id: "inpay_disp_1",
                payment: {
                  payment_intent: {
                    id: "pi_disp_1",
                    latest_charge: "ch_disp_1",
                  },
                },
              },
            ],
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    if (url.includes("/v1/charges/ch_disp_1")) {
      return new Response(
        JSON.stringify({
          id: "ch_disp_1",
          amount: 2000,
          amount_refunded: 0,
          disputed: true,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    if (url.includes("/rest/v1/billing_events")) {
      if (init?.method === "PATCH") {
        processedAtSet = true;
        const patchBody = JSON.parse(init.body as string);
        if (patchBody.user_id) {
          recordedUserId = patchBody.user_id;
        }
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify([{ event_id: "evt_dispute_inv_1" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/users")) {
      if (init?.method === "PATCH") {
        userUpdated = true;
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
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
      id: "evt_dispute_inv_1",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_dispute_1",
          customer: CUSTOMER_ID,
          lines: {
            data: [
              {
                pricing: {
                  price_details: {
                    price: "price_pro_env_456",
                  },
                },
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
    assertEquals(userUpdated, false);
    assertEquals(processedAtSet, true);
    assertEquals(recordedUserId, TEST_USER_ID);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("stripe-webhook: invoice.paid after a full refund skips grant", async () => {
  setupEnv();

  let userUpdated = false;
  let processedAtSet = false;
  let recordedUserId: string | null = null;
  const linePeriodEnd = 1761955200;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/v1/charges/ch_refunded_1")) {
      return new Response(
        JSON.stringify({
          id: "ch_refunded_1",
          amount: 2000,
          amount_refunded: 2000,
          disputed: false,
          refunds: { data: [] },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    if (url.includes("/rest/v1/billing_events")) {
      if (init?.method === "PATCH") {
        processedAtSet = true;
        const patchBody = JSON.parse(init.body as string);
        if (patchBody.user_id) {
          recordedUserId = patchBody.user_id;
        }
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify([{ event_id: "evt_refunded_inv_1" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/users")) {
      if (init?.method === "PATCH") {
        userUpdated = true;
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
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
      id: "evt_refunded_inv_1",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_refunded_1",
          customer: CUSTOMER_ID,
          charge: "ch_refunded_1",
          lines: {
            data: [
              {
                pricing: {
                  price_details: {
                    price: "price_pro_env_456",
                  },
                },
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
    assertEquals(userUpdated, false);
    assertEquals(processedAtSet, true);
    assertEquals(recordedUserId, TEST_USER_ID);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("stripe-webhook: invoice.paid after a full refund with keep_access grants entitlement", async () => {
  setupEnv();

  let userUpdatePayload: any = null;
  const linePeriodEnd = 1761955200;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/v1/charges/ch_keep_access_1")) {
      return new Response(
        JSON.stringify({
          id: "ch_keep_access_1",
          amount: 2000,
          amount_refunded: 2000,
          disputed: false,
          metadata: { keep_access: "true" },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    if (url.includes("/rest/v1/billing_grandfather")) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/billing_events")) {
      return new Response(JSON.stringify([{ event_id: "evt_keep_access_inv_1" }]), {
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
      return new Response(JSON.stringify({ id: TEST_USER_ID }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input, init);
  };

  try {
    const payload = JSON.stringify({
      id: "evt_keep_access_inv_1",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_keep_access_1",
          customer: CUSTOMER_ID,
          charge: "ch_keep_access_1",
          lines: {
            data: [
              {
                pricing: {
                  price_details: {
                    price: "price_pro_env_456",
                  },
                },
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

Deno.test("stripe-webhook: invoice.paid lookup failure returns 502 and event not processed", async () => {
  setupEnv();

  let processedAtSet = false;
  let billingEventDeleted = false;
  const linePeriodEnd = 1761955200;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/v1/invoices/in_lookup_fail_1")) {
      return new Response(
        JSON.stringify({ error: { message: "Simulated Stripe API invoice error" } }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    if (url.includes("/rest/v1/billing_events")) {
      if (init?.method === "DELETE") {
        billingEventDeleted = true;
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (init?.method === "PATCH") {
        processedAtSet = true;
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify([{ event_id: "evt_lookup_fail_1" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/users")) {
      return new Response(JSON.stringify({ id: TEST_USER_ID }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input, init);
  };

  try {
    const payload = JSON.stringify({
      id: "evt_lookup_fail_1",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_lookup_fail_1",
          customer: CUSTOMER_ID,
          lines: {
            data: [
              {
                pricing: {
                  price_details: {
                    price: "price_pro_env_456",
                  },
                },
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
    assertEquals(res.status, 502);
    assertEquals(processedAtSet, false);
    assertEquals(billingEventDeleted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("stripe-webhook: invoice.paid users update database error returns 502 and event is not marked processed", async () => {
  setupEnv();

  let processedAtSet = false;
  let billingEventDeleted = false;
  const linePeriodEnd = 1761955200;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/v1/charges/ch_db_error_inv_1")) {
      return new Response(
        JSON.stringify({
          id: "ch_db_error_inv_1",
          customer: CUSTOMER_ID,
          amount: 2000,
          amount_refunded: 0,
          disputed: false,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    if (url.includes("/rest/v1/billing_grandfather")) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/billing_events")) {
      if (init?.method === "DELETE") {
        billingEventDeleted = true;
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (init?.method === "PATCH") {
        processedAtSet = true;
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify([{ event_id: "evt_db_error_inv_1" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/users")) {
      if (init?.method === "PATCH") {
        return new Response(
          JSON.stringify({ message: "relation error", code: "PGRST500" }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      return new Response(
        JSON.stringify({ id: TEST_USER_ID }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    return originalFetch(input, init);
  };

  try {
    const payload = JSON.stringify({
      id: "evt_db_error_inv_1",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_db_error_inv_1",
          customer: CUSTOMER_ID,
          charge: "ch_db_error_inv_1",
          lines: {
            data: [
              {
                pricing: {
                  price_details: {
                    price: "price_pro_env_456",
                  },
                },
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
    assertEquals(res.status, 502);
    assertEquals(processedAtSet, false);
    assertEquals(billingEventDeleted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("stripe-webhook: full refund cancels related subscription immediately without proration", async () => {
  setupEnv();

  let cancelCalled = false;
  let cancelUrl = "";
  let userUpdated = false;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/v1/payment_intents/pi_full_refund_1")) {
      return new Response(
        JSON.stringify({
          id: "pi_full_refund_1",
          invoice: "in_full_refund_1",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/v1/invoices/in_full_refund_1")) {
      return new Response(
        JSON.stringify({
          id: "in_full_refund_1",
          parent: {
            subscription_details: {
              subscription: "sub_full_refund_1",
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/v1/subscriptions/sub_full_refund_1")) {
      if (init?.method === "DELETE") {
        cancelCalled = true;
        cancelUrl = url;
        return new Response(
          JSON.stringify({ id: "sub_full_refund_1", status: "canceled" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
    }
    if (url.includes("/rest/v1/billing_events")) {
      return new Response(JSON.stringify([{ event_id: "evt_full_cancel_1" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/users")) {
      if (init?.method === "PATCH") {
        userUpdated = true;
      }
      return new Response(
        JSON.stringify({ id: TEST_USER_ID, paid_until: "2030-01-01T00:00:00.000Z" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return originalFetch(input, init);
  };

  try {
    const payload = JSON.stringify({
      id: "evt_full_cancel_1",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_full_cancel_1",
          customer: CUSTOMER_ID,
          payment_intent: "pi_full_refund_1",
          amount: 5000,
          amount_refunded: 5000,
          refunds: { data: [] },
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
    assertEquals(cancelCalled, true);
    assertEquals(cancelUrl.includes("prorate=false"), true);
    assertEquals(cancelUrl.includes("invoice_now=false"), true);
    assertEquals(userUpdated, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("stripe-webhook: dispute cancels related subscription immediately without proration", async () => {
  setupEnv();

  let cancelCalled = false;
  let cancelUrl = "";
  let userUpdated = false;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/v1/charges/ch_dispute_cancel_1")) {
      return new Response(
        JSON.stringify({
          id: "ch_dispute_cancel_1",
          customer: CUSTOMER_ID,
          payment_intent: "pi_dispute_cancel_1",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/v1/payment_intents/pi_dispute_cancel_1")) {
      return new Response(
        JSON.stringify({
          id: "pi_dispute_cancel_1",
          invoice: "in_dispute_cancel_1",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/v1/invoices/in_dispute_cancel_1")) {
      return new Response(
        JSON.stringify({
          id: "in_dispute_cancel_1",
          parent: {
            subscription_details: {
              subscription: "sub_dispute_cancel_1",
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/v1/subscriptions/sub_dispute_cancel_1")) {
      if (init?.method === "DELETE") {
        cancelCalled = true;
        cancelUrl = url;
        return new Response(
          JSON.stringify({ id: "sub_dispute_cancel_1", status: "canceled" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
    }
    if (url.includes("/rest/v1/billing_events")) {
      return new Response(JSON.stringify([{ event_id: "evt_dispute_cancel_1" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/users")) {
      if (init?.method === "PATCH") {
        userUpdated = true;
      }
      return new Response(
        JSON.stringify({ id: TEST_USER_ID, paid_until: "2030-01-01T00:00:00.000Z" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return originalFetch(input, init);
  };

  try {
    const payload = JSON.stringify({
      id: "evt_dispute_cancel_1",
      type: "charge.dispute.created",
      data: {
        object: {
          id: "dp_dispute_cancel_1",
          charge: "ch_dispute_cancel_1",
          amount: 5000,
          currency: "usd",
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
    assertEquals(cancelCalled, true);
    assertEquals(cancelUrl.includes("prorate=false"), true);
    assertEquals(cancelUrl.includes("invoice_now=false"), true);
    assertEquals(userUpdated, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("stripe-webhook: goodwill full refund does not call Stripe cancel", async () => {
  setupEnv();

  let cancelCalled = false;
  let userUpdated = false;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/v1/subscriptions") && init?.method === "DELETE") {
      cancelCalled = true;
    }
    if (url.includes("/rest/v1/billing_events")) {
      return new Response(JSON.stringify([{ event_id: "evt_goodwill_nocancel_1" }]), {
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
      id: "evt_goodwill_nocancel_1",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_goodwill_nocancel_1",
          customer: CUSTOMER_ID,
          amount: 5000,
          amount_refunded: 5000,
          metadata: { keep_access: "true" },
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
    assertEquals(cancelCalled, false);
    assertEquals(userUpdated, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("stripe-webhook: partial refund does not call Stripe cancel", async () => {
  setupEnv();

  let cancelCalled = false;
  let userUpdated = false;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/v1/subscriptions") && init?.method === "DELETE") {
      cancelCalled = true;
    }
    if (url.includes("/rest/v1/billing_events")) {
      return new Response(JSON.stringify([{ event_id: "evt_partial_nocancel_1" }]), {
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
      id: "evt_partial_nocancel_1",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_partial_nocancel_1",
          customer: CUSTOMER_ID,
          amount: 5000,
          amount_refunded: 2000,
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
    assertEquals(cancelCalled, false);
    assertEquals(userUpdated, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("stripe-webhook: already-canceled or resource_missing 404 returns 200 as idempotent success", async () => {
  setupEnv();

  let cancelCalled = false;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/v1/payment_intents/pi_missing_sub_1")) {
      return new Response(
        JSON.stringify({
          id: "pi_missing_sub_1",
          invoice: "in_missing_sub_1",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/v1/invoices/in_missing_sub_1")) {
      return new Response(
        JSON.stringify({
          id: "in_missing_sub_1",
          parent: {
            subscription_details: {
              subscription: "sub_missing_1",
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/v1/subscriptions/sub_missing_1")) {
      if (init?.method === "DELETE") {
        cancelCalled = true;
        return new Response(
          JSON.stringify({
            error: {
              code: "resource_missing",
              message: "No such subscription: 'sub_missing_1'",
              type: "invalid_request_error",
            },
          }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        );
      }
    }
    if (url.includes("/rest/v1/billing_events")) {
      return new Response(JSON.stringify([{ event_id: "evt_missing_sub_1" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/users")) {
      return new Response(
        JSON.stringify({ id: TEST_USER_ID, paid_until: "2030-01-01T00:00:00.000Z" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return originalFetch(input, init);
  };

  try {
    const payload = JSON.stringify({
      id: "evt_missing_sub_1",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_missing_sub_1",
          customer: CUSTOMER_ID,
          payment_intent: "pi_missing_sub_1",
          amount: 5000,
          amount_refunded: 5000,
          refunds: { data: [] },
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
    assertEquals(cancelCalled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("stripe-webhook: auto-cancel Stripe 500 error returns 502 and removes event row", async () => {
  setupEnv();

  let billingEventDeleted = false;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/v1/payment_intents/pi_stripe_err_1")) {
      return new Response(
        JSON.stringify({
          id: "pi_stripe_err_1",
          invoice: "in_stripe_err_1",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/v1/invoices/in_stripe_err_1")) {
      return new Response(
        JSON.stringify({
          id: "in_stripe_err_1",
          parent: {
            subscription_details: {
              subscription: "sub_stripe_err_1",
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/v1/subscriptions/sub_stripe_err_1")) {
      if (init?.method === "DELETE") {
        return new Response(
          JSON.stringify({
            error: {
              message: "Simulated Stripe outage on subscription cancel",
              type: "api_error",
            },
          }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }
    }
    if (url.includes("/rest/v1/billing_events")) {
      if (init?.method === "DELETE") {
        billingEventDeleted = true;
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify([{ event_id: "evt_stripe_err_1" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/users")) {
      return new Response(
        JSON.stringify({ id: TEST_USER_ID, paid_until: "2030-01-01T00:00:00.000Z" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return originalFetch(input, init);
  };

  try {
    const payload = JSON.stringify({
      id: "evt_stripe_err_1",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_stripe_err_1",
          customer: CUSTOMER_ID,
          payment_intent: "pi_stripe_err_1",
          amount: 5000,
          amount_refunded: 5000,
          refunds: { data: [] },
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
    assertEquals(res.status, 502);
    assertEquals(billingEventDeleted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("stripe-webhook: auto-cancel falls back to customer subscriptions when charge has no invoice", async () => {
  setupEnv();

  let cancelCalled = false;
  let cancelSubId = "";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/v1/subscriptions") && init?.method === "GET") {
      return new Response(
        JSON.stringify({
          data: [
            { id: "sub_fallback_active_1", status: "active" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/v1/subscriptions/sub_fallback_active_1") && init?.method === "DELETE") {
      cancelCalled = true;
      cancelSubId = "sub_fallback_active_1";
      return new Response(
        JSON.stringify({ id: "sub_fallback_active_1", status: "canceled" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/rest/v1/billing_events")) {
      return new Response(JSON.stringify([{ event_id: "evt_fallback_sub_1" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/users")) {
      return new Response(
        JSON.stringify({ id: TEST_USER_ID, paid_until: "2030-01-01T00:00:00.000Z" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return originalFetch(input, init);
  };

  try {
    const payload = JSON.stringify({
      id: "evt_fallback_sub_1",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_fallback_sub_1",
          customer: CUSTOMER_ID,
          amount: 5000,
          amount_refunded: 5000,
          refunds: { data: [] },
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
    assertEquals(cancelCalled, true);
    assertEquals(cancelSubId, "sub_fallback_active_1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("stripe-webhook: no subscription on one-off payment returns 200 without calling cancel", async () => {
  setupEnv();

  let cancelCalled = false;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/v1/subscriptions") && init?.method === "GET") {
      return new Response(
        JSON.stringify({ data: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/v1/subscriptions") && init?.method === "DELETE") {
      cancelCalled = true;
    }
    if (url.includes("/rest/v1/billing_events")) {
      return new Response(JSON.stringify([{ event_id: "evt_nosub_1" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/users")) {
      return new Response(
        JSON.stringify({ id: TEST_USER_ID, paid_until: "2030-01-01T00:00:00.000Z" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return originalFetch(input, init);
  };

  try {
    const payload = JSON.stringify({
      id: "evt_nosub_1",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_nosub_1",
          customer: CUSTOMER_ID,
          amount: 5000,
          amount_refunded: 5000,
          refunds: { data: [] },
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
    assertEquals(cancelCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("stripe-webhook: grandfathered user with active grant buying basic keeps pro and later paid_until", async () => {
  setupEnv();

  let userUpdatePayload: any = null;
  const linePeriodEnd = 1794268800; // 2026-11-10T00:00:00.000Z
  const grandfatherGrantedUntil = "2027-10-10T00:00:00.000Z";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/v1/charges/ch_gf_test_1")) {
      return new Response(
        JSON.stringify({
          id: "ch_gf_test_1",
          customer: CUSTOMER_ID,
          amount: 2000,
          amount_refunded: 0,
          disputed: false,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/rest/v1/billing_events")) {
      return new Response(JSON.stringify([{ event_id: "evt_gf_invoice_1" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/billing_grandfather")) {
      return new Response(
        JSON.stringify([{ granted_until: grandfatherGrantedUntil }]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/rest/v1/users")) {
      if (init?.method === "PATCH") {
        userUpdatePayload = JSON.parse(init.body as string);
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          id: TEST_USER_ID,
          plan: "pro",
          paid_until: grandfatherGrantedUntil,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return originalFetch(input, init);
  };

  try {
    const payload = JSON.stringify({
      id: "evt_gf_invoice_1",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_gf_test_1",
          customer: CUSTOMER_ID,
          charge: "ch_gf_test_1",
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
    assertEquals(userUpdatePayload?.plan, "pro");
    assertEquals(userUpdatePayload?.paid_until, grandfatherGrantedUntil);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("stripe-webhook: grandfathered user with expired grant buying basic updates plan to basic", async () => {
  setupEnv();

  let userUpdatePayload: any = null;
  const linePeriodEnd = 1794268800; // 2026-11-10T00:00:00.000Z
  const expiredGrantedUntil = "2024-01-01T00:00:00.000Z";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/v1/charges/ch_gf_expired_1")) {
      return new Response(
        JSON.stringify({
          id: "ch_gf_expired_1",
          customer: CUSTOMER_ID,
          amount: 2000,
          amount_refunded: 0,
          disputed: false,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/rest/v1/billing_events")) {
      return new Response(JSON.stringify([{ event_id: "evt_gf_expired_1" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/billing_grandfather")) {
      return new Response(
        JSON.stringify([{ granted_until: expiredGrantedUntil }]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/rest/v1/users")) {
      if (init?.method === "PATCH") {
        userUpdatePayload = JSON.parse(init.body as string);
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          id: TEST_USER_ID,
          plan: "pro",
          paid_until: expiredGrantedUntil,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return originalFetch(input, init);
  };

  try {
    const payload = JSON.stringify({
      id: "evt_gf_expired_1",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_gf_expired_1",
          customer: CUSTOMER_ID,
          charge: "ch_gf_expired_1",
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

Deno.test("stripe-webhook: non-grandfathered user buying basic overwrites plan and paid_until normally", async () => {
  setupEnv();

  let userUpdatePayload: any = null;
  const linePeriodEnd = 1794268800; // 2026-11-10T00:00:00.000Z

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/v1/charges/ch_nongf_1")) {
      return new Response(
        JSON.stringify({
          id: "ch_nongf_1",
          customer: CUSTOMER_ID,
          amount: 2000,
          amount_refunded: 0,
          disputed: false,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/rest/v1/billing_events")) {
      return new Response(JSON.stringify([{ event_id: "evt_nongf_1" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/billing_grandfather")) {
      return new Response(JSON.stringify([]), {
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
      return new Response(
        JSON.stringify({
          id: TEST_USER_ID,
          plan: "pro",
          paid_until: "2025-01-01T00:00:00.000Z",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return originalFetch(input, init);
  };

  try {
    const payload = JSON.stringify({
      id: "evt_nongf_1",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_nongf_1",
          customer: CUSTOMER_ID,
          charge: "ch_nongf_1",
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
