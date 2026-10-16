import { describe, expect, it } from 'vitest';
import {
  parseNutritionText,
  parseNutritionBlock,
  parseLocaleNumber,
  type NutritionParseResult,
} from './localParse';
import { NUTRITION_CORPUS_FIXTURES } from '../../../supabase/functions/_shared/nutritionParserCorpus.fixtures.ts';

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
    expect(inconsistent.confidence).toBe('exact');
    expect(inconsistent.meal?.calories).toBe(98);
    expect(inconsistent.meal?.calorieCorrection).toEqual({ computed: 98, stated: 800 });
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
    { label: 'negative calories', input: 'Calories: -100\nProtein: 30g\nCarbs: 40g\nFat: 8g' },
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

describe('Golden Test Corpus & Sweep Fixtures', () => {
  it('parses all 120 realistic golden fixtures matching expected results', () => {
    for (const fixture of NUTRITION_CORPUS_FIXTURES) {
      const result = parseNutritionText(fixture.input);
      expect(
        result.confidence,
        `Fixture #${fixture.id} [${fixture.title}] confidence expected "${fixture.expected.confidence}", got "${result.confidence}"`
      ).toBe(fixture.expected.confidence);

      if (fixture.expected.calories !== undefined && fixture.expected.calories !== null) {
        expect(
          result.meal?.calories,
          `Fixture #${fixture.id} [${fixture.title}] calories mismatch`
        ).toBe(fixture.expected.calories);
      }
      if (fixture.expected.protein !== undefined && fixture.expected.protein !== null) {
        expect(
          result.meal?.protein,
          `Fixture #${fixture.id} [${fixture.title}] protein mismatch`
        ).toBe(fixture.expected.protein);
      }
      if (fixture.expected.carbs !== undefined && fixture.expected.carbs !== null) {
        expect(
          result.meal?.carbs,
          `Fixture #${fixture.id} [${fixture.title}] carbs mismatch`
        ).toBe(fixture.expected.carbs);
      }
      if (fixture.expected.fat !== undefined && fixture.expected.fat !== null) {
        expect(
          result.meal?.fat,
          `Fixture #${fixture.id} [${fixture.title}] fat mismatch`
        ).toBe(fixture.expected.fat);
      }
      if (fixture.expected.fiber !== undefined && fixture.expected.fiber !== null) {
        expect(
          result.meal?.fiber,
          `Fixture #${fixture.id} [${fixture.title}] fiber mismatch`
        ).toBe(fixture.expected.fiber);
      }
      if (fixture.expected.itemsCount !== undefined && fixture.expected.itemsCount !== null) {
        expect(
          result.meal?.items?.length ?? 0,
          `Fixture #${fixture.id} [${fixture.title}] itemsCount mismatch`
        ).toBe(fixture.expected.itemsCount);
      }
      if (fixture.expected.reason !== undefined && fixture.expected.reason !== null) {
        expect(
          result.reason,
          `Fixture #${fixture.id} [${fixture.title}] reason mismatch`
        ).toBe(fixture.expected.reason);
      }
      if (fixture.expected.hint !== undefined && fixture.expected.hint !== null) {
        expect(
          result.hint,
          `Fixture #${fixture.id} [${fixture.title}] hint mismatch`
        ).toBe(fixture.expected.hint);
      }

      expect(
        result.confidence === 'exact' || result.confidence === 'lenient',
        `Fixture #${fixture.id} [${fixture.title}] ok mismatch`
      ).toBe(fixture.expected.ok);
    }
  });
});

