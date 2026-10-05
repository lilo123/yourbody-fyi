#!/usr/bin/env node

/**
 * Yourbody V2 — Supabase Payload Projection Check
 *
 * Scans non-test TypeScript files under src/ for Supabase .select() queries
 * and enforces the heavy-column denylist:
 *   - bare columns: `items`, `ingredients`
 *   - nested embeds: `sets(`, `template_exercises(`
 *
 * Resolves identifiers across module imports (e.g. WORKOUT_WITH_SETS_PROJECTION).
 * Any unresolvable projection argument is flagged as UNRESOLVED and exits 1.
 *
 * Legal annotations (placed within 3 lines immediately preceding .from / .select):
 *   // payload-gate: detail-fetch — <reason>
 *   // payload-gate: accepted-list — <reason>, measured <N> B on <route>
 *
 * Exits with code 0 on PASS, code 1 on FAIL.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const srcDir = path.resolve(rootDir, "src");

export const DENYLIST_TOKENS = ["items", "ingredients", "sets(", "template_exercises("];

export function matchDenylistedTokens(projection) {
  if (!projection || typeof projection !== "string") return [];
  const matched = [];
  if (/\bitems\b/.test(projection)) matched.push("items");
  if (/\bingredients\b/.test(projection)) matched.push("ingredients");
  if (projection.includes("sets(")) matched.push("sets(");
  if (projection.includes("template_exercises(")) matched.push("template_exercises(");
  return matched;
}

export function findTsFiles(dir) {
  let files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "test" || entry.name === "__tests__") continue;
      files.push(...findTsFiles(fullPath));
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts") &&
      !entry.name.includes(".test.") &&
      !entry.name.includes(".spec.")
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

function resolveModulePath(fromDir, specifier, customReader) {
  const base = path.resolve(fromDir, specifier);
  const candidates = [
    base,
    base + ".ts",
    base + ".tsx",
    base + ".js",
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
    path.join(base, "index.js"),
  ];
  for (const c of candidates) {
    if (customReader) {
      if (customReader.exists(c)) return c;
    } else if (fs.existsSync(c) && fs.statSync(c).isFile()) {
      return c;
    }
  }
  return null;
}

function getEnclosingStatement(node) {
  let current = node;
  while (current.parent && !ts.isStatement(current.parent) && !ts.isSourceFile(current.parent)) {
    current = current.parent;
  }
  return ts.isStatement(current) ? current : null;
}

export class ProjectionResolver {
  constructor(options = {}) {
    this.customReader = options.customReader || null;
    this.parsedFiles = new Map();
  }

  getSourceFile(filePath, content) {
    if (this.parsedFiles.has(filePath)) {
      return this.parsedFiles.get(filePath);
    }
    let code = content;
    if (code === undefined) {
      if (this.customReader) {
        code = this.customReader.read(filePath);
      } else {
        code = fs.readFileSync(filePath, "utf8");
      }
    }
    const sf = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true);
    this.parsedFiles.set(filePath, sf);
    return sf;
  }

  resolveIdentifier(identifierName, sf, filePath, visited = new Set()) {
    const key = `${filePath}::${identifierName}`;
    if (visited.has(key)) return null;
    visited.add(key);

    function findInStatements(statements) {
      for (const stmt of statements) {
        if (ts.isVariableStatement(stmt)) {
          for (const decl of stmt.declarationList.declarations) {
            if (ts.isIdentifier(decl.name) && decl.name.text === identifierName && decl.initializer) {
              return decl.initializer;
            }
          }
        }
      }
      return null;
    }

    const localInit = findInStatements(sf.statements);
    if (localInit) {
      return this.resolveExpressionValue(localInit, sf, filePath, visited);
    }

    // Check imports
    for (const stmt of sf.statements) {
      if (ts.isImportDeclaration(stmt) && stmt.importClause && stmt.moduleSpecifier) {
        const modSpecifier = ts.isStringLiteral(stmt.moduleSpecifier) ? stmt.moduleSpecifier.text : null;
        if (!modSpecifier) continue;

        const clause = stmt.importClause;
        if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const el of clause.namedBindings.elements) {
            const local = el.name.text;
            const orig = el.propertyName ? el.propertyName.text : el.name.text;
            if (local === identifierName) {
              const targetModulePath = resolveModulePath(path.dirname(filePath), modSpecifier, this.customReader);
              if (!targetModulePath) return null;
              const targetSf = this.getSourceFile(targetModulePath);
              return this.resolveIdentifier(orig, targetSf, targetModulePath, visited);
            }
          }
        }
      }
    }

    return null;
  }

  resolveExpressionValue(node, sf, filePath, visited = new Set()) {
    if (!node) return null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return node.text;
    }
    if (ts.isIdentifier(node)) {
      return this.resolveIdentifier(node.text, sf, filePath, visited);
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = this.resolveExpressionValue(node.left, sf, filePath, visited);
      const right = this.resolveExpressionValue(node.right, sf, filePath, visited);
      if (left !== null && right !== null) return left + right;
      return null;
    }
    return null;
  }
}

export function parsePrecedingAnnotation(node, caller, sf) {
  const fullText = sf.getFullText();
  const lines = fullText.split(/\r?\n/);

  const selectPos = node.expression.name.getStart(sf);
  const selectLine = sf.getLineAndCharacterOfPosition(selectPos).line;

  const fromPos = caller.getStart(sf);
  const fromLine = sf.getLineAndCharacterOfPosition(fromPos).line;

  const stmt = getEnclosingStatement(caller) || getEnclosingStatement(node);
  const stmtLine = stmt ? sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line : fromLine;

  const referenceLine = Math.min(stmtLine, fromLine);
  const startScan = Math.max(0, referenceLine - 3);
  const endScan = selectLine;

  const foundComments = [];
  for (let i = startScan; i <= endScan; i++) {
    const lineText = lines[i] || "";
    if (lineText.includes("// payload-gate:")) {
      const matchPos = lineText.indexOf("// payload-gate:");
      foundComments.push({
        lineIdx: i,
        distanceFromRef: referenceLine - i,
        distanceFromSelect: selectLine - i,
        text: lineText.slice(matchPos).trim(),
      });
    }
  }

  if (foundComments.length === 0) return null;

  const comment = foundComments[foundComments.length - 1];

  if (comment.distanceFromRef > 3 && comment.distanceFromSelect > 3) {
    return {
      isValid: false,
      error: `Annotation is too far (> 3 lines) from query (line ${comment.lineIdx + 1})`,
      raw: comment.text,
    };
  }

  const detailMatch = /^\/\/\s*payload-gate:\s*detail-fetch\s*[—–-]\s*(.*)$/.exec(comment.text);
  if (detailMatch) {
    const reason = detailMatch[1].trim();
    if (!reason) {
      return {
        isValid: false,
        error: "detail-fetch annotation missing required reason",
        raw: comment.text,
      };
    }
    return {
      isValid: true,
      kind: "detail-fetch",
      reason,
      raw: comment.text,
      line: comment.lineIdx + 1,
    };
  }

  const acceptedMatch = /^\/\/\s*payload-gate:\s*accepted-list\s*[—–-]\s*(.*)$/.exec(comment.text);
  if (acceptedMatch) {
    const body = acceptedMatch[1].trim();
    const byteMatch = /measured\s+(\d+)\s*B/i.exec(body);
    if (!byteMatch) {
      return {
        isValid: false,
        error: "accepted-list annotation missing mandatory measured integer byte count (e.g. \"measured <N> B\")",
        raw: comment.text,
      };
    }
    const measuredBytes = parseInt(byteMatch[1], 10);
    return {
      isValid: true,
      kind: "accepted-list",
      reason: body,
      measuredBytes,
      raw: comment.text,
      line: comment.lineIdx + 1,
    };
  }

  return {
    isValid: false,
    error: `Unknown annotation kind in: "${comment.text}"`,
    raw: comment.text,
  };
}

export function analyzeFile(filePath, options = {}) {
  const resolver = options.resolver || new ProjectionResolver(options);
  const content = options.content !== undefined ? options.content : undefined;
  const sf = resolver.getSourceFile(filePath, content);

  const violations = [];
  const escapes = [];
  const unresolved = [];
  const errors = [];

  function visit(node) {
    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "select") {
        const caller = node.expression.expression;
        if (
          ts.isCallExpression(caller) &&
          ts.isPropertyAccessExpression(caller.expression) &&
          caller.expression.name.text === "from" &&
          caller.arguments.length > 0 &&
          ts.isStringLiteral(caller.arguments[0])
        ) {
          const table = caller.arguments[0].text;
          const selectNamePos = node.expression.name.getStart(sf);
          const { line, character } = sf.getLineAndCharacterOfPosition(selectNamePos);
          const loc = {
            file: filePath,
            relFile: path.relative(rootDir, filePath),
            line: line + 1,
            column: character + 1,
          };

          const arg = node.arguments[0];
          const argText = arg ? arg.getText(sf) : "";

          let projection = null;
          if (!arg) {
            projection = "*";
          } else {
            projection = resolver.resolveExpressionValue(arg, sf, filePath);
          }

          const annotation = parsePrecedingAnnotation(node, caller, sf);

          if (projection === null) {
            unresolved.push({
              ...loc,
              table,
              argText,
              message: `UNRESOLVED: ${loc.relFile}:${loc.line}:${loc.column}  ${table}  argument=${argText}`,
            });
          } else {
            const matchedTokens = matchDenylistedTokens(projection);

            if (annotation) {
              if (!annotation.isValid) {
                violations.push({
                  ...loc,
                  table,
                  matchedTokens,
                  projection,
                  error: annotation.error,
                  message: `INVALID ANNOTATION: ${loc.relFile}:${loc.line}:${loc.column}  ${table}  ${annotation.error}`,
                });
              } else if (matchedTokens.length === 0) {
                violations.push({
                  ...loc,
                  table,
                  matchedTokens,
                  projection,
                  error: "clean site matches no denylisted pattern",
                  message: `INVALID ESCAPE: ${loc.relFile}:${loc.line}:${loc.column}  ${table}  clean site matches no denylisted pattern`,
                });
              } else {
                escapes.push({
                  ...loc,
                  table,
                  matchedTokens,
                  projection,
                  kind: annotation.kind,
                  reason: annotation.reason,
                  measuredBytes: annotation.measuredBytes,
                });
              }
            } else if (matchedTokens.length > 0) {
              violations.push({
                ...loc,
                table,
                matchedTokens,
                projection,
                message: `HEAVY PROJECTION: ${loc.relFile}:${loc.line}:${loc.column}  ${table}  matched=${matchedTokens.join(", ")}  projection=${projection}`,
              });
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);

  return {
    filePath,
    violations,
    escapes,
    unresolved,
    errors,
    ok: violations.length === 0 && unresolved.length === 0 && errors.length === 0,
  };
}

export function analyzeSource(sourceText, options = {}) {
  const filePath = options.filePath || path.resolve(srcDir, "virtual-sample.ts");
  return analyzeFile(filePath, { ...options, content: sourceText });
}

export function analyzeProject(targetSrcDir = srcDir, options = {}) {
  const files = findTsFiles(targetSrcDir);
  const resolver = new ProjectionResolver(options);
  const allViolations = [];
  const allEscapes = [];
  const allUnresolved = [];
  const allErrors = [];

  for (const file of files) {
    const res = analyzeFile(file, { ...options, resolver });
    allViolations.push(...res.violations);
    allEscapes.push(...res.escapes);
    allUnresolved.push(...res.unresolved);
    allErrors.push(...res.errors);
  }

  return {
    scannedFilesCount: files.length,
    violations: allViolations,
    escapes: allEscapes,
    unresolved: allUnresolved,
    errors: allErrors,
    ok: allViolations.length === 0 && allUnresolved.length === 0 && allErrors.length === 0,
  };
}

// CLI Execution Guard
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  console.log("=========================================================");
  console.log("PAYLOAD PROJECTION CHECK");
  console.log("=========================================================");

  const result = analyzeProject(srcDir);

  const detailEscapes = result.escapes.filter((e) => e.kind === "detail-fetch");
  const acceptedEscapes = result.escapes.filter((e) => e.kind === "accepted-list");

  console.log(
    `ANNOTATED ESCAPES (${detailEscapes.length} detail-fetch, ${acceptedEscapes.length} accepted-list):`
  );
  if (result.escapes.length === 0) {
    console.log("  (none)");
  } else {
    if (detailEscapes.length > 0) {
      console.log("  detail-fetch:");
      for (const e of detailEscapes) {
        console.log(`    ${e.relFile}:${e.line}  ${e.table}  ${e.matchedTokens.join(", ")}  — ${e.reason}`);
      }
    }
    if (acceptedEscapes.length > 0) {
      console.log("  accepted-list:");
      for (const e of acceptedEscapes) {
        console.log(`    ${e.relFile}:${e.line}  ${e.table}  ${e.matchedTokens.join(", ")}  — ${e.reason}`);
      }
    }
  }

  console.log("---------------------------------------------------------");

  if (result.unresolved.length > 0) {
    for (const u of result.unresolved) {
      console.log(u.message);
    }
  }

  if (result.violations.length > 0) {
    for (const v of result.violations) {
      console.log(v.message);
    }
  }

  console.log("---------------------------------------------------------");

  if (!result.ok) {
    console.log(`VERDICT: FAIL — ${result.violations.length} heavy/invalid projection(s), ${result.unresolved.length} unresolved.`);
    process.exit(1);
  }

  console.log("VERDICT: PASS — zero unannotated heavy projections and zero unresolved projections.");
  process.exit(0);
}
