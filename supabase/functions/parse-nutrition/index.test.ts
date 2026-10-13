import { assertEquals, assertExists } from "jsr:@std/assert@1.0.19";
import app, {
    reconcileParentWithItems,
    MAX_IMAGE_BYTES,
    MAX_FALLBACK_MODELS,
    FIRST_ATTEMPT_BUDGET_TEXT_MS,
    FIRST_ATTEMPT_BUDGET_VISION_MS,
    OVERALL_BUDGET_TEXT_MS,
    OVERALL_BUDGET_VISION_MS,
    setAiBudgetConfigForTesting,
    setTestCaptureHook,
} from "./index.ts";

Deno.env.set("SUPABASE_URL", "https://mock.supabase.co");
Deno.env.set("SUPABASE_ANON_KEY", "mock-anon-key");

const baseFetch = globalThis.fetch;
globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/rest/v1/app_config")) {
        return new Response(JSON.stringify({ value: false }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });
    }
    return baseFetch(input, init);
};

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
    const originalVisionModel = Deno.env.get("GEMINI_VISION_MODEL_ID");
    Deno.env.set("GEMINI_VISION_MODEL_ID", "gemini-3.8-flash");

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
        if (originalVisionModel) {
            Deno.env.set("GEMINI_VISION_MODEL_ID", originalVisionModel);
        } else {
            Deno.env.delete("GEMINI_VISION_MODEL_ID");
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
    let quotaRpcCalled = false;
    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("/rest/v1/rpc/consume_ai_quota")) {
            quotaRpcCalled = true;
            return new Response(JSON.stringify({ allowed: true }), {
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
        assertEquals(quotaRpcCalled, false);
        const data = await res.json();
        assertEquals(data.name, "Grilled Chicken & Rice");
        assertEquals(data.calories, 535);
        assertEquals(data.source, "rules");
        assertEquals(data.confidence, "exact");
        assertEquals(data.items.length, 2);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
    }
});

Deno.test("parse-nutrition: exact text bypasses both Gemini and quota RPC with source 'rules'", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    let googleGenAiCalled = false;
    let quotaRpcCalled = false;
    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("/rest/v1/rpc/consume_ai_quota")) {
            quotaRpcCalled = true;
            return new Response(JSON.stringify({ allowed: true }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            googleGenAiCalled = true;
            throw new Error("Google Gen AI should not be called for exact text!");
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const exactText = "Protein Shake\n250 kcal | 30g protein | 20g carbs | 5g fat";
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: exactText })
        });

        const res = await app.fetch(req);

        assertEquals(res.status, 200);
        assertEquals(googleGenAiCalled, false);
        assertEquals(quotaRpcCalled, false);
        const data = await res.json();
        assertEquals(data.source, "rules");
        assertEquals(data.confidence, "exact");
        assertEquals(data.name, "Protein Shake");
        assertEquals(data.calories, 250);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
    }
});

