import { describe, expect, it } from 'vitest';
import {
  parseNutritionText,
  parseNutritionBlock,
  type NutritionParseResult,
} from './localParse';

describe('Shared Nutrition Parser Core - Cleanup Cases', () => {
  it('strips leading asterisk bullets (*)', () => {
    const input = [
      '* Protein Ice Cream',
      '* Calories: 400 kcal',
      '* Protein: 40g',
      '* Carbs: 40g',
      '* Fat: 9g',
    ].join('\n');
    const result = parseNutritionText(input);
    expect(result.confidence).toBe('exact');
    expect(result.meal?.name).toBe('Protein Ice Cream');
    expect(result.meal?.calories).toBe(400);
    expect(result.meal?.protein).toBe(40);
    expect(result.meal?.carbs).toBe(40);
    expect(result.meal?.fat).toBe(9);
    expect(result.skippedLines).toEqual([]);
    expect(result.modifiers).toEqual([]);
  });

  it('strips leading dash bullets (-) followed by space', () => {
    const input = [
      '- Greek Yogurt',
      '- Calories: 130 kcal',
      '- Protein: 15g',
      '- Carbs: 6g',
      '- Fat: 5g',
    ].join('\n');
    const result = parseNutritionText(input);
    expect(result.confidence).toBe('exact');
    expect(result.meal?.name).toBe('Greek Yogurt');
    expect(result.meal?.calories).toBe(130);
    expect(result.skippedLines).toEqual([]);
  });

  it('strips leading bullet symbols (•)', () => {
    const input = [
      '• Cottage Cheese',
      '• Calories: 180 kcal',
      '• Protein: 24g',
      '• Carbs: 6g',
      '• Fat: 6g',
    ].join('\n');
    const result = parseNutritionText(input);
    expect(result.confidence).toBe('exact');
    expect(result.meal?.name).toBe('Cottage Cheese');
    expect(result.skippedLines).toEqual([]);
  });

  it('strips leading numbered list markers ("1.")', () => {
    const input = [
      '1. Turkey Breast',
      '2. Calories: 165 kcal',
      '3. Protein: 35g',
      '4. Carbs: 0g',
      '5. Fat: 2g',
    ].join('\n');
    const result = parseNutritionText(input);
    expect(result.confidence).toBe('exact');
    expect(result.meal?.name).toBe('Turkey Breast');
    expect(result.skippedLines).toEqual([]);
  });

  it('strips markdown **bold** and __bold__ markers', () => {
    const input = [
      '**Chocolate Pudding**',
      '**Calories**: 250 kcal',
      '**Protein**: 20g',
      '__Carbs__: 30g',
      '**Fat**: 5g',
    ].join('\n');
    const result = parseNutritionText(input);
    expect(result.confidence).toBe('exact');
    expect(result.meal?.name).toBe('Chocolate Pudding');
    expect(result.meal?.calories).toBe(250);
    expect(result.meal?.protein).toBe(20);
    expect(result.meal?.carbs).toBe(30);
    expect(result.meal?.fat).toBe(5);
    expect(result.skippedLines).toEqual([]);
  });

  it('strips approximation markers (~, ≈, approx., approx, approximately, about)', () => {
    const input = [
      'Vanilla Shake',
      'Calories: ~300 kcal',
      'Protein: approx. 30g',
      'Carbs: approximately 25g',
      'Fat: ≈ 8g',
    ].join('\n');
    const result = parseNutritionText(input);
    expect(result.confidence).toBe('exact');
    expect(result.meal?.calories).toBe(300);
    expect(result.meal?.protein).toBe(30);
    expect(result.meal?.carbs).toBe(25);
    expect(result.meal?.fat).toBe(8);
    expect(result.skippedLines).toEqual([]);
  });

  it('strips trailing colons on labels without content', () => {
    const input = [
      'Protein Waffles:',
      'Calories: 280 kcal',
      'Protein: 25g',
      'Carbs: 30g',
      'Fat: 6g',
    ].join('\n');
    const result = parseNutritionText(input);
    expect(result.confidence).toBe('exact');
    expect(result.meal?.name).toBe('Protein Waffles');
    expect(result.skippedLines).toEqual([]);
  });
});

