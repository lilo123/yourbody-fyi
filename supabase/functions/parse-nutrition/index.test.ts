import { assertEquals, assertExists } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import app, { reconcileParentWithItems } from "./index.ts";

Deno.env.set("SUPABASE_URL", "https://mock.supabase.co");
Deno.env.set("SUPABASE_ANON_KEY", "mock-anon-key");

Deno.test("parse-nutrition should return 401 when Authorization header is missing or not Bearer", async () => {
    const reqMissing = new Request("http://localhost/parse-nutrition", {
        method: "POST",
        body: JSON.stringify({ input: "Had 3 eggs" })
    });

    const resMissing = await app.fetch(reqMissing);
    assertEquals(resMissing.status, 401);
    const dataMissing = await resMissing.json();
    assertEquals(dataMissing.error, "Missing or invalid Authorization header. Authentication required.");

    const reqInvalid = new Request("http://localhost/parse-nutrition", {
        method: "POST",
        headers: { "Authorization": "Basic 12345" },
        body: JSON.stringify({ input: "Had 3 eggs" })
    });

    const resInvalid = await app.fetch(reqInvalid);
    assertEquals(resInvalid.status, 401);
    const dataInvalid = await resInvalid.json();
    assertEquals(dataInvalid.error, "Missing or invalid Authorization header. Authentication required.");
});

Deno.test("parse-nutrition should return 401 when token is invalid or rejected by Supabase Auth", async () => {
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
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer counterfeit-invalid-token" },
            body: JSON.stringify({ input: "3 eggs" })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 401);
        const data = await res.json();
        assertEquals(data.error, "Unauthorized: Invalid token");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

Deno.test("parse-nutrition should return 400 when input text and image are both empty", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: string | Request | URL): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch(input);
    };

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: "   " })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 400);

        const data = await res.json();
        assertEquals(data.error, "Input text or meal photo is required for nutrition parsing.");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

Deno.test("parse-nutrition succeeds when input text is empty but image is present", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            const mockResponse = {
                candidates: [
                    {
                        content: {
                            parts: [
                                {
                                    text: JSON.stringify({
                                        name: "Avocado Toast",
                                        calories: 320,
                                        protein: 8,
                                        carbs: 35,
                                        fat: 18,
                                        fiber: 7,
                                        explanation: "1 slice avocado toast",
                                        items: [
                                            { name: "Avocado Toast", portion: "1 slice", calories: 320, protein: 8, carbs: 35, fat: 18, fiber: 7 }
                                        ]
                                    })
                                }
                            ]
                        }
                    }
                ]
            };
            return new Response(JSON.stringify(mockResponse), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: "", image_base64: "iVBORw0KGgoAAAANSUhEUgAA" })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 200);

        const data = await res.json();
        assertEquals(data.name, "Avocado Toast");
        assertEquals(data.calories, 320);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) {
            Deno.env.set("GEMINI_API_KEY", originalKey);
        } else {
            Deno.env.delete("GEMINI_API_KEY");
        }
    }
});

Deno.test("parse-nutrition should return 400 when request body is malformed JSON", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: string | Request | URL): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch(input);
    };

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: "invalid-json{{{"
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 400);

        const data = await res.json();
        assertEquals(data.error, "Malformed JSON or payload too large.");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

Deno.test("parse-nutrition should return valid JSON macro payload when authorized", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            const mockResponse = {
                candidates: [
                    {
                        content: {
                            parts: [
                                {
                                    text: JSON.stringify({
                                        name: "3 Eggs",
                                        calories: 210,
                                        protein: 18,
                                        carbs: 2,
                                        fat: 15,
                                        fiber: 0,
                                        explanation: "3 large eggs (210 kcal, 18g P, 2g C, 15g F)",
                                        items: [
                                            {
                                                name: "Eggs",
                                                portion: "3 large",
                                                calories: 210,
                                                protein: 18,
                                                carbs: 2,
                                                fat: 15,
                                                fiber: 0
                                            }
                                        ]
                                    })
                                }
                            ]
                        }
                    }
                ]
            };
            return new Response(JSON.stringify(mockResponse), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: "Had 3 eggs", custom_dishes: [{ name: "Protein Shake", calories: 300 }] })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 200);

        const data = await res.json();
        assertExists(data.calories);
        assertEquals(data.calories, 210);
        assertEquals(data.protein, 18);
        assertEquals(data.fiber, 0);
        assertExists(data.name);
        assertEquals(data.name, "3 Eggs");
        assertExists(data.items);
        assertEquals(data.items.length, 1);
        assertEquals(data.items[0].name, "Eggs");
        assertExists(data.explanation);

    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) {
            Deno.env.set("GEMINI_API_KEY", originalKey);
        } else {
            Deno.env.delete("GEMINI_API_KEY");
        }
    }
});

Deno.test("parse-nutrition should strip markdown code fences from Gemini response", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            const rawPayload = {
                name: "Oatmeal Bowl",
                calories: 350,
                protein: 12,
                carbs: 60,
                fat: 6,
                fiber: 8,
                explanation: "Oats with berries",
                items: [
                    { name: "Oats", portion: "1 cup", calories: 300, protein: 10, carbs: 54, fat: 5, fiber: 7 },
                    { name: "Berries", portion: "0.5 cup", calories: 50, protein: 2, carbs: 6, fat: 1, fiber: 1 }
                ]
            };
            const mockResponse = {
                candidates: [
                    {
                        content: {
                            parts: [
                                {
                                    text: "```json\n" + JSON.stringify(rawPayload) + "\n```"
                                }
                            ]
                        }
                    }
                ]
            };
            return new Response(JSON.stringify(mockResponse), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: "1 cup oatmeal and berries" })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 200);

        const data = await res.json();
        assertEquals(data.name, "Oatmeal Bowl");
        assertEquals(data.calories, 350);
        assertEquals(data.fiber, 8);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) {
            Deno.env.set("GEMINI_API_KEY", originalKey);
        } else {
            Deno.env.delete("GEMINI_API_KEY");
        }
    }
});

Deno.test("parse-nutrition should return 429 with RATE_LIMITED code when Gemini API encounters rate limit", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            return new Response(JSON.stringify({ error: { code: 429, message: "Resource has been exhausted (rate limit 429)" } }), {
                status: 429,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: "Had 3 eggs" })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 429);

        const data = await res.json();
        assertEquals(data.code, "RATE_LIMITED");
        assertEquals(data.retryAfter, 15);
        assertExists(data.error);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) {
            Deno.env.set("GEMINI_API_KEY", originalKey);
        } else {
            Deno.env.delete("GEMINI_API_KEY");
        }
    }
});

