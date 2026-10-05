import { describe, expect, it } from 'vitest';
import {
  LOCAL_PARSE_GRAMMAR_DOC,
  type LocalParseRejectReason,
  parseNutritionBlock,
} from './localParse';

describe('LOCAL_PARSE_GRAMMAR_DOC export', () => {
  it('exports grammar documentation under 40 lines', () => {
    expect(LOCAL_PARSE_GRAMMAR_DOC).toBeDefined();
    expect(typeof LOCAL_PARSE_GRAMMAR_DOC).toBe('string');
    const lineCount = LOCAL_PARSE_GRAMMAR_DOC.split('\n').length;
    expect(lineCount).toBeLessThanOrEqual(40);
    expect(LOCAL_PARSE_GRAMMAR_DOC).toContain('D-OFF-6');
    expect(LOCAL_PARSE_GRAMMAR_DOC).toContain('Calories');
    expect(LOCAL_PARSE_GRAMMAR_DOC).toContain('Protein');
    expect(LOCAL_PARSE_GRAMMAR_DOC).toContain('Carbs');
    expect(LOCAL_PARSE_GRAMMAR_DOC).toContain('Fat');
  });
});

interface PositiveTestCase {
  why: string;
  input: string;
  expected: {
    name?: string;
    servingSize?: number;
    servingUnit?: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber?: number;
  };
}

