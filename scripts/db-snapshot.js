#!/usr/bin/env node

/**
 * scripts/db-snapshot.js
 *
 * Database snapshot capture and diff assertion tool.
 *
 * Usage:
 *   node scripts/db-snapshot.js before
 *   node scripts/db-snapshot.js after [--assert-equal]
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

const SNAPSHOT_BEFORE_PATH = path.resolve('scripts/.db-snapshot-before.json');
const SNAPSHOT_AFTER_PATH = path.resolve('scripts/.db-snapshot-after.json');

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

function main() {
  const args = process.argv.slice(2);
  const mode = args[0];
  const assertEqual = args.includes('--assert-equal');

  if (mode !== 'before' && mode !== 'after') {
    console.error('Usage: node scripts/db-snapshot.js (before | after [--assert-equal])');
    process.exit(1);
  }

  const currentCounts = getDatabaseCounts();

  if (mode === 'before') {
    fs.writeFileSync(SNAPSHOT_BEFORE_PATH, JSON.stringify(currentCounts, null, 2), 'utf8');
    console.log(`[db-snapshot] Baseline snapshot captured to: ${SNAPSHOT_BEFORE_PATH}`);
    console.log(JSON.stringify(currentCounts, null, 2));
    process.exit(0);
  }

  if (mode === 'after') {
    fs.writeFileSync(SNAPSHOT_AFTER_PATH, JSON.stringify(currentCounts, null, 2), 'utf8');
    console.log(`[db-snapshot] Post-test snapshot captured to: ${SNAPSHOT_AFTER_PATH}`);

    if (!fs.existsSync(SNAPSHOT_BEFORE_PATH)) {
      console.error(`[db-snapshot] ❌ ERROR: Before snapshot not found at ${SNAPSHOT_BEFORE_PATH}`);
      process.exit(1);
    }

    const beforeCounts = JSON.parse(fs.readFileSync(SNAPSHOT_BEFORE_PATH, 'utf8'));

    console.log('====================================================');
    console.log('🔍 Yourbody Database Residue Audit');
    console.log('====================================================');
    console.log(
      `${'Table'.padEnd(24)} ${'Before'.padEnd(10)} ${'After'.padEnd(10)} Diff`
    );
    console.log('-'.repeat(56));

    let hasResidue = false;
    const diffs = [];

    for (const table of TABLES) {
      const before = beforeCounts[table] ?? 0;
      const after = currentCounts[table] ?? 0;
      const delta = after - before;

      let status = '0 (OK)';
      if (delta > 0) {
        status = `+${delta} (RESIDUE)`;
        hasResidue = true;
        diffs.push({ table, before, after, delta });
      } else if (delta < 0) {
        status = `${delta} (DEFICIT)`;
        hasResidue = true;
        diffs.push({ table, before, after, delta });
      }

      console.log(
        `${table.padEnd(24)} ${String(before).padEnd(10)} ${String(after).padEnd(10)} ${status}`
      );
    }

    console.log('-'.repeat(56));

    if (assertEqual && hasResidue) {
      console.error(
        `❌ RESIDUE DETECTED: Database row counts changed during test run!`
      );
      for (const d of diffs) {
        console.error(
          `   - ${d.table}: before=${d.before}, after=${d.after} (delta ${d.delta > 0 ? '+' : ''}${d.delta})`
        );
      }
      process.exit(1);
    } else {
      console.log('✅ ZERO RESIDUE: All database tables maintained exact row-count equality.');
      process.exit(0);
    }
  }
}

main();
