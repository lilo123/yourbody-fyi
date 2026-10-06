/**
 * Search normalization and alias expansion utility
 *
 * Implements:
 * 1. NFD folding (strips accents and diacritics)
 * 2. Lowercase conversion
 * 3. Space and punctuation collapsing
 * 4. Workout alias expansion ('rdl' -> 'romanian deadlift', 'ohp' -> 'overhead press')
 * 5. Prefix token matching (e.g. 'zer' -> matches 'Zercher')
 * 6. Token-based body parts matching (split on [,/], no accidental substring collisions)
 */

export const SEARCH_ALIASES: Record<string, string> = {
  rdl: 'romanian deadlift',
  ohp: 'overhead press',
  bb: 'barbell',
  db: 'dumbbell',
  bw: 'bodyweight',
  kb: 'kettlebell',
  bp: 'bench press',
  dl: 'deadlift',
  sq: 'squat',
  sldl: 'straight leg deadlift',
  cgbp: 'close grip bench press',
  bicep: 'biceps',
  tricep: 'triceps',
};

/**
 * Strips punctuation and collapses multiple spaces into a single space.
 * Preserves acronyms like 'r.d.l' -> 'rdl'.
 */
export function stripPunctuation(text: string): string {
  return text
    .replace(/(?<=\b[a-zA-Z0-9])\.(?=[a-zA-Z0-9]\b)/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Folds diacritics via NFD, lowercases, and collapses punctuation/whitespace.
 */
export function cleanSearchText(text: string | null | undefined): string {
  if (!text) return '';
  const nfd = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return stripPunctuation(nfd.toLowerCase());
}

/**
 * Expands known fitness aliases and acronyms in search queries.
 */
export function expandSearchAliases(text: string | null | undefined): string {
  const cleaned = cleanSearchText(text);
  if (!cleaned) return '';

  if (SEARCH_ALIASES[cleaned]) {
    return SEARCH_ALIASES[cleaned];
  }

  const tokens = cleaned.split(' ').filter(Boolean);
  const expanded = tokens.map((t) => SEARCH_ALIASES[t] || t);
  return expanded.join(' ');
}

/**
 * Canonical search query normalizer for catalog queries and duplicate checks.
 */
export function normalizeSearch(query: string | null | undefined): string {
  return expandSearchAliases(query);
}

/**
 * Parses body part tokens from body_parts array (or string).
 * Trims whitespace and splits on [,/].
 */
export function parseBodyPartTokens(
  bodyParts?: string[] | string | null
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  const addToken = (token: string) => {
    const trimmed = token.trim();
    const lower = trimmed.toLowerCase();
    if (trimmed.length > 0 && !seen.has(lower)) {
      seen.add(lower);
      result.push(trimmed);
    }
  };

  if (bodyParts) {
    if (Array.isArray(bodyParts)) {
      for (const bp of bodyParts) {
        if (typeof bp === 'string') {
          const parts = bp.split(/[,/]/);
          for (const p of parts) addToken(p);
        }
      }
    } else if (typeof bodyParts === 'string') {
      const parts = bodyParts.split(/[,/]/);
      for (const p of parts) addToken(p);
    }
  }

  return result;
}

/**
 * Matches an exercise against search query, optional muscle group, and optional equipment.
 */
export function matchesExerciseSearch(
  exercise: {
    name: string;
    body_parts?: string[] | null;
    equipment?: string | null;
  },
  query: string,
  filterMuscleGroup?: string | null,
  filterEquipment?: string | null
): boolean {
  // 1. Equipment filter (exact token match)
  if (filterEquipment && filterEquipment.toLowerCase() !== 'all') {
    const eq = (exercise.equipment || '').toLowerCase().trim();
    if (eq !== filterEquipment.toLowerCase().trim()) {
      return false;
    }
  }

  // 2. Muscle group filter (exact token match on body parts, split on [,/])
  if (filterMuscleGroup && filterMuscleGroup.toLowerCase() !== 'all') {
    const targetGroup = filterMuscleGroup.toLowerCase().trim();
    const tokens = parseBodyPartTokens(exercise.body_parts).map((t) =>
      t.toLowerCase()
    );
    const hasGroup = tokens.some((t) => t === targetGroup);
    if (!hasGroup) {
      return false;
    }
  }

  // 3. Search query matching
  const rawQueryClean = cleanSearchText(query);
  if (!rawQueryClean) {
    return true;
  }

  const expandedQuery = expandSearchAliases(query);
  const targetNameClean = cleanSearchText(exercise.name);

  // Substring match on full name
  if (targetNameClean.includes(rawQueryClean) || targetNameClean.includes(expandedQuery)) {
    return true;
  }

  // Token-level prefix match (e.g. 'zer' matches 'zercher', 'rdl' matches 'romanian deadlift')
  const targetTokens = targetNameClean.split(' ').filter(Boolean);
  const queryTokens = (expandedQuery || rawQueryClean).split(' ').filter(Boolean);

  const allQueryTokensMatch = queryTokens.every((qToken) =>
    targetTokens.some((tToken) => tToken.startsWith(qToken) || tToken.includes(qToken))
  );

  if (allQueryTokensMatch) {
    return true;
  }

  // Also match against body parts
  const bodyPartTokens = parseBodyPartTokens(exercise.body_parts).map(
    cleanSearchText
  );
  if (
    bodyPartTokens.some((bp) =>
      bp.includes(rawQueryClean) ||
      bp.includes(expandedQuery) ||
      queryTokens.some((q) => bp.startsWith(q))
    )
  ) {
    return true;
  }

  return false;
}
