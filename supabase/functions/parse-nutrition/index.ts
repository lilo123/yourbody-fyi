import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { GoogleGenAI, Type } from "npm:@google/genai";
import { createClient } from "npm:@supabase/supabase-js@2";

// Overall AI execution budgets (in milliseconds). Deliberately set below the client
// ceilings of 45s (vision) and 30s (text) in src/components/nutrition/useNutritionAi.ts
// so that edge function timeouts/fallbacks resolve before the client drops the connection.
export const OVERALL_BUDGET_VISION_MS = 42000;
export const OVERALL_BUDGET_TEXT_MS = 27000;
export const MIN_ATTEMPT_BUDGET_MS = 1500;

// Bounded HTTP retry configuration for @google/genai SDK calls
const HTTP_RETRY_OPTIONS = {
  attempts: 2,
  initialDelay: 1.0,
  maxDelay: 4.0,
  jitter: 1,
};

import { isAllowedOrigin, getCorsHeaders as getBaseCorsHeaders } from "../_shared/cors.ts";
import { captureException } from "../_shared/errorReporting.ts";

export { isAllowedOrigin };

export function getCorsHeaders(origin: string | null | undefined): Record<string, string> {
  return getBaseCorsHeaders(origin, {
    'Access-Control-Expose-Headers': 'Retry-After',
    'Access-Control-Max-Age': '86400',
  });
}

export interface StructuredNutritionResult {
  is_food?: boolean;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  serving_size?: number;
  serving_unit?: string;
  explanation: string;
  items: Array<{
    name: string;
    portion: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber: number;
  }>;
}

