# Design & UX Standards (derived from the Nutrition tab)

> Status: **adopted 2026-09-26** as the reference for the app-wide design.
> Evidence: Nutrition design audit, code at `da67a71`, the density guards in `tests/visual-density.test.ts`, and the three tab audits (Workout, Library, History).
> Each standard has an ID (`STD-…`), the rule, where it shows up in Nutrition, and how it applies to the other tabs. "Other tabs" means Workout (`src/components/workout`), Library (`src/components/exercises`), History (`src/components/history`), Coach, Settings and the shell.

## 0. How to use this document
- Every redesign phase cites the STD IDs it applies. Each rule is enforced by a test where possible; the enforcing guard is named under each rule.
- A tab may deviate only through a dated entry in the REDESIGN_STATUS decision log.
- Where Nutrition itself breaks a standard today, that is listed under **Nutrition gap** and fixed in Phase 8 (the Nutrition sweep).

### Standards Index
- **§2 Layout, spacing and navigation:** `STD-LAY-1..5`, `STD-NAV-1..4`
- **§3 Components:** `STD-CMP-1..11`
- **§4 Typography, colour and icons:** `STD-TYP-1..4`, `STD-COL-1..4`, `STD-ICO-1`
- **§5 Interactions:** `STD-INT-1..9`
- **§6 Data display:** `STD-DAT-1..9`
- **§7 Copy and tone:** `STD-CPY-1..6`
- **§8 Feedback:** `STD-FB-1`
- **§9 Accessibility (cross-cutting):** `STD-A11Y-1..4`
- **§10 Nutrition-specific: do NOT copy elsewhere**
- **§11 Guards that enforce these standards**

---

## 1. Takeaways from the Nutrition redesign

### 1.1 What worked
| Takeaway | Evidence |
|---|---|
| **Measure, don't eyeball.** Every layout rule became a Playwright density guard with raw px at 320/390 (and ≥640). Regressions were caught before users saw them. | `tests/visual-density.test.ts` (65 blocks incl. the D43 type walker); D19, D24, D28, D37 |
| **Density comes from removing things, not shrinking them.** The 4-item staged card went from 936px to ~466px by dropping portion chips, the formula box and zero rows. Text stayed at the 12px floor. | D1–D4, D12, acceptance "≤ ~470px" |
| **Edit in place for the thing you're building; edit in a sheet for the thing you already saved.** The staged card replaces the AI box inline (D10). A logged meal is edited in a sheet with an explicit Save (D44). | D10, D22, D44 |
| **Instant action + Undo beats confirmation dialogs** for single, reversible actions (log, add, update). | D41, D42, D44 |
| **One floating toast slot** that knows about the nav, the rest-timer pill and sticky action rows avoided layout shift and double announcements. | D41 (`QuickLogToast.tsx`) |
| **A small, strict type scale** (12/14/16, weights 400/600/700) made hierarchy readable and testable. | D18, D43 |
| **Race guards on async work** (latest-ref, identity-bound Undo, synchronous double-tap guard) stopped stale results from overwriting newer edits. | Async concurrency audit |
| **Byte-identical DOM proofs** when adding a mode to a shared component (stage vs edit) kept the existing flow safe. | Component mode audit |
| **Plans were changed when the user pushed back.** 40px vs 44px, label lengths and toast placement were all decided against real screenshots, not in the abstract. | D25, D34, D41 |

### 1.2 What we tried and dropped (and why)
| Dropped | Why | Decision |
|---|---|---|
| Portion chips, formula box, per-row zero macros | Doubled card height; the information was redundant | D1–D4 |
| Free-form totals on multi-item meals | The DB requires parent = Σ(items); edits were silently discarded | D5 (+ rejected alt. D) |
| `−`/`+` quantity steppers | Squeezed names to 102px; 50 taps for 50 g | D13 → D17 |
| Staged meal in a bottom sheet | Hid the rings; nested scroll fought the soft keyboard | D10 (D11 rejected) |
| 2-column desktop layout | 95%+ mobile use; one `max-w-xl` column | D11 |
| Inline status banner for "Added to staged meal" | 60px layout shift under the user's thumb | D41 |
| Timeline row autosave + scale bar | Two editing models; accidental, unrecoverable edits; totals desync | D44 |
| Edit-meal modal with serving size | Serving size was saved but never read (1 → 2 servings still 584 kcal) | D44 |
| "Call up the AI box again" to add items | Two textareas; unclear whether it replaces or adds | D45 |
| 10/11px badges, `font-mono` numbers, weights 500/800/900 | Inconsistent, unreadable at 320 | D18, D43 |

