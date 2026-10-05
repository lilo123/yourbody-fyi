/**
 * Nutrition Block Local Parser (D-OFF-6 / N4 Grammar)
 *
 * Strict, pure TypeScript nutrition parser for pasted nutrition blocks.
 * Zero external dependencies, no component imports.
 *
 * GRAMMAR SPECIFICATION (N4):
 * ===========================
 * 1. Line Kinds:
 *    Every non-empty line must match exactly one of:
 *    - NAME line: First non-empty line only. Must be <= 60 characters and contain NO digits,
 *      and NO conjunctions or list markers ("and", "with", "plus", "&", "+", ",", ";", "/").
 *      Names with multiple items are REJECTED with NAME_MULTIPLE_ITEMS. Single-dish names
 *      like "Big Mac", "Greek yogurt", "Chicken tikka masala" are accepted.
 *    - SERVING line: "Serving( size)?: <num> <unit>", "Per <num> <unit>", "Per serving", or "Per portion".
 *    - HEADER NOISE: "Nutrition Facts", "Nutrition Information", "Amount per serving", "% Daily Value*",
 *      "Servings per container", divider lines ("---", "==="), etc. (Ignored).
 *    - IGNORABLE SUB-ROWS: "Saturated fat", "Trans fat", "Cholesterol", "Sodium", "Salt", "Potassium",
 *      "Sugars", "Added sugars", "Vitamins", etc. with optional amounts and % DV (Ignored).
 *    - MACRO line(s): Individual macro row or compact multi-macro line.
 *
 * 2. Macro Forms:
 *    - Calories/Energy:
 *        "Calories[:]? <num>( kcal)?"
 *        "Energy[:]? <num> kcal" (or "Energy <num> kJ / <num> kcal" where kcal wins; kJ alone rejected)
 *        Shorthand: "<num> kcal", "<num>kcal", "Cal: <num>"
 *    - Protein:
 *        "Protein[:]? <num>( g)?"
 *        Shorthand: "P<num>", "<num>P", "<num>g protein", "P: <num>g"
 *    - Carbohydrates:
 *        "(Total )?Carb(s|ohydrate(s)?)[:]? <num>( g)?"
 *        Shorthand: "C<num>", "<num>C", "<num>g carbs", "C: <num>g"
 *    - Fat:
 *        "(Total )?Fat[:]? <num>( g)?" (NOT preceded by Saturated/Trans/Poly/Mono)
 *        Shorthand: "F<num>", "<num>F", "<num>g fat", "F: <num>g"
 *    - Fiber (optional):
 *        "(Dietary )?Fib(er|re)[:]? <num>( g)?"
 *        Shorthand: "Fib<num>", "<num>Fib", "Fib: <num>g"
 *
 * 3. Compact Forms & Separators:
 *    - Delimited: "350 kcal | 30g protein | 40g carbs | 8g fat"
 *    - Separators: "|", ",", "/", "·", ";"
 *    - Lifter whitespace shorthand: "P30 C40 F8 350kcal" or "350kcal 30P 40C 8F"
 *
 * 4. Numbers & Units:
 *    - Standard decimal point "." or comma decimal "," (e.g. "8,5 g" -> 8.5).
 *    - Numeric ranges: 0 <= calories <= 5000 kcal; 0 <= macro <= 500 g.
 *    - Macro units: Only grams ("g", "grams") or omitted. Units like "mg", "oz", "kg" are REJECTED.
 *
 * 5. Kcal Consistency Check:
 *    - Expected calories: 4 * P + 4 * C + 9 * F.
 *    - |expected - calories| <= max(60, 0.25 * calories).
 *    - Discrepancies exceeding both 60 kcal and 25% of calories are REJECTED.
 *
 * 6. Rejection Rules:
 *    - Local parsing applies ONLY when the ENTIRE input is a single nutrition block.
 *    - Missing any of the 4 macros (calories, protein, carbs, fat) -> REJECT.
 *    - Duplicate macro with different value -> REJECT.
 *    - Second calories line -> REJECT.
 *    - Digits in name line -> REJECT.
 *    - Multiple items/conjunctions in name line ("and", "with", "plus", "&", "+", ",", ";", "/") -> REJECT (NAME_MULTIPLE_ITEMS).
 *    - Unexplained content / leftover words / multiple foods / prose / ingredient lists -> REJECT.
 *    - False positives are worse than misses: when in doubt, REJECT.
 */

export type LocalParseRejectReason =
  | 'EMPTY_INPUT'
  | 'NOT_A_NUTRITION_BLOCK'
  | 'MISSING_MACRO'
  | 'DUPLICATE_MACRO'
  | 'SECOND_CALORIES_LINE'
  | 'INVALID_MACRO_UNIT'
  | 'KJ_WITHOUT_KCAL'
  | 'VALUE_OUT_OF_RANGE'
  | 'KCAL_INCONSISTENT'
  | 'NAME_CONTAINS_DIGITS'
  | 'NAME_MULTIPLE_ITEMS'
  | 'UNEXPLAINED_CONTENT'
  | 'MULTIPLE_FOODS';

