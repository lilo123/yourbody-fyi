#!/usr/bin/env node

/**
 * Yourbody V2 — Performance Budget Verification Harness
 *
 * Enforces architectural budgets defined in perf-budget.json:
 * 1. index-*.js raw bytes <= indexRawMaxBytes
 * 2. react-vendor-*.js raw bytes <= reactVendorRawMaxBytes
 * 3. Initial route JS gzip bytes <= initialRouteJsGzipMaxBytes
 * 4. src/components/**\/*.tsx max LOC <= maxComponentLoc
 *
 * Exits with code 0 on PASS, code 1 on FAIL.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const targetDir = process.argv[2] || process.env.PERF_DIST_DIR || 'dist';
const budgetConfigPath = path.resolve(rootDir, 'perf-budget.json');
const distDir = path.resolve(rootDir, targetDir);
const reportPath = path.resolve(distDir, 'bundle-size-report.json');
const indexHtmlPath = path.resolve(distDir, 'index.html');
const componentsDir = path.resolve(rootDir, 'src', 'components');

console.log('====================================================');
console.log(`⚡ Yourbody Performance Budget Verification (${targetDir})`);
console.log('====================================================\n');

// 1. Load budget thresholds
if (!fs.existsSync(budgetConfigPath)) {
  console.error(`❌ ERROR: Budget configuration file not found at: ${budgetConfigPath}`);
  process.exit(1);
}

let budgets;
try {
  const configContent = fs.readFileSync(budgetConfigPath, 'utf8');
  const parsed = JSON.parse(configContent);
  budgets = parsed.budgets;
  if (!budgets) {
    throw new Error('Missing "budgets" key in perf-budget.json');
  }
} catch (err) {
  console.error(`❌ ERROR: Failed to parse perf-budget.json: ${err.message}`);
  process.exit(1);
}

const {
  initialRouteJsGzipMaxBytes = 256000,
  indexRawMaxBytes = 120000,
  reactVendorRawMaxBytes = 185000,
  maxComponentLoc = 600,
} = budgets;

// 2. Ensure build exists
if (!fs.existsSync(distDir)) {
  console.error(`❌ ERROR: Build directory "${distDir}" does not exist. Please run "npm run build" first.`);
  process.exit(1);
}

// 3. Collect chunk info
let bundleReport = [];
if (fs.existsSync(reportPath)) {
  try {
    bundleReport = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch (err) {
    console.warn(`⚠️ Warning: Could not parse bundle-size-report.json: ${err.message}. Scanning dist directly.`);
  }
}

// Helper to get raw and gzip sizes for a relative file in dist
function getFileSize(relPath) {
  const cleanPath = relPath.replace(/^\//, '');
  const found = bundleReport.find(
    (item) => item.name === cleanPath || item.name === `assets/${path.basename(cleanPath)}`
  );
  if (found) {
    return { raw: found.raw, gzip: found.gzip };
  }

  const fullPath = path.resolve(distDir, cleanPath);
  if (fs.existsSync(fullPath)) {
    const buffer = fs.readFileSync(fullPath);
    return {
      raw: buffer.length,
      gzip: zlib.gzipSync(buffer).length,
    };
  }
  return null;
}

// Check tracking
const checks = [];

// Metric 1: index-*.js raw bytes
const indexChunk = bundleReport.find((c) => /(?:^|\/)index-[^/]+\.js$/.test(c.name)) ||
  (() => {
    const assetsDir = path.resolve(distDir, 'assets');
    if (fs.existsSync(assetsDir)) {
      const match = fs.readdirSync(assetsDir).find((f) => /^index-.*\.js$/.test(f));
      if (match) return getFileSize(`assets/${match}`);
    }
    return null;
  })();

if (!indexChunk) {
  checks.push({
    name: 'index-*.js raw size',
    passed: false,
    message: 'Could not locate index-*.js bundle in dist',
  });
} else {
  const passed = indexChunk.raw <= indexRawMaxBytes;
  checks.push({
    name: 'index-*.js raw size',
    passed,
    actual: `${indexChunk.raw.toLocaleString()} B (${(indexChunk.raw / 1024).toFixed(2)} KB)`,
    budget: `<= ${indexRawMaxBytes.toLocaleString()} B (${(indexRawMaxBytes / 1024).toFixed(2)} KB)`,
    message: passed
      ? `PASS: index-*.js raw size is ${indexChunk.raw} B (budget: <= ${indexRawMaxBytes} B)`
      : `FAIL: index-*.js raw size ${indexChunk.raw} B exceeds budget of ${indexRawMaxBytes} B`,
  });
}

// Metric 2: react-vendor-*.js raw bytes
const reactVendorChunk = bundleReport.find((c) => /(?:^|\/)react-vendor-[^/]+\.js$/.test(c.name)) ||
  (() => {
    const assetsDir = path.resolve(distDir, 'assets');
    if (fs.existsSync(assetsDir)) {
      const match = fs.readdirSync(assetsDir).find((f) => /^react-vendor-.*\.js$/.test(f));
      if (match) return getFileSize(`assets/${match}`);
    }
    return null;
  })();

if (!reactVendorChunk) {
  checks.push({
    name: 'react-vendor-*.js raw size',
    passed: false,
    message: 'Could not locate react-vendor-*.js bundle in dist',
  });
} else {
  const passed = reactVendorChunk.raw <= reactVendorRawMaxBytes;
  checks.push({
    name: 'react-vendor-*.js raw size',
    passed,
    actual: `${reactVendorChunk.raw.toLocaleString()} B (${(reactVendorChunk.raw / 1024).toFixed(2)} KB)`,
    budget: `<= ${reactVendorRawMaxBytes.toLocaleString()} B (${(reactVendorRawMaxBytes / 1024).toFixed(2)} KB)`,
    message: passed
      ? `PASS: react-vendor-*.js raw size is ${reactVendorChunk.raw} B (budget: <= ${reactVendorRawMaxBytes} B)`
      : `FAIL: react-vendor-*.js raw size ${reactVendorChunk.raw} B exceeds budget of ${reactVendorRawMaxBytes} B`,
  });
}

// Metric 3: Initial route JS gzip bytes
let initialJsFiles = [];
if (fs.existsSync(indexHtmlPath)) {
  const html = fs.readFileSync(indexHtmlPath, 'utf8');
  // Match script src="...js"
  const scriptRegex = /<script[^>]+src=["']([^"']+\.js)["']/gi;
  // Match link rel="modulepreload" href="...js" or href="...js" rel="modulepreload"
  const linkRegex = /<link[^>]+(?:rel=["']modulepreload["'][^>]+href=["']([^"']+\.js)["']|href=["']([^"']+\.js)["'][^>]+rel=["']modulepreload["'])/gi;

  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    initialJsFiles.push(match[1]);
  }
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1] || match[2];
    if (href) initialJsFiles.push(href);
  }
}

// Remove duplicates and normalize
initialJsFiles = [...new Set(initialJsFiles.map((f) => f.replace(/^\//, '')))];

let totalInitialGzip = 0;
const initialRouteBreakdown = [];

if (initialJsFiles.length > 0) {
  for (const file of initialJsFiles) {
    const size = getFileSize(file);
    if (size) {
      totalInitialGzip += size.gzip;
      initialRouteBreakdown.push({ file, gzip: size.gzip, raw: size.raw });
    }
  }
} else {
  // Fallback: sum entry chunk and all standard vendor chunks required for initial paint
  const vendorChunks = bundleReport.filter((c) => {
    const n = c.name;
    return (
      n.endsWith('.js') &&
      (n.includes('index-') ||
        n.includes('react-vendor-') ||
        n.includes('supabase-') ||
        n.includes('tanstack-') ||
        n.includes('react-router-dom-') ||
        n.includes('lucide-react-') ||
        n.includes('rolldown-runtime-') ||
        n.includes('vendor-'))
    );
  });
  for (const c of vendorChunks) {
    totalInitialGzip += c.gzip;
    initialRouteBreakdown.push({ file: c.name, gzip: c.gzip, raw: c.raw });
  }
}

const initialGzipPassed = totalInitialGzip > 0 && totalInitialGzip <= initialRouteJsGzipMaxBytes;
checks.push({
  name: 'Initial route JS gzip size',
  passed: initialGzipPassed,
  actual: `${totalInitialGzip.toLocaleString()} B (${(totalInitialGzip / 1024).toFixed(2)} KB)`,
  budget: `<= ${initialRouteJsGzipMaxBytes.toLocaleString()} B (${(initialRouteJsGzipMaxBytes / 1024).toFixed(2)} KB)`,
  message: initialGzipPassed
    ? `PASS: Initial route JS gzip size is ${totalInitialGzip} B (${(totalInitialGzip / 1024).toFixed(2)} KB) (budget: <= ${initialRouteJsGzipMaxBytes} B)`
    : `FAIL: Initial route JS gzip size ${totalInitialGzip} B exceeds budget of ${initialRouteJsGzipMaxBytes} B`,
  details: initialRouteBreakdown,
});

// Metric 4: Max component LOC in src/components/**/*.tsx (excluding *.test.tsx)
function walkComponents(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const item of list) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      results = results.concat(walkComponents(fullPath));
    } else if (fullPath.endsWith('.tsx') && !fullPath.endsWith('.test.tsx') && !fullPath.endsWith('.spec.tsx')) {
      results.push(fullPath);
    }
  }
  return results;
}