Deno.test("parse-nutrition should structure multimodal payload with inlineData and route to gemini-3.5-flash-lite", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    let interceptedUrl = "";
    let interceptedBody: any = null;

    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            interceptedUrl = urlString;
            if (init?.body) {
                interceptedBody = JSON.parse(init.body as string);
            }
            const mockResponse = {
                candidates: [
                    {
                        content: {
                            parts: [
                                {
                                    text: JSON.stringify({
                                        name: "Grilled Salmon Bowl",
                                        calories: 520,
                                        protein: 42,
                                        carbs: 45,
                                        fat: 18,
                                        fiber: 5,
                                        explanation: "Fresh salmon with brown rice and broccoli",
                                        items: [
                                            { name: "Salmon", portion: "1 fillet", calories: 280, protein: 34, carbs: 0, fat: 15, fiber: 0 },
                                            { name: "Brown Rice", portion: "1 cup", calories: 200, protein: 5, carbs: 40, fat: 2, fiber: 3 },
                                            { name: "Broccoli", portion: "1 cup", calories: 40, protein: 3, carbs: 5, fat: 1, fiber: 2 }
                                        ]
                                    })
                                }
                            ]
                        }
                    }
                ]
            };
            return new Response(JSON.stringify(mockResponse), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const testBase64 = "data:image/jpeg;base64,dGVzdC1pbWFnZS1kYXRh";
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({
                input: "Salmon bowl for lunch",
                image_base64: testBase64,
                imageMimeType: "image/jpeg"
            })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 200);

        const data = await res.json();
        assertEquals(data.name, "Grilled Salmon Bowl");
        assertEquals(data.calories, 520);
        assertEquals(data.protein, 42);

        // Verify that gemini-3.5-flash-lite was called as the primary vision model
        assertEquals(interceptedUrl.includes("gemini-3.5-flash-lite"), true);

        // Verify that inlineData was properly constructed in the Gemini contents parts
        assertExists(interceptedBody);
        assertExists(interceptedBody.contents);
        const parts = interceptedBody.contents[0].parts;
        assertExists(parts);
        const inlinePart = parts.find((p: any) => p.inlineData);
        assertExists(inlinePart);
        assertEquals(inlinePart.inlineData.mimeType, "image/jpeg");
        assertEquals(inlinePart.inlineData.data, "dGVzdC1pbWFnZS1kYXRh");
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) {
            Deno.env.set("GEMINI_API_KEY", originalKey);
        } else {
            Deno.env.delete("GEMINI_API_KEY");
        }
    }
});

Deno.test("parse-nutrition should return 500 rather than mock 200 data during service outages", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            return new Response(JSON.stringify({ error: { code: 503, message: "Service Unavailable" } }), {
                status: 503,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: "Had 2 scoops of whey protein" })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 500);

        const data = await res.json();
        assertEquals(data.error, "Failed to parse meal nutrition. Please check your connection or use manual entry.");
        assertEquals(data.calories, undefined);
        assertEquals(data.name, undefined);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) {
            Deno.env.set("GEMINI_API_KEY", originalKey);
        } else {
            Deno.env.delete("GEMINI_API_KEY");
        }
    }
});

Deno.test("parse-nutrition handles conversational multi-dish meal input (Chicken Rice & Eggs) and elaborates dishes into components", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            const mockResponse = {
                candidates: [
                    {
                        content: {
                            parts: [
                                {
                                    text: JSON.stringify({
                                        name: "Chicken Rice & Eggs",
                                        calories: 650,
                                        protein: 38,
                                        carbs: 70,
                                        fat: 23,
                                        fiber: 1,
                                        explanation: "300 kcal (Steamed Rice Bowl) + 260 kcal (Grilled Chicken Breast) + 90 kcal (Fried Egg) = 650 kcal",
                                        items: [
                                            { name: "Steamed Rice Bowl", portion: "1.5 cups (240g)", calories: 300, protein: 6, carbs: 65, fat: 1, fiber: 1 },
                                            { name: "Grilled Chicken Breast", portion: "1 chop (120g)", calories: 260, protein: 26, carbs: 4, fat: 15, fiber: 0 },
                                            { name: "Fried Egg", portion: "1 large", calories: 90, protein: 6, carbs: 1, fat: 7, fiber: 0 }
                                        ]
                                    })
                                }
                            ]
                        }
                    }
                ]
            };
            return new Response(JSON.stringify(mockResponse), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: "I ate Chicken Rice & Eggs" })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 200);

        const data = await res.json();
        assertEquals(data.name, "Chicken Rice & Eggs");
        assertEquals(data.calories, 650);
        assertEquals(data.items.length, 3);
        assertEquals(data.items[0].name, "Steamed Rice Bowl");
        assertEquals(data.items[1].name, "Grilled Chicken Breast");
        assertEquals(data.items[2].name, "Fried Egg");
        assertEquals(data.items[1].protein, 26);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) {
            Deno.env.set("GEMINI_API_KEY", originalKey);
        } else {
            Deno.env.delete("GEMINI_API_KEY");
        }
    }
});

