import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNutritionAi } from '../../components/nutrition/useNutritionAi';
import { parseNutrition } from '../../components/nutrition/parseNutrition';
import { parseNutritionText } from './localParse';

vi.mock('../../components/nutrition/parseNutrition', () => ({
  parseNutrition: vi.fn().mockResolvedValue({
    name: 'Mock AI Meal',
    calories: 500,
    protein: 30,
    carbs: 40,
    fat: 10,
    fiber: 0,
    items: [],
    source: 'ai',
    confidence: 'exact',
  }),
  formatQuotaExceededMessage: vi.fn().mockReturnValue('Quota exceeded'),
}));

vi.mock('../../offline', () => ({
  enqueueAiItem: vi.fn(),
  enqueueAndAwait: vi.fn(),
  deleteAfterLog: vi.fn(),
  discardAiItem: vi.fn(),
}));

/**
 * Tiny seeded PRNG (deterministic LCG) to satisfy zero-external-deps requirement.
 */
function createSeededPrng(initialSeed = 42) {
  let state = initialSeed;
  return function nextRandom() {
    state = (state + 0x6d2b79f5) | 0;
    let temp = Math.imul(state ^ (state >>> 15), 1 | state);
    temp = (temp + Math.imul(temp ^ (temp >>> 7), 61 | temp)) ^ temp;
    return ((temp ^ (temp >>> 14)) >>> 0) / 4294967296;
  };
}

export const prng = createSeededPrng(20261012);

export interface KnownItem {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}

export interface KnownMeal {
  id: string;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  items: KnownItem[];
}

/**
 * 12 known meals with item breakdowns.
 * Each meal's items sum to parent numbers, Atwater-consistent within 10%.
 */