Deno.test("parse-nutrition: lenient text invokes Gemini and returns source 'ai' on success", async () => {
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
        if (urlString.includes("/rest/v1/app_config")) {
            return new Response(JSON.stringify({ value: false }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            googleGenAiCalled = true;
            const mockResponse = {
                candidates: [{
                    content: {
                        parts: [{
                            text: JSON.stringify({
                                is_food: true,
                                name: "Protein Shake Special",
                                calories: 280,
                                protein: 35,
                                carbs: 15,
                                fat: 4,
                                fiber: 1,
                                explanation: "Protein shake special",
                                items: [{ name: "Protein Shake", portion: "1 serving", quantity: 1, unit: "unit", calories: 280, protein: 35, carbs: 15, fat: 4, fiber: 1 }]
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
        const lenientText = "Protein Shake\nTasted great\nCalories: 300\nProtein: 40g\nCarbs: 10g\nFat: 5g";
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: lenientText })
        });

        const res = await app.fetch(req);

        assertEquals(res.status, 200);
        assertEquals(googleGenAiCalled, true);
        const data = await res.json();
        assertEquals(data.source, "ai");
        assertEquals(data.name, "Protein Shake Special");
        assertEquals(data.calories, 280);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
    }
});

Deno.test("parse-nutrition: lenient text with exceeded quota falls back to 200 with source 'rules' and confidence 'lenient'", async () => {
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
        if (urlString.includes("/rest/v1/app_config")) {
            return new Response(JSON.stringify({ value: true }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("/rest/v1/rpc/consume_ai_quota")) {
            return new Response(JSON.stringify({ allowed: false, limit: 0, used: 0, plan: "free", period: "month" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            googleGenAiCalled = true;
            throw new Error("Google Gen AI should not be called when quota is exceeded!");
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const lenientText = "Protein Shake\nAte half\nCalories: 300 kcal\nProtein: 40g\nCarbs: 10g\nFat: 5g";
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: lenientText })
        });

        const res = await app.fetch(req);

        assertEquals(res.status, 200);
        assertEquals(googleGenAiCalled, false);
        const data = await res.json();
        assertEquals(data.source, "rules");
        assertEquals(data.confidence, "lenient");
        assertEquals(data.fallback_reason, "quota_exceeded");
        assertEquals(data.calories, 300);
        assertEquals(data.protein, 40);
        assertEquals(data.carbs, 10);
        assertEquals(data.fat, 5);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
    }
});

Deno.test("parse-nutrition: partial text with exceeded quota preserves 429 quota_exceeded response unchanged", async () => {
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
        if (urlString.includes("/rest/v1/app_config")) {
            return new Response(JSON.stringify({ value: true }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("/rest/v1/rpc/consume_ai_quota")) {
            return new Response(JSON.stringify({ allowed: false, limit: 0, used: 0, plan: "free", period: "month" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const partialText = "Chicken Breast\nCalories: 165\nProtein: 31g";
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: partialText })
        });

        const res = await app.fetch(req);

        assertEquals(res.status, 429);
        const data = await res.json();
        assertEquals(data.code, "quota_exceeded");
        assertEquals(data.plan, "free");
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
    }
});

Deno.test("parse-nutrition: lenient text falls back to 200 with source 'rules' and fallback_reason 'ai_unavailable' on AI failure", async () => {
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
        if (urlString.includes("/rest/v1/app_config")) {
            return new Response(JSON.stringify({ value: false }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            googleGenAiCalled = true;
            return new Response(JSON.stringify({ error: { message: "Internal error", code: 500 } }), {
                status: 500,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const lenientText = "Protein Shake\nAte half\nCalories: 300 kcal\nProtein: 40g\nCarbs: 10g\nFat: 5g";
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: lenientText })
        });

        const res = await app.fetch(req);

        assertEquals(res.status, 200);
        assertEquals(googleGenAiCalled, true);
        const data = await res.json();
        assertEquals(data.source, "rules");
        assertEquals(data.confidence, "lenient");
        assertEquals(data.fallback_reason, "ai_unavailable");
        assertEquals(data.calories, 300);
        assertEquals(data.protein, 40);
        assertEquals(data.carbs, 10);
        assertEquals(data.fat, 5);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
    }
});

Deno.test("parse-nutrition: forceAi with exact text bypasses rules fast-path and invokes Gemini AI", async () => {
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
        if (urlString.includes("/rest/v1/app_config")) {
            return new Response(JSON.stringify({ value: false }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            googleGenAiCalled = true;
            const mockResponse = {
                candidates: [{
                    content: {
                        parts: [{
                            text: JSON.stringify({
                                is_food: true,
                                name: "Chicken Breast AI Analyzed",
                                calories: 165,
                                protein: 31,
                                carbs: 0,
                                fat: 3.6,
                                fiber: 0,
                                explanation: "Analyzed by AI",
                                items: [{ name: "Chicken Breast", portion: "100g", quantity: 100, unit: "g", calories: 165, protein: 31, carbs: 0, fat: 3.6, fiber: 0 }]
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
        const exactText = "Grilled Chicken Breast\nCalories: 165\nProtein: 31g\nCarbs: 0g\nFat: 3.6g";
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: exactText, forceAi: true })
        });

        const res = await app.fetch(req);

        assertEquals(res.status, 200);
        assertEquals(googleGenAiCalled, true);
        const data = await res.json();
        assertEquals(data.source, "ai");
        assertEquals(data.name, "Chicken Breast AI Analyzed");
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
    }
});

Deno.test("parse-nutrition: bulleted single meal paste no longer returns an item named 'Calories'", async () => {
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
            throw new Error("Google Gen AI should not be called for exact single meal paste!");
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const bulletText = "Protein ice cream\n- Calories: 300 kcal\n- Protein: 40g\n- Carbs: 20g\n- Fat: 5g";
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: bulletText })
        });

        const res = await app.fetch(req);

        assertEquals(res.status, 200);
        assertEquals(googleGenAiCalled, false);
        const data = await res.json();
        assertEquals(data.source, "rules");
        assertEquals(data.confidence, "exact");
        assertEquals(data.name, "Protein ice cream");
        assertEquals(data.calories, 300);
        assertEquals(data.protein, 40);
        assertEquals(data.carbs, 20);
        assertEquals(data.fat, 5);
        assertEquals(data.items.length, 1);
        assertEquals(data.items[0].name, "Protein ice cream");
        assertEquals(data.items.some((item: any) => item.name === "Calories"), false);
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

Deno.test("parse-nutrition should return 413 with image_too_large when image exceeds 1.5 MB cap", async () => {
    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        // 1.5 MB = 1572864 bytes. Create a base64 string whose decoded length is ~1.6 MB (2236964 chars)
        const oversizeBase64 = "A".repeat(2236964);

        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: {
                "Authorization": "Bearer valid-jwt-token",
                "Origin": "https://www.yourbody.fyi",
            },
            body: JSON.stringify({
                image_base64: oversizeBase64,
            }),
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 413);
        assertEquals(res.headers.get("Access-Control-Allow-Origin"), "https://www.yourbody.fyi");
        const data = await res.json();
        assertEquals(data.code, "image_too_large");
        assertEquals(data.maxBytes, MAX_IMAGE_BYTES);
        assertEquals(typeof data.error, "string");
        assertEquals(data.error.includes("1.5 MB"), true);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

Deno.test("parse-nutrition should not reject image when decoded size is just under 1.5 MB cap", async () => {
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
                candidates: [{
                    content: {
                        parts: [{
                            text: JSON.stringify({
                                is_food: true,
                                name: "High Calorie Meal",
                                calories: 800,
                                protein: 50,
                                carbs: 80,
                                fat: 30,
                                fiber: 10,
                                explanation: "Parsed just-under-cap photo",
                                items: [{ name: "High Calorie Meal", portion: "1 plate", calories: 800, protein: 50, carbs: 80, fat: 30, fiber: 10 }]
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
        // Cap is 1572864 bytes. A clean base64 string of length 2097148 with 0 padding decodes to 1572861 bytes (3 bytes under cap)
        const justUnderBase64 = "A".repeat(2097148);

        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({
                image_base64: justUnderBase64,
            }),
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 200);
        const data = await res.json();
        assertEquals(data.name, "High Calorie Meal");
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
    }
});

Deno.test("parse-nutrition fallback chain stops after 2 models total", async () => {
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
            const match = urlString.match(/models\/([^:]+):/);
            if (match) {
                calledModels.push(match[1]);
            }
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
            body: JSON.stringify({ input: "Test meal without fast path structured format" })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 503);
        const uniqueModels = Array.from(new Set(calledModels));
        assertEquals(uniqueModels.length, MAX_FALLBACK_MODELS);
        assertEquals(uniqueModels[0], "gemini-3.5-flash-lite");
        assertEquals(uniqueModels[1], "gemini-3.1-flash-lite");
        assertEquals(calledModels.includes("gemini-3.7-flash"), false);
        assertEquals(calledModels.includes("gemini-3.8-flash"), false);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
    }
});

Deno.test("parse-nutrition AI quota: flag off -> no RPC call", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    let rpcCalled = false;
    let geminiCalled = false;
    const originalFetch = globalThis.fetch;

    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("/rest/v1/app_config")) {
            return new Response(JSON.stringify({ value: false }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("/rest/v1/rpc/consume_ai_quota")) {
            rpcCalled = true;
            return new Response(JSON.stringify({ allowed: true }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            geminiCalled = true;
            const mockResponse = {
                candidates: [{
                    content: {
                        parts: [{
                            text: JSON.stringify({
                                is_food: true,
                                name: "Chicken and Rice",
                                calories: 450,
                                protein: 40,
                                carbs: 50,
                                fat: 8,
                                fiber: 2,
                                explanation: "Chicken and rice",
                                items: [{ name: "Chicken", portion: "150g", quantity: 150, unit: "g", calories: 250, protein: 35, carbs: 0, fat: 5, fiber: 0 }]
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
            body: JSON.stringify({ input: "Had grilled chicken breast with jasmine rice for lunch" })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 200);
        assertEquals(rpcCalled, false);
        assertEquals(geminiCalled, true);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
    }
});

Deno.test("parse-nutrition AI quota: flag on + allowed -> Gemini called", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    let rpcCalled = false;
    let geminiCalled = false;
    let rpcCost = 0;
    const originalFetch = globalThis.fetch;

    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("/rest/v1/app_config")) {
            if (urlString.includes("ai_quota_enabled")) {
                return new Response(JSON.stringify({ value: true }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            }
            if (urlString.includes("ai_quota_limits")) {
                return new Response(JSON.stringify({ value: { photo_cost: 2 } }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            }
        }
        if (urlString.includes("/rest/v1/rpc/consume_ai_quota")) {
            rpcCalled = true;
            if (init?.body) {
                const parsedBody = JSON.parse(init.body.toString());
                rpcCost = parsedBody.p_cost;
            }
            return new Response(JSON.stringify({
                allowed: true,
                plan: "trial",
                limit: 30,
                used: 1,
                cost: 1,
                period: "day",
                resets_at: "2026-10-11T00:00:00Z"
            }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            geminiCalled = true;
            const mockResponse = {
                candidates: [{
                    content: {
                        parts: [{
                            text: JSON.stringify({
                                is_food: true,
                                name: "Eggs and Toast",
                                calories: 350,
                                protein: 18,
                                carbs: 28,
                                fat: 16,
                                fiber: 2,
                                explanation: "Eggs and toast",
                                items: [{ name: "Eggs", portion: "2 large", quantity: 2, unit: "unit", calories: 140, protein: 12, carbs: 1, fat: 10, fiber: 0 }]
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
            body: JSON.stringify({ input: "Had 2 scrambled eggs and whole wheat toast" })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 200);
        assertEquals(rpcCalled, true);
        assertEquals(rpcCost, 1);
        assertEquals(geminiCalled, true);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
    }
});

Deno.test("parse-nutrition AI quota: flag on + denied -> 429 quota_exceeded body without Retry-After", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    let geminiCalled = false;
    const originalFetch = globalThis.fetch;

    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("/rest/v1/app_config")) {
            if (urlString.includes("ai_quota_enabled")) {
                return new Response(JSON.stringify({ value: true }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            }
            if (urlString.includes("ai_quota_limits")) {
                return new Response(JSON.stringify({ value: { photo_cost: 2 } }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            }
        }
        if (urlString.includes("/rest/v1/rpc/consume_ai_quota")) {
            return new Response(JSON.stringify({
                allowed: false,
                plan: "trial",
                limit: 30,
                used: 30,
                cost: 1,
                period: "day",
                resets_at: "2026-10-11T00:00:00Z"
            }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            geminiCalled = true;
            return new Response("{}", { status: 200 });
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: "Had a protein shake after workout" })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 429);
        assertEquals(res.headers.get("Retry-After"), null);
        assertEquals(geminiCalled, false);

        const body = await res.json();
        assertEquals(body.code, "quota_exceeded");
        assertEquals(body.plan, "trial");
        assertEquals(body.limit, 30);
        assertEquals(body.used, 30);
        assertEquals(body.period, "day");
        assertEquals(body.resetsAt, "2026-10-11T00:00:00Z");
        assertEquals(body.error, "You've used today's AI parses. Quick log and on-device parsing still work.");
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
    }
});

Deno.test("parse-nutrition AI quota: photo -> p_cost 2", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    let rpcCost = 0;
    const originalFetch = globalThis.fetch;

    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("/rest/v1/app_config")) {
            if (urlString.includes("ai_quota_enabled")) {
                return new Response(JSON.stringify({ value: true }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            }
            if (urlString.includes("ai_quota_limits")) {
                return new Response(JSON.stringify({ value: { photo_cost: 2 } }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            }
        }
        if (urlString.includes("/rest/v1/rpc/consume_ai_quota")) {
            if (init?.body) {
                const parsedBody = JSON.parse(init.body.toString());
                rpcCost = parsedBody.p_cost;
            }
            return new Response(JSON.stringify({
                allowed: true,
                plan: "trial",
                limit: 30,
                used: 2,
                cost: 2,
                period: "day",
                resets_at: "2026-10-11T00:00:00Z"
            }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            const mockResponse = {
                candidates: [{
                    content: {
                        parts: [{
                            text: JSON.stringify({
                                is_food: true,
                                name: "Caesar Salad",
                                calories: 280,
                                protein: 7,
                                carbs: 12,
                                fat: 22,
                                fiber: 3,
                                explanation: "Caesar salad",
                                items: [{ name: "Caesar Salad", portion: "1 bowl", quantity: 1, unit: "unit", calories: 280, protein: 7, carbs: 12, fat: 22, fiber: 3 }]
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
            body: JSON.stringify({ input: "Caesar salad photo", image_base64: "iVBORw0KGgoAAAANSUhEUgAA" })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 200);
        assertEquals(rpcCost, 2);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
    }
});

Deno.test("parse-nutrition AI quota: rpc error -> proceeds to Gemini (fails open)", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    let geminiCalled = false;
    const originalFetch = globalThis.fetch;

    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("/rest/v1/app_config")) {
            return new Response(JSON.stringify({ value: true }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("/rest/v1/rpc/consume_ai_quota")) {
            return new Response(JSON.stringify({ message: "relation does not exist" }), {
                status: 500,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            geminiCalled = true;
            const mockResponse = {
                candidates: [{
                    content: {
                        parts: [{
                            text: JSON.stringify({
                                is_food: true,
                                name: "Apple",
                                calories: 80,
                                protein: 0.3,
                                carbs: 21,
                                fat: 0.2,
                                fiber: 4,
                                explanation: "1 apple",
                                items: [{ name: "Apple", portion: "1 medium", quantity: 1, unit: "unit", calories: 80, protein: 0.3, carbs: 21, fat: 0.2, fiber: 4 }]
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
            body: JSON.stringify({ input: "A red apple" })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 200);
        assertEquals(geminiCalled, true);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
    }
});

Deno.test("parse-nutrition AI quota: AI failure refunds charged quota (1 for text, 2 for photo)", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    const originalServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    Deno.env.set("GEMINI_API_KEY", "mock-gemini-key");
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "mock-service-role-key");

    const refundCalls: { userId: string; amount: number }[] = [];
    const originalFetch = globalThis.fetch;

    const createMockFetch = (_isPhoto: boolean) => async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "refund-user-123", email: "refund@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("/rest/v1/app_config")) {
            return new Response(JSON.stringify({ value: true }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("/rest/v1/rpc/consume_ai_quota")) {
            return new Response(JSON.stringify({ allowed: true }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("/rest/v1/rpc/refund_ai_quota")) {
            const body = init?.body ? JSON.parse(init.body.toString()) : {};
            refundCalls.push({ userId: body.p_user_id, amount: body.p_amount });
            return new Response(JSON.stringify(0), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            // Simulate AI failure (status 500)
            return new Response(JSON.stringify({ error: { code: 500, message: "AI model failed" } }), {
                status: 500,
                headers: { "Content-Type": "application/json" }
            });
        }
        return originalFetch(input, init);
    };

    try {
        // 1. Text failure -> refund 1 use
        refundCalls.length = 0;
        globalThis.fetch = createMockFetch(false);
        const textReq = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: "Random unparseable prose text that goes to AI" })
        });
        const textRes = await app.fetch(textReq);
        assertEquals(textRes.status, 500);
        assertEquals(refundCalls.length, 1);
        assertEquals(refundCalls[0].userId, "refund-user-123");
        assertEquals(refundCalls[0].amount, 1);

        // 2. Photo failure -> refund 2 uses
        refundCalls.length = 0;
        globalThis.fetch = createMockFetch(true);
        const photoReq = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({
                input: "Photo of salad",
                image_base64: "data:image/jpeg;base64,/9j/4AAQSkZJRg=="
            })
        });
        const photoRes = await app.fetch(photoReq);
        assertEquals(photoRes.status, 500);
        assertEquals(refundCalls.length, 1);
        assertEquals(refundCalls[0].userId, "refund-user-123");
        assertEquals(refundCalls[0].amount, 2);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
        if (originalServiceKey) Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", originalServiceKey);
        else Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    }
});

Deno.test("parse-nutrition AI quota: refund NOT called on success, quota-denied, device-parsed fast path, or when quota flag is off", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    const originalServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    Deno.env.set("GEMINI_API_KEY", "mock-gemini-key");
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "mock-service-role-key");

    const refundCalls: { userId: string; amount: number }[] = [];
    let consumeCalls = 0;
    const originalFetch = globalThis.fetch;

    try {
        // Case A: Success -> no refund
        refundCalls.length = 0;
        globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
            const urlString = input.toString();
            if (urlString.includes("/auth/v1/user")) {
                return new Response(JSON.stringify({ id: "user-abc", email: "u@yb.fyi" }), { status: 200, headers: { "Content-Type": "application/json" } });
            }
            if (urlString.includes("/rest/v1/app_config")) {
                return new Response(JSON.stringify({ value: true }), { status: 200, headers: { "Content-Type": "application/json" } });
            }
            if (urlString.includes("/rest/v1/rpc/consume_ai_quota")) {
                return new Response(JSON.stringify({ allowed: true }), { status: 200, headers: { "Content-Type": "application/json" } });
            }
            if (urlString.includes("/rest/v1/rpc/refund_ai_quota")) {
                refundCalls.push(JSON.parse(init?.body?.toString() || "{}"));
                return new Response(JSON.stringify(0), { status: 200, headers: { "Content-Type": "application/json" } });
            }
            if (urlString.includes("generativelanguage.googleapis.com")) {
                return new Response(JSON.stringify({
                    candidates: [{ content: { parts: [{ text: JSON.stringify({ is_food: true, name: "Egg", calories: 70, protein: 6, carbs: 0, fat: 5, fiber: 0, explanation: "1 egg", items: [] }) }] } }]
                }), { status: 200, headers: { "Content-Type": "application/json" } });
            }
            return originalFetch(input, init);
        };

        const successReq = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: "Had 1 boiled egg" })
        });
        const successRes = await app.fetch(successReq);
        assertEquals(successRes.status, 200);
        assertEquals(refundCalls.length, 0);

        // Case B: Quota denied -> no refund
        refundCalls.length = 0;
        globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
            const urlString = input.toString();
            if (urlString.includes("/auth/v1/user")) {
                return new Response(JSON.stringify({ id: "user-abc", email: "u@yb.fyi" }), { status: 200, headers: { "Content-Type": "application/json" } });
            }
            if (urlString.includes("/rest/v1/app_config")) {
                return new Response(JSON.stringify({ value: true }), { status: 200, headers: { "Content-Type": "application/json" } });
            }
            if (urlString.includes("/rest/v1/rpc/consume_ai_quota")) {
                return new Response(JSON.stringify({ allowed: false, limit: 10, used: 10, period: "day" }), { status: 200, headers: { "Content-Type": "application/json" } });
            }
            if (urlString.includes("/rest/v1/rpc/refund_ai_quota")) {
                refundCalls.push(JSON.parse(init?.body?.toString() || "{}"));
                return new Response(JSON.stringify(0), { status: 200, headers: { "Content-Type": "application/json" } });
            }
            return originalFetch(input, init);
        };

        const deniedReq = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: "Steak and potatoes" })
        });
        const deniedRes = await app.fetch(deniedReq);
        assertEquals(deniedRes.status, 429);
        assertEquals(refundCalls.length, 0);

        // Case C: Device fast-path (exact text, forceAi false) -> neither consume nor refund
        consumeCalls = 0;
        refundCalls.length = 0;
        globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
            const urlString = input.toString();
            if (urlString.includes("/auth/v1/user")) {
                return new Response(JSON.stringify({ id: "user-abc", email: "u@yb.fyi" }), { status: 200, headers: { "Content-Type": "application/json" } });
            }
            if (urlString.includes("/rest/v1/app_config")) {
                return new Response(JSON.stringify({ value: true }), { status: 200, headers: { "Content-Type": "application/json" } });
            }
            if (urlString.includes("/rest/v1/rpc/consume_ai_quota")) {
                consumeCalls++;
                return new Response(JSON.stringify({ allowed: true }), { status: 200, headers: { "Content-Type": "application/json" } });
            }
            if (urlString.includes("/rest/v1/rpc/refund_ai_quota")) {
                refundCalls.push(JSON.parse(init?.body?.toString() || "{}"));
                return new Response(JSON.stringify(0), { status: 200, headers: { "Content-Type": "application/json" } });
            }
            return originalFetch(input, init);
        };

        const fastPathReq = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: "Chicken Breast\nCalories: 165 kcal\nProtein: 31g\nCarbs: 0g\nFat: 3.6g" })
        });
        const fastPathRes = await app.fetch(fastPathReq);
        assertEquals(fastPathRes.status, 200);
        assertEquals(consumeCalls, 0);
        assertEquals(refundCalls.length, 0);

        // Case D: Flag off -> AI failure does not refund
        refundCalls.length = 0;
        globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
            const urlString = input.toString();
            if (urlString.includes("/auth/v1/user")) {
                return new Response(JSON.stringify({ id: "user-abc", email: "u@yb.fyi" }), { status: 200, headers: { "Content-Type": "application/json" } });
            }
            if (urlString.includes("/rest/v1/app_config")) {
                return new Response(JSON.stringify({ value: false }), { status: 200, headers: { "Content-Type": "application/json" } });
            }
            if (urlString.includes("/rest/v1/rpc/refund_ai_quota")) {
                refundCalls.push(JSON.parse(init?.body?.toString() || "{}"));
                return new Response(JSON.stringify(0), { status: 200, headers: { "Content-Type": "application/json" } });
            }
            if (urlString.includes("generativelanguage.googleapis.com")) {
                return new Response(JSON.stringify({ error: { code: 500, message: "AI down" } }), { status: 500, headers: { "Content-Type": "application/json" } });
            }
            return originalFetch(input, init);
        };

        const flagOffReq = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: "Arbitrary text" })
        });
        const flagOffRes = await app.fetch(flagOffReq);
        assertEquals(flagOffRes.status, 500);
        assertEquals(refundCalls.length, 0);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
        if (originalServiceKey) Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", originalServiceKey);
        else Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    }
});

Deno.test("parse-nutrition AI quota: rpc error captures to Sentry and proceeds to Gemini (fails open)", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "mock-gemini-key");

    let geminiCalled = false;
    let rpcErrorWarnLogged = false;
    const originalFetch = globalThis.fetch;
    const originalWarn = console.warn;

    console.warn = (...args: any[]) => {
        const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
        if (msg.includes("Failed to consume AI quota RPC (failing open)")) {
            rpcErrorWarnLogged = true;
        }
        originalWarn(...args);
    };

    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "user-sentry-test", email: "sentry@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("/rest/v1/app_config")) {
            return new Response(JSON.stringify({ value: true }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("/rest/v1/rpc/consume_ai_quota")) {
            return new Response(JSON.stringify({ message: "DB connection timeout" }), {
                status: 500,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            geminiCalled = true;
            return new Response(JSON.stringify({
                candidates: [{
                    content: {
                        parts: [{
                            text: JSON.stringify({
                                is_food: true,
                                name: "Orange",
                                calories: 60,
                                protein: 1,
                                carbs: 15,
                                fat: 0,
                                fiber: 3,
                                explanation: "1 orange",
                                items: []
                            })
                        }]
                    }
                }]
            }), {
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
            body: JSON.stringify({ input: "Had an orange" })
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 200);
        assertEquals(geminiCalled, true);
        assertEquals(rpcErrorWarnLogged, true);
    } finally {
        globalThis.fetch = originalFetch;
        console.warn = originalWarn;
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
    }
});

Deno.test("AI fallback constants: verify budget constants and relationships", () => {
    assertEquals(OVERALL_BUDGET_TEXT_MS, 27000);
    assertEquals(OVERALL_BUDGET_VISION_MS, 42000);
    assertEquals(FIRST_ATTEMPT_BUDGET_TEXT_MS, 12000);
    assertEquals(FIRST_ATTEMPT_BUDGET_VISION_MS, 20000);
    assertEquals(FIRST_ATTEMPT_BUDGET_TEXT_MS < OVERALL_BUDGET_TEXT_MS, true);
    assertEquals(FIRST_ATTEMPT_BUDGET_VISION_MS < OVERALL_BUDGET_VISION_MS, true);
});

Deno.test("AI fallback timing: first model hangs -> fallback is tried and succeeds within total budget", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");
    setAiBudgetConfigForTesting({
        overallTextMs: 150,
        firstAttemptTextMs: 50,
        minAttemptMs: 10,
    });

    const calledModels: string[] = [];
    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            if (urlString.includes("gemini-3.5-flash-lite")) {
                calledModels.push("gemini-3.5-flash-lite");
                // Simulate primary model hanging until abortSignal fires
                return new Promise((_, reject) => {
                    if (init?.signal?.aborted) {
                        reject(new DOMException("The operation was aborted", "AbortError"));
                        return;
                    }
                    init?.signal?.addEventListener("abort", () => {
                        reject(new DOMException("The operation was aborted", "AbortError"));
                    });
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
                                    calories: 300,
                                    protein: 30,
                                    carbs: 20,
                                    fat: 5,
                                    fiber: 2,
                                    explanation: "Whey protein with milk",
                                    items: [{ name: "Protein Shake", portion: "1 shake", calories: 300, protein: 30, carbs: 20, fat: 5, fiber: 2 }],
                                }),
                            }],
                        },
                    }],
                };
                return new Response(JSON.stringify(mockResponse), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                });
            }
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const startTime = Date.now();
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: "Special shake 400 kcal", forceAi: true }),
        });

        const res = await app.fetch(req);
        const elapsed = Date.now() - startTime;

        assertEquals(res.status, 200);
        const data = await res.json();
        assertEquals(data.name, "Protein Shake");
        assertEquals(calledModels.includes("gemini-3.5-flash-lite"), true);
        assertEquals(calledModels.includes("gemini-3.1-flash-lite"), true);
        // Completed well within the overall text budget
        assertEquals(elapsed < 200, true);
    } finally {
        globalThis.fetch = originalFetch;
        setAiBudgetConfigForTesting(null);
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
    }
});

Deno.test("AI fallback timing: first model errors fast -> fallback gets the rest of the budget", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");
    setAiBudgetConfigForTesting({
        overallTextMs: 250,
        firstAttemptTextMs: 60,
        minAttemptMs: 10,
    });

    const calledModels: string[] = [];
    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            if (urlString.includes("gemini-3.5-flash-lite")) {
                calledModels.push("gemini-3.5-flash-lite");
                // Errors fast (immediate 400, non-retryable so zero backoff delay)
                return new Response(JSON.stringify({
                    error: { code: 400, message: "Model request rejected" },
                }), {
                    status: 400,
                    headers: { "Content-Type": "application/json" },
                });
            }
            if (urlString.includes("gemini-3.1-flash-lite")) {
                calledModels.push("gemini-3.1-flash-lite");
                // Delay 90ms: longer than firstAttemptTextMs (60ms), but well within remaining overall budget (250ms).
                // If fallback were capped at 60ms, it would abort; because it gets the remaining budget, it succeeds.
                await new Promise((resolve) => setTimeout(resolve, 90));
                const mockResponse = {
                    candidates: [{
                        content: {
                            parts: [{
                                text: JSON.stringify({
                                    is_food: true,
                                    name: "Fast Recovery Oatmeal",
                                    calories: 250,
                                    protein: 10,
                                    carbs: 45,
                                    fat: 4,
                                    fiber: 6,
                                    explanation: "Oatmeal with water",
                                    items: [{ name: "Oatmeal", portion: "1 bowl", calories: 250, protein: 10, carbs: 45, fat: 4, fiber: 6 }],
                                }),
                            }],
                        },
                    }],
                };
                return new Response(JSON.stringify(mockResponse), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
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
            body: JSON.stringify({ input: "Bowl of oatmeal", forceAi: true }),
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 200);
        const data = await res.json();
        assertEquals(data.name, "Fast Recovery Oatmeal");
        assertEquals(calledModels, ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]);
    } finally {
        globalThis.fetch = originalFetch;
        setAiBudgetConfigForTesting(null);
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
    }
});

Deno.test("AI fallback timing: both models hang -> 504 at the total budget", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");
    setAiBudgetConfigForTesting({
        overallTextMs: 120,
        firstAttemptTextMs: 40,
        minAttemptMs: 10,
    });

    const calledModels: string[] = [];
    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            const match = urlString.match(/models\/([^:]+):/);
            if (match) {
                calledModels.push(match[1]);
            }
            // Both models hang until aborted
            return new Promise((_, reject) => {
                if (init?.signal?.aborted) {
                    reject(new DOMException("The operation was aborted", "AbortError"));
                    return;
                }
                init?.signal?.addEventListener("abort", () => {
                    reject(new DOMException("The operation was aborted", "AbortError"));
                });
            });
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const startTime = Date.now();
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: "Both models hang test meal", forceAi: true }),
        });

        const res = await app.fetch(req);
        const elapsed = Date.now() - startTime;

        assertEquals(res.status, 504);
        const data = await res.json();
        assertEquals(data.code, "TIMEOUT");
        assertEquals(calledModels, ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]);
        // Completed at approximately total budget (not immediately, and not exceeding excessive time)
        assertEquals(elapsed >= 80, true);
    } finally {
        globalThis.fetch = originalFetch;
        setAiBudgetConfigForTesting(null);
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
    }
});

Deno.test("AI fallback Sentry: capture is called with message + tags and WITHOUT meal text/payload", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");
    setAiBudgetConfigForTesting({
        overallTextMs: 100,
        firstAttemptTextMs: 40,
        minAttemptMs: 10,
    });

    const capturedEvents: Array<{ type: string; message: string; context: any }> = [];
    setTestCaptureHook((type, arg, context) => {
        capturedEvents.push({
            type,
            message: typeof arg === "string" ? arg : (arg as any)?.message,
            context,
        });
    });

    const sensitiveInputText = "Top-secret-granola-bar-with-macadamia-nuts-987654";
    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "sensitive-athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            // Both models hang
            return new Promise((_, reject) => {
                if (init?.signal?.aborted) {
                    reject(new DOMException("The operation was aborted", "AbortError"));
                    return;
                }
                init?.signal?.addEventListener("abort", () => {
                    reject(new DOMException("The operation was aborted", "AbortError"));
                });
            });
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: sensitiveInputText, forceAi: true }),
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 504);

        // Exactly one event captured for the request
        assertEquals(capturedEvents.length, 1);
        const event = capturedEvents[0];
        assertEquals(event.message, "parse-nutrition AI timeout");

        assertExists(event.context);
        assertExists(event.context.tags);
        const tags = event.context.tags;
        assertEquals(tags.model_id, "gemini-3.1-flash-lite");
        assertEquals(tags.model, undefined);
        assertEquals(tags.attempt_count, "2");
        assertEquals(tags.kind, "text");
        assertExists(tags.elapsed_ms);

        // Assert WITHOUT the meal text, image, user id, or request payload
        const serialized = JSON.stringify(event);
        assertEquals(serialized.includes(sensitiveInputText), false);
        assertEquals(serialized.includes("granola"), false);
        assertEquals(serialized.includes("macadamia"), false);
        assertEquals(serialized.includes("sensitive-athlete@yourbody.fyi"), false);
        assertEquals(serialized.includes("mock-user-id"), false);
    } finally {
        globalThis.fetch = originalFetch;
        setAiBudgetConfigForTesting(null);
        setTestCaptureHook(null);
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
    }
});

Deno.test("AI fallback Sentry: model error reports parse-nutrition AI model error with tags", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    const capturedEvents: Array<{ type: string; message: string; context: any }> = [];
    setTestCaptureHook((type, arg, context) => {
        capturedEvents.push({
            type,
            message: typeof arg === "string" ? arg : (arg as any)?.message,
            context,
        });
    });

    const privateMeal = "Confidential pre-workout creatine formula 8888";
    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            // Both models fail with 503 capacity exhaustion
            return new Response(JSON.stringify({
                error: { code: 503, message: "The model is overloaded due to high demand (DECODE_PREEMPTED)" },
            }), {
                status: 503,
                headers: { "Content-Type": "application/json" },
            });
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: privateMeal, forceAi: true }),
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 503);

        assertEquals(capturedEvents.length, 1);
        const event = capturedEvents[0];
        assertEquals(event.message, "parse-nutrition AI model error");
        assertExists(event.context?.tags);
        assertEquals(event.context.tags.model_id, "gemini-3.1-flash-lite");
        assertEquals(event.context.tags.model, undefined);
        assertEquals(event.context.tags.attempt_count, "2");
        assertEquals(event.context.tags.kind, "text");

        const serialized = JSON.stringify(event);
        assertEquals(serialized.includes(privateMeal), false);
        assertEquals(serialized.includes("creatine"), false);
        assertEquals(serialized.includes("8888"), false);
    } finally {
        globalThis.fetch = originalFetch;
        setTestCaptureHook(null);
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
    }
});

