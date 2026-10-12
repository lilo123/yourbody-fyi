/**
 * Shared Rule-Based Nutrition Parser Core
 *
 * Pure TypeScript nutrition parser with confidence levels, weight extraction,
 * and robust cleanup. Valid for both Deno edge functions and Vite/tsc client builds.
 * Zero external dependencies, zero imports.
 */

export type ParseConfidence = 'exact' | 'lenient' | 'partial' | 'none';

export type NutritionRejectReason =
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

export interface ParsedNutritionMeal {
  name?: string;
  servingSize?: number;
  servingUnit?: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
}

export interface NutritionParseResult {
  confidence: ParseConfidence;
  meal?: ParsedNutritionMeal;
  reason?: NutritionRejectReason;
  skippedLines: string[];
  modifiers: string[];
}

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

interface ExtractedMacroToken {
  kind: 'calories' | 'protein' | 'carbs' | 'fat' | 'fiber' | 'ignorable' | 'kj_only';
  value: number;
  invalidUnit?: boolean;
}

interface ParsedServingLine {
  matched: boolean;
  size?: number;
  unit?: string;
  source: 'per_basis' | 'serving_size' | 'consumed_weight';
  basisLabel?: string;
}

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

function normalizeUnit(rawUnit?: string): string {
  if (!rawUnit) return 'g';
  const unit = rawUnit.trim().toLowerCase();
  if (unit === 'g' || unit === 'gram' || unit === 'grams') return 'g';
  if (unit === 'ml' || unit === 'milliliter' || unit === 'milliliters') return 'ml';
  if (unit === 'oz' || unit === 'ounce' || unit === 'ounces') return 'oz';
  return unit;
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

function cleanLine(rawLine: string): string {
  let line = rawLine.trim();

  // 1. Strip markdown bold and double underscores first: **text** or __text__
  // This must occur before single-asterisk bullet stripping so bold syntax at the start of a line is preserved.
  line = line.replace(/\*\*/g, '').replace(/__/g, '');

  // 2. Strip leading bullets:
  // - single bullet character (*, •, or - not followed immediately by digit)
  // - numbered bullets like "1.", "1)", "2."
  line = line.replace(/^(?:[\*•]\s*|-(?!\d)\s*|\d+[.)]\s+)/u, '');

  // 3. Strip approximation markers: ~, ≈, approx., approx, approximately, about
  line = line.replace(/[~≈]/g, ' ');
  line = line.replace(/\b(?:approximately|approx\.?|about)(?=\s|$|[0-9])/gi, ' ');

  // 4. Collapse extra whitespace created by stripping and trim
  line = line.replace(/\s+/g, ' ').trim();

  // 5. Strip trailing colon if this is a label line with a trailing colon
  // e.g. "Protein ice cream:" -> "Protein ice cream"
  if (line.endsWith(':')) {
    line = line.slice(0, -1).trim();
  }

  return line;
}

function extractInlineModifier(line: string): { cleanedLine: string; modifier?: string } {
  const parenMatch = line.match(
    /\s*\(((?:ate\s+half|had\s+half|half\s+portion|half|1\/2|x\s*\d+|\d+\s*x|two\s+of|\d+\s+of|double))\)\s*$/i
  );
  if (parenMatch) {
    const rawMod = parenMatch[1].trim();
    let canonical = rawMod.toLowerCase();
    if (/^x\s*\d+$/i.test(canonical) || /^\d+\s*x$/i.test(canonical)) {
      const numDigits = canonical.replace(/[^0-9]/g, '');
      canonical = `x${numDigits}`;
    } else if (canonical === '1/2') {
      canonical = 'half';
    } else if (canonical === 'double' || canonical === '2 of') {
      canonical = 'two of';
    }
    const cleanedLine = line.replace(parenMatch[0], '').trim();
    return { cleanedLine, modifier: canonical };
  }
  return { cleanedLine: line };
}

