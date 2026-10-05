import { describe, it, expect } from 'vitest';
import { parseNutritionBlock } from './localParse';

describe('Local Parser Adversarial Inputs (Attack Q5)', () => {
  const adversarialCases: Array<{ name: string; input: string }> = [
    {
      name: 'two foods on separate lines with numbers',
      input: 'Chicken breast\nCalories 200\nProtein 30g\nCarbs 0g\nFat 5g\nRice\nCalories 150\nProtein 3g\nCarbs 35g\nFat 1g',
    },
    {
      name: 'two foods in name line with and',
      input: 'Chicken and Rice\nCalories 350\nProtein 33g\nCarbs 35g\nFat 6g',
    },
    {
      name: 'two foods in name line with +',
      input: 'Chicken + Rice\nCalories 350\nProtein 33g\nCarbs 35g\nFat 6g',
    },
    {
      name: 'two foods in name line with comma',
      input: 'Chicken, Rice\nCalories 350\nProtein 33g\nCarbs 35g\nFat 6g',
    },
    {
      name: 'numbers for one food, second food without numbers',
      input: 'Chicken 200 kcal 30g protein 0g carbs 5g fat\nRice',
    },
    {
      name: 'numbers for one food, second food with and on same line',
      input: 'Chicken: 200 kcal, 30g protein, 0g carbs, 5g fat and a banana',
    },
    {
      name: 'calorie range',
      input: 'Salad\nCalories 200-300\nProtein 10g\nCarbs 20g\nFat 10g',
    },
    {
      name: 'protein range',
      input: 'Steak\nCalories 400\nProtein 30-40g\nCarbs 0g\nFat 20g',
    },
    {
      name: 'plus in macro line',
      input: 'Oatmeal\nCalories 300\nProtein 10g + 20g\nCarbs 40g\nFat 5g',
    },
    {
      name: 'per-100g vs per-serving columns (duplicate macros on same line)',
      input: 'Per 100g | Per serving\nEnergy 200 kcal | 400 kcal\nProtein 10g | 20g\nCarbs 20g | 40g\nFat 5g | 10g',
    },
    {
      name: 'per-100g vs per-serving columns in table format',
      input: 'Nutrition Facts\nPer 100g\tPer Serving\nCalories\t200\t400\nProtein\t10g\t20g\nCarbs\t20g\t40g\nFat\t5g\t10g',
    },
    {
      name: 'prose with numbers (conversational meal description)',
      input: 'For lunch I ate 2 slices of pizza which was about 500 calories, 20g protein, 60g carbs, 20g fat',
    },
    {
      name: 'prose with numbers (workout + food)',
      input: 'Burned 400 calories then ate 40g protein, 50g carbs, 10g fat, 450 calories',
    },
    {
      name: 'two foods in compact lifter shorthand',
      input: 'Eggs P12 C1 F10 140kcal Oatmeal P10 C50 F4 270kcal',
    },
  ];

  for (const tc of adversarialCases) {
    it(`rejects adversarial input: ${tc.name}`, () => {
      const result = parseNutritionBlock(tc.input);
      expect(result.ok).toBe(false);
    });
  }
});