Deno.test("AI fallback Sentry: vision timeout reports tags.kind = vision without image payload", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");
    setAiBudgetConfigForTesting({
        overallVisionMs: 120,
        firstAttemptVisionMs: 50,
        minAttemptMs: 10,
    });

    const capturedEvents: Array<{ type: string; message: string; context: any }> = [];
    setTestCaptureHook((type, arg, context) => {
        capturedEvents.push({
            type,
            message: typeof arg === "string" ? arg : (arg as any)?.message,
            context,
        });
    });

    const imagePayload = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
        const urlString = input.toString();
        if (urlString.includes("/auth/v1/user")) {
            return new Response(JSON.stringify({ id: "mock-user-id", email: "athlete@yourbody.fyi" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }
        if (urlString.includes("generativelanguage.googleapis.com")) {
            return new Promise((_, reject) => {
                if (init?.signal?.aborted) {
                    reject(new DOMException("The operation was aborted", "AbortError"));
                    return;
                }
                init?.signal?.addEventListener("abort", () => {
                    reject(new DOMException("The operation was aborted", "AbortError"));
                });
            });
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: "", image_base64: imagePayload }),
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 504);

        assertEquals(capturedEvents.length, 1);
        const event = capturedEvents[0];
        assertEquals(event.message, "parse-nutrition AI timeout");
        assertExists(event.context?.tags);
        assertEquals(event.context.tags.kind, "vision");
        assertEquals(event.context.tags.attempt_count, "2");

        const serialized = JSON.stringify(event);
        assertEquals(serialized.includes(imagePayload), false);
        assertEquals(serialized.includes("iVBORw0"), false);
    } finally {
        globalThis.fetch = originalFetch;
        setAiBudgetConfigForTesting(null);
        setTestCaptureHook(null);
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
    }
});