Deno.test("parse-nutrition accurately preserves pre-analyzed structured breakdown text verbatim", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    const structuredInput = `Food Item: High-Protein Breakfast Plate & Chia Pudding Bowl (Friday Menu Grounded)
Total Portion Size: 510 g

Component Breakdown:
* Scrambled Egg White (with hot sauce & black pepper): 150 g | 87 kcal | 14 g P | 1 g C | 3 g F | 0 g Fiber
* Sliced Turkey Breast: 60 g | 80 kcal | 10 g P | 1 g C | 4 g F | 0 g Fiber
* Smoked Salmon: 50 g | 68 kcal | 8 g P | 0 g C | 4 g F | 0 g Fiber
* Chocolate Coconut Chia Pudding: 150 g | 227 kcal | 5 g P | 18 g C | 15 g F | 8 g Fiber
* 2% Plain Greek Yogurt: 100 g | 88 kcal | 9 g P | 4 g C | 4 g F | 0 g Fiber

Total Calories: 550 kcal
Total Protein: 46 g
Total Carbs: 24 g
Total Fat: 30 g
Total Fiber: 8 g`;

    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            const mockResponse = {
                candidates: [
                    {
                        content: {
                            parts: [
                                {
                                    text: JSON.stringify({
                                        name: "High-Protein Breakfast Plate & Chia Pudding Bowl (Friday Menu Grounded)",
                                        calories: 550,
                                        protein: 46,
                                        carbs: 24,
                                        fat: 30,
                                        fiber: 8,
                                        explanation: "87 kcal (Egg White) + 80 kcal (Turkey) + 68 kcal (Salmon) + 227 kcal (Chia) + 88 kcal (Yogurt) = 550 kcal",
                                        items: [
                                            { name: "Scrambled Egg White (with hot sauce & black pepper)", portion: "150 g", calories: 87, protein: 14, carbs: 1, fat: 3, fiber: 0 },
                                            { name: "Sliced Turkey Breast", portion: "60 g", calories: 80, protein: 10, carbs: 1, fat: 4, fiber: 0 },
                                            { name: "Smoked Salmon", portion: "50 g", calories: 68, protein: 8, carbs: 0, fat: 4, fiber: 0 },
                                            { name: "Chocolate Coconut Chia Pudding", portion: "150 g", calories: 227, protein: 5, carbs: 18, fat: 15, fiber: 8 },
                                            { name: "2% Plain Greek Yogurt", portion: "100 g", calories: 88, protein: 9, carbs: 4, fat: 4, fiber: 0 }
                                        ]
                                    })
                                }
                            ]
                        }
                    }
                ]
            };
            return new Response(JSON.stringify(mockResponse), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: structuredInput })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 200);

        const data = await res.json();
        assertEquals(data.name, "High-Protein Breakfast Plate & Chia Pudding Bowl (Friday Menu Grounded)");
        assertEquals(data.calories, 550);
        assertEquals(data.protein, 46);
        assertEquals(data.carbs, 24);
        assertEquals(data.fat, 30);
        assertEquals(data.fiber, 8);
        assertEquals(data.items.length, 5);
        assertEquals(data.items[0].calories, 87);
        assertEquals(data.items[3].name, "Chocolate Coconut Chia Pudding");
        assertEquals(data.items[3].fiber, 8);
        assertEquals(data.items[4].name, "2% Plain Greek Yogurt");
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) {
            Deno.env.set("GEMINI_API_KEY", originalKey);
        } else {
            Deno.env.delete("GEMINI_API_KEY");
        }
    }
});

Deno.test("parse-nutrition seamlessly falls back to secondary model when primary model encounters 503 or 404", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    const originalFetch = globalThis.fetch;
    let callCount = 0;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            callCount += 1;
            if (urlString.includes("gemini-3.5-flash-lite")) {
                // First candidate model fails with 503
                return new Response(JSON.stringify({ error: { code: 503, message: "Model is currently experiencing high demand" } }), {
                    status: 503,
                    headers: { "Content-Type": "application/json" }
                });
            }
            // Fallback candidate model (gemini-3.5-flash) succeeds
            const mockResponse = {
                candidates: [
                    {
                        content: {
                            parts: [
                                {
                                    text: JSON.stringify({
                                        name: "Chicken Rice & Eggs",
                                        calories: 650,
                                        protein: 38,
                                        carbs: 70,
                                        fat: 23,
                                        fiber: 1,
                                        explanation: "Steamed rice, chicken breast, and egg",
                                        items: [
                                            { name: "Steamed Rice Bowl", portion: "1.5 cups (240g)", calories: 300, protein: 6, carbs: 65, fat: 1, fiber: 1 },
                                            { name: "Grilled Chicken Breast", portion: "1 chop (120g)", calories: 260, protein: 26, carbs: 4, fat: 15, fiber: 0 },
                                            { name: "Fried Egg", portion: "1 large", calories: 90, protein: 6, carbs: 1, fat: 7, fiber: 0 }
                                        ]
                                    })
                                }
                            ]
                        }
                    }
                ]
            };
            return new Response(JSON.stringify(mockResponse), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: "Chicken Rice & Eggs" })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 200);

        const data = await res.json();
        assertEquals(data.name, "Chicken Rice & Eggs");
        assertEquals(data.calories, 650);
        assertEquals(data.items.length, 3);
        // Verify at least 2 models were attempted
        assertEquals(callCount >= 2, true);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) {
            Deno.env.set("GEMINI_API_KEY", originalKey);
        } else {
            Deno.env.delete("GEMINI_API_KEY");
        }
    }
});

Deno.test("parse-nutrition preserves structured breakdown text with portion size and macros even when all AI models fail", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    const structuredInput = `+++++++++
Food Item: High-Protein Breakfast Plate & Chia Pudding Bowl (Friday Menu Grounded)
Total Portion Size: 510 g

Component Breakdown:
* Scrambled Egg White (with hot sauce & black pepper): 150 g | 87 kcal | 14 g P | 1 g C | 3 g F | 0 g Fiber
* Sliced Turkey Breast: 60 g | 80 kcal | 10 g P | 1 g C | 4 g F | 0 g Fiber
* Smoked Salmon: 50 g | 68 kcal | 8 g P | 0 g C | 4 g F | 0 g Fiber
* Chocolate Coconut Chia Pudding: 150 g | 227 kcal | 5 g P | 18 g C | 15 g F | 8 g Fiber
* 2% Plain Greek Yogurt: 100 g | 88 kcal | 9 g P | 4 g C | 4 g F | 0 g Fiber

Total Calories: 550 kcal
Total Protein: 46 g
Total Carbs: 24 g
Total Fat: 30 g
Total Fiber: 8 g
+++++++++`;

    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            // All AI model attempts fail
            return new Response(JSON.stringify({ error: { code: 503, message: "AI Service Unavailable" } }), {
                status: 503,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: structuredInput })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 200);

        const data = await res.json();
        assertEquals(data.name, "High-Protein Breakfast Plate & Chia Pudding Bowl (Friday Menu Grounded)");
        assertEquals(data.calories, 550);
        assertEquals(data.protein, 46);
        assertEquals(data.carbs, 24);
        assertEquals(data.fat, 30);
        assertEquals(data.fiber, 8);
        assertEquals(data.serving_size, 510);
        assertEquals(data.serving_unit, "g");
        assertEquals(data.items.length, 5);
        assertEquals(data.items[0].name, "Scrambled Egg White (with hot sauce & black pepper)");
        assertEquals(data.items[3].calories, 227);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) {
            Deno.env.set("GEMINI_API_KEY", originalKey);
        } else {
            Deno.env.delete("GEMINI_API_KEY");
        }
    }
});