### 1.3 Key findings that kept coming back (write tests for them first)
1. Floating or sticky elements covering the sticky action row, the nav or the toast. Fix with measured offsets (`effectiveNavHeight`, `scrollMarginBottom`) plus elementFromPoint grids.
2. Sub-12px text sneaking back in. Fix with the D43 walker.
3. Focus lost when a sheet or composer closes. Fix with `useModalA11y` opener restore and an explicit return target.
4. Async results landing after the user moved on. Fix with latest-ref guards.
5. Tests that pass without the fix. Every new test must fail on the base commit.

---

## 2. Layout, spacing and navigation

| ID | Rule | In Nutrition | Other tabs |
|---|---|---|---|
| STD-LAY-1 | **One mobile-first column**, `max-w-xl mx-auto p-4`, designed at **390px**, verified at **320px** and **≥640px**. No 2-column desktop. | `App.tsx:111`; D11 | All tabs already share the container. Workout, Library and History must pass 320/390/≥640 density checks (W32, L21, H34). |
| STD-LAY-2 | **Vertical rhythm:** sections `space-y-6`; inside a card `space-y-2/3`; list rows separated by a 1px `border-zinc-800/80`, not by gaps. | `NutritionEngine.tsx:209`, card internals | Workout exercise cards, History session cards and Library rows adopt the same rhythm (H50 card mismatch). |
| STD-LAY-3 | **Nothing overflows horizontally at 320px.** Long names wrap to ≤2 lines (`line-clamp-2 break-words`, `min-w-0 flex-1`) or truncate with a `title`. Number cells never wrap. | D19, D24, `MacroCell.tsx:64` | W13 (Last chip), W32 (chip + control rows), L21, H21, H34 (date chips). Guard: `scrollWidth ≤ clientWidth` for every non-input element. |
| STD-LAY-4 | **Sticky action rows** sit at `bottom = measured nav height` (0 inside sheets), with `bg-zinc-900 border-t`. Content that opens above them scrolls into view with `scroll-margin-bottom = row height + gap`. Nothing may cover them. | `StagedMealCard.tsx:448`, `AddItemsComposer.tsx:114`; D41, D45 | Workout: the Finish / Log All row and the Add-exercise sheet's "Add N" row (W18, W22). Library: the template builder Save row. History: the H8 sheet actions. |
| STD-LAY-5 | **Safe areas:** header `pt-[max(env(safe-area-inset-top),12px)]`; nav and sheet bottoms `pb-[max(1rem,env(safe-area-inset-bottom))]` / `.safe-area-pb`. | `Header.tsx:25`, `EditMealSheet.tsx:214`, `index.css:118` | Every new sheet (EditSetSheet, ExercisePicker, ExerciseHistorySheet, ConfirmDialog). |
| STD-NAV-1 | **Navigation model:** the bottom nav holds the 5 tabs. Deeper tasks open a **sheet** (full height below 640px, centred `max-w-lg` at ≥640px) with a heading, a close ✕ and a sticky action row. **Inline expansion** is for reading (accordion), never for editing a saved record. | D44 `EditMealSheet`, D10 inline staging, read-only `MealLogRow` panel | Workout: logged set → EditSetSheet (W3, W17); Add exercise → ExercisePicker sheet (W22). History: exercise card → ExerciseHistorySheet (H8); sessions expand read-only. Library: "+ New Exercise" opens a sheet (L19). |
| STD-NAV-2 | **Close and focus:** opening a sheet focuses its heading (no soft keyboard). Closing returns focus to the control that opened it (or the nearest surviving one). Escape/backdrop never discard a **dirty** draft; Cancel always closes. A nested sheet or menu swallows Escape first. | `useModalA11y.ts:61,88`, `EditMealSheet.tsx:209` | H1 (focus lost after edit), L36 (picker body swap), W34 (focus after add/commit). |
| STD-NAV-3 | **One way in for each editor.** A record has exactly one editor, reachable from every tab that shows it. | D44 (History and Today both open EditMealSheet) | EditSetSheet is shared by Workout and History (K2). History "Edit in Workout" deep-links to `/workout?date=` (K8). |
| STD-NAV-4 | **Deep links for cross-tab jumps** use query params on the target route (`/workout?date=YYYY-MM-DD`, `/workout?routine=<id>`); no cross-tab state stores. | (n/a in Nutrition) | K8, L25. |

