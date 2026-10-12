import { assertEquals, assertNotEquals } from "jsr:@std/assert@1.0.19";
import {
  parseNutritionText,
  type NutritionParseResult,
} from "./nutritionParser.ts";

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
