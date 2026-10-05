#!/usr/bin/env node

/**
 * scripts/verify-db-residue.js
 *
 * Verifies that test executions leave zero residue in the database
 * by comparing current row counts of all public application tables against
 * an expected baseline snapshot.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const DB_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@127.0.0.1:58822/postgres';

const TABLES = [
  'coach_athlete_links',
  'custom_dishes',
  'exercises',
  'nutrition_logs',
  'routine_templates',
  'sets',
  'template_exercises',
  'users',
  'workouts',
];

const DEFAULT_BASELINE = {
  coach_athlete_links: 1,
  custom_dishes: 5,
  exercises: 12,
  nutrition_logs: 50,
  routine_templates: 75,
  sets: 752,
  template_exercises: 150,
  users: 4,
  workouts: 202,
};

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    baselineFile: null,
    snapshotFile: null,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--baseline' && args[i + 1]) {
      options.baselineFile = args[++i];
    } else if (args[i] === '--snapshot-to' && args[i + 1]) {
      options.snapshotFile = args[++i];
    }
  }

  return options;
}

function getDatabaseCounts() {
  const query = TABLES.map(
    (t) => `SELECT '${t}' AS tbl, count(*)::int AS cnt FROM public.${t}`
  ).join(' UNION ALL ') + ' ORDER BY tbl;';

  const cmd = `psql "${DB_URL}" -t -A -F"," -c "${query}"`;
  const raw = execSync(cmd, { encoding: 'utf8' }).trim();

  const counts = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [table, cntStr] = trimmed.split(',');
    counts[table] = parseInt(cntStr, 10);
  }
  return counts;
}

function loadBaseline(baselineFile) {
  if (baselineFile && fs.existsSync(baselineFile)) {
    const content = fs.readFileSync(baselineFile, 'utf8').trim();
    const counts = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [table, cntStr] = trimmed.split(',');
      counts[table] = parseInt(cntStr, 10);
    }
    return counts;
  }
  return DEFAULT_BASELINE;
}

function main() {
  const options = parseArgs();

  const currentCounts = getDatabaseCounts();

  if (options.snapshotFile) {
    const outDir = path.dirname(path.resolve(options.snapshotFile));
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    const lines = Object.entries(currentCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([t, c]) => `${t},${c}`);
    fs.writeFileSync(options.snapshotFile, lines.join('\n') + '\n', 'utf8');
    console.log(`📸 Saved database snapshot to: ${options.snapshotFile}`);
  }

  const baseline = loadBaseline(options.baselineFile);

  console.log('====================================================');
  console.log('🔍 Yourbody DB Residue Verification');
  console.log('====================================================');
  console.log(
    `${'Table'.padEnd(24)} ${'Baseline'.padEnd(10)} ${'Current'.padEnd(10)} Status`
  );
  console.log('-'.repeat(56));

  let hasDiscrepancy = false;
  const discrepancies = [];

  for (const table of TABLES) {
    const base = baseline[table] ?? 0;
    const curr = currentCounts[table] ?? 0;
    const diff = curr - base;

    let statusStr = '✓ OK';
    if (diff > 0) {
      statusStr = `✗ RESIDUE (+${diff})`;
      hasDiscrepancy = true;
      discrepancies.push({ table, base, curr, diff });
    } else if (diff < 0) {
      statusStr = `✗ DEFICIT (${diff})`;
      hasDiscrepancy = true;
      discrepancies.push({ table, base, curr, diff });
    }

    console.log(
      `${table.padEnd(24)} ${String(base).padEnd(10)} ${String(curr).padEnd(10)} ${statusStr}`
    );
  }

  console.log('-'.repeat(56));

  if (hasDiscrepancy) {
    console.error(
      `❌ FAIL: Database residue detected: ${discrepancies.length} table(s) differ from baseline.`
    );
    for (const d of discrepancies) {
      console.error(
        `  - ${d.table}: expected ${d.base}, found ${d.curr} (diff: ${d.diff > 0 ? '+' : ''}${d.diff})`
      );
    }
    process.exit(1);
  } else {
    console.log('✅ PASS: Zero database residue detected across all tables.');
    process.exit(0);
  }
}

main();