export function parseStructuredNutritionText(input: string): StructuredNutritionResult | null {
  const lines = input.split('\n');
  const items: Array<{
    name: string;
    portion: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber: number;
  }> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('===') || trimmed.startsWith('+++') || trimmed.startsWith('---')) continue;
    if (/^(?:Component Breakdown|Breakdown|Ingredients|Totals?):/i.test(trimmed)) continue;
    if (/^(?:Total\s+)?(?:Calories|Protein|Carbs|Fat|Fiber):/i.test(trimmed)) continue;
    if (/^(?:Food Item|Meal Name|Dish Name|Meal|Dish|Title|Total Portion Size|Portion Size|Serving Size):/i.test(trimmed)) continue;

    const bulletCleaned = trimmed.replace(/^(?:[*•\-+]|\d+[.)])\s*/, '');
    const hasMacros = /(?:kcal|cal|\bp\b|\bprotein\b|\bc\b|\bcarbs?\b|\bf\b|\bfat\b)/i.test(bulletCleaned);
    if (!hasMacros) continue;

    let nameAndPortion = '';
    let macrosStr = '';

    if (bulletCleaned.includes('|')) {
      const parts = bulletCleaned.split('|');
      if (/(?:kcal|cal|\bp\b|\bprotein\b)/i.test(parts[0])) continue;
      if (parts.length > 2 && !/(?:kcal|cal|\bp\b|\bprotein\b|\bc\b|\bcarbs?\b|\bf\b|\bfat\b)/i.test(parts[1])) {
        nameAndPortion = parts[0] + ': ' + parts[1];
        macrosStr = parts.slice(2).join(' | ');
      } else {
        nameAndPortion = parts[0];
        macrosStr = parts.slice(1).join(' | ');
      }
    } else if (bulletCleaned.includes(':')) {
      const colonIdx = bulletCleaned.indexOf(':');
      nameAndPortion = bulletCleaned.slice(0, colonIdx);
      macrosStr = bulletCleaned.slice(colonIdx + 1);
    } else {
      continue;
    }

    let name = nameAndPortion.trim();
    let portion = '1 serving';

    if (nameAndPortion.includes(':')) {
      const subParts = nameAndPortion.split(':');
      name = subParts[0].trim();
      portion = subParts.slice(1).join(':').trim() || '1 serving';
    } else if (nameAndPortion.includes(' - ')) {
      const subParts = nameAndPortion.split(' - ');
      name = subParts[0].trim();
      portion = subParts.slice(1).join(' - ').trim() || '1 serving';
    }

    const calMatch = macrosStr.match(/([\d.]+)\s*(?:kcal|cal(?:ories)?)\b/i);
    const pMatch = macrosStr.match(/([\d.]+)\s*g?\s*(?:P(?:rotein)?)\b/i);
    const cMatch = macrosStr.match(/([\d.]+)\s*g?\s*(?:C(?:arbs?|arbohydrates?)?)\b/i);
    const fMatch = macrosStr.match(/([\d.]+)\s*g?\s*(?:F(?:at)?)\b/i);
    const fibMatch = macrosStr.match(/([\d.]+)\s*g?\s*(?:Fiber|Fib|Fibre)\b/i);

    if (!calMatch && !pMatch && !cMatch && !fMatch) continue;

    items.push({
      name,
      portion,
      calories: calMatch ? parseFloat(calMatch[1]) : 0,
      protein: pMatch ? parseFloat(pMatch[1]) : 0,
      carbs: cMatch ? parseFloat(cMatch[1]) : 0,
      fat: fMatch ? parseFloat(fMatch[1]) : 0,
      fiber: fibMatch ? parseFloat(fibMatch[1]) : 0,
    });
  }

  if (items.length === 0) return null;

  const foodItemMatch = input.match(/(?:Food Item|Meal Name|Dish Name|Meal|Dish|Title|Food):\s*([^\n\r+]+)/i);
  const mealTitle = foodItemMatch ? foodItemMatch[1].trim() : items.map((i) => i.name).join(', ');

  const portionSizeMatch = input.match(/(?:Total\s+Portion\s+Size|Portion\s+Size|Serving\s+Size|Total\s+Size):\s*([\d.]+)\s*([a-zA-Z%]+)?/i);
  const servingSize = portionSizeMatch ? parseFloat(portionSizeMatch[1]) : undefined;
  const servingUnit = portionSizeMatch && portionSizeMatch[2] ? portionSizeMatch[2].trim() : undefined;

  const totalCalMatch = input.match(/(?:Total\s+)?Calories:\s*([\d.]+)/i);
  const totalPMatch = input.match(/(?:Total\s+)?Protein:\s*([\d.]+)/i);
  const totalCMatch = input.match(/(?:Total\s+)?Carbs:\s*([\d.]+)/i);
  const totalFMatch = input.match(/(?:Total\s+)?Fat:\s*([\d.]+)/i);
  const totalFibMatch = input.match(/(?:Total\s+)?Fiber:\s*([\d.]+)/i);

  const totalCal = totalCalMatch ? parseFloat(totalCalMatch[1]) : items.reduce((acc, i) => acc + i.calories, 0);
  const totalP = totalPMatch ? parseFloat(totalPMatch[1]) : items.reduce((acc, i) => acc + i.protein, 0);
  const totalC = totalCMatch ? parseFloat(totalCMatch[1]) : items.reduce((acc, i) => acc + i.carbs, 0);
  const totalF = totalFMatch ? parseFloat(totalFMatch[1]) : items.reduce((acc, i) => acc + i.fat, 0);
  const totalFib = totalFibMatch ? parseFloat(totalFibMatch[1]) : items.reduce((acc, i) => acc + i.fiber, 0);

  const explanation = items
    .map((i) => `${i.calories} kcal (${i.name})`)
    .join(' + ') + ` = ${totalCal} kcal`;

  return {
    is_food: true,
    name: mealTitle,
    calories: totalCal,
    protein: totalP,
    carbs: totalC,
    fat: totalF,
    fiber: totalFib,
    serving_size: servingSize,
    serving_unit: servingUnit,
    explanation,
    items,
  };
}

const CANONICAL_UNITS = ['g', 'ml', 'unit'] as const;

function finiteOrZero(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/**
 * Force `parent = Σ(items)` and canonicalise each item's quantity/unit.
 *
 * Gemini is instructed to sum its own breakdown and mostly does, but "mostly"
 * is not a constraint: the database has a CHECK that rejects the row outright,
 * and the user would see a raw Postgres string. Rounding to 2 decimals keeps
 * the written value inside the constraint's epsilon without inventing
 * precision the model never had.
 *
 * Exported for testing. Accepts and returns the raw JSON text so a malformed
 * response passes through untouched rather than becoming a 500.
 */
export function reconcileParentWithItems(responseText: string): string {
  let parsed: any;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    return responseText;
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items) || parsed.items.length === 0) {
    return responseText;
  }

  const totals = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };

  parsed.items = parsed.items.map((item: any) => {
    const next = { ...item };
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
      next[key] = finiteOrZero(next[key]);
      totals[key] += next[key];
    }
    next.unit = CANONICAL_UNITS.includes(next.unit) ? next.unit : 'unit';
    // A zero or missing quantity would make the component unscalable, so fall
    // back to 1 of whatever unit it claims rather than to 0.
    const q = Number(next.quantity);
    next.quantity = Number.isFinite(q) && q > 0 ? q : 1;
    return next;
  });

  for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
    parsed[key] = Math.round(totals[key] * 100) / 100;
  }

  return JSON.stringify(parsed);
}