describe('Representative Multi-Line Bullet Dessert Paste', () => {
  it('parses representative multi-line bullet paste of a dessert as exact with servingSize 543 g', () => {
    const input = [
      '* Protein Ice Cream',
      '* Calories: ~609 kcal',
      '* Protein: ~45g',
      '* Carbs: ~60g',
      '* Fat: ~21g',
      '* Consumed Weight: ~543g',
    ].join('\n');

    const result = parseNutritionText(input);
    expect(result.confidence).toBe('exact');
    expect(result.skippedLines).toEqual([]);
    expect(result.modifiers).toEqual([]);
    expect(result.meal).toBeDefined();
    expect(result.meal?.name).toBe('Protein Ice Cream');
    expect(result.meal?.calories).toBe(609);
    expect(result.meal?.protein).toBe(45);
    expect(result.meal?.carbs).toBe(60);
    expect(result.meal?.fat).toBe(21);
    expect(result.meal?.servingSize).toBe(543);
    expect(result.meal?.servingUnit).toBe('g');

    // On-device wrapper returns ok: true for exact confidence
    const blockResult = parseNutritionBlock(input);
    expect(blockResult.ok).toBe(true);
    if (blockResult.ok) {
      expect(blockResult.meal.servingSize).toBe(543);
      expect(blockResult.meal.servingUnit).toBe('g');
      expect(blockResult.meal.calories).toBe(609);
    }
  });

  it('handles variations: Net Weight and Weight labels with ml or oz', () => {
    const netWeightInput = [
      'Chocolate Smoothie',
      'Net Weight: 350ml',
      'Calories: 260 kcal',
      'Protein: 25g',
      'Carbs: 25g',
      'Fat: 6g',
    ].join('\n');
    const netResult = parseNutritionText(netWeightInput);
    expect(netResult.confidence).toBe('exact');
    expect(netResult.meal?.servingSize).toBe(350);
    expect(netResult.meal?.servingUnit).toBe('ml');

    const ozWeightInput = [
      'Ribeye Steak',
      'Weight: 8oz',
      'Calories: 580 kcal',
      'Protein: 50g',
      'Carbs: 0g',
      'Fat: 42g',
    ].join('\n');
    const ozResult = parseNutritionText(ozWeightInput);
    expect(ozResult.confidence).toBe('exact');
    expect(ozResult.meal?.servingSize).toBe(8);
    expect(ozResult.meal?.servingUnit).toBe('oz');
  });
});