export interface LocalParseMeal {
  name?: string;
  servingSize?: number;
  servingUnit?: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
}

export type LocalParseResult =
  | { ok: true; meal: LocalParseMeal }
  | { ok: false; reason: LocalParseRejectReason };

export const LOCAL_PARSE_GRAMMAR_DOC = `### Local Nutrition Block Grammar (D-OFF-6 / N4)

Local parsing applies ONLY when the ENTIRE input is a single nutrition block.
False positives are worse than misses: when in doubt, reject.

1. **Lines & Structure**:
   - Optional **NAME** line: first non-empty line only, <=60 chars, NO digits,
     no conjunctions/list markers ('and', 'with', 'plus', '&', '+', ',', ';', '/').
   - Optional **SERVING** line: \`Serving( size)?: <num> <unit>\` or \`Per <num> <unit>\` / \`Per serving\`.
   - **HEADER NOISE**: \`Nutrition Facts\`, \`Amount Per Serving\`, \`% Daily Value*\`, etc. ignored.
   - **IGNORABLE SUB-ROWS**: Saturated/trans fat, cholesterol, sodium, sugars, added sugars, salt, vitamins.
   - **MACRO LINES**: Exactly one of each of the 4 macros (Calories, Protein, Carbs, Fat); optional Fiber.

2. **Macro Forms**:
   - Calories: \`Calories[:]? <num>( kcal)?\`, \`Energy <num> kcal\` (kJ alone rejected; if both, kcal wins).
   - Protein: \`Protein[:]? <num>( g)?\`, \`P<num>\`, \`30g protein\`.
   - Carbs: \`(Total )?Carb(s|ohydrate(s)?)[:]? <num>( g)?\`, \`C<num>\`, \`40g carbs\`.
   - Fat: \`(Total )?Fat[:]? <num>( g)?\` (not sat/trans fat), \`F<num>\`, \`8g fat\`.
   - Fiber (optional): \`(Dietary )?Fib(er|re)[:]? <num>( g)?\`.
   - Compact: \`350 kcal | 30g protein | 40g carbs | 8g fat\` or \`P30 C40 F8 350kcal\`.
   - Separators: \`|\`, \`,\`, \`/\`, \`·\`, \`;\`, or whitespace.

3. **Units & Numbers**:
   - Numbers: standard \`.\` or comma decimal \`,\` (e.g. \`8,5 g\`).
   - Bounds: \`0 <= calories <= 5000\`, \`0 <= macro <= 500 g\`.
   - Units: macros must be in \`g\` or unitless; \`mg\` or \`oz\` rejected.

4. **Consistency & Rejection**:
   - Consistency check: \`|4*P + 4*C + 9*F - kcal| <= max(60, 25% * kcal)\`.
   - Reject: missing any macro, second calories line, duplicate macro with different value,
     name with digits or multiple items/conjunctions, leftover words, prose, multiple foods.`;

function roundToOneDecimal(val: number): number {
  return Math.round(val * 10) / 10;
}

function parseNumber(raw: string): number | null {
  const cleaned = raw.trim().replace(',', '.');
  if (!cleaned) return null;
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return null;
  return num;
}

function isInvalidMacroUnit(rawUnit?: string): boolean {
  if (!rawUnit) return false;
  const unit = rawUnit.trim().toLowerCase();
  return (
    unit === 'mg' ||
    unit === 'milligram' ||
    unit === 'milligrams' ||
    unit === 'oz' ||
    unit === 'ounce' ||
    unit === 'ounces' ||
    unit === 'kg' ||
    unit === 'ml' ||
    unit === 'lb' ||
    unit === 'lbs'
  );
}

function isHeaderNoise(line: string): boolean {
  return (
    /^nutrition\s+facts\b/i.test(line) ||
    /^nutrition\s+information\b/i.test(line) ||
    /^typical\s+values\b/i.test(line) ||
    /^amount\s+per\s+serving\b/i.test(line) ||
    /^amount\s+per\s+\d+\s*(?:g|ml|oz)\b/i.test(line) ||
    /^%\s*(?:daily\s+value|dv)\*?/i.test(line) ||
    /^\*\s*(?:percent|the\s+%)?\s*daily\s+values?\b/i.test(line) ||
    /^\*\s*reference\s+intake\b/i.test(line) ||
    /^\d+\s+servings?\s+per\s+container\b/i.test(line) ||
    /^servings?\s+per\s+container\b/i.test(line) ||
    /^about\s+\d+\s+servings?\s+per\s+container\b/i.test(line) ||
    /^[-=_*~]{2,}$/.test(line)
  );
}