function isRateLimitError(err: any): boolean {
  if (!err) return false;
  if (err.status === 429 || err.statusCode === 429 || err.code === 429) return true;
  if (err.error?.code === 429 || err.error?.status === 429 || err.response?.status === 429) return true;
  const msgParts: string[] = [
    typeof err.message === 'string' ? err.message : '',
    typeof err.error?.message === 'string' ? err.error.message : '',
    typeof err.statusText === 'string' ? err.statusText : '',
    typeof err.cause?.message === 'string' ? err.cause.message : '',
    String(err),
  ];
  try {
    msgParts.push(JSON.stringify(err));
  } catch {
    // ignore circular json error
  }
  const msg = msgParts.join(' ').toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('resource_exhausted') ||
    msg.includes('resource has been exhausted') ||
    msg.includes('quota') ||
    msg.includes('rate limit')
  );
}

function isCapacityError(err: any): boolean {
  if (!err) return false;
  if (err.code === 'CAPACITY_EXHAUSTED') return true;
  const msgParts: string[] = [
    typeof err.message === 'string' ? err.message : '',
    typeof err.error?.message === 'string' ? err.error.message : '',
    typeof err.statusText === 'string' ? err.statusText : '',
    typeof err.cause?.message === 'string' ? err.cause.message : '',
    String(err),
  ];
  try {
    msgParts.push(JSON.stringify(err));
  } catch {
    // ignore circular json error
  }
  const msg = msgParts.join(' ').toLowerCase();
  return (
    msg.includes('capacity') ||
    msg.includes('high demand') ||
    msg.includes('overloaded') ||
    msg.includes('preempted') ||
    msg.includes('decode_preempted')
  );
}

function isTimeoutError(err: any): boolean {
  if (!err) return false;
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;
  if (err.status === 504 || err.statusCode === 504 || err.code === 504) return true;
  const msgParts: string[] = [
    typeof err.message === 'string' ? err.message : '',
    typeof err.error?.message === 'string' ? err.error.message : '',
    String(err),
  ];
  const msg = msgParts.join(' ').toLowerCase();
  return (
    msg.includes('504') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('abort') ||
    msg.includes('deadline_exceeded')
  );
}

