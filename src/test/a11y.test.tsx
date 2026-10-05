import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Eye } from 'lucide-react';
import { expectNoA11yViolations } from './a11y';

/**
 * Meta-tests for the a11y harness itself.
 *
 * A gate that cannot fail is not a gate. These assert that
 * `expectNoA11yViolations` actually detects a real violation before it is
 * relied upon to certify real components.
 */
describe('a11y harness', () => {
  it('detects an icon-only button with no accessible name', async () => {
    // This is the exact shape of the defect at LoginView.tsx:L212,
    // ResetPasswordView.tsx:L85 and LoginView.tsx:L238 (VER-13(a)).
    // lucide-react injects aria-hidden="true" on a childless icon, so the
    // button exposes an empty accessible name.
    const { container } = render(
      <button type="button" onClick={() => {}}>
        <Eye className="w-4 h-4" />
      </button>
    );

    await expect(expectNoA11yViolations(container)).rejects.toThrow(
      /button-name/
    );
  });

  it('passes the same button once an aria-label is supplied', async () => {
    const { container } = render(
      <button type="button" aria-label="Show password" onClick={() => {}}>
        <Eye className="w-4 h-4" />
      </button>
    );

    await expectNoA11yViolations(container);
  });

  it('detects a control with role=switch and no accessible name', async () => {
    // Shape of NEW-25 at SettingsView.tsx:L202.
    //
    // This markup is *deliberately* broken -- it is the negative fixture that
    // proves the axe gate can actually fail. Without the disable below it is
    // the only `control-has-associated-label` hit left in the repo, which
    // makes `npm run lint` read as though a real defect survived. It did not;
    // NEW-25 is fixed. Do not "fix" this fixture.
    // oxlint-disable-next-line jsx-a11y/control-has-associated-label
    const { container } = render(
      // oxlint-disable-next-line jsx-a11y/control-has-associated-label
      <button type="button" role="switch" aria-checked={false}>
        <span aria-hidden="true" />
      </button>
    );

    await expect(expectNoA11yViolations(container)).rejects.toThrow();
  });

  it('confirms lucide-react marks a childless icon aria-hidden', async () => {
    // Receipt for the claim underpinning VER-13(a). If lucide ever changes
    // this default, the premise of the fix changes and this test should fail.
    const { container } = render(<Eye className="w-4 h-4" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });
});