function isIgnorableSubRow(line: string): boolean {
  const trimmed = line.trim();
  if (
    /^(?:of\s+which\s+)?sat(?:urates?|urated\s+fat)?(?:\s*\(?[^)]*\)?)?[:=\s]+-?\d+(?:[.,]\d+)?\s*(?:g|grams?)\b/i.test(
      trimmed
    )
  ) {
    return true;
  }
  if (/^sat(?:urated)?\s+fat[:=\s]+-?\d+(?:[.,]\d+)?\s*(?:g|grams?)\b/i.test(trimmed)) return true;
  if (/^trans\s+fat(?:ty\s+acids?)?[:=\s]+-?\d+(?:[.,]\d+)?\s*(?:g|grams?)\b/i.test(trimmed)) {
    return true;
  }
  if (
    /^(?:polyunsaturated|monounsaturated)\s+fat[:=\s]+-?\d+(?:[.,]\d+)?\s*(?:g|grams?)\b/i.test(
      trimmed
    )
  ) {
    return true;
  }
  if (/^cholesterol[:=\s]+-?\d+(?:[.,]\d+)?\s*(?:mg|milligrams?)\b/i.test(trimmed)) return true;
  if (/^sodium[:=\s]+-?\d+(?:[.,]\d+)?\s*(?:mg|milligrams?|g)\b/i.test(trimmed)) return true;
  if (/^salt[:=\s]+-?\d+(?:[.,]\d+)?\s*(?:g|grams?|mg)\b/i.test(trimmed)) return true;
  if (/^potassium[:=\s]+-?\d+(?:[.,]\d+)?\s*(?:mg|g)\b/i.test(trimmed)) return true;
  if (/^(?:total\s+)?sugars?[:=\s]+-?\d+(?:[.,]\d+)?\s*(?:g|grams?)\b/i.test(trimmed)) return true;
  if (/^(?:of\s+which\s+)?sugars?[:=\s]+-?\d+(?:[.,]\d+)?\s*(?:g|grams?)\b/i.test(trimmed)) {
    return true;
  }
  if (
    /^(?:includes\s+)?(?:\d+(?:[.,]\d+)?\s*g\s+)?added\s+sugars?[:=\s]+-?\d+(?:[.,]\d+)?\s*(?:g|grams?)\b/i.test(
      trimmed
    )
  ) {
    return true;
  }
  if (/^includes\s+-?\d+(?:[.,]\d+)?\s*g\s+added\s+sugars\b/i.test(trimmed)) return true;
  if (
    /^(?:vitamin\s+[a-z0-9]+|calcium|iron|zinc|magnesium|folate)[:=\s]+-?\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|g|iu|%)\b/i.test(
      trimmed
    )
  ) {
    return true;
  }
  if (
    /^\s*(?:sat\s+fat|saturated|trans|polyunsaturated|monounsaturated|includes|cholesterol|sodium|sugars|salt)\b/i.test(
      line
    )
  ) {
    return true;
  }
  if (/^\d+\s*%(?:\s+daily\s+value)?\*?$/i.test(trimmed)) return true;

  return false;
}

function tryParseServingLine(line: string): { matched: boolean; size?: number; unit?: string } {
  const trimmed = line.trim();

  // Pattern: "Per 100g", "Per 100 g", "Per 100ml"
  const perNumMatch = trimmed.match(/^per\s+(\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)?$/i);
  if (perNumMatch) {
    const size = parseNumber(perNumMatch[1]);
    const unit = perNumMatch[2] ? perNumMatch[2].trim() : 'serving';
    return { matched: true, size: size ?? 1, unit };
  }

  // Pattern: "Per serving", "Per portion"
  if (/^per\s+(?:serving|portion)$/i.test(trimmed)) {
    return { matched: true, size: 1, unit: 'serving' };
  }

  // Pattern: "Serving size: 1 cup (240ml)", "Serving size 1 bar (60g)", "Serving Size: 30g"
  const servingSizeMatch = trimmed.match(/^serving(?:\s+size)?[:\s]+(.+)$/i);
  if (servingSizeMatch) {
    const rest = servingSizeMatch[1].trim();
    const numMatch = rest.match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);
    if (numMatch) {
      const size = parseNumber(numMatch[1]);
      const unit = numMatch[2].trim() || 'serving';
      return { matched: true, size: size ?? 1, unit };
    }
    return { matched: true, size: 1, unit: rest || 'serving' };
  }

  return { matched: false };
}

interface ExtractedMacroToken {
  kind: 'calories' | 'protein' | 'carbs' | 'fat' | 'fiber' | 'ignorable' | 'kj_only';
  value: number;
  invalidUnit?: boolean;
}