export default {
  async fetch(req: Request) {
    const origin = req.headers.get('Origin');
    const corsHeaders = getCorsHeaders(origin);

    if (origin && !isAllowedOrigin(origin)) {
      return new Response(
        JSON.stringify({ error: 'CORS origin not allowed' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    // Verify Authorization header presence and Bearer token format
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid Authorization header. Authentication required.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';

      if (!supabaseUrl || !anonKey) {
        throw new Error('Supabase environment variables not configured');
      }

      // Verify caller authentication via Supabase Auth
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: userError } = await userClient.auth.getUser();
      if (userError || !user) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized: Invalid token' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      let body: any;
      try {
        body = await req.json();
      } catch (jsonErr: any) {
        console.error("[parse-nutrition] Failed to parse request JSON:", jsonErr?.message || jsonErr);
        return new Response(
          JSON.stringify({ error: 'Malformed JSON or payload too large.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const rawImage = body.image_base64 || body.imageBase64 || body.image || "";
      const rawMimeType = body.imageMimeType || body.image_mime_type || body.mimeType || body.mime_type || "";
      const imageBase64 = typeof rawImage === 'string' ? rawImage.trim() : "";
      const cleanBase64 = (imageBase64 === 'data:,' || imageBase64.startsWith('data:,'))
        ? ""
        : imageBase64
            .replace(/^data:[^,]*;base64,/i, '')
            .replace(/\s/g, '')
            .trim();
      const dataUriMatch = imageBase64.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9+.-]+)(?:;[^,]*)?;base64,/i);
      const detectedMime = dataUriMatch ? dataUriMatch[1] : "";
      const imageMimeType = (typeof rawMimeType === 'string' && rawMimeType.trim())
        ? rawMimeType.trim()
        : (detectedMime || "image/jpeg");

      const rawInput = body.input || body.prompt || body.text || "";
      const input = typeof rawInput === 'string' ? rawInput.trim().slice(0, 2000) : "";
      if (!input && !cleanBase64) {
        return new Response(
          JSON.stringify({ error: 'Input text or meal photo is required for nutrition parsing.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Fast-path: Pre-structured text-only input (< 1ms bypass without touching Google Gen AI)
      if (!cleanBase64 && input) {
        const fastPathResult = parseStructuredNutritionText(input);
        if (fastPathResult) {
          return new Response(JSON.stringify(fastPathResult), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      const apiKey = Deno.env.get("GEMINI_API_KEY");
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY is not configured");
      }

      const custom_dishes = Array.isArray(body.custom_dishes) ? body.custom_dishes.slice(0, 50) : [];
      let contextStr = "";
      // Option B: Only inject custom dishes if there is accompanying text (input).
      if (custom_dishes.length > 0 && input) {
        contextStr = `\n\n   User's Custom Dishes:${JSON.stringify(custom_dishes)}`;
      }

      const systemInstruction = `You are an expert sports nutritionist, food data parser, and visual meal recognition engine.

CORE RESPONSIBILITIES & GUIDELINES:

1. DEFINITION OF VALID NUTRITION INPUT:
   - Carefully determine if the input represents a valid item for dietary tracking.
   - VALID (\`is_food: true\`): Meals, drinks, raw ingredients, dietary supplements (e.g., protein powders, creatine, vitamins), and packaged food labels/barcodes.
   - INVALID (\`is_food: false\`): Unrelated objects (e.g., electronics, furniture, scenery, pets) or irrelevant text. If invalid, return zero/empty values for macros and an empty array for items.

2. HIERARCHY OF EVIDENCE (TEXT > VISUAL > CUSTOM DISHES):
   - 1st Priority (Explicit Text): If the user provides manual labels, text overrides, or pre-calculated macros (e.g., '150g Chicken | 240 kcal | 46g P'), honor those exact text values verbatim over visual estimates.
   - 2nd Priority (Visual Evidence): Trust the image to identify ingredients, cooking styles, and realistic volume. Do not allow a custom dish to override what is clearly visible.
   - 3rd Priority (Custom Dishes): Use the custom dishes library as a reference ONLY if there is a direct and unmistakable match to the visual or textual evidence. Never force a match across unrelated foods.${contextStr}

3. ITEMIZATION & REALISTIC DECOMPOSITION:
   - For composite meals (e.g., burritos, pasta, stir-fry), decompose into realistic individual ingredients in the "items" array. Include typical invisible cooking ingredients (e.g., fats, cooking oils, butter, sugar) when the preparation method implies them. Do not add phantom fats to plainly steamed, grilled, or raw items.
   - For simple/single foods (e.g., an apple, a protein bar, black coffee, a scoop of whey), keep them as a single item in the "items" array without over-fragmenting them.

4. REQUIRED OUTPUT FORMATTING & MATHEMATICAL INTEGRITY:
   - 'name': Provide a clean, concise title for the overall meal (2-5 words, e.g., 'Chicken Rice Bowl', 'Grilled Chicken Salad').
   - 'serving_size' & 'serving_unit': Estimate the total net portion (e.g., 450, 'g' or 1, 'bowl').
   - Atwater Consistency: Calories for each item MUST mathematically align with the standard macronutrient multipliers (roughly 4 kcal/g protein, 4 kcal/g carb, 9 kcal/g fat).
   - Column Summation: The total top-level calories, protein, carbs, fat, and fiber must exactly sum the breakdown of the individual items array.
   - Per-item portion: 'portion' stays human readable (e.g. '1 cup cooked'), and 'quantity'/'unit' express that same amount numerically in one of exactly three canonical units: 'g' (solids by mass), 'ml' (liquids by volume) or 'unit' (countable things, and anything that is neither mass nor volume). Convert household measures yourself — '1 cup rolled oats' is quantity 80, unit 'g'; '1 tbsp olive oil' is quantity 14, unit 'g'; '2 large eggs' is quantity 2, unit 'unit'. Never emit a unit outside that set.
   - 'explanation': Provide a concise formula showing summation (e.g., 'Beef (X kcal) + Noodles (Y kcal) + Broth (Z kcal) = Total kcal').`;

      let candidateModels: string[];
      let contents: any;

      if (cleanBase64) {
        const userNotes = input || "Analyze this meal photo.";
        contents = [
          { inlineData: { data: cleanBase64, mimeType: imageMimeType } },
          { text: userNotes },
        ];
        const defaultVisionModel = Deno.env.get("GEMINI_VISION_MODEL_ID") || "gemini-3.5-flash-lite";
        candidateModels = Array.from(new Set([
          defaultVisionModel,
          "gemini-3.5-flash-lite",
          "gemini-3.1-flash-lite",
          "gemini-3.8-flash",
        ]));
      } else {
        contents = [
          { text: input },
        ];
        const defaultTextModel = Deno.env.get("GEMINI_MODEL_ID") || "gemini-3.5-flash-lite";
        candidateModels = Array.from(new Set([
          defaultTextModel,
          "gemini-3.5-flash-lite",
          "gemini-3.1-flash-lite",
          "gemini-3.7-flash",
        ]));
      }

      const responseSchema = {
        type: Type.OBJECT,
        properties: {
          is_food: {
            type: Type.BOOLEAN,
            description: "True if the input or image contains food, drink, or nutrition-related items. False if it contains non-food objects, animals, landscapes, or irrelevant queries.",
          },
          name: { type: Type.STRING },
          calories: { type: Type.NUMBER },
          protein: { type: Type.NUMBER },
          carbs: { type: Type.NUMBER },
          fat: { type: Type.NUMBER },
          fiber: { type: Type.NUMBER },
          serving_size: { type: Type.NUMBER },
          serving_unit: { type: Type.STRING },
          explanation: { type: Type.STRING },
          items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                portion: { type: Type.STRING },
                quantity: {
                  type: Type.NUMBER,
                  description: "The portion expressed as a single number in the canonical unit below (e.g. 150 for '150 g', 2 for '2 eggs').",
                },
                unit: {
                  type: Type.STRING,
                  enum: ["g", "ml", "unit"],
                  description: "Canonical unit for `quantity`. Use 'g' for solids by mass, 'ml' for liquids by volume, and 'unit' for countable items and anything else.",
                },
                calories: { type: Type.NUMBER },
                protein: { type: Type.NUMBER },
                carbs: { type: Type.NUMBER },
                fat: { type: Type.NUMBER },
                fiber: { type: Type.NUMBER },
              },
              required: ["name", "portion", "quantity", "unit", "calories", "protein", "carbs", "fat", "fiber"],
            },
          },
        },
        required: ["is_food", "name", "calories", "protein", "carbs", "fat", "fiber", "items", "explanation"],
      };

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          retryOptions: HTTP_RETRY_OPTIONS,
        },
      });
      let responseText = "";
      let lastAiError: any = null;
      let rateLimitEncountered: any = null;
      let capacityErrorEncountered: any = null;
      let timeoutEncountered: any = null;

      const overallBudgetMs = cleanBase64 ? OVERALL_BUDGET_VISION_MS : OVERALL_BUDGET_TEXT_MS;
      const loopStartTime = Date.now();

      for (const model of candidateModels) {
        // Rationale: instant 503s cost ~0.3s so falling through remains cheap,
        // while a slow-but-healthy model gets all remaining time.
        const elapsed = Date.now() - loopStartTime;
        const remaining = overallBudgetMs - elapsed;
        if (remaining < MIN_ATTEMPT_BUDGET_MS) {
          const timeoutErr = new Error(`Overall AI budget exceeded: remaining ${remaining}ms < ${MIN_ATTEMPT_BUDGET_MS}ms`);
          timeoutEncountered = timeoutErr;
          lastAiError = timeoutErr;
          break;
        }

        const attemptStartTime = Date.now();
        try {
          const timeoutSignal = AbortSignal.timeout(remaining);
          const response = await ai.models.generateContent({
            model,
            contents,
            config: {
              systemInstruction,
              temperature: 0.1,
              responseMimeType: "application/json",
              responseSchema,
              abortSignal: timeoutSignal,
              httpOptions: {
                retryOptions: HTTP_RETRY_OPTIONS,
              },
            },
          });
          if (response?.text) {
            let candidateText = response.text;
            const fenceMatch = candidateText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (fenceMatch) {
              candidateText = fenceMatch[1].trim();
            }
            // Validate that response.text can be parsed as JSON
            const parsedCandidate = JSON.parse(candidateText);
            if (!parsedCandidate || typeof parsedCandidate !== 'object') {
              throw new Error("Candidate model returned non-object JSON");
            }

            // Non-Food Fast Fail: immediately return HTTP 422 without triggering fallback catch loop
            if (parsedCandidate.is_food === false || parsedCandidate.is_food === 'false') {
              return new Response(
                JSON.stringify({
                  error: "No food detected in input or image. Please provide a meal photo or food description.",
                  code: "NON_FOOD_DETECTED",
                }),
                { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }

            if (
              parsedCandidate.calories === undefined &&
              (!Array.isArray(parsedCandidate.items) || parsedCandidate.items.length === 0)
            ) {
              throw new Error("Candidate model returned JSON missing both calories and items");
            }
            responseText = candidateText;
            console.info(`[parse-nutrition] ${model} OK in ${Date.now() - attemptStartTime}ms`);
            break;
          }
        } catch (modelErr: any) {
          lastAiError = modelErr;
          if (isRateLimitError(modelErr)) {
            rateLimitEncountered = modelErr;
          } else if (isCapacityError(modelErr)) {
            capacityErrorEncountered = modelErr;
          } else if (isTimeoutError(modelErr)) {
            timeoutEncountered = modelErr;
          }
          const attemptDurationMs = Date.now() - attemptStartTime;
          const statusInfo = modelErr?.status ? ` (status ${modelErr.status})` : '';
          console.warn(`[parse-nutrition] Model ${model} encountered error in ${attemptDurationMs}ms${statusInfo}:`, modelErr?.message || modelErr);
        }
      }

      if (!responseText) {
        // If all AI models failed, attempt server-side structured text parse before throwing
        if (input) {
          const localStructured = parseStructuredNutritionText(input);
          if (localStructured) {
            return new Response(JSON.stringify(localStructured), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        }

        if (isRateLimitError(lastAiError) || rateLimitEncountered) {
          return new Response(
            JSON.stringify({
              error: "Gemini rate limit exceeded (15 RPM). Please wait 15 seconds or switch to manual entry.",
              code: "RATE_LIMITED",
              retryAfter: 15,
            }),
            {
              status: 429,
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json',
                'Retry-After': '15',
              },
            }
          );
        }

        if (isCapacityError(lastAiError) || capacityErrorEncountered) {
          return new Response(
            JSON.stringify({
              error: "AI model capacity is temporarily exhausted. Please try again in 5 seconds or switch to manual entry.",
              code: "CAPACITY_EXHAUSTED",
              retryAfter: 5,
            }),
            {
              status: 503,
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json',
                'Retry-After': '5',
              },
            }
          );
        }

        if (isTimeoutError(lastAiError) || timeoutEncountered) {
          return new Response(
            JSON.stringify({
              error: "AI model request timed out. Please try again or switch to manual entry.",
              code: "TIMEOUT",
            }),
            {
              status: 504,
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json',
              },
            }
          );
        }

        throw lastAiError || new Error("All AI models failed to generate content");
      }

      const fenceMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (fenceMatch) {
        responseText = fenceMatch[1].trim();
      }

      // The DB enforces parent = Σ(items) with a CHECK constraint. Letting a
      // model-authored total through unchecked means the insert fails later
      // with an opaque constraint error, so the invariant is established here,
      // at the only point where both halves are in hand.
      responseText = reconcileParentWithItems(responseText);

      return new Response(responseText, {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (error: any) {
      console.error("[parse-nutrition error]:", error?.message || error);
      if (isRateLimitError(error)) {
        return new Response(
          JSON.stringify({
            error: "Gemini rate limit exceeded (15 RPM). Please wait 15 seconds or switch to manual entry.",
            code: "RATE_LIMITED",
            retryAfter: 15,
          }),
          {
            status: 429,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
              'Retry-After': '15',
            },
          }
        );
      }
      if (isCapacityError(error)) {
        return new Response(
          JSON.stringify({
            error: "AI model capacity is temporarily exhausted. Please try again in 5 seconds or switch to manual entry.",
            code: "CAPACITY_EXHAUSTED",
            retryAfter: 5,
          }),
          {
            status: 503,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
              'Retry-After': '5',
            },
          }
        );
      }
      if (isTimeoutError(error)) {
        return new Response(
          JSON.stringify({
            error: "AI model request timed out. Please try again or switch to manual entry.",
            code: "TIMEOUT",
          }),
          {
            status: 504,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
            },
          }
        );
      }
      try {
        await captureException(error);
      } catch (sentryErr) {
        console.warn("[parse-nutrition] Error reporting failed:", sentryErr);
      }
      return new Response(
        JSON.stringify({ error: "Failed to parse meal nutrition. Please check your connection or use manual entry." }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  }
};
