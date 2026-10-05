import axe, { type AxeResults, type RunOptions, type Result } from 'axe-core';
import { expect } from 'vitest';

/**
 * Rules that cannot produce trustworthy results under jsdom and are therefore
 * disabled here. Disabling them is deliberate: a rule that silently always
 * passes is worse than one that is explicitly out of scope.
 *
 * - color-contrast / link-in-text-block: jsdom performs no layout or painting,
 *   so computed colours and geometry are unavailable. Contrast is covered by
 *   the Playwright + axe pass instead (Phase 0.5).
 * - region: asserts that all content sits inside a landmark. Meaningless when
 *   mounting a single component in isolation.
 */
const JSDOM_UNRELIABLE_RULES = [
  'color-contrast',
  'link-in-text-block',
  'region',
] as const;

function formatViolations(violations: Result[]): string {
  return violations
    .map((v) => {
      const targets = v.nodes
        .map((n) => `      - ${n.target.join(' ')}\n        ${n.failureSummary?.split('\n').join('\n        ')}`)
        .join('\n');
      return `  [${v.impact ?? 'unknown'}] ${v.id}: ${v.help}\n    ${v.helpUrl}\n${targets}`;
    })
    .join('\n\n');
}

/**
 * Run axe-core against a mounted container and fail with a readable report.
 *
 * Usage:
 *   const { container } = render(<EditSetModal {...props} />);
 *   await expectNoA11yViolations(container);
 */
export async function expectNoA11yViolations(
  container: HTMLElement,
  options: RunOptions = {}
): Promise<AxeResults> {
  const rules: RunOptions['rules'] = { ...(options.rules ?? {}) };
  for (const id of JSDOM_UNRELIABLE_RULES) {
    if (!(id in rules)) rules[id] = { enabled: false };
  }

  const results = await axe.run(container, { ...options, rules });

  if (results.violations.length > 0) {
    throw new Error(
      `Expected no accessibility violations, found ${results.violations.length}:\n\n` +
        formatViolations(results.violations)
    );
  }

  // Guard against a silently empty run (e.g. an unmounted or empty container),
  // which would otherwise look like a pass.
  expect(
    results.passes.length + results.incomplete.length + results.inapplicable.length
  ).toBeGreaterThan(0);

  return results;
}

/**
 * Assert only a specific set of rules. Use when a component is known to have
 * unrelated debt but a particular criterion must hold.
 */
export async function expectNoA11yViolationsForRules(
  container: HTMLElement,
  ruleIds: string[]
): Promise<AxeResults> {
  return expectNoA11yViolations(container, {
    runOnly: { type: 'rule', values: ruleIds },
  });
}