describe('Confidence Level Matrix & Invariant Assertions', () => {
  it('confidence = exact when all lines understood and hard validations pass', () => {
    const input = `Grilled Chicken
Calories: 220 kcal
Protein: 40g
Carbs: 0g
Fat: 6g`;
    const result = parseNutritionText(input);
    expect(result.confidence).toBe('exact');
    expect(result.reason).toBeUndefined();
    expect(result.skippedLines).toEqual([]);
    expect(result.modifiers).toEqual([]);
    expect(result.meal?.calories).toBe(220);
  });

  it('confidence = lenient when lines are skipped, asserting skippedLines', () => {
    const input = `Grilled Chicken
Calories: 220 kcal
Protein: 40g
Carbs: 0g
Fat: 6g
with extra barbecue sauce
side of jasmine rice`;
    const result = parseNutritionText(input);
    expect(result.confidence).toBe('lenient');
    expect(result.skippedLines).toEqual([
      'with extra barbecue sauce',
      'side of jasmine rice',
    ]);
    expect(result.modifiers).toEqual([]);
    expect(result.meal?.calories).toBe(220);
    expect(result.meal?.protein).toBe(40);

    // On-device wrapper returns ok: false for lenient
    const blockResult = parseNutritionBlock(input);
    expect(blockResult.ok).toBe(false);
    if (!blockResult.ok) {
      expect(blockResult.reason).toBe('UNEXPLAINED_CONTENT');
    }
  });

  it('confidence = lenient when modifiers are spotted ("ate half", "half", "x2", "two of")', () => {
    const ateHalfInput = `Grilled Steak
Calories: 500 kcal
Protein: 50g
Carbs: 10g
Fat: 28g
ate half`;
    const ateHalfResult = parseNutritionText(ateHalfInput);
    expect(ateHalfResult.confidence).toBe('lenient');
    expect(ateHalfResult.modifiers).toEqual(['ate half']);
    expect(ateHalfResult.skippedLines).toEqual([]);

    const inlineHalfInput = `Grilled Steak (half)
Calories: 500 kcal
Protein: 50g
Carbs: 10g
Fat: 28g`;
    const inlineHalfResult = parseNutritionText(inlineHalfInput);
    expect(inlineHalfResult.confidence).toBe('lenient');
    expect(inlineHalfResult.modifiers).toEqual(['half']);
    expect(inlineHalfResult.meal?.name).toBe('Grilled Steak');

    const x2Input = `Protein Bar
Calories: 200 kcal
Protein: 20g
Carbs: 20g
Fat: 5g
x2`;
    const x2Result = parseNutritionText(x2Input);
    expect(x2Result.confidence).toBe('lenient');
    expect(x2Result.modifiers).toEqual(['x2']);

    const twoOfInput = `Eggs
Calories: 140 kcal
Protein: 12g
Carbs: 1g
Fat: 10g
two of`;
    const twoOfResult = parseNutritionText(twoOfInput);
    expect(twoOfResult.confidence).toBe('lenient');
    expect(twoOfResult.modifiers).toEqual(['two of']);
  });

  it('confidence = lenient when two different weights appear (per 100g label + consumed weight)', () => {
    const input = [
      'Protein Pudding',
      'Per 100g',
      'Calories: 80 kcal',
      'Protein: 10g',
      'Carbs: 6g',
      'Fat: 1.5g',
      'Consumed Weight: ~250g',
    ].join('\n');
    const result = parseNutritionText(input);
    expect(result.confidence).toBe('lenient');
    expect(result.modifiers).toContain('per 100g');
    expect(result.skippedLines).toEqual([]);
    expect(result.meal?.servingSize).toBe(250);
    expect(result.meal?.servingUnit).toBe('g');
  });

  it('confidence = lenient when serving size and different consumed weight appear', () => {
    const input = [
      'Peanut Butter',
      'Serving size: 32g',
      'Calories: 190 kcal',
      'Protein: 8g',
      'Carbs: 7g',
      'Fat: 16g',
      'Consumed Weight: 64g',
    ].join('\n');
    const result = parseNutritionText(input);
    expect(result.confidence).toBe('lenient');
    expect(result.modifiers).toContain('per serving');
    expect(result.skippedLines).toEqual([]);
    expect(result.meal?.servingSize).toBe(64);
    expect(result.meal?.servingUnit).toBe('g');
  });

  it('confidence = partial when some but not all of the 4 macros are found', () => {
    const caloriesAndProtein = `Chicken
Calories: 200 kcal
Protein: 30g`;
    const partialResult = parseNutritionText(caloriesAndProtein);
    expect(partialResult.confidence).toBe('partial');
    expect(partialResult.reason).toBe('MISSING_MACRO');
    expect(partialResult.meal).toBeDefined();
    expect(partialResult.meal?.calories).toBe(200);
    expect(partialResult.meal?.protein).toBe(30);
    expect(partialResult.meal?.carbs).toBe(0);
    expect(partialResult.meal?.fat).toBe(0);
    expect(partialResult.foundMacros).toEqual(['calories', 'protein']);

    const carbsAndFat = 'Avocado Toast\nCarbs: 25g\nFat: 15g';
    const partial2 = parseNutritionText(carbsAndFat);
    expect(partial2.confidence).toBe('partial');
    expect(partial2.foundMacros).toEqual(['carbs', 'fat']);

    const blockResult = parseNutritionBlock(caloriesAndProtein);
    expect(blockResult.ok).toBe(false);
    if (!blockResult.ok) {
      expect(blockResult.reason).toBe('MISSING_MACRO');
    }
  });

  it('confidence = none for hard validation failures, non-nutrition text, or empty input', () => {
    expect(parseNutritionText('').confidence).toBe('none');
    expect(parseNutritionText('   \n  ').reason).toBe('EMPTY_INPUT');

    const prose = parseNutritionText('I ran 5 miles and then went to sleep');
    expect(prose.confidence).toBe('none');
    expect(prose.reason).toBe('NOT_A_NUTRITION_BLOCK');

    const outOfRange = parseNutritionText('Calories: 6000\nProtein: 30g\nCarbs: 40g\nFat: 8g');
    expect(outOfRange.confidence).toBe('none');
    expect(outOfRange.reason).toBe('VALUE_OUT_OF_RANGE');

    const inconsistent = parseNutritionText('Calories: 800\nProtein: 10g\nCarbs: 10g\nFat: 2g');
    expect(inconsistent.confidence).toBe('none');
    expect(inconsistent.reason).toBe('KCAL_INCONSISTENT');
  });
});