## 3. Components

| ID | Rule | In Nutrition | Other tabs |
|---|---|---|---|
| STD-CMP-1 | **Shared primitives live in `src/components/common/`**: Button, IconButton, Chip, Tag, Stepper, SegmentedTabs, Card, Sheet (on AccessibleModal), ConfirmDialog, UndoToast, StatusBanner, OverflowMenu, UnitChip, NotesField, Skeleton. No hand-rolled variants in tab folders. | StatusBanner, AccessibleModal, OverflowMenu, MacroRing already shared; QuickLogToast/UnitChip/NotesField to be promoted | W48, L42, H50, H51 (7 radii, 11 button variants today). |
| STD-CMP-2 | **Card:** `rounded-3xl bg-zinc-900/90 border border-zinc-800/80`, padding `p-4` (`p-3` below 360px). The "active/staged" variant adds a cyan border and glow. **One radius per role:** card 24px, control 12px (`rounded-xl`), inner field 8px (`rounded-lg`), pill/tag `rounded-full`. | `NutritionDashboardRings.tsx:60`, `StagedMealCard.tsx:215` | Workout cards are `rounded-2xl p-3/4` and History `rounded-3xl p-5 shadow-2xl` (H50): both converge on Card. |
| STD-CMP-3 | **List row anatomy:** row 1 = name (14px/600, flex-1, ≤2 lines) + one primary control + ⋯ overflow; row 2 = metadata/number columns (12px, tabular). Row ≥44px. Destructive actions live in ⋯ (danger tone) or in the editor sheet, never as a bare icon in the row. | `MealLogRow.tsx:146`, `ComponentRow.tsx:162` | SetRow (W3: the filled ✓ that deletes), Library row Trash (L1, L4), History exercise rows. |
| STD-CMP-4 | **Buttons.** *Primary:* gradient, `text-xs font-bold rounded-xl min-h-[40px]`, label in written case with the outcome (e.g. "Log Meal (+470 kcal)", "Save changes"). *Secondary:* `bg-zinc-800 border-border-interactive`. *Icon:* ≥44px hit area with a required `aria-label`. *Destructive:* rose tone, only inside ⋯ or a ConfirmDialog. Primary/secondary pairs in a row share one height. | `StagedMealCard.tsx:466-495` | W27/W28 (34 vs 44px pairs), W29 (unlabelled ✕), L16, H52. One Button primitive enforces the heights. |
| STD-CMP-5 | **Inputs:** 16px text on every `input/select/textarea` at every width (iOS no-zoom; drop `sm:text-xs`); visible height 40px (a 32px visible box is allowed when the hit wrapper is ≥44, D32); filled `bg-zinc-950` + `border-border-interactive` + cyan focus ring; custom chevron on selects (`appearance-none` + lucide ChevronDown, ≥8px inset); `inputMode` per type; select-on-focus for numbers; Enter moves to the next field or commits. | D17, D27, D31, D32, D35 | SetRow inputs (W26, W33), EditSetSheet RPE (W28, H36), History search (H36), Library forms (L32), Stepper typing (L40). |
| STD-CMP-6 | **Choosing a unit or option from ≤6 values** uses a chip + bottom sheet (UnitChip), not a native `<select>`, when horizontal space is tight. | `UnitChip.tsx` | The kg/lb input suffix (W49), set type is hidden (K9), equipment/body-part filters use Chips. |
| STD-CMP-7 | **Dialogs:** AccessibleModal (focus trap, Escape, focus restore, `dismissible={!dirty && !saving}`); full height below 640px. **ConfirmDialog** only for bulk, irreversible or other-people-affecting actions. `window.confirm` is banned. | `AccessibleModal.tsx`; D44 | W44, H17, L4, L13; CoachCockpit/MyCoachCard confirms (Phase 8). **Nutrition gap:** `NutritionEngine.tsx:409`, `CustomDishesModal.tsx:328,412`. |
| STD-CMP-8 | **Toasts:** one floating **UndoToast** slot (promoted from QuickLogToast): check icon, 12px verb, 14px "subject · detail", 44px Undo whose `aria-label` names the subject; positioned above nav, timer pill and sticky rows; newest replaces; **6s**, paused while focused or hovered; one polite announcement. *(Unified into STD-FB-1)*. | D41 `QuickLogToast.tsx` | Set delete / exercise remove (W3, W8), meal delete (H27), archive/hide (L4, L47), success feedback (L30). |
| STD-CMP-9 | **Status and errors:** `StatusBanner` with always-mounted live regions; tones success/error/info chosen by outcome (never an error in a green banner); read errors offer Retry (44px); mutation errors keep the user's input. *(See STD-FB-1: inline StatusBanner reserved for persistent errors; never inline success)*. | `StatusBanner.tsx`, `NutritionEngine.tsx:388` | W11, L6, L9 (error in a green banner), H6, H33. |
| STD-CMP-10 | **Loading:** skeletons that match the final layout (`aria-busy`, `role=status` label) whenever data is pending on first load; **the empty state renders only when the query succeeded with 0 rows**; spinners only for in-place actions (Analyze, Save). | Spinners only; **Nutrition gap: no skeletons** (adopt in Phase 8) | W21, L10, H7, H23. |
| STD-CMP-11 | **Empty states:** one sentence saying what's missing plus a primary CTA to fix it, and "Clear filters" when filters caused it. | "No meals logged for this date yet." (CTA via the AI box above) | W25, H20, H23, L8 ("Create '<query>'"). |

