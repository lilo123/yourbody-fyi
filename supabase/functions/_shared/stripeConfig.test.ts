import { assertEquals, assertThrows } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  getStripeConfig,
  resolveStripeConfig,
  LiveKeyRefusedError,
  PriceModeMismatchError,
  createBillingErrorResponse,
  validatePriceMode,
  assertPriceMode,
} from "./stripeConfig.ts";

Deno.test("stripeConfig: getStripeConfig returns null when STRIPE_SECRET_KEY is unset", () => {
  Deno.env.delete("STRIPE_SECRET_KEY");
  const config = getStripeConfig();
  assertEquals(config, null);
});

Deno.test("stripeConfig: getStripeConfig throws LiveKeyRefusedError for sk_live_ when STRIPE_LIVE_ENABLED unset", () => {
  Deno.env.set("STRIPE_SECRET_KEY", "sk_live_" + "1234567890abcdef");
  Deno.env.delete("STRIPE_LIVE_ENABLED");
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

Deno.test("stripeConfig: getStripeConfig throws LiveKeyRefusedError for sk_live_ when STRIPE_LIVE_ENABLED is not exactly true", () => {
  const invalidValues = ["TRUE", "1", "yes", " true", "false", "0"];
  for (const val of invalidValues) {
    Deno.env.set("STRIPE_SECRET_KEY", "sk_live_" + "1234567890abcdef");
    Deno.env.set("STRIPE_LIVE_ENABLED", val);
    try {
      assertThrows(
        () => getStripeConfig(),
        LiveKeyRefusedError,
        "Live Stripe keys are not allowed in this environment.",
      );
    } finally {
      Deno.env.delete("STRIPE_SECRET_KEY");
      Deno.env.delete("STRIPE_LIVE_ENABLED");
    }
  }
});

Deno.test("stripeConfig: getStripeConfig throws LiveKeyRefusedError for rk_live_ when STRIPE_LIVE_ENABLED unset", () => {
  Deno.env.set("STRIPE_SECRET_KEY", "rk_live_" + "1234567890abcdef");
  Deno.env.delete("STRIPE_LIVE_ENABLED");
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

Deno.test("stripeConfig: getStripeConfig allows sk_live_ when STRIPE_LIVE_ENABLED is exactly true", () => {
  Deno.env.set("STRIPE_SECRET_KEY", "sk_live_" + "1234567890abcdef");
  Deno.env.set("STRIPE_LIVE_ENABLED", "true");
  try {
    const config = getStripeConfig();
    assertEquals(config !== null, true);
    assertEquals(config?.isLive, true);
    assertEquals(config?.stripeSecretKey, "sk_live_" + "1234567890abcdef");
  } finally {
    Deno.env.delete("STRIPE_SECRET_KEY");
    Deno.env.delete("STRIPE_LIVE_ENABLED");
  }
});

Deno.test("stripeConfig: getStripeConfig allows rk_live_ when STRIPE_LIVE_ENABLED is exactly true", () => {
  Deno.env.set("STRIPE_SECRET_KEY", "rk_live_" + "1234567890abcdef");
  Deno.env.set("STRIPE_LIVE_ENABLED", "true");
  try {
    const config = getStripeConfig();
    assertEquals(config !== null, true);
    assertEquals(config?.isLive, true);
    assertEquals(config?.stripeSecretKey, "rk_live_" + "1234567890abcdef");
  } finally {
    Deno.env.delete("STRIPE_SECRET_KEY");
    Deno.env.delete("STRIPE_LIVE_ENABLED");
  }
});

Deno.test("stripeConfig: getStripeConfig returns config with isLive false for sk_test_ when flag unset", () => {
  Deno.env.set("STRIPE_SECRET_KEY", "sk_test_" + "1234567890abcdef");
  Deno.env.delete("STRIPE_LIVE_ENABLED");
  Deno.env.set("STRIPE_WEBHOOK_SECRET", "whsec_test_secret");
  Deno.env.set("STRIPE_PRICE_BASIC", "price_basic_1");
  Deno.env.set("STRIPE_PRICE_PRO", "price_pro_1");

  try {
    const config = getStripeConfig();
    assertEquals(config !== null, true);
    assertEquals(config?.isLive, false);
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

Deno.test("stripeConfig: getStripeConfig returns config with isLive false for sk_test_ even when STRIPE_LIVE_ENABLED is true", () => {
  Deno.env.set("STRIPE_SECRET_KEY", "sk_test_" + "1234567890abcdef");
  Deno.env.set("STRIPE_LIVE_ENABLED", "true");

  try {
    const config = getStripeConfig();
    assertEquals(config !== null, true);
    assertEquals(config?.isLive, false);
  } finally {
    Deno.env.delete("STRIPE_SECRET_KEY");
    Deno.env.delete("STRIPE_LIVE_ENABLED");
  }
});

Deno.test("stripeConfig: getStripeConfig returns config with isLive false for rk_test_ even when STRIPE_LIVE_ENABLED is true", () => {
  Deno.env.set("STRIPE_SECRET_KEY", "rk_test_" + "1234567890abcdef");
  Deno.env.set("STRIPE_LIVE_ENABLED", "true");

  try {
    const config = getStripeConfig();
    assertEquals(config !== null, true);
    assertEquals(config?.isLive, false);
  } finally {
    Deno.env.delete("STRIPE_SECRET_KEY");
    Deno.env.delete("STRIPE_LIVE_ENABLED");
  }
});

Deno.test("stripeConfig: validatePriceMode correctly compares price livemode and key mode", () => {
  assertEquals(validatePriceMode({ livemode: false }, false), true);
  assertEquals(validatePriceMode({ livemode: true }, true), true);
  assertEquals(validatePriceMode({ livemode: true }, false), false);
  assertEquals(validatePriceMode({ livemode: false }, true), false);
});

Deno.test("stripeConfig: assertPriceMode throws PriceModeMismatchError on mismatch and passes on match", () => {
  assertPriceMode({ livemode: false }, false);
  assertPriceMode({ livemode: true }, true);
  assertThrows(
    () => assertPriceMode({ livemode: true }, false),
    PriceModeMismatchError,
    "Price livemode does not match Stripe key mode.",
  );
  assertThrows(
    () => assertPriceMode({ livemode: false }, true),
    PriceModeMismatchError,
    "Price livemode does not match Stripe key mode.",
  );
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

Deno.test("stripeConfig: resolveStripeConfig returns 503 live_keys_refused response for live key without flag", async () => {
  Deno.env.set("STRIPE_SECRET_KEY", "sk_live_" + "sample");
  Deno.env.delete("STRIPE_LIVE_ENABLED");
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

Deno.test("stripeConfig: resolveStripeConfig returns config for live key when STRIPE_LIVE_ENABLED is true", () => {
  Deno.env.set("STRIPE_SECRET_KEY", "sk_live_" + "sample");
  Deno.env.set("STRIPE_LIVE_ENABLED", "true");
  try {
    const result = resolveStripeConfig();
    assertEquals(result.response, null);
    assertEquals(result.config !== null, true);
    assertEquals(result.config?.isLive, true);
  } finally {
    Deno.env.delete("STRIPE_SECRET_KEY");
    Deno.env.delete("STRIPE_LIVE_ENABLED");
  }
});

Deno.test("stripeConfig: createBillingErrorResponse formats status and body correctly", async () => {
  const res1 = createBillingErrorResponse("billing_not_configured", { "X-Custom": "test" });
  assertEquals(res1.status, 503);
  assertEquals(res1.headers.get("X-Custom"), "test");
  assertEquals(res1.headers.get("Content-Type"), "application/json");
  const data1 = await res1.json();
  assertEquals(data1.code, "billing_not_configured");

  const res2 = createBillingErrorResponse("price_mode_mismatch");
  assertEquals(res2.status, 503);
  const data2 = await res2.json();
  assertEquals(data2.code, "price_mode_mismatch");
  assertEquals(data2.error, "Price livemode does not match Stripe key mode.");
});
