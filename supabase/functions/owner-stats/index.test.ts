import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import app from "./index.ts";

Deno.env.set("SUPABASE_URL", "https://mock.supabase.co");
Deno.env.set("SUPABASE_ANON_KEY", "mock-anon-key");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "mock-service-role-key");

const VALID_OWNER_ID = "11111111-2222-3333-4444-555555555555";
const NON_OWNER_ID = "99999999-8888-7777-6666-555555555555";
const VALID_TOKEN = "Bearer mock-valid-jwt";
const ALLOWED_ORIGIN = "https://yourbody.fyi";

const MOCK_STATS_PAYLOAD = {
  generated_at: "2026-10-11T12:00:00Z",
  tiers: {
    personal: { paying: 10, grandfathered: 2, unpaid: 0, total: 12 },
    coach: { paying: 5, grandfathered: 1, unpaid: 0, total: 6 },
    coach_pro: { paying: 3, grandfathered: 0, unpaid: 0, total: 3 },
    trial: { paying: 0, grandfathered: 0, unpaid: 15, total: 15 },
    free: { paying: 0, grandfathered: 0, unpaid: 40, total: 40 },
  },
  ai_today: {
    total_uses: 42,
    distinct_users: 8,
    by_plan: [
      { plan: "pro", uses: 25 },
      { plan: "trial", uses: 17 },
    ],
  },
};

Deno.test("owner-stats: OPTIONS request returns 200 with CORS headers", async () => {
  const req = new Request("http://localhost/owner-stats", {
    method: "OPTIONS",
    headers: { Origin: ALLOWED_ORIGIN },
  });
  const res = await app.fetch(req);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), ALLOWED_ORIGIN);
});

Deno.test("owner-stats: disallowed or missing origin returns 400", async () => {
  const reqDisallowed = new Request("http://localhost/owner-stats", {
    method: "GET",
    headers: { Origin: "https://malicious.site" },
  });
  const resDisallowed = await app.fetch(reqDisallowed);
  assertEquals(resDisallowed.status, 400);

  const reqMissing = new Request("http://localhost/owner-stats", {
    method: "GET",
  });
  const resMissing = await app.fetch(reqMissing);
  assertEquals(resMissing.status, 400);
});

Deno.test("owner-stats: unsupported method returns 405", async () => {
  const req = new Request("http://localhost/owner-stats", {
    method: "DELETE",
    headers: { Origin: ALLOWED_ORIGIN },
  });
  const res = await app.fetch(req);
  assertEquals(res.status, 405);
  const data = await res.json();
  assertEquals(data.code, "method_not_allowed");
});

Deno.test("owner-stats: missing or invalid Authorization header returns 401", async () => {
  // Missing Authorization header
  const reqMissing = new Request("http://localhost/owner-stats", {
    method: "GET",
    headers: { Origin: ALLOWED_ORIGIN },
  });
  const resMissing = await app.fetch(reqMissing);
  assertEquals(resMissing.status, 401);
  const dataMissing = await resMissing.json();
  assertEquals(dataMissing.code, "unauthorized");

  // Non-Bearer token
  const reqBasic = new Request("http://localhost/owner-stats", {
    method: "GET",
    headers: { Origin: ALLOWED_ORIGIN, Authorization: "Basic credentials" },
  });
  const resBasic = await app.fetch(reqBasic);
  assertEquals(resBasic.status, 401);
  const dataBasic = await resBasic.json();
  assertEquals(dataBasic.code, "unauthorized");
});