Deno.test("AI fallback Sentry: all models fail with non-timeout non-capacity error -> capture hook called exactly once", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    const capturedEvents: Array<{ type: string; message: string; context: any }> = [];
    setTestCaptureHook((type, arg, context) => {
        capturedEvents.push({
            type,
            message: typeof arg === "string" ? arg : (arg as any)?.message,
            context,
        });
    });

    const privateMeal = "Specialist recovery supplement 7777";
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
            // Non-timeout, non-capacity error (HTTP 400 Bad Request, fast fail with zero retries)
            return new Response(JSON.stringify({
                error: { code: 400, message: "Invalid argument format" },
            }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: privateMeal, forceAi: true }),
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 500);

        // Crucial invariant: aiFailureReported prevents double reporting when throw lastAiError
        // is caught by outer catch block
        assertEquals(capturedEvents.length, 1);
        const event = capturedEvents[0];
        assertEquals(event.message, "parse-nutrition AI model error");
        assertExists(event.context?.tags);
        assertEquals(event.context.tags.model_id, "gemini-3.1-flash-lite");
        assertEquals(event.context.tags.model, undefined);
        assertEquals(event.context.tags.attempt_count, "2");
        assertEquals(event.context.tags.kind, "text");

        const serialized = JSON.stringify(event);
        assertEquals(serialized.includes(privateMeal), false);
        assertEquals(serialized.includes("supplement"), false);
        assertEquals(serialized.includes("7777"), false);
    } finally {
        globalThis.fetch = originalFetch;
        setTestCaptureHook(null);
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
    }
});