describe('Acceptance Guards & Property Tests (from PARSER_SPINE.md)', () => {
  const REPRESENTATIVE_POSITIVE_FIXTURES = [
    {
      label: 'Standard multi-line block',
      input: 'Chicken Breast\nCalories 200 kcal\nProtein 30g\nCarbs 0g\nFat 5g',
      expected: { calories: 200, protein: 30, carbs: 0, fat: 5 },
    },
    {
      label: 'EU label with kJ/kcal and per-100g serving',
      input: 'Per 100g\nEnergy: 1470 kJ / 350 kcal\nProtein: 30g\nCarbohydrate: 40g\nFat: 8g',
      expected: { calories: 350, protein: 30, carbs: 40, fat: 8, servingSize: 100, servingUnit: 'g' },
    },
    {
      label: 'Compact pipe-delimited format',
      input: '350 kcal | 30g protein | 40g carbs | 8g fat',
      expected: { calories: 350, protein: 30, carbs: 40, fat: 8 },
    },
    {
      label: 'Lifter whitespace shorthand',
      input: 'P30 C40 F8 350kcal',
      expected: { calories: 350, protein: 30, carbs: 40, fat: 8 },
    },
    {
      label: 'Block with fiber and ignorable sub-rows',
      input: 'Oatmeal\nCalories: 150 kcal\nProtein: 5g\nCarbs: 27g\nFat: 2.5g\nFiber: 4g\nSodium: 140mg\nSugars: 1g',
      expected: { calories: 150, protein: 5, carbs: 27, fat: 2.5, fiber: 4 },
    },
  ];

  const REPRESENTATIVE_NEGATIVE_FIXTURES = [
    { label: 'empty string', input: '' },
    { label: 'missing carbs', input: 'Calories: 200, Protein: 30g, Fat: 5g' },
    { label: 'invalid unit (mg for protein)', input: 'Calories: 350, Protein: 30000mg, Carbs: 40g, Fat: 8g' },
    { label: 'kJ without kcal', input: 'Energy 1470 kJ\nProtein: 30g\nCarbs: 40g\nFat: 8g' },
    { label: 'calories out of range', input: 'Calories: 6000\nProtein: 30g\nCarbs: 40g\nFat: 8g' },
    { label: 'kcal inconsistent', input: 'Calories: 700\nProtein: 30g\nCarbs: 40g\nFat: 8g' },
    { label: 'name contains digits', input: 'Protein Bar 2\nCalories: 200\nProtein: 20g\nCarbs: 20g\nFat: 5g' },
    { label: 'name multiple items', input: 'Steak and Salad\nCalories: 450\nProtein: 40g\nCarbs: 10g\nFat: 28g' },
    { label: 'prose conversation', input: 'I had chicken and rice for lunch today' },
    { label: 'recipe ingredients', input: '2 cups flour\n1 cup sugar\n3 eggs' },
  ];

  it('Guard 1: Every representative positive fixture parses with confidence exact', () => {
    for (const testCase of REPRESENTATIVE_POSITIVE_FIXTURES) {
      const result: NutritionParseResult = parseNutritionText(testCase.input);
      expect(
        result.confidence,
        `Expected positive case "${testCase.label}" to have exact confidence`
      ).toBe('exact');
      expect(result.skippedLines).toEqual([]);
      expect(result.modifiers).toEqual([]);
      expect(result.meal).toBeDefined();
      if (result.meal) {
        expect(result.meal.calories).toBe(testCase.expected.calories);
        expect(result.meal.protein).toBe(testCase.expected.protein);
        expect(result.meal.carbs).toBe(testCase.expected.carbs);
        expect(result.meal.fat).toBe(testCase.expected.fat);
      }
    }
  });

  it('Guard 1b: Every representative negative fixture parses with confidence not exact', () => {
    for (const testCase of REPRESENTATIVE_NEGATIVE_FIXTURES) {
      const result: NutritionParseResult = parseNutritionText(testCase.input);
      expect(
        result.confidence,
        `Expected negative case "${testCase.label}" to NOT have exact confidence`
      ).not.toBe('exact');
    }
  });

  it('Guard 2: Any skipped line forces confidence lenient and populates skippedLines', () => {
    const baseInput = `Salmon Fillet
Calories: 300 kcal
Protein: 34g
Carbs: 0g
Fat: 18g`;
    const contaminatedInput = `${baseInput}\nSpecial chef instructions: bake at 400F`;
    const result = parseNutritionText(contaminatedInput);
    expect(result.confidence).toBe('lenient');
    expect(result.skippedLines).toEqual(['Special chef instructions: bake at 400F']);
  });

  it('Guard 3: No servingSize is produced when no weight line exists', () => {
    const inputWithoutWeight = `Sirloin Steak
Calories: 350 kcal
Protein: 40g
Carbs: 0g
Fat: 21g`;
    const result = parseNutritionText(inputWithoutWeight);
    expect(result.confidence).toBe('exact');
    expect(result.meal?.servingSize).toBeUndefined();
    expect(result.meal?.servingUnit).toBeUndefined();

    for (const testCase of REPRESENTATIVE_POSITIVE_FIXTURES) {
      if (!('servingSize' in testCase.expected)) {
        const res = parseNutritionText(testCase.input);
        expect(res.meal?.servingSize).toBeUndefined();
        expect(res.meal?.servingUnit).toBeUndefined();
      }
    }
  });

  it('Guard 4: multi-item blocks are exact in parseNutritionText but rejected by parseNutritionBlock on device', () => {
    const multiItemInput = `Food: Grilled Chicken & Rice
- 200g Chicken Breast | 330 kcal | 62g P | 0g C | 7g F
- 1 cup White Rice | 205 kcal | 4g P | 45g C | 0.5g F`;

    const sharedResult = parseNutritionText(multiItemInput);
    expect(sharedResult.confidence).toBe('exact');
    expect(sharedResult.meal?.items?.length).toBe(2);

    const deviceResult = parseNutritionBlock(multiItemInput);
    expect(deviceResult.ok).toBe(false);
    if (!deviceResult.ok) {
      expect(deviceResult.reason).toBe('MULTIPLE_FOODS');
    }
  });

  describe('Fenced Code Block Extraction (P5)', () => {
    it('extracts fenced yourbody-v1 block from conversational prose with exact confidence', () => {
      const chatReply = [
        'Sure! Here is the nutritional breakdown for your lunch:',
        '```yourbody-v1',
        'Chicken Rice Bowl',
        'Calories: 520 kcal',
        'Protein: 46g',
        'Carbs: 58g',
        'Fat: 12g',
        '```',
        'Let me know if you would like me to adjust portions!',
      ].join('\n');

      const result = parseNutritionText(chatReply);
      expect(result.confidence).toBe('exact');
      expect(result.meal?.name).toBe('Chicken Rice Bowl');
      expect(result.meal?.calories).toBe(520);
      expect(result.meal?.protein).toBe(46);
      expect(result.meal?.carbs).toBe(58);
      expect(result.meal?.fat).toBe(12);
      expect(result.skippedLines).toEqual([]);
    });

    it('extracts fenced yourbody block from conversational prose', () => {
      const chatReply = [
        'I estimated your post-workout shake:',
        '```yourbody',
        'Whey Protein Shake',
        'Calories: 140 kcal',
        'Protein: 25g',
        'Carbs: 3g',
        'Fat: 2g',
        '```',
      ].join('\n');

      const result = parseNutritionText(chatReply);
      expect(result.confidence).toBe('exact');
      expect(result.meal?.name).toBe('Whey Protein Shake');
      expect(result.meal?.calories).toBe(140);
    });

    it('when multiple blocks appear, parses the content of the LAST block', () => {
      const twoBlocks = [
        'First estimate:',
        '```yourbody',
        'Single Scoop',
        'Calories: 120 kcal',
        'Protein: 24g',
        'Carbs: 2g',
        'Fat: 1g',
        '```',
        'Actually, with two scoops:',
        '```yourbody-v1',
        'Double Scoop',
        'Calories: 240 kcal',
        'Protein: 48g',
        'Carbs: 4g',
        'Fat: 2g',
        '```',
        'Hope that helps!',
      ].join('\n');

      const result = parseNutritionText(twoBlocks);
      expect(result.confidence).toBe('exact');
      expect(result.meal?.name).toBe('Double Scoop');
      expect(result.meal?.calories).toBe(240);
      expect(result.meal?.protein).toBe(48);
    });

    it('applies confidence rules to the block content when block is malformed (never on surrounding prose)', () => {
      const partialBlock = [
        'Here is your meal calculation:',
        '```yourbody-v1',
        'Protein Snack',
        'Calories: 150 kcal',
        'Protein: 20g',
        '```',
        'I could not determine carbs or fat values.',
      ].join('\n');

      const result = parseNutritionText(partialBlock);
      expect(result.confidence).toBe('partial');
      expect(result.reason).toBe('MISSING_MACRO');
      expect(result.foundMacros).toEqual(['calories', 'protein']);
    });
  });
});