function tryMatchMacroToken(rawSegment: string): ExtractedMacroToken | null {
  const segment = rawSegment.trim();
  if (!segment) return null;

  if (isIgnorableSubRow(segment)) {
    return { kind: 'ignorable', value: 0 };
  }

  // Standalone percentage token like "16%"
  if (/^\d+\s*%(?:\s+dv)?\*?$/i.test(segment)) {
    return { kind: 'ignorable', value: 0 };
  }

  // 1. Calories / Energy

  // Energy: "Energy 1470 kJ / 350 kcal", "Energy: 1470kJ / 350kcal", "Energy 350 kcal / 1470 kJ"
  const energyKjKcalMatch = segment.match(
    /^energy[:=\s]+(?:(\d+(?:[.,]\d+)?)\s*kj\s*(?:[/,\s]+|\s+))?(-?\d+(?:[.,]\d+)?)\s*kcal(?:\s*(?:[/,\s]+|\s+)(\d+(?:[.,]\d+)?)\s*kj)?(?:\s+\d+\s*%)?$/i
  );
  if (energyKjKcalMatch) {
    const kcalVal = parseNumber(energyKjKcalMatch[2]);
    if (kcalVal !== null) {
      return { kind: 'calories', value: kcalVal };
    }
  }

  // Energy kJ only: "Energy 1470 kJ"
  const energyKjOnlyMatch = segment.match(
    /^energy[:=\s]+(-?\d+(?:[.,]\d+)?)\s*kj(?:\s+\d+\s*%)?$/i
  );
  if (energyKjOnlyMatch) {
    const kjVal = parseNumber(energyKjOnlyMatch[1]);
    return { kind: 'kj_only', value: kjVal ?? 0 };
  }

  // Dual kJ and kcal without the word "Energy", e.g. "1470 kJ / 350 kcal" or "350 kcal / 1470 kJ"
  const dualKjKcalMatch = segment.match(
    /^(?:(\d+(?:[.,]\d+)?)\s*kj\s*[/,]\s*)?(-?\d+(?:[.,]\d+)?)\s*kcal(?:\s*[/,]\s*(\d+(?:[.,]\d+)?)\s*kj)?(?:\s+\d+\s*%)?$/i
  );
  if (dualKjKcalMatch && dualKjKcalMatch[2]) {
    const kcalVal = parseNumber(dualKjKcalMatch[2]);
    if (kcalVal !== null) {
      return { kind: 'calories', value: kcalVal };
    }
  }

  // Standard calories: "Calories: 350", "Calories 350 kcal", "Calories: 350kcal"
  const caloriesMatch = segment.match(
    /^(?:calories?|cals?)[:=\s]+(-?\d+(?:[.,]\d+)?)\s*(?:kcal|cals?|calories?)?(?:\s+\d+\s*%)?$/i
  );
  if (caloriesMatch) {
    const calVal = parseNumber(caloriesMatch[1]);
    if (calVal !== null) {
      return { kind: 'calories', value: calVal };
    }
  }

  // Calories with kJ unit explicitly: "Calories: 1470 kJ"
  const caloriesKjMatch = segment.match(
    /^(?:calories?|cals?)[:=\s]+(-?\d+(?:[.,]\d+)?)\s*kj(?:\s+\d+\s*%)?$/i
  );
  if (caloriesKjMatch) {
    const kjVal = parseNumber(caloriesKjMatch[1]);
    return { kind: 'kj_only', value: kjVal ?? 0 };
  }

  // Number first calories: "350 kcal", "350 cals", "350 calories"
  const numFirstCaloriesMatch = segment.match(
    /^(-?\d+(?:[.,]\d+)?)\s*(?:kcal|cals?|calories)(?:\s+\d+\s*%)?$/i
  );
  if (numFirstCaloriesMatch) {
    const calVal = parseNumber(numFirstCaloriesMatch[1]);
    if (calVal !== null) {
      return { kind: 'calories', value: calVal };
    }
  }

  // Shorthand calories: "350kcal"
  const shorthandKcalMatch = segment.match(/^(-?\d+(?:[.,]\d+)?)kcal$/i);
  if (shorthandKcalMatch) {
    const calVal = parseNumber(shorthandKcalMatch[1]);
    if (calVal !== null) {
      return { kind: 'calories', value: calVal };
    }
  }

  // Shorthand "cal: 350" or "cal 350"
  const calShorthandMatch = segment.match(/^cal[:=\s]+(-?\d+(?:[.,]\d+)?)$/i);
  if (calShorthandMatch) {
    const calVal = parseNumber(calShorthandMatch[1]);
    if (calVal !== null) {
      return { kind: 'calories', value: calVal };
    }
  }

  // 2. Protein
  // Keyword first: "Protein: 30g", "Protein 30 g", "Protein: 30"
  const proteinMatch = segment.match(
    /^(?:protein|prot)[:=\s]+(-?\d+(?:[.,]\d+)?)\s*([a-zA-Z%]+)?(?:\s+\d+\s*%)?$/i
  );
  if (proteinMatch) {
    const pVal = parseNumber(proteinMatch[1]);
    const unit = proteinMatch[2];
    if (pVal !== null) {
      return { kind: 'protein', value: pVal, invalidUnit: isInvalidMacroUnit(unit) };
    }
  }

  // Number first: "30g protein", "30 g protein", "30 protein"
  const numFirstProteinMatch = segment.match(
    /^(-?\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)?\s+(?:protein|prot)(?:\s+\d+\s*%)?$/i
  );
  if (numFirstProteinMatch) {
    const pVal = parseNumber(numFirstProteinMatch[1]);
    const unit = numFirstProteinMatch[2];
    if (pVal !== null) {
      return { kind: 'protein', value: pVal, invalidUnit: isInvalidMacroUnit(unit) };
    }
  }

  // Shorthand: "P30", "P: 30", "P: 30g", "P 30g", "30P", "30g P", "30gP"
  const pShorthandMatch = segment.match(/^p[:=\s]*(-?\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)?$/i);
  if (pShorthandMatch) {
    const pVal = parseNumber(pShorthandMatch[1]);
    const unit = pShorthandMatch[2];
    if (pVal !== null) {
      return { kind: 'protein', value: pVal, invalidUnit: isInvalidMacroUnit(unit) };
    }
  }
  const pTrailingMatch = segment.match(/^(-?\d+(?:[.,]\d+)?)\s*(?:g\s*)?p$/i);
  if (pTrailingMatch) {
    const pVal = parseNumber(pTrailingMatch[1]);
    if (pVal !== null) {
      return { kind: 'protein', value: pVal };
    }
  }

  // 3. Carbohydrates
  // Keyword first: "Carbohydrates: 40g", "Total Carbohydrate 12g 4%", "Carbs: 40g"
  const carbsMatch = segment.match(
    /^(?:total\s+)?(?:carbohydrates?|carbs?|carb)[:=\s]+(-?\d+(?:[.,]\d+)?)\s*([a-zA-Z%]+)?(?:\s+\d+\s*%)?$/i
  );
  if (carbsMatch) {
    const cVal = parseNumber(carbsMatch[1]);
    const unit = carbsMatch[2];
    if (cVal !== null) {
      return { kind: 'carbs', value: cVal, invalidUnit: isInvalidMacroUnit(unit) };
    }
  }

  // Number first: "40g carbs", "40 g carbohydrate"
  const numFirstCarbsMatch = segment.match(
    /^(-?\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)?\s+(?:total\s+)?(?:carbohydrates?|carbs?|carb)(?:\s+\d+\s*%)?$/i
  );
  if (numFirstCarbsMatch) {
    const cVal = parseNumber(numFirstCarbsMatch[1]);
    const unit = numFirstCarbsMatch[2];
    if (cVal !== null) {
      return { kind: 'carbs', value: cVal, invalidUnit: isInvalidMacroUnit(unit) };
    }
  }

  // Shorthand: "C40", "C: 40", "C: 40g", "40C", "40g C", "40gC"
  const cShorthandMatch = segment.match(/^c[:=\s]*(-?\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)?$/i);
  if (cShorthandMatch) {
    const cVal = parseNumber(cShorthandMatch[1]);
    const unit = cShorthandMatch[2];
    if (cVal !== null) {
      return { kind: 'carbs', value: cVal, invalidUnit: isInvalidMacroUnit(unit) };
    }
  }
  const cTrailingMatch = segment.match(/^(-?\d+(?:[.,]\d+)?)\s*(?:g\s*)?c$/i);
  if (cTrailingMatch) {
    const cVal = parseNumber(cTrailingMatch[1]);
    if (cVal !== null) {
      return { kind: 'carbs', value: cVal };
    }
  }

  // 4. Fat
  // Must NOT match saturated, trans, polyunsaturated, monounsaturated fat
  const fatMatch = segment.match(
    /^(?!.*(?:saturated|trans|polyunsaturated|monounsaturated|\bsat\b))(?:total\s+)?fat[:=\s]+(-?\d+(?:[.,]\d+)?)\s*([a-zA-Z%]+)?(?:\s+\d+\s*%)?$/i
  );
  if (fatMatch) {
    const fVal = parseNumber(fatMatch[1]);
    const unit = fatMatch[2];
    if (fVal !== null) {
      return { kind: 'fat', value: fVal, invalidUnit: isInvalidMacroUnit(unit) };
    }
  }

  // Number first: "8g fat", "8 g total fat"
  const numFirstFatMatch = segment.match(
    /^(-?\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)?\s+(?:total\s+)?fat(?:\s+\d+\s*%)?$/i
  );
  if (numFirstFatMatch) {
    const fVal = parseNumber(numFirstFatMatch[1]);
    const unit = numFirstFatMatch[2];
    if (fVal !== null) {
      return { kind: 'fat', value: fVal, invalidUnit: isInvalidMacroUnit(unit) };
    }
  }

  // Shorthand: "F8", "F: 8", "F: 8g", "8F", "8g F", "8gF"
  const fShorthandMatch = segment.match(/^f[:=\s]*(-?\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)?$/i);
  if (fShorthandMatch) {
    const fVal = parseNumber(fShorthandMatch[1]);
    const unit = fShorthandMatch[2];
    if (fVal !== null) {
      return { kind: 'fat', value: fVal, invalidUnit: isInvalidMacroUnit(unit) };
    }
  }
  const fTrailingMatch = segment.match(/^(-?\d+(?:[.,]\d+)?)\s*(?:g\s*)?f$/i);
  if (fTrailingMatch) {
    const fVal = parseNumber(fTrailingMatch[1]);
    if (fVal !== null) {
      return { kind: 'fat', value: fVal };
    }
  }

  // 5. Fiber (optional)
  const fiberMatch = segment.match(
    /^(?:dietary\s+)?(?:fibres?|fibers?|fib)[:=\s]+(-?\d+(?:[.,]\d+)?)\s*([a-zA-Z%]+)?(?:\s+\d+\s*%)?$/i
  );
  if (fiberMatch) {
    const fibVal = parseNumber(fiberMatch[1]);
    const unit = fiberMatch[2];
    if (fibVal !== null) {
      return { kind: 'fiber', value: fibVal, invalidUnit: isInvalidMacroUnit(unit) };
    }
  }

  const numFirstFiberMatch = segment.match(
    /^(-?\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)?\s+(?:dietary\s+)?(?:fibres?|fibers?|fib)(?:\s+\d+\s*%)?$/i
  );
  if (numFirstFiberMatch) {
    const fibVal = parseNumber(numFirstFiberMatch[1]);
    const unit = numFirstFiberMatch[2];
    if (fibVal !== null) {
      return { kind: 'fiber', value: fibVal, invalidUnit: isInvalidMacroUnit(unit) };
    }
  }

  const fibShorthandMatch = segment.match(/^fib[:=\s]*(-?\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)?$/i);
  if (fibShorthandMatch) {
    const fibVal = parseNumber(fibShorthandMatch[1]);
    const unit = fibShorthandMatch[2];
    if (fibVal !== null) {
      return { kind: 'fiber', value: fibVal, invalidUnit: isInvalidMacroUnit(unit) };
    }
  }

  return null;
}

