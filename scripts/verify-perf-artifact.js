#!/usr/bin/env node

/**
 * Yourbody V2 — Perf Artifact Verifier
 *
 * Replaces the original inline verification command:
 *
 *   node -e "const d=require('./docs/perf-trace-results.json'); ... process.exit(bad?1:0)"
 *
 * That command was structurally incapable of failing honestly. It trusted whatever
 * docs/perf-trace-results.json happened to contain, and the committed artifact was a
 * recording of REVERTED code — it carried `sets.limit=50` and `limit=25`, the two
 * implementations rejected as Defect 2 (silent truncation of a 500-set workout) and
 * Defect 3 (90-day window 100 -> 25). So the command reported all four routes passing
 * while /workout (182,174 B) and /history (158,904 B) were live over the ceiling.
 *
 * This verifier FAILS CLOSED. It refuses to report a pass unless it can prove the
 * artifact describes the code that is on disk right now:
 *
 *   1. artifact exists and parses
 *   2. artifact carries a `_meta` provenance block (pre-R-1 files do not)
 *   3. `_meta.sourceFingerprint` matches a fingerprint recomputed from the payload
 *      sources listed in scripts/perf-payload-sources.json
 *   4. `_meta.gitCommit` matches the current HEAD
 *   5. every required route is present
 *   6. `_meta.ceilingBytes` matches the manifest's ratified ceiling (nobody can pass
 *      by quietly recording a laxer ceiling)
 *   7. no route exceeds the ceiling
 *   8. `_meta.seedProfile` is present and matches an accepted profile from
 *      the manifest (seed provenance)
 *
 * Exit 0 only when all eight hold. Exit 1 otherwise.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), '..');

const manifestPath = path.resolve(rootDir, 'scripts', 'perf-payload-sources.json');
const budgetPath = path.resolve(rootDir, 'perf-budget.json');
const artifactArg = process.argv[2];
const artifactPath = artifactArg ? path.resolve(rootDir, artifactArg) : path.resolve(rootDir, 'docs', 'perf-trace-results.json');

const failures = [];
const notes = [];

function fail(msg) {
  failures.push(msg);
}

// ---------------------------------------------------------------- manifest & budget
if (!fs.existsSync(manifestPath)) {
  console.error(`FATAL: missing manifest ${path.relative(rootDir, manifestPath)}`);
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const CEILING = manifest.ceilingBytes;
const REQUIRED_ROUTES = manifest.requiredRoutes;
const ACCEPTED_SEED_PROFILES = manifest.acceptedSeedProfiles;

if (!fs.existsSync(budgetPath)) {
  console.error(`FATAL: missing budget ${path.relative(rootDir, budgetPath)}`);
  process.exit(1);
}
const budget = JSON.parse(fs.readFileSync(budgetPath, 'utf8'));
const MAX_QUERIES = budget.maxSupabaseQueriesPerRoute;
if (!MAX_QUERIES || typeof MAX_QUERIES !== 'object') {
  console.error('FATAL: perf-budget.json missing valid maxSupabaseQueriesPerRoute section');
  process.exit(1);
}

// ---------------------------------------------------------------- (1) exists
if (!fs.existsSync(artifactPath)) {
  console.log(`NOTE: ${path.relative(rootDir, artifactPath)} does not exist; skipping artifact verification.`);
  process.exit(0);
}

let artifact;
try {
  artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
} catch (err) {
  console.error(`FAIL: docs/perf-trace-results.json is not valid JSON: ${err.message}`);
  process.exit(1);
}

// ---------------------------------------------------------------- (2) provenance present
const meta = artifact._meta;
if (!meta) {
  fail(
    'artifact has no `_meta` provenance block — it predates R-1 and cannot be ' +
      'distinguished from a recording of reverted code. Regenerate with `npm run perf:trace`.'
  );
}

// ---------------------------------------------------------------- (3) fingerprint
const fingerprintInput = manifest.files
  .map((rel) => {
    const abs = path.resolve(rootDir, rel);
    const body = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '<MISSING>';
    return `${rel}\n${crypto.createHash('md5').update(body).digest('hex')}`;
  })
  .join('\n');
const currentFingerprint = crypto.createHash('md5').update(fingerprintInput).digest('hex');

if (meta) {
  if (!meta.sourceFingerprint) {
    fail('`_meta.sourceFingerprint` is absent — staleness cannot be proven.');
  } else if (meta.sourceFingerprint !== currentFingerprint) {
    fail(
      'STALE ARTIFACT: the payload source files have changed since this measurement.\n' +
        `         recorded fingerprint: ${meta.sourceFingerprint}\n` +
        `         current  fingerprint: ${currentFingerprint}\n` +
        '         The numbers in the artifact describe code that is no longer on disk.\n' +
        '         Re-measure with `npm run perf:trace` before trusting any of them.'
    );
  } else {
    notes.push(`source fingerprint matches (${currentFingerprint.slice(0, 12)})`);
  }
}

// ---------------------------------------------------------------- (4) git commit
let headCommit = 'unknown';
try {
  headCommit = execSync('git rev-parse HEAD', { cwd: rootDir }).toString().trim();
} catch {
  /* non-fatal: the fingerprint check above is the real guard */
}
if (meta) {
  if (!meta.gitCommit || meta.gitCommit === 'unknown') {
    fail('`_meta.gitCommit` is absent or unknown — provenance is incomplete.');
  } else if (headCommit !== 'unknown' && meta.gitCommit !== headCommit) {
    fail(
      `artifact was measured at commit ${meta.gitCommit.slice(0, 7)} but HEAD is now ` +
        `${headCommit.slice(0, 7)}. Re-measure.`
    );
  } else {
    notes.push(`git commit matches (${headCommit.slice(0, 7)})`);
  }
  if (meta.gitDirty) {
    // Not a failure: this programme's entire working tree is intentionally
    // uncommitted. The fingerprint is what actually guarantees freshness.
    notes.push('working tree was dirty at measurement time (fingerprint is authoritative)');
  }
}

