import { assertEquals, assertNotEquals } from "jsr:@std/assert@1.0.19";
import {
  parseNutritionText,
  parseLocaleNumber,
  extractYourbodyFencedBlock,
  type NutritionParseResult,
} from "./nutritionParser.ts";
import { NUTRITION_CORPUS_FIXTURES } from "./nutritionParserCorpus.fixtures.ts";

Deno.test("shared nutritionParser: cleanup cases (bullets, bold, approx, tilde)", () => {
  const bulletAsterisk = [
    "* Protein Ice Cream",
    "* Calories: 400 kcal",
    "* Protein: 40g",
    "* Carbs: 40g",
    "* Fat: 9g",
  ].join("\n");
  const result1 = parseNutritionText(bulletAsterisk);
  assertEquals(result1.confidence, "exact");
  assertEquals(result1.meal?.name, "Protein Ice Cream");
  assertEquals(result1.meal?.calories, 400);
  assertEquals(result1.meal?.protein, 40);
  assertEquals(result1.meal?.carbs, 40);
  assertEquals(result1.meal?.fat, 9);
  assertEquals(result1.skippedLines, []);
  assertEquals(result1.modifiers, []);

  const bulletDashAndBold = [
    "- **Greek Yogurt**",
    "- **Calories**: ~130 kcal",
    "- **Protein**: approx. 15g",
    "- **Carbs**: 6g",
    "- **Fat**: 5g",
  ].join("\n");
  const result2 = parseNutritionText(bulletDashAndBold);
  assertEquals(result2.confidence, "exact");
  assertEquals(result2.meal?.name, "Greek Yogurt");
  assertEquals(result2.meal?.calories, 130);
  assertEquals(result2.meal?.protein, 15);
  assertEquals(result2.skippedLines, []);
});

Deno.test("shared nutritionParser: representative dessert paste with consumed weight", () => {
  const dessertPaste = [
    "* Protein Ice Cream",
    "* Calories: ~609 kcal",
    "* Protein: ~45g",
    "* Carbs: ~60g",
    "* Fat: ~21g",
    "* Consumed Weight: ~543g",
  ].join("\n");

  const result = parseNutritionText(dessertPaste);
  assertEquals(result.confidence, "exact");
  assertEquals(result.skippedLines, []);
  assertEquals(result.modifiers, []);
  assertNotEquals(result.meal, undefined);
  assertEquals(result.meal?.name, "Protein Ice Cream");
  assertEquals(result.meal?.calories, 609);
  assertEquals(result.meal?.protein, 45);
  assertEquals(result.meal?.carbs, 60);
  assertEquals(result.meal?.fat, 21);
  assertEquals(result.meal?.servingSize, 543);
  assertEquals(result.meal?.servingUnit, "g");
});