function splitLineIntoSegments(line: string): string[] {
  const trimmed = line.trim();

  // 1. Check if entire line is already a single valid macro token
  const singleMatch = tryMatchMacroToken(trimmed);
  if (singleMatch) {
    return [trimmed];
  }

  // 2. Delimiter: "|"
  if (trimmed.includes('|')) {
    return trimmed.split('|').map((part) => part.trim()).filter(Boolean);
  }

  // 3. Delimiter: ";"
  if (trimmed.includes(';')) {
    return trimmed.split(';').map((part) => part.trim()).filter(Boolean);
  }

  // 4. Delimiter: "·"
  if (trimmed.includes('·')) {
    return trimmed.split('·').map((part) => part.trim()).filter(Boolean);
  }

  // 5. Delimiter: "/" (only if not kJ/kcal dual energy)
  if (
    trimmed.includes('/') &&
    !/(?:kj\s*[/,]\s*-?\d+\s*kcal|-?\d+\s*kcal\s*[/,]\s*-?\d+\s*kj)/i.test(trimmed)
  ) {
    return trimmed.split('/').map((part) => part.trim()).filter(Boolean);
  }

  // 6. Delimiter: comma followed by whitespace (preserves decimal commas like "8,5 g")
  if (/,\s+/.test(trimmed)) {
    return trimmed.split(/,\s+/).map((part) => part.trim()).filter(Boolean);
  }

  // 7. Whitespace split for compact shorthand (e.g. "P30 C40 F8 350kcal" or "350kcal P30 C40 F8")
  const spaceTokens = trimmed.split(/\s+/).filter(Boolean);
  if (spaceTokens.length > 1 && spaceTokens.every((token) => tryMatchMacroToken(token) !== null)) {
    return spaceTokens;
  }

  // 8. Shorthand or keyword-delimited without commas
  const keywordSplit = trimmed.split(
    /(?<=\S)\s+(?=(?:calories?|cal|energy|protein|prot|total\s+fat|fat|total\s+carbs?|total\s+carbohydrates?|carbohydrates?|carbs?|dietary\s+fiber|fib(?:er|re)?|p\s*\d+|\d+\s*p|c\s*\d+|\d+\s*c|f\s*\d+|\d+\s*f|\d+\s*kcal)\b)/i
  );
  if (keywordSplit.length > 1) {
    return keywordSplit.map((part) => part.trim()).filter(Boolean);
  }

  return [trimmed];
}