Deno.test("parse-nutrition detects image/png MIME type automatically from Data URI", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    let interceptedBody: any = null;

    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            if (init?.body) {
                interceptedBody = JSON.parse(init.body as string);
            }
            const mockResponse = {
                candidates: [
                    {
                        content: {
                            parts: [
                                {
                                    text: JSON.stringify({
                                        name: "Fruit Salad",
                                        calories: 150,
                                        protein: 2,
                                        carbs: 38,
                                        fat: 1,
                                        fiber: 5,
                                        explanation: "Mixed berries",
                                        items: [{ name: "Berries", portion: "1 bowl", calories: 150, protein: 2, carbs: 38, fat: 1, fiber: 5 }]
                                    })
                                }
                            ]
                        }
                    }
                ]
            };
            return new Response(JSON.stringify(mockResponse), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({
                image_base64: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA"
            })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 200);

        assertExists(interceptedBody);
        const inlinePart = interceptedBody.contents[0].parts.find((p: any) => p.inlineData);
        assertExists(inlinePart);
        assertEquals(inlinePart.inlineData.mimeType, "image/png");
        assertEquals(inlinePart.inlineData.data, "iVBORw0KGgoAAAANSUhEUgAA");
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) {
            Deno.env.set("GEMINI_API_KEY", originalKey);
        } else {
            Deno.env.delete("GEMINI_API_KEY");
        }
    }
});

Deno.test("parse-nutrition preserves 429 status and Retry-After header even if fallback model returns 503", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            if (urlString.includes("gemini-3.8-flash")) {
                // Primary vision model encounters 429
                return new Response(JSON.stringify({ error: { code: 429, message: "Resource exhausted" } }), {
                    status: 429,
                    headers: { "Content-Type": "application/json" }
                });
            }
            // Fallback model encounters 503
            return new Response(JSON.stringify({ error: { code: 503, message: "Service Unavailable" } }), {
                status: 503,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({
                image_base64: "iVBORw0KGgoAAAANSUhEUgAA"
            })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 429);
        assertEquals(res.headers.get("Retry-After"), "15");

        const data = await res.json();
        assertEquals(data.code, "RATE_LIMITED");
        assertEquals(data.retryAfter, 15);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) {
            Deno.env.set("GEMINI_API_KEY", originalKey);
        } else {
            Deno.env.delete("GEMINI_API_KEY");
        }
    }
});

Deno.test("parse-nutrition accepts camelCase imageBase64 parameter", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    let interceptedBody: any = null;

    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            if (init?.body) {
                interceptedBody = JSON.parse(init.body as string);
            }
            const mockResponse = {
                candidates: [
                    {
                        content: {
                            parts: [
                                {
                                    text: JSON.stringify({
                                        name: "Greek Salad",
                                        calories: 220,
                                        protein: 6,
                                        carbs: 12,
                                        fat: 18,
                                        fiber: 4,
                                        explanation: "Feta, olives, cucumber",
                                        items: [{ name: "Greek Salad", portion: "1 bowl", calories: 220, protein: 6, carbs: 12, fat: 18, fiber: 4 }]
                                    })
                                }
                            ]
                        }
                    }
                ]
            };
            return new Response(JSON.stringify(mockResponse), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({
                imageBase64: "dGVzdC1jYW1lbA=="
            })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 200);

        assertExists(interceptedBody);
        const inlinePart = interceptedBody.contents[0].parts.find((p: any) => p.inlineData);
        assertExists(inlinePart);
        assertEquals(inlinePart.inlineData.data, "dGVzdC1jYW1lbA==");
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) {
            Deno.env.set("GEMINI_API_KEY", originalKey);
        } else {
            Deno.env.delete("GEMINI_API_KEY");
        }
    }
});

Deno.test("parse-nutrition exposes Retry-After in Access-Control-Expose-Headers for CORS clients", async () => {
    const reqOptions = new Request("http://localhost/parse-nutrition", {
        method: "OPTIONS",
    });
    const resOptions = await app.fetch(reqOptions);
    assertEquals(resOptions.status, 200);
    assertEquals(resOptions.headers.get("Access-Control-Expose-Headers"), "Retry-After");
});

Deno.test("parse-nutrition sends the X-Release-Check marker header", async () => {
    const res = await app.fetch(new Request("http://localhost/parse-nutrition", { method: "OPTIONS" }));
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("X-Release-Check"), "1");
});

Deno.test("parse-nutrition falls back to text-only mode when imageBase64 is an empty data URI but input text exists", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    let interceptedBody: any = null;

    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            if (init?.body) {
                interceptedBody = JSON.parse(init.body as string);
            }
            const mockResponse = {
                candidates: [
                    {
                        content: {
                            parts: [
                                {
                                    text: JSON.stringify({
                                        name: "2 Red Apples",
                                        calories: 190,
                                        protein: 1,
                                        carbs: 50,
                                        fat: 0,
                                        fiber: 8,
                                        explanation: "2 medium apples",
                                        items: [{ name: "Red Apple", portion: "2 medium", calories: 190, protein: 1, carbs: 50, fat: 0, fiber: 8 }]
                                    })
                                }
                            ]
                        }
                    }
                ]
            };
            return new Response(JSON.stringify(mockResponse), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({
                input: "Had 2 red apples",
                imageBase64: "data:image/jpeg;base64,"
            })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 200);

        const data = await res.json();
        assertEquals(data.name, "2 Red Apples");
        assertEquals(data.calories, 190);

        // Verify it routed to text-only mode without inlineData part
        assertExists(interceptedBody);
        const parts = interceptedBody.contents[0].parts;
        const inlinePart = parts.find((p: any) => p.inlineData);
        assertEquals(inlinePart, undefined);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) {
            Deno.env.set("GEMINI_API_KEY", originalKey);
        } else {
            Deno.env.delete("GEMINI_API_KEY");
        }
    }
});

