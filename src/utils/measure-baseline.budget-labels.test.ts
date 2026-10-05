import { describe, it, expect, beforeAll } from 'vitest';
import perfBudgetJson from '../../perf-budget.json';

interface BudgetConfig {
  _ratified?: {
    initialRouteJsGzip?: number;
    note?: string;
  };
  budgets?: {
    initialRouteJsGzip?: number;
    initialRouteJsGzipMaxBytes?: number;
    indexEntryRaw?: number;
    indexRawMaxBytes?: number;
    supabaseVendorRaw?: number;
    reactVendorRaw?: number;
    reactVendorRawMaxBytes?: number;
    maxComponentLoc?: number;
  };
}

declare const process: { version: string };

interface Metrics {
  initialRouteJsGzip?: number;
  indexRaw?: number;
  supabaseRaw?: number;
  vendorRaw?: number;
}

type FormatCriterionRowsFn = (perfBudget: BudgetConfig, metrics?: Metrics) => string[];
type DeriveEnvironmentStringFn = (options?: {
  process?: { version?: string; platform?: string; env?: Record<string, string | undefined> };
  os?: { type?: () => string; hostname?: () => string };
  require?: { resolve: (id: string) => string };
}) => string;
type ResolvePackageVersionFn = (
  pkgSpecifiers: string | string[],
  customRequire?: { resolve: (id: string) => string }
) => string | null;

let formatCriterionRows: FormatCriterionRowsFn;
let deriveEnvironmentString: DeriveEnvironmentStringFn;
let resolvePackageVersion: ResolvePackageVersionFn;

beforeAll(async () => {
  const scriptPath = '../../scripts/measure-baseline.js';
  const mod = (await import(/* @vite-ignore */ scriptPath)) as unknown as {
    formatCriterionRows: FormatCriterionRowsFn;
    deriveEnvironmentString: DeriveEnvironmentStringFn;
    resolvePackageVersion: ResolvePackageVersionFn;
  };
  formatCriterionRows = mod.formatCriterionRows;
  deriveEnvironmentString = mod.deriveEnvironmentString;
  resolvePackageVersion = mod.resolvePackageVersion;
});

describe('measure-baseline budget label dynamic formatting', () => {
  it('derives Criterion #1, #2, and #3 labels dynamically from real perf-budget.json', () => {
    const realMetrics = {
      initialRouteJsGzip: 157044,
      indexRaw: 40274,
      supabaseRaw: 51621,
      vendorRaw: 182129,
    };

    const rows = formatCriterionRows(perfBudgetJson, realMetrics);
    expect(rows).toHaveLength(3);

    // Criterion #1: Initial-Route JS gzip
    const [c1Row, c2Row, c3Row] = rows;
    expect(c1Row).toContain('Criterion #1: Initial-Route JS gzip');
    expect(c1Row).toContain('256,000 B');
    expect(c1Row).toContain('250 KiB');
    expect(c1Row).toContain('✅ PASS');

    // Criterion #2: App Entry Chunk
    expect(c2Row).toContain('Criterion #2: App Entry Chunk');
    expect(c2Row).toContain('120,000 B');
    expect(c2Row).toContain('✅ PASS');

    // Criterion #3: React Vendor Chunk
    expect(c3Row).toContain('Criterion #3: React Vendor Chunk');
    expect(c3Row).toContain('185,000 B');
    expect(c3Row).toContain('160,000 B');
    expect(c3Row).toContain('✅ PASS');
  });

  it('dynamically adapts rendered labels and PASS/FAIL evaluations to custom mock budgets', () => {
    const mockBudget: BudgetConfig = {
      budgets: {
        initialRouteJsGzip: 199680, // 195 KiB
        indexEntryRaw: 50000,
        supabaseVendorRaw: 140000,
        reactVendorRaw: 175000,
      },
    };

    // Case A: Metrics that exceed the mock budget for initialRouteJsGzip and vendorRaw
    const failingMetrics = {
      initialRouteJsGzip: 200000, // 200000 > 199680 -> FAIL
      indexRaw: 40000,           // 40000 <= 50000 -> PASS
      supabaseRaw: 30000,
      vendorRaw: 180000,         // 180000 > 175000 -> FAIL
    };

    const failingRows = formatCriterionRows(mockBudget, failingMetrics);
    expect(failingRows[0]).toContain('199,680 B');
    expect(failingRows[0]).toContain('195 KiB');
    expect(failingRows[0]).toContain('❌ FAIL');
    expect(failingRows[1]).toContain('50,000 B');
    expect(failingRows[1]).toContain('✅ PASS');
    expect(failingRows[2]).toContain('175,000 B');
    expect(failingRows[2]).toContain('140,000 B');
    expect(failingRows[2]).toContain('❌ FAIL');

    // Case B: Metrics within the mock budget threshold
    const passingMetrics = {
      initialRouteJsGzip: 190000, // 190000 <= 199680 -> PASS
      indexRaw: 45000,           // 45000 <= 50000 -> PASS
      supabaseRaw: 30000,
      vendorRaw: 170000,         // 170000 <= 175000 -> PASS
    };

    const passingRows = formatCriterionRows(mockBudget, passingMetrics);
    expect(passingRows[0]).toContain('199,680 B');
    expect(passingRows[0]).toContain('195 KiB');
    expect(passingRows[0]).toContain('✅ PASS');
    expect(passingRows[1]).toContain('50,000 B');
    expect(passingRows[1]).toContain('✅ PASS');
    expect(passingRows[2]).toContain('175,000 B');
    expect(passingRows[2]).toContain('140,000 B');
    expect(passingRows[2]).toContain('✅ PASS');
  });

  it('fails the label test if a hardcoded budget label is introduced', () => {
    const mockBudget: BudgetConfig = {
      budgets: {
        initialRouteJsGzip: 199680,
        indexEntryRaw: 100000,
        supabaseVendorRaw: 150000,
        reactVendorRaw: 170000,
      },
    };
    const rows = formatCriterionRows(mockBudget, {
      initialRouteJsGzip: 150000,
      indexRaw: 40000,
      supabaseRaw: 50000,
      vendorRaw: 160000,
    });
    // Verifies that neither 256,000 B nor 250 KB is present in the mock output
    expect(rows[0]).not.toContain('256,000 B');
    expect(rows[0]).toContain('199,680 B');
    expect(rows[0]).toContain('195 KiB');
  });
});