export const KNOWN_MEALS: KnownMeal[] = [
  {
    id: 'meal-01',
    name: 'Chicken Rice Bowl',
    calories: 600,
    protein: 60,
    carbs: 58,
    fat: 13,
    fiber: 2,
    items: [
      { name: 'Grilled Chicken Breast', calories: 340, protein: 55, carbs: 0, fat: 12, fiber: 0 },
      { name: 'Steamed White Rice', calories: 260, protein: 5, carbs: 58, fat: 1, fiber: 2 },
    ],
  },
  {
    id: 'meal-02',
    name: 'Sirloin Steak Plate',
    calories: 650,
    protein: 56,
    carbs: 54,
    fat: 23,
    fiber: 6,
    items: [
      { name: 'Sirloin Steak', calories: 410, protein: 52, carbs: 0, fat: 22, fiber: 0 },
      { name: 'Baked Sweet Potato', calories: 240, protein: 4, carbs: 54, fat: 1, fiber: 6 },
    ],
  },
  {
    id: 'meal-03',
    name: 'Salmon Quinoa Salad',
    calories: 540,
    protein: 48,
    carbs: 34,
    fat: 23,
    fiber: 4,
    items: [
      { name: 'Baked Salmon Fillet', calories: 350, protein: 42, carbs: 0, fat: 20, fiber: 0 },
      { name: 'Quinoa with Greens', calories: 190, protein: 6, carbs: 34, fat: 3, fiber: 4 },
    ],
  },
  {
    id: 'meal-04',
    name: 'Greek Yogurt Parfait',
    calories: 380,
    protein: 29,
    carbs: 46,
    fat: 8,
    fiber: 4,
    items: [
      { name: 'Greek Yogurt', calories: 200, protein: 24, carbs: 14, fat: 4, fiber: 0 },
      { name: 'Granola with Berries', calories: 180, protein: 5, carbs: 32, fat: 4, fiber: 4 },
    ],
  },
  {
    id: 'meal-05',
    name: 'Turkey Avocado Club',
    calories: 510,
    protein: 38,
    carbs: 50,
    fat: 18,
    fiber: 8,
    items: [
      { name: 'Turkey Breast on Bread', calories: 340, protein: 36, carbs: 42, fat: 3, fiber: 3 },
      { name: 'Fresh Avocado', calories: 170, protein: 2, carbs: 8, fat: 15, fiber: 5 },
    ],
  },
  {
    id: 'meal-06',
    name: 'Scrambled Egg Toast',
    calories: 430,
    protein: 26,
    carbs: 34,
    fat: 21,
    fiber: 4,
    items: [
      { name: 'Scrambled Eggs', calories: 250, protein: 18, carbs: 2, fat: 19, fiber: 0 },
      { name: 'Whole Wheat Toast', calories: 180, protein: 8, carbs: 32, fat: 2, fiber: 4 },
    ],
  },
  {
    id: 'meal-07',
    name: 'Tuna Pasta Salad',
    calories: 490,
    protein: 46,
    carbs: 52,
    fat: 10,
    fiber: 3,
    items: [
      { name: 'Chunk White Tuna', calories: 160, protein: 36, carbs: 0, fat: 1, fiber: 0 },
      { name: 'Bowtie Pasta with Olive Oil', calories: 330, protein: 10, carbs: 52, fat: 9, fiber: 3 },
    ],
  },
  {
    id: 'meal-08',
    name: 'Beef Burrito Bowl',
    calories: 720,
    protein: 54,
    carbs: 66,
    fat: 25,
    fiber: 8,
    items: [
      { name: 'Seasoned Lean Beef', calories: 380, protein: 42, carbs: 0, fat: 23, fiber: 0 },
      { name: 'Brown Rice and Beans', calories: 340, protein: 12, carbs: 66, fat: 2, fiber: 8 },
    ],
  },
  {
    id: 'meal-09',
    name: 'Tofu Vegetable Stir Fry',
    calories: 420,
    protein: 26,
    carbs: 44,
    fat: 15,
    fiber: 6,
    items: [
      { name: 'Pan Fried Tofu', calories: 240, protein: 22, carbs: 6, fat: 14, fiber: 2 },
      { name: 'Steamed Jasmine Rice', calories: 180, protein: 4, carbs: 38, fat: 1, fiber: 4 },
    ],
  },
  {
    id: 'meal-10',
    name: 'Pork Chop Plate',
    calories: 570,
    protein: 50,
    carbs: 42,
    fat: 22,
    fiber: 3,
    items: [
      { name: 'Grilled Center Cut Pork Chop', calories: 360, protein: 46, carbs: 0, fat: 19, fiber: 0 },
      { name: 'Mashed Yukon Gold Potatoes', calories: 210, protein: 4, carbs: 42, fat: 3, fiber: 3 },
    ],
  },
  {
    id: 'meal-11',
    name: 'Bodybuilder Mass Feast',
    calories: 1100,
    protein: 80,
    carbs: 83,
    fat: 50,
    fiber: 12,
    items: [
      { name: 'Double Steak Patty', calories: 620, protein: 72, carbs: 0, fat: 36, fiber: 0 },
      { name: 'Roasted Sweet Potato', calories: 330, protein: 6, carbs: 75, fat: 1, fiber: 8 },
      { name: 'Hass Avocado Mash', calories: 150, protein: 2, carbs: 8, fat: 13, fiber: 4 },
    ],
  },
  {
    id: 'meal-12',
    name: 'Mega Bulking Combo',
    calories: 1250,
    protein: 78,
    carbs: 126,
    fat: 46,
    fiber: 10,
    items: [
      { name: 'Roasted Chicken Breast', calories: 420, protein: 65, carbs: 0, fat: 16, fiber: 0 },
      { name: 'Basmati Rice Platter', calories: 530, protein: 10, carbs: 116, fat: 2, fiber: 4 },
      { name: 'Olive Oil and Guacamole', calories: 300, protein: 3, carbs: 10, fat: 28, fiber: 6 },
    ],
  },
];

export type RoutingOutcome =
  | 'staged on device'
  | 'AI called (forceAi true)'
  | 'AI called (forceAi false)'
  | 'Quick Log prefill'
  | 'disabled with reason';

/**
 * Derives expected routing outcome from expected grade and shape,
 * mirroring exact routing logic in src/components/nutrition/useNutritionAi.ts:
 * - on_device mode: lines 201-229
 * - always_ai mode: lines 231-267, 328-336
 * - auto mode: lines 268-309, 332-337
 */
