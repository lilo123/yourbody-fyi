#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const FORBIDDEN_PATTERNS = [
  /com\.cybergym/,
  /\bCYBER-/,
  /cybergym/i,
];

export const DEFAULT_ALLOWLIST = [
  // 1. Runtime names test
  {
    path: 'src/test/runtimeNames.test.ts',
    linePattern: /\/\/\s*check-brand:\s*allow/,
    reason: 'Runtime names test asserting cybergym absence (YB_PLAN keep)',
  },
  // 2. Deployment inventory section
  {
    path: 'docs/deployment.md',
    linePattern: /^- (?:Renamed|Historical records)|Brand & identifier inventory/,
    reason: 'Brand & identifier inventory section documenting historical identifiers and keeps',
  },
  // 3. M11 coach-code prefix migration files
  {
    path: 'supabase/migrations/20261001000000_coach_code_prefix_yb.sql',
    reason: 'M11 coach code prefix migration up',
  },
  {
    path: 'supabase/rollbacks/20261001000000_coach_code_prefix_yb.down.sql',
    reason: 'M11 coach code prefix migration down',
  },
  {
    path: 'supabase/audits/m11_coach_code_prefix_yb_*.sql',
    reason: 'M11 coach code prefix audit queries',
  },
  {
    path: 'supabase/tests/coach_code_prefix_yb.test.sql',
    reason: 'M11 coach code prefix pgTAP tests',
  },
  // 4. Brand check tool & test self-allowlist
  {
    path: 'scripts/check-brand.js',
    reason: 'Brand check enforcement script',
  },
  {
    path: 'src/utils/check-brand.test.ts',
    reason: 'Brand check unit test suite',
  },
  // 5. Applied historical migrations and down file
  {
    path: 'supabase/migrations/202609*.sql',
    reason: 'Already-applied immutable Supabase database migrations',
  },
  {
    path: 'supabase/rollback/20260916233000_down.sql',
    reason: 'Already-applied migration rollback script',
  },
  // 6. Historical documentation artifacts
  {
    path: 'docs/perf-baseline.md',
    reason: 'Historical performance baseline measurement report',
  },
  {
    path: 'docs/query-plans.md',
    reason: 'Historical database query execution plan audit',
  },
  // 9. Capacitor default template test packages
  {
    path: 'android/app/src/androidTest/**',
    linePattern: /com\.getcapacitor\.myapp/,
    reason: 'Capacitor default template test package com.getcapacitor.myapp',
  },
  {
    path: 'android/app/src/test/**',
    linePattern: /com\.getcapacitor\.myapp/,
    reason: 'Capacitor default template test package com.getcapacitor.myapp',
  },
];

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.pdf',
  '.jar', '.class', '.dump', '.bin', '.exe', '.so', '.dylib',
  '.zip', '.gz', '.tar', '.woff', '.woff2', '.ttf', '.eot',
]);

export function isBinary(filePath, buffer) {
  const ext = path.extname(filePath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) {
    return true;
  }
  if (buffer) {
    const checkLength = Math.min(buffer.length, 8000);
    for (let i = 0; i < checkLength; i++) {
      if (buffer[i] === 0) {
        return true;
      }
    }
  }
  return false;
}

export function matchPath(pattern, filePath) {
  const normPattern = pattern.replace(/\\/g, '/');
  const normPath = filePath.replace(/\\/g, '/');
  if (normPattern === normPath) return true;

  let regexStr = '^';
  let i = 0;
  while (i < normPattern.length) {
    if (normPattern.startsWith('/**', i)) {
      regexStr += '(?:/.*)?';
      i += 3;
    } else if (normPattern.startsWith('**', i)) {
      regexStr += '.*';
      i += 2;
    } else if (normPattern[i] === '*') {
      regexStr += '[^/]*';
      i += 1;
    } else if ('()+?{}^$|[]\\.'.includes(normPattern[i])) {
      regexStr += '\\' + normPattern[i];
      i += 1;
    } else {
      regexStr += normPattern[i];
      i += 1;
    }
  }
  regexStr += '$';
  return new RegExp(regexStr).test(normPath);
}

