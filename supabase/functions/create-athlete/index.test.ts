import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import app from "./index.ts";

Deno.env.set("SUPABASE_URL", "https://mock.supabase.co");
Deno.env.set("SUPABASE_ANON_KEY", "mock-anon-key");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "mock-service-role-key");

Deno.test("create-athlete should return 401 when Authorization header is missing or not Bearer", async () => {
    const reqMissing = new Request("http://localhost/create-athlete", {
        method: "POST",
        body: JSON.stringify({ name: "Jane Doe", email: "jane@example.com" })
    });

    const resMissing = await app.fetch(reqMissing);
    assertEquals(resMissing.status, 401);
    const dataMissing = await resMissing.json();
    assertEquals(dataMissing.error, "Missing or invalid Authorization header. Authentication required.");

    const reqInvalid = new Request("http://localhost/create-athlete", {
        method: "POST",
        headers: { "Authorization": "Basic 12345" },
        body: JSON.stringify({ name: "Jane Doe", email: "jane@example.com" })
    });

    const resInvalid = await app.fetch(reqInvalid);
    assertEquals(resInvalid.status, 401);
    const dataInvalid = await resInvalid.json();
    assertEquals(dataInvalid.error, "Missing or invalid Authorization header. Authentication required.");
});

Deno.test("create-athlete should return 401 when token is rejected by Supabase Auth", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: string | Request | URL): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ message: "Invalid JWT" }), {
                status: 401,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch(input);
    };

    try {
        const req = new Request("http://localhost/create-athlete", {
            method: "POST",
            headers: { "Authorization": "Bearer bad-jwt-token" },
            body: JSON.stringify({ name: "Jane Doe", email: "jane@example.com" })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 401);
        const data = await res.json();
        assertEquals(data.error, "Unauthorized: Invalid token");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

Deno.test("create-athlete should return 403 when caller is not a coach", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: string | Request | URL): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "athlete-caller-id", email: "athlete@example.com" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("/rest/v1/users")) {
            return new Response(JSON.stringify({ role: "athlete" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch(input);
    };

    try {
        const req = new Request("http://localhost/create-athlete", {
            method: "POST",
            headers: { "Authorization": "Bearer athlete-token" },
            body: JSON.stringify({ name: "Jane Doe", email: "jane@example.com" })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 403);
        const data = await res.json();
        assertEquals(data.error, "Forbidden: Only coaches can provision athletes");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

Deno.test("create-athlete should return 400 when name is missing", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: string | Request | URL): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "coach-caller-id", email: "coach@example.com" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("/rest/v1/users")) {
            return new Response(JSON.stringify({ role: "coach" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch(input);
    };

    try {
        const req = new Request("http://localhost/create-athlete", {
            method: "POST",
            headers: { "Authorization": "Bearer coach-token" },
            body: JSON.stringify({ name: "   ", email: "jane@example.com" })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 400);
        const data = await res.json();
        assertEquals(data.error, "Athlete name is required");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

Deno.test("create-athlete should return 200 when coach successfully provisions an athlete", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: string | Request | URL): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "coach-caller-id", email: "coach@example.com" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("/rest/v1/users")) {
            return new Response(JSON.stringify({ role: "coach" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("/auth/v1/admin/users")) {
            return new Response(
                JSON.stringify({
                    id: "new-athlete-uuid",
                    email: "jane@example.com",
                    user_metadata: { username: "Jane Doe" }
                }),
                {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                }
            );
        }
        return originalFetch(input);
    };

    try {
        const req = new Request("http://localhost/create-athlete", {
            method: "POST",
            headers: { "Authorization": "Bearer coach-token" },
            body: JSON.stringify({ name: "Jane Doe", email: "jane@example.com" })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 200);
        const data = await res.json();
        assertEquals(data.success, true);
        assertEquals(data.athlete.id, "new-athlete-uuid");
        assertEquals(data.athlete.name, "Jane Doe");
        assertEquals(data.athlete.email, "jane@example.com");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

Deno.test("create-athlete should return 400 when user creation fails in auth admin (e.g. duplicate email)", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: string | Request | URL): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "coach-caller-id", email: "coach@example.com" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("/rest/v1/users")) {
            return new Response(JSON.stringify({ role: "coach" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("/auth/v1/admin/users")) {
            return new Response(
                JSON.stringify({
                    message: "A user with this email address has already been registered"
                }),
                {
                    status: 422,
                    headers: { "Content-Type": "application/json" }
                }
            );
        }
        return originalFetch(input);
    };

    try {
        const req = new Request("http://localhost/create-athlete", {
            method: "POST",
            headers: { "Authorization": "Bearer coach-token" },
            body: JSON.stringify({ name: "Jane Doe", email: "jane-duplicate@example.com" })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 400);
        const data = await res.json();
        assertEquals(data.error, "A user with this email address has already been registered");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

Deno.test("create-athlete CORS: OPTIONS echoes ACAO for allowed origin and returns 403 without ACAO for unowned legacy origin", async () => {
    // Allowed origin echoes ACAO and Vary
    const reqAllowed = new Request("http://localhost/create-athlete", {
        method: "OPTIONS",
        headers: { "Origin": "https://www.yourbody.fyi" },
    });
    const resAllowed = await app.fetch(reqAllowed);
    assertEquals(resAllowed.status, 200);
    assertEquals(resAllowed.headers.get("Access-Control-Allow-Origin"), "https://www.yourbody.fyi");
    assertEquals(resAllowed.headers.get("Vary"), "Origin");

    // Disallowed origin returns 403 with no ACAO
    const unownedOrigin = ["https://", "cyber", "gym", ".app"].join("");
    const reqDisallowed = new Request("http://localhost/create-athlete", {
        method: "OPTIONS",
        headers: { "Origin": unownedOrigin },
    });
    const resDisallowed = await app.fetch(reqDisallowed);
    assertEquals(resDisallowed.status, 403);
    assertEquals(resDisallowed.headers.get("Access-Control-Allow-Origin"), null);
    const body = await resDisallowed.json();
    assertEquals(body.error, "CORS origin not allowed");
});


