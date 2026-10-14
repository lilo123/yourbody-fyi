import { assertEquals, assertExists } from "jsr:@std/assert@1.0.19";
import {
  captureException,
  captureMessage,
  isEdgeReportingConfigured,
  resetEdgeReportingForTesting,
  scrubEdgeEvent,
  setTestCaptureHook,
} from "./errorReporting.ts";
import app from "../parse-nutrition/index.ts";

Deno.test("errorReporting shared helper: safe no-op when SENTRY_DSN is unset", async () => {
  const originalDsn = Deno.env.get("SENTRY_DSN");
  try {
    Deno.env.delete("SENTRY_DSN");
    resetEdgeReportingForTesting();

    assertEquals(isEdgeReportingConfigured(), false);

    // Calling captureException must resolve without error and without initializing Sentry
    await captureException(new Error("Test error with DSN unset"));
  } finally {
    if (originalDsn) {
      Deno.env.set("SENTRY_DSN", originalDsn);
    } else {
      Deno.env.delete("SENTRY_DSN");
    }
    resetEdgeReportingForTesting();
  }
});

Deno.test("errorReporting shared helper: scrubEdgeEvent enforces strict privacy invariants", () => {
  const rawEvent = {
    request: {
      data: { prompt: "3 scrambled eggs with avocado" },
      cookies: "session=secret-session-token",
      headers: {
        authorization: "Bearer secret-jwt",
        cookie: "auth-cookie=xyz",
        "content-type": "application/json",
      },
    },
    user: {
      id: "usr-456",
      email: "athlete@yourbody.fyi",
    },
    extra: {
      endpoint: "parse-nutrition",
      mealText: "chicken salad",
      nutritionEstimate: { calories: 350, protein: 30 },
      requestTimeMs: 120,
    },
  };

  const scrubbed = scrubEdgeEvent(rawEvent);

  // Request body and cookies must be deleted
  assertEquals(scrubbed.request.data, undefined);
  assertEquals(scrubbed.request.cookies, undefined);
  assertEquals(scrubbed.request.headers.cookie, undefined);
  assertEquals(scrubbed.request.headers.authorization, undefined);
  assertEquals(scrubbed.request.headers["content-type"], "application/json");

  // User identifiers must be deleted
  assertEquals(scrubbed.user, undefined);

  // Meal and nutrition fields in extra must be removed
  assertEquals(scrubbed.extra.endpoint, "parse-nutrition");
  assertEquals(scrubbed.extra.requestTimeMs, 120);
  assertEquals(scrubbed.extra.mealText, undefined);
  assertEquals(scrubbed.extra.nutritionEstimate, undefined);
});