## 4. Typography, colour and icons

| ID | Rule | In Nutrition | Other tabs |
|---|---|---|---|
| STD-TYP-1 | **Three sizes:** 16px (inputs only), 14px (the main text of each spot: item/exercise names, dish names, sheet titles, key values), 12px (everything else: labels, buttons, chips, units, status lines, numbers in cells). **Nothing below 12px.** | D18, D43; guard "D43 nutrition type scale" | W47 and H35 (10/11px, ×19 in History) move to this scale (**not** the `text-3xs/2xs` tokens the audits proposed; decision S2). Shell labels (BottomNav, Header tag, timer pill) are in Phase 8. |
| STD-TYP-2 | **Three weights:** 400/600/700. No 500/800/900 (`font-black` is banned). | D18, D43 | History `font-black` headers (e.g. `NutritionHistoryTimeline.tsx:128`), Workout headings. |
| STD-TYP-3 | **One family** (system sans) + `tabular-nums` on every number. **No `font-mono`.** | D18 | W47 (mono chips), History pills, Header/timer pill mono tags. |
| STD-TYP-4 | **Section headers** 12px/700 uppercase `tracking-wider`; **buttons** in written case (no uppercase transform). | D43 | W27 ("ADD" button), Library/History headers. |
| STD-COL-1 | **Surfaces:** base zinc-950, card zinc-900, elevated zinc-800; borders `border-border-subtle` / `border-border-interactive`; glow only via `.shadow-neon-*` tokens (no raw `rgba` literals). | `index.css` tokens | W48, H35 (raw emerald shadow). |
| STD-COL-2 | **Text contrast AA:** body/secondary text ≥ `text-zinc-400` on zinc-900 (6.4–6.9:1); `zinc-500` only for disabled or decorative text; low-emphasis numbers ≥3:1. | **Nutrition gap:** 28× `text-zinc-500`, zero values `zinc-600` (Phase 8) | W15, L20, H18, H24 (NEW-14). |
| STD-COL-3 | **Semantic tones:** success emerald-400, error/over rose-400, warning amber-400, info/interactive cyan-400. Colour never carries meaning alone (sr-only text or icon too). | D8, D20 `MacroCell.tsx:31,73` | PR highlight, error rows, "Hidden"/"Archived" tags. |
| STD-COL-4 | **Domain colour sets are local.** The macro palette (kcal amber, P cyan, C emerald, F violet, Fib teal) is Nutrition-only. Workout/History may define their own small identity set (e.g. PR = amber, volume = cyan) in one constant, documented here when created. | `macroColumns.ts` | See §10 "Do not copy". |
| STD-ICO-1 | **Icons:** `lucide-react` only; 14px inline with 12px text, 16px in buttons/rows, 20px in the nav and sheet close; icon-only controls need `aria-label`; an icon must match its action (no ✓ that deletes, no ↻ that stops). | Nutrition icon inventory | W3 (✓ deletes), W30 (RotateCw = stop), W9 (icon-only Clear). |

