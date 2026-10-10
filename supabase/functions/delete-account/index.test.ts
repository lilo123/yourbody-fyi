import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import app from "./index.ts";

Deno.env.set("SUPABASE_URL", "https://mock.supabase.co");
Deno.env.set("SUPABASE_ANON_KEY", "mock-anon-key");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "mock-service-role-key");

const VALID_USER_ID = "11111111-2222-3333-4444-555555555555";
const OTHER_USER_ID = "99999999-8888-7777-6666-555555555555";
const VALID_TOKEN = "Bearer mock-valid-jwt";

Deno.test("delete-account: OPTIONS request returns 200 with CORS headers", async () => {
  const req = new Request("http://localhost/delete-account", {
    method: "OPTIONS",
    headers: { Origin: "https://yourbody.fyi" },
  });
  const res = await app.fetch(req);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "https://yourbody.fyi");
});

Deno.test("delete-account: GET request returns 405 Method Not Allowed", async () => {
  const req = new Request("http://localhost/delete-account", {
    method: "GET",
  });
  const res = await app.fetch(req);
  assertEquals(res.status, 405);
  const data = await res.json();
  assertEquals(data.code, "method_not_allowed");
});

Deno.test("delete-account: missing or malformed Authorization header returns 401", async () => {
  // Case 1: Missing header
  const reqMissing = new Request("http://localhost/delete-account", {
    method: "POST",
    body: JSON.stringify({ confirm: "DELETE" }),
  });
  const resMissing = await app.fetch(reqMissing);
  assertEquals(resMissing.status, 401);
  const dataMissing = await resMissing.json();
  assertEquals(dataMissing.code, "unauthorized");

  // Case 2: Non-Bearer token
  const reqBasic = new Request("http://localhost/delete-account", {
    method: "POST",
    headers: { Authorization: "Basic user:pass" },
    body: JSON.stringify({ confirm: "DELETE" }),
  });
  const resBasic = await app.fetch(reqBasic);
  assertEquals(resBasic.status, 401);
  const dataBasic = await resBasic.json();
  assertEquals(dataBasic.code, "unauthorized");
});

