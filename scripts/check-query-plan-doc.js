#!/usr/bin/env node

/**
 * check-query-plan-doc.js
 *
 * Verifies exact set equality between the indexes documented in
 * docs/query-plans.md ("## 5. Complete Index Inventory (`public` Schema)")
 * and the actual indexes present in PostgreSQL's pg_indexes for schemaname = 'public'.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOC_PATH = path.resolve(__dirname, '../docs/query-plans.md');
const DB_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@127.0.0.1:58822/postgres';

function getDocIndexes() {
  if (!fs.existsSync(DOC_PATH)) {
    console.error(`[check-query-plan-doc] Error: File not found: ${DOC_PATH}`);
    process.exit(1);
  }

  const content = fs.readFileSync(DOC_PATH, 'utf8');
  const sectionRegex =
    /## 5\. Complete Index Inventory \(`public` Schema\)[\s\S]*?```text\n([\s\S]*?)```/;
  const match = content.match(sectionRegex);

  if (!match) {
    console.error(
      '[check-query-plan-doc] Error: Could not locate "## 5. Complete Index Inventory (`public` Schema)" section in docs/query-plans.md'
    );
    process.exit(1);
  }

  const lines = match[1].split('\n');
  const docIndexes = new Set();

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      !trimmed ||
      trimmed.startsWith('Table') ||
      trimmed.startsWith('---') ||
      trimmed.startsWith('###')
    ) {
      continue;
    }
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) {
      docIndexes.add(parts[1]);
    }
  }

  return docIndexes;
}

function getLiveIndexes() {
  try {
    const output = execSync(
      `psql "${DB_URL}" -t -A -c "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname;"`,
      { encoding: 'utf8' }
    ).trim();

    if (!output) {
      return new Set();
    }

    const indexes = output
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    return new Set(indexes);
  } catch (err) {
    console.error('[check-query-plan-doc] Error executing psql query:', err);
    process.exit(1);
  }
}

function runAudit() {
  console.log('====================================================');
  console.log('🔍 Yourbody Query Plans Index Audit');
  console.log('====================================================');

  const docIndexes = getDocIndexes();
  const liveIndexes = getLiveIndexes();

  console.log(`Documented indexes count: ${docIndexes.size}`);
  console.log(`Live PostgreSQL indexes count: ${liveIndexes.size}`);

  const extraInDb = [...liveIndexes].filter((idx) => !docIndexes.has(idx));
  const extraInDoc = [...docIndexes].filter((idx) => !liveIndexes.has(idx));

  let hasMismatch = false;

  if (extraInDb.length > 0) {
    hasMismatch = true;
    console.error('\n❌ Extra indexes found in DB but NOT documented:');
    extraInDb.forEach((idx) => console.error(`   - ${idx}`));
  }

  if (extraInDoc.length > 0) {
    hasMismatch = true;
    console.error('\n❌ Extra indexes documented in docs/query-plans.md but NOT present in DB:');
    extraInDoc.forEach((idx) => console.error(`   - ${idx}`));
  }

  if (hasMismatch) {
    console.error('\n❌ FAILED: Exact set equality check failed between docs/query-plans.md and pg_indexes.');
    process.exit(1);
  }

  console.log(`\n✅ SUCCESS: Exact set equality verified! All ${docIndexes.size} public schema indexes match.`);
}

runAudit();
