import React from 'react';

/**
 * A status/error banner that is actually announced by screen readers.
 *
 * Why this component exists
 * -------------------------
 * Every status banner in this codebase was written as:
 *
 *     {error && <div role="alert">{error}</div>}
 *
 * That idiom looks correct and is almost universally wrong. A live region has
 * to already exist in the accessibility tree *before* its contents change.
 * When the container and its text are inserted in the same commit, NVDA, JAWS
 * and VoiceOver frequently treat the node as freshly mounted rather than
 * mutated, and say nothing at all. The banner appears on screen and a
 * screen-reader user is never told.
 *
 * So the two live regions below are mounted unconditionally and are empty
 * while idle. Only their text content changes, which is exactly the mutation
 * assistive technology listens for.
 *
 * Why there are two regions rather than one with a dynamic role
 * -------------------------------------------------------------
 * Many of these call sites render success *or* failure from a single piece of
 * state, so the obvious move is one container whose `role` flips between
 * `status` and `alert`. Assistive technology reads live-region properties when
 * the region is registered, so flipping `role` on an existing node is not
 * reliably picked up. Two regions with fixed, honest roles avoid the problem
 * entirely; at most one ever holds text.
 *
 * The visible banner is rendered separately and is deliberately *not* a live
 * region. It carries the same words, so a user browsing the page still finds
 * them, but it cannot double-announce.
 *
 * Reference implementations already in the repo: `MealLogRow.tsx` (role="alert"
 * on a rolled-back optimistic write) and `NutritionEngine.tsx` (the quick-log
 * toast). Both chose the right role; both are conditionally mounted.
 *
 * @see WCAG 2.2 SC 4.1.3 Status Messages (Level AA)
 */

export type StatusTone = 'success' | 'error' | 'info';

export interface StatusBannerProps {
  /**
   * Optional bold headline rendered above `message`.
   *
   * Several call sites are two-tier: a short headline that names what broke
   * ("Failed to load history data") over a subdued line carrying the
   * underlying error text. Collapsing those into one string loses the visual
   * hierarchy that makes the banner scannable, so the two tiers stay separate
   * in the markup. The live region still announces them as a single sentence,
   * `"{title}: {message}"`, because assistive technology reads the region's
   * text content in one go and two sentences would be read as one anyway.
   */
  title?: string | null;
  /** The message to show and announce. `null`/`''` renders nothing visible and announces nothing. */
  message?: string | null;
  /** Drives both the colour and which live region is used. Errors are assertive; everything else is polite. */
  tone?: StatusTone;
  /** Optional leading icon. Decorative — callers should pass `aria-hidden="true"`. */
  icon?: React.ReactNode;
  /** Optional trailing control, e.g. a Retry or Dismiss button. */
  action?: React.ReactNode;
  /** Applied to the *visible* banner only, never to the live regions. */
  className?: string;
  /** Applied to the *visible* banner, so existing test selectors keep working. */
  testId?: string;
  /** Inline styles applied to the visible banner container. */
  style?: React.CSSProperties;
  /**
   * Optional custom body for special surfaces like the D41 quick-log toast.
   * When provided, replaces the default heading/detail layout inside the visible container.
   */
  children?: React.ReactNode;
  /**
   * When true, disables the default layout classes so custom layout can be provided in `className`.
   */
  rawLayout?: boolean;
}

const TONE_STYLES: Record<StatusTone, string> = {
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  error: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  info: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
};

export const StatusBanner: React.FC<StatusBannerProps> = ({
  title,
  message,
  tone = 'info',
  icon,
  action,
  className = '',
  testId,
  style,
  children,
  rawLayout = false,
}) => {
  const heading = title ?? '';
  const detail = message ?? '';
  const isError = tone === 'error';
  const hasContent = Boolean(heading || detail || children);

  // The two tiers are separate elements on screen but one utterance to a
  // screen reader, which reads the region's whole text content in one pass.
  const announcement = heading && detail ? `${heading}: ${detail}` : heading || detail;

  // Both regions are always mounted and empty when idle. Do not make either of
  // these conditional — that is the bug this component exists to prevent.
  const politeText = !isError ? announcement : '';
  const assertiveText = isError ? announcement : '';

  // Two-tier banners carry more text, so they get the roomier box the call
  // sites used before they were migrated, including stacking the action below
  // the message under 640px. A Retry button held on the same row as a headline
  // plus an error string crushes the text at 320px.
  const layout = heading
    ? 'flex flex-col gap-3 rounded-2xl border p-4 text-xs font-bold sm:flex-row sm:items-center sm:justify-between'
    : 'flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold';

  return (
    <>
      {/*
        oxlint's `prefer-tag-over-role` suggests `<output>` here, since it
        carries an implicit `role="status"`. Deliberately not taking it:
        `<output>` means "the result of a calculation", it is a
        form-associated element that participates in a containing `<form>`,
        and it is `display: inline` by default. These banners say things like
        "Failed to load nutrition data" from 25 sites, most of them nowhere
        near a form. A plain div with an explicit role is the honest markup.
      */}
      {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {politeText}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true" className="sr-only">
        {assertiveText}
      </div>

      {hasContent ? (
        <div data-testid={testId} style={style} className={rawLayout ? `${TONE_STYLES[tone]} ${className}` : `${layout} ${TONE_STYLES[tone]} ${className}`}>
          {children ? (
            <>
              {children}
              {action}
            </>
          ) : heading ? (
            <div className="flex min-w-0 items-center gap-2.5">
              {icon}
              <div className="min-w-0">
                <div className="text-sm font-bold text-white">{heading}</div>
                {detail ? (
                  <div className="text-xs font-normal break-words opacity-90">{detail}</div>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              {icon}
              <span className="min-w-0 flex-1 break-words">{detail}</span>
            </>
          )}
          {!children && action}
        </div>
      ) : null}
    </>
  );
};