const POSITIVE_TEST_CASES: PositiveTestCase[] = [
  {
    why: 'US Nutrition Facts label with % DV column and sub-rows',
    input: `Nutrition Facts
8 servings per container
Serving size 1 cup (240ml)
Amount per serving
Calories 150
% Daily Value*
Total Fat 8g 10%
  Saturated Fat 3g 15%
  Trans Fat 0g
Cholesterol 20mg 7%
Sodium 120mg 5%
Total Carbohydrate 12g 4%
  Dietary Fiber 2g 8%
  Total Sugars 10g
  Includes 8g Added Sugars 16%
Protein 8g 16%`,
    expected: {
      servingSize: 1,
      servingUnit: 'cup (240ml)',
      calories: 150,
      protein: 8,
      carbs: 12,
      fat: 8,
      fiber: 2,
    },
  },
  {
    why: 'EU label with kJ + kcal (kcal wins) and per-100 g serving line',
    input: `Per 100g
Energy 1470 kJ / 350 kcal
Fat 8.5g
of which saturates 2.1g
Carbohydrate 40g
of which sugars 3.5g
Fibre 5g
Protein 30g
Salt 0.8g`,
    expected: {
      servingSize: 100,
      servingUnit: 'g',
      calories: 350,
      protein: 30,
      carbs: 40,
      fat: 8.5,
      fiber: 5,
    },
  },
  {
    why: 'EU label with space in Per 100 g line',
    input: `Per 100 g
Energy: 1470kJ / 350kcal
Fat 8.5 g
of which saturates 2.1 g
Carbohydrate 40.0 g
Protein 30.0 g`,
    expected: {
      servingSize: 100,
      servingUnit: 'g',
      calories: 350,
      protein: 30,
      carbs: 40,
      fat: 8.5,
    },
  },
  {
    why: 'EU label kcal first followed by kJ',
    input: `Energy 350 kcal / 1470 kJ
Fat 8g
Carbohydrates 40g
Protein 30g`,
    expected: {
      calories: 350,
      protein: 30,
      carbs: 40,
      fat: 8,
    },
  },
  {
    why: "website copy ('Calories: 350, Protein: 30g, Carbs: 40g, Fat: 8g')",
    input: 'Calories: 350, Protein: 30g, Carbs: 40g, Fat: 8g',
    expected: {
      calories: 350,
      protein: 30,
      carbs: 40,
      fat: 8,
    },
  },
  {
    why: 'website copy multi-line with colons',
    input: `Calories: 350
Protein: 30g
Carbs: 40g
Fat: 8g`,
    expected: {
      calories: 350,
      protein: 30,
      carbs: 40,
      fat: 8,
    },
  },
  {
    why: 'compact pipe form',
    input: '350 kcal | 30g protein | 40g carbs | 8g fat',
    expected: {
      calories: 350,
      protein: 30,
      carbs: 40,
      fat: 8,
    },
  },
  {
    why: 'compact pipe form with optional fiber',
    input: '350 kcal | 30g protein | 40g carbs | 8g fat | 5g fiber',
    expected: {
      calories: 350,
      protein: 30,
      carbs: 40,
      fat: 8,
      fiber: 5,
    },
  },
  {
    why: 'compact pipe form with ignorable sub-row',
    input: 'Calories: 350 | Fat: 8g | Sat Fat: 2g | Carbs: 40g | Protein: 30g',
    expected: {
      calories: 350,
      protein: 30,
      carbs: 40,
      fat: 8,
    },
  },
  {
    why: 'compact semicolon form',
    input: 'Calories: 350; Protein: 30g; Carbs: 40g; Fat: 8g',
    expected: {
      calories: 350,
      protein: 30,
      carbs: 40,
      fat: 8,
    },
  },
  {
    why: 'compact slash form',
    input: '350 kcal / 30g protein / 40g carbs / 8g fat',
    expected: {
      calories: 350,
      protein: 30,
      carbs: 40,
      fat: 8,
    },
  },
  {
    why: 'compact middle dot form',
    input: '350 kcal · 30g protein · 40g carbs · 8g fat',
    expected: {
      calories: 350,
      protein: 30,
      carbs: 40,
      fat: 8,
    },
  },
  {
    why: "lifter shorthand 'P30 C40 F8 350kcal'",
    input: 'P30 C40 F8 350kcal',
    expected: {
      calories: 350,
      protein: 30,
      carbs: 40,
      fat: 8,
    },
  },
  {
    why: "lifter shorthand '350kcal P30 C40 F8'",
    input: '350kcal P30 C40 F8',
    expected: {
      calories: 350,
      protein: 30,
      carbs: 40,
      fat: 8,
    },
  },
  {
    why: "lifter shorthand reversed '30P 40C 8F 350kcal'",
    input: '30P 40C 8F 350kcal',
    expected: {
      calories: 350,
      protein: 30,
      carbs: 40,
      fat: 8,
    },
  },
  {
    why: "comma decimals ('Fat 8,5 g')",
    input: `Calories 356,5 kcal
Protein 30,0 g
Carbohydrates 40,0 g
Fat 8,5 g`,
    expected: {
      calories: 356.5,
      protein: 30,
      carbs: 40,
      fat: 8.5,
    },
  },
  {
    why: 'comma decimals in website copy with comma separator',
    input: 'Calories: 356,5, Protein: 30,0g, Carbs: 40,0g, Fat: 8,5g',
    expected: {
      calories: 356.5,
      protein: 30,
      carbs: 40,
      fat: 8.5,
    },
  },
  {
    why: 'name line + serving line',
    input: `Whey Isolate Chocolate
Serving size: 1 scoop (30g)
Calories: 120
Protein: 25g
Carbs: 2g
Fat: 1g`,
    expected: {
      name: 'Whey Isolate Chocolate',
      servingSize: 1,
      servingUnit: 'scoop (30g)',
      calories: 120,
      protein: 25,
      carbs: 2,
      fat: 1,
    },
  },
  {
    why: 'name line without serving line',
    input: `Grilled Salmon Fillet
Calories: 280
Protein: 34g
Carbs: 0g
Fat: 15g`,
    expected: {
      name: 'Grilled Salmon Fillet',
      calories: 280,
      protein: 34,
      carbs: 0,
      fat: 15,
    },
  },
  {
    why: "single-dish name 'Big Mac'",
    input: `Big Mac
Calories: 590
Protein: 25g
Carbs: 46g
Fat: 34g`,
    expected: {
      name: 'Big Mac',
      calories: 590,
      protein: 25,
      carbs: 46,
      fat: 34,
    },
  },
  {
    why: "single-dish name 'Greek yogurt'",
    input: `Greek yogurt
Calories: 130
Protein: 15g
Carbs: 9g
Fat: 4g`,
    expected: {
      name: 'Greek yogurt',
      calories: 130,
      protein: 15,
      carbs: 9,
      fat: 4,
    },
  },
  {
    why: "single-dish name 'Chicken tikka masala'",
    input: `Chicken tikka masala
Calories: 450
Protein: 35g
Carbs: 18g
Fat: 26g`,
    expected: {
      name: 'Chicken tikka masala',
      calories: 450,
      protein: 35,
      carbs: 18,
      fat: 26,
    },
  },
  {
    why: 'Fibre British spelling',
    input: `Calories: 350
Protein: 30g
Carbohydrates: 40g
Fat: 8g
Fibre: 6g`,
    expected: {
      calories: 350,
      protein: 30,
      carbs: 40,
      fat: 8,
      fiber: 6,
    },
  },
  {
    why: 'Dietary Fibre British spelling',
    input: `Calories: 350
Protein: 30g
Carbs: 40g
Fat: 8g
Dietary Fibre 6g`,
    expected: {
      calories: 350,
      protein: 30,
      carbs: 40,
      fat: 8,
      fiber: 6,
    },
  },
  {
    why: 'Per serving line format',
    input: `Per serving
Calories: 220
Protein: 15g
Carbs: 25g
Fat: 6g`,
    expected: {
      servingSize: 1,
      servingUnit: 'serving',
      calories: 220,
      protein: 15,
      carbs: 25,
      fat: 6,
    },
  },
  {
    why: 'Label with extensive vitamins and minerals rows ignored',
    input: `Calories: 200
Fat: 5g
Carbs: 20g
Protein: 15g
Vitamin D 2mcg 10%
Calcium 260mg 20%
Iron 8mg 45%
Potassium 300mg 6%`,
    expected: {
      calories: 200,
      protein: 15,
      carbs: 20,
      fat: 5,
    },
  },
  {
    why: 'All-zero macro meal (e.g. Diet Soda)',
    input: `Diet Soda
Calories: 0
Fat: 0g
Carbs: 0g
Protein: 0g`,
    expected: {
      name: 'Diet Soda',
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
    },
  },
  {
    why: 'Chicken breast high-protein label',
    input: `Chicken Breast
Serving: 100g
Calories: 165
Protein: 31g
Carbs: 0g
Fat: 3.6g`,
    expected: {
      name: 'Chicken Breast',
      servingSize: 100,
      servingUnit: 'g',
      calories: 165,
      protein: 31,
      carbs: 0,
      fat: 3.6,
    },
  },
];

