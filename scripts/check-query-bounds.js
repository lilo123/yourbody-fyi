#!/usr/bin/env node

/**
 * Yourbody V2 — Supabase Query Bounds Checker
 *
 * Scans non-test TypeScript files under src/ for Supabase .select() queries
 * and enforces that every user-data query carries an explicit, unconditional row bound:
 * .limit(), .range(), .single(), or .maybeSingle().
 *
 * If a bound appears only inside a conditional guard or capability probe,
 * it fails with: CONDITIONAL BOUND (not an explicit bound).
 *
 * Exits with code 0 on PASS, code 1 on FAIL.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.resolve(rootDir, 'src');


function findTsFiles(dir) {
  let files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'test' || entry.name === '__tests__') continue;
      files.push(...findTsFiles(fullPath));
    } else if (
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      !entry.name.endsWith('.d.ts') &&
      !entry.name.includes('.test.') &&
      !entry.name.includes('.spec.')
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

const BOUND_METHODS = new Set(['limit', 'range', 'single', 'maybeSingle']);

function isNodeInConditional(node, stopAtParent) {
  let curr = node.parent;
  while (curr && curr !== stopAtParent) {
    if (
      ts.isIfStatement(curr) ||
      ts.isConditionalExpression(curr) ||
      ts.isSwitchStatement(curr) ||
      ts.isCaseClause(curr) ||
      ts.isDefaultClause(curr)
    ) {
      return true;
    }
    if (ts.isBinaryExpression(curr)) {
      if (
        curr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        curr.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        curr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      ) {
        return true;
      }
    }
    if (
      ts.isFunctionDeclaration(curr) ||
      ts.isFunctionExpression(curr) ||
      ts.isArrowFunction(curr) ||
      ts.isMethodDeclaration(curr)
    ) {
      break;
    }
    curr = curr.parent;
  }
  return false;
}

function getEnclosingStatement(node) {
  let curr = node;
  while (curr && !ts.isStatement(curr)) {
    curr = curr.parent;
  }
  return curr;
}

function checkFile(filePath, violations) {
  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes('.from(') || !content.includes('.select(')) {
    return;
  }

  const sf = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  const relPath = path.relative(rootDir, filePath);

  // Track variable assignments: varName -> { table, line, projSnippet, hasUnconditionalBound, hasConditionalBound }
  const varAssignments = new Map();

  function visit(node) {
    if (ts.isCallExpression(node)) {
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'select'
      ) {
        const caller = node.expression.expression;
        // Verify caller is .from('table')
        if (
          ts.isCallExpression(caller) &&
          ts.isPropertyAccessExpression(caller.expression) &&
          caller.expression.name.text === 'from' &&
          caller.arguments.length > 0 &&
          ts.isStringLiteral(caller.arguments[0])
        ) {
          const table = caller.arguments[0].text;
          const projArg = node.arguments.length > 0 ? node.arguments[0].getText(sf) : '';
          const projSnippet = projArg.replace(/\s+/g, ' ').slice(0, 50);
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart());

          // Get the enclosing statement of the select query
          const selectStmt = getEnclosingStatement(node);

          // Trace parent expression chain for bound methods
          let hasUnconditionalBound = false;
          let hasConditionalBound = false;
          let p = node.parent;
          let assignedVar = null;

          while (p && (ts.isPropertyAccessExpression(p) || ts.isCallExpression(p))) {
            if (ts.isPropertyAccessExpression(p)) {
              if (BOUND_METHODS.has(p.name.text)) {
                if (isNodeInConditional(p, selectStmt ? selectStmt.parent : null)) {
                  hasConditionalBound = true;
                } else {
                  hasUnconditionalBound = true;
                }
              }
            }
            p = p.parent;
          }

          // Check if assigned to a variable for delayed chaining (e.g. let q = ...; q.limit(50))
          let stmt = node.parent;
          while (stmt && !ts.isStatement(stmt)) {
            if (ts.isVariableDeclaration(stmt) && ts.isIdentifier(stmt.name)) {
              assignedVar = stmt.name.text;
              break;
            }
            stmt = stmt.parent;
          }

          if (assignedVar) {
            varAssignments.set(assignedVar, {
              table,
              line: line + 1,
              projSnippet,
              hasUnconditionalBound,
              hasConditionalBound,
              enclosingBlock: stmt ? stmt.parent : null,
            });
          } else {
            if (!hasUnconditionalBound && !hasConditionalBound) {
              violations.push({
                file: relPath,
                line: line + 1,
                table,
                projSnippet,
                type: 'UNBOUNDED',
              });
            } else if (!hasUnconditionalBound && hasConditionalBound) {
              violations.push({
                file: relPath,
                line: line + 1,
                table,
                projSnippet,
                type: 'CONDITIONAL',
              });
            }
          }
        }
      }

      // Check method calls on assigned variables
      if (ts.isPropertyAccessExpression(node.expression)) {
        const propName = node.expression.name.text;
        if (BOUND_METHODS.has(propName)) {
          let obj = node.expression.expression;
          while (obj && ts.isCallExpression(obj)) {
            if (ts.isPropertyAccessExpression(obj.expression)) {
              obj = obj.expression.expression;
            } else {
              break;
            }
          }
          if (obj && ts.isIdentifier(obj) && varAssignments.has(obj.text)) {
            const entry = varAssignments.get(obj.text);
            if (isNodeInConditional(node, entry.enclosingBlock)) {
              entry.hasConditionalBound = true;
            } else {
              entry.hasUnconditionalBound = true;
            }
          }
        }
      }
    }

    // Also check for typeof probes or property accesses on variables (e.g. typeof q.limit === 'function')
    if (ts.isTypeOfExpression(node)) {
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        BOUND_METHODS.has(node.expression.name.text)
      ) {
        let obj = node.expression.expression;
        if (obj && ts.isIdentifier(obj) && varAssignments.has(obj.text)) {
          varAssignments.get(obj.text).hasConditionalBound = true;
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  ts.forEachChild(sf, visit);

  // Check tracked variables
  for (const [, v] of varAssignments) {
    if (!v.hasUnconditionalBound && !v.hasConditionalBound) {
      violations.push({
        file: relPath,
        line: v.line,
        table: v.table,
        projSnippet: v.projSnippet,
        type: 'UNBOUNDED',
      });
    } else if (!v.hasUnconditionalBound && v.hasConditionalBound) {
      violations.push({
        file: relPath,
        line: v.line,
        table: v.table,
        projSnippet: v.projSnippet,
        type: 'CONDITIONAL',
      });
    }
  }
}

function main() {
  console.log('====================================================');
  console.log('🔍 Yourbody Supabase Query Bounds Checker');
  console.log('====================================================\n');

  const targetArg = process.argv[2];
  let files;
  if (targetArg) {
    const resolved = path.resolve(rootDir, targetArg);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      files = [resolved];
    } else if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      files = findTsFiles(resolved);
    } else {
      console.error(`File or directory not found: ${targetArg}`);
      process.exit(1);
    }
  } else {
    files = findTsFiles(srcDir);
  }
  const violations = [];

  for (const file of files) {
    checkFile(file, violations);
  }

  if (violations.length > 0) {
    console.error(`❌ FAIL: Found ${violations.length} query bound violation(s):\n`);
    for (const v of violations) {
      if (v.type === 'CONDITIONAL') {
        console.error(`  CONDITIONAL BOUND (not an explicit bound): ${v.file}:${v.line}  ${v.table}  ${v.projSnippet}`);
      } else {
        console.error(`  UNBOUNDED QUERY: ${v.file}:${v.line}  ${v.table}  ${v.projSnippet}`);
      }
    }
    console.error('\nEvery user-data query must carry an explicit row bound: .limit(), .range(), .single(), or .maybeSingle().');
    console.error('Bounds inside conditional guards or capability probes are rejected.\n');
    process.exit(1);
  }

  console.log('✅ PASS: All Supabase user-data .select() query sites carry explicit row bounds.\n');
  process.exit(0);
}

main();