export function getExpectedRouting(
  grade: 'exact' | 'lenient' | 'partial' | 'none',
  isSingle: boolean,
  mode: 'auto' | 'always_ai' | 'on_device',
  isOnline: boolean,
  family?: string
): RoutingOutcome {
  if (mode === 'on_device') {
    // lines 201-229
    if (grade === 'exact') return 'staged on device';
    if (grade === 'lenient' && isSingle) return 'staged on device';
    return 'Quick Log prefill';
  }

  if (mode === 'always_ai') {
    // lines 231-267
    if (isOnline) return 'AI called (forceAi true)';
    if (grade === 'exact') return 'staged on device';
    if (grade === 'lenient' && isSingle) return 'staged on device';
    if (grade === 'partial') return 'Quick Log prefill';
    return 'disabled with reason';
  }

  // mode === 'auto' (lines 268-309)
  if (grade === 'exact') return 'staged on device';
  if (!isOnline) {
    if (grade === 'lenient' && isSingle) return 'staged on device';
    if (grade === 'partial') return 'Quick Log prefill';
    return 'disabled with reason';
  }
  // B1: in auto mode online, noise-only lenient text (e.g. prose_wrap) is staged locally on device
  if (family === 'prose_wrap' && grade === 'lenient' && isSingle) {
    return 'staged on device';
  }
  return 'AI called (forceAi false)';
}

export interface RenderedCase {
  family: string;
  meal: KnownMeal;
  text: string;
  expectedGrade: 'exact' | 'lenient' | 'partial' | 'none';
  expectedCalories: number;
  expectedProtein: number;
  expectedCarbs: number;
  expectedFat: number;
  expectedFiber: number;
  isSingle: boolean;
}

/**
 * Renders each known meal into format families.
 * Expected results:
 * - Ranges -> midpoint, lenient
 * - Tables / Subtotals -> items counted once
 * - Thousands separators -> full value exact
 */