Deno.test("shared nutritionParser: confidence levels and skippedLines / modifiers", () => {
  // 1. Exact
  const exactInput = "Chicken\nCalories: 200 kcal\nProtein: 30g\nCarbs: 0g\nFat: 5g";
  const exactRes = parseNutritionText(exactInput);
  assertEquals(exactRes.confidence, "exact");
  assertEquals(exactRes.skippedLines, []);
  assertEquals(exactRes.modifiers, []);

  // 2. Lenient with skipped lines
  const lenientSkipped = "Chicken\nCalories: 200 kcal\nProtein: 30g\nCarbs: 0g\nFat: 5g\nextra rice";
  const lenientSkippedRes = parseNutritionText(lenientSkipped);
  assertEquals(lenientSkippedRes.confidence, "lenient");
  assertEquals(lenientSkippedRes.skippedLines, ["extra rice"]);
  assertEquals(lenientSkippedRes.modifiers, []);

  // 3. Lenient with modifiers
  const ateHalfInput = "Grilled Chicken\nCalories: 200 kcal\nProtein: 30g\nCarbs: 0g\nFat: 5g\nate half";
  const ateHalfRes = parseNutritionText(ateHalfInput);
  assertEquals(ateHalfRes.confidence, "lenient");
  assertEquals(ateHalfRes.modifiers, ["ate half"]);
  assertEquals(ateHalfRes.skippedLines, []);

  // 4. Lenient with two different weights
  const differingWeights = [
    "Protein Bar",
    "Per 100g",
    "Calories: 350 kcal",
    "Protein: 30g",
    "Carbs: 35g",
    "Fat: 10g",
    "Consumed Weight: 60g",
  ].join("\n");
  const diffRes = parseNutritionText(differingWeights);
  assertEquals(diffRes.confidence, "lenient");
  assertEquals(diffRes.modifiers, ["per 100g"]);
  assertEquals(diffRes.meal?.servingSize, 60);
  assertEquals(diffRes.meal?.servingUnit, "g");

  // 5. Partial
  const partialInput = "Chicken\nCalories: 200 kcal\nProtein: 30g";
  const partialRes = parseNutritionText(partialInput);
  assertEquals(partialRes.confidence, "partial");
  assertEquals(partialRes.reason, "MISSING_MACRO");
  assertEquals(partialRes.meal?.calories, 200);
  assertEquals(partialRes.meal?.protein, 30);
  assertEquals(partialRes.meal?.carbs, 0);
  assertEquals(partialRes.meal?.fat, 0);
  assertEquals(partialRes.foundMacros, ["calories", "protein"]);

  // 6. None
  const noneInput = "Just some text about running in the park";
  const noneRes = parseNutritionText(noneInput);
  assertEquals(noneRes.confidence, "none");
  assertEquals(noneRes.reason, "NOT_A_NUTRITION_BLOCK");
});

Deno.test("shared nutritionParser: no servingSize when no weight line exists", () => {
  const input = "Steak\nCalories: 400 kcal\nProtein: 50g\nCarbs: 0g\nFat: 22g";
  const result: NutritionParseResult = parseNutritionText(input);
  assertEquals(result.confidence, "exact");
  assertEquals(result.meal?.servingSize, undefined);
  assertEquals(result.meal?.servingUnit, undefined);
});

Deno.test("shared nutritionParser: extracts fenced yourbody and yourbody-v1 blocks", () => {
  // 1. Chat reply with prose + yourbody-v1 block -> exact
  const chatReply = [
    "Sure! Here is the nutritional breakdown for your lunch:",
    "```yourbody-v1",
    "Chicken Rice Bowl",
    "Calories: 520 kcal",
    "Protein: 46g",
    "Carbs: 58g",
    "Fat: 12g",
    "```",
    "Let me know if you would like me to adjust portions!",
  ].join("\n");
  const result1 = parseNutritionText(chatReply);
  assertEquals(result1.confidence, "exact");
  assertEquals(result1.meal?.name, "Chicken Rice Bowl");
  assertEquals(result1.meal?.calories, 520);
  assertEquals(result1.meal?.protein, 46);
  assertEquals(result1.meal?.carbs, 58);
  assertEquals(result1.meal?.fat, 12);
  assertEquals(result1.skippedLines, []);

  // 2. Chat reply with ```yourbody fence
  const yourbodyReply = [
    "I estimated your shake:",
    "```yourbody",
    "Whey Protein Shake",
    "Calories: 140 kcal",
    "Protein: 25g",
    "Carbs: 3g",
    "Fat: 2g",
    "```",
  ].join("\n");
  const result2 = parseNutritionText(yourbodyReply);
  assertEquals(result2.confidence, "exact");
  assertEquals(result2.meal?.name, "Whey Protein Shake");
  assertEquals(result2.meal?.calories, 140);

  // 3. Two blocks -> parses the last one
  const twoBlocks = [
    "First estimate:",
    "```yourbody",
    "Single Scoop",
    "Calories: 120 kcal",
    "Protein: 24g",
    "Carbs: 2g",
    "Fat: 1g",
    "```",
    "Actually, you had two scoops:",
    "```yourbody-v1",
    "Double Scoop",
    "Calories: 240 kcal",
    "Protein: 48g",
    "Carbs: 4g",
    "Fat: 2g",
    "```",
    "Hope that helps!",
  ].join("\n");
  const result3 = parseNutritionText(twoBlocks);
  assertEquals(result3.confidence, "exact");
  assertEquals(result3.meal?.name, "Double Scoop");
  assertEquals(result3.meal?.calories, 240);
  assertEquals(result3.meal?.protein, 48);

  // 4. Malformed block -> confidence rules evaluated on block content, not surrounding prose
  const malformedBlock = [
    "Here is your partial data:",
    "```yourbody-v1",
    "Protein Snack",
    "Calories: 150 kcal",
    "Protein: 20g",
    "```",
    "Could not calculate carbs or fat.",
  ].join("\n");
  const result4 = parseNutritionText(malformedBlock);
  assertEquals(result4.confidence, "partial");
  assertEquals(result4.reason, "MISSING_MACRO");
  assertEquals(result4.foundMacros, ["calories", "protein"]);

  // 5. Direct extraction helper tests
  assertEquals(extractYourbodyFencedBlock("no fence here"), null);
  assertEquals(
    extractYourbodyFencedBlock("```yourbody\ntest content\n```"),
    "test content"
  );
});

