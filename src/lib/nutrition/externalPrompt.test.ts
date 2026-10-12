import { describe, expect, it } from 'vitest';
import { EXTERNAL_CHAT_NUTRITION_PROMPT } from './externalPrompt';
import { parseNutritionText } from './localParse';

describe('External Chat App Nutrition Prompt (P5)', () => {
  it('is under 900 characters in length', () => {
    expect(EXTERNAL_CHAT_NUTRITION_PROMPT.length).toBeLessThan(900);
  });

  it('contains plain English instructions with no brand claims', () => {
    const lower = EXTERNAL_CHAT_NUTRITION_PROMPT.toLowerCase();
    // Must instruct on fenced block and formatting
    expect(lower).toContain('```yourbody-v1');
    expect(lower).toContain('calories:');
    expect(lower).toContain('protein:');
    expect(lower).toContain('carbs:');
    expect(lower).toContain('fat:');
    expect(lower).toContain('consistency');

    // No brand claims or marketing prose
    expect(lower).not.toContain('best app');
    expect(lower).not.toContain('download');
    expect(lower).not.toContain('subscribe');
    expect(lower).not.toContain('rate us');
  });

  it('extracts the embedded example block and asserts parseNutritionText returns exact', () => {
    const match = EXTERNAL_CHAT_NUTRITION_PROMPT.match(
      /```yourbody(?:-v1)?\b[^\r\n]*\r?\n([\s\S]*?)\r?\n```/i
    );
    expect(match).not.toBeNull();
    const exampleBlock = match![1];

    const result = parseNutritionText(exampleBlock);
    expect(result.confidence).toBe('exact');
    expect(result.meal?.name).toBe('Chicken Rice Bowl');
    expect(result.meal?.calories).toBe(520);
    expect(result.meal?.protein).toBe(46);
    expect(result.meal?.carbs).toBe(58);
    expect(result.meal?.fat).toBe(12);
    expect(result.skippedLines).toEqual([]);
    expect(result.modifiers).toEqual([]);

    // Check calorie consistency formula: 4*P + 4*C + 9*F within 10%
    const calculatedKcal = 4 * 46 + 4 * 58 + 9 * 12;
    expect(Math.abs(calculatedKcal - 520) / 520).toBeLessThan(0.1);
  });

  it('parses as exact when a realistic chat reply wraps the example block', () => {
    const realisticReply = [
      'Here is the nutritional breakdown for the meal you described:',
      '',
      '```yourbody-v1',
      'Chicken Rice Bowl',
      'Calories: 520 kcal',
      'Protein: 46g',
      'Carbs: 58g',
      'Fat: 12g',
      '```',
      '',
      'This meal provides a balanced macro ratio suitable for muscle building.',
      'Let me know if you would like portion adjustments!',
    ].join('\n');

    const result = parseNutritionText(realisticReply);
    expect(result.confidence).toBe('exact');
    expect(result.meal?.name).toBe('Chicken Rice Bowl');
    expect(result.meal?.calories).toBe(520);
    expect(result.meal?.protein).toBe(46);
    expect(result.meal?.carbs).toBe(58);
    expect(result.meal?.fat).toBe(12);
  });
});
