#!/usr/bin/env node

/**
 * Yourbody V2 — Perf Trace Runner (R-1b)
 *
 * Runs trace-then-merge in a single command:
 * 1. Cleans stale shards from test-results/perf-shards/
 * 2. Generates a unique PERF_RUN_ID
 * 3. Runs `playwright test --project=perf-trace` with PERF_RUN_ID exported
 * 4. Assembles shards via `merge-perf-shards.js` with PERF_RUN_ID exported
 * 5. Exits with Playwright's exit code if non-zero, else merge's exit code.
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), '..');

// 1. Clean shards
spawnSync('node', ['scripts/merge-perf-shards.js', '--clean'], {
  cwd: rootDir,
  stdio: 'inherit',
});

// 2. Generate unique runId for this execution
const runId = crypto.randomUUID();

// 2b. Detect seed profile from the database (seed provenance)
const detectResult = spawnSync('node', ['scripts/detect-seed-profile.js'], {
  cwd: rootDir,
  encoding: 'utf8',
  env: process.env,
});
const detectedSeedProfile = (detectResult.stdout || '').trim() || 'unspecified';

const inheritedSeedProfile = process.env.PERF_SEED_PROFILE;
if (inheritedSeedProfile && inheritedSeedProfile !== detectedSeedProfile) {
  console.warn(
    `WARNING: Inherited PERF_SEED_PROFILE="${inheritedSeedProfile}" disagrees with derived profile "${detectedSeedProfile}". Overriding with derived profile.`
  );
}
console.log(`Detected database seed profile: ${detectedSeedProfile}`);

const childEnv = {
  ...process.env,
  PERF_RUN_ID: runId,
  PERF_SEED_PROFILE: detectedSeedProfile,
};

// 3. Run playwright test
const pwArgs = ['playwright', 'test', '--project=perf-trace', ...process.argv.slice(2)];
const pwResult = spawnSync('npx', pwArgs, {
  cwd: rootDir,
  stdio: 'inherit',
  env: childEnv,
});

// 4. Run merge
const mergeResult = spawnSync('node', ['scripts/merge-perf-shards.js'], {
  cwd: rootDir,
  stdio: 'inherit',
  env: childEnv,
});

// 5. Exit code propagation
if (pwResult.status !== null && pwResult.status !== 0) {
  process.exit(pwResult.status);
}
if (mergeResult.status !== null && mergeResult.status !== 0) {
  process.exit(mergeResult.status);
}
process.exit(0);