Deno.test("delete-account: invalid Supabase auth token returns 401", async () => {
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
    const req = new Request("http://localhost/delete-account", {
      method: "POST",
      headers: { Authorization: "Bearer bad-token" },
      body: JSON.stringify({ confirm: "DELETE" }),
    });
    const res = await app.fetch(req);
    assertEquals(res.status, 401);
    const data = await res.json();
    assertEquals(data.code, "unauthorized");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("delete-account: bad confirmation body returns 400", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL): Promise<Response> => {
    const urlStr = input.toString();
    if (urlStr.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: VALID_USER_ID, email: "user@example.com" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input);
  };

  try {
    // Case 1: Lowercase delete
    const reqLower = new Request("http://localhost/delete-account", {
      method: "POST",
      headers: { Authorization: VALID_TOKEN },
      body: JSON.stringify({ confirm: "delete" }),
    });
    const resLower = await app.fetch(reqLower);
    assertEquals(resLower.status, 400);
    const dataLower = await resLower.json();
    assertEquals(dataLower.code, "confirmation_required");

    // Case 2: Wrong key
    const reqWrong = new Request("http://localhost/delete-account", {
      method: "POST",
      headers: { Authorization: VALID_TOKEN },
      body: JSON.stringify({ action: "DELETE" }),
    });
    const resWrong = await app.fetch(reqWrong);
    assertEquals(resWrong.status, 400);

    // Case 3: Empty body
    const reqEmpty = new Request("http://localhost/delete-account", {
      method: "POST",
      headers: { Authorization: VALID_TOKEN },
      body: "{}",
    });
    const resEmpty = await app.fetch(reqEmpty);
    assertEquals(resEmpty.status, 400);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("delete-account: server-side flag disabled returns 403", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL): Promise<Response> => {
    const urlStr = input.toString();
    if (urlStr.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: VALID_USER_ID }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (urlStr.includes("/rest/v1/app_config")) {
      // Flag value is false
      return new Response(JSON.stringify({ value: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input);
  };

  try {
    const req = new Request("http://localhost/delete-account", {
      method: "POST",
      headers: { Authorization: VALID_TOKEN },
      body: JSON.stringify({ confirm: "DELETE" }),
    });
    const res = await app.fetch(req);
    assertEquals(res.status, 403);
    const data = await res.json();
    assertEquals(data.code, "feature_disabled");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("delete-account: success path calls deleteUser with caller's ID only", async () => {
  Deno.env.delete("STRIPE_SECRET_KEY");
  const recordedAdminCalls: string[] = [];
  const deletedUserIds: string[] = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = input.toString();
    const method = init?.method || "GET";

    if (urlStr.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: VALID_USER_ID, email: "user@example.com" }), {
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

    if (urlStr.includes("/rest/v1/routine_templates")) {
      recordedAdminCalls.push(`${method} routine_templates`);
      return new Response(JSON.stringify([{ id: "tpl-1" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (urlStr.includes("/rest/v1/template_exercises")) {
      recordedAdminCalls.push(`${method} template_exercises`);
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (urlStr.includes("/rest/v1/workouts")) {
      recordedAdminCalls.push(`${method} workouts`);
      return new Response(JSON.stringify([{ id: "wk-1" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (urlStr.includes("/rest/v1/sets")) {
      recordedAdminCalls.push(`${method} sets`);
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (urlStr.includes("/rest/v1/exercises")) {
      recordedAdminCalls.push(`${method} exercises`);
      if (method === "GET") {
        return new Response(JSON.stringify([{ id: "ex-custom-1", name: "Custom Press" }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (urlStr.includes("/auth/v1/admin/users/")) {
      const parts = urlStr.split("/auth/v1/admin/users/");
      const targetId = parts[1]?.split("?")[0];
      deletedUserIds.push(targetId);
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return originalFetch(input, init);
  };

  try {
    const req = new Request("http://localhost/delete-account", {
      method: "POST",
      headers: { Authorization: VALID_TOKEN },
      body: JSON.stringify({ confirm: "DELETE" }),
    });
    const res = await app.fetch(req);
    assertEquals(res.status, 200);
    const data = await res.json();
    assertEquals(data.deleted, true);

    // Verify deleteUser was called ONLY with the authenticated caller's id
    assertEquals(deletedUserIds.length, 1);
    assertEquals(deletedUserIds[0], VALID_USER_ID);

    // Verify RESTRICT cleanup queries were executed
    const hasTemplatesCleanup = recordedAdminCalls.some((c) => c.includes("routine_templates"));
    const hasWorkoutsCleanup = recordedAdminCalls.some((c) => c.includes("workouts"));
    const hasExercisesCleanup = recordedAdminCalls.some((c) => c.includes("exercises"));
    assertEquals(hasTemplatesCleanup, true);
    assertEquals(hasWorkoutsCleanup, true);
    assertEquals(hasExercisesCleanup, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("delete-account: clone-and-repoints custom exercise when referenced by another user", async () => {
  Deno.env.delete("STRIPE_SECRET_KEY");
  const insertedClones: Array<Record<string, any>> = [];
  const repointedTemplates: Array<Record<string, any>> = [];
  const repointedSets: Array<Record<string, any>> = [];
  const deletedExerciseIds: string[] = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = input.toString();
    const method = init?.method || "GET";
    const bodyText = typeof init?.body === "string" ? init.body : "";

    if (urlStr.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: VALID_USER_ID, email: "user_a@example.com" }), {
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

    // Caller has no routine_templates or workouts of their own
    if (urlStr.includes("/rest/v1/routine_templates")) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (urlStr.includes("/rest/v1/workouts")) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Caller owns custom exercise 'ex-custom-a'
    if (urlStr.includes("/rest/v1/exercises")) {
      if (method === "GET") {
        if (urlStr.includes(`user_id=eq.${VALID_USER_ID}`)) {
          return new Response(
            JSON.stringify([
              {
                id: "ex-custom-a",
                name: "Coach Special Press",
                user_id: VALID_USER_ID,
                equipment: "dumbbell",
                body_parts: ["Chest"],
                is_master: false,
                is_archived: false,
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        // Check if other user already has it -> returns null
        return new Response(JSON.stringify(null), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (method === "POST") {
        // Insert clone
        const parsed = JSON.parse(bodyText);
        insertedClones.push(parsed);
        return new Response(JSON.stringify(parsed), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (method === "DELETE") {
        if (urlStr.includes("id=eq.ex-custom-a")) {
          deletedExerciseIds.push("ex-custom-a");
        }
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Another user (OTHER_USER_ID) references 'ex-custom-a' in template_exercises
    if (urlStr.includes("/rest/v1/template_exercises")) {
      if (method === "GET") {
        return new Response(
          JSON.stringify([
            {
              id: "te-other-1",
              routine_templates: { id: "tpl-other-1", user_id: OTHER_USER_ID },
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (method === "PATCH") {
        repointedTemplates.push(JSON.parse(bodyText));
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Another user (OTHER_USER_ID) references 'ex-custom-a' in sets
    if (urlStr.includes("/rest/v1/sets")) {
      if (method === "GET") {
        return new Response(
          JSON.stringify([
            {
              id: "set-other-1",
              workouts: { id: "wk-other-1", user_id: OTHER_USER_ID },
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (method === "PATCH") {
        repointedSets.push(JSON.parse(bodyText));
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    if (urlStr.includes("/auth/v1/admin/users/")) {
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return originalFetch(input, init);
  };

  try {
    const req = new Request("http://localhost/delete-account", {
      method: "POST",
      headers: { Authorization: VALID_TOKEN },
      body: JSON.stringify({ confirm: "DELETE" }),
    });
    const res = await app.fetch(req);
    assertEquals(res.status, 200);

    // 1. Cloned exercise was inserted for OTHER_USER_ID with same name and fields
    assertEquals(insertedClones.length, 1);
    assertEquals(insertedClones[0].user_id, OTHER_USER_ID);
    assertEquals(insertedClones[0].name, "Coach Special Press");
    assertEquals(insertedClones[0].is_master, false);
    const cloneId = insertedClones[0].id;

    // 2. Other user's template_exercises repointed to clone
    assertEquals(repointedTemplates.length, 1);
    assertEquals(repointedTemplates[0].exercise_id, cloneId);

    // 3. Other user's sets repointed to clone
    assertEquals(repointedSets.length, 1);
    assertEquals(repointedSets[0].exercise_id, cloneId);

    // 4. User A's custom exercise was completely deleted
    assertEquals(deletedExerciseIds, ["ex-custom-a"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("delete-account: Stripe cleanup is skipped when STRIPE_SECRET_KEY is absent", async () => {
  Deno.env.delete("STRIPE_SECRET_KEY");
  let stripeFetchCalled = false;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = input.toString();
    if (urlStr.includes("stripe.com")) {
      stripeFetchCalled = true;
    }
    if (urlStr.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: VALID_USER_ID }), {
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
    if (urlStr.includes("/auth/v1/admin/users/")) {
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    // Return empty arrays for cleanup queries
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const req = new Request("http://localhost/delete-account", {
      method: "POST",
      headers: { Authorization: VALID_TOKEN },
      body: JSON.stringify({ confirm: "DELETE" }),
    });
    const res = await app.fetch(req);
    assertEquals(res.status, 200);
    assertEquals(stripeFetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("delete-account: cancels active subscriptions when Stripe is configured", async () => {
  Deno.env.set("STRIPE_SECRET_KEY", "sk_test_mock_stripe_key");
  const stripeCancelledIds: string[] = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = input.toString();
    const method = init?.method || "GET";

    if (urlStr.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: VALID_USER_ID }), {
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
    if (urlStr.includes("/rest/v1/users")) {
      return new Response(JSON.stringify({ billing_customer_id: "cus_mock_123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (urlStr.includes("api.stripe.com/v1/subscriptions")) {
      if (method === "GET") {
        return new Response(
          JSON.stringify({
            data: [
              { id: "sub_active_1", status: "active" },
              { id: "sub_canceled_2", status: "canceled" },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (method === "DELETE") {
        const subId = urlStr.split("/subscriptions/")[1];
        stripeCancelledIds.push(subId);
        return new Response(JSON.stringify({ id: subId, status: "canceled" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    if (urlStr.includes("/auth/v1/admin/users/")) {
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const req = new Request("http://localhost/delete-account", {
      method: "POST",
      headers: { Authorization: VALID_TOKEN },
      body: JSON.stringify({ confirm: "DELETE" }),
    });
    const res = await app.fetch(req);
    assertEquals(res.status, 200);
    // Active subscription must be cancelled, canceled subscription should not be re-cancelled
    assertEquals(stripeCancelledIds, ["sub_active_1"]);
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("STRIPE_SECRET_KEY");
  }
});

Deno.test("delete-account: refuses live Stripe keys (sk_live_ / rk_live_)", async () => {
  for (const liveKey of ["sk_live_sample123", "rk_live_sample456"]) {
    Deno.env.set("STRIPE_SECRET_KEY", liveKey);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: string | Request | URL): Promise<Response> => {
      const urlStr = input.toString();
      if (urlStr.includes("/auth/v1/user")) {
        return new Response(JSON.stringify({ id: VALID_USER_ID }), {
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
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      const req = new Request("http://localhost/delete-account", {
        method: "POST",
        headers: { Authorization: VALID_TOKEN },
        body: JSON.stringify({ confirm: "DELETE" }),
      });
      const res = await app.fetch(req);
      assertEquals(res.status, 500);
      const data = await res.json();
      assertEquals(data.code, "delete_failed");
    } finally {
      globalThis.fetch = originalFetch;
      Deno.env.delete("STRIPE_SECRET_KEY");
    }
  }
});