Deno.test("parse-nutrition returns 400 when input is empty and imageBase64 is an empty data URI", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: string | Request | URL): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch(input);
    };

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({
                input: "   ",
                imageBase64: "data:image/jpeg;base64,"
            })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 400);

        const data = await res.json();
        assertEquals(data.error, "Input text or meal photo is required for nutrition parsing.");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

Deno.test("parse-nutrition seamlessly falls back to secondary model when primary candidate returns truncated or invalid JSON", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    let callCount = 0;
    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            callCount += 1;
            if (urlString.includes("gemini-3.5-flash-lite")) {
                // Primary model returns truncated/malformed JSON
                return new Response(JSON.stringify({
                    candidates: [
                        {
                            content: {
                                parts: [
                                    { text: "{\"name\": \"Truncated Bowl\", \"calories\": 400, \"items\": [" }
                                ]
                            }
                        }
                    ]
                }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            }
            // Fallback model returns valid complete JSON
            const mockResponse = {
                candidates: [
                    {
                        content: {
                            parts: [
                                {
                                    text: JSON.stringify({
                                        name: "Healthy Bowl",
                                        calories: 420,
                                        protein: 30,
                                        carbs: 45,
                                        fat: 12,
                                        fiber: 6,
                                        explanation: "Balanced meal",
                                        items: [{ name: "Bowl", portion: "1 bowl", calories: 420, protein: 30, carbs: 45, fat: 12, fiber: 6 }]
                                    })
                                }
                            ]
                        }
                    }
                ]
            };
            return new Response(JSON.stringify(mockResponse), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: "Healthy Bowl" })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 200);

        const data = await res.json();
        assertEquals(data.name, "Healthy Bowl");
        assertEquals(data.calories, 420);
        assertEquals(callCount >= 2, true);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) {
            Deno.env.set("GEMINI_API_KEY", originalKey);
        } else {
            Deno.env.delete("GEMINI_API_KEY");
        }
    }
});

Deno.test("parse-nutrition falls back to secondary model when primary candidate returns JSON missing nutrition data", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    let callCount = 0;
    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            callCount += 1;
            if (urlString.includes("gemini-3.5-flash-lite")) {
                // Primary model returns valid JSON but empty object missing calories/items
                return new Response(JSON.stringify({
                    candidates: [
                        {
                            content: {
                                parts: [
                                    { text: JSON.stringify({ name: "Incomplete Object" }) }
                                ]
                            }
                        }
                    ]
                }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            }
            // Fallback model returns valid complete payload
            const mockResponse = {
                candidates: [
                    {
                        content: {
                            parts: [
                                {
                                    text: JSON.stringify({
                                        name: "Complete Salad",
                                        calories: 250,
                                        protein: 10,
                                        carbs: 20,
                                        fat: 14,
                                        fiber: 5,
                                        explanation: "Garden salad with dressing",
                                        items: [{ name: "Salad", portion: "1 bowl", calories: 250, protein: 10, carbs: 20, fat: 14, fiber: 5 }]
                                    })
                                }
                            ]
                        }
                    }
                ]
            };
            return new Response(JSON.stringify(mockResponse), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: "Garden salad" })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 200);

        const data = await res.json();
        assertEquals(data.name, "Complete Salad");
        assertEquals(data.calories, 250);
        assertEquals(callCount >= 2, true);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) {
            Deno.env.set("GEMINI_API_KEY", originalKey);
        } else {
            Deno.env.delete("GEMINI_API_KEY");
        }
    }
});

Deno.test("parse-nutrition handles data URIs with parameters like data:image/png;name=meal.png;base64,...", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    let interceptedBody: any = null;
    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            if (init?.body) {
                interceptedBody = JSON.parse(init.body as string);
            }
            const mockResponse = {
                candidates: [
                    {
                        content: {
                            parts: [
                                {
                                    text: JSON.stringify({
                                        name: "Protein Shake",
                                        calories: 220,
                                        protein: 30,
                                        carbs: 10,
                                        fat: 4,
                                        fiber: 2,
                                        explanation: "Whey protein shake",
                                        items: [{ name: "Shake", portion: "1 scoop", calories: 220, protein: 30, carbs: 10, fat: 4, fiber: 2 }]
                                    })
                                }
                            ]
                        }
                    }
                ]
            };
            return new Response(JSON.stringify(mockResponse), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({
                imageBase64: "data:image/png;name=shake.png;base64,iVBORw0KGgoAAAANSUhEUgAA"
            })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 200);

        assertExists(interceptedBody);
        const parts = interceptedBody.contents[0].parts;
        const inlinePart = parts.find((p: any) => p.inlineData);
        assertExists(inlinePart);
        assertEquals(inlinePart.inlineData.mimeType, "image/png");
        assertEquals(inlinePart.inlineData.data, "iVBORw0KGgoAAAANSUhEUgAA");
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) {
            Deno.env.set("GEMINI_API_KEY", originalKey);
        } else {
            Deno.env.delete("GEMINI_API_KEY");
        }
    }
});

Deno.test("parse-nutrition treats data:, as empty image and returns 400 when input is also empty", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: string | Request | URL): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch(input);
    };

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({
                input: "",
                imageBase64: "data:,"
            })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 400);

        const data = await res.json();
        assertEquals(data.error, "Input text or meal photo is required for nutrition parsing.");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

Deno.test("parse-nutrition pre-structured fast-path returns HTTP 200 without calling Google Gen AI API", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    let googleGenAiCalled = false;
    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            googleGenAiCalled = true;
            throw new Error("Google Gen AI should not be called for structured fast-path!");
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const structuredText = "Food: Grilled Chicken & Rice\n- 200g Chicken Breast | 330 kcal | 62g P | 0g C | 7g F\n- 1 cup White Rice | 205 kcal | 4g P | 45g C | 0.5g F";
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: structuredText })
        });

        const res = await app.fetch(req);

        assertEquals(res.status, 200);
        assertEquals(googleGenAiCalled, false);
        const data = await res.json();
        assertEquals(data.name, "Grilled Chicken & Rice");
        assertEquals(data.calories, 535);
        assertEquals(data.items.length, 2);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
    }
});