export function generateSweepCases(meals: KnownMeal[]): RenderedCase[] {
  const cases: RenderedCase[] = [];

  for (const meal of meals) {
    // 1. chat_bullets
    cases.push({
      family: 'chat_bullets',
      meal,
      text: `${meal.name}\n* Calories: ${meal.calories} kcal\n* Protein: ${meal.protein}g\n* Carbs: ${meal.carbs}g\n* Fat: ${meal.fat}g\n* Fiber: ${meal.fiber}g`,
      expectedGrade: 'exact',
      expectedCalories: meal.calories,
      expectedProtein: meal.protein,
      expectedCarbs: meal.carbs,
      expectedFat: meal.fat,
      expectedFiber: meal.fiber,
      isSingle: true,
    });

    // 2. bold_headers
    cases.push({
      family: 'bold_headers',
      meal,
      text: `${meal.name}\n**Calories:** ${meal.calories} kcal\n**Protein:** ${meal.protein}g\n**Carbs:** ${meal.carbs}g\n**Fat:** ${meal.fat}g`,
      expectedGrade: 'exact',
      expectedCalories: meal.calories,
      expectedProtein: meal.protein,
      expectedCarbs: meal.carbs,
      expectedFat: meal.fat,
      expectedFiber: 0,
      isSingle: true,
    });

    // 3. total_block (Total Calories/Protein/Carbs/Fat)
    cases.push({
      family: 'total_block',
      meal,
      text: `${meal.name}\nTotal Calories: ${meal.calories} kcal\nTotal Protein: ${meal.protein} g\nTotal Carbs: ${meal.carbs} g\nTotal Fat: ${meal.fat} g`,
      expectedGrade: 'exact',
      expectedCalories: meal.calories,
      expectedProtein: meal.protein,
      expectedCarbs: meal.carbs,
      expectedFat: meal.fat,
      expectedFiber: 0,
      isSingle: true,
    });

    // 4. markdown_table with Total row
    const tableHeader = '| Item | Calories | Protein | Carbs | Fat |\n| --- | --- | --- | --- | --- |\n';
    const tableRows = meal.items
      .map((it) => `| ${it.name} | ${it.calories} | ${it.protein} | ${it.carbs} | ${it.fat} |`)
      .join('\n');
    const tableTotal = `\n| Total | ${meal.calories} | ${meal.protein} | ${meal.carbs} | ${meal.fat} |`;
    cases.push({
      family: 'markdown_table',
      meal,
      text: `${tableHeader}${tableRows}${tableTotal}`,
      expectedGrade: 'exact',
      expectedCalories: meal.calories,
      expectedProtein: meal.protein,
      expectedCarbs: meal.carbs,
      expectedFat: meal.fat,
      expectedFiber: 0,
      isSingle: false,
    });

    // 5. label_per_serving
    cases.push({
      family: 'label_per_serving',
      meal,
      text: `${meal.name}\nServing size: 1 serving\nCalories ${meal.calories}\nProtein ${meal.protein}g\nTotal Carbohydrate ${meal.carbs}g\nTotal Fat ${meal.fat}g`,
      expectedGrade: 'exact',
      expectedCalories: meal.calories,
      expectedProtein: meal.protein,
      expectedCarbs: meal.carbs,
      expectedFat: meal.fat,
      expectedFiber: 0,
      isSingle: true,
    });

    // 6. kj
    const kjVal = Math.round(meal.calories * 4.184);
    cases.push({
      family: 'kj',
      meal,
      text: `${meal.name}\nEnergy: ${kjVal} kJ / ${meal.calories} kcal\nProtein: ${meal.protein}g\nCarbs: ${meal.carbs}g\nFat: ${meal.fat}g`,
      expectedGrade: 'exact',
      expectedCalories: meal.calories,
      expectedProtein: meal.protein,
      expectedCarbs: meal.carbs,
      expectedFat: meal.fat,
      expectedFiber: 0,
      isSingle: true,
    });

    // 7. ranges (midpoint, lenient)
    cases.push({
      family: 'ranges',
      meal,
      text: `${meal.name}\nCalories: ${meal.calories - 50}-${meal.calories + 50} kcal\nProtein: ${meal.protein - 4}-${meal.protein + 4}g\nCarbs: ${meal.carbs - 6}-${meal.carbs + 6}g\nFat: ${meal.fat - 2}-${meal.fat + 2}g`,
      expectedGrade: 'lenient',
      expectedCalories: meal.calories,
      expectedProtein: meal.protein,
      expectedCarbs: meal.carbs,
      expectedFat: meal.fat,
      expectedFiber: 0,
      isSingle: true,
    });

    // 8. thousands_separators (meals >= 1000 kcal only: exact with full value)
    if (meal.calories >= 1000) {
      cases.push({
        family: 'thousands_separators',
        meal,
        text: `${meal.name}\nCalories: ${meal.calories.toLocaleString('en-US')} kcal\nProtein: ${meal.protein}g\nCarbs: ${meal.carbs}g\nFat: ${meal.fat}g`,
        expectedGrade: 'exact',
        expectedCalories: meal.calories,
        expectedProtein: meal.protein,
        expectedCarbs: meal.carbs,
        expectedFat: meal.fat,
        expectedFiber: 0,
        isSingle: true,
      });
    }

    // 9. emoji_bullets (emoji bullets accepted)
    cases.push({
      family: 'emoji_bullets',
      meal,
      text: `${meal.name}\n🔥 Calories: ${meal.calories}\n💪 Protein: ${meal.protein}g\n🌾 Carbs: ${meal.carbs}g\n🥑 Fat: ${meal.fat}g`,
      expectedGrade: 'exact',
      expectedCalories: meal.calories,
      expectedProtein: meal.protein,
      expectedCarbs: meal.carbs,
      expectedFat: meal.fat,
      expectedFiber: 0,
      isSingle: true,
    });

    // 10. crlf
    cases.push({
      family: 'crlf',
      meal,
      text: `${meal.name}\r\nCalories: ${meal.calories} kcal\r\nProtein: ${meal.protein}g\r\nCarbs: ${meal.carbs}g\r\nFat: ${meal.fat}g`,
      expectedGrade: 'exact',
      expectedCalories: meal.calories,
      expectedProtein: meal.protein,
      expectedCarbs: meal.carbs,
      expectedFat: meal.fat,
      expectedFiber: 0,
      isSingle: true,
    });

    // 11. prose_wrap (noise lines wrapped -> lenient)
    cases.push({
      family: 'prose_wrap',
      meal,
      text: `Here is the nutritional breakdown for your meal:\n${meal.name}\nCalories: ${meal.calories} kcal\nProtein: ${meal.protein}g\nCarbs: ${meal.carbs}g\nFat: ${meal.fat}g\nNote: nutritional values are estimates based on standard portions.`,
      expectedGrade: 'lenient',
      expectedCalories: meal.calories,
      expectedProtein: meal.protein,
      expectedCarbs: meal.carbs,
      expectedFat: meal.fat,
      expectedFiber: 0,
      isSingle: true,
    });

    // 12. fenced_yourbody (External prompt format, exact)
    cases.push({
      family: 'fenced_yourbody',
      meal,
      text: `The assistant tracked your meal.\n\`\`\`yourbody-v1\n${meal.name}\nCalories: ${meal.calories} kcal\nProtein: ${meal.protein}g\nCarbs: ${meal.carbs}g\nFat: ${meal.fat}g\n\`\`\`\nHope this helps!`,
      expectedGrade: 'exact',
      expectedCalories: meal.calories,
      expectedProtein: meal.protein,
      expectedCarbs: meal.carbs,
      expectedFat: meal.fat,
      expectedFiber: 0,
      isSingle: true,
    });

    // 13. one_liner
    cases.push({
      family: 'one_liner',
      meal,
      text: `${meal.name}: ${meal.calories} kcal, ${meal.protein}g P, ${meal.carbs}g C, ${meal.fat}g F`,
      expectedGrade: 'exact',
      expectedCalories: meal.calories,
      expectedProtein: meal.protein,
      expectedCarbs: meal.carbs,
      expectedFat: meal.fat,
      expectedFiber: 0,
      isSingle: true,
    });

    // 14. multi_item_with_total
    const multiItemsText = meal.items
      .map((it) => `- ${it.name}: ${it.calories} kcal | ${it.protein}g P | ${it.carbs}g C | ${it.fat}g F`)
      .join('\n');
    cases.push({
      family: 'multi_item_with_total',
      meal,
      text: `Food: ${meal.name}\n${multiItemsText}\nTotal Calories: ${meal.calories} kcal`,
      expectedGrade: 'exact',
      expectedCalories: meal.calories,
      expectedProtein: meal.protein,
      expectedCarbs: meal.carbs,
      expectedFat: meal.fat,
      expectedFiber: meal.fiber,
      isSingle: false,
    });

    // 15. multi_item_without_totals
    cases.push({
      family: 'multi_item_without_totals',
      meal,
      text: `Food: ${meal.name}\n${multiItemsText}`,
      expectedGrade: 'exact',
      expectedCalories: meal.calories,
      expectedProtein: meal.protein,
      expectedCarbs: meal.carbs,
      expectedFat: meal.fat,
      expectedFiber: meal.fiber,
      isSingle: false,
    });

    // 16. multi_item_with_subtotal (Subtotal cross-check only, items counted once)
    const subtotalLine = `- Subtotal: ${meal.calories} kcal | ${meal.protein}g P | ${meal.carbs}g C | ${meal.fat}g F`;
    cases.push({
      family: 'multi_item_with_subtotal',
      meal,
      text: `Food: ${meal.name}\n${multiItemsText}\n${subtotalLine}`,
      expectedGrade: 'exact',
      expectedCalories: meal.calories,
      expectedProtein: meal.protein,
      expectedCarbs: meal.carbs,
      expectedFat: meal.fat,
      expectedFiber: meal.fiber,
      isSingle: false,
    });
  }

  return cases;
}