Deno.test("shared nutritionParser: 93 golden corpus & sweep fixtures", () => {
  for (const fixture of NUTRITION_CORPUS_FIXTURES) {
    const result = parseNutritionText(fixture.input);
    assertEquals(
      result.confidence,
      fixture.expected.confidence,
      `Fixture #${fixture.id} [${fixture.title}] confidence mismatch: expected "${fixture.expected.confidence}", got "${result.confidence}"`
    );

    if (fixture.expected.calories !== undefined && fixture.expected.calories !== null) {
      assertEquals(
        result.meal?.calories,
        fixture.expected.calories,
        `Fixture #${fixture.id} [${fixture.title}] calories mismatch: expected ${fixture.expected.calories}, got ${result.meal?.calories}`
      );
    }
    if (fixture.expected.protein !== undefined && fixture.expected.protein !== null) {
      assertEquals(
        result.meal?.protein,
        fixture.expected.protein,
        `Fixture #${fixture.id} [${fixture.title}] protein mismatch: expected ${fixture.expected.protein}, got ${result.meal?.protein}`
      );
    }
    if (fixture.expected.carbs !== undefined && fixture.expected.carbs !== null) {
      assertEquals(
        result.meal?.carbs,
        fixture.expected.carbs,
        `Fixture #${fixture.id} [${fixture.title}] carbs mismatch: expected ${fixture.expected.carbs}, got ${result.meal?.carbs}`
      );
    }
    if (fixture.expected.fat !== undefined && fixture.expected.fat !== null) {
      assertEquals(
        result.meal?.fat,
        fixture.expected.fat,
        `Fixture #${fixture.id} [${fixture.title}] fat mismatch: expected ${fixture.expected.fat}, got ${result.meal?.fat}`
      );
    }
    if (fixture.expected.fiber !== undefined && fixture.expected.fiber !== null) {
      assertEquals(
        result.meal?.fiber,
        fixture.expected.fiber,
        `Fixture #${fixture.id} [${fixture.title}] fiber mismatch: expected ${fixture.expected.fiber}, got ${result.meal?.fiber}`
      );
    }
    if (fixture.expected.itemsCount !== undefined && fixture.expected.itemsCount !== null) {
      assertEquals(
        result.meal?.items?.length ?? 0,
        fixture.expected.itemsCount,
        `Fixture #${fixture.id} [${fixture.title}] itemsCount mismatch: expected ${fixture.expected.itemsCount}, got ${result.meal?.items?.length ?? 0}`
      );
    }
    if (fixture.expected.reason !== undefined && fixture.expected.reason !== null) {
      assertEquals(
        result.reason,
        fixture.expected.reason,
        `Fixture #${fixture.id} [${fixture.title}] reason mismatch: expected "${fixture.expected.reason}", got "${result.reason}"`
      );
    }
    if (fixture.expected.hint !== undefined && fixture.expected.hint !== null) {
      assertEquals(
        result.hint,
        fixture.expected.hint,
        `Fixture #${fixture.id} [${fixture.title}] hint mismatch: expected "${fixture.expected.hint}", got "${result.hint}"`
      );
    }
  }
});

