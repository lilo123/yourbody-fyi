import { describe, it, expect, beforeAll } from "vitest";

interface ProjectionCheckResult {
  violations: Array<{
    relFile: string;
    line: number;
    column: number;
    table: string;
    matchedTokens: string[];
    projection: string;
    error?: string;
    message: string;
  }>;
  escapes: Array<{
    relFile: string;
    line: number;
    column: number;
    table: string;
    matchedTokens: string[];
    projection: string;
    kind: string;
    reason: string;
    measuredBytes?: number;
  }>;
  unresolved: Array<{
    relFile: string;
    line: number;
    column: number;
    table: string;
    argText: string;
    message: string;
  }>;
  errors: string[];
  ok: boolean;
}

type AnalyzeSourceFn = (
  sourceText: string,
  options?: {
    filePath?: string;
    customReader?: {
      exists: (path: string) => boolean;
      read: (path: string) => string;
    };
  }
) => ProjectionCheckResult;

let analyzeSource: AnalyzeSourceFn;

beforeAll(async () => {
  const scriptPath = "../../scripts/check-payload-projections.js";
  const mod = (await import(/* @vite-ignore */ scriptPath)) as unknown as {
    analyzeSource: AnalyzeSourceFn;
  };
  analyzeSource = mod.analyzeSource;
});

describe("Supabase Payload Projection Check", () => {
  it("flags a projection passed as a string literal containing items", () => {
    const code = [
      "const { data } = await supabase",
      "  .from('nutrition_logs')",
      "  .select('id, items');",
    ].join("\n");

    const result = analyzeSource(code);
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].table).toBe("nutrition_logs");
    expect(result.violations[0].matchedTokens).toContain("items");
    expect(result.escapes).toHaveLength(0);
  });

  it("flags a projection passed as an identifier resolving to a string containing sets(", () => {
    const code = [
      "const WORKOUT_PROJECTION = 'id, date, sets(id, reps, weight)';",
      "const { data } = await supabase",
      "  .from('workouts')",
      "  .select(WORKOUT_PROJECTION);",
    ].join("\n");

    const result = analyzeSource(code);
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].table).toBe("workouts");
    expect(result.violations[0].matchedTokens).toContain("sets(");
  });

  it("resolves an imported identifier across modules (regression guard for trap)", () => {
    const virtualFiles: Record<string, string> = {
      "/repo/src/queries/constants.ts": "export const EMBEDDED_SETS = 'id, name, sets(id, reps)';",
    };

    const code = [
      "import { EMBEDDED_SETS } from './queries/constants';",
      "const { data } = await supabase",
      "  .from('workouts')",
      "  .select(EMBEDDED_SETS);",
    ].join("\n");

    const result = analyzeSource(code, {
      filePath: "/repo/src/consumer.ts",
      customReader: {
        exists: (p) => p in virtualFiles,
        read: (p) => virtualFiles[p],
      },
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].matchedTokens).toContain("sets(");
    expect(result.violations[0].projection).toBe("id, name, sets(id, reps)");
  });

  it("permits an annotated detail-fetch site without flagging it as a violation", () => {
    const code = [
      "// payload-gate: detail-fetch — loaded on demand only on user expand or scale action",
      "const { data } = await supabase",
      "  .from('nutrition_logs')",
      "  .select('id, items');",
    ].join("\n");

    const result = analyzeSource(code);
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.escapes).toHaveLength(1);
    expect(result.escapes[0].kind).toBe("detail-fetch");
    expect(result.escapes[0].reason).toBe("loaded on demand only on user expand or scale action");
  });

  it("rejects an accepted-list annotation with no parsable byte count", () => {
    const code = [
      "// payload-gate: accepted-list — routine template catalog, unmeasured",
      "const { data } = await supabase",
      "  .from('routine_templates')",
      "  .select('id, exercises:template_exercises(id)');",
    ].join("\n");

    const result = analyzeSource(code);
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].error).toContain("missing mandatory measured integer byte count");
    expect(result.escapes).toHaveLength(0);
  });

  it("accepts a valid accepted-list annotation with parsed byte count", () => {
    const code = [
      "// payload-gate: accepted-list — coach routine templates list, measured 54223 B on /coach",
      "const { data } = await supabase",
      "  .from('routine_templates')",
      "  .select('id, exercises:template_exercises(id)');",
    ].join("\n");

    const result = analyzeSource(code);
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.escapes).toHaveLength(1);
    expect(result.escapes[0].kind).toBe("accepted-list");
    expect(result.escapes[0].measuredBytes).toBe(54223);
  });

  it("yields UNRESOLVED and fails when argument cannot be resolved statically", () => {
    const code = [
      "const { data } = await supabase",
      "  .from('workouts')",
      "  .select(UNRESOLVED_DYNAMIC_PROJECTION);",
    ].join("\n");

    const result = analyzeSource(code);
    expect(result.ok).toBe(false);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0].argText).toBe("UNRESOLVED_DYNAMIC_PROJECTION");
    expect(result.violations).toHaveLength(0);
  });

  it("flags an annotation on a clean site as an invalid escape (negative control A1)", () => {
    const code = [
      "// payload-gate: accepted-list — clean site annotation test, measured 100 B on /test",
      "const { data } = await supabase",
      "  .from('exercises')",
      "  .select('id, name, body_parts');",
    ].join("\n");

    const result = analyzeSource(code);
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].error).toContain("clean site matches no denylisted pattern");
    expect(result.escapes).toHaveLength(0);
  });
});
