#!/usr/bin/env node

/**
 * Yourbody V2 — Design Standards Ratchet & Gate (P3a)
 *
 * Enforces typography and interaction design standards across src:
 * 1. STD-CMP-7 / STD-INT-3: No `window.confirm(`, bare `confirm(`, `window.alert(`, or bare `alert(` calls.
 *    - Hard rule (zero allowed): all of src/.
 *      Any legacy occurrences at the P3a base are explicitly flagged in `design-ratchet-baseline.json`
 *      and ratcheted down to zero.
 * 2. STD-TYP-3: No `font-mono` (one family: system sans + tabular-nums on numbers).
 * 3. STD-TYP-2: No `font-black` or `font-extrabold` (weights 400/600/700 only; no 500/800/900).
 * 4. STD-TYP-1: No sub-12px text (sizes 16px, 14px, 12px; nothing below 12px).
 *    Detects arbitrary text classes (`text-[10px]`, `text-[11px]`, `text-[9px]`, `text-[0.6..0.7rem]`,
 *    `text-[<length>] < 12px`), named sub-12px tokens (`text-2xs`, `text-3xs`), and inline style `fontSize < 12`.
 * 5. STD-COL-2: No `text-zinc-500` (AA text color: use text-zinc-400 / text-zinc-300 / opacity-50).
 *
 * Ratchet Policy:
 * - Violations per file can only stay the same or decrease over time.
 * - An increase in any file or a new file with non-zero violations exits 1.
 * - When violations decrease, prints a hint to update the baseline.
 * - `--update` rewrites the baseline with lower counts. Increases are rejected unless `--allow-increase` is passed.
 *   NOTE: `--allow-increase` is strictly forbidden by policy.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const rootDir = path.resolve(__dirname, '..');
export const srcDir = path.resolve(rootDir, 'src');
export const defaultBaselinePath = path.resolve(__dirname, 'design-ratchet-baseline.json');

export const RULES = ['confirm', 'font-mono', 'font-black', 'font-extrabold', 'sub-12px', 'zinc-500', 'adhoc-success'];

export const HARD_RULE_DIRECTORIES = ['src'];

/**
 * Strips single-line and multi-line comments from JS/TS source code,
 * preserving strings and line counts.
 */
export function stripComments(source) {
  let result = '';
  let inString = null; // '"', "'", or '`'
  let inComment = null; // 'line' or 'block'
  let i = 0;

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (inComment === 'line') {
      if (ch === '\n') {
        inComment = null;
        result += '\n';
      } else {
        result += ' ';
      }
      i++;
    } else if (inComment === 'block') {
      if (ch === '*' && next === '/') {
        inComment = null;
        result += '  ';
        i += 2;
      } else {
        result += ch === '\n' ? '\n' : ' ';
        i++;
      }
    } else if (inString) {
      result += ch;
      if (ch === '\\') {
        if (next !== undefined) {
          result += next;
          i += 2;
          continue;
        }
      } else if (ch === inString) {
        inString = null;
      }
      i++;
    } else {
      if (ch === '/' && next === '/') {
        inComment = 'line';
        result += '  ';
        i += 2;
      } else if (ch === '/' && next === '*') {
        inComment = 'block';
        result += '  ';
        i += 2;
      } else if (ch === '"' || ch === "'" || ch === '`') {
        inString = ch;
        result += ch;
        i++;
      } else {
        result += ch;
        i++;
      }
    }
  }

  return result;
}

/**
 * Determines whether a length string represents a dimension < 12px.
 * Supports px, rem, em, pt, and unitless numbers.
 * In standard browser root: 1rem = 16px, 1em = 16px, 1pt = 96/72px = 1.3333px.
 */