interface NegativeTestCase {
  why: string;
  input: string;
  expectedReason?: LocalParseRejectReason;
}

const NEGATIVE_TEST_CASES: NegativeTestCase[] = [
  // Conjunction and multiple food markers in NAME line
  {
    why: "name line with 'and' conjunction ('Chicken breast and a banana')",
    input: `Chicken breast and a banana
Calories 350
Protein 30g
Carbs 40g
Fat 8g`,
    expectedReason: 'NAME_MULTIPLE_ITEMS',
  },
  {
    why: "name line with 'with' conjunction ('Chicken with rice')",
    input: `Chicken with rice
Calories: 350
Protein: 30g
Carbs: 40g
Fat: 8g`,
    expectedReason: 'NAME_MULTIPLE_ITEMS',
  },
  {
    why: "name line with '&' conjunction ('Eggs & Toast')",
    input: `Eggs & Toast
Calories: 300
Protein: 20g
Carbs: 25g
Fat: 12g`,
    expectedReason: 'NAME_MULTIPLE_ITEMS',
  },
  {
    why: "name line with comma list ('Steak, potatoes, asparagus')",
    input: `Steak, potatoes, asparagus
Calories: 500
Protein: 45g
Carbs: 30g
Fat: 20g`,
    expectedReason: 'NAME_MULTIPLE_ITEMS',
  },
  {
    why: "name line with '+' marker ('Oatmeal + protein powder')",
    input: `Oatmeal + protein powder
Calories: 350
Protein: 30g
Carbs: 45g
Fat: 5g`,
    expectedReason: 'NAME_MULTIPLE_ITEMS',
  },
  {
    why: "name line with '/' marker ('Burger / Fries')",
    input: `Burger / Fries
Calories: 600
Protein: 25g
Carbs: 65g
Fat: 28g`,
    expectedReason: 'NAME_MULTIPLE_ITEMS',
  },
  {
    why: "name line with ';' marker ('Soup; salad')",
    input: `Soup; salad
Calories: 250
Protein: 10g
Carbs: 35g
Fat: 8g`,
    expectedReason: 'NAME_MULTIPLE_ITEMS',
  },
  {
    why: "name line with 'plus' marker ('Steak plus salad')",
    input: `Steak plus salad
Calories: 450
Protein: 40g
Carbs: 10g
Fat: 28g`,
    expectedReason: 'NAME_MULTIPLE_ITEMS',
  },

  // Prose and conversational input
  {
    why: "prose ('I had chicken and rice')",
    input: 'I had chicken and rice',
    expectedReason: 'NOT_A_NUTRITION_BLOCK',
  },
  {
    why: 'prose conversation with meal details',
    input: 'Today for lunch I ate a chicken sandwich with mayonnaise and french fries',
    expectedReason: 'NOT_A_NUTRITION_BLOCK',
  },
  {
    why: 'two foods with numbers (multi-line)',
    input: `Chicken breast: 200 kcal, 30g protein, 0g carbs, 5g fat
White rice: 150 kcal, 3g protein, 35g carbs, 1g fat`,
    expectedReason: 'SECOND_CALORIES_LINE',
  },
  {
    why: 'two foods with numbers (single line)',
    input: 'Chicken 200 kcal 30g P 0g C 5g F and Rice 150 kcal 3g P 35g C 1g F',
    expectedReason: 'UNEXPLAINED_CONTENT',
  },
  {
    why: "one food with numbers + one without ('chicken 30g protein and a banana')",
    input: 'chicken 30g protein and a banana',
    expectedReason: 'UNEXPLAINED_CONTENT',
  },
  {
    why: 'one food with numbers + one without (multi-line with leftover item)',
    input: `Calories: 350
Protein: 30g
Carbs: 40g
Fat: 8g
and a banana`,
    expectedReason: 'UNEXPLAINED_CONTENT',
  },

  // Missing macros
  {
    why: 'missing calories macro',
    input: 'Protein: 30g, Carbs: 40g, Fat: 8g',
    expectedReason: 'MISSING_MACRO',
  },
  {
    why: 'missing protein macro',
    input: 'Calories: 350, Carbs: 40g, Fat: 8g',
    expectedReason: 'MISSING_MACRO',
  },
  {
    why: 'missing carbs macro',
    input: 'Calories: 350, Protein: 30g, Fat: 8g',
    expectedReason: 'MISSING_MACRO',
  },
  {
    why: 'missing fat macro',
    input: 'Calories: 350, Protein: 30g, Carbs: 40g',
    expectedReason: 'MISSING_MACRO',
  },
  {
    why: "compact without fat ('Calories 350 Protein 30 Carbs 40')",
    input: 'Calories 350 Protein 30 Carbs 40',
    expectedReason: 'MISSING_MACRO',
  },

  // Energy units
  {
    why: 'kJ only without kcal',
    input: `Energy 1470 kJ
Protein: 30g
Carbs: 40g
Fat: 8g`,
    expectedReason: 'KJ_WITHOUT_KCAL',
  },
  {
    why: 'kJ only in Calories line',
    input: `Calories: 1470 kJ
Protein: 30g
Carbs: 40g
Fat: 8g`,
    expectedReason: 'KJ_WITHOUT_KCAL',
  },

  // Invalid macro units
  {
    why: 'mg units for protein macro',
    input: 'Calories: 350, Protein: 30000mg, Carbs: 40g, Fat: 8g',
    expectedReason: 'INVALID_MACRO_UNIT',
  },
  {
    why: 'mg units for carbs macro',
    input: 'Calories: 350, Protein: 30g, Carbs: 5000mg, Fat: 8g',
    expectedReason: 'INVALID_MACRO_UNIT',
  },
  {
    why: 'oz units for fat macro',
    input: 'Calories: 350, Protein: 30g, Carbs: 40g, Fat: 1oz',
    expectedReason: 'INVALID_MACRO_UNIT',
  },
  {
    why: 'oz units for protein macro',
    input: 'Calories: 350, Protein: 2oz, Carbs: 40g, Fat: 8g',
    expectedReason: 'INVALID_MACRO_UNIT',
  },
  {
    why: 'kg units for protein macro',
    input: 'Calories: 350, Protein: 0.03kg, Carbs: 40g, Fat: 8g',
    expectedReason: 'INVALID_MACRO_UNIT',
  },

  // Duplicate macros and second calories lines
  {
    why: 'duplicated macro with different values (protein 30g and 25g)',
    input: 'Calories: 350, Protein: 30g, Carbs: 40g, Fat: 8g, Protein: 25g',
    expectedReason: 'DUPLICATE_MACRO',
  },
  {
    why: 'duplicated macro with different values (fat 8g and 12g multi-line)',
    input: `Calories: 350
Protein: 30g
Carbs: 40g
Fat: 8g
Total Fat: 12g`,
    expectedReason: 'DUPLICATE_MACRO',
  },
  {
    why: 'second calories line with same value',
    input: `Calories 350
Protein 30g
Carbs 40g
Fat 8g
Calories 350`,
    expectedReason: 'SECOND_CALORIES_LINE',
  },
  {
    why: 'second calories line with different value',
    input: `Calories 350
Protein 30g
Carbs 40g
Fat 8g
Calories 200`,
    expectedReason: 'SECOND_CALORIES_LINE',
  },

  // Kcal consistency
  {
    why: 'inconsistent kcal: too low (>25% and >60 kcal off)',
    input: 'Calories: 100, Protein: 30g, Carbs: 40g, Fat: 8g',
    expectedReason: 'KCAL_INCONSISTENT',
  },
  {
    why: 'inconsistent kcal: too high (>25% and >60 kcal off)',
    input: 'Calories: 700, Protein: 30g, Carbs: 40g, Fat: 8g',
    expectedReason: 'KCAL_INCONSISTENT',
  },

  // Numeric bounds
  {
    why: 'calories out of range (> 5000 kcal)',
    input: 'Calories: 6000, Protein: 30g, Carbs: 40g, Fat: 8g',
    expectedReason: 'VALUE_OUT_OF_RANGE',
  },
  {
    why: 'calories out of range (negative value)',
    input: 'Calories: -50, Protein: 30g, Carbs: 40g, Fat: 8g',
    expectedReason: 'VALUE_OUT_OF_RANGE',
  },
  {
    why: 'protein out of range (> 500 g)',
    input: 'Calories: 2500, Protein: 550g, Carbs: 40g, Fat: 8g',
    expectedReason: 'VALUE_OUT_OF_RANGE',
  },
  {
    why: 'fat out of range (> 500 g)',
    input: 'Calories: 4500, Protein: 30g, Carbs: 40g, Fat: 510g',
    expectedReason: 'VALUE_OUT_OF_RANGE',
  },
  {
    why: 'carbs out of range (> 500 g)',
    input: 'Calories: 2500, Protein: 30g, Carbs: 550g, Fat: 8g',
    expectedReason: 'VALUE_OUT_OF_RANGE',
  },

  // Digits in name line
  {
    why: 'a name line containing digits',
    input: `Chicken 123
Calories: 350
Protein: 30g
Carbs: 40g
Fat: 8g`,
    expectedReason: 'NAME_CONTAINS_DIGITS',
  },
  {
    why: 'a name line containing digits in brand title',
    input: `Protein Bar 2
Calories: 200
Protein: 20g
Carbs: 20g
Fat: 5g`,
    expectedReason: 'NAME_CONTAINS_DIGITS',
  },

  // Leftover words
  {
    why: "leftover words ('with rice') on the same line",
    input: 'Calories: 350, Protein: 30g, Carbs: 40g, Fat: 8g with rice',
    expectedReason: 'UNEXPLAINED_CONTENT',
  },
  {
    why: "leftover words ('with rice') on a separate line",
    input: `Calories: 350
Protein: 30g
Carbs: 40g
Fat: 8g
with rice`,
    expectedReason: 'UNEXPLAINED_CONTENT',
  },

  // Empty / non-nutrition
  {
    why: 'empty string input',
    input: '',
    expectedReason: 'EMPTY_INPUT',
  },
  {
    why: 'whitespace only input',
    input: '   \n\t  \n  ',
    expectedReason: 'EMPTY_INPUT',
  },
  {
    why: 'recipe ingredient list',
    input: `2 cups all-purpose flour
1 cup granulated sugar
3 large eggs
1/2 cup softened butter`,
    expectedReason: 'NOT_A_NUTRITION_BLOCK',
  },
  {
    why: 'markdown table of two foods',
    input: `| Food | Calories | Protein | Carbs | Fat |
| Chicken | 200 | 30 | 0 | 5 |
| Rice | 150 | 3 | 35 | 1 |`,
    expectedReason: 'MULTIPLE_FOODS',
  },
  {
    why: 'markdown table without macros',
    input: `| Item | Qty |
| Apple | 1 |
| Orange | 2 |`,
    expectedReason: 'MULTIPLE_FOODS',
  },
  {
    why: 'prose mentioning workout and numbers',
    input: 'I ran 5 miles today and burned 500 calories',
    expectedReason: 'NOT_A_NUTRITION_BLOCK',
  },
];

