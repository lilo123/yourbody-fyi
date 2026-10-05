#!/usr/bin/env node

/**
 * Yourbody Tier 3 — Seed Profile Detector (Seed Provenance)
 *
 * Why this exists:
 * Previously, docs/perf-trace-results.json recorded `_meta.seedProfile`, which was
 * derived solely from an unverified environment variable:
 *   seedProfile: process.env.PERF_SEED_PROFILE || 'unspecified'
 *
 * This created a critical self-certification hazard (the very hazard the
 * negative control exists to catch: "a pass measured against an unseeded database
 * is not evidence"): an operator could assert PERF_SEED_PROFILE=payload-stress
 * against an empty or lightly populated database, and the artifact would claim
 * that the heavy stress fixture was in place. The verifier previously checked only
 * that the field existed and printed it without validating it against accepted fixtures.
 *
 * To close this fail-open hole, this detector inspects the live database and earns
 * the seed profile label by querying actual database cardinality and heavy payload
 * weight floors (asserting on jsonb payload weight, not merely row counts, because
 * row counts alone cannot distinguish a stress fixture from a trivial one).
 *
 * Output: prints exactly one token to stdout: 'payload-stress' or 'unspecified'.
 * Exit code: always exits 0.
 */

import { spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Pure decision logic evaluating database facts against ratified floor thresholds.
 * Floors are used (>=) so legitimately adding fixture rows later does not break detection.
 *
 * Requirements:
 * - sets total >= 752 AND max sets in a single workout >= 500
 * - custom_dishes >= 5 rows AND sum(octet_length(items::text)) >= 300000
 * - nutrition_logs >= 50 rows AND max(octet_length(items::text)) >= 100000
 * - routine_templates >= 75
 */
export function evaluateSeedProfile(facts) {
  if (!facts || typeof facts !== 'object') {
    return 'unspecified';
  }

  const setsCount = Number(facts.setsCount ?? facts.sets_count ?? 0);
  const maxWorkoutSets = Number(facts.maxWorkoutSets ?? facts.max_workout_sets ?? 0);
  const customDishesCount = Number(facts.customDishesCount ?? facts.custom_dishes_count ?? 0);
  const customDishesItemsBytes = Number(
    facts.customDishesItemsBytes ?? facts.dishes_items_bytes ?? facts.custom_dishes_items_bytes ?? 0
  );
  const nutritionLogsCount = Number(facts.nutritionLogsCount ?? facts.nutrition_logs_count ?? 0);
  const maxNutritionLogsItemsBytes = Number(
    facts.maxNutritionLogsItemsBytes ?? facts.max_nutrition_items_bytes ?? facts.max_nutrition_logs_items_bytes ?? 0
  );
  const routineTemplatesCount = Number(facts.routineTemplatesCount ?? facts.routine_templates_count ?? 0);

  if (
    Number.isNaN(setsCount) ||
    Number.isNaN(maxWorkoutSets) ||
    Number.isNaN(customDishesCount) ||
    Number.isNaN(customDishesItemsBytes) ||
    Number.isNaN(nutritionLogsCount) ||
    Number.isNaN(maxNutritionLogsItemsBytes) ||
    Number.isNaN(routineTemplatesCount)
  ) {
    return 'unspecified';
  }

  const isStress =
    setsCount >= 752 &&
    maxWorkoutSets >= 500 &&
    customDishesCount >= 5 &&
    customDishesItemsBytes >= 300000 &&
    nutritionLogsCount >= 50 &&
    maxNutritionLogsItemsBytes >= 100000 &&
    routineTemplatesCount >= 75;

  return isStress ? 'payload-stress' : 'unspecified';
}

/**
 * Inspects the database at dbUrl and returns 'payload-stress' or 'unspecified'.
 * Never throws, never hangs.
 */
export async function detectSeedProfile(
  dbUrl = process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:58822/postgres'
) {
  try {
    let parsedUrl;
    try {
      parsedUrl = new URL(dbUrl);
    } catch {
      return 'unspecified';
    }

    const host = parsedUrl.hostname || '127.0.0.1';
    const port = parseInt(parsedUrl.port, 10) || 5432;

    // Fast TCP preflight check to fail fast on unreachable host/port
    const reachable = await new Promise((resolve) => {
      const socket = net.createConnection({ host, port });
      socket.setTimeout(2000);
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.on('error', () => {
        resolve(false);
      });
    });

    if (!reachable) {
      return 'unspecified';
    }

    const query = [
      'SELECT',
      '  (SELECT count(*) FROM sets) AS sets_count,',
      '  (SELECT coalesce(max(c), 0) FROM (SELECT count(*) as c FROM sets GROUP BY workout_id) s) AS max_workout_sets,',
      '  (SELECT count(*) FROM custom_dishes) AS custom_dishes_count,',
      '  (SELECT coalesce(sum(octet_length(items::text)), 0) FROM custom_dishes) AS dishes_items_bytes,',
      '  (SELECT count(*) FROM nutrition_logs) AS nutrition_logs_count,',
      '  (SELECT coalesce(max(octet_length(items::text)), 0) FROM nutrition_logs) AS max_nutrition_items_bytes,',
      '  (SELECT count(*) FROM routine_templates) AS routine_templates_count;'
    ].join(' ');

    const res = spawnSync(
      'psql',
      [dbUrl, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-F', ',', '-c', query],
      {
        env: { ...process.env, PGCONNECT_TIMEOUT: '3' },
        timeout: 5000,
        encoding: 'utf8',
      }
    );

    if (res.error || res.status !== 0 || !res.stdout) {
      return 'unspecified';
    }

    const lines = res.stdout.trim().split('\n').map((l) => l.trim()).filter(Boolean);
    const lastLine = lines[lines.length - 1];
    if (!lastLine) {
      return 'unspecified';
    }

    const parts = lastLine.split(',');
    if (parts.length < 7) {
      return 'unspecified';
    }

    const facts = {
      setsCount: parseInt(parts[0], 10),
      maxWorkoutSets: parseInt(parts[1], 10),
      customDishesCount: parseInt(parts[2], 10),
      customDishesItemsBytes: parseInt(parts[3], 10),
      nutritionLogsCount: parseInt(parts[4], 10),
      maxNutritionLogsItemsBytes: parseInt(parts[5], 10),
      routineTemplatesCount: parseInt(parts[6], 10),
    };

    return evaluateSeedProfile(facts);
  } catch {
    return 'unspecified';
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const profile = await detectSeedProfile();
    console.log(profile);
  } catch {
    console.log('unspecified');
  }
  process.exit(0);
}