export function parseNutritionBlock(text: string): LocalParseResult {
  const trimmedInput = text.trim();
  if (!trimmedInput) {
    return { ok: false, reason: 'EMPTY_INPUT' };
  }

  const rawLines = trimmedInput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (rawLines.length === 0) {
    return { ok: false, reason: 'EMPTY_INPUT' };
  }

  // Detect markdown table or multiple foods table
  const isTable = rawLines.some(
    (line) =>
      /^\|?\s*food\b/i.test(line) ||
      /\|\s*food\s*\|/i.test(line) ||
      /^\|?\s*item\b/i.test(line) ||
      /\|\s*item\s*\|/i.test(line)
  );
  if (isTable) {
    return { ok: false, reason: 'MULTIPLE_FOODS' };
  }

  // Check if input has completely zero nutrition macro indicators (pure non-nutrition prose / lists)
  const hasAnyMacroKeyword =
    /(?:calories?|kcal|cals?|energy|protein|prot|\bp\d|\d+p\b|carbs?|carbohydrates?|\bc\d|\d+c\b|fat|\bf\d|\d+f\b)/i.test(
      trimmedInput
    );
  if (!hasAnyMacroKeyword) {
    return { ok: false, reason: 'NOT_A_NUTRITION_BLOCK' };
  }

  // Detect pure conversational prose with meal details
  if (
    /\b(?:i\s+had|i\s+ate|i've\s+had|today\s+for\s+(?:breakfast|lunch|dinner|snack)|today\s+i|recipe\s+for|ingredients:?)\b/i.test(
      trimmedInput
    ) &&
    !/(?:calories?[:=\s]+\d+|energy[:=\s]+\d+|\d+\s*kcal)/i.test(trimmedInput)
  ) {
    return { ok: false, reason: 'NOT_A_NUTRITION_BLOCK' };
  }

  let mealName: string | undefined = undefined;
  let servingSize: number | undefined = undefined;
  let servingUnit: string | undefined = undefined;

  let calories: number | undefined = undefined;
  let caloriesLineCount = 0;
  let protein: number | undefined = undefined;
  let carbs: number | undefined = undefined;
  let fat: number | undefined = undefined;
  let fiber: number | undefined = undefined;

  let hadKjWithoutKcal = false;
  let totalMacroMatchesCount = 0;

  for (let lineIndex = 0; lineIndex < rawLines.length; lineIndex++) {
    const line = rawLines[lineIndex];

    // Check Header Noise
    if (isHeaderNoise(line)) {
      continue;
    }

    // Check Serving Line
    const servingMatch = tryParseServingLine(line);
    if (servingMatch.matched) {
      if (servingSize === undefined && servingMatch.size !== undefined) {
        servingSize = servingMatch.size;
        servingUnit = servingMatch.unit;
      }
      continue;
    }

    // Check Ignorable Sub-rows
    if (isIgnorableSubRow(line)) {
      continue;
    }

    // Check if line has a food name prefix like "Chicken breast: 200 kcal, 30g protein..."
    let lineToParse = line;
    const foodPrefixMatch = line.match(/^([a-zA-Z\s&+,;\/]{2,40}):\s*(.+)$/);
    if (foodPrefixMatch) {
      const candidatePrefix = foodPrefixMatch[1].trim();
      const restOfLine = foodPrefixMatch[2].trim();
      if (
        !/^(?:calories?|cal|energy|protein|prot|fat|total\s+fat|carbs?|carbohydrates?|serving|servings|per|fib|fiber|fibre)$/i.test(
          candidatePrefix
        ) &&
        !/\d/.test(candidatePrefix)
      ) {
        // Conjunctions/list markers in food prefix reject as multiple items
        if (/\b(?:and|with|plus)\b|[&+,;\/]/i.test(candidatePrefix)) {
          return { ok: false, reason: 'NAME_MULTIPLE_ITEMS' };
        }
        if (mealName === undefined && lineIndex === 0) {
          mealName = candidatePrefix;
          lineToParse = restOfLine;
        } else if (mealName !== undefined && mealName !== candidatePrefix) {
          // Multiple foods detected with separate food prefixes
          return { ok: false, reason: 'SECOND_CALORIES_LINE' };
        }
      }
    }

    // Try parsing as Macro line / Compact segments
    const segments = splitLineIntoSegments(lineToParse);
    let allSegmentsMatched = true;
    const parsedTokens: ExtractedMacroToken[] = [];

    for (const segment of segments) {
      const match = tryMatchMacroToken(segment);
      if (!match) {
        allSegmentsMatched = false;
        break;
      }
      parsedTokens.push(match);
    }

    if (allSegmentsMatched && parsedTokens.length > 0) {
      for (const token of parsedTokens) {
        if (token.kind === 'ignorable') {
          continue;
        }

        if (token.invalidUnit) {
          return { ok: false, reason: 'INVALID_MACRO_UNIT' };
        }

        if (token.kind === 'kj_only') {
          hadKjWithoutKcal = true;
          continue;
        }

        totalMacroMatchesCount++;

        // Value Range validation
        if (token.kind === 'calories') {
          if (token.value < 0 || token.value > 5000) {
            return { ok: false, reason: 'VALUE_OUT_OF_RANGE' };
          }
          if (calories !== undefined) {
            return { ok: false, reason: 'SECOND_CALORIES_LINE' };
          }
          calories = token.value;
          caloriesLineCount++;
        } else if (token.kind === 'protein') {
          if (token.value < 0 || token.value > 500) {
            return { ok: false, reason: 'VALUE_OUT_OF_RANGE' };
          }
          if (protein !== undefined) {
            if (Math.abs(protein - token.value) > 0.01) {
              return { ok: false, reason: 'DUPLICATE_MACRO' };
            }
          }
          protein = token.value;
        } else if (token.kind === 'carbs') {
          if (token.value < 0 || token.value > 500) {
            return { ok: false, reason: 'VALUE_OUT_OF_RANGE' };
          }
          if (carbs !== undefined) {
            if (Math.abs(carbs - token.value) > 0.01) {
              return { ok: false, reason: 'DUPLICATE_MACRO' };
            }
          }
          carbs = token.value;
        } else if (token.kind === 'fat') {
          if (token.value < 0 || token.value > 500) {
            return { ok: false, reason: 'VALUE_OUT_OF_RANGE' };
          }
          if (fat !== undefined) {
            if (Math.abs(fat - token.value) > 0.01) {
              return { ok: false, reason: 'DUPLICATE_MACRO' };
            }
          }
          fat = token.value;
        } else if (token.kind === 'fiber') {
          if (token.value < 0 || token.value > 500) {
            return { ok: false, reason: 'VALUE_OUT_OF_RANGE' };
          }
          if (fiber !== undefined) {
            if (Math.abs(fiber - token.value) > 0.01) {
              return { ok: false, reason: 'DUPLICATE_MACRO' };
            }
          }
          fiber = token.value;
        }
      }
      continue;
    }

    // If it did not match macros, check if it can be a NAME line
    if (lineIndex === 0) {
      // Check if this input is prose mentioning workout/activities
      if (
        /\b(?:i\s+ran|i\s+walked|i\s+worked\s+out|burned\s+\d+|for\s+dinner\s+i|today\s+i\s+ate)\b/i.test(
          line
        )
      ) {
        return { ok: false, reason: 'NOT_A_NUTRITION_BLOCK' };
      }

      // If line 0 contains actual macro values or lifter shorthand
      const hasMacroValuesInLine =
        /(?:calories?|cal|kcal)\s*[:=\s]+\d+|\d+\s*kcal|protein\s*[:=\s]+\d+|\d+\s*g?\s*protein|carbs?\s*[:=\s]+\d+|\d+\s*g?\s*carbs?|fat\s*[:=\s]+\d+|\d+\s*g?\s*fat/i.test(
          line
        ) || /\b(?:p\d|c\d|f\d)\b/i.test(line);

      if (hasMacroValuesInLine) {
        return { ok: false, reason: 'UNEXPLAINED_CONTENT' };
      }

      // Check if subsequent lines have nutrition data
      const subsequentLinesHaveMacros = rawLines
        .slice(1)
        .some((l) =>
          /(?:calories?|cal|kcal|energy|protein|prot|fat|carbs?|carbohydrates?)\b/i.test(l)
        );

      if (/\d/.test(line)) {
        if (subsequentLinesHaveMacros) {
          return { ok: false, reason: 'NAME_CONTAINS_DIGITS' };
        }
        return { ok: false, reason: 'NOT_A_NUTRITION_BLOCK' };
      }

      // Must be <= 60 characters
      if (line.length > 60) {
        return { ok: false, reason: 'UNEXPLAINED_CONTENT' };
      }

      // Check prose indicators on first line
      if (
        /\b(?:i\s+had|i\s+ate|i've\s+had|today\s+i|for\s+(?:breakfast|lunch|dinner|snack)|recipe\s+for|we\s+had)\b/i.test(
          line
        )
      ) {
        return { ok: false, reason: 'NOT_A_NUTRITION_BLOCK' };
      }

      // If only one line exists total and it has no macros, it's not a nutrition block
      if (rawLines.length === 1) {
        return { ok: false, reason: 'NOT_A_NUTRITION_BLOCK' };
      }

      // Check if NAME line contains conjunctions or list markers (multiple items)
      if (/\b(?:and|with|plus)\b|[&+,;\/]/i.test(line)) {
        return { ok: false, reason: 'NAME_MULTIPLE_ITEMS' };
      }

      mealName = line;
      continue;
    }

    // Non-first line that is not noise, not serving, not ignorable, and not macros is UNEXPLAINED
    return { ok: false, reason: 'UNEXPLAINED_CONTENT' };
  }

  // If kJ was present without any kcal
  if (calories === undefined && hadKjWithoutKcal) {
    return { ok: false, reason: 'KJ_WITHOUT_KCAL' };
  }

  // If no macros were found at all
  if (totalMacroMatchesCount === 0) {
    return { ok: false, reason: 'NOT_A_NUTRITION_BLOCK' };
  }

  // All 4 core macros must be present
  if (
    calories === undefined ||
    protein === undefined ||
    carbs === undefined ||
    fat === undefined
  ) {
    return { ok: false, reason: 'MISSING_MACRO' };
  }

  // Kcal Consistency Check: |4P + 4C + 9F - kcal| <= max(60, 25% * kcal)
  const expectedKcal = 4 * protein + 4 * carbs + 9 * fat;
  const kcalDiscrepancy = Math.abs(expectedKcal - calories);
  const maxAllowedDiscrepancy = Math.max(60, 0.25 * calories);
  if (kcalDiscrepancy > maxAllowedDiscrepancy) {
    return { ok: false, reason: 'KCAL_INCONSISTENT' };
  }

  return {
    ok: true,
    meal: {
      name: mealName,
      servingSize: servingSize !== undefined ? roundToOneDecimal(servingSize) : undefined,
      servingUnit,
      calories: roundToOneDecimal(calories),
      protein: roundToOneDecimal(protein),
      carbs: roundToOneDecimal(carbs),
      fat: roundToOneDecimal(fat),
      fiber: fiber !== undefined ? roundToOneDecimal(fiber) : undefined,
    },
  };
}