export function findForbiddenMatch(lineText) {
  for (const pattern of FORBIDDEN_PATTERNS) {
    const match = lineText.match(pattern);
    if (match) {
      return match[0];
    }
  }
  return null;
}

/**
 * Scans string content line by line for brand violations against allowlist.
 * Returns array of violations: Array<{ path, line, text, token }>
 */
export function scanContent(filePath, content, allowlist = DEFAULT_ALLOWLIST, matchedEntries = null) {
  const violations = [];
  const lines = content.split(/\r?\n/);

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const lineText = lines[lineIdx];
    const token = findForbiddenMatch(lineText);
    if (!token) {
      continue;
    }

    const lineNumber = lineIdx + 1;
    let allowed = false;

    for (let entryIdx = 0; entryIdx < allowlist.length; entryIdx++) {
      const entry = allowlist[entryIdx];
      if (matchPath(entry.path, filePath)) {
        if (!entry.linePattern) {
          allowed = true;
          if (matchedEntries) matchedEntries.add(entryIdx);
          break;
        }
        const matchesPattern = entry.linePattern instanceof RegExp
          ? entry.linePattern.test(lineText)
          : lineText.includes(entry.linePattern);
        if (matchesPattern) {
          allowed = true;
          if (matchedEntries) matchedEntries.add(entryIdx);
          break;
        }
      }
    }

    if (!allowed) {
      violations.push({
        path: filePath,
        line: lineNumber,
        text: lineText,
        token,
      });
    }
  }

  return violations;
}

/**
 * Scans git tracked files in rootDir.
 */
export function scanRepository({
  rootDir = process.cwd(),
  fileList = null,
  allowlist = DEFAULT_ALLOWLIST,
  readFile = null,
} = {}) {
  let files = fileList;
  if (!files) {
    try {
      const output = execSync('git ls-files', { cwd: rootDir, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
      files = output.split('\n').filter(Boolean);
    } catch (err) {
      throw new Error(`Failed to list git files: ${err.message}`);
    }
  }

  const violations = [];
  const matchedEntries = new Set();
  let totalFilesScanned = 0;

  for (const relPath of files) {
    const fullPath = path.resolve(rootDir, relPath);
    let buffer;
    if (readFile) {
      const content = readFile(relPath);
      buffer = Buffer.from(content);
    } else {
      if (!fs.existsSync(fullPath)) {
        continue;
      }
      try {
        buffer = fs.readFileSync(fullPath);
      } catch {
        continue;
      }
    }

    if (isBinary(relPath, buffer)) {
      continue;
    }

    totalFilesScanned++;
    const content = buffer.toString('utf-8');
    const fileViolations = scanContent(relPath, content, allowlist, matchedEntries);
    if (fileViolations.length > 0) {
      violations.push(...fileViolations);
    }
  }

  const staleAllowlist = [];
  for (let i = 0; i < allowlist.length; i++) {
    if (!matchedEntries.has(i)) {
      staleAllowlist.push(allowlist[i]);
    }
  }

  return {
    violations,
    staleAllowlist,
    totalFilesScanned,
  };
}

// CLI Execution
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  console.log('🔍 Running check:brand guard...');
  const rootDir = process.cwd();
  const result = scanRepository({ rootDir });

  if (result.staleAllowlist.length > 0) {
    console.warn(`\n[check:brand] ${result.staleAllowlist.length} stale allowlist entries (matched 0 violations):`);
    for (const stale of result.staleAllowlist) {
      console.warn(`   ⚠️  ${stale.path} — ${stale.reason}`);
    }
  }

  if (result.violations.length > 0) {
    console.error(`\n[check:brand] Brand violations found (${result.violations.length} total across repository):`);
    for (const v of result.violations) {
      console.error(`${v.path}:${v.line}: ${v.text.trim()}`);
    }
    console.error(`\n[check:brand] FAILED: ${result.violations.length} violation(s) across ${result.totalFilesScanned} scanned text files.\n`);
    process.exit(1);
  } else {
    console.log(`\n✅ [check:brand] PASSED: Scanned ${result.totalFilesScanned} files, 0 brand violations found.`);
    process.exit(0);
  }
}