describe('parseNutritionBlock - Table-Driven Positive Cases', () => {
  it.each(POSITIVE_TEST_CASES)('accepts positive case: $why', ({ input, expected }) => {
    const result = parseNutritionBlock(input);
    expect(result.ok, `Expected parseNutritionBlock to succeed for: ${input}`).toBe(true);
    if (result.ok) {
      expect(result.meal.calories).toBe(expected.calories);
      expect(result.meal.protein).toBe(expected.protein);
      expect(result.meal.carbs).toBe(expected.carbs);
      expect(result.meal.fat).toBe(expected.fat);
      if (expected.fiber !== undefined) {
        expect(result.meal.fiber).toBe(expected.fiber);
      }
      if (expected.servingSize !== undefined) {
        expect(result.meal.servingSize).toBe(expected.servingSize);
      }
      if (expected.servingUnit !== undefined) {
        expect(result.meal.servingUnit).toBe(expected.servingUnit);
      }
      if (expected.name !== undefined) {
        expect(result.meal.name).toBe(expected.name);
      }
    }
  });
});

describe('parseNutritionBlock - Table-Driven Negative Cases', () => {
  it.each(NEGATIVE_TEST_CASES)('rejects negative case: $why', ({ input, expectedReason }) => {
    const result = parseNutritionBlock(input);
    expect(result.ok, `Expected parseNutritionBlock to reject: ${input}`).toBe(false);
    if (!result.ok && expectedReason) {
      expect(result.reason).toBe(expectedReason);
    }
  });
});