Deno.test("parse-nutrition: still returns 500 error shape when Sentry capture throws or fails", async () => {
  Deno.env.set("SUPABASE_URL", "https://mock.supabase.co");
  Deno.env.set("SUPABASE_ANON_KEY", "mock-anon-key");
  Deno.env.set("GEMINI_API_KEY", "mock-gemini-key");

  const originalFetch = globalThis.fetch;

  // Mock fetch to simulate valid auth user, then simulate a fatal crash in downstream processing
  globalThis.fetch = async (input: string | Request | URL): Promise<Response> => {
    const urlString = input.toString();
    if (urlString.includes("/auth/v1/user")) {
      return new Response(
        JSON.stringify({ id: "user-123", email: "test@example.com" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
    // Simulate network error for any external call (like Gemini)
    throw new Error("Simulated catastrophic downstream failure");
  };

  try {
    const req = new Request("http://localhost/parse-nutrition", {
      method: "POST",
      headers: {
        Authorization: "Bearer valid-mock-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input: "chicken rice" }),
    });

    const res = await app.fetch(req);
    assertEquals(res.status, 500);

    const body = await res.json();
    assertExists(body.error);
    assertEquals(
      body.error,
      "Failed to parse meal nutrition. Please check your connection or use manual entry."
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("errorReporting shared helper: captureMessage safe no-op when SENTRY_DSN is unset", async () => {
  const originalDsn = Deno.env.get("SENTRY_DSN");
  try {
    Deno.env.delete("SENTRY_DSN");
    resetEdgeReportingForTesting();

    assertEquals(isEdgeReportingConfigured(), false);
    // Calling captureMessage must resolve without error and without initializing Sentry
    await captureMessage("parse-nutrition AI timeout", { tags: { kind: "text" } });
  } finally {
    if (originalDsn) {
      Deno.env.set("SENTRY_DSN", originalDsn);
    } else {
      Deno.env.delete("SENTRY_DSN");
    }
    resetEdgeReportingForTesting();
  }
});

Deno.test("errorReporting shared helper: setTestCaptureHook intercepts messages and exceptions", async () => {
  const captured: Array<{ type: string; arg: unknown; context?: Record<string, unknown> }> = [];
  setTestCaptureHook((type, arg, context) => {
    captured.push({ type, arg, context });
  });

  try {
    await captureMessage("test message", { tags: { test: "val" } });
    await captureException(new Error("test error"), { tags: { err: "yes" } });

    assertEquals(captured.length, 2);
    assertEquals(captured[0].type, "message");
    assertEquals(captured[0].arg, "test message");
    assertEquals(captured[0].context?.tags, { test: "val" });

    assertEquals(captured[1].type, "exception");
    assertEquals((captured[1].arg as Error).message, "test error");
    assertEquals(captured[1].context?.tags, { err: "yes" });
  } finally {
    resetEdgeReportingForTesting();
  }
});

Deno.test("errorReporting shared helper: scrubEdgeEvent strips synthetic exception, sets logentry, and preserves fingerprint", () => {
  const rawMessageEvent = {
    message: "parse-nutrition AI timeout",
    fingerprint: ["parse-nutrition", "timeout"],
    tags: {
      model_id: "gemini-3.5-flash-lite",
      attempt_count: "2",
      elapsed_ms: "1420",
      kind: "text",
    },
    exception: {
      values: [
        {
          value: "parse-nutrition AI timeout",
          stacktrace: {
            frames: [
              { filename: "errorReporting.ts", function: "captureMessage", lineno: 142 },
            ],
          },
          mechanism: {
            type: "generic",
            handled: true,
            synthetic: true,
          },
        },
      ],
    },
    user: { id: "usr-sensitive-123" },
    extra: {
      meal: "secret protein shake",
      endpoint: "parse-nutrition",
    },
  };

  const scrubbed = scrubEdgeEvent(rawMessageEvent);

  // Synthetic exception must be stripped so Sentry does not title the issue "captureMessage"
  assertEquals(scrubbed.exception, undefined);

  // Message and logentry must be present for event title extraction
  assertEquals(scrubbed.message, "parse-nutrition AI timeout");
  assertExists(scrubbed.logentry);
  assertEquals(scrubbed.logentry.message, "parse-nutrition AI timeout");
  assertEquals(scrubbed.logentry.formatted, "parse-nutrition AI timeout");

  // Fingerprint and tags must be preserved exactly
  assertEquals(scrubbed.fingerprint, ["parse-nutrition", "timeout"]);
  assertEquals(scrubbed.tags, {
    model_id: "gemini-3.5-flash-lite",
    attempt_count: "2",
    elapsed_ms: "1420",
    kind: "text",
  });

  // User and meal details must be scrubbed
  assertEquals(scrubbed.user, undefined);
  assertEquals(scrubbed.extra.meal, undefined);
  assertEquals(scrubbed.extra.endpoint, "parse-nutrition");
});

Deno.test("errorReporting shared helper: scrubEdgeEvent preserves real exceptions with stacktrace", () => {
  const rawExceptionEvent = {
    exception: {
      values: [
        {
          type: "TypeError",
          value: "Cannot read properties of undefined",
          stacktrace: {
            frames: [
              { filename: "index.ts", function: "fetch", lineno: 50 },
            ],
          },
          mechanism: {
            type: "generic",
            handled: true,
          },
        },
      ],
    },
  };

  const scrubbed = scrubEdgeEvent(rawExceptionEvent);

  // Real exception must NOT be stripped
  assertExists(scrubbed.exception);
  assertEquals(scrubbed.exception.values[0].type, "TypeError");
  assertEquals(scrubbed.exception.values[0].value, "Cannot read properties of undefined");
  assertExists(scrubbed.exception.values[0].stacktrace);
});