Deno.test("shared nutritionParser: property test 1 - exact kcal appears in text", () => {
  function appearsInText(value: number, text: string): boolean {
    return (
      text.includes(String(value)) ||
      text.includes(value.toLocaleString("en-US")) ||
      text.includes(value.toLocaleString("de-DE"))
    );
  }

  // 1. Invariant across all corpus fixtures that parsed with exact confidence:
  for (const fixture of NUTRITION_CORPUS_FIXTURES) {
    const result = parseNutritionText(fixture.input);
    if (result.confidence === "exact" && result.meal?.calories !== undefined) {
      const kcalNumber = result.meal.calories;
      const rawInput = fixture.input;
      if (result.meal.items && result.meal.items.length > 1) {
        // In multi-item meals, every item's kcal appears in input, or the total appears
        const itemsAppear = result.meal.items.every((item) =>
          appearsInText(item.calories, rawInput)
        );
        const totalAppears = appearsInText(kcalNumber, rawInput);
        assertEquals(
          itemsAppear || totalAppears,
          true,
          `Fixture #${fixture.id} items kcal must appear in input text: "${rawInput}"`
        );
      } else {
        // In single-food meals, the exact kcal appears in input
        const appears = appearsInText(kcalNumber, rawInput);
        assertEquals(
          appears,
          true,
          `Fixture #${fixture.id} exact kcal ${kcalNumber} must appear in input text: "${rawInput}"`
        );
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
    "Roasted Salmon",
    "Grilled Turkey Cutlet",
    "Beef Tenderloin",
    "Tofu Scramble",
    "Greek Yogurt Bowl",
    "Chicken Breast",
    "Egg White Omelet",
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
    assertEquals(result.confidence, "exact");
    assertEquals(result.meal?.calories, exactKcal);
    assertEquals(testInput.includes(String(exactKcal)), true);
  }
});

Deno.test("shared nutritionParser: property test 2 - noise, bullets, and formatting invariants", () => {
  const bulletPrefixes = ["* ", "- ", "• ", "1. ", "  - "];
  const emojiPrefixes = ["🔥 ", "🥗 ", "🍽️ ", "✨ ", ""];
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
      "Protein Bowl",
      `Calories: ${calVal} kcal`,
      `Protein: ${proteinVal}g`,
      `Carbs: ${carbsVal}g`,
      `Fat: ${fatVal}g`,
    ];
    const cleanInput = cleanLines.join("\n");
    const cleanResult = parseNutritionText(cleanInput);
    assertEquals(cleanResult.confidence, "exact");

    const noisyLines = cleanLines.map((line, lineIndex) => {
      const bullet = bulletPrefixes[Math.floor(nextSeededRandom() * bulletPrefixes.length)];
      const emoji = emojiPrefixes[Math.floor(nextSeededRandom() * emojiPrefixes.length)];
      const wrapper = boldWrappers[Math.floor(nextSeededRandom() * boldWrappers.length)];
      if (lineIndex === 0) {
        return `${bullet}${emoji}${wrapper(line)}`;
      }
      return `${bullet}${wrapper(line)}`;
    });

    const noisyInput = `\n${noisyLines.join("\n\n")}\n`;
    const noisyResult = parseNutritionText(noisyInput);

    assertEquals(noisyResult.confidence, "exact");
    assertEquals(noisyResult.meal?.calories, cleanResult.meal?.calories);
    assertEquals(noisyResult.meal?.protein, cleanResult.meal?.protein);
    assertEquals(noisyResult.meal?.carbs, cleanResult.meal?.carbs);
    assertEquals(noisyResult.meal?.fat, cleanResult.meal?.fat);
  }
});