export function isSub12pxLength(lengthPart) {
  if (!lengthPart || typeof lengthPart !== 'string') return false;
  const trimmed = lengthPart.trim();

  // Check px (e.g. 10px, 11px, 9.5px)
  const pxMatch = trimmed.match(/^([0-9.]+)\s*px$/i);
  if (pxMatch) {
    const num = parseFloat(pxMatch[1]);
    return !isNaN(num) && num < 12;
  }

  // Check rem or em (e.g. 0.7rem, 0.6875rem; 0.75rem = 12px)
  const remMatch = trimmed.match(/^([0-9.]+)\s*(?:rem|em)$/i);
  if (remMatch) {
    const num = parseFloat(remMatch[1]);
    return !isNaN(num) && num * 16 < 12;
  }

  // Check pt (1pt = 1.3333px; 9pt = 12px)
  const ptMatch = trimmed.match(/^([0-9.]+)\s*pt$/i);
  if (ptMatch) {
    const num = parseFloat(ptMatch[1]);
    return !isNaN(num) && num * (96 / 72) < 12;
  }

  // Bare number (e.g. fontSize: 10 or text-[10])
  const bareMatch = trimmed.match(/^([0-9.]+)$/);
  if (bareMatch) {
    const num = parseFloat(bareMatch[1]);
    return !isNaN(num) && num < 12;
  }

  return false;
}

/**
 * Checks whether a relative path falls under the zero-confirm hard rule directories.
 */
export function isHardRuleDir(relPath) {
  const norm = relPath.replace(/\\/g, '/');
  return HARD_RULE_DIRECTORIES.some((dir) => norm === dir || norm.startsWith(`${dir}/`));
}

/**
 * Scans a single file's content and returns counts for all rules.
 */