Deno.test("AI fallback attribution: primary 503 fast fail and fallback timeout reports 504 timeout with attempt count 2", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");
    setAiBudgetConfigForTesting({
        overallTextMs: 3000,
        firstAttemptTextMs: 1600,
        minAttemptMs: 50,
    });

    const capturedEvents: Array<{ type: string; message: string; context: any }> = [];
    setTestCaptureHook((type, arg, context) => {
        capturedEvents.push({
            type,
            message: typeof arg === "string" ? arg : (arg as any)?.message,
            context,
        });
    });

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
                if (!calledModels.includes("gemini-3.5-flash-lite")) {
                    calledModels.push("gemini-3.5-flash-lite");
                }
                // Primary model fails fast with 503 capacity error
                return new Response(JSON.stringify({
                    error: { code: 503, message: "The model is overloaded due to high demand (DECODE_PREEMPTED)" },
                }), {
                    status: 503,
                    headers: { "Content-Type": "application/json" },
                });
            }
            if (urlString.includes("gemini-3.1-flash-lite")) {
                if (!calledModels.includes("gemini-3.1-flash-lite")) {
                    calledModels.push("gemini-3.1-flash-lite");
                }
                // Fallback model hangs until aborted
                return new Promise((_, reject) => {
                    if (init?.signal?.aborted) {
                        reject(new DOMException("The operation was aborted", "AbortError"));
                        return;
                    }
                    init?.signal?.addEventListener("abort", () => {
                        reject(new DOMException("The operation was aborted", "AbortError"));
                    });
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
            body: JSON.stringify({ input: "Protein shake 300 kcal", forceAi: true }),
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 504);
        const data = await res.json();
        assertEquals(data.code, "TIMEOUT");
        assertEquals(calledModels, ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]);

        assertEquals(capturedEvents.length, 1);
        const event = capturedEvents[0];
        assertEquals(event.message, "parse-nutrition AI timeout");
        assertExists(event.context?.tags);
        assertEquals(event.context.tags.model_id, "gemini-3.1-flash-lite");
        assertEquals(event.context.tags.attempt_count, "2");
        assertEquals(event.context.tags.kind, "text");
    } finally {
        globalThis.fetch = originalFetch;
        setAiBudgetConfigForTesting(null);
        setTestCaptureHook(null);
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
    }
});