Deno.test("parse-nutrition queries primary model first and falls back to gemini-3.1-flash-lite on failure", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    const calledModels: string[] = [];
    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            if (urlString.includes("gemini-3.5-flash-lite")) {
                calledModels.push("gemini-3.5-flash-lite");
                return new Response(JSON.stringify({ error: { code: 503, message: "Server busy" } }), {
                    status: 503,
                    headers: { "Content-Type": "application/json" }
                });
            }
            if (urlString.includes("gemini-3.1-flash-lite")) {
                calledModels.push("gemini-3.1-flash-lite");
                const mockResponse = {
                    candidates: [{
                        content: {
                            parts: [{
                                text: JSON.stringify({
                                    is_food: true,
                                    name: "Protein Shake",
                                    calories: 250,
                                    protein: 30,
                                    carbs: 10,
                                    fat: 3,
                                    fiber: 2,
                                    explanation: "Whey with milk",
                                    items: [{ name: "Protein Shake", portion: "1 shake", calories: 250, protein: 30, carbs: 10, fat: 3, fiber: 2 }]
                                })
                            }]
                        }
                    }]
                };
                return new Response(JSON.stringify(mockResponse), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            }
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: "Had a whey protein shake" })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 200);
        const uniqueModels = Array.from(new Set(calledModels));
        assertEquals(uniqueModels[0], "gemini-3.5-flash-lite");
        assertEquals(uniqueModels[1], "gemini-3.1-flash-lite");
        const data = await res.json();
        assertEquals(data.name, "Protein Shake");
        assertEquals(data.calories, 250);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
    }
});

Deno.test("parse-nutrition aborts primary candidate after timeout signal and invokes gemini-3.1-flash-lite", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    const calledModels: string[] = [];
    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            if (urlString.includes("gemini-3.5-flash-lite")) {
                calledModels.push("gemini-3.5-flash-lite");
                throw new DOMException("The operation was aborted", "AbortError");
            }
            if (urlString.includes("gemini-3.1-flash-lite")) {
                calledModels.push("gemini-3.1-flash-lite");
                const mockResponse = {
                    candidates: [{
                        content: {
                            parts: [{
                                text: JSON.stringify({
                                    is_food: true,
                                    name: "Overnight Oats",
                                    calories: 380,
                                    protein: 15,
                                    carbs: 60,
                                    fat: 8,
                                    fiber: 9,
                                    explanation: "Oats with chia seeds and almond milk",
                                    items: [{ name: "Overnight Oats", portion: "1 bowl", calories: 380, protein: 15, carbs: 60, fat: 8, fiber: 9 }]
                                })
                            }]
                        }
                    }]
                };
                return new Response(JSON.stringify(mockResponse), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            }
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: "Overnight oats with chia seeds" })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 200);
        assertEquals(calledModels.includes("gemini-3.5-flash-lite"), true);
        assertEquals(calledModels.includes("gemini-3.1-flash-lite"), true);
        const data = await res.json();
        assertEquals(data.name, "Overnight Oats");
        assertEquals(data.calories, 380);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
    }
});

Deno.test("parse-nutrition returns HTTP 503 with Retry-After 5 when models encounter capacity exhaustion", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            return new Response(JSON.stringify({
                error: {
                    code: 503,
                    message: "The model is overloaded due to high demand (DECODE_PREEMPTED)"
                }
            }), {
                status: 503,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: "Ribeye steak with garlic butter" })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 503);
        assertEquals(res.headers.get("Retry-After"), "5");
        const data = await res.json();
        assertEquals(data.code, "CAPACITY_EXHAUSTED");
        assertEquals(data.retryAfter, 5);
        assertEquals(data.error.includes("capacity"), true);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
    }
});

Deno.test("parse-nutrition returns HTTP 422 with NON_FOOD_DETECTED when input or image is not food", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    let candidateCount = 0;
    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            candidateCount += 1;
            const mockResponse = {
                candidates: [{
                    content: {
                        parts: [{
                            text: JSON.stringify({
                                is_food: false,
                                name: "Mechanical Keyboard",
                                calories: 0,
                                protein: 0,
                                carbs: 0,
                                fat: 0,
                                fiber: 0,
                                explanation: "This image depicts an electronic keyboard, which is not food.",
                                items: []
                            })
                        }]
                    }
                }]
            };
            return new Response(JSON.stringify(mockResponse), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: "A picture of my computer desk and keyboard" })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 422);
        // Ensure non-food immediately returned without running fallback models
        assertEquals(candidateCount, 1);
        const data = await res.json();
        assertEquals(data.code, "NON_FOOD_DETECTED");
        assertEquals(data.error.includes("No food detected"), true);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
    }
});

Deno.test("parse-nutrition performs universal multi-dish decomposition without regional culinary bias", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    let interceptedSystemInstruction = "";
    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            if (init?.body) {
                const parsedBody = JSON.parse(init.body as string);
                if (parsedBody.systemInstruction?.parts?.[0]?.text) {
                    interceptedSystemInstruction = parsedBody.systemInstruction.parts[0].text;
                }
            }
            const mockResponse = {
                candidates: [{
                    content: {
                        parts: [{
                            text: JSON.stringify({
                                is_food: true,
                                name: "Mediterranean Mezze Platter",
                                calories: 680,
                                protein: 28,
                                carbs: 74,
                                fat: 32,
                                fiber: 14,
                                explanation: "Hummus, falafel, tabbouleh, and pita bread",
                                items: [
                                    { name: "Hummus", portion: "0.5 cup", calories: 210, protein: 6, carbs: 18, fat: 14, fiber: 6 },
                                    { name: "Falafel", portion: "4 pieces", calories: 230, protein: 9, carbs: 24, fat: 12, fiber: 5 },
                                    { name: "Tabbouleh", portion: "0.5 cup", calories: 110, protein: 3, carbs: 12, fat: 6, fiber: 2 },
                                    { name: "Pita Bread", portion: "1 round", calories: 130, protein: 10, carbs: 20, fat: 0, fiber: 1 }
                                ]
                            })
                        }]
                    }
                }]
            };
            return new Response(JSON.stringify(mockResponse), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: "Mediterranean mezze platter with hummus, falafel, tabbouleh, and pita" })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 200);

        // Verify systemInstruction contains universal multi-dish instructions and no regional bias like hardcoded recipes
        assertEquals(interceptedSystemInstruction.toLowerCase().includes("itemization & realistic decomposition"), true);
        assertEquals(interceptedSystemInstruction.toLowerCase().includes("broken rice"), false);
        assertEquals(interceptedSystemInstruction.toLowerCase().includes("pork chop"), false);

        const data = await res.json();
        assertEquals(data.name, "Mediterranean Mezze Platter");
        assertEquals(data.items.length, 4);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
    }
});