describe('Seeded Property Tests', () => {
  function appearsInText(value: number, text: string): boolean {
    return (
      text.includes(String(value)) ||
      text.includes(value.toLocaleString('en-US')) ||
      text.includes(value.toLocaleString('de-DE'))
    );
  }

  it('Property 1: The kcal of an exact result appears in the input text', () => {
    // 1. Invariant across all corpus fixtures that parsed with exact confidence:
    for (const fixture of NUTRITION_CORPUS_FIXTURES) {
      const result = parseNutritionText(fixture.input);
      if (result.confidence === 'exact' && result.meal?.calories !== undefined) {
        const kcalNumber = result.meal.calorieCorrection
          ? result.meal.calorieCorrection.stated
          : result.meal.calories;
        const rawInput = fixture.input;
        if (result.meal.items && result.meal.items.length > 1) {
          const itemsAppear = result.meal.items.every((item) => {
            const itemKcal = item.calorieCorrection ? item.calorieCorrection.stated : item.calories;
            return appearsInText(itemKcal, rawInput);
          });
          const totalAppears = appearsInText(kcalNumber, rawInput);
          expect(
            itemsAppear || totalAppears,
            `Fixture #${fixture.id} items kcal must appear in input text: "${rawInput}"`
          ).toBe(true);
        } else {
          const appears = appearsInText(kcalNumber, rawInput);
          expect(
            appears,
            `Fixture #${fixture.id} exact kcal ${kcalNumber} must appear in input text: "${rawInput}"`
          ).toBe(true);
        }
      }
    }

    // 2. Deterministic seeded sweep generating 50 diverse exact meals:
    let seedState = 42;
    function nextSeededRandom(): number {
      seedState = (Math.imul(1664525, seedState) + 1013904223) >>> 0;
      return seedState / 4294967296;
    }

    const sampleFoodNames = [
      'Roasted Salmon',
      'Grilled Turkey Cutlet',
      'Beef Tenderloin',
      'Tofu Scramble',
      'Greek Yogurt Bowl',
      'Chicken Breast',
      'Egg White Omelet',
    ];

    for (let i = 0; i < 50; i++) {
      const nameIndex = Math.floor(nextSeededRandom() * sampleFoodNames.length);
      const foodName = sampleFoodNames[nameIndex];
      const proteinVal = Math.floor(nextSeededRandom() * 50) + 10;
      const carbsVal = Math.floor(nextSeededRandom() * 60);
      const fatVal = Math.floor(nextSeededRandom() * 30) + 1;
      const exactKcal = 4 * proteinVal + 4 * carbsVal + 9 * fatVal;

      const testInput = `${foodName}\nCalories: ${exactKcal} kcal\nProtein: ${proteinVal}g\nCarbs: ${carbsVal}g\nFat: ${fatVal}g`;
      const result = parseNutritionText(testInput);
      expect(result.confidence).toBe('exact');
      expect(result.meal?.calories).toBe(exactKcal);
      expect(testInput.includes(String(exactKcal))).toBe(true);
    }
  });

  it('Property 2: Noise, bullets, and formatting invariants', () => {
    const bulletPrefixes = ['* ', '- ', '• ', '1. ', '  - '];
    const emojiPrefixes = ['🔥 ', '🥗 ', '🍽️ ', '✨ ', ''];
    const boldWrappers: Array<(text: string) => string> = [
      (text: string) => `**${text}**`,
      (text: string) => `__${text}__`,
      (text: string) => text,
    ];

    let seedState = 1337;
    function nextSeededRandom(): number {
      seedState = (Math.imul(1664525, seedState) + 1013904223) >>> 0;
      return seedState / 4294967296;
    }

    for (let i = 0; i < 30; i++) {
      const proteinVal = Math.floor(nextSeededRandom() * 40) + 15;
      const carbsVal = Math.floor(nextSeededRandom() * 50) + 5;
      const fatVal = Math.floor(nextSeededRandom() * 20) + 2;
      const calVal = 4 * proteinVal + 4 * carbsVal + 9 * fatVal;

      const cleanLines = [
        'Protein Bowl',
        `Calories: ${calVal} kcal`,
        `Protein: ${proteinVal}g`,
        `Carbs: ${carbsVal}g`,
        `Fat: ${fatVal}g`,
      ];
      const cleanInput = cleanLines.join('\n');
      const cleanResult = parseNutritionText(cleanInput);
      expect(cleanResult.confidence).toBe('exact');

      const noisyLines = cleanLines.map((line, lineIndex) => {
        const bullet = bulletPrefixes[Math.floor(nextSeededRandom() * bulletPrefixes.length)];
        const emoji = emojiPrefixes[Math.floor(nextSeededRandom() * emojiPrefixes.length)];
        const wrapper = boldWrappers[Math.floor(nextSeededRandom() * boldWrappers.length)];
        if (lineIndex === 0) {
          return `${bullet}${emoji}${wrapper(line)}`;
        }
        return `${bullet}${wrapper(line)}`;
      });

      const noisyInput = `\n${noisyLines.join('\n\n')}\n`;
      const noisyResult = parseNutritionText(noisyInput);

      expect(noisyResult.confidence).toBe('exact');
      expect(noisyResult.meal?.calories).toBe(cleanResult.meal?.calories);
      expect(noisyResult.meal?.protein).toBe(cleanResult.meal?.protein);
      expect(noisyResult.meal?.carbs).toBe(cleanResult.meal?.carbs);
      expect(noisyResult.meal?.fat).toBe(cleanResult.meal?.fat);
    }
  });

  it('Property 3: Thousands separators never shrink numbers', () => {
    // 1. Locale sweep: 1000..5000 in steps of 100 for en-US and de-DE
    for (let num = 1000; num <= 5000; num += 100) {
      const usStr = num.toLocaleString('en-US');
      const deStr = num.toLocaleString('de-DE');

      const usParsed = parseLocaleNumber(usStr);
      const deParsed = parseLocaleNumber(deStr);

      expect(usParsed.value).toBe(num);
      expect(deParsed.value).toBe(num);
      expect((usParsed.value ?? 0) >= 1000).toBe(true);
      expect((deParsed.value ?? 0) >= 1000).toBe(true);
    }

    // 2. Decimal thousands:
    expect(parseLocaleNumber('1,234.5').value).toBe(1234.5);
    expect(parseLocaleNumber('1.234,5').value).toBe(1234.5);
    expect(parseLocaleNumber('2,5 g').value).toBe(2.5);
    expect(parseLocaleNumber('2.5 g').value).toBe(2.5);

    // 3. Full meal parse preserves thousands without shrinking:
    const usMeal = 'Steak\nCalories: 1,000 kcal\nProtein: 100g\nCarbs: 50g\nFat: 44.4g';
    const usResult = parseNutritionText(usMeal);
    expect(usResult.meal?.calories).toBe(1000);
    expect(usResult.meal?.calories).not.toBe(1);

    const deMeal = 'Steak\nCalories: 1.000 kcal\nProtein: 100g\nCarbs: 50g\nFat: 44.4g';
    const deResult = parseNutritionText(deMeal);
    expect(deResult.meal?.calories).toBe(1000);
    expect(deResult.meal?.calories).not.toBe(1);
  });

  it('thousands separators with 0 macros yield computed 0 kcal + warning (never 1 kcal)', () => {
    const commaInput = 'Protein Shake\nCalories: 1,000 kcal\nProtein: 0g\nCarbs: 0g\nFat: 0g';
    const commaResult = parseNutritionText(commaInput);
    expect(commaResult.confidence).toBe('exact');
    expect(commaResult.meal?.calories).toBe(0);
    expect(commaResult.meal?.calorieCorrection).toEqual({ computed: 0, stated: 1000 });

    const periodInput = 'Protein Shake\nCalories: 1.000 kcal\nProtein: 0g\nCarbs: 0g\nFat: 0g';
    const periodResult = parseNutritionText(periodInput);
    expect(periodResult.confidence).toBe('exact');
    expect(periodResult.meal?.calories).toBe(0);
    expect(periodResult.meal?.calorieCorrection).toEqual({ computed: 0, stated: 1000 });

    const blockResultComma = parseNutritionBlock(commaInput);
    expect(blockResultComma.ok).toBe(true);
    if (blockResultComma.ok) {
      expect(blockResultComma.meal.calories).toBe(0);
    }

    const blockResultPeriod = parseNutritionBlock(periodInput);
    expect(blockResultPeriod.ok).toBe(true);
    if (blockResultPeriod.ok) {
      expect(blockResultPeriod.meal.calories).toBe(0);
    }
  });

  it("open-ended estimates ('800+', '50+') never yield exact grade", () => {
    const input = 'Steak\nCalories: 800+ kcal\nProtein: 50+g\nCarbs: 0g\nFat: 30g';
    const result = parseNutritionText(input);
    expect(result.confidence).not.toBe('exact');
  });

  it('portion prefix on food line captures portion size and exact macros', () => {
    const input = '8 oz Grilled Sirloin Steak: 48g protein, 0g carbs, 18g fat, 360 kcal';
    const result = parseNutritionText(input);
    expect(result.confidence).toBe('exact');
    expect(result.meal?.name).toBe('Grilled Sirloin Steak');
    expect(result.meal?.servingSize).toBe(8);
    expect(result.meal?.servingUnit).toBe('oz');
    expect(result.meal?.calories).toBe(360);
  });

  it('prefers closest non-macro line above macros for single meal name', () => {
    const inputWithLeadIn = [
      'Here is my snack breakdown:',
      'Protein bar',
      'Calories: 220 kcal',
      'Protein: 20g',
      'Carbs: 22g',
      'Fat: 6g',
      'Hope this helps!',
    ].join('\n');
    const resultWithLeadIn = parseNutritionText(inputWithLeadIn);
    expect(resultWithLeadIn.confidence).toBe('lenient');
    expect(resultWithLeadIn.meal?.name).toBe('Protein bar');
    expect(resultWithLeadIn.meal?.calories).toBe(220);
    expect(resultWithLeadIn.meal?.protein).toBe(20);
    expect(resultWithLeadIn.meal?.carbs).toBe(22);
    expect(resultWithLeadIn.meal?.fat).toBe(6);
    expect(resultWithLeadIn.skippedLines).toEqual([
      'Here is my snack breakdown:',
      'Hope this helps!',
    ]);

    const inputWithLunchLeadIn = [
      "Sure! Here's the breakdown for your lunch:",
      'Chicken Rice Bowl',
      'Calories: 520 kcal',
      'Protein: 46g',
      'Carbs: 58g',
      'Fat: 12g',
      'Hope that helps!',
    ].join('\n');
    const resultWithLunch = parseNutritionText(inputWithLunchLeadIn);
    expect(resultWithLunch.confidence).toBe('lenient');
    expect(resultWithLunch.meal?.name).toBe('Chicken Rice Bowl');
    expect(resultWithLunch.meal?.calories).toBe(520);
    expect(resultWithLunch.skippedLines).toEqual([
      "Sure! Here's the breakdown for your lunch:",
      'Hope that helps!',
    ]);

    const inputWithoutLeadIn = [
      'Protein bar',
      'Calories: 220 kcal',
      'Protein: 20g',
      'Carbs: 22g',
      'Fat: 6g',
    ].join('\n');
    const resultWithoutLeadIn = parseNutritionText(inputWithoutLeadIn);
    expect(resultWithoutLeadIn.confidence).toBe('exact');
    expect(resultWithoutLeadIn.meal?.name).toBe('Protein bar');
    expect(resultWithoutLeadIn.meal?.calories).toBe(220);
    expect(resultWithoutLeadIn.skippedLines).toEqual([]);
  });

  it('percent macros are unread and never exact', () => {
    const percentInput = [
      'Zone Balance Plate',
      'Calories: 500 kcal',
      'Protein: 40%',
      'Carbs: 40%',
      'Fat: 20%',
    ].join('\n');
    const result = parseNutritionText(percentInput);
    expect(result.confidence).toBe('partial');
    expect(result.reason).toBe('MISSING_MACRO');
    expect(result.meal?.calories).toBe(500);
    expect(result.meal?.protein).toBe(0);
    expect(result.meal?.carbs).toBe(0);
    expect(result.meal?.fat).toBe(0);

    // Transcribed label that ALSO gives grams keeps grams
    const labelWithGramsAndPercent = [
      'Nutrition Facts',
      'Calories 250',
      'Total Fat 8g 10%',
      'Total Carbohydrate 34g 12%',
      'Protein 10g 20%',
    ].join('\n');
    const labelResult = parseNutritionText(labelWithGramsAndPercent);
    expect(labelResult.confidence).toBe('exact');
    expect(labelResult.meal?.calories).toBe(250);
    expect(labelResult.meal?.fat).toBe(8);
    expect(labelResult.meal?.carbs).toBe(34);
    expect(labelResult.meal?.protein).toBe(10);
  });

  it('serving/quantity lines are modifiers and not dropped as noise', () => {
    const quantityInput = [
      'Cheeseburger Plate',
      'Calories: 300 kcal',
      'Protein: 15g',
      'Carbs: 25g',
      'Fat: 12g',
      'Quantity: 2',
    ].join('\n');
    const quantityResult = parseNutritionText(quantityInput);
    expect(quantityResult.confidence).toBe('lenient');
    expect(quantityResult.modifiers).toEqual(['Quantity: 2']);
    expect(quantityResult.skippedLines).toEqual([]);
    expect(quantityResult.meal?.calories).toBe(300);

    const batchInput = [
      'Meal Prep Beef Stew',
      'Servings: 4',
      'Calories: 1600 kcal',
      'Protein: 140g',
      'Carbs: 180g',
      'Fat: 32g',
    ].join('\n');
    const batchResult = parseNutritionText(batchInput);
    expect(batchResult.confidence).toBe('lenient');
    expect(batchResult.modifiers).toEqual(['Servings: 4']);
    expect(batchResult.skippedLines).toEqual([]);
    expect(batchResult.meal?.calories).toBe(1600);
  });
  describe('Format C: Extended Device-Readable Paste Formats', () => {
    it('parses emoji-only macro labels as exact when consistent', () => {
      const text = 'Grilled Salmon Fillet\n🔥 580 kcal\n🥩 46g\n🍞 35g\n🧈 26g';
      const result = parseNutritionText(text);
      expect(result.confidence).toBe('exact');
      expect(result.meal?.calories).toBe(580);
      expect(result.meal?.protein).toBe(46);
      expect(result.meal?.carbs).toBe(35);
      expect(result.meal?.fat).toBe(26);
      expect(result.meal?.name).toBe('Grilled Salmon Fillet');
    });

    it('parses multi-item blocks with category header and quantity prefixes', () => {
      const text = [
        'Breakfast:',
        '- 2x Fried Eggs: 220 kcal | 16g P | 2g C | 16g F',
        '- 1x Toast: 170 kcal | 8g P | 30g C | 1g F',
      ].join('\n');
      const result = parseNutritionText(text);
      expect(result.confidence).toBe('exact');
      expect(result.meal?.calories).toBe(390);
      expect(result.meal?.protein).toBe(24);
      expect(result.meal?.carbs).toBe(32);
      expect(result.meal?.fat).toBe(17);
      expect(result.meal?.name).toBe('Breakfast');
      expect(result.meal?.items).toHaveLength(2);
    });

    it('parses nested sub-items under single dish total when consistent', () => {
      const text = [
        'Custom Burrito Bowl: 720 kcal, 55g P, 68g C, 24g F',
        '  • Double Chicken (360 kcal, 48g P)',
        '  • Brown Rice (210 kcal, 4g P)',
        '  • Black Beans (150 kcal, 3g P)',
      ].join('\n');
      const result = parseNutritionText(text);
      expect(result.confidence).toBe('exact');
      expect(result.meal?.calories).toBe(720);
      expect(result.meal?.protein).toBe(55);
      expect(result.meal?.carbs).toBe(68);
      expect(result.meal?.fat).toBe(24);
      expect(result.meal?.name).toBe('Custom Burrito Bowl');
    });

    it('declines grams-only macro breakdown to partial missing calories', () => {
      const text = [
        'Salmon Avocado Plate',
        'Protein: 38g',
        'Carbs: 12g',
        'Fat: 32g',
      ].join('\n');
      const result = parseNutritionText(text);
      expect(result.confidence).toBe('partial');
      expect(result.reason).toBe('MISSING_MACRO');
      expect(result.meal?.protein).toBe(38);
      expect(result.meal?.carbs).toBe(12);
      expect(result.meal?.fat).toBe(32);
    });
  });
});