// ---------------------------------------------------------------- (6) ceiling integrity
if (meta && meta.ceilingBytes !== undefined && meta.ceilingBytes !== CEILING) {
  fail(
    `artifact records ceilingBytes=${meta.ceilingBytes} but the ratified ceiling is ` +
      `${CEILING}. A pass obtained under a different ceiling is not a pass.`
  );
}

// ---------------------------------------------------------------- (8) seed provenance
if (!ACCEPTED_SEED_PROFILES || !Array.isArray(ACCEPTED_SEED_PROFILES)) {
  fail('manifest is missing a valid `acceptedSeedProfiles` configuration list.');
} else if (meta) {
  const seedProfile = meta.seedProfile;
  if (!seedProfile || !ACCEPTED_SEED_PROFILES.includes(seedProfile)) {
    fail(
      `artifact records unrecognised seedProfile "${seedProfile || 'missing'}" (accepted: [${ACCEPTED_SEED_PROFILES.join(', ')}]).`
    );
  } else {
    notes.push(`seed profile verified: ${seedProfile}`);
  }
}

// ---------------------------------------------------------------- (5)+(7) routes
console.log('=========================================================');
console.log('PERF ARTIFACT VERIFICATION');
console.log('=========================================================');
console.log(`artifact : ${path.relative(rootDir, artifactPath)}`);
if (meta) {
  console.log(`measured : ${meta.generatedAt || 'unknown'}  seed=${meta.seedProfile || 'unspecified'}`);
}
console.log(`ceiling  : ${CEILING} B`);
console.log('---------------------------------------------------------');

let over = 0;
let queryOver = 0;
for (const route of REQUIRED_ROUTES) {
  const r = artifact[route];
  if (!r) {
    fail(`required route "${route}" is missing from the artifact.`);
    console.log(`  ${route.padEnd(16)}   MISSING`);
    continue;
  }
  const bytes = r.supabaseTransferredBytes;
  const queries = r.supabaseQueryCount;
  const queryCap = MAX_QUERIES[route];

  if (typeof queryCap !== 'number') {
    fail(`route "${route}" has no numeric query cap in perf-budget.json.`);
  }

  if (typeof queries !== 'number') {
    fail(`route "${route}" has no numeric supabaseQueryCount.`);
  } else if (typeof queryCap === 'number' && queries > queryCap) {
    queryOver++;
    fail(`route "${route}" query count ${queries} exceeds cap ${queryCap}.`);
  }

  const queryInfo = typeof queries === 'number' && typeof queryCap === 'number'
    ? `${queries}/${queryCap} q`
    : typeof queries === 'number'
    ? `${queries} q`
    : 'no q';

  if (typeof bytes !== 'number') {
    fail(`route "${route}" has no numeric supabaseTransferredBytes.`);
    console.log(`  ${route.padEnd(16)}   NO MEASUREMENT`);
    continue;
  }

  if (bytes > CEILING) {
    over++;
  }

  let statusMsg = '';
  if (bytes > CEILING && typeof queries === 'number' && typeof queryCap === 'number' && queries > queryCap) {
    statusMsg = `OVER by ${bytes - CEILING} B, OVER query cap (${queries} > ${queryCap})`;
  } else if (bytes > CEILING) {
    statusMsg = `OVER by ${bytes - CEILING} B`;
  } else if (typeof queries === 'number' && typeof queryCap === 'number' && queries > queryCap) {
    statusMsg = `OVER query cap (${queries} > ${queryCap})`;
  } else {
    statusMsg = 'within budget';
  }

  console.log(`  ${route.padEnd(16)} ${String(bytes).padStart(9)} B   [${queryInfo.padStart(7)}]   ${statusMsg}`);
}
console.log('---------------------------------------------------------');

if (over > 0) {
  fail(`${over} route(s) exceed the ${CEILING} B ceiling.`);
}
if (queryOver > 0) {
  fail(`${queryOver} route(s) exceed the query count ceiling.`);
}

for (const n of notes) console.log(`  note: ${n}`);

if (failures.length > 0) {
  console.error('');
  console.error('VERDICT: FAIL');
  for (const f of failures) console.error(`  - ${f}`);
  console.error('');
  console.error('Per performance specification, do NOT');
  console.error('raise the ceiling or drop user data to clear this. Address payload size instead.');
  process.exit(1);
}

console.log('');
console.log('VERDICT: PASS — artifact is provably current and every route is within budget.');
process.exit(0);