describe('nutrition parser deterministic sweep', () => {
  const allCases = generateSweepCases(KNOWN_MEALS);

  const mockUserId = 'user-sweep-committable';
  const setStatus = vi.fn();
  const setIsError = vi.fn();
  const onParsedSuccess = vi.fn();
  const onFallbackToManual = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
  });

  async function executeRouting(
    text: string,
    mode: 'auto' | 'always_ai' | 'on_device',
    isOnline: boolean
  ): Promise<RoutingOutcome> {
    vi.clearAllMocks();
    let hasError = false;

    setStatus.mockImplementation(() => {});
    setIsError.mockImplementation((err: boolean) => {
      hasError = err;
    });

    Object.defineProperty(navigator, 'onLine', {
      value: isOnline,
      configurable: true,
      writable: true,
    });

    const { result, unmount } = renderHook(() =>
      useNutritionAi({
        customDishes: [],
        targetUserId: mockUserId,
        onParsedSuccess,
        onFallbackToManual,
        setStatus,
        setIsError,
        parserMode: mode,
      })
    );

    act(() => {
      result.current.setNlInput(text);
    });

    await act(async () => {
      await result.current.handleAnalyze();
    });

    let outcome: RoutingOutcome = 'disabled with reason';
    const mockParseCalls = vi.mocked(parseNutrition).mock.calls;

    if (mockParseCalls.length > 0) {
      const callOptions = mockParseCalls[0][0];
      outcome = callOptions.forceAi ? 'AI called (forceAi true)' : 'AI called (forceAi false)';
    } else if (onParsedSuccess.mock.calls.length > 0) {
      outcome = 'staged on device';
    } else if (onFallbackToManual.mock.calls.length > 0) {
      outcome = 'Quick Log prefill';
    } else if (hasError) {
      outcome = 'disabled with reason';
    }

    unmount();
    return outcome;
  }

  // Generate a distinct test for each case
  allCases.forEach((testCase) => {
    it(`[${testCase.family}] ${testCase.meal.name}`, async () => {
      const localResult = parseNutritionText(testCase.text);
      const parsedCal = localResult.meal?.calories ?? 0;
      const parsedP = localResult.meal?.protein ?? 0;
      const parsedC = localResult.meal?.carbs ?? 0;
      const parsedF = localResult.meal?.fat ?? 0;

      let failureReason = '';

      if (localResult.confidence !== testCase.expectedGrade) {
        failureReason = `Grade mismatch: expected "${testCase.expectedGrade}", got "${localResult.confidence}" (reason: ${localResult.reason || 'none'})`;
      } else if (Math.abs(parsedCal - testCase.expectedCalories) > 1) {
        failureReason = `Calorie mismatch: expected ${testCase.expectedCalories}, got ${parsedCal}`;
      } else if (Math.abs(parsedP - testCase.expectedProtein) > 0.5) {
        failureReason = `Protein mismatch: expected ${testCase.expectedProtein}g, got ${parsedP}g`;
      } else if (Math.abs(parsedC - testCase.expectedCarbs) > 0.5) {
        failureReason = `Carbs mismatch: expected ${testCase.expectedCarbs}g, got ${parsedC}g`;
      } else if (Math.abs(parsedF - testCase.expectedFat) > 0.5) {
        failureReason = `Fat mismatch: expected ${testCase.expectedFat}g, got ${parsedF}g`;
      }

      // Check routing if parser passed
      if (!failureReason) {
        for (const mode of ['auto', 'always_ai', 'on_device'] as const) {
          for (const isOnline of [true, false]) {
            const expectedRouting = getExpectedRouting(
              testCase.expectedGrade,
              testCase.isSingle,
              mode,
              isOnline,
              testCase.family
            );
            const actualRouting = await executeRouting(testCase.text, mode, isOnline);
            if (actualRouting !== expectedRouting) {
              failureReason = `Routing mismatch [${mode}, ${isOnline ? 'online' : 'offline'}]: expected "${expectedRouting}", got "${actualRouting}"`;
              break;
            }
          }
          if (failureReason) break;
        }
      }

      if (failureReason) {
        expect.fail(failureReason);
      } else {
        expect(localResult.confidence).toBe(testCase.expectedGrade);
        expect(Math.abs(parsedCal - testCase.expectedCalories)).toBeLessThanOrEqual(1);
      }
    });
  });
});