Deno.test("AI fallback attribution: primary model hang with remaining budget below minimum skips fallback and reports attempt count 1", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");
    setAiBudgetConfigForTesting({
        overallTextMs: 70,
        firstAttemptTextMs: 50,
        minAttemptMs: 30,
    });

    const capturedEvents: Array<{ type: string; message: string; context: any }> = [];
    setTestCaptureHook((type, arg, context) => {
        capturedEvents.push({
            type,
            message: typeof arg === "string" ? arg : (arg as any)?.message,
            context,
        });
    });

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
            const match = urlString.match(/models\/([^:]+):/);
            if (match) {
                calledModels.push(match[1]);
            }
            // Primary model hangs until aborted
            return new Promise((_, reject) => {
                if (init?.signal?.aborted) {
                    reject(new DOMException("The operation was aborted", "AbortError"));
                    return;
                }
                init?.signal?.addEventListener("abort", () => {
                    reject(new DOMException("The operation was aborted", "AbortError"));
                });
            });
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: "Protein shake 300 kcal", forceAi: true }),
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 504);
        const data = await res.json();
        assertEquals(data.code, "TIMEOUT");
        // Fallback is NOT called because remaining budget is below minAttemptBudgetMs
        assertEquals(calledModels, ["gemini-3.5-flash-lite"]);

        assertEquals(capturedEvents.length, 1);
        const event = capturedEvents[0];
        assertEquals(event.message, "parse-nutrition AI timeout");
        assertExists(event.context?.tags);
        assertEquals(event.context.tags.model_id, "gemini-3.5-flash-lite");
        assertEquals(event.context.tags.attempt_count, "1");
        assertEquals(event.context.tags.kind, "text");
    } finally {
        globalThis.fetch = originalFetch;
        setAiBudgetConfigForTesting(null);
        setTestCaptureHook(null);
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
    }
});