Deno.test("parse-nutrition photo-only input with empty text returns HTTP 200 rather than 400", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    let userNotePart = "";
    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            if (init?.body) {
                const parsedBody = JSON.parse(init.body as string);
                const textPart = parsedBody.contents?.[0]?.parts?.find((p: any) => p.text);
                if (textPart) {
                    userNotePart = textPart.text;
                }
            }
            const mockResponse = {
                candidates: [{
                    content: {
                        parts: [{
                            text: JSON.stringify({
                                is_food: true,
                                name: "Grilled Chicken Salad",
                                calories: 420,
                                protein: 45,
                                carbs: 12,
                                fat: 22,
                                fiber: 6,
                                explanation: "Chicken salad recognized visually",
                                items: [{ name: "Chicken Salad", portion: "1 bowl", calories: 420, protein: 45, carbs: 12, fat: 22, fiber: 6 }]
                            })
                        }]
                    }
                }]
            };
            return new Response(JSON.stringify(mockResponse), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({
                input: "", // Empty text description
                imageBase64: "dGVzdC1waG90by1kYXRh",
                imageMimeType: "image/jpeg"
            })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 200);
        const data = await res.json();
        assertEquals(data.name, "Grilled Chicken Salad");
        assertEquals(data.calories, 420);
        assertEquals(userNotePart, "Analyze this meal photo.");
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
    }
});

Deno.test("parse-nutrition bottom fallback salvages structured text when all AI models fail", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            return new Response(JSON.stringify({ error: { code: 500, message: "AI backend fatal error" } }), {
                status: 500,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const structuredText = "Food: Greek Yogurt\n- 200g Greek Yogurt | 120 kcal | 20g P | 6g C | 0g F";
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({
                input: structuredText,
                image_base64: "dGVzdA==" // Multimodal request where top fast-path is bypassed
            })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 200);
        const data = await res.json();
        assertEquals(data.name, "Greek Yogurt");
        assertEquals(data.calories, 120);
        assertEquals(data.protein, 20);
        assertEquals(data.is_food, true);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
    }
});

Deno.test("parse-nutrition vision model failover routes directly from gemini-3.5-flash-lite to gemini-3.1-flash-lite", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    const calledVisionModels: string[] = [];
    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            if (urlString.includes("gemini-3.5-flash-lite")) {
                calledVisionModels.push("gemini-3.5-flash-lite");
                return new Response(JSON.stringify({ error: { code: 503, message: "Service Unavailable" } }), {
                    status: 503,
                    headers: { "Content-Type": "application/json" }
                });
            }
            if (urlString.includes("gemini-3.1-flash-lite")) {
                calledVisionModels.push("gemini-3.1-flash-lite");
                const mockResponse = {
                    candidates: [{
                        content: {
                            parts: [{
                                text: JSON.stringify({
                                    is_food: true,
                                    name: "Protein Shake",
                                    calories: 300,
                                    protein: 40,
                                    carbs: 10,
                                    fat: 5,
                                    fiber: 2,
                                    explanation: "Shake recognized by vision fallback",
                                    items: [{ name: "Protein Shake", portion: "1 bottle", calories: 300, protein: 40, carbs: 10, fat: 5, fiber: 2 }]
                                })
                            }]
                        }
                    }]
                };
                return new Response(JSON.stringify(mockResponse), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            }
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({
                input: "Photo of protein shake",
                image_base64: "dGVzdA=="
            })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 200);
        const uniqueVisionModels = Array.from(new Set(calledVisionModels));
        // Assert primary was gemini-3.5-flash-lite and fallback 1 was gemini-3.1-flash-lite (no gemini-3.7-flash delay)
        assertEquals(uniqueVisionModels[0], "gemini-3.5-flash-lite");
        assertEquals(uniqueVisionModels[1], "gemini-3.1-flash-lite");
        assertEquals(calledVisionModels.includes("gemini-3.7-flash"), false);
        const data = await res.json();
        assertEquals(data.name, "Protein Shake");
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
    }
});

Deno.test("parse-nutrition returns HTTP 422 when model returns is_food as string 'false'", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    let callCount = 0;
    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            callCount += 1;
            const mockResponse = {
                candidates: [{
                    content: {
                        parts: [{
                            text: JSON.stringify({
                                is_food: "false", // String 'false'
                                name: "Headphones",
                                calories: 0,
                                protein: 0,
                                carbs: 0,
                                fat: 0,
                                fiber: 0,
                                explanation: "Electronics",
                                items: []
                            })
                        }]
                    }
                }]
            };
            return new Response(JSON.stringify(mockResponse), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: "A pair of wireless headphones" })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 422);
        assertEquals(callCount, 1);
        const data = await res.json();
        assertEquals(data.code, "NON_FOOD_DETECTED");
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
    }
});





Deno.test("Photo only - Should not inject custom dishes", async () => {
    Deno.env.set("SUPABASE_URL", "https://mock.supabase.co");
    Deno.env.set("SUPABASE_ANON_KEY", "mock-anon-key");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    let systemInstructionUsed = "";

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            if (init?.body) {
                const parsedBody = JSON.parse(init.body as string);
                if (parsedBody.systemInstruction?.parts?.[0]?.text) {
                    systemInstructionUsed = parsedBody.systemInstruction.parts[0].text;
                }
            }
            return new Response(JSON.stringify({
                candidates: [{ content: { parts: [{ text: JSON.stringify({ is_food: true, name: "Food", calories: 100, protein: 10, carbs: 10, fat: 10, fiber: 0, explanation: "exp", items: [] }) }] } }]
            }), { status: 200 });
        }
        return originalFetch(input, init);
    };

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({
                input: "", // Empty input!
                image_base64: "dGVzdC1pbWFnZQ==",
                custom_dishes: [{ name: "My Protein Shake", calories: 300 }]
            })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 200);

        if (systemInstructionUsed.includes("User's Custom Dishes")) {
            throw new Error("Custom dishes were injected even when input was empty!");
        }
        console.log("SUCCESS: Custom dishes NOT injected for photo-only scan.");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

