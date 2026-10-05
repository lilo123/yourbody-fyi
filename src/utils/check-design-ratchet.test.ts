import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';

interface RatchetScanCounts {
  confirm?: number;
  'font-mono'?: number;
  'font-black'?: number;
  'font-extrabold'?: number;
  'sub-12px'?: number;
  'zinc-500'?: number;
  'adhoc-success'?: number;
}

interface RatchetBaseline {
  version: number;
  description: string;
  rules: string[];
  hardRuleDirectories: string[];
  flaggedConfirm: Record<string, { count: number; reason: string } | number>;
  totals: RatchetScanCounts;
  files: Record<string, RatchetScanCounts>;
}

interface ComparisonResult {
  ok: boolean;
  violations: Array<{
    file: string;
    rule: string;
    old: number;
    new: number;
    delta: number;
    isNewFile: boolean;
    message: string;
  }>;
  hardRuleViolations: Array<{
    file: string;
    count: number;
    allowed: number;
    message: string;
  }>;
  decreases: Array<{
    file: string;
    rule: string;
    old: number;
    new: number;
    delta: number;
    message: string;
  }>;
  flaggedActive: Array<{
    file: string;
    count: number;
    allowed: number;
    reason: string;
  }>;
  totals: {
    current: RatchetScanCounts;
    baseline: RatchetScanCounts;
  };
}

type ScanContentFn = (rawContent: string, filePath?: string) => RatchetScanCounts;
type CompareFn = (
  currentCounts: Record<string, RatchetScanCounts>,
  baseline: RatchetBaseline,
  options?: { allowIncrease?: boolean }
) => ComparisonResult;
type UpdateBaselineFn = (
  currentCounts: Record<string, RatchetScanCounts>,
  oldBaseline: RatchetBaseline | null,
  options?: { allowIncrease?: boolean }
) => RatchetBaseline;
type IsHardRuleDirFn = (relPath: string) => boolean;
type IsSub12pxLengthFn = (lengthPart: string) => boolean;
type StripCommentsFn = (source: string) => string;

let scanFileContent: ScanContentFn;
let compareWithBaseline: CompareFn;
let updateBaseline: UpdateBaselineFn;
let isHardRuleDir: IsHardRuleDirFn;
let isSub12pxLength: IsSub12pxLengthFn;
let stripComments: StripCommentsFn;
let defaultBaselinePath: string;

beforeAll(async () => {
  const scriptPath = path.resolve(__dirname, '../../scripts/check-design-ratchet.js');
  const mod = (await import(/* @vite-ignore */ scriptPath)) as {
    scanFileContent: ScanContentFn;
    compareWithBaseline: CompareFn;
    updateBaseline: UpdateBaselineFn;
    isHardRuleDir: IsHardRuleDirFn;
    isSub12pxLength: IsSub12pxLengthFn;
    stripComments: StripCommentsFn;
    defaultBaselinePath: string;
  };

  scanFileContent = mod.scanFileContent;
  compareWithBaseline = mod.compareWithBaseline;
  updateBaseline = mod.updateBaseline;
  isHardRuleDir = mod.isHardRuleDir;
  isSub12pxLength = mod.isSub12pxLength;
  stripComments = mod.stripComments;
  defaultBaselinePath = mod.defaultBaselinePath;
});