Deno.test("shared nutritionParser: property test 3 - thousands separators never shrink numbers", () => {
  // 1. Locale sweep: 1000..5000 in steps of 100 for en-US and de-DE
  for (let num = 1000; num <= 5000; num += 100) {
    const usStr = num.toLocaleString("en-US");
    const deStr = num.toLocaleString("de-DE");

    const usParsed = parseLocaleNumber(usStr);
    const deParsed = parseLocaleNumber(deStr);

    assertEquals(usParsed.value, num);
    assertEquals(deParsed.value, num);
    assertEquals((usParsed.value ?? 0) >= 1000, true);
    assertEquals((deParsed.value ?? 0) >= 1000, true);
  }

  // 2. Decimal thousands:
  assertEquals(parseLocaleNumber("1,234.5").value, 1234.5);
  assertEquals(parseLocaleNumber("1.234,5").value, 1234.5);
  assertEquals(parseLocaleNumber("2,5 g").value, 2.5);
  assertEquals(parseLocaleNumber("2.5 g").value, 2.5);

  // 3. Full meal parse preserves thousands without shrinking:
  const usMeal = "Steak\nCalories: 1,000 kcal\nProtein: 100g\nCarbs: 50g\nFat: 44.4g";
  const usResult = parseNutritionText(usMeal);
  assertEquals(usResult.meal?.calories, 1000);
  assertNotEquals(usResult.meal?.calories, 1);

  const deMeal = "Steak\nCalories: 1.000 kcal\nProtein: 100g\nCarbs: 50g\nFat: 44.4g";
  const deResult = parseNutritionText(deMeal);
  assertEquals(deResult.meal?.calories, 1000);
  assertNotEquals(deResult.meal?.calories, 1);
});

Deno.test("shared nutritionParser: '1,000' and '1.000' with 0 macros yield KCAL_INCONSISTENT (never 1 kcal)", () => {
  // If '1,000' were mistakenly parsed as 1 kcal, 0 macros would be consistent (|0 - 1| <= 60),
  // but correctly parsed as 1000 kcal, |0 - 1000| > 250 triggers KCAL_INCONSISTENT.
  const commaInput = "Protein Shake\nCalories: 1,000 kcal\nProtein: 0g\nCarbs: 0g\nFat: 0g";
  const commaResult = parseNutritionText(commaInput);
  assertEquals(commaResult.confidence, "none");
  assertEquals(commaResult.reason, "KCAL_INCONSISTENT");

  // Same for European period separator '1.000'
  const periodInput = "Protein Shake\nCalories: 1.000 kcal\nProtein: 0g\nCarbs: 0g\nFat: 0g";
  const periodResult = parseNutritionText(periodInput);
  assertEquals(periodResult.confidence, "none");
  assertEquals(periodResult.reason, "KCAL_INCONSISTENT");
});

Deno.test("shared nutritionParser: open-ended estimates ('800+', '50+') never yield exact grade", () => {
  const input = "Steak\nCalories: 800+ kcal\nProtein: 50+g\nCarbs: 0g\nFat: 30g";
  const result = parseNutritionText(input);
  assertNotEquals(result.confidence, "exact");
});

Deno.test("shared nutritionParser: portion prefix on food line captures portion size and exact macros", () => {
  const input = "8 oz Grilled Sirloin Steak: 48g protein, 0g carbs, 18g fat, 360 kcal";
  const result = parseNutritionText(input);
  assertEquals(result.confidence, "exact");
  assertEquals(result.meal?.name, "Grilled Sirloin Steak");
  assertEquals(result.meal?.servingSize, 8);
  assertEquals(result.meal?.servingUnit, "oz");
  assertEquals(result.meal?.calories, 360);
});