## 5. Interactions

| ID | Rule | In Nutrition | Other tabs |
|---|---|---|---|
| STD-INT-1 | **Adding** appends; it never replaces what the user built. Identical items merge per a written identity rule. Feedback via UndoToast "Added…". | D33, D36, D45 | Workout add-exercise multi-select (W22): already-added rows are shown as "In workout" (W12); ExercisePicker inline create. |
| STD-INT-2 | **Saved records are edited in a sheet with an explicit "Save changes"** (disabled until dirty; pending state; one write). **No autosave** of saved records. Undo after Save restores the previous snapshot via the same write path. | D44 | EditSetSheet (W17, H1), template builder (L5 single RPC write), exercise edit (L13). |
| STD-INT-3 | **Undo vs confirm:** single reversible actions → do it + UndoToast. **Deletes are deferred** (no DELETE until the toast expires, flushed on navigation/`pagehide`); inserts/updates are undone with a reversing write (D42/D44). ConfirmDialog only for bulk, irreversible or other-people-affecting actions (Clear workout, Reload routine with changes, Delete session, coach Hide for athletes, disconnect coach). | D41, D42, D44 (decision K7) | W3, W8, W9, W10, H17, H27, H45, L4, L34, L47. |
| STD-INT-4 | **What you see is what gets saved.** No hidden fallback values committed on the user's behalf; untouched fields stay untouched; bulk commits show a review first. | D5 (no silent discard) | W5 (hidden ghost reps), W18 (Finish review sheet). |
| STD-INT-5 | **Never lose input on failure:** clear drafts only on success; keep form values and show the error on failure; the retry uses the same values. | D44 save failure path | W4, L6, H27 (cache cleared before the DELETE). |
| STD-INT-6 | **Optimistic updates with rollback** for list mutations; per-row pending state; disable a control while its request is in flight. | `useNutritionData` mutations | W35, L13, H27. |
| STD-INT-7 | **Race guards:** results of async work are applied only if the target is unchanged (latest-ref / identity check); synchronous double-tap guard on submit buttons. | D33, D39, `AddItemsComposer.tsx:73` | W2 (date change), H3 (athlete switch), H26 (paging), picker inline create. |
| STD-INT-8 | **Gestures:** no swipe-only actions; every action has a visible control. Haptics: none. | none in Nutrition | Reorder uses buttons (or a later drag handle with button fallback) plus live-region announcements (L17, W39). |
| STD-INT-9 | **Tap targets: hit area ≥44px on every interactive control.** Visual size may be 32–40px when the hit area is expanded invisibly (D32 overlay pattern); primary buttons ≥40px visually; hit areas never overlap. | D25, D32 (44), D19 (40 floor: raised to 44 in Phase 8, decision S1) | W33 (17 targets under 44), L27, H25, H36, H39. Guard: an elementFromPoint grid per surface. |

## 6. Data display