describe('Design Ratchet Checker (scripts/check-design-ratchet.js)', () => {
  const mockBaseline: RatchetBaseline = {
    version: 1,
    description: 'Test Baseline',
    rules: ['confirm', 'font-mono', 'font-black', 'font-extrabold', 'sub-12px', 'zinc-500', 'adhoc-success'],
    hardRuleDirectories: ['src'],
    flaggedConfirm: {
      'src/components/workout/EditSetModal.tsx': {
        count: 1,
        reason: 'Legacy confirm at base',
      },
    },
    totals: {
      confirm: 1,
      'font-mono': 4,
      'font-black': 2,
      'font-extrabold': 0,
      'sub-12px': 5,
      'zinc-500': 0,
      'adhoc-success': 0,
    },
    files: {
      'src/components/workout/EditSetModal.tsx': {
        confirm: 1,
        'font-mono': 2,
        'font-black': 1,
        'font-extrabold': 0,
        'sub-12px': 2,
        'zinc-500': 0,
        'adhoc-success': 0,
      },
      'src/components/history/HistoryView.tsx': {
        confirm: 0,
        'font-mono': 2,
        'font-black': 1,
        'font-extrabold': 0,
        'sub-12px': 3,
        'zinc-500': 0,
        'adhoc-success': 0,
      },
    },
  };

  describe('1. Increase Fails', () => {
    it('fails when an existing file increases count for font-mono', () => {
      const current = {
        'src/components/history/HistoryView.tsx': {
          confirm: 0,
          'font-mono': 3, // Increased from 2 to 3
          'font-black': 1,
          'sub-12px': 3,
        },
        'src/components/workout/EditSetModal.tsx': {
          confirm: 1,
          'font-mono': 2,
          'font-black': 1,
          'sub-12px': 2,
        },
      };

      const result = compareWithBaseline(current, mockBaseline);
      expect(result.ok).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]).toMatchObject({
        file: 'src/components/history/HistoryView.tsx',
        rule: 'font-mono',
        old: 2,
        new: 3,
        delta: 1,
        isNewFile: false,
      });
    });

    it('fails when an existing file increases count for font-black', () => {
      const current = {
        'src/components/history/HistoryView.tsx': {
          confirm: 0,
          'font-mono': 2,
          'font-black': 3, // Increased from 1 to 3
          'sub-12px': 3,
        },
      };

      const result = compareWithBaseline(current, mockBaseline);
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.rule === 'font-black' && v.delta === 2)).toBe(true);
    });

    it('fails when an existing file increases count for sub-12px', () => {
      const current = {
        'src/components/history/HistoryView.tsx': {
          confirm: 0,
          'font-mono': 2,
          'font-black': 1,
          'sub-12px': 5, // Increased from 3 to 5
        },
      };

      const result = compareWithBaseline(current, mockBaseline);
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.rule === 'sub-12px' && v.delta === 2)).toBe(true);
    });

    it('fails when an existing file increases count for zinc-500', () => {
      const current = {
        'src/components/history/HistoryView.tsx': {
          confirm: 0,
          'font-mono': 2,
          'font-black': 1,
          'sub-12px': 3,
          'zinc-500': 2, // Increased from 0 to 2
        },
      };

      const result = compareWithBaseline(current, mockBaseline);
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.rule === 'zinc-500' && v.delta === 2)).toBe(true);
    });

    it('fails when an existing file increases count for font-extrabold', () => {
      const current = {
        'src/components/history/HistoryView.tsx': {
          confirm: 0,
          'font-mono': 2,
          'font-black': 1,
          'font-extrabold': 2, // Increased from 0 to 2
          'sub-12px': 3,
          'zinc-500': 0,
        },
      };

      const result = compareWithBaseline(current, mockBaseline);
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.rule === 'font-extrabold' && v.delta === 2)).toBe(true);
    });
  });

  describe('2. Decrease Passes', () => {
    it('passes and records improvement when an existing file decreases violations', () => {
      const current = {
        'src/components/workout/EditSetModal.tsx': {
          confirm: 0, // Decreased from 1 to 0!
          'font-mono': 1, // Decreased from 2 to 1
          'font-black': 0, // Decreased from 1 to 0
          'sub-12px': 1, // Decreased from 2 to 1
        },
        'src/components/history/HistoryView.tsx': {
          confirm: 0,
          'font-mono': 2,
          'font-black': 1,
          'sub-12px': 3,
        },
      };

      const result = compareWithBaseline(current, mockBaseline);
      expect(result.ok).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.hardRuleViolations).toHaveLength(0);
      expect(result.decreases.length).toBeGreaterThanOrEqual(4);

      const confirmDec = result.decreases.find(
        (d) => d.file === 'src/components/workout/EditSetModal.tsx' && d.rule === 'confirm'
      );
      expect(confirmDec).toMatchObject({
        old: 1,
        new: 0,
        delta: 1,
      });
    });

    it('passes when counts are identical to baseline', () => {
      const current = {
        'src/components/workout/EditSetModal.tsx': {
          confirm: 1,
          'font-mono': 2,
          'font-black': 1,
          'sub-12px': 2,
        },
        'src/components/history/HistoryView.tsx': {
          confirm: 0,
          'font-mono': 2,
          'font-black': 1,
          'sub-12px': 3,
        },
      };

      const result = compareWithBaseline(current, mockBaseline);
      expect(result.ok).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.decreases).toHaveLength(0);
      expect(result.hardRuleViolations).toHaveLength(0);
    });
  });

  describe('3. New File With Violation Fails', () => {
    it('fails when a new unrecorded file introduces a non-zero count for zinc-500', () => {
      const current = {
        ...mockBaseline.files,
        'src/components/nutrition/ZincViolator.tsx': {
          confirm: 0,
          'font-mono': 0,
          'font-black': 0,
          'sub-12px': 0,
          'zinc-500': 1, // New violation with text-zinc-500
        },
      };

      const result = compareWithBaseline(current, mockBaseline);
      expect(result.ok).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]).toMatchObject({
        file: 'src/components/nutrition/ZincViolator.tsx',
        rule: 'zinc-500',
        old: 0,
        new: 1,
        delta: 1,
        isNewFile: true,
      });
    });

    it('fails when a new unrecorded file introduces a non-zero count for font-mono', () => {
      const current = {
        ...mockBaseline.files,
        'src/components/nutrition/NewFeatureCard.tsx': {
          confirm: 0,
          'font-mono': 1,
          'font-black': 0,
          'sub-12px': 0,
          'zinc-500': 0,
        },
      };

      const result = compareWithBaseline(current, mockBaseline);
      expect(result.ok).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]).toMatchObject({
        file: 'src/components/nutrition/NewFeatureCard.tsx',
        rule: 'font-mono',
        old: 0,
        new: 1,
        delta: 1,
        isNewFile: true,
      });
    });

    it('passes when a new file has zero violations', () => {
      const current = {
        ...mockBaseline.files,
        'src/components/nutrition/CleanComponent.tsx': {
          confirm: 0,
          'font-mono': 0,
          'font-black': 0,
          'sub-12px': 0,
        },
      };

      const result = compareWithBaseline(current, mockBaseline);
      expect(result.ok).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });

  describe('4. Hard-Rule Directory Fails', () => {
    it('fails when an unflagged file in src/components/workout contains confirm()', () => {
      const current = {
        ...mockBaseline.files,
        'src/components/workout/NewWorkoutComponent.tsx': {
          confirm: 1,
          'font-mono': 0,
          'font-black': 0,
          'sub-12px': 0,
        },
      };

      const result = compareWithBaseline(current, mockBaseline);
      expect(result.ok).toBe(false);
      expect(result.hardRuleViolations).toHaveLength(1);
      expect(result.hardRuleViolations[0].file).toBe('src/components/workout/NewWorkoutComponent.tsx');
      expect(result.hardRuleViolations[0].count).toBe(1);
      expect(result.hardRuleViolations[0].allowed).toBe(0);
    });

    it('fails when an unflagged file in src/components/sets contains confirm()', () => {
      const current = {
        ...mockBaseline.files,
        'src/components/sets/EditSetSheet.tsx': {
          confirm: 1,
          'font-mono': 0,
          'font-black': 0,
          'sub-12px': 0,
        },
      };

      const result = compareWithBaseline(current, mockBaseline);
      expect(result.ok).toBe(false);
      expect(result.hardRuleViolations.some((h) => h.file === 'src/components/sets/EditSetSheet.tsx')).toBe(true);
    });

    it('fails when an unflagged file in src/components/common contains confirm()', () => {
      const current = {
        ...mockBaseline.files,
        'src/components/common/ConfirmDialog.tsx': {
          confirm: 1,
          'font-mono': 0,
          'font-black': 0,
          'sub-12px': 0,
        },
      };

      const result = compareWithBaseline(current, mockBaseline);
      expect(result.ok).toBe(false);
      expect(result.hardRuleViolations.some((h) => h.file === 'src/components/common/ConfirmDialog.tsx')).toBe(true);
    });

    it('fails when an unflagged file in src/components/nutrition contains confirm()', () => {
      const current = {
        ...mockBaseline.files,
        'src/components/nutrition/NutritionEngine.tsx': {
          confirm: 1,
          'font-mono': 0,
          'font-black': 0,
          'sub-12px': 0,
          'zinc-500': 0,
        },
      };

      const result = compareWithBaseline(current, mockBaseline);
      expect(result.ok).toBe(false);
      expect(result.hardRuleViolations.some((h) => h.file === 'src/components/nutrition/NutritionEngine.tsx')).toBe(true);
    });

    it('fails when an unflagged file anywhere in src contains alert()', () => {
      const current = {
        ...mockBaseline.files,
        'src/components/history/HistoryView.tsx': {
          confirm: 1,
          'font-mono': 2,
          'font-black': 1,
          'sub-12px': 3,
          'zinc-500': 0,
        },
      };

      const result = compareWithBaseline(current, mockBaseline);
      expect(result.ok).toBe(false);
      expect(result.hardRuleViolations.some((h) => h.file === 'src/components/history/HistoryView.tsx')).toBe(true);
    });

    it('fails when a flagged file increases confirm calls above its allowed baseline count', () => {
      const current = {
        ...mockBaseline.files,
        'src/components/workout/EditSetModal.tsx': {
          confirm: 2, // Allowed is 1, now 2!
          'font-mono': 2,
          'font-black': 1,
          'sub-12px': 2,
        },
      };

      const result = compareWithBaseline(current, mockBaseline);
      expect(result.ok).toBe(false);
      expect(result.hardRuleViolations.some((h) => h.file === 'src/components/workout/EditSetModal.tsx')).toBe(true);
    });

    it('passes when a flagged file matches its allowed flagged confirm count', () => {
      const current = {
        'src/components/workout/EditSetModal.tsx': {
          confirm: 1, // Matches allowed 1
          'font-mono': 2,
          'font-black': 1,
          'sub-12px': 2,
        },
      };

      const result = compareWithBaseline(current, mockBaseline);
      expect(result.hardRuleViolations).toHaveLength(0);
      expect(result.flaggedActive.some((f) => f.file === 'src/components/workout/EditSetModal.tsx')).toBe(true);
    });

    it('correctly classifies hard rule directories across all of src', () => {
      expect(isHardRuleDir('src/components/workout/WorkoutEngine.tsx')).toBe(true);
      expect(isHardRuleDir('src/components/sets/EditSetSheet.tsx')).toBe(true);
      expect(isHardRuleDir('src/components/common/Header.tsx')).toBe(true);
      expect(isHardRuleDir('src/components/nutrition/NutritionEngine.tsx')).toBe(true);
      expect(isHardRuleDir('src/components/history/HistoryView.tsx')).toBe(true);
      expect(isHardRuleDir('src/App.tsx')).toBe(true);
      expect(isHardRuleDir('scripts/check-design-ratchet.js')).toBe(false);
    });
  });

  describe('5. Baseline Update Behavior', () => {
    it('successfully updates baseline when counts decrease', () => {
      const current = {
        'src/components/history/HistoryView.tsx': {
          confirm: 0,
          'font-mono': 1, // Decreased from 2 to 1
          'font-black': 0, // Decreased from 1 to 0
          'sub-12px': 2, // Decreased from 3 to 2
        },
      };

      const updated = updateBaseline(current, mockBaseline);
      expect(updated.files['src/components/history/HistoryView.tsx']).toEqual({
        confirm: 0,
        'font-mono': 1,
        'font-black': 0,
        'font-extrabold': 0,
        'sub-12px': 2,
        'zinc-500': 0,
        'adhoc-success': 0,
      });
      expect(updated.totals['font-mono']).toBe(1);
    });

    it('rejects baseline update when counts increase unless allowIncrease is set', () => {
      const current = {
        'src/components/history/HistoryView.tsx': {
          confirm: 0,
          'font-mono': 5, // Increased from 2 to 5
          'font-black': 1,
          'sub-12px': 3,
        },
      };

      expect(() => updateBaseline(current, mockBaseline)).toThrow(/forbidden by policy/i);

      // With allowIncrease (policy forbidden, but supported by flag for explicit override)
      const forcedUpdate = updateBaseline(current, mockBaseline, { allowIncrease: true });
      expect(forcedUpdate.files['src/components/history/HistoryView.tsx']['font-mono']).toBe(5);
    });

    it('removes resolved entries from flaggedConfirm when confirm drops to 0', () => {
      const current = {
        'src/components/workout/EditSetModal.tsx': {
          confirm: 0, // Resolved!
          'font-mono': 2,
          'font-black': 1,
          'sub-12px': 2,
        },
      };

      const updated = updateBaseline(current, mockBaseline);
      expect(updated.flaggedConfirm['src/components/workout/EditSetModal.tsx']).toBeUndefined();
    });
  });

  describe('6. Parser & Scanner Accuracy', () => {
    it('detects window.confirm(, bare confirm(, window.alert(, and bare alert(', () => {
      const code = `
        function removeSet() {
          if (window.confirm("Delete?")) { doDelete(); }
          if (confirm("Sure?")) { doSure(); }
          window.alert("Alert 1");
          alert("Alert 2");
          const confirmPassword = "123";
          if (confirmPassword === "123") {}
          dialog.confirm("Custom method");
          dialog.alert("Custom method");
        }
      `;
      const counts = scanFileContent(code);
      expect(counts.confirm).toBe(4);
    });

    it('detects text-zinc-500 with variant prefixes (placeholder:, disabled:, etc.)', () => {
      const code = `
        <span className="text-zinc-500">Muted text</span>
        <input className="placeholder:text-zinc-500 disabled:text-zinc-500 sm:text-zinc-500" />
        <div className="not-text-zinc-500 text-zinc-400">Valid</div>
      `;
      const counts = scanFileContent(code);
      expect(counts['zinc-500']).toBe(4);
    });

    it('detects font-mono and variant-prefixed font-mono', () => {
      const code = `
        <span className="text-xs font-mono">123</span>
        <div className="sm:font-mono not-font-mono text-white">456</div>
      `;
      const counts = scanFileContent(code);
      // "font-mono" and "sm:font-mono" match; "not-font-mono" does not
      expect(counts['font-mono']).toBe(2);
    });

    it('detects font-black and variant-prefixed font-black', () => {
      const code = `
        <h1 className="text-xl font-black">Title</h1>
        <h2 className="md:font-black not-font-black">Sub</h2>
      `;
      const counts = scanFileContent(code);
      expect(counts['font-black']).toBe(2);
    });

    it('detects font-extrabold and variant-prefixed font-extrabold', () => {
      const code = `
        <h1 className="text-xl font-extrabold">Title</h1>
        <h2 className="md:font-extrabold not-font-extrabold">Sub</h2>
      `;
      const counts = scanFileContent(code);
      expect(counts['font-extrabold']).toBe(2);
    });

    it('fails when a fixture with font-extrabold is compared against baseline 0', () => {
      const fixtureCode = '<span className="font-extrabold">Header</span>';
      const counts = scanFileContent(fixtureCode);
      expect(counts['font-extrabold']).toBe(1);
      const current = {
        'src/components/fixture.tsx': counts,
      };
      const result = compareWithBaseline(current, mockBaseline);
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.rule === 'font-extrabold')).toBe(true);
    });

    it('detects sub-12px arbitrary classes, named tokens, and inline fontSize', () => {
      const code = `
        <div className="text-[10px] sm:text-[11px] text-[9px] text-[0.65rem] text-[0.7rem]/4 text-2xs text-3xs">
          <span style={{ fontSize: 10 }}>Small</span>
          <span style={{ fontSize: '11px', color: 'red' }}>Small px</span>
          <span style={{ fontSize: '0.6875rem' }}>Small rem</span>
          <span style={{ font-size: '8pt' }}>Small pt</span>
          {/* Compliant sizes below: should NOT be counted */}
          <span className="text-xs text-[12px] text-[14px] text-[16px] text-[0.75rem] text-[1rem]">Normal</span>
          <span style={{ fontSize: 12 }}>Twelve</span>
          <span style={{ fontSize: 14 }}>Fourteen</span>
          <span style={{ fontSize: '1rem' }}>One rem</span>
          <span className="text-[#ff0000] text-[rgb(0,0,0)]">Color only</span>
        </div>
      `;
      const counts = scanFileContent(code);
      // text-[10px] (1) + sm:text-[11px] (1) + text-[9px] (1) + text-[0.65rem] (1) + text-[0.7rem]/4 (1)
      // + text-2xs (1) + text-3xs (1) + fontSize: 10 (1) + fontSize: '11px' (1)
      // + fontSize: '0.6875rem' (1) + font-size: '8pt' (1) = 11
      expect(counts['sub-12px']).toBe(11);
    });

    it('accurately parses length units via isSub12pxLength', () => {
      expect(isSub12pxLength('10px')).toBe(true);
      expect(isSub12pxLength('11.5px')).toBe(true);
      expect(isSub12pxLength('12px')).toBe(false);
      expect(isSub12pxLength('14px')).toBe(false);

      expect(isSub12pxLength('0.6rem')).toBe(true);
      expect(isSub12pxLength('0.7rem')).toBe(true);
      expect(isSub12pxLength('0.74rem')).toBe(true);
      expect(isSub12pxLength('0.75rem')).toBe(false); // 12px
      expect(isSub12pxLength('1rem')).toBe(false);

      expect(isSub12pxLength('8pt')).toBe(true);
      expect(isSub12pxLength('9pt')).toBe(false);

      expect(isSub12pxLength('10')).toBe(true);
      expect(isSub12pxLength('12')).toBe(false);

      expect(isSub12pxLength('red')).toBe(false);
      expect(isSub12pxLength('#ffffff')).toBe(false);
    });

    it('accurately strips comments with stripComments', () => {
      const code = "const a = 1; // line comment\n/* block */ const b = 2;";
      const stripped = stripComments(code);
      expect(stripped).not.toContain("line comment");
      expect(stripped).not.toContain("block");
      expect(stripped).toContain("const a = 1;");
      expect(stripped).toContain("const b = 2;");
    });

    it('ignores violations inside comments', () => {
      const code = `
        // window.confirm("In line comment");
        // className="font-mono font-black text-[10px] text-zinc-500"
        /*
          confirm("In block comment");
          font-mono
          font-black
          text-[11px]
          text-zinc-500
          alert("Comment alert");
        */
        const x = 1;
      `;
      const counts = scanFileContent(code);
      expect(counts.confirm).toBe(0);
      expect(counts['font-mono']).toBe(0);
      expect(counts['font-black']).toBe(0);
      expect(counts['sub-12px']).toBe(0);
    });
  });

  describe('7. Baseline File Existence and Integrity', () => {
    it('baseline path is defined and exists', () => {
      expect(defaultBaselinePath).toBeDefined();
    });
  });

  describe('8. adhoc-success Rule (STD-FB-1)', () => {
    it('detects StatusBanner with tone="success"', () => {
      const code = '<StatusBanner tone="success" message="Done" />';
      const counts = scanFileContent(code);
      expect(counts['adhoc-success']).toBe(1);
    });

    it('detects StatusBanner with dynamic tone returning success', () => {
      const code = '<StatusBanner tone={isOk ? "success" : "error"} message="Done" />';
      const counts = scanFileContent(code);
      expect(counts['adhoc-success']).toBe(1);
    });

    it('detects StatusBanner with tone="info" carrying legacy success copy', () => {
      const code = '<StatusBanner tone="info" message="Saved" />';
      const counts = scanFileContent(code);
      expect(counts['adhoc-success']).toBe(1);
    });

    it('detects legacy setStatus calls with success messages', () => {
      const code = "setStatus('Saved');";
      const counts = scanFileContent(code);
      expect(counts['adhoc-success']).toBe(1);
    });

    it('detects inline Copied! in JSX', () => {
      const code = '<button><span>Copied!</span></button>';
      const counts = scanFileContent(code);
      expect(counts['adhoc-success']).toBe(1);
    });

    it('fails when a fixture with adhoc-success is compared against baseline 0', () => {
      const fixtureCode = '<StatusBanner tone="success" message="Done" />';
      const counts = scanFileContent(fixtureCode);
      expect(counts['adhoc-success']).toBe(1);
      const current = {
        'src/components/fixture.tsx': counts,
      };
      const result = compareWithBaseline(current, mockBaseline);
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.rule === 'adhoc-success')).toBe(true);
    });

    it('detects direct <UndoToast outside ToastHost', () => {
      const code = '<UndoToast toast={toastItem} onDismiss={() => {}} />';
      const counts = scanFileContent(code, 'src/components/workout/WorkoutDialogs.tsx');
      expect(counts['adhoc-success']).toBe(1);
    });

    it('exempts standard toast infrastructure files', () => {
      const code = '<StatusBanner tone="success" message="Saved" /><UndoToast toast={null} onDismiss={() => {}} />';
      const countsUndo = scanFileContent(code, 'src/components/common/UndoToast.tsx');
      expect(countsUndo['adhoc-success']).toBe(0);

      const countsHost = scanFileContent(code, 'src/components/common/ToastHost.tsx');
      expect(countsHost['adhoc-success']).toBe(0);

      const countsContext = scanFileContent(code, 'src/context/ToastContext.tsx');
      expect(countsContext['adhoc-success']).toBe(0);
    });
  });
});
