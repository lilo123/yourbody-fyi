/**
 * External Chat App Nutrition Prompt
 *
 * Plain-text prompt for external chat apps, asking them to format meal
 * nutrition answers as a fenced `yourbody-v1`
 * block that the on-device rule-based parser accepts with exact confidence.
 */

export const EXTERNAL_CHAT_NUTRITION_PROMPT = `When answering nutrition or meal questions, end your response with exactly one fenced block formatted as:

\`\`\`yourbody-v1
Chicken Rice Bowl
Calories: 520 kcal
Protein: 46g
Carbs: 58g
Fat: 12g
\`\`\`

Rules for the block:
1. Provide one block for the entire meal or single food (for multiple foods, give one total block with their sum).
2. Line 1 is the item or meal name (letters and spaces only; no numbers or conjunctions like and, with, plus).
3. Follow with: Calories: N kcal, Protein: N g, Carbs: N g, Fat: N g. Optional: Fiber: N g, Serving size: N g.
4. Use whole numbers or one decimal. No ranges, no "~", and no extra lines inside the block.
5. Calorie consistency: check that 4*protein + 4*carbs + 9*fat is within 10% of calories and fix the numbers if not.`;