| ID | Rule | In Nutrition | Other tabs |
|---|---|---|---|
| STD-DAT-1 | **One formatter per quantity type**, used everywhere; no inline template strings. | `formatCalories`, `formatMacro` (`src/utils/nutrition.ts`) | `src/utils/weight.ts` (`formatWeight`, `formatSet`, `parseWeightInput`; K1): `BW` for 0, `100×8`, unit suffix per preference. Replaces the four spellings (W7, H48, Coach timeline). |
| STD-DAT-2 | **Rounding:** kcal whole numbers; macros 1 decimal, trailing `.0` stripped, `-0` sanitised; weights 0.5 in the display unit; the stored value keeps full precision. | `nutrition.ts:45,61` | W49/H48 (kg/lb, canonical lb storage, K1). |
| STD-DAT-3 | **Units** always visible next to numbers in labels; screen-reader labels spell units out even when the visual drops them. | D20 | PR chip is unitless today (W49); "lbs volume" copy (H48). |
| STD-DAT-4 | **Day-bucketed records store a civil date column** (`logged_date`, `workout_date`) and every tab groups and displays by it; timestamps are only for ordering within a day. Times convert with the owner's `users.timezone`. | D29, `nutritionDayKey.ts` | K5: `workouts.workout_date` (W2, W40, H4, H9 range filters, Coach timeline). |
| STD-DAT-5 | **Dates:** "Sep 15" (add the year when it isn't the current year); weekday for day headers ("Tue, Sep 15"); never print raw ISO strings. | Dashboard date input, `formatShortDate` | H4 (raw ISO), H37 (year missing), H41 (raw `YYYY-MM-DD`). |
| STD-DAT-6 | **Totals and aggregates are server-side or derived from one definition**; a number shown on two tabs comes from the same source. | parent = Σ(items), Day total | PR (K4), volume working-only (K9), History counts (H8 header). |
| STD-DAT-7 | **Charts** are small inline SVG (no chart library), labelled with a text summary for screen readers; rings keep ≥4px clearance. | `MacroRing.tsx`, D37 | H42 sparkline + sheet chart. |
| STD-DAT-8 | **Lists never silently cap.** Paginate (keyset) or search server-side; show "Showing N of M"; a cap that hides data is a bug. | 5-day superset query (`useNutritionData.ts:124`) | W16, L23, L33, H8, H9, H11, H15. |
| STD-DAT-9 | **Hidden set types.** Non-working sets (warm-up/drop) are hidden on every tab and excluded from PR, Last, completion counts and volume (decision K9); no UI creates them. | n/a | W6, H16, EditSetSheet has no set-type picker. |

## 7. Copy and tone

| ID | Rule | In Nutrition | Other tabs |
|---|---|---|---|
| STD-CPY-1 | **Buttons say the outcome**, in written case: verb + object (+ the effect when useful): "Log Meal (+470 kcal)", "Save changes", "+ Add", "Finish without them". | D34, D43 | "ADD" → "Add exercise" (W22); "Clear" → "Clear workout" (W9); "Load More Sessions (50+)" → "Show older sessions" + "Showing N of M" (H31). |
| STD-CPY-2 | **Toast verbs** are past tense and short ("Logged", "Added to meal", "Updated", "Set deleted", "Exercise archived"); line 2 names the subject. | D41 | W3/W8, L30, H17/H27. |
| STD-CPY-3 | **Errors** are plain and factual, say what happened and what to do, and never blame the user or guess ("You don't have permission to archive this exercise", not "workout logs reference it"). | Nutrition error copy | L3 misleading copy, L6. |
| STD-CPY-4 | **Destructive copy names the object and the consequence** ("Delete 3 logged sets of Bench Press?", "Hide 'Bench Press' for you and your 4 athletes? It stays in History."). Distinguish session vs catalog actions ("Remove from workout" vs "Archive exercise"). | D42 Undo labels | W8, W9, L4, L47, C7. |
| STD-CPY-5 | **aria-labels include the subject**: "Undo add Oats", "Edit set 2 of Bench Press", "Actions for Bench Press". | `QuickLogToast`, `ComponentRow` | L16, W29, H33. |
| STD-CPY-6 | **Placeholders show an example**, not instructions ("e.g. a banana and 200 ml oat milk"). | D45 | Picker search ("e.g. bench, rdl"), set inputs placeholder "BW" (W7). |

## 8. Feedback

| ID | Rule | In Nutrition | Other tabs |
|---|---|---|---|
| STD-FB-1 | **One transient feedback system** (decision D-P8.1-6/-7): ONE app-shell toast host (`src/components/common/ToastHost.tsx` mounted in `App.tsx` inside `ToastProvider`), consuming `useToast().show({ message, kind, action, durationMs })`. Visual format is `UndoToast` (`src/components/common/UndoToast.tsx`). One position above bottom chrome with measured offsets (74px base above BottomNav, 128px staged bar, 148px rest-timer bar) registered via `useToastOffset`. Screen reader live region uses `role="status"` and `aria-live="polite"`. Timing: `success` and `info` auto-dismiss after default 4000ms; `undo` countdown auto-dismisses after default 6000ms (`useDeferredDelete`). Concurrency: maximum ONE toast visible at any time; a new toast immediately commits any pending undo action and replaces the active toast. Supports one optional action button (`ToastAction`). **Persistent inline errors:** errors needing user action stay persistent inline as `StatusBanner` (`tone="error"`) directly next to the failing element, cleared on retry or success; never render inline success/info text anywhere. **Enforcement:** `npm run check:design` ratchet rule `adhoc-success` at baseline 0 (flags inline success banners, legacy `setStatus('Saved')`, inline `Copied!`, and direct `<UndoToast>` usage outside `ToastHost`). | Replaced ad-hoc `setStatus('Saved')` and inline status banner above staged meal (D-P8.1-5); QuickLog and timeline deletion use `kind: 'undo'`. | App-wide standard: Workout set deletion, History meal deletion, Library exercise archive, Settings toggle confirmations. All trigger `useToast()` into shell host. Zero direct `<UndoToast>` in tabs. |

### 8.1 Transient Feedback API & Contract (`STD-FB-1`)
- **App-shell Host:** `<ToastHost />` is mounted once in the app root (`App.tsx`) wrapped by `<ToastProvider>`. Tab components and modals never render `<UndoToast>` directly.
- **Hook API:** `const { show, dismiss } = useToast();`
  - `show({ message, kind, action, durationMs, verb, subject, detail, onCommit, onUndo, undoLabel })`
  - `kind`: `'success' | 'info' | 'undo'` (default: `'success'`, or `'undo'` if undo action/callback provided).
  - `action`: `{ label: string, onAction: () => void | Promise<void>, ariaLabel?: string, testId?: string }`.
  - `durationMs`: default `4000ms` for `success`/`info`; default `6000ms` for `undo`.
- **Dynamic Offsets (`useToastOffset`):** Components that mount sticky bottom bars register an offset via `useToastOffset(offsetVal)`:
  - Base above BottomNav: `74px`
  - Staged meal card active: `128px`
  - Rest-timer bar active: `148px`
- **Accessibility:** Live region with `role="status"` and `aria-live="polite"` announces `${verb}: ${subject} · ${detail}`. Action buttons require descriptive `aria-label` (e.g. `"Undo delete Bench Press Set"`).
- **Single-Slot Concurrency:** Only one toast is visible. Triggering `show()` while a toast is active replaces it immediately. If the previous toast was an uncommitted `undo` toast, replacing it immediately calls `onCommit()` exactly once (same as timer expiration).
- **Error vs Feedback Distinction:**
  - Transient feedback (toasts) is strictly for non-critical confirmations (`success`, `info`, or reversible `undo`).
  - Errors requiring user resolution must remain persistent inline `StatusBanner` (`tone="error"`) adjacent to the input or action control until resolved on retry/success. Never auto-dismiss actionable error states.
  - Never render inline success banners or status text (`StatusBanner tone="success"`, `setStatus('Saved')`, or inline `Copied!`).
- **Ratchet Enforcement:** `scripts/check-design-ratchet.js` enforces the `adhoc-success` rule at baseline 0:
  - Zero `<StatusBanner tone="success">` or dynamic tone returning `'success'`.
  - Zero `<StatusBanner tone="info">` containing success copy (`'Saved'`, `'Meal deleted'`, `'Custom dish saved'`).
  - Zero `setStatus('Saved')` calls.
  - Zero literal `Copied!` in JSX.
  - Zero `<UndoToast>` usage outside `ToastHost`.

### 8.2 Do / Don't Examples
| Context | Do | Don't |
|---|---|---|
| **Save confirmation** | `useToast().show({ message: 'Routine saved', kind: 'success' })` | `<StatusBanner tone="success" message="Routine saved" />` (inline banner causes layout shift; trips `adhoc-success` ratchet) |
| **Reversible deletion** | `useToast().show({ verb: 'Deleted', subject: 'Set 2', kind: 'undo', onUndo, onCommit })` | Delete immediately without undo window, or block user with a modal confirmation dialog for single reversible actions |
| **Toast mounting** | Let `<ToastHost />` at app root render the toast via `useToast().show(...)` | `<UndoToast toast={localToast} onDismiss={...} />` inside a tab or sheet (trips `adhoc-success` ratchet) |
| **Actionable error** | `<StatusBanner tone="error" message="Failed to save routine. Check connection." onRetry={handleRetry} />` next to submit button | `useToast().show({ message: 'Error saving', kind: 'error' })` (auto-dismissing errors risk data loss before user can read or retry) |
| **Clipboard copy** | `await navigator.clipboard.writeText(url); useToast().show({ message: 'Link copied to clipboard', kind: 'info' })` | `const [copied, setCopied] = useState(false);` with inline `<span>{copied ? 'Copied!' : 'Copy'}</span>` |
| **Sticky bar offset** | `useToastOffset(isStaged ? 128 : undefined)` in the component owning the sticky bar | Hard-coding `bottom-20` on toast instances or letting floating toasts obscure sticky action bars |

## 9. Accessibility (cross-cutting)
- **STD-A11Y-1:** Tabs use `role=tablist/tab`, `aria-selected`, `aria-controls` and roving tabindex (SegmentedTabs); toggle chips use `aria-pressed`; single-select filters use `radiogroup` (L14, L15, H12, H22).
- **STD-A11Y-2:** Accordions are `<button aria-expanded aria-controls>`; each page has one h1 and each section an h2 (W29, H33).
- **STD-A11Y-3:** Animations honour `motion-reduce` (W29 pill pulse).
- **STD-A11Y-4:** Every new surface gets an axe check in its unit tests and a density block at 320/390 (W38, H46, L37).

## 10. Nutrition-specific: do NOT copy elsewhere
| Pattern | Why it's Nutrition-only |
|---|---|
| Macro colour palette (kcal/P/C/F/Fib) | Nutritional identity; reusing it for workout data would imply macros. |
| parent = Σ(items) constraint, item model, D36 merge rule | Specific to composable meals. Workout sets are independent rows. |
| Staged-meal buffer before logging | Exists because AI parsing needs review before commit. Workout logs set by set (each commit is the unit); Finish uses a *review sheet* (W18), not a staging buffer. |
| AI parse / photo compression / 15 RPM rate-limit copy | Food-only edge function. |
| Quick Log favorites ordered by `use_count` | Habitual meals. The exercise picker uses Recent/Frequent from history (W22). |
| kcal-vs-macros hint (D23/D38) | Domain math. |
| 5-day superset nutrition query window | Workaround for `logged_at` vs `logged_date`; workouts get a civil column directly (K5). |
| Rings (MacroRing) as the page header | Daily targets; Workout has no daily target ring (don't force one). |

## 11. Guards that enforce these standards (extend per tab)
| Guard | Enforces | Extend in |
|---|---|---|
| D43 type walker (`visual-density.test.ts`) | STD-TYP-1..3 | Workout (Phase 3a), History (5a), Library (7a), shell (8) |
| Tap/elementFromPoint grids | STD-INT-9, STD-LAY-4 | every sheet and sticky row |
| Overflow check at 320 | STD-LAY-3 | every tab route |
| No `window.confirm` (lint grep in CI) | STD-CMP-7 | Phase 3a adds the check; Phase 8 removes the last callers |
| No `text-[10px]`/`text-[11px]`/`font-mono`/`font-black`/`text-zinc-500` on text in `src/` (grep gate, allow-list with STD IDs) | STD-TYP, STD-COL-2 | ratchet per phase; zero by Phase 8 |
| Design ratchet `check:design` (`adhoc-success`, zero direct `<UndoToast>` outside `ToastHost`) | STD-FB-1 | baseline 0 across all `src/` (P8.1 D-P8.1-7) |
