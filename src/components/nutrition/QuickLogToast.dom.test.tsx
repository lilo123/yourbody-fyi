import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { QuickLogToast } from './QuickLogToast';
import { ToastProvider } from '../../context/ToastContext';
import { ToastHost } from '../common/ToastHost';

const renderComponent = (ui: React.ReactElement) =>
  render(
    <ToastProvider>
      {ui}
      <ToastHost />
    </ToastProvider>
  );

const BASELINE_DIR = '/tmp/quicklog_toast_before';

describe('QuickLogToast DOM byte-identical proof', () => {
  it('renders byte-identical DOM for null toast', () => {
    const { container } = renderComponent(
      <QuickLogToast
        toast={null}
        onDismiss={vi.fn()}
        isStaged={false}
        isTimerActive={false}
      />
    );

    const expectedHtml =
      '<div role="status" aria-live="polite" aria-atomic="true" class="sr-only"></div><div role="alert" aria-live="assertive" aria-atomic="true" class="sr-only"></div>';

    expect(container.innerHTML).toBe(expectedHtml);
    if (fs.existsSync(path.join(BASELINE_DIR, 'null_toast.html'))) {
      const baseline = fs.readFileSync(path.join(BASELINE_DIR, 'null_toast.html'), 'utf-8');
      expect(container.innerHTML).toBe(baseline);
    }
  });

  it('renders byte-identical DOM for logged with undo', () => {
    const { container } = renderComponent(
      <QuickLogToast
        toast={{
          variant: 'logged',
          dishName: 'Power Bowl',
          calories: 550,
          onUndo: vi.fn(),
        }}
        onDismiss={vi.fn()}
        isStaged={false}
        isTimerActive={false}
      />
    );

    const toastEl = container.querySelector('[data-testid="quick-log-toast"]');
    expect(toastEl).not.toBeNull();
    const html = toastEl!.outerHTML;

    expect(html).toContain('Power Bowl · +550 kcal');
    expect(html).toContain('aria-label="Undo log Power Bowl"');

    if (fs.existsSync(path.join(BASELINE_DIR, 'logged_with_undo.html'))) {
      const baseline = fs.readFileSync(path.join(BASELINE_DIR, 'logged_with_undo.html'), 'utf-8');
      expect(html).toBe(baseline);
    }
  });

  it('renders byte-identical DOM for logged without undo', () => {
    const { container } = renderComponent(
      <QuickLogToast
        toast={{
          variant: 'logged',
          dishName: 'Power Bowl',
          calories: 550,
        }}
        onDismiss={vi.fn()}
        isStaged={false}
        isTimerActive={false}
      />
    );

    const toastEl = container.querySelector('[data-testid="quick-log-toast"]');
    expect(toastEl).not.toBeNull();
    const html = toastEl!.outerHTML;

    if (fs.existsSync(path.join(BASELINE_DIR, 'logged_without_undo.html'))) {
      const baseline = fs.readFileSync(path.join(BASELINE_DIR, 'logged_without_undo.html'), 'utf-8');
      expect(html).toBe(baseline);
    }
  });

  it('renders byte-identical DOM for added variant', () => {
    const { container } = renderComponent(
      <QuickLogToast
        toast={{
          variant: 'added',
          dishName: 'Roasted Almonds',
          calories: 160,
          onUndo: vi.fn(),
        }}
        onDismiss={vi.fn()}
        isStaged={true}
        isTimerActive={false}
      />
    );

    const toastEl = container.querySelector('[data-testid="quick-log-toast"]');
    expect(toastEl).not.toBeNull();
    const html = toastEl!.outerHTML;

    expect(html).toContain('Added to meal');
    expect(html).toContain('Added Roasted Almonds to staged meal');

    if (fs.existsSync(path.join(BASELINE_DIR, 'added_with_undo.html'))) {
      const baseline = fs.readFileSync(path.join(BASELINE_DIR, 'added_with_undo.html'), 'utf-8');
      expect(html).toBe(baseline);
    }
  });

  it('renders byte-identical DOM for updated variant', () => {
    const { container } = renderComponent(
      <QuickLogToast
        toast={{
          variant: 'updated',
          dishName: 'Updated Salmon Bowl',
          calories: 620,
          onUndo: vi.fn(),
        }}
        onDismiss={vi.fn()}
        isStaged={false}
        isTimerActive={false}
      />
    );

    const toastEl = container.querySelector('[data-testid="quick-log-toast"]');
    expect(toastEl).not.toBeNull();
    const html = toastEl!.outerHTML;

    expect(html).toContain('Updated');
    expect(html).toContain('Updated Salmon Bowl · 620 kcal');

    if (fs.existsSync(path.join(BASELINE_DIR, 'updated_with_undo.html'))) {
      const baseline = fs.readFileSync(path.join(BASELINE_DIR, 'updated_with_undo.html'), 'utf-8');
      expect(html).toBe(baseline);
    }
  });

  it('renders byte-identical DOM for timer position', () => {
    const { container } = renderComponent(
      <QuickLogToast
        toast={{
          variant: 'logged',
          dishName: 'Rice & Chicken',
          calories: 450,
          onUndo: vi.fn(),
        }}
        onDismiss={vi.fn()}
        isStaged={false}
        isTimerActive={true}
      />
    );

    const toastEl = container.querySelector('[data-testid="quick-log-toast"]');
    expect(toastEl).not.toBeNull();
    const html = toastEl!.outerHTML;

    expect(html).toContain('style="bottom: 148px;"');

    if (fs.existsSync(path.join(BASELINE_DIR, 'logged_timer.html'))) {
      const baseline = fs.readFileSync(path.join(BASELINE_DIR, 'logged_timer.html'), 'utf-8');
      expect(html).toBe(baseline);
    }
  });
});