function tryMatchModifierLine(line: string): string | null {
  const trimmed = line.trim();
  if (/^ate\s+half$/i.test(trimmed)) return 'ate half';
  if (/^had\s+half$/i.test(trimmed)) return 'had half';
  if (/^half\s+portion$/i.test(trimmed)) return 'half portion';
  if (/^half$/i.test(trimmed)) return 'half';
  if (/^1\/2$/i.test(trimmed)) return 'half';
  if (/^x\s*2$/i.test(trimmed) || /^2\s*x$/i.test(trimmed)) return 'x2';
  if (/^x\s*(\d+)$/i.test(trimmed)) {
    const match = trimmed.match(/^x\s*(\d+)$/i);
    return `x${match![1]}`;
  }
  if (/^(\d+)\s*x$/i.test(trimmed)) {
    const match = trimmed.match(/^(\d+)\s*x$/i);
    return `x${match![1]}`;
  }
  if (/^two\s+of$/i.test(trimmed) || /^2\s+of$/i.test(trimmed)) return 'two of';
  if (/^three\s+of$/i.test(trimmed) || /^3\s+of$/i.test(trimmed)) return 'three of';
  if (/^double$/i.test(trimmed)) return 'two of';
  return null;
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

function tryParseServingOrWeightLine(line: string): ParsedServingLine {
  const trimmed = line.trim();

  // 1. Explicit consumed weight / net weight / weight labels with g/ml/oz
  // e.g. "Consumed Weight: 543g", "Net Weight 250 g", "Weight: 150g"
  const consumedWeightMatch = trimmed.match(
    /^(?:consumed\s+weight|net\s+weight|weight)[:=\s]+(\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)?$/i
  );
  if (consumedWeightMatch) {
    const size = parseNumber(consumedWeightMatch[1]);
    const unit = normalizeUnit(consumedWeightMatch[2]);
    return {
      matched: true,
      size: size ?? 1,
      unit,
      source: 'consumed_weight',
    };
  }

  // 2. Pattern: "Per 100g", "Per 100 g", "Per 100ml"
  const perNumMatch = trimmed.match(/^per\s+(\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)?$/i);
  if (perNumMatch) {
    const size = parseNumber(perNumMatch[1]);
    const unit = perNumMatch[2] ? normalizeUnit(perNumMatch[2]) : 'serving';
    const basisLabel = size === 100 && unit === 'g' ? 'per 100g' : `per ${size}${unit}`;
    return {
      matched: true,
      size: size ?? 1,
      unit,
      source: 'per_basis',
      basisLabel,
    };
  }

  // 3. Pattern: "Per serving", "Per portion"
  if (/^per\s+(?:serving|portion)$/i.test(trimmed)) {
    return {
      matched: true,
      size: 1,
      unit: 'serving',
      source: 'per_basis',
      basisLabel: 'per serving',
    };
  }

  // 4. Pattern: "Serving size: 1 cup (240ml)", "Serving size 1 bar (60g)", "Serving Size: 30g", "Serving: 30g"
  const servingSizeMatch = trimmed.match(/^serving(?:\s+size)?[:\s]+(.+)$/i);
  if (servingSizeMatch) {
    const rest = servingSizeMatch[1].trim();
    const numMatch = rest.match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);
    if (numMatch) {
      const size = parseNumber(numMatch[1]);
      const rawUnit = numMatch[2].trim();
      const unit = rawUnit ? normalizeUnit(rawUnit) : 'serving';
      return {
        matched: true,
        size: size ?? 1,
        unit,
        source: 'serving_size',
      };
    }
    return {
      matched: true,
      size: 1,
      unit: rest || 'serving',
      source: 'serving_size',
    };
  }

  return { matched: false, source: 'serving_size' };
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
  const energyKjKcalMatch = segment.match(
    /^energy[:=\s]+(?:(\d+(?:[.,]\d+)?)\s*kj\s*(?:[/,\s]+|\s+))?(-?\d+(?:[.,]\d+)?)\s*kcal(?:\s*(?:[/,\s]+|\s+)(\d+(?:[.,]\d+)?)\s*kj)?(?:\s+\d+\s*%)?$/i
  );
  if (energyKjKcalMatch) {
    const kcalVal = parseNumber(energyKjKcalMatch[2]);
    if (kcalVal !== null) {
      return { kind: 'calories', value: kcalVal };
    }
  }

  const energyKjOnlyMatch = segment.match(
    /^energy[:=\s]+(-?\d+(?:[.,]\d+)?)\s*kj(?:\s+\d+\s*%)?$/i
  );
  if (energyKjOnlyMatch) {
    const kjVal = parseNumber(energyKjOnlyMatch[1]);
    return { kind: 'kj_only', value: kjVal ?? 0 };
  }

  const dualKjKcalMatch = segment.match(
    /^(?:(\d+(?:[.,]\d+)?)\s*kj\s*[/,]\s*)?(-?\d+(?:[.,]\d+)?)\s*kcal(?:\s*[/,]\s*(\d+(?:[.,]\d+)?)\s*kj)?(?:\s+\d+\s*%)?$/i
  );
  if (dualKjKcalMatch && dualKjKcalMatch[2]) {
    const kcalVal = parseNumber(dualKjKcalMatch[2]);
    if (kcalVal !== null) {
      return { kind: 'calories', value: kcalVal };
    }
  }

  const caloriesMatch = segment.match(
    /^(?:calories?|cals?)[:=\s]+(-?\d+(?:[.,]\d+)?)\s*(?:kcal|cals?|calories?)?(?:\s+\d+\s*%)?$/i
  );
  if (caloriesMatch) {
    const calVal = parseNumber(caloriesMatch[1]);
    if (calVal !== null) {
      return { kind: 'calories', value: calVal };
    }
  }

  const caloriesKjMatch = segment.match(
    /^(?:calories?|cals?)[:=\s]+(-?\d+(?:[.,]\d+)?)\s*kj(?:\s+\d+\s*%)?$/i
  );
  if (caloriesKjMatch) {
    const kjVal = parseNumber(caloriesKjMatch[1]);
    return { kind: 'kj_only', value: kjVal ?? 0 };
  }

  const numFirstCaloriesMatch = segment.match(
    /^(-?\d+(?:[.,]\d+)?)\s*(?:kcal|cals?|calories)(?:\s+\d+\s*%)?$/i
  );
  if (numFirstCaloriesMatch) {
    const calVal = parseNumber(numFirstCaloriesMatch[1]);
    if (calVal !== null) {
      return { kind: 'calories', value: calVal };
    }
  }

  const shorthandKcalMatch = segment.match(/^(-?\d+(?:[.,]\d+)?)kcal$/i);
  if (shorthandKcalMatch) {
    const calVal = parseNumber(shorthandKcalMatch[1]);
    if (calVal !== null) {
      return { kind: 'calories', value: calVal };
    }
  }

  const calShorthandMatch = segment.match(/^cal[:=\s]+(-?\d+(?:[.,]\d+)?)$/i);
  if (calShorthandMatch) {
    const calVal = parseNumber(calShorthandMatch[1]);
    if (calVal !== null) {
      return { kind: 'calories', value: calVal };
    }
  }

  // 2. Protein
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

export function parseNutritionText(text: string): NutritionParseResult {
  const trimmedInput = text.trim();
  if (!trimmedInput) {
    return {
      confidence: 'none',
      reason: 'EMPTY_INPUT',
      skippedLines: [],
      modifiers: [],
    };
  }

  const rawLines = trimmedInput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (rawLines.length === 0) {
    return {
      confidence: 'none',
      reason: 'EMPTY_INPUT',
      skippedLines: [],
      modifiers: [],
    };
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
    return {
      confidence: 'none',
      reason: 'MULTIPLE_FOODS',
      skippedLines: [],
      modifiers: [],
    };
  }

  // Check if input has completely zero nutrition macro indicators (pure non-nutrition prose / lists)
  const hasAnyMacroKeyword =
    /(?:calories?|kcal|cals?|energy|protein|prot|\bp\d|\d+p\b|carbs?|carbohydrates?|\bc\d|\d+c\b|fat|\bf\d|\d+f\b)/i.test(
      trimmedInput
    );
  if (!hasAnyMacroKeyword) {
    return {
      confidence: 'none',
      reason: 'NOT_A_NUTRITION_BLOCK',
      skippedLines: [],
      modifiers: [],
    };
  }

  // Detect pure conversational prose with meal details
  if (
    /\b(?:i\s+had|i\s+ate|i've\s+had|today\s+for\s+(?:breakfast|lunch|dinner|snack)|today\s+i|recipe\s+for|ingredients:?)\b/i.test(
      trimmedInput
    ) &&
    !/(?:calories?[:=\s]+\d+|energy[:=\s]+\d+|\d+\s*kcal)/i.test(trimmedInput)
  ) {
    return {
      confidence: 'none',
      reason: 'NOT_A_NUTRITION_BLOCK',
      skippedLines: [],
      modifiers: [],
    };
  }

  let mealName: string | undefined = undefined;

  let perBasisServing: { size: number; unit: string; label: string } | undefined = undefined;
  let standardServing: { size: number; unit: string } | undefined = undefined;
  let consumedWeight: { size: number; unit: string } | undefined = undefined;

  let calories: number | undefined = undefined;
  let protein: number | undefined = undefined;
  let carbs: number | undefined = undefined;
  let fat: number | undefined = undefined;
  let fiber: number | undefined = undefined;

  let hadKjWithoutKcal = false;
  let totalMacroMatchesCount = 0;

  const skippedLines: string[] = [];
  const modifiers: string[] = [];

  for (let lineIndex = 0; lineIndex < rawLines.length; lineIndex++) {
    const originalLine = rawLines[lineIndex];
    let cleaned = cleanLine(originalLine);

    if (!cleaned) {
      continue;
    }

    // Check Header Noise
    if (isHeaderNoise(cleaned)) {
      continue;
    }

    // Check Ignorable Sub-rows
    if (isIgnorableSubRow(cleaned)) {
      continue;
    }

    // Check standalone modifier lines (e.g. "ate half", "x2", "two of")
    const standaloneModifier = tryMatchModifierLine(cleaned);
    if (standaloneModifier) {
      if (!modifiers.includes(standaloneModifier)) {
        modifiers.push(standaloneModifier);
      }
      continue;
    }

    // Check inline modifier extraction in parentheses
    const inlineResult = extractInlineModifier(cleaned);
    if (inlineResult.modifier && !modifiers.includes(inlineResult.modifier)) {
      modifiers.push(inlineResult.modifier);
    }
    cleaned = inlineResult.cleanedLine;

    // Check Serving / Weight Line
    const servingMatch = tryParseServingOrWeightLine(cleaned);
    if (servingMatch.matched && servingMatch.size !== undefined && servingMatch.unit !== undefined) {
      if (servingMatch.source === 'consumed_weight') {
        consumedWeight = { size: servingMatch.size, unit: servingMatch.unit };
      } else if (servingMatch.source === 'per_basis') {
        perBasisServing = {
          size: servingMatch.size,
          unit: servingMatch.unit,
          label: servingMatch.basisLabel || 'per serving',
        };
      } else {
        standardServing = { size: servingMatch.size, unit: servingMatch.unit };
      }
      continue;
    }

    // Check if line has a food name prefix like "Chicken breast: 200 kcal, 30g protein..."
    let lineToParse = cleaned;
    const foodPrefixMatch = cleaned.match(/^([a-zA-Z\s&+,;\/]{2,40}):\s*(.+)$/);
    if (foodPrefixMatch) {
      const candidatePrefix = foodPrefixMatch[1].trim();
      const restOfLine = foodPrefixMatch[2].trim();
      if (
        !/^(?:calories?|cal|energy|protein|prot|fat|total\s+fat|carbs?|carbohydrates?|serving|servings|per|fib|fiber|fibre|consumed\s+weight|net\s+weight|weight)$/i.test(
          candidatePrefix
        ) &&
        !/\d/.test(candidatePrefix)
      ) {
        // Conjunctions/list markers in food prefix reject as multiple items
        if (/\b(?:and|with|plus)\b|[&+,;\/]/i.test(candidatePrefix)) {
          return {
            confidence: 'none',
            reason: 'NAME_MULTIPLE_ITEMS',
            skippedLines: [originalLine],
            modifiers,
          };
        }
        if (mealName === undefined && lineIndex === 0) {
          mealName = candidatePrefix;
          lineToParse = restOfLine;
        } else if (mealName !== undefined && mealName !== candidatePrefix) {
          // If restOfLine contains macro/energy keywords, this is a distinct food item
          const restHasNutrition =
            /(?:calories?|cal|energy|protein|prot|fat|carbs?|carbohydrates?|\d+\s*kcal|\bp\d|\bc\d|\bf\d)\b/i.test(
              restOfLine
            );
          if (restHasNutrition) {
            return {
              confidence: 'none',
              reason: 'SECOND_CALORIES_LINE',
              skippedLines: [originalLine],
              modifiers,
            };
          }
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
      let hadInvalidUnit = false;
      let hadOutOfRange = false;
      let hadDuplicateMacro = false;
      let hadSecondCalories = false;

      for (const token of parsedTokens) {
        if (token.kind === 'ignorable') {
          continue;
        }

        if (token.invalidUnit) {
          hadInvalidUnit = true;
          break;
        }

        if (token.kind === 'kj_only') {
          hadKjWithoutKcal = true;
          continue;
        }

        totalMacroMatchesCount++;

        // Value Range validation
        if (token.kind === 'calories') {
          if (token.value < 0 || token.value > 5000) {
            hadOutOfRange = true;
            break;
          }
          if (calories !== undefined) {
            hadSecondCalories = true;
            break;
          }
          calories = token.value;
        } else if (token.kind === 'protein') {
          if (token.value < 0 || token.value > 500) {
            hadOutOfRange = true;
            break;
          }
          if (protein !== undefined) {
            if (Math.abs(protein - token.value) > 0.01) {
              hadDuplicateMacro = true;
              break;
            }
          }
          protein = token.value;
        } else if (token.kind === 'carbs') {
          if (token.value < 0 || token.value > 500) {
            hadOutOfRange = true;
            break;
          }
          if (carbs !== undefined) {
            if (Math.abs(carbs - token.value) > 0.01) {
              hadDuplicateMacro = true;
              break;
            }
          }
          carbs = token.value;
        } else if (token.kind === 'fat') {
          if (token.value < 0 || token.value > 500) {
            hadOutOfRange = true;
            break;
          }
          if (fat !== undefined) {
            if (Math.abs(fat - token.value) > 0.01) {
              hadDuplicateMacro = true;
              break;
            }
          }
          fat = token.value;
        } else if (token.kind === 'fiber') {
          if (token.value < 0 || token.value > 500) {
            hadOutOfRange = true;
            break;
          }
          if (fiber !== undefined) {
            if (Math.abs(fiber - token.value) > 0.01) {
              hadDuplicateMacro = true;
              break;
            }
          }
          fiber = token.value;
        }
      }

      if (hadInvalidUnit) {
        return {
          confidence: 'none',
          reason: 'INVALID_MACRO_UNIT',
          skippedLines,
          modifiers,
        };
      }
      if (hadOutOfRange) {
        return {
          confidence: 'none',
          reason: 'VALUE_OUT_OF_RANGE',
          skippedLines,
          modifiers,
        };
      }
      if (hadSecondCalories) {
        return {
          confidence: 'none',
          reason: 'SECOND_CALORIES_LINE',
          skippedLines,
          modifiers,
        };
      }
      if (hadDuplicateMacro) {
        return {
          confidence: 'none',
          reason: 'DUPLICATE_MACRO',
          skippedLines,
          modifiers,
        };
      }

      continue;
    }

    // Check if line 0 can be a NAME line
    if (lineIndex === 0) {
      if (
        /\b(?:i\s+ran|i\s+walked|i\s+worked\s+out|burned\s+\d+|for\s+dinner\s+i|today\s+i\s+ate)\b/i.test(
          cleaned
        )
      ) {
        return {
          confidence: 'none',
          reason: 'NOT_A_NUTRITION_BLOCK',
          skippedLines: [originalLine],
          modifiers,
        };
      }

      const hasMacroValuesInLine =
        /(?:calories?|cal|kcal)\s*[:=\s]+\d+|\d+\s*kcal|protein\s*[:=\s]+\d+|\d+\s*g?\s*protein|carbs?\s*[:=\s]+\d+|\d+\s*g?\s*carbs?|fat\s*[:=\s]+\d+|\d+\s*g?\s*fat/i.test(
          cleaned
        ) || /\b(?:p\d|c\d|f\d)\b/i.test(cleaned);

      if (hasMacroValuesInLine) {
        return {
          confidence: 'none',
          reason: 'UNEXPLAINED_CONTENT',
          skippedLines: [originalLine],
          modifiers,
        };
      }

      const subsequentLinesHaveMacros = rawLines
        .slice(1)
        .some((l) =>
          /(?:calories?|cal|kcal|energy|protein|prot|fat|carbs?|carbohydrates?)\b/i.test(l)
        );

      if (/\d/.test(cleaned)) {
        if (subsequentLinesHaveMacros) {
          return {
            confidence: 'none',
            reason: 'NAME_CONTAINS_DIGITS',
            skippedLines: [originalLine],
            modifiers,
          };
        }
        return {
          confidence: 'none',
          reason: 'NOT_A_NUTRITION_BLOCK',
          skippedLines: [originalLine],
          modifiers,
        };
      }

      if (cleaned.length > 60) {
        return {
          confidence: 'none',
          reason: 'UNEXPLAINED_CONTENT',
          skippedLines: [originalLine],
          modifiers,
        };
      }

      if (
        /\b(?:i\s+had|i\s+ate|i've\s+had|today\s+i|for\s+(?:breakfast|lunch|dinner|snack)|recipe\s+for|we\s+had)\b/i.test(
          cleaned
        )
      ) {
        return {
          confidence: 'none',
          reason: 'NOT_A_NUTRITION_BLOCK',
          skippedLines: [originalLine],
          modifiers,
        };
      }

      if (rawLines.length === 1) {
        return {
          confidence: 'none',
          reason: 'NOT_A_NUTRITION_BLOCK',
          skippedLines: [originalLine],
          modifiers,
        };
      }

      if (/\b(?:and|with|plus)\b|[&+,;\/]/i.test(cleaned)) {
        return {
          confidence: 'none',
          reason: 'NAME_MULTIPLE_ITEMS',
          skippedLines: [originalLine],
          modifiers,
        };
      }

      mealName = cleaned;
      continue;
    }

    // Line could not be parsed: mark as skipped line
    skippedLines.push(originalLine);
  }

  // Resolve weights and weight modifiers
  let finalServingSize: number | undefined = undefined;
  let finalServingUnit: string | undefined = undefined;

  if (consumedWeight !== undefined) {
    finalServingSize = consumedWeight.size;
    finalServingUnit = consumedWeight.unit;
  } else if (standardServing !== undefined) {
    finalServingSize = standardServing.size;
    finalServingUnit = standardServing.unit;
  } else if (perBasisServing !== undefined) {
    finalServingSize = perBasisServing.size;
    finalServingUnit = perBasisServing.unit;
  }

  // Check for two different weights (e.g. per 100g label + consumed weight)
  if (perBasisServing !== undefined && consumedWeight !== undefined) {
    if (
      perBasisServing.size !== consumedWeight.size ||
      perBasisServing.unit !== consumedWeight.unit
    ) {
      if (!modifiers.includes(perBasisServing.label)) {
        modifiers.push(perBasisServing.label);
      }
    }
  } else if (standardServing !== undefined && consumedWeight !== undefined) {
    if (
      standardServing.size !== consumedWeight.size ||
      standardServing.unit !== consumedWeight.unit
    ) {
      if (!modifiers.includes('per serving')) {
        modifiers.push('per serving');
      }
    }
  }

  // If kJ was present without any kcal
  if (calories === undefined && hadKjWithoutKcal) {
    return {
      confidence: 'none',
      reason: 'KJ_WITHOUT_KCAL',
      skippedLines,
      modifiers,
    };
  }

  // If no macros were found at all
  if (totalMacroMatchesCount === 0) {
    return {
      confidence: 'none',
      reason: 'NOT_A_NUTRITION_BLOCK',
      skippedLines,
      modifiers,
    };
  }

  // Check partial vs full macros
  const coreMacrosCount = [
    calories !== undefined,
    protein !== undefined,
    carbs !== undefined,
    fat !== undefined,
  ].filter(Boolean).length;

  if (coreMacrosCount < 4) {
    const partialMeal: ParsedNutritionMeal = {
      name: mealName,
      servingSize: finalServingSize !== undefined ? roundToOneDecimal(finalServingSize) : undefined,
      servingUnit: finalServingUnit,
      calories: calories !== undefined ? roundToOneDecimal(calories) : 0,
      protein: protein !== undefined ? roundToOneDecimal(protein) : 0,
      carbs: carbs !== undefined ? roundToOneDecimal(carbs) : 0,
      fat: fat !== undefined ? roundToOneDecimal(fat) : 0,
      fiber: fiber !== undefined ? roundToOneDecimal(fiber) : undefined,
    };
    return {
      confidence: 'partial',
      meal: partialMeal,
      reason: 'MISSING_MACRO',
      skippedLines,
      modifiers,
    };
  }

  // Kcal Consistency Check: |4P + 4C + 9F - kcal| <= max(60, 25% * kcal)
  const expectedKcal = 4 * protein! + 4 * carbs! + 9 * fat!;
  const kcalDiscrepancy = Math.abs(expectedKcal - calories!);
  const maxAllowedDiscrepancy = Math.max(60, 0.25 * calories!);
  if (kcalDiscrepancy > maxAllowedDiscrepancy) {
    return {
      confidence: 'none',
      reason: 'KCAL_INCONSISTENT',
      skippedLines,
      modifiers,
    };
  }

  const meal: ParsedNutritionMeal = {
    name: mealName,
    servingSize: finalServingSize !== undefined ? roundToOneDecimal(finalServingSize) : undefined,
    servingUnit: finalServingUnit,
    calories: roundToOneDecimal(calories!),
    protein: roundToOneDecimal(protein!),
    carbs: roundToOneDecimal(carbs!),
    fat: roundToOneDecimal(fat!),
    fiber: fiber !== undefined ? roundToOneDecimal(fiber) : undefined,
  };

  const isLenient = skippedLines.length > 0 || modifiers.length > 0;

  return {
    confidence: isLenient ? 'lenient' : 'exact',
    meal,
    reason: skippedLines.length > 0 ? 'UNEXPLAINED_CONTENT' : undefined,
    skippedLines,
    modifiers,
  };
}
