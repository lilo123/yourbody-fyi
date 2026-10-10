import { assertEquals, assertExists } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  captureException,
  isEdgeReportingConfigured,
  resetEdgeReportingForTesting,
  scrubEdgeEvent,
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