describe('measure-baseline dynamic environment derivation', () => {
  it('derives environment string containing actual runtime process.version', () => {
    const envStr = deriveEnvironmentString();
    expect(typeof envStr).toBe('string');
    // Must contain process.version rather than a static literal
    expect(envStr).toContain(`Node ${process.version}`);
  });

  it('dynamically adapts to different Node versions (NC-A anti-hardcoding oracle)', () => {
    const mockVersion = 'v20.20.2';
    const envStr = deriveEnvironmentString({
      process: { version: mockVersion, platform: 'linux', env: {} },
    });
    // Verifies dynamic derivation from process.version
    expect(envStr).toContain(`Node ${mockVersion}`);
    // If the string were hardcoded to v22.22.2, this assertion would fail
    expect(envStr).not.toContain('Node v22.22.2');
  });

  it('resolves installed versions for Vite and Playwright metadata', () => {
    const envStr = deriveEnvironmentString();
    // Vite installed is 8.2.2 and Playwright is 1.62.1
    const viteVer = resolvePackageVersion('vite');
    const pwVer = resolvePackageVersion(['playwright', '@playwright/test']);

    expect(viteVer).toBeTruthy();
    expect(pwVer).toBeTruthy();
    expect(envStr).toContain(`Vite ${viteVer}`);
    expect(envStr).toContain(`Playwright ${pwVer}`);
  });

  it('emits explicit (unresolved) marker when a package cannot be resolved (NC-B anti-fabrication oracle)', () => {
    // This asserts against a forced resolution failure rather than the real environment. The
    // previous version asserted 'Lighthouse (unresolved)' on the live environment string, which
    // was never true: lighthouse is a declared devDependency, so it resolves wherever devDeps are
    // installed -- locally and in CI alike.
    const mockRequire = {
      resolve: () => {
        throw new Error('MODULE_NOT_FOUND');
      },
    };
    const missingViteVer = resolvePackageVersion('vite', mockRequire);
    expect(missingViteVer).toBeNull();

    const mockEnvStr = deriveEnvironmentString({
      require: mockRequire,
    });
    expect(mockEnvStr).toContain('Vite (unresolved)');
    expect(mockEnvStr).toContain('Playwright (unresolved)');
    expect(mockEnvStr).toContain('Lighthouse (unresolved)');

    // Must NEVER fall back to a fabricated literal version when resolution fails.
    expect(mockEnvStr).not.toContain('Lighthouse 13.4.1');
    expect(mockEnvStr).not.toMatch(/Lighthouse \d/);
  });

  it('derives platform dynamically and applies (remote VM) only additively', () => {
    // Non-remote platform
    const nonRemote = deriveEnvironmentString({
      os: {
        type: () => 'Darwin',
        hostname: () => 'developer-macbook.local',
      },
      process: { version: 'v22.22.2', platform: 'darwin', env: {} },
    });
    expect(nonRemote.startsWith('Darwin ·')).toBe(true);
    expect(nonRemote).not.toContain('(remote VM)');

    // Remote platform
    const remote = deriveEnvironmentString({
      os: {
        type: () => 'Linux',
        hostname: () => 'test-runner.internal.net',
      },
      process: { version: 'v22.22.2', platform: 'linux', env: { REMOTE_VM: 'true' } },
    });
    expect(remote.startsWith('Linux (remote VM) ·')).toBe(true);
  });
});