const componentFiles = walkComponents(componentsDir);
let maxLocFound = 0;
let maxLocFile = '';
const locViolations = [];

for (const file of componentFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const lineCount = content.split('\n').length;
  const relPath = path.relative(rootDir, file);
  if (lineCount > maxLocFound) {
    maxLocFound = lineCount;
    maxLocFile = relPath;
  }
  if (lineCount > maxComponentLoc) {
    locViolations.push({ file: relPath, lines: lineCount });
  }
}

const locPassed = locViolations.length === 0;
checks.push({
  name: 'Max component LOC',
  passed: locPassed,
  actual: `${maxLocFound} lines (${maxLocFile})`,
  budget: `<= ${maxComponentLoc} lines`,
  message: locPassed
    ? `PASS: Max component LOC is ${maxLocFound} lines in ${maxLocFile} (budget: <= ${maxComponentLoc} lines)`
    : `FAIL: ${locViolations.length} component(s) exceed ${maxComponentLoc} LOC: ${locViolations.map((v) => `${v.file} (${v.lines} lines)`).join(', ')}`,
});

// Print Results Table
console.log('--------------------------------------------------------------------------------');
console.log(
  '| ' +
    'METRIC'.padEnd(30) +
    '| ' +
    'ACTUAL'.padEnd(25) +
    '| ' +
    'BUDGET'.padEnd(25) +
    '| ' +
    'STATUS'.padEnd(8) +
    '|'
);
console.log('--------------------------------------------------------------------------------');

