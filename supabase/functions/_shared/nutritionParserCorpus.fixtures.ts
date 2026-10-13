/**
 * Golden Test Corpus Fixtures (93 realistic cases)
 *
 * Generated from parser robustness test corpus (42 cases) + exploratory sweep (51 cases).
 * Expected values reflect the human-expected values after parser hardening rules (Run 8).
 * Anonymity: zero mention of third-party AI chat product names.
 */

import type { ParseConfidence } from './nutritionParser.ts';

export interface CorpusFixtureExpected {
  confidence: ParseConfidence;
  ok: boolean;
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  fiber?: number | null;
  name?: string | null;
  itemsCount?: number | null;
  reason?: string | null;
  hint?: string | null;
}

export interface CorpusFixture {
  id: number;
  title: string;
  input: string;
  expected: CorpusFixtureExpected;
}

export const NUTRITION_CORPUS_FIXTURES: CorpusFixture[] = [
  {
    "id": 1,
    "title": "[Chat] Markdown bold dish + bullets",
    "input": "**Chipotle Chicken Bowl**\n* Calories: 650 kcal\n* Protein: 42g\n* Carbs: 55g\n* Fat: 22g",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 650,
      "protein": 42,
      "carbs": 55,
      "fat": 22,
      "fiber": null,
      "name": "Chipotle Chicken Bowl",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 2,
    "title": "[Chat] Dish + Total macros (colon)",
    "input": "Grilled Salmon Bowl\nTotal Calories: 650 kcal\nTotal Protein: 40 g\nTotal Carbs: 45 g\nTotal Fat: 26 g\nTotal Fiber: 1 g",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 650,
      "protein": 40,
      "carbs": 45,
      "fat": 26,
      "fiber": 1,
      "name": "Grilled Salmon Bowl",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 3,
    "title": "[Chat] Dish + Total macros (no colon)",
    "input": "Grilled Salmon Bowl\nTotal Calories 650 kcal\nTotal Protein 40 g\nTotal Carbs 45 g\nTotal Fat 26 g\nTotal Fiber 1 g",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 650,
      "protein": 40,
      "carbs": 45,
      "fat": 26,
      "fiber": 1,
      "name": "Grilled Salmon Bowl",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 4,
    "title": "[Chat] Total macros without dish line",
    "input": "Total Calories: 650 kcal\nTotal Protein: 40 g\nTotal Carbs: 45 g\nTotal Fat: 26 g\nTotal Fiber: 1 g",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 650,
      "protein": 40,
      "carbs": 45,
      "fat": 26,
      "fiber": 1,
      "name": null,
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 5,
    "title": "[Chat] Item lines + Total block",
    "input": "Food: Lunch Combo\n- 200g Chicken Breast | 330 kcal | 62g P | 0g C | 7g F\n- 1 cup White Rice | 205 kcal | 4g P | 45g C | 0.5g F\nTotal Calories: 535 kcal\nTotal Protein: 66 g\nTotal Carbs: 45 g\nTotal Fat: 7.5 g",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 535,
      "protein": 66,
      "carbs": 45,
      "fat": 7.5,
      "fiber": null,
      "name": "Lunch Combo",
      "itemsCount": 2,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 6,
    "title": "[Chat] Markdown table with Total row",
    "input": "| Item | Calories | Protein | Carbs | Fat |\n| --- | --- | --- | --- | --- |\n| Chicken Breast | 330 | 62 | 0 | 7 |\n| White Rice | 205 | 4 | 45 | 1 |\n| Total | 535 | 66 | 45 | 8 |",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 535,
      "protein": 66,
      "carbs": 45,
      "fat": 8,
      "fiber": null,
      "name": null,
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 7,
    "title": "[Chat] Numbered list",
    "input": "Turkey Sandwich\n1. Calories: 520 kcal\n2. Protein: 45g\n3. Carbs: 50g\n4. Fat: 15g",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 520,
      "protein": 45,
      "carbs": 50,
      "fat": 15,
      "fiber": null,
      "name": "Turkey Sandwich",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 8,
    "title": "[Chat] Emoji bullets (🔥 Calories: 650)",
    "input": "Turkey Sandwich\n🔥 Calories: 650\n💪 Protein: 35g\n🍞 Carbs: 60g\n🥑 Fat: 20g",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 650,
      "protein": 35,
      "carbs": 60,
      "fat": 20,
      "fiber": null,
      "name": "Turkey Sandwich",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 9,
    "title": "[Chat] Estimated / approx / ~ markers",
    "input": "Chicken Salad\n~650 kcal\napprox. 40g protein\n~50g carbs\napprox. 18g fat",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 650,
      "protein": 40,
      "carbs": 50,
      "fat": 18,
      "fiber": null,
      "name": "Chicken Salad",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 10,
    "title": "[Chat] Range with hyphen ('600-700 kcal')",
    "input": "Beef Burrito\nCalories: 600-700 kcal\nProtein: 35-40g\nCarbs: 60-70g\nFat: 20-25g",
    "expected": {
      "confidence": "lenient",
      "ok": true,
      "calories": 650,
      "protein": 37.5,
      "carbs": 65,
      "fat": 22.5,
      "fiber": null,
      "name": "Beef Burrito",
      "itemsCount": null,
      "reason": null,
      "hint": "Range: used the middle"
    }
  },
  {
    "id": 11,
    "title": "[Chat] Range with en-dash ('600–700 kcal')",
    "input": "Beef Burrito\nCalories: 600–700 kcal\nProtein: 35–40g\nCarbs: 60–70g\nFat: 20–25g",
    "expected": {
      "confidence": "lenient",
      "ok": true,
      "calories": 650,
      "protein": 37.5,
      "carbs": 65,
      "fat": 22.5,
      "fiber": null,
      "name": "Beef Burrito",
      "itemsCount": null,
      "reason": null,
      "hint": "Range: used the middle"
    }
  },
  {
    "id": 12,
    "title": "[Chat] Values with 'g of protein'",
    "input": "Post Workout Shake\nCalories: 350 kcal\n30 g of protein\n40 g of carbs\n8 g of fat",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 350,
      "protein": 30,
      "carbs": 40,
      "fat": 8,
      "fiber": null,
      "name": "Post Workout Shake",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 13,
    "title": "[Chat] Em dash ('Protein — 40g')",
    "input": "Greek Yogurt Bowl\nCalories — 300 kcal\nProtein — 40g\nCarbs — 25g\nFat — 5g",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 300,
      "protein": 40,
      "carbs": 25,
      "fat": 5,
      "fiber": null,
      "name": "Greek Yogurt Bowl",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 14,
    "title": "[Chat] Parenthesized unit 'Calories: 650 (kcal)'",
    "input": "Roast Beef\nCalories: 650 (kcal)\nProtein: 50g\nCarbs: 10g\nFat: 25g",
    "expected": {
      "confidence": "none",
      "ok": false,
      "calories": null,
      "protein": null,
      "carbs": null,
      "fat": null,
      "fiber": null,
      "name": null,
      "itemsCount": null,
      "reason": "KCAL_INCONSISTENT",
      "hint": null
    }
  },
  {
    "id": 15,
    "title": "[Chat] Dual energy 'Energy: 2720 kJ / 650 kcal'",
    "input": "Energy: 2720 kJ / 650 kcal\nProtein: 40g\nCarbohydrates: 55g\nFat: 22g",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 650,
      "protein": 40,
      "carbs": 55,
      "fat": 22,
      "fiber": null,
      "name": null,
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 16,
    "title": "[Nutrition label] Per serving (30 g)",
    "input": "Granola\nServing size: Per serving (30 g)\nCalories: 140\nProtein: 3g\nTotal Carbohydrate: 22g\nTotal Fat: 5g",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 140,
      "protein": 3,
      "carbs": 22,
      "fat": 5,
      "fiber": null,
      "name": "Granola",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 17,
    "title": "[Nutrition label] Per 100g + serving columns",
    "input": "Protein Bar\nNutrition Facts\nPer 100g / Per serving (60g)\nCalories: 380 kcal / 228 kcal\nProtein: 33g / 20g\nCarbohydrate: 35g / 21g\nFat: 12g / 7.2g",
    "expected": {
      "confidence": "none",
      "ok": false,
      "calories": null,
      "protein": null,
      "carbs": null,
      "fat": null,
      "fiber": null,
      "name": "Protein Bar",
      "itemsCount": null,
      "reason": "SECOND_CALORIES_LINE",
      "hint": null
    }
  },
  {
    "id": 18,
    "title": "[Nutrition label] %DV header and percentage rows",
    "input": "Nutrition Facts\nServing Size 1 can\nAmount Per Serving\nCalories 140\n% Daily Value*\nTotal Fat 0g 0%\nTotal Carbohydrate 39g 14%\nProtein 0g 0%",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 140,
      "protein": 0,
      "carbs": 39,
      "fat": 0,
      "fiber": null,
      "name": null,
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 19,
    "title": "[Nutrition label] US-label style 'Total Fat 8g 10%'",
    "input": "Nutrition Facts\nCalories 250\nTotal Fat 8g 10%\nTotal Carbohydrate 34g 12%\nProtein 10g 20%\nDietary Fiber 3g 11%",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 250,
      "protein": 10,
      "carbs": 34,
      "fat": 8,
      "fiber": 3,
      "name": null,
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 20,
    "title": "[Nutrition label] Label with noise lines (Sat Fat, Sugars, Sodium)",
    "input": "Protein Bar\nCalories: 210\nTotal Fat: 7g\nSaturated Fat: 2.5g\nTrans Fat: 0g\nCholesterol: 5mg\nSodium: 200mg\nTotal Carbohydrate: 24g\nDietary Fiber: 10g\nSugars: 2g\nProtein: 20g",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 210,
      "protein": 20,
      "carbs": 24,
      "fat": 7,
      "fiber": 10,
      "name": "Protein Bar",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 21,
    "title": "[Numbers/locale] Decimal comma '12,5 g'",
    "input": "Oatmeal\nCalories: 250 kcal\nProtein: 12,5 g\nCarbs: 40,5 g\nFat: 4,2 g",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 250,
      "protein": 12.5,
      "carbs": 40.5,
      "fat": 4.2,
      "fiber": null,
      "name": "Oatmeal",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 22,
    "title": "[Numbers/locale] Thousands comma '1,200 kcal'",
    "input": "Mass Gainer Shake\nCalories: 1,200 kcal\nProtein: 50 g\nCarbs: 220 g\nFat: 15 g",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 1200,
      "protein": 50,
      "carbs": 220,
      "fat": 15,
      "fiber": null,
      "name": "Mass Gainer Shake",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 23,
    "title": "[Numbers/locale] EU thousands dot '1.200 kcal'",
    "input": "Mass Gainer Shake\nCalories: 1.200 kcal\nProtein: 50 g\nCarbs: 220 g\nFat: 15 g",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 1200,
      "protein": 50,
      "carbs": 220,
      "fat": 15,
      "fiber": null,
      "name": "Mass Gainer Shake",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 24,
    "title": "[Numbers/locale] Capital 'Cal' unit",
    "input": "Almonds\nEnergy: 160 Cal\nProtein: 6 g\nCarbs: 6 g\nFat: 14 g",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 160,
      "protein": 6,
      "carbs": 6,
      "fat": 14,
      "fiber": null,
      "name": "Almonds",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 25,
    "title": "[Numbers/locale] Plural 'cals' unit",
    "input": "Almonds\n300 cals\nProtein: 10g\nCarbs: 20g\nFat: 20g",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 300,
      "protein": 10,
      "carbs": 20,
      "fat": 20,
      "fiber": null,
      "name": null,
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 26,
    "title": "[Plain text] Plain text '2 eggs and toast'",
    "input": "2 eggs and toast",
    "expected": {
      "confidence": "none",
      "ok": false,
      "calories": null,
      "protein": null,
      "carbs": null,
      "fat": null,
      "fiber": null,
      "name": null,
      "itemsCount": null,
      "reason": "NOT_A_NUTRITION_BLOCK",
      "hint": null
    }
  },
  {
    "id": 27,
    "title": "[Plain text] Plain text 'chicken 200g rice 150g'",
    "input": "chicken 200g rice 150g",
    "expected": {
      "confidence": "none",
      "ok": false,
      "calories": null,
      "protein": null,
      "carbs": null,
      "fat": null,
      "fiber": null,
      "name": null,
      "itemsCount": null,
      "reason": "NOT_A_NUTRITION_BLOCK",
      "hint": null
    }
  },
  {
    "id": 28,
    "title": "[Plain text] One-liner 'Protein bar 220 kcal 20P 22C 6F'",
    "input": "Protein bar 220 kcal 20P 22C 6F",
    "expected": {
      "confidence": "none",
      "ok": false,
      "calories": null,
      "protein": null,
      "carbs": null,
      "fat": null,
      "fiber": null,
      "name": null,
      "itemsCount": null,
      "reason": "UNEXPLAINED_CONTENT",
      "hint": null
    }
  },
  {
    "id": 29,
    "title": "[Plain text] Compact shorthand '220kcal/20p/22c/6f'",
    "input": "220kcal/20p/22c/6f",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 220,
      "protein": 20,
      "carbs": 22,
      "fat": 6,
      "fiber": null,
      "name": null,
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 30,
    "title": "[Plain text] Pipe shorthand '350 kcal | 30g protein | 40g carbs | 8g fat'",
    "input": "350 kcal | 30g protein | 40g carbs | 8g fat",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 350,
      "protein": 30,
      "carbs": 40,
      "fat": 8,
      "fiber": null,
      "name": null,
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 31,
    "title": "[Adversarial] Two meals in one paste",
    "input": "Breakfast:\nCalories: 400\nProtein: 30g\nCarbs: 40g\nFat: 12g\n\nLunch:\nCalories: 600\nProtein: 45g\nCarbs: 60g\nFat: 20g",
    "expected": {
      "confidence": "none",
      "ok": false,
      "calories": null,
      "protein": null,
      "carbs": null,
      "fat": null,
      "fiber": null,
      "name": null,
      "itemsCount": null,
      "reason": "Looks like more than one meal: log them one at a time",
      "hint": null
    }
  },
  {
    "id": 32,
    "title": "[Adversarial] Totals mismatch items (off by 100 kcal)",
    "input": "Food: Lunch Platter\n- Grilled Chicken | 200 kcal | 40g P | 0g C | 4g F\n- Steamed Rice | 200 kcal | 4g P | 44g C | 0.5g F\nTotal Calories: 500 kcal\nTotal Protein: 44g\nTotal Carbs: 44g\nTotal Fat: 4.5g",
    "expected": {
      "confidence": "lenient",
      "ok": true,
      "calories": 400,
      "protein": 44,
      "carbs": 44,
      "fat": 4.5,
      "fiber": null,
      "name": null,
      "itemsCount": 2,
      "reason": null,
      "hint": "Items add up to 400, total says 500"
    }
  },
  {
    "id": 33,
    "title": "[Adversarial] Negative numbers",
    "input": "Diet Soda\nCalories: -5 kcal\nProtein: -1g\nCarbs: 0g\nFat: 0g",
    "expected": {
      "confidence": "none",
      "ok": false,
      "calories": null,
      "protein": null,
      "carbs": null,
      "fat": null,
      "fiber": null,
      "name": null,
      "itemsCount": null,
      "reason": "VALUE_OUT_OF_RANGE",
      "hint": null
    }
  },
  {
    "id": 34,
    "title": "[Adversarial] Huge numbers (99999 kcal)",
    "input": "Feast\nCalories: 99999 kcal\nProtein: 2000g\nCarbs: 5000g\nFat: 1000g",
    "expected": {
      "confidence": "none",
      "ok": false,
      "calories": null,
      "protein": null,
      "carbs": null,
      "fat": null,
      "fiber": null,
      "name": null,
      "itemsCount": null,
      "reason": "VALUE_OUT_OF_RANGE",
      "hint": null
    }
  },
  {
    "id": 35,
    "title": "[Adversarial] Empty macro (Fat: ?)",
    "input": "Protein Snack\nCalories: 250 kcal\nProtein: 20g\nCarbs: 25g\nFat: ?",
    "expected": {
      "confidence": "partial",
      "ok": false,
      "calories": null,
      "protein": null,
      "carbs": null,
      "fat": null,
      "fiber": null,
      "name": null,
      "itemsCount": null,
      "reason": "MISSING_MACRO",
      "hint": null
    }
  },
  {
    "id": 36,
    "title": "[Adversarial] Duplicated lines (Protein 30g / Protein 45g)",
    "input": "Chicken Salad\nCalories: 350\nProtein: 30g\nProtein: 45g\nCarbs: 10g\nFat: 15g",
    "expected": {
      "confidence": "none",
      "ok": false,
      "calories": null,
      "protein": null,
      "carbs": null,
      "fat": null,
      "fiber": null,
      "name": null,
      "itemsCount": null,
      "reason": "DUPLICATE_MACRO",
      "hint": null
    }
  },
  {
    "id": 37,
    "title": "[Adversarial] Windows CRLF line endings",
    "input": "Chicken Salad\nCalories: 350\nProtein: 30g\nCarbs: 10g\nFat: 15g",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 350,
      "protein": 30,
      "carbs": 10,
      "fat": 15,
      "fiber": null,
      "name": "Chicken Salad",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 38,
    "title": "[Adversarial] Excessive leading/trailing whitespace",
    "input": "   \n    Chicken Salad   \n   Calories: 350   \n   Protein: 30g   \n   Carbs: 10g   \n   Fat: 15g   \n   ",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 350,
      "protein": 30,
      "carbs": 10,
      "fat": 15,
      "fiber": null,
      "name": "Chicken Salad",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 39,
    "title": "[Adversarial] Non-English German labels",
    "input": "Mahlzeit\nKalorien: 450 kcal\nEiweiß: 35g\nKohlenhydrate: 50g\nFett: 12g",
    "expected": {
      "confidence": "none",
      "ok": false,
      "calories": null,
      "protein": null,
      "carbs": null,
      "fat": null,
      "fiber": null,
      "name": null,
      "itemsCount": null,
      "reason": "SECOND_CALORIES_LINE",
      "hint": null
    }
  },
  {
    "id": 40,
    "title": "[Adversarial] Non-English Vietnamese labels",
    "input": "Bữa trưa\nCalo: 500 kcal\nĐạm: 35g\nTinh bột: 60g\nChất béo: 12g",
    "expected": {
      "confidence": "none",
      "ok": false,
      "calories": null,
      "protein": null,
      "carbs": null,
      "fat": null,
      "fiber": null,
      "name": null,
      "itemsCount": null,
      "reason": "SECOND_CALORIES_LINE",
      "hint": null
    }
  },
  {
    "id": 41,
    "title": "[Adversarial] Valid fenced yourbody-v1 block",
    "input": "Here is your meal breakdown:\n```yourbody-v1\nChicken Rice Bowl\nCalories: 520 kcal\nProtein: 46g\nCarbs: 58g\nFat: 12g\n```\nHope that helps!",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 520,
      "protein": 46,
      "carbs": 58,
      "fat": 12,
      "fiber": null,
      "name": "Chicken Rice Bowl",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 42,
    "title": "[Adversarial] Fenced yourbody-v1 missing Fat field",
    "input": "Here is your meal breakdown:\n```yourbody-v1\nChicken Rice Bowl\nCalories: 520 kcal\nProtein: 46g\nCarbs: 58g\n```\nHope that helps!",
    "expected": {
      "confidence": "partial",
      "ok": false,
      "calories": null,
      "protein": null,
      "carbs": null,
      "fat": null,
      "fiber": null,
      "name": null,
      "itemsCount": null,
      "reason": "MISSING_MACRO",
      "hint": null
    }
  },
  {
    "id": 43,
    "title": "[Sweep paste-001] Lunch Combo",
    "input": "Meal: Lunch Combo\n- Chicken: 300 kcal | 50g protein | 0g carbs | 10g fat\n- Rice: 200 kcal | 4g protein | 44g carbs | 1g fat\n- Subtotal: 500 kcal | 54g protein | 44g carbs | 11g fat",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 500,
      "protein": 54,
      "carbs": 44,
      "fat": 11,
      "fiber": 0,
      "name": "Lunch Combo",
      "itemsCount": 2,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 44,
    "title": "[Sweep paste-002] Salmon Quinoa Plate",
    "input": "Meal: Salmon Quinoa Plate\n- Grilled Salmon: 340 kcal | 40g protein | 0g carbs | 20g fat\n- Quinoa and Asparagus: 220 kcal | 6g protein | 42g carbs | 2g fat\n- Sub-total: 560 kcal | 46g protein | 42g carbs | 22g fat",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 560,
      "protein": 46,
      "carbs": 42,
      "fat": 22,
      "fiber": 0,
      "name": "Salmon Quinoa Plate",
      "itemsCount": 2,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 45,
    "title": "[Sweep paste-003] Power Breakfast Bowl",
    "input": "Meal: Power Breakfast Bowl\n- Rolled Oats: 240 kcal | 8g protein | 46g carbs | 4g fat\n- Greek Yogurt & Berries: 200 kcal | 26g protein | 12g carbs | 4g fat\n- Sub total: 440 kcal | 34g protein | 58g carbs | 8g fat",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 440,
      "protein": 34,
      "carbs": 58,
      "fat": 8,
      "fiber": 0,
      "name": "Power Breakfast Bowl",
      "itemsCount": 2,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 46,
    "title": "[Sweep paste-004] Mexican Taco Plate",
    "input": "Meal: Mexican Taco Plate\n- Beef Tacos: 380 kcal | 34g protein | 32g carbs | 14g fat\n- Fresh Guacamole: 140 kcal | 4g protein | 12g carbs | 7g fat\n- Sum: 520 kcal | 38g protein | 44g carbs | 21g fat",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 520,
      "protein": 38,
      "carbs": 44,
      "fat": 21,
      "fiber": 0,
      "name": "Mexican Taco Plate",
      "itemsCount": 2,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 47,
    "title": "[Sweep paste-005] Teriyaki Chicken Bento",
    "input": "Meal: Teriyaki Chicken Bento\n- Teriyaki Chicken: 360 kcal | 42g protein | 15g carbs | 14g fat\n- Steamed Rice & Edamame: 250 kcal | 6g protein | 50g carbs | 2g fat\n- Overall: 610 kcal | 48g protein | 65g carbs | 16g fat",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 610,
      "protein": 48,
      "carbs": 65,
      "fat": 16,
      "fiber": 0,
      "name": "Teriyaki Chicken Bento",
      "itemsCount": 2,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 48,
    "title": "[Sweep paste-006] Ribeye Steak Dinner",
    "input": "Meal: Ribeye Steak Dinner\n- Ribeye Steak: 460 kcal | 54g protein | 0g carbs | 28g fat\n- Loaded Baked Potato: 220 kcal | 4g protein | 42g carbs | 2g fat\n- Meal total: 680 kcal | 58g protein | 42g carbs | 30g fat",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 680,
      "protein": 58,
      "carbs": 42,
      "fat": 30,
      "fiber": 0,
      "name": "Ribeye Steak Dinner",
      "itemsCount": 2,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 49,
    "title": "[Sweep paste-007] Turkey Sweet Potato Meal",
    "input": "Meal: Turkey Sweet Potato Meal\n- Roast Turkey Breast: 260 kcal | 42g protein | 0g carbs | 6g fat\n- Mashed Sweet Potato: 220 kcal | 4g protein | 52g carbs | 2g fat\n- Combined: 480 kcal | 46g protein | 52g carbs | 8g fat",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 480,
      "protein": 46,
      "carbs": 52,
      "fat": 8,
      "fiber": 0,
      "name": "Turkey Sweet Potato Meal",
      "itemsCount": 2,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 50,
    "title": "[Sweep paste-008] Italian Seafood Course",
    "input": "Meal: Italian Seafood Course\n- Minestrone Soup: 160 kcal | 6g protein | 28g carbs | 3g fat\n- Pan Seared Sea Bass: 380 kcal | 42g protein | 10g carbs | 17g fat\n- Course total: 540 kcal | 48g protein | 38g carbs | 20g fat",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 540,
      "protein": 48,
      "carbs": 38,
      "fat": 20,
      "fiber": 0,
      "name": "Italian Seafood Course",
      "itemsCount": 2,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 51,
    "title": "[Sweep paste-009] Deli Roast Beef Lunch",
    "input": "Meal: Deli Roast Beef Lunch\n- Roast Beef Sub: 430 kcal | 40g protein | 42g carbs | 12g fat\n- Baked Kettle Chips: 160 kcal | 4g protein | 14g carbs | 9g fat\n- Section total: 590 kcal | 44g protein | 56g carbs | 21g fat",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 590,
      "protein": 44,
      "carbs": 56,
      "fat": 21,
      "fiber": 0,
      "name": "Deli Roast Beef Lunch",
      "itemsCount": 2,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 52,
    "title": "[Sweep paste-010] Smoked Pulled Pork Plate",
    "input": "Meal: Smoked Pulled Pork Plate\n- Smoked Pulled Pork: 420 kcal | 38g protein | 12g carbs | 24g fat\n- Southern Cornbread: 210 kcal | 4g protein | 36g carbs | 6g fat\n- Items total: 630 kcal | 42g protein | 48g carbs | 30g fat",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 630,
      "protein": 42,
      "carbs": 48,
      "fat": 30,
      "fiber": 0,
      "name": "Smoked Pulled Pork Plate",
      "itemsCount": 2,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 53,
    "title": "[Sweep paste-011] Spaghetti Bolognese Dinner",
    "input": "Meal: Spaghetti Bolognese Dinner\n- Spaghetti with Bolognese: 480 kcal | 32g protein | 62g carbs | 11g fat\n- Garlic Toast: 160 kcal | 4g protein | 14g carbs | 9g fat\n- Total meal: 640 kcal | 36g protein | 76g carbs | 20g fat",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 640,
      "protein": 36,
      "carbs": 76,
      "fat": 20,
      "fiber": 0,
      "name": "Spaghetti Bolognese Dinner",
      "itemsCount": 2,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 54,
    "title": "[Sweep paste-012] Sunday Roast Chicken Feast",
    "input": "Meal: Sunday Roast Chicken Feast\n- Half Roast Chicken: 420 kcal | 48g protein | 0g carbs | 20g fat\n- Mashed Potatoes and Gravy: 200 kcal | 4g protein | 50g carbs | 2g fat\n- Grand total: 620 kcal | 52g protein | 50g carbs | 22g fat",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 620,
      "protein": 52,
      "carbs": 50,
      "fat": 22,
      "fiber": 0,
      "name": "Sunday Roast Chicken Feast",
      "itemsCount": 2,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 55,
    "title": "[Sweep paste-013] Post Workout Gym Shake",
    "input": "Food: Post Workout Gym Shake\nProtein: 200 kcal | 40g protein | 0g carbs | 3g fat\n- Oats: 150 kcal | 5g protein | 27g carbs | 3g fat\n- Milk: 120 kcal | 8g protein | 12g carbs | 2g fat",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 470,
      "protein": 53,
      "carbs": 39,
      "fat": 8,
      "fiber": 0,
      "name": "Post Workout Gym Shake",
      "itemsCount": 3,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 56,
    "title": "[Sweep paste-014] Keto Power Breakfast",
    "input": "Meal: Keto Power Breakfast\nFat: 180 kcal | 0g protein | 0g carbs | 20g fat\n- Scrambled Eggs: 240 kcal | 18g protein | 2g carbs | 18g fat\n- Bacon Strips: 220 kcal | 16g protein | 1g carbs | 17g fat",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 640,
      "protein": 34,
      "carbs": 3,
      "fat": 55,
      "fiber": 0,
      "name": "Keto Power Breakfast",
      "itemsCount": 3,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 57,
    "title": "[Sweep paste-015] Carb Loader Shake",
    "input": "Meal: Carb Loader Shake\nCarbs: 180 kcal | 0g protein | 45g carbs | 0g fat\n- Whey Isolate: 180 kcal | 40g protein | 2g carbs | 1g fat\n- Banana Slice: 100 kcal | 2g protein | 15g carbs | 2g fat",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 460,
      "protein": 42,
      "carbs": 62,
      "fat": 3,
      "fiber": 0,
      "name": "Carb Loader Shake",
      "itemsCount": 3,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 58,
    "title": "[Sweep paste-016] Athlete Oatmeal Bowl",
    "input": "Food: Athlete Oatmeal Bowl\nProt: 200 kcal | 44g protein | 0g carbs | 2g fat\n- Steel Cut Oats: 180 kcal | 5g protein | 36g carbs | 3g fat\n- Wild Blueberries: 70 kcal | 1g protein | 12g carbs | 1g fat",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 450,
      "protein": 50,
      "carbs": 48,
      "fat": 6,
      "fiber": 0,
      "name": "Athlete Oatmeal Bowl",
      "itemsCount": 3,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 59,
    "title": "[Sweep paste-017] High Protein Snack",
    "input": "Food: High Protein Snack\nProtein: 140 kcal | 30g protein | 1g carbs | 1g fat\n- Almond Milk: 120 kcal | 4g protein | 15g carbs | 4g fat",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 260,
      "protein": 34,
      "carbs": 16,
      "fat": 5,
      "fiber": 0,
      "name": "High Protein Snack",
      "itemsCount": 2,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 60,
    "title": "[Sweep paste-018] Steak and Rice Dinner",
    "input": "Meal: Steak and Rice Dinner\n- Sirloin Steak: 600 kcal | 50g protein | 0g carbs | 20g fat\n- White Rice: 200 kcal | 4g protein | 44g carbs | 1g fat",
    "expected": {
      "confidence": "none",
      "ok": false,
      "calories": null,
      "protein": null,
      "carbs": null,
      "fat": null,
      "fiber": null,
      "name": null,
      "itemsCount": null,
      "reason": "Unreadable line: - Sirloin Steak: 600 kcal | 50g protein ...",
      "hint": null
    }
  },
  {
    "id": 61,
    "title": "[Sweep paste-019] Burger and Fries Lunch",
    "input": "Meal: Burger and Fries Lunch\n- Cheeseburger: 850 kcal | 40g protein | 18g carbs | 25g fat\n- French Fries: 300 kcal | 4g protein | 40g carbs | 11g fat",
    "expected": {
      "confidence": "none",
      "ok": false,
      "calories": null,
      "protein": null,
      "carbs": null,
      "fat": null,
      "fiber": null,
      "name": null,
      "itemsCount": null,
      "reason": "Unreadable line: - Cheeseburger: 850 kcal | 40g protein |...",
      "hint": null
    }
  },
  {
    "id": 62,
    "title": "[Sweep paste-020] Salmon Broccoli Plate",
    "input": "Meal: Salmon Broccoli Plate\n- Atlantic Salmon: 600 kcal | 40g protein | 0g carbs | 20g fat\n- Steamed Broccoli: 60 kcal | 4g protein | 10g carbs | 0g fat",
    "expected": {
      "confidence": "none",
      "ok": false,
      "calories": null,
      "protein": null,
      "carbs": null,
      "fat": null,
      "fiber": null,
      "name": null,
      "itemsCount": null,
      "reason": "Unreadable line: - Atlantic Salmon: 600 kcal | 40g protei...",
      "hint": null
    }
  },
  {
    "id": 63,
    "title": "[Sweep paste-025] Bulking Shake Combo",
    "input": "Meal: Bulking Shake Combo\n- Mass Gainer: 1,000 kcal | 50g protein | 150g carbs | 20g fat\n- Whole Milk: 150 kcal | 8g protein | 12g carbs | 8g fat",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 1150,
      "protein": 58,
      "carbs": 162,
      "fat": 28,
      "fiber": 0,
      "name": "Bulking Shake Combo",
      "itemsCount": 2,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 64,
    "title": "[Sweep paste-026] Gym Snack Combo",
    "input": "Meal: Gym Snack Combo\n- Mega Shake: 1.000 kcal | 45g protein | 130g carbs | 25g fat\n- Protein Cookie: 250 kcal | 15g protein | 30g carbs | 7g fat",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 1250,
      "protein": 60,
      "carbs": 160,
      "fat": 32,
      "fiber": 0,
      "name": "Gym Snack Combo",
      "itemsCount": 2,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 65,
    "title": "[Sweep paste-027] Mass Gainer Meal",
    "input": "Mass Gainer Meal\nCalories: 2,000 kcal\nProtein: 70g\nCarbs: 300g\nFat: 50g",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 2000,
      "protein": 70,
      "carbs": 300,
      "fat": 50,
      "fiber": null,
      "name": "Mass Gainer Meal",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 66,
    "title": "[Sweep paste-028] Giant Cheat Burger",
    "input": "Giant Cheat Burger\nCalories: 1,500 kcal\nProtein: 70g\nCarbs: 140g\nFat: 65g",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 1500,
      "protein": 70,
      "carbs": 140,
      "fat": 65,
      "fiber": null,
      "name": "Giant Cheat Burger",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 67,
    "title": "[Sweep paste-029] Chipotle Chicken Burrito",
    "input": "Chipotle Chicken Burrito\nCalories: 800 kcal\nProtein: 48g\nCarbs: 90g\nFat: 26g\nate half",
    "expected": {
      "confidence": "lenient",
      "ok": true,
      "calories": 800,
      "protein": 48,
      "carbs": 90,
      "fat": 26,
      "fiber": null,
      "name": "Chipotle Chicken Burrito",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 68,
    "title": "[Sweep paste-030] Double Bacon Cheeseburger",
    "input": "Double Bacon Cheeseburger\nCalories: 700 kcal\nProtein: 48g\nCarbs: 44g\nFat: 36g\nhad half",
    "expected": {
      "confidence": "lenient",
      "ok": true,
      "calories": 700,
      "protein": 48,
      "carbs": 44,
      "fat": 36,
      "fiber": null,
      "name": "Double Bacon Cheeseburger",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 69,
    "title": "[Sweep paste-031] Fettuccine Alfredo",
    "input": "Fettuccine Alfredo\nCalories: 750 kcal\nProtein: 22g\nCarbs: 84g\nFat: 38g\nhalf portion",
    "expected": {
      "confidence": "lenient",
      "ok": true,
      "calories": 750,
      "protein": 22,
      "carbs": 84,
      "fat": 38,
      "fiber": null,
      "name": "Fettuccine Alfredo",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 70,
    "title": "[Sweep paste-032] New York Strip and Fries",
    "input": "New York Strip and Fries\nCalories: 900 kcal\nProtein: 56g\nCarbs: 52g\nFat: 48g\nhalf",
    "expected": {
      "confidence": "none",
      "ok": false,
      "calories": null,
      "protein": null,
      "carbs": null,
      "fat": null,
      "fiber": null,
      "name": null,
      "itemsCount": null,
      "reason": "NAME_MULTIPLE_ITEMS",
      "hint": null
    }
  },
  {
    "id": 71,
    "title": "[Sweep paste-033] Large Pepperoni Pizza",
    "input": "Large Pepperoni Pizza\nCalories: 1200 kcal\nProtein: 52g\nCarbs: 128g\nFat: 52g\n1/2",
    "expected": {
      "confidence": "lenient",
      "ok": true,
      "calories": 1200,
      "protein": 52,
      "carbs": 128,
      "fat": 52,
      "fiber": null,
      "name": "Large Pepperoni Pizza",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 72,
    "title": "[Sweep paste-034] Protein Crunch Bar",
    "input": "Protein Crunch Bar\nCalories: 210 kcal\nProtein: 20g\nCarbs: 18g\nFat: 8g\nx2",
    "expected": {
      "confidence": "lenient",
      "ok": true,
      "calories": 210,
      "protein": 20,
      "carbs": 18,
      "fat": 8,
      "fiber": null,
      "name": "Protein Crunch Bar",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 73,
    "title": "[Sweep paste-035] Egg and Sausage Sandwich",
    "input": "Egg and Sausage Sandwich\nCalories: 380 kcal\nProtein: 18g\nCarbs: 30g\nFat: 20g\n2x",
    "expected": {
      "confidence": "none",
      "ok": false,
      "calories": null,
      "protein": null,
      "carbs": null,
      "fat": null,
      "fiber": null,
      "name": null,
      "itemsCount": null,
      "reason": "NAME_MULTIPLE_ITEMS",
      "hint": null
    }
  },
  {
    "id": 74,
    "title": "[Sweep paste-036] Baja Fish Taco",
    "input": "Baja Fish Taco\nCalories: 240 kcal\nProtein: 16g\nCarbs: 24g\nFat: 9g\ntwo of",
    "expected": {
      "confidence": "lenient",
      "ok": true,
      "calories": 240,
      "protein": 16,
      "carbs": 24,
      "fat": 9,
      "fiber": null,
      "name": "Baja Fish Taco",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 75,
    "title": "[Sweep paste-037] Chocolate Whey Isolate",
    "input": "Chocolate Whey Isolate\nCalories: 130 kcal\nProtein: 26g\nCarbs: 2g\nFat: 1g\ndouble",
    "expected": {
      "confidence": "lenient",
      "ok": true,
      "calories": 130,
      "protein": 26,
      "carbs": 2,
      "fat": 1,
      "fiber": null,
      "name": "Chocolate Whey Isolate",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 76,
    "title": "[Sweep paste-038] Coconut Chicken Curry",
    "input": "Coconut Chicken Curry\nPer 100g\nConsumed Weight: 250g\nCalories: 150 kcal\nProtein: 12g\nCarbs: 8g\nFat: 7.5g",
    "expected": {
      "confidence": "lenient",
      "ok": true,
      "calories": 150,
      "protein": 12,
      "carbs": 8,
      "fat": 7.5,
      "fiber": null,
      "name": "Coconut Chicken Curry",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 77,
    "title": "[Sweep paste-073] Roast Turkey Breast",
    "input": "Roast Turkey Breast\nCalories: 220 kcal\nProtien: 42g\nCarbs: 0g\nFat: 5g",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 220,
      "protein": 42,
      "carbs": 0,
      "fat": 5,
      "fiber": null,
      "name": "Roast Turkey Breast",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 78,
    "title": "[Sweep paste-074] Greek Yogurt Bowl",
    "input": "Greek Yogurt Bowl\n520 kcals\nProtein: 40g\nCarbs: 35g\nFat: 12g",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 520,
      "protein": 40,
      "carbs": 35,
      "fat": 12,
      "fiber": null,
      "name": "Greek Yogurt Bowl",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 79,
    "title": "[Sweep paste-076] Grilled Sirloin Steak",
    "input": "8 oz Grilled Sirloin Steak: 48g protein, 0g carbs, 18g fat, 360 kcal",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 360,
      "protein": 48,
      "carbs": 0,
      "fat": 18,
      "fiber": null,
      "name": "Grilled Sirloin Steak",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 80,
    "title": "[Sweep paste-079] Roast Turkey Slices",
    "input": "Roast Turkey Slices\nCalories: 320 (kcal)\nProtein: 45g\nCarbs: 0g\nFat: 14g",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 320,
      "protein": 45,
      "carbs": 0,
      "fat": 14,
      "fiber": null,
      "name": "Roast Turkey Slices",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 81,
    "title": "[Sweep paste-080] Tuna Salad Plate",
    "input": "Tuna Salad Plate\nCalories: 350 kcal\n35 g of protein\n12 g of carbs\n18 g of fat",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 350,
      "protein": 35,
      "carbs": 12,
      "fat": 18,
      "fiber": null,
      "name": "Tuna Salad Plate",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 82,
    "title": "[Sweep paste-081] European Muesli",
    "input": "European Muesli\nEnergy: 2100 kJ\nProtein: 35g\nCarbs: 55g\nFat: 15g",
    "expected": {
      "confidence": "none",
      "ok": false,
      "calories": null,
      "protein": null,
      "carbs": null,
      "fat": null,
      "fiber": null,
      "name": null,
      "itemsCount": null,
      "reason": "KJ_WITHOUT_KCAL",
      "hint": null
    }
  },
  {
    "id": 83,
    "title": "[Sweep paste-082] Power Protein Oats",
    "input": "Power Protein Oats\n🔥 Calories: 520\n💪 Protein: 42g\n🌾 Carbs: 48g\n🥑 Fat: 16g",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 520,
      "protein": 42,
      "carbs": 48,
      "fat": 16,
      "fiber": null,
      "name": "Power Protein Oats",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 84,
    "title": "[Sweep paste-083] Chipotle Burrito Bowl",
    "input": "Chipotle Burrito Bowl\nCalories: 600-700 kcal\nProtein: 40-50g\nCarbs: 60-70g\nFat: 18-24g",
    "expected": {
      "confidence": "lenient",
      "ok": true,
      "calories": 650,
      "protein": 45,
      "carbs": 65,
      "fat": 21,
      "fiber": null,
      "name": "Chipotle Burrito Bowl",
      "itemsCount": null,
      "reason": null,
      "hint": "Range: used the middle"
    }
  },
  {
    "id": 85,
    "title": "[Sweep paste-084] Beef Stir Fry",
    "input": "Beef Stir Fry\nCalories: 550–650 kcal\nProtein: 35–45g\nCarbs: 45–55g\nFat: 20–25g",
    "expected": {
      "confidence": "lenient",
      "ok": true,
      "calories": 600,
      "protein": 40,
      "carbs": 50,
      "fat": 22.5,
      "fiber": null,
      "name": "Beef Stir Fry",
      "itemsCount": null,
      "reason": null,
      "hint": "Range: used the middle"
    }
  },
  {
    "id": 86,
    "title": "[Sweep paste-085] Chicken Caesar Salad",
    "input": "Chicken Caesar Salad\nCalories: 450 to 550 kcal\nProtein: 30 to 40g\nCarbs: 15 to 25g\nFat: 25 to 30g",
    "expected": {
      "confidence": "lenient",
      "ok": true,
      "calories": 500,
      "protein": 35,
      "carbs": 20,
      "fat": 27.5,
      "fiber": null,
      "name": "Chicken Caesar Salad",
      "itemsCount": null,
      "reason": null,
      "hint": "Range: used the middle"
    }
  },
  {
    "id": 87,
    "title": "[Sweep paste-089] Salmon Teriyaki Bowl",
    "input": "Salmon Teriyaki Bowl\nCalories: 600 kcal\nProtein: 40-45g\nCarbs: 55g\nFat: 20g",
    "expected": {
      "confidence": "lenient",
      "ok": true,
      "calories": 600,
      "protein": 42.5,
      "carbs": 55,
      "fat": 20,
      "fiber": null,
      "name": "Salmon Teriyaki Bowl",
      "itemsCount": null,
      "reason": null,
      "hint": "Range: used the middle"
    }
  },
  {
    "id": 88,
    "title": "[Sweep paste-090] Buffet Plate Mix",
    "input": "Buffet Plate Mix\nCalories: 800+ kcal\nProtein: 50+ g\nCarbs: 80g\nFat: 30g",
    "expected": {
      "confidence": "lenient",
      "ok": true,
      "calories": 800,
      "protein": 50,
      "carbs": 80,
      "fat": 30,
      "fiber": null,
      "name": "Buffet Plate Mix",
      "itemsCount": null,
      "reason": null,
      "hint": "Range: used the middle"
    }
  },
  {
    "id": 89,
    "title": "[Sweep paste-101] Full Day Meal Plan",
    "input": "Meal: Today Food\n- Breakfast: 320 kcal | 24g P | 30g C | 10g F\n- Lunch: 540 kcal | 42g P | 48g C | 18g F",
    "expected": {
      "confidence": "none",
      "ok": false,
      "calories": null,
      "protein": null,
      "carbs": null,
      "fat": null,
      "fiber": null,
      "name": null,
      "itemsCount": null,
      "reason": "Looks like more than one meal: log them one at a time",
      "hint": null
    }
  },
  {
    "id": 90,
    "title": "[Sweep paste-102] All Day Meal Log",
    "input": "Food: All Day Log\n- Breakfast eggs and toast: 350 kcal | 22g P | 28g C | 16g F\n- Lunch chicken rice: 520 kcal | 45g P | 50g C | 14g F\n- Dinner salmon potato: 580 kcal | 48g P | 42g C | 22g F",
    "expected": {
      "confidence": "none",
      "ok": false,
      "calories": null,
      "protein": null,
      "carbs": null,
      "fat": null,
      "fiber": null,
      "name": null,
      "itemsCount": null,
      "reason": "Looks like more than one meal: log them one at a time",
      "hint": null
    }
  },
  {
    "id": 91,
    "title": "[Sweep paste-105] Breakfast and Lunch Bullets",
    "input": "* Breakfast: 400 kcal, 30g P, 40g C, 12g F\n* Lunch: 600 kcal, 45g P, 60g C, 18g F",
    "expected": {
      "confidence": "none",
      "ok": false,
      "calories": null,
      "protein": null,
      "carbs": null,
      "fat": null,
      "fiber": null,
      "name": null,
      "itemsCount": null,
      "reason": "Looks like more than one meal: log them one at a time",
      "hint": null
    }
  },
  {
    "id": 92,
    "title": "[Sweep paste-107] Daily Meal Schedule",
    "input": "Food: Daily Totals\n- Morning Smoothie: 280 kcal | 25g P | 35g C | 4g F\n- Afternoon Wrap: 450 kcal | 35g P | 40g C | 15g F\n- Evening Stirfry: 520 kcal | 42g P | 48g C | 16g F",
    "expected": {
      "confidence": "none",
      "ok": false,
      "calories": null,
      "protein": null,
      "carbs": null,
      "fat": null,
      "fiber": null,
      "name": null,
      "itemsCount": null,
      "reason": "Looks like more than one meal: log them one at a time",
      "hint": null
    }
  },
  {
    "id": 93,
    "title": "[Sweep paste-109] Numbered Meal List",
    "input": "1. Breakfast shake: 320 kcal | 30g P | 35g C | 5g F\n2. Dinner bowl: 640 kcal | 50g P | 60g C | 20g F",
    "expected": {
      "confidence": "none",
      "ok": false,
      "calories": null,
      "protein": null,
      "carbs": null,
      "fat": null,
      "fiber": null,
      "name": null,
      "itemsCount": null,
      "reason": "Looks like more than one meal: log them one at a time",
      "hint": null
    }
  },
  {
    "id": 94,
    "title": "[Lead-in Paste] Snack breakdown with lead-in and sign-off",
    "input": "Here is my snack breakdown:\nProtein bar\nCalories: 220 kcal\nProtein: 20g\nCarbs: 22g\nFat: 6g\nHope this helps!",
    "expected": {
      "confidence": "lenient",
      "ok": true,
      "calories": 220,
      "protein": 20,
      "carbs": 22,
      "fat": 6,
      "fiber": null,
      "name": "Protein bar",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 95,
    "title": "[Lead-in Paste] Lunch breakdown with conversational lead-in and sign-off",
    "input": "Sure! Here's the breakdown for your lunch:\nChicken Rice Bowl\nCalories: 520 kcal\nProtein: 46g\nCarbs: 58g\nFat: 12g\nHope that helps!",
    "expected": {
      "confidence": "lenient",
      "ok": true,
      "calories": 520,
      "protein": 46,
      "carbs": 58,
      "fat": 12,
      "fiber": null,
      "name": "Chicken Rice Bowl",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 96,
    "title": "[Lead-in Paste] Protein bar without lead-in",
    "input": "Protein bar\nCalories: 220 kcal\nProtein: 20g\nCarbs: 22g\nFat: 6g",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 220,
      "protein": 20,
      "carbs": 22,
      "fat": 6,
      "fiber": null,
      "name": "Protein bar",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 97,
    "title": "[Sweep paste2-010] Cheeseburger Plate (Quantity: 2)",
    "input": "Cheeseburger Plate\nCalories: 300 kcal\nProtein: 15g\nCarbs: 25g\nFat: 12g\nQuantity: 2",
    "expected": {
      "confidence": "lenient",
      "ok": true,
      "calories": 300,
      "protein": 15,
      "carbs": 25,
      "fat": 12,
      "fiber": null,
      "name": "Cheeseburger Plate",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 98,
    "title": "[Sweep paste2-011] Chicken Rice Bowl (Servings: 2)",
    "input": "Chicken Rice Bowl\nCalories: 400 kcal\nProtein: 40g\nCarbs: 45g\nFat: 7g\nServings: 2",
    "expected": {
      "confidence": "lenient",
      "ok": true,
      "calories": 400,
      "protein": 40,
      "carbs": 45,
      "fat": 7,
      "fiber": null,
      "name": "Chicken Rice Bowl",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 99,
    "title": "[Sweep paste2-012] Meal Prep Beef Stew (Servings: 4)",
    "input": "Meal Prep Beef Stew\nServings: 4\nCalories: 1600 kcal\nProtein: 140g\nCarbs: 180g\nFat: 32g",
    "expected": {
      "confidence": "lenient",
      "ok": true,
      "calories": 1600,
      "protein": 140,
      "carbs": 180,
      "fat": 32,
      "fiber": null,
      "name": "Meal Prep Beef Stew",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 100,
    "title": "[Sweep paste2-013] Turkey Wrap (2x servings)",
    "input": "Turkey Wrap\nCalories: 450 kcal\nProtein: 38g\nCarbs: 46g\nFat: 12g\n2x servings",
    "expected": {
      "confidence": "lenient",
      "ok": true,
      "calories": 450,
      "protein": 38,
      "carbs": 46,
      "fat": 12,
      "fiber": null,
      "name": "Turkey Wrap",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 101,
    "title": "[Sweep paste2-015] Zone Balance Plate (Percent macros)",
    "input": "Zone Balance Plate\nCalories: 500 kcal\nProtein: 40%\nCarbs: 40%\nFat: 20%",
    "expected": {
      "confidence": "partial",
      "ok": false,
      "calories": 500,
      "protein": 0,
      "carbs": 0,
      "fat": 0,
      "fiber": null,
      "name": "Zone Balance Plate",
      "itemsCount": null,
      "reason": "MISSING_MACRO",
      "hint": null
    }
  },
  {
    "id": 102,
    "title": "[Sweep paste2-016] Power Macro Bowl (Percent macros)",
    "input": "Power Macro Bowl\nCalories: 550 kcal\nProtein: 30%\nCarbs: 40%\nFat: 30%",
    "expected": {
      "confidence": "partial",
      "ok": false,
      "calories": 550,
      "protein": 0,
      "carbs": 0,
      "fat": 0,
      "fiber": null,
      "name": "Power Macro Bowl",
      "itemsCount": null,
      "reason": "MISSING_MACRO",
      "hint": null
    }
  },
  {
    "id": 103,
    "title": "[Sweep paste2-017] Keto Salmon Bowl (Percent macros)",
    "input": "Keto Salmon Bowl\nCalories: 600 kcal\nProtein: 20%\nCarbs: 40%\nFat: 40%",
    "expected": {
      "confidence": "partial",
      "ok": false,
      "calories": 600,
      "protein": 0,
      "carbs": 0,
      "fat": 0,
      "fiber": null,
      "name": "Keto Salmon Bowl",
      "itemsCount": null,
      "reason": "MISSING_MACRO",
      "hint": null
    }
  },
  {
    "id": 104,
    "title": "[Coverage] Case-insensitive calorie unit CAL",
    "input": "Turkey Wrap\nCalories: 420 CAL\nProtein: 35g\nCarbs: 45g\nFat: 10g",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 420,
      "protein": 35,
      "carbs": 45,
      "fat": 10,
      "fiber": null,
      "name": "Turkey Wrap",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 105,
    "title": "[Coverage] Case-insensitive calorie unit kcals",
    "input": "Protein Smoothie\nEnergy: 310 kcals\nProtein: 30g\nCarbs: 25g\nFat: 5g",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 310,
      "protein": 30,
      "carbs": 25,
      "fat": 5,
      "fiber": null,
      "name": "Protein Smoothie",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 106,
    "title": "[Coverage] Approximate prefix ~ and approx.",
    "input": "Greek Yogurt Bowl\nCalories: ~280 kcal\nProtein: approx. 24g\nCarbs: ~30g\nFat: approx. 4g",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 280,
      "protein": 24,
      "carbs": 30,
      "fat": 4,
      "fiber": null,
      "name": "Greek Yogurt Bowl",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 107,
    "title": "[Coverage] Approximate prefix roughly, about, ≈",
    "input": "Grilled Salmon\nCalories: ≈450 kcal\nProtein: roughly 42g\nCarbs: about 0g\nFat: roughly 22g",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 450,
      "protein": 42,
      "carbs": 0,
      "fat": 22,
      "fiber": null,
      "name": "Grilled Salmon",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 108,
    "title": "[Coverage] Markdown table without separator row",
    "input": "| Item | Calories | Protein | Carbs | Fat |\n| Grilled Chicken | 320 | 50 | 0 | 7 |\n| Steamed Rice | 230 | 4 | 60 | 3 |",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 550,
      "protein": 54,
      "carbs": 60,
      "fat": 10,
      "fiber": null,
      "name": null,
      "itemsCount": 2,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 109,
    "title": "[Coverage] Tab-separated columns table",
    "input": "Item\tCalories\tProtein\tCarbs\tFat\nGrilled Chicken\t330\t48g\t0g\t8g\nJasmine Rice\t230\t4g\t64g\t2g",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 560,
      "protein": 52,
      "carbs": 64,
      "fat": 10,
      "fiber": null,
      "name": null,
      "itemsCount": 2,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 110,
    "title": "[Coverage] Intermediate label row Components: after meal total",
    "input": "Meal Total: 710 calories, 52g protein, 60g carbs, 26g fat\nComponents:\n- Sirloin Steak: 420 kcal, 48g protein, 0g carbs, 24g fat\n- Sweet Potato: 290 kcal, 4g protein, 60g carbs, 2g fat",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 710,
      "protein": 52,
      "carbs": 60,
      "fat": 26,
      "fiber": null,
      "name": null,
      "itemsCount": 2,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 111,
    "title": "[Coverage] Intermediate label row Items: after dish name",
    "input": "Chicken & Rice Feast\nItems:\n- Chicken Breast: 320 kcal, 48g protein, 0g carbs, 6g fat\n- White Rice: 210 kcal, 4g protein, 45g carbs, 1g fat",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 530,
      "protein": 52,
      "carbs": 45,
      "fat": 7,
      "fiber": null,
      "name": "Chicken & Rice Feast",
      "itemsCount": 2,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 112,
    "title": "[Coverage] Tab-separated table with Total row cross-check",
    "input": "Component\tCalories\tProtein\tCarbs\tFat\nFlank Steak\t380\t46g\t0g\t19g\nRice and Beans\t330\t8g\t68g\t3g\nTotal\t710\t54g\t68g\t22g",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 710,
      "protein": 54,
      "carbs": 68,
      "fat": 22,
      "fiber": null,
      "name": null,
      "itemsCount": 2,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 113,
    "title": "[Sweep paste3-056] Salmon Rice table with Calories and Energy columns",
    "input": "| Food | Calories | Energy | Protein | Carbs | Fat |\n| --- | --- | --- | --- | --- | --- |\n| Salmon | 400 | 1674 | 40 | 0 | 25 |\n| Rice | 200 | 837 | 4 | 45 | 1 |",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 600,
      "protein": 44,
      "carbs": 45,
      "fat": 26,
      "fiber": null,
      "name": null,
      "itemsCount": 2,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 114,
    "title": "[Sweep paste3-057] Steak Potato table with Calories and Energy columns",
    "input": "| Item | Calories | Energy | Protein | Carbs | Fat |\n| --- | --- | --- | --- | --- | --- |\n| Steak | 410 | 1715 | 48 | 0 | 22 |\n| Potato | 240 | 1004 | 4 | 54 | 1 |",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 650,
      "protein": 52,
      "carbs": 54,
      "fat": 23,
      "fiber": null,
      "name": null,
      "itemsCount": 2,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 115,
    "title": "[Sweep paste3-058] Chicken Sweet Potato table with Calories and Energy columns",
    "input": "| Food | Calories | Energy | Protein | Carbs | Fat |\n| --- | --- | --- | --- | --- | --- |\n| Chicken | 320 | 1339 | 50 | 0 | 7 |\n| Sweet Potato | 230 | 962 | 4 | 52 | 3 |",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 550,
      "protein": 54,
      "carbs": 52,
      "fat": 10,
      "fiber": null,
      "name": null,
      "itemsCount": 2,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 116,
    "title": "[Coverage] Markdown table with kJ energy column converted to kcal",
    "input": "| Food | Energy (kJ) | Protein | Carbs | Fat |\n| --- | --- | --- | --- | --- |\n| Salmon | 1674 | 40 | 0 | 25 |\n| Rice | 837 | 4 | 45 | 1 |",
    "expected": {
      "confidence": "lenient",
      "ok": true,
      "calories": 600,
      "protein": 44,
      "carbs": 45,
      "fat": 26,
      "fiber": null,
      "name": null,
      "itemsCount": 2,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 117,
    "title": "[Format C] Emoji-only labels with fire and food macros",
    "input": "Grilled Salmon Fillet\n🔥 580 kcal\n🥩 46g\n🍞 35g\n🧈 26g",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 580,
      "protein": 46,
      "carbs": 35,
      "fat": 26,
      "fiber": null,
      "name": "Grilled Salmon Fillet",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 118,
    "title": "[Format C] Multi-item breakdown with category header and quantity prefix",
    "input": "Breakfast:\n- 2x Fried Eggs: 220 kcal | 16g P | 2g C | 16g F\n- 1x Toast: 170 kcal | 8g P | 30g C | 1g F",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 390,
      "protein": 24,
      "carbs": 32,
      "fat": 17,
      "fiber": null,
      "name": "Breakfast",
      "itemsCount": 2,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 119,
    "title": "[Format C] Nested sub-items under single dish total",
    "input": "Custom Burrito Bowl: 720 kcal, 55g P, 68g C, 24g F\n  • Double Chicken (360 kcal, 48g P)\n  • Brown Rice (210 kcal, 4g P)\n  • Black Beans (150 kcal, 3g P)",
    "expected": {
      "confidence": "exact",
      "ok": true,
      "calories": 720,
      "protein": 55,
      "carbs": 68,
      "fat": 24,
      "fiber": null,
      "name": "Custom Burrito Bowl",
      "itemsCount": null,
      "reason": null,
      "hint": null
    }
  },
  {
    "id": 120,
    "title": "[Format C] Grams-only macro breakdown without calories (partial)",
    "input": "Salmon Avocado Plate\nProtein: 38g\nCarbs: 12g\nFat: 32g",
    "expected": {
      "confidence": "partial",
      "ok": false,
      "calories": 0,
      "protein": 38,
      "carbs": 12,
      "fat": 32,
      "fiber": null,
      "name": "Salmon Avocado Plate",
      "itemsCount": null,
      "reason": "MISSING_MACRO",
      "hint": null
    }
  }
];