Deno.test("owner-stats: invalid auth token returns 401", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL): Promise<Response> => {
    const urlStr = input.toString();
    if (urlStr.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ message: "Invalid JWT" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input);
  };

  try {
    const req = new Request("http://localhost/owner-stats", {
      method: "GET",
      headers: { Origin: ALLOWED_ORIGIN, Authorization: "Bearer bad-token" },
    });
    const res = await app.fetch(req);
    assertEquals(res.status, 401);
    const data = await res.json();
    assertEquals(data.code, "unauthorized");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("owner-stats: secret OWNER_USER_IDS unset or empty returns 403", async () => {
  Deno.env.delete("OWNER_USER_IDS");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL): Promise<Response> => {
    const urlStr = input.toString();
    if (urlStr.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: VALID_OWNER_ID }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input);
  };

  try {
    const req = new Request("http://localhost/owner-stats", {
      method: "GET",
      headers: { Origin: ALLOWED_ORIGIN, Authorization: VALID_TOKEN },
    });
    const res = await app.fetch(req);
    assertEquals(res.status, 403);
    const data = await res.json();
    assertEquals(data.code, "forbidden");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("owner-stats: caller not in OWNER_USER_IDS returns 403", async () => {
  Deno.env.set("OWNER_USER_IDS", VALID_OWNER_ID);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL): Promise<Response> => {
    const urlStr = input.toString();
    if (urlStr.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: NON_OWNER_ID }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input);
  };

  try {
    const req = new Request("http://localhost/owner-stats", {
      method: "GET",
      headers: { Origin: ALLOWED_ORIGIN, Authorization: VALID_TOKEN },
    });
    const res = await app.fetch(req);
    assertEquals(res.status, 403);
    const data = await res.json();
    assertEquals(data.code, "forbidden");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("owner-stats: feature flag owner_dashboard_enabled false or missing returns 403", async () => {
  Deno.env.set("OWNER_USER_IDS", VALID_OWNER_ID);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL): Promise<Response> => {
    const urlStr = input.toString();
    if (urlStr.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: VALID_OWNER_ID }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (urlStr.includes("/rest/v1/app_config")) {
      // Flag absent/false
      return new Response(JSON.stringify(null), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input);
  };

  try {
    const req = new Request("http://localhost/owner-stats", {
      method: "GET",
      headers: { Origin: ALLOWED_ORIGIN, Authorization: VALID_TOKEN },
    });
    const res = await app.fetch(req);
    assertEquals(res.status, 403);
    const data = await res.json();
    assertEquals(data.code, "feature_disabled");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("owner-stats: valid owner and enabled flag returns 200 with expected shape (GET and POST)", async () => {
  Deno.env.set("OWNER_USER_IDS", `other-id, ${VALID_OWNER_ID}, third-id`);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL): Promise<Response> => {
    const urlStr = input.toString();
    if (urlStr.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: VALID_OWNER_ID }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (urlStr.includes("/rest/v1/app_config")) {
      return new Response(JSON.stringify({ value: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (urlStr.includes("/rest/v1/rpc/get_owner_stats")) {
      return new Response(JSON.stringify(MOCK_STATS_PAYLOAD), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input);
  };

  try {
    for (const method of ["GET", "POST"]) {
      const req = new Request("http://localhost/owner-stats", {
        method,
        headers: { Origin: ALLOWED_ORIGIN, Authorization: VALID_TOKEN },
      });
      const res = await app.fetch(req);
      assertEquals(res.status, 200);
      const data = await res.json();
      assertEquals(data.generated_at, "2026-10-11T12:00:00Z");
      assertEquals(data.tiers.personal.paying, 10);
      assertEquals(data.tiers.coach.paying, 5);
      assertEquals(data.tiers.coach_pro.paying, 3);
      assertEquals(data.tiers.trial.total, 15);
      assertEquals(data.tiers.free.total, 40);
      assertEquals(data.ai_today.total_uses, 42);
      assertEquals(data.ai_today.distinct_users, 8);
      assertEquals(data.ai_today.by_plan.length, 2);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("owner-stats: 200 response contains zero PII (no @ and no UUID pattern)", async () => {
  Deno.env.set("OWNER_USER_IDS", VALID_OWNER_ID);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL): Promise<Response> => {
    const urlStr = input.toString();
    if (urlStr.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: VALID_OWNER_ID }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (urlStr.includes("/rest/v1/app_config")) {
      return new Response(JSON.stringify({ value: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (urlStr.includes("/rest/v1/rpc/get_owner_stats")) {
      return new Response(JSON.stringify(MOCK_STATS_PAYLOAD), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input);
  };

  try {
    const req = new Request("http://localhost/owner-stats", {
      method: "GET",
      headers: { Origin: ALLOWED_ORIGIN, Authorization: VALID_TOKEN },
    });
    const res = await app.fetch(req);
    assertEquals(res.status, 200);
    const rawJson = await res.text();

    // Assert zero emails (@)
    assertEquals(rawJson.includes("@"), false);

    // Assert zero UUIDs
    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    assertEquals(uuidRegex.test(rawJson), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
