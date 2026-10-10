import { assertEquals, assertThrows } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  getStripeConfig,
  resolveStripeConfig,
  LiveKeyRefusedError,
  createBillingErrorResponse,
} from "./stripeConfig.ts";

Deno.test("stripeConfig: getStripeConfig returns null when STRIPE_SECRET_KEY is unset", () => {
  Deno.env.delete("STRIPE_SECRET_KEY");
  const config = getStripeConfig();
  assertEquals(config, null);
});

Deno.test("stripeConfig: getStripeConfig throws LiveKeyRefusedError for sk_live_", () => {
  Deno.env.set("STRIPE_SECRET_KEY", "sk_live_" + "1234567890abcdef");
  try {
    assertThrows(
      () => getStripeConfig(),
      LiveKeyRefusedError,
      "Live Stripe keys are not allowed in this environment.",
    );
  } finally {
    Deno.env.delete("STRIPE_SECRET_KEY");
  }
});

Deno.test("stripeConfig: getStripeConfig throws LiveKeyRefusedError for rk_live_", () => {
  Deno.env.set("STRIPE_SECRET_KEY", "rk_live_" + "1234567890abcdef");
  try {
    assertThrows(
      () => getStripeConfig(),
      LiveKeyRefusedError,
      "Live Stripe keys are not allowed in this environment.",
    );
  } finally {
    Deno.env.delete("STRIPE_SECRET_KEY");
  }
});

Deno.test("stripeConfig: getStripeConfig returns config and Stripe client for sk_test_", () => {
  Deno.env.set("STRIPE_SECRET_KEY", "sk_test_" + "1234567890abcdef");
  Deno.env.set("STRIPE_WEBHOOK_SECRET", "whsec_test_secret");
  Deno.env.set("STRIPE_PRICE_BASIC", "price_basic_1");
  Deno.env.set("STRIPE_PRICE_PRO", "price_pro_1");

  try {
    const config = getStripeConfig();
    assertEquals(config !== null, true);
    assertEquals(config?.stripeSecretKey, "sk_test_" + "1234567890abcdef");
    assertEquals(config?.stripeWebhookSecret, "whsec_test_secret");
    assertEquals(config?.stripePriceBasic, "price_basic_1");
    assertEquals(config?.stripePricePro, "price_pro_1");
    assertEquals(typeof config?.stripe?.checkout?.sessions?.create, "function");
  } finally {
    Deno.env.delete("STRIPE_SECRET_KEY");
    Deno.env.delete("STRIPE_WEBHOOK_SECRET");
    Deno.env.delete("STRIPE_PRICE_BASIC");
    Deno.env.delete("STRIPE_PRICE_PRO");
  }
});

Deno.test("stripeConfig: resolveStripeConfig returns 503 billing_not_configured response when unset", async () => {
  Deno.env.delete("STRIPE_SECRET_KEY");
  const result = resolveStripeConfig({ "Access-Control-Allow-Origin": "https://www.yourbody.fyi" });
  assertEquals(result.config, null);
  assertEquals(result.response !== null, true);
  assertEquals(result.response?.status, 503);
  assertEquals(result.response?.headers.get("Access-Control-Allow-Origin"), "https://www.yourbody.fyi");
  const data = await result.response?.json();
  assertEquals(data?.code, "billing_not_configured");
});

Deno.test("stripeConfig: resolveStripeConfig returns 503 live_keys_refused response for live key", async () => {
  Deno.env.set("STRIPE_SECRET_KEY", "sk_live_" + "sample");
  try {
    const result = resolveStripeConfig();
    assertEquals(result.config, null);
    assertEquals(result.response !== null, true);
    assertEquals(result.response?.status, 503);
    const data = await result.response?.json();
    assertEquals(data?.code, "live_keys_refused");
  } finally {
    Deno.env.delete("STRIPE_SECRET_KEY");
  }
});

Deno.test("stripeConfig: createBillingErrorResponse formats status and body correctly", async () => {
  const res = createBillingErrorResponse("billing_not_configured", { "X-Custom": "test" });
  assertEquals(res.status, 503);
  assertEquals(res.headers.get("X-Custom"), "test");
  assertEquals(res.headers.get("Content-Type"), "application/json");
  const data = await res.json();
  assertEquals(data.code, "billing_not_configured");
});