Deno.test("AI fallback attribution: primary 503 and fallback 503 returns 503 capacity exhausted unchanged", async () => {
    const originalKey = Deno.env.get("GEMINI_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "test-key");

    const capturedEvents: Array<{ type: string; message: string; context: any }> = [];
    setTestCaptureHook((type, arg, context) => {
        capturedEvents.push({
            type,
            message: typeof arg === "string" ? arg : (arg as any)?.message,
            context,
        });
    });

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
            const match = urlString.match(/models\/([^:]+):/);
            if (match && !calledModels.includes(match[1])) {
                calledModels.push(match[1]);
            }
            // Both primary and fallback return 503 capacity error
            return new Response(JSON.stringify({
                error: { code: 503, message: "The model is overloaded due to high demand (DECODE_PREEMPTED)" },
            }), {
                status: 503,
                headers: { "Content-Type": "application/json" },
            });
        }
        return originalFetch(input, init);
    };

    globalThis.fetch = mockFetch;

    try {
        const req = new Request("http://localhost/parse-nutrition", {
            method: "POST",
            headers: { "Authorization": "Bearer valid-jwt-token" },
            body: JSON.stringify({ input: "Protein shake 300 kcal", forceAi: true }),
        });

        const res = await app.fetch(req);
        assertEquals(res.status, 503);
        assertEquals(res.headers.get("Retry-After"), "5");
        const data = await res.json();
        assertEquals(data.code, "CAPACITY_EXHAUSTED");
        assertEquals(data.retryAfter, 5);
        assertEquals(calledModels, ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]);

        assertEquals(capturedEvents.length, 1);
        const event = capturedEvents[0];
        assertEquals(event.message, "parse-nutrition AI model error");
        assertExists(event.context?.tags);
        assertEquals(event.context.tags.model_id, "gemini-3.1-flash-lite");
        assertEquals(event.context.tags.attempt_count, "2");
        assertEquals(event.context.tags.kind, "text");
    } finally {
        globalThis.fetch = originalFetch;
        setTestCaptureHook(null);
        if (originalKey) Deno.env.set("GEMINI_API_KEY", originalKey);
        else Deno.env.delete("GEMINI_API_KEY");
    }
});