describe('Property-Style Invariant: Appending Extra Non-Blank Free Text Line Rejects', () => {
  const EXTRA_LINES = [
    'with extra rice',
    'side of french fries',
    'I ate this for dinner yesterday',
    'Notes: tasted delicious',
    'Extra sauce on the side',
  ];

  POSITIVE_TEST_CASES.forEach((testCase, testIdx) => {
    const extraLine = EXTRA_LINES[testIdx % EXTRA_LINES.length];
    it(`rejects positive case #${testIdx + 1} with appended line "${extraLine}"`, () => {
      const contaminatedInput = `${testCase.input}\n${extraLine}`;
      const result = parseNutritionBlock(contaminatedInput);
      expect(
        result.ok,
        `Expected contaminated input to be rejected:\n${contaminatedInput}`
      ).toBe(false);
      if (!result.ok) {
        expect([
          'UNEXPLAINED_CONTENT',
          'SECOND_CALORIES_LINE',
          'NAME_CONTAINS_DIGITS',
          'NAME_MULTIPLE_ITEMS',
          'NOT_A_NUTRITION_BLOCK',
        ]).toContain(result.reason);
      }
    });
  });
});

describe('Negative Control: Contrast against Naive Regex Parser', () => {
  /**
   * Naive regex parser representing standard regex-based extractors.
   * Defined only in tests to demonstrate contrast against strict parser guarantees.
   */
  function naiveRegexParse(text: string): {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  } | null {
    const calMatch = text.match(/(?:calories?[:=\s]+(\d+)|(\d+)\s*(?:kcal|cal(?:ories)?)\b)/i);
    const pMatch = text.match(/(?:protein[:=\s]+(\d+)|(\d+)\s*g?\s*(?:p(?:rotein)?)\b)/i);
    const cMatch = text.match(/(?:carbs?[:=\s]+(\d+)|(\d+)\s*g?\s*(?:c(?:arbs?)?)\b)/i);
    const fMatch = text.match(/(?:fat[:=\s]+(\d+)|(\d+)\s*g?\s*(?:f(?:at)?)\b)/i);

    if (calMatch && pMatch && cMatch && fMatch) {
      const calories = Number(calMatch[1] ?? calMatch[2]);
      const protein = Number(pMatch[1] ?? pMatch[2]);
      const carbs = Number(cMatch[1] ?? cMatch[2]);
      const fat = Number(fMatch[1] ?? fMatch[2]);
      return { calories, protein, carbs, fat };
    }
    return null;
  }

  const CONTRAST_CASES = [
    {
      label: 'Two foods with numbers mixed together',
      input: `Chicken breast: 200 kcal, 30g protein, 0g carbs, 5g fat
White rice: 150 kcal, 3g protein, 35g carbs, 1g fat`,
    },
    {
      label: 'Leftover prose words on macro line',
      input: 'Calories: 350, Protein: 30g, Carbs: 40g, Fat: 8g with rice',
    },
    {
      label: 'Inconsistent kcal (100 kcal for 30P 40C 8F)',
      input: 'Calories: 100, Protein: 30g, Carbs: 40g, Fat: 8g',
    },
    {
      label: 'Name line containing digits',
      input: `Chicken 123
Calories: 350
Protein: 30g
Carbs: 40g
Fat: 8g`,
    },
    {
      label: 'Single-line prose with mixed foods',
      input: 'Chicken 200 kcal 30g P 0g C 5g F and Rice 150 kcal 3g P 35g C 1g F',
    },
  ];

  it.each(CONTRAST_CASES)(
    'demonstrates naive regex falsely accepts but parseNutritionBlock strictly rejects: $label',
    ({ input }) => {
      // 1. Naive regex erroneously parses this invalid input
      const naiveResult = naiveRegexParse(input);
      expect(naiveResult).not.toBeNull();

      // 2. Strict parseNutritionBlock correctly rejects this input
      const strictResult = parseNutritionBlock(input);
      expect(strictResult.ok).toBe(false);
    }
  );
});