export function scanFileContent(rawContent, filePath = '') {
  const content = stripComments(rawContent);

  // 1. confirm: window.confirm(, bare confirm(, window.alert(, bare alert(
  // Must be preceded by start of line or non-word/non-dot char, not followed by word chars before (
  const confirmMatches = content.match(/(?:^|[^.\w$])(?:window\s*\.\s*)?(?:confirm|alert)\s*\(/g) || [];

  // 2. font-mono: class name (allows variant prefixes like sm:font-mono)
  const monoMatches = content.match(/(?:^|[^\w-])(?:[a-zA-Z0-9_-]+:)*font-mono(?=[^\w-]|$)/g) || [];

  // 3. font-black: class name (allows variant prefixes like sm:font-black)
  const blackMatches = content.match(/(?:^|[^\w-])(?:[a-zA-Z0-9_-]+:)*font-black(?=[^\w-]|$)/g) || [];

  // 3b. font-extrabold: class name (allows variant prefixes like sm:font-extrabold)
  const extraBoldMatches = content.match(/(?:^|[^\w-])(?:[a-zA-Z0-9_-]+:)*font-extrabold(?=[^\w-]|$)/g) || [];

  // 4. sub-12px: arbitrary text classes, named tokens (text-2xs, text-3xs), and inline style fontSize < 12
  let sub12 = 0;

  // 4a. Arbitrary text classes: text-[10px], text-[11px], text-[0.7rem], text-[10px]/14px, etc.
  const reArbitrary = /(?:^|[^\w-])(?:[a-zA-Z0-9_-]+:)*text-\[([^\]]+)\]/g;
  let m;
  while ((m = reArbitrary.exec(content)) !== null) {
    const lenPart = m[1].split('/')[0].trim();
    if (isSub12pxLength(lenPart)) {
      sub12++;
    }
  }

  // 4b. Named tokens: text-2xs, text-3xs
  const reNamed = /(?:^|[^\w-])(?:[a-zA-Z0-9_-]+:)*text-(?:2xs|3xs)(?=[^\w-]|$)/g;
  while ((m = reNamed.exec(content)) !== null) {
    sub12++;
  }

  // 4c. Inline style: fontSize: 10, fontSize: '10px', font-size: '0.7rem', etc.
  const reStyle = /\b(?:fontSize|font-size)\s*:\s*([^,;}\n]+)/gi;
  while ((m = reStyle.exec(content)) !== null) {
    const rawVal = m[1].trim().replace(/^['"`]|['"`]$/g, '').trim();
    if (isSub12pxLength(rawVal)) {
      sub12++;
    }
  }

  // 5. zinc-500: class token text-zinc-500 (allows variant prefixes like placeholder:text-zinc-500, disabled:text-zinc-500)
  const zinc500Matches = content.match(/(?:^|[^\w-])(?:[a-zA-Z0-9_-]+:)*text-zinc-500(?=[^\w-]|$)/g) || [];

  // 6. adhoc-success: Detects ad-hoc success notifications and banners (STD-FB-1)
  let adhocSuccess = 0;
  const normPath = filePath.replace(/\\/g, '/');
  const isExempt = ['ToastHost', 'ToastContext', 'useToast', 'UndoToast'].some((name) =>
    normPath.includes(name)
  );

  if (!isExempt) {
    // 6a. StatusBanner with tone="success" or tone containing 'success'
    const sbSuccess = content.match(/<StatusBanner[^>]*\btone\s*=\s*(?:["']success["']|\{[^}]*["']success["'][^}]*\})/g) || [];
    adhocSuccess += sbSuccess.length;

    // 6b. StatusBanner with tone="info" carrying legacy success copy ('Saved', 'Meal deleted', etc.)
    const sbInfoSuccess = content.match(/<StatusBanner[^>]*\btone\s*=\s*["']info["'][^>]*(?:message\s*=\s*\{[^}]*(?:Saved|Meal deleted|Custom dish saved)[^}]*\}|message\s*=\s*["'](?:Saved|Meal deleted|Custom dish saved)["']|>(?:[^<]*(?:Saved|Meal deleted))<)/g) || [];
    adhocSuccess += sbInfoSuccess.length;

    // 6c. Legacy setStatus calls with success/saved/deleted messages (should use useToast().show)
    const setStatusSuccess = content.match(/\bsetStatus\s*\(\s*['"`]Saved['"`]\s*\)/g) || [];
    adhocSuccess += setStatusSuccess.length;

    // 6d. Literal 'Copied!' in JSX elements (should use toast instead of inline toggle)
    const litCopied = content.match(/>\s*Copied!\s*<|['"`]Copied!['"`]\s*:/g) || [];
    adhocSuccess += litCopied.length;

    // 6e. Direct <UndoToast usage outside ToastHost (STD-CMP-8: one floating toast slot via useToast)
    const undoToastDirect = content.match(/<UndoToast\b/g) || [];
    adhocSuccess += undoToastDirect.length;
  }

  return {
    confirm: confirmMatches.length,
    'font-mono': monoMatches.length,
    'font-black': blackMatches.length,
    'font-extrabold': extraBoldMatches.length,
    'sub-12px': sub12,
    'zinc-500': zinc500Matches.length,
    'adhoc-success': adhocSuccess,
  };
}

/**
 * Recursively discovers non-test .ts and .tsx files in a directory.
 */
export function findTsFiles(dir) {
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

/**
 * Scans the full codebase and returns per-file counts.
 */
export function scanCodebase(options = {}) {
  const targetDir = options.srcDir || srcDir;
  const baseDir = options.rootDir || rootDir;
  const files = findTsFiles(targetDir).sort();
  const fileCounts = {};

  for (const fullPath of files) {
    const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
    const content = fs.readFileSync(fullPath, 'utf8');
    fileCounts[relPath] = scanFileContent(content, relPath);
  }

  return fileCounts;
}

/**
 * Compares current file counts against the baseline.
 */
export function compareWithBaseline(currentCounts, baseline, _options = {}) {
  const violations = [];
  const hardRuleViolations = [];
  const decreases = [];
  const flaggedActive = [];

  const baselineFiles = baseline?.files || {};
  const flaggedConfirm = baseline?.flaggedConfirm || {};

  const currentTotals = { confirm: 0, 'font-mono': 0, 'font-black': 0, 'font-extrabold': 0, 'sub-12px': 0, 'zinc-500': 0, 'adhoc-success': 0 };
  const baselineTotals = { confirm: 0, 'font-mono': 0, 'font-black': 0, 'font-extrabold': 0, 'sub-12px': 0, 'zinc-500': 0, 'adhoc-success': 0 };

  // Calculate baseline totals
  for (const f of Object.keys(baselineFiles)) {
    for (const rule of RULES) {
      baselineTotals[rule] += baselineFiles[f][rule] || 0;
    }
  }

  // Set of all files to inspect (union of current scanned files and baseline files)
  const allFiles = new Set([...Object.keys(currentCounts), ...Object.keys(baselineFiles)]);

  for (const file of Array.from(allFiles).sort()) {
    const current = currentCounts[file] || { confirm: 0, 'font-mono': 0, 'font-black': 0, 'font-extrabold': 0, 'sub-12px': 0, 'zinc-500': 0, 'adhoc-success': 0 };
    const base = baselineFiles[file] || { confirm: 0, 'font-mono': 0, 'font-black': 0, 'font-extrabold': 0, 'sub-12px': 0, 'zinc-500': 0, 'adhoc-success': 0 };

    if (currentCounts[file]) {
      for (const rule of RULES) {
        currentTotals[rule] += current[rule];
      }
    }

    // --- Hard Rule Check for confirm in workout, sets, common ---
    if (isHardRuleDir(file)) {
      const confirmCount = current.confirm;
      const flaggedEntry = flaggedConfirm[file];
      const allowedFlagged = typeof flaggedEntry === 'number'
        ? flaggedEntry
        : (flaggedEntry?.count ?? 0);

      if (confirmCount > 0) {
        if (!flaggedEntry) {
          // File has confirm calls but is NOT flagged in baseline
          hardRuleViolations.push({
            file,
            count: confirmCount,
            allowed: 0,
            message: `Hard rule violation: ${file} has ${confirmCount} confirm()/alert() call(s). Zero allowed in src (no baseline permitted for unflagged files).`,
          });
        } else if (confirmCount > allowedFlagged) {
          // File is flagged, but count increased above flagged baseline
          hardRuleViolations.push({
            file,
            count: confirmCount,
            allowed: allowedFlagged,
            message: `Hard rule violation: ${file} has ${confirmCount} confirm()/alert() call(s), exceeding flagged baseline of ${allowedFlagged}.`,
          });
        } else {
          flaggedActive.push({
            file,
            count: confirmCount,
            allowed: allowedFlagged,
            reason: flaggedEntry?.reason || 'Legacy confirm at base',
          });
        }
      }
    }

    // --- Ratchet Comparison for all rules ---
    for (const rule of RULES) {
      const oldVal = base[rule] || 0;
      const newVal = current[rule] || 0;

      if (newVal > oldVal) {
        const isNewFile = !baselineFiles[file];
        violations.push({
          file,
          rule,
          old: oldVal,
          new: newVal,
          delta: newVal - oldVal,
          isNewFile,
          message: isNewFile
            ? `New file with non-zero ${rule}: ${file} has ${newVal} violation(s) (baseline: 0).`
            : `Ratchet increase: ${file} [${rule}] increased from ${oldVal} to ${newVal} (+${newVal - oldVal}).`,
        });
      } else if (newVal < oldVal) {
        decreases.push({
          file,
          rule,
          old: oldVal,
          new: newVal,
          delta: oldVal - newVal,
          message: `${file} [${rule}] decreased from ${oldVal} to ${newVal} (-${oldVal - newVal}).`,
        });
      }
    }
  }

  const ok = violations.length === 0 && hardRuleViolations.length === 0;

  return {
    ok,
    violations,
    hardRuleViolations,
    decreases,
    flaggedActive,
    totals: {
      current: currentTotals,
      baseline: baselineTotals,
    },
  };
}

/**
 * Creates an updated baseline object.
 * Enforces that counts can only stay same or decrease unless allowIncrease is set.
 */
export function updateBaseline(currentCounts, oldBaseline, options = {}) {
  const allowIncrease = Boolean(options.allowIncrease);
  const isInitial = !oldBaseline || !oldBaseline.files || Object.keys(oldBaseline.files).length === 0;
  const oldFiles = oldBaseline?.files || {};
  const oldFlagged = oldBaseline?.flaggedConfirm || {};

  const newBaseline = {
    version: 1,
    description: 'Yourbody V2 — Design Ratchet Baseline (STD-TYP-1..4, STD-INT-3, STD-CMP-7)',
    rules: [...RULES],
    hardRuleDirectories: [...HARD_RULE_DIRECTORIES],
    flaggedConfirm: {},
    totals: { confirm: 0, 'font-mono': 0, 'font-black': 0, 'font-extrabold': 0, 'sub-12px': 0, 'zinc-500': 0, 'adhoc-success': 0 },
    files: {},
  };

  // Check for increases if not initial and not allowed
  if (!isInitial) {
    const increases = [];
    for (const file of Object.keys(currentCounts)) {
      const current = currentCounts[file];
      const old = oldFiles[file] || { confirm: 0, 'font-mono': 0, 'font-black': 0, 'font-extrabold': 0, 'sub-12px': 0, 'zinc-500': 0, 'adhoc-success': 0 };

      for (const rule of RULES) {
        const curVal = current[rule] || 0;
        const oldVal = old[rule] || 0;
        if (curVal > oldVal) {
          increases.push({ file, rule, old: oldVal, new: curVal });
        }
      }
    }

    if (increases.length > 0 && !allowIncrease) {
      const sample = increases[0];
      throw new Error(
        `Cannot update baseline: violations increased in ${sample.file} (${sample.rule}: ${sample.old} -> ${sample.new}). --allow-increase is forbidden by policy.`
      );
    }
  }

  // Populate files (only store files with at least one non-zero violation)
  const sortedFiles = Object.keys(currentCounts).sort();
  for (const file of sortedFiles) {
    const counts = currentCounts[file];
    const hasAny = RULES.some((r) => (counts[r] || 0) > 0);

    for (const r of RULES) {
      newBaseline.totals[r] += counts[r] || 0;
    }

    if (hasAny) {
      newBaseline.files[file] = {
        confirm: counts.confirm || 0,
        'font-mono': counts['font-mono'] || 0,
        'font-black': counts['font-black'] || 0,
        'font-extrabold': counts['font-extrabold'] || 0,
        'sub-12px': counts['sub-12px'] || 0,
        'zinc-500': counts['zinc-500'] || 0,
        'adhoc-success': counts['adhoc-success'] || 0,
      };
    }
  }

  // Update flaggedConfirm: ratchets down or initializes legacy flagged entries
  if (oldBaseline?.flaggedConfirm) {
    for (const file of Object.keys(oldFlagged)) {
      const currentConfirm = currentCounts[file]?.confirm || 0;
      const oldEntry = oldFlagged[file];
      const oldAllowed = typeof oldEntry === 'number' ? oldEntry : (oldEntry?.count ?? 0);

      if (currentConfirm > 0) {
        const newAllowed = Math.min(currentConfirm, oldAllowed);
        newBaseline.flaggedConfirm[file] = {
          count: newAllowed,
          reason: (typeof oldEntry === 'object' && oldEntry?.reason) || 'Legacy confirm at base',
        };
      }
      // If currentConfirm is 0, file is resolved and omitted from flaggedConfirm!
    }
  } else {
    // Initial baseline generation: auto-flag legacy confirm calls in hard rule dirs
    for (const file of Object.keys(currentCounts)) {
      if (isHardRuleDir(file) && currentCounts[file].confirm > 0) {
        newBaseline.flaggedConfirm[file] = {
          count: currentCounts[file].confirm,
          reason: `Legacy window.confirm at P3a base (${path.basename(file)}) — flagged for removal`,
        };
      }
    }
  }

  return newBaseline;
}

export function main() {
  const args = process.argv.slice(2);
  const isUpdate = args.includes('--update');
  const allowIncrease = args.includes('--allow-increase');
  const isJson = args.includes('--json');
  const isHelp = args.includes('--help') || args.includes('-h');

  if (isHelp) {
    console.log(`
Yourbody Design Ratchet Gate (STD-TYP-1..4, STD-INT-3, STD-CMP-7)

Usage:
  node scripts/check-design-ratchet.js [options]

Options:
  --update           Rewrite baseline with current counts (only lowering allowed).
  --allow-increase   Allow increases during baseline update. (FORBIDDEN BY POLICY).
  --json             Output results as JSON.
  --help, -h         Show this help message.

Rules Enforced:
  - confirm:   zero window.confirm() / bare confirm() / alert(). Hard rule across all of src.
  - font-mono: zero font-mono classes (STD-TYP-3).
  - font-black: zero font-black classes (STD-TYP-2).
  - font-extrabold: zero font-extrabold classes (STD-TYP-2).
  - sub-12px:  zero text-[<12px], text-2xs/3xs, or inline fontSize < 12 (STD-TYP-1).
  - zinc-500:  zero text-zinc-500 classes (STD-COL-2).
`);
    process.exit(0);
  }

  if (allowIncrease) {
    console.warn('\n⚠️  WARNING: --allow-increase was passed. Increasing baseline violations is forbidden by policy!\n');
  }

  // Read baseline
  let baseline = null;
  if (fs.existsSync(defaultBaselinePath)) {
    try {
      baseline = JSON.parse(fs.readFileSync(defaultBaselinePath, 'utf8'));
    } catch (err) {
      console.error(`❌ Error parsing baseline file at ${defaultBaselinePath}:`, err.message);
      process.exit(1);
    }
  } else if (!isUpdate) {
    console.error(`❌ Baseline file not found at ${defaultBaselinePath}. Run with --update to generate it.`);
    process.exit(1);
  }

  const currentCounts = scanCodebase({ srcDir, rootDir });

  if (isUpdate) {
    try {
      const updated = updateBaseline(currentCounts, baseline, { allowIncrease });
      fs.writeFileSync(defaultBaselinePath, JSON.stringify(updated, null, 2) + '\n', 'utf8');
      console.log(`✅ Design ratchet baseline successfully updated at ${defaultBaselinePath}`);
      console.log(`📊 New baseline totals:`);
      for (const rule of RULES) {
        console.log(`   - ${rule.padEnd(12)}: ${updated.totals[rule]}`);
      }
      process.exit(0);
    } catch (err) {
      console.error(`\n❌ ${err.message}\n`);
      process.exit(1);
    }
  }

  const comparison = compareWithBaseline(currentCounts, baseline);

  if (isJson) {
    console.log(JSON.stringify(comparison, null, 2));
    process.exit(comparison.ok ? 0 : 1);
  }

  console.log('========================================================================');
  console.log('🔍 Yourbody Design Standards Ratchet (STD-TYP-1..4, STD-INT-3, STD-CMP-7)');
  console.log('========================================================================\n');

  console.log(`Scanned ${Object.keys(currentCounts).length} TypeScript source file(s) under src/.\n`);

  console.log('📊 Rule Totals (Current vs Baseline):');
  console.log('| Rule | Current | Baseline | Delta | Status |');
  console.log('|---|:---:|:---:|:---:|---|');
  for (const rule of RULES) {
    const cur = comparison.totals.current[rule];
    const base = comparison.totals.baseline[rule];
    const delta = cur - base;
    const deltaStr = delta > 0 ? `+${delta}` : `${delta}`;
    const status = delta > 0 ? '❌ INCREASE' : delta < 0 ? '📉 DECREASED' : '✅ AT BASELINE';
    console.log(`| \`${rule}\` | ${cur} | ${base} | ${deltaStr} | ${status} |`);
  }
  console.log('');

  if (comparison.flaggedActive.length > 0) {
    console.log(`⚠️  Legacy Flagged Confirm Calls (${comparison.flaggedActive.length} file(s) grandfathered at base):`);
    for (const f of comparison.flaggedActive) {
      console.log(`   - \`${f.file}\`: ${f.count} call(s) (allowed: ${f.allowed}) — ${f.reason}`);
    }
    console.log('');
  }

  if (comparison.hardRuleViolations.length > 0) {
    console.error('🚫 HARD RULE VIOLATIONS (zero confirm() or alert() allowed in src):');
    for (const h of comparison.hardRuleViolations) {
      console.error(`   ❌ ${h.message}`);
    }
    console.error('');
  }

  if (comparison.violations.length > 0) {
    console.error('❌ RATCHET VIOLATIONS (file / rule / old / new):');
    for (const v of comparison.violations) {
      console.error(`   - ${v.file} [${v.rule}]: old ${v.old} -> new ${v.new} (+${v.delta})`);
    }
    console.error('');
  }

  if (comparison.decreases.length > 0) {
    console.log(`💡 RATCHET IMPROVEMENTS (${comparison.decreases.length} decrease(s) observed):`);
    for (const d of comparison.decreases) {
      console.log(`   📉 ${d.message}`);
    }
    console.log(`\nRun 'npm run check:design -- --update' to ratchet down the baseline.\n`);
  }

  if (!comparison.ok) {
    console.error('------------------------------------------------------------------------');
    console.error(`❌ FAIL: ${comparison.violations.length} ratchet violation(s), ${comparison.hardRuleViolations.length} hard rule violation(s).`);
    console.error('Violations cannot increase. Fix the new/increased violations or revert changes.');
    console.error('------------------------------------------------------------------------\n');
    process.exit(1);
  }

  console.log('------------------------------------------------------------------------');
  console.log('✅ PASS: All files satisfy design ratchet baseline and hard rules.');
  console.log('------------------------------------------------------------------------\n');
  process.exit(0);
}

// CLI Execution Guard
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