let allPassed = true;
for (const check of checks) {
  if (!check.passed) allPassed = false;
  const statusStr = check.passed ? '✓ PASS' : '✗ FAIL';
  console.log(
    '| ' +
      check.name.padEnd(30) +
      '| ' +
      (check.actual || 'N/A').padEnd(25) +
      '| ' +
      (check.budget || 'N/A').padEnd(25) +
      '| ' +
      statusStr.padEnd(8) +
      '|'
  );
}
console.log('--------------------------------------------------------------------------------\n');

if (initialRouteBreakdown.length > 0) {
  console.log('Initial Route JS Chunk Breakdown:');
  for (const item of initialRouteBreakdown) {
    console.log(
      `  • ${item.file.padEnd(42)} Gzip: ${item.gzip.toString().padStart(6)} B (${(item.gzip / 1024).toFixed(2).padStart(6)} KB) | Raw: ${item.raw.toString().padStart(7)} B`
    );
  }
  console.log('');
}

if (!allPassed) {
  console.error('❌ PERFORMANCE BUDGET VERIFICATION FAILED:');
  for (const check of checks) {
    if (!check.passed) {
      console.error(`  - ${check.message}`);
    }
  }
  process.exit(1);
} else {
  console.log('✅ ALL PERFORMANCE BUDGET CHECKS PASSED.');
  process.exit(0);
}