Deno.test("Text provided - Should inject custom dishes", async () => {
    let systemInstructionUsed = "";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) return new Response(JSON.stringify({}), { status: 200 });
        if (urlString.includes("generativelanguage.googleapis.com")) {
            if (init?.body) systemInstructionUsed = JSON.parse(init.body as string).systemInstruction?.parts?.[0]?.text;
            return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ is_food: true, name: "Food", calories: 100, protein: 10, carbs: 10, fat: 10, fiber: 0, explanation: "exp", items: [] }) }] } }] }), { status: 200 });
        }
        return originalFetch(input, init);
    };
    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({
                input: "Protein shake", // Text present!
                image_base64: "dGVzdC1pbWFnZQ==",
                custom_dishes: [{ name: "My Protein Shake", calories: 300 }]
            })
        });
        const res = await app.fetch(req);
        assertEquals(res.status, 200);
        if (!systemInstructionUsed.includes("User's Custom Dishes")) {
            throw new Error("Custom dishes were NOT injected despite text being present!");
        }
        console.log("SUCCESS: Custom dishes WERE injected for text scan.");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

Deno.test("parse-nutrition successfully processes dietary supplements and barcodes as is_food: true", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            const mockResponse = {
                candidates: [
                    {
                        content: {
                            parts: [
                                {
                                    text: JSON.stringify({
                                        is_food: true,
                                        name: "Whey Protein Supplement",
                                        calories: 120,
                                        protein: 24,
                                        carbs: 3,
                                        fat: 1.5,
                                        fiber: 0,
                                        explanation: "Dietary supplement",
                                        items: [
                                            { name: "Whey Protein", portion: "1 scoop", calories: 120, protein: 24, carbs: 3, fat: 1.5, fiber: 0 }
                                        ]
                                    })
                                }
                            ]
                        }
                    }
                ]
            };
            return new Response(JSON.stringify(mockResponse), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: "1 scoop whey protein" })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 200);

        const data = await res.json();
        assertEquals(data.name, "Whey Protein Supplement");
        assertEquals(data.calories, 120);
        assertEquals(data.protein, 24);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) {
            Deno.env.set("GEMINI_API_KEY", originalKey);
        } else {
            Deno.env.delete("GEMINI_API_KEY");
        }
    }
});

// ---------------------------------------------------------------------------
// reconcileParentWithItems — the last point before the client (and then the DB)
// where the parent = Σ(items) invariant can still be established cheaply.
// ---------------------------------------------------------------------------

Deno.test("reconcileParentWithItems overwrites a drifting parent total with the component sum", () => {
    const out = JSON.parse(reconcileParentWithItems(JSON.stringify({
        name: "Breakkie",
        calories: 318, protein: 40, carbs: 7, fat: 7, fiber: 0,
        items: [
            { name: "Egg white", portion: "180 g", quantity: 180, unit: "g", calories: 139, protein: 20, carbs: 1, fat: 5, fiber: 0 },
            { name: "Turkey", portion: "60 g", quantity: 60, unit: "g", calories: 60, protein: 10, carbs: 1, fat: 1, fiber: 0 },
            { name: "Yogurt", portion: "150 g", quantity: 150, unit: "g", calories: 90, protein: 15, carbs: 5, fat: 1, fiber: 0 },
        ],
    })));

    assertEquals(out.calories, 289);
    assertEquals(out.protein, 45);
    assertEquals(out.carbs, 7);
});

Deno.test("reconcileParentWithItems coerces an out-of-vocabulary unit to 'unit'", () => {
    const out = JSON.parse(reconcileParentWithItems(JSON.stringify({
        calories: 0,
        items: [{ name: "Oats", portion: "1 cup", quantity: 1, unit: "cup", calories: 300 }],
    })));

    assertEquals(out.items[0].unit, "unit");
});

Deno.test("reconcileParentWithItems replaces a zero or missing quantity with 1", () => {
    const out = JSON.parse(reconcileParentWithItems(JSON.stringify({
        calories: 0,
        items: [
            { name: "A", quantity: 0, unit: "g", calories: 10 },
            { name: "B", unit: "g", calories: 10 },
        ],
    })));

    // A zero quantity makes the row unscalable in the UI.
    assertEquals(out.items[0].quantity, 1);
    assertEquals(out.items[1].quantity, 1);
});

Deno.test("reconcileParentWithItems clamps a negative component macro to zero", () => {
    const out = JSON.parse(reconcileParentWithItems(JSON.stringify({
        calories: 0,
        items: [{ name: "A", quantity: 1, unit: "g", calories: -50, protein: 5 }],
    })));

    assertEquals(out.items[0].calories, 0);
    assertEquals(out.calories, 0);
    assertEquals(out.protein, 5);
});

Deno.test("reconcileParentWithItems leaves malformed or item-less payloads untouched", () => {
    assertEquals(reconcileParentWithItems("not json"), "not json");
    assertEquals(reconcileParentWithItems('{"calories":100}'), '{"calories":100}');
    assertEquals(reconcileParentWithItems('{"calories":100,"items":[]}'), '{"calories":100,"items":[]}');
});

Deno.test("parse-nutrition CORS: OPTIONS echoes ACAO for allowed origin and returns 403 without ACAO for unowned legacy origin", async () => {
    // Allowed origin echoes ACAO, Vary, and expose/max-age headers
    const reqAllowed = new Request("http://localhost/parse-nutrition", {
        method: "OPTIONS",
        headers: { "Origin": "https://www.yourbody.fyi" },
    });
    const resAllowed = await app.fetch(reqAllowed);
    assertEquals(resAllowed.status, 200);
    assertEquals(resAllowed.headers.get("Access-Control-Allow-Origin"), "https://www.yourbody.fyi");
    assertEquals(resAllowed.headers.get("Vary"), "Origin");
    assertEquals(resAllowed.headers.get("Access-Control-Expose-Headers"), "Retry-After");
    assertEquals(resAllowed.headers.get("Access-Control-Max-Age"), "86400");

    // Disallowed origin returns 403 with no ACAO
    const unownedOrigin = ["https://", "cyber", "gym", ".app"].join("");
    const reqDisallowed = new Request("http://localhost/parse-nutrition", {
        method: "OPTIONS",
        headers: { "Origin": unownedOrigin },
    });
    const resDisallowed = await app.fetch(reqDisallowed);
    assertEquals(resDisallowed.status, 403);
    assertEquals(resDisallowed.headers.get("Access-Control-Allow-Origin"), null);
    const body = await resDisallowed.json();
    assertEquals(body.error, "CORS origin not allowed");
});

