#!/usr/bin/env node

/**
 * Yourbody V2 — Merge Perf Trace Shards (R-1b)
 *
 * Merges individual per-route perf trace shards from test-results/perf-shards/
 * into docs/perf-trace-results.json, stamping a complete _meta provenance block.
 *
 * This separates measurement from aggregation so that worker process restarts
 * under Playwright (which occur when an expectation fails) cannot discard previously
 * measured routes.
 *
 * FAILS CLOSED:
 * - If any required route shard is missing or corrupt, fails loudly with exit 1 and writes nothing.
 * - Enforces run identity:
 *   (a) If PERF_RUN_ID is set: every shard's runId MUST equal it exactly.
 *   (b) If PERF_RUN_ID is NOT set: all shards MUST share one identical non-null runId.
 * - Records _meta.runId, _meta.measuredAtFirst, and _meta.measuredAtLast.
 * - Stale shards can be cleared before runs using `--clean`.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), '..');

const manifestPath = path.resolve(rootDir, 'scripts', 'perf-payload-sources.json');
const shardsDir = path.resolve(rootDir, 'test-results', 'perf-shards');
const outPath = path.resolve(rootDir, 'docs', 'perf-trace-results.json');

// Handle --clean flag
if (process.argv.includes('--clean')) {
  if (fs.existsSync(shardsDir)) {
    fs.rmSync(shardsDir, { recursive: true, force: true });
    console.log(`Cleaned perf shards directory: ${path.relative(rootDir, shardsDir)}`);
  }
  process.exit(0);
}

if (!fs.existsSync(manifestPath)) {
  console.error(`FATAL: missing manifest ${path.relative(rootDir, manifestPath)}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const requiredRoutes = manifest.requiredRoutes;
const CEILING_BYTES = manifest.ceilingBytes || 153600;

if (!fs.existsSync(shardsDir)) {
  console.error('=========================================================');
  console.error('PERF SHARD MERGE: FAIL');
  console.error('=========================================================');
  console.error(`  Shards directory ${path.relative(rootDir, shardsDir)} does not exist.`);
  console.error('  No route shards found. Run `npm run perf:trace` first.');
  process.exit(1);
}

const mergedResults = {};
const missingRoutes = [];
const corruptRoutes = [];

for (const route of requiredRoutes) {
  const shardFile = path.join(shardsDir, `${route}.json`);
  if (!fs.existsSync(shardFile)) {
    missingRoutes.push(route);
    continue;
  }
  try {
    const data = JSON.parse(fs.readFileSync(shardFile, 'utf8'));
    if (typeof data.supabaseTransferredBytes !== 'number') {
      corruptRoutes.push(`${route} (missing supabaseTransferredBytes)`);
      continue;
    }
    const bytes = data.supabaseTransferredBytes;
    const overCeiling = bytes > CEILING_BYTES;
    mergedResults[route] = {
      ...data,
      ceilingBytes: CEILING_BYTES,
      overCeiling,
    };
  } catch (err) {
    corruptRoutes.push(`${route} (invalid JSON: ${err.message})`);
  }
}

if (missingRoutes.length > 0 || corruptRoutes.length > 0) {
  console.error('=========================================================');
  console.error('PERF SHARD MERGE: FAIL — Incomplete or Corrupt Shards');
  console.error('=========================================================');
  if (missingRoutes.length > 0) {
    console.error(`  Missing required route shard(s): ${missingRoutes.join(', ')}`);
  }
  if (corruptRoutes.length > 0) {
    console.error(`  Corrupt route shard(s): ${corruptRoutes.join(', ')}`);
  }
  console.error('  The artifact CANNOT be assembled from a partial set of routes.');
  console.error('  docs/perf-trace-results.json was NOT modified.');
  process.exit(1);
}

// ---------------------------------------------------------------- Run identity & freshness validation
const expectedRunId = process.env.PERF_RUN_ID?.trim() || null;
const runIdErrors = [];
const shardRunIds = new Map();
const measuredAts = [];

for (const route of requiredRoutes) {
  const data = mergedResults[route];
  const shardRunId = (data.runId !== undefined && data.runId !== null) ? String(data.runId).trim() : null;
  shardRunIds.set(route, shardRunId);
  if (data.measuredAt) {
    measuredAts.push(String(data.measuredAt));
  }
}

let agreedRunId = null;

if (expectedRunId) {
  // Case (a): process.env.PERF_RUN_ID is set — every shard's runId MUST equal it exactly
  for (const [route, id] of shardRunIds.entries()) {
    if (!id) {
      runIdErrors.push(`route "${route}" has missing/null runId (expected PERF_RUN_ID="${expectedRunId}")`);
    } else if (id !== expectedRunId) {
      runIdErrors.push(`route "${route}" runId="${id}" does not match PERF_RUN_ID="${expectedRunId}"`);
    }
  }
  agreedRunId = expectedRunId;
} else {
  // Case (b): PERF_RUN_ID is NOT set — all shards MUST still share one identical non-null runId
  const distinctIds = new Set();
  for (const [route, id] of shardRunIds.entries()) {
    if (!id) {
      runIdErrors.push(`route "${route}" has missing/null runId`);
    } else {
      distinctIds.add(id);
    }
  }
  if (distinctIds.size > 1) {
    // Identify majority runId to explicitly name the mismatching route(s)
    const counts = new Map();
    for (const id of shardRunIds.values()) {
      if (id) counts.set(id, (counts.get(id) || 0) + 1);
    }
    let majorityId = null;
    let maxCount = 0;
    for (const [id, count] of counts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        majorityId = id;
      }
    }
    const mismatchDetails = Array.from(shardRunIds.entries())
      .filter(([_, id]) => id !== majorityId)
      .map(([r, id]) => `route "${r}" has runId "${id}" (differs from runId "${majorityId}")`)
      .join(', ');
    runIdErrors.push(`mismatching runId across shards: ${mismatchDetails}`);
  } else if (distinctIds.size === 1) {
    agreedRunId = Array.from(distinctIds)[0];
  }
}

if (runIdErrors.length > 0 || !agreedRunId) {
  console.error('=========================================================');
  console.error('PERF SHARD MERGE: FAIL — Run Identity Mismatch / Stale Shards');
  console.error('=========================================================');
  for (const err of runIdErrors) {
    console.error(`  - ${err}`);
  }
  console.error('  Every shard must carry a matching, non-null runId.');
  console.error('  docs/perf-trace-results.json was NOT modified.');
  process.exit(1);
}

// Compute oldest and newest measuredAt
measuredAts.sort();
const measuredAtFirst = measuredAts[0] || null;
const measuredAtLast = measuredAts[measuredAts.length - 1] || null;

// Compute provenance fingerprint over source files listed in manifest
const fingerprintInput = (manifest.files || [])
  .map((rel) => {
    const abs = path.resolve(rootDir, rel);
    const body = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '<MISSING>';
    return `${rel}\n${crypto.createHash('md5').update(body).digest('hex')}`;
  })
  .join('\n');
const sourceFingerprint = crypto.createHash('md5').update(fingerprintInput).digest('hex');

let gitCommit = 'unknown';
let gitDirty = true;
try {
  gitCommit = execSync('git rev-parse HEAD', { cwd: rootDir }).toString().trim();
  gitDirty = execSync('git status --porcelain', { cwd: rootDir }).toString().trim().length > 0;
} catch {
  // Provenance degrades to "unknown"
}

const routesOverCeiling = requiredRoutes.filter((k) => mergedResults[k].overCeiling);

// ---------------------------------------------------------------- seed provenance
// Derive seed profile directly from the database via scripts/detect-seed-profile.js.
// Do NOT read process.env.PERF_SEED_PROFILE at all (not even as a fallback or cache)
// to ensure every invocation path (runner, standalone merge, CI) derives an honest label.
let derivedSeedProfile = 'unspecified';
try {
  const detectResult = spawnSync('node', ['scripts/detect-seed-profile.js'], {
    cwd: rootDir,
    encoding: 'utf8',
    env: process.env,
  });
  derivedSeedProfile = (detectResult.stdout || '').trim() || 'unspecified';
} catch {
  derivedSeedProfile = 'unspecified';
}

const output = {
  _meta: {
    generatedAt: new Date().toISOString(),
    gitCommit,
    gitDirty,
    sourceFingerprint,
    ceilingBytes: CEILING_BYTES,
    seedProfile: derivedSeedProfile,
    runId: agreedRunId,
    measuredAtFirst,
    measuredAtLast,
    routesMeasured: requiredRoutes.length,
    routesOverCeiling,
  },
  ...mergedResults,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');

console.log('=========================================================');
console.log('PERF SHARD MERGE: SUCCESS');
console.log('=========================================================');
console.log(`Saved merged perf trace data to ${path.relative(rootDir, outPath)}`);
console.log(
  `  commit=${gitCommit.slice(0, 7)} dirty=${gitDirty} fingerprint=${sourceFingerprint.slice(0, 12)} seed=${output._meta.seedProfile}`
);
console.log(`  runId=${agreedRunId} measuredAtFirst=${measuredAtFirst} measuredAtLast=${measuredAtLast}`);
console.log(`  routesOverCeiling=[${routesOverCeiling.join(', ') || 'none'}]`);
for (const k of requiredRoutes) {
  const b = mergedResults[k].supabaseTransferredBytes;
  const over = mergedResults[k].overCeiling;
  console.log(
    `  ${k.padEnd(16)} ${String(b).padStart(9)} B  ${over ? `OVER by ${b - CEILING_BYTES} B` : 'within budget'}`
  );
}
console.log('---------------------------------------------------------');
process.exit(0);
