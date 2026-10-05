# Yourbody — Performance Baseline

**Generated:** 2026-09-16T05:56:29.259Z
**Scope:** Performance baseline and bundle metrics under throttled conditions
**Environment (as recorded by the generating run, not the tree you are reading):** Linux · Node v22.22.2 · Vite 8 (Rolldown) · Playwright 1.62 · Lighthouse 13.4.1
**Regeneration Command:** `npm run perf:baseline` — see the regenerability notice below; this command currently fails for section 1 Criterion #4 and for section 4.
**Throttling Applied:** Slow 4G (150ms RTT, 1.6Mbps down / 750kbps up) + 4x CPU slowdown (simulated)

---

## 0. Provenance and regenerability

**Source commit of every figure below:** `3a81eaedea47af3845029fafc11d1bf2fa4fe486`, measured `2026-09-16T05:56:29.258Z`
(recorded as `provenance.gitCommit` in `docs/perf-baseline-results.json`).
**These figures were not produced by the current working tree.** The tree has moved on since `3a81eaed`.

**The Lighthouse half of this document cannot be regenerated in this environment.** `scripts/measure-baseline.js`
imports three packages to drive the audit, and none of them is installed here:

| package | declared in `package.json` | installed in `node_modules` |
|---|---|---|
| `lighthouse` | yes, devDependency `^13.4.1` | **absent** |
| `chrome-launcher` | yes, devDependency `^1.2.1` | **absent** |
| `puppeteer-core` | **no — imported but undeclared** | **absent** |

`npm run perf:baseline` therefore aborts with an explicit `[FAIL] Lighthouse measurement missing` error
before any figure is written. It does not silently emit stale or fabricated scores. The **Environment**
line above is likewise a record of the *generating* run's toolchain: in particular `Lighthouse 13.4.1`
names a package that is not present on this machine.

What this means for the reader:

- **Criterion #4 in section 1, and the whole of section 4** (the six route scores, plus their LCP, TBT,
  CLS and TTI columns, which are Lighthouse outputs) are **historical and not reproducible on this tree**.
  Do not cite them as evidence about the current code. Criteria #5, #6 and #7 draw on the same section 4
  measurements and inherit the same caveat.
- **Criteria #1, #2 and #3** (bundle and chunk sizes, section 2) and **section 3** (Supabase payload) come
  from the build and database paths, which do not need the audit toolchain. Those remain regenerable.
- The regenerability requirement closes **UNVERIFIED** on the Lighthouse half. The
  remedy is to record true provenance rather than to install a toolchain in the middle of a measurement
  programme, because changing the dependency tree would invalidate the payload figures being measured
  against it.

---

## 1. Executive Summary & Ratified Criteria Evaluation

This baseline report establishes empirical measurements for Yourbody on a production compilation artifact set (`dist/`) under standardized mobile network and CPU throttling. All numbers reflect genuine runtime executions with zero fabricated fallbacks — but they were executed at commit `3a81eaed`, not at the commit you are reading, and the four Lighthouse-derived rows below are no longer reproducible in this environment. See section 0.

| Ratified Exit Criterion | Target Threshold | Observed Baseline Value | Status |
|---|---|---|---|
| **Criterion #1: Initial-Route JS gzip** | ≤ 250 KB gzip (`/login`) | **216.13 KB** (221,316 B) | ✅ PASS |
| **Criterion #2: App Entry Chunk (`index-*.js`)** | ≤ 120,000 B raw | **40,274 B** | ✅ PASS |
| **Criterion #3: React Vendor Chunk** | ≤ 160,000 B raw (plan §6) | **182,129 B** | ❌ FAIL |
| **Criterion #4: Lighthouse Mobile Performance (all 6 routes)** | ≥ 85 on all six routes | /workout: 93, /nutrition: 94, /history: 95, /coach: 93, /exercises: 92, /settings: 96 | ⚠️ PASS **as measured at `3a81eaed`** — historical, not regenerable here (§0) |
| **Criterion #5: Largest Contentful Paint (`/workout`, Slow 4G)** | ≤ 2.5 s (2500 ms) | **2.91 s** (2913 ms) | ⚠️ FAIL **as measured at `3a81eaed`** — historical, not regenerable here (§0) |
| **Criterion #6: Total Blocking Time (all routes)** | ≤ 200 ms on all routes | Max: **90 ms** (/workout: 41ms, /nutrition: 30ms, /history: 37ms, /coach: 90ms, /exercises: 37ms, /settings: 59ms) | ⚠️ PASS **as measured at `3a81eaed`** — historical, not regenerable here (§0) |
| **Criterion #7: Cumulative Layout Shift (all routes)** | ≤ 0.05 on all routes | Max: **0.0001** | ⚠️ PASS **as measured at `3a81eaed`** — historical, not regenerable here (§0) |

---

## 2. Bundle Composition & Chunk Size Breakdown

Measured from a fresh `npm run build` artifact set (`dist/`):

| Chunk / Asset Name | Raw Bytes | Raw (KB) | Gzip Bytes | Gzip (KB) | Type / Role |
|---|---|---|---|---|---|
| `supabase-CcMctgS4.js` | 203,077 B | 198.32 KB | 51,621 B | 50.41 KB | Supabase Client & Auth SDK |
| `react-vendor-Cqic2lDV.js` | 182,129 B | 177.86 KB | 56,673 B | 55.34 KB | React Runtime (collapses React + Router + Lucide) |
| `NutritionEngine-DNcvEefZ.js` | 91,292 B | 89.15 KB | 21,411 B | 20.91 KB | Vendor / Library |
| `index-UHxEGm16.css` | 76,278 B | 74.49 KB | 11,387 B | 11.12 KB | Global Tailwind / App CSS |
| `tanstack-B5wdz_NE.js` | 59,840 B | 58.44 KB | 17,184 B | 16.78 KB | TanStack React Query |
| `WorkoutEngine-Cwn2j7Ef.js` | 41,233 B | 40.27 KB | 10,297 B | 10.06 KB | Vendor / Library |
| `index-DRb2By6s.js` | 40,274 B | 39.33 KB | 9,851 B | 9.62 KB | Eager Application Entry |
| `react-router-dom-p9Ck5xa0.js` | 39,188 B | 38.27 KB | 13,978 B | 13.65 KB | Vendor / Library |
| `HistoryView-DT0xKiV-.js` | 38,075 B | 37.18 KB | 9,468 B | 9.25 KB | Lazy Route Chunk |
| `ExercisesView-CoBERId0.js` | 37,342 B | 36.47 KB | 7,954 B | 7.77 KB | Vendor / Library |
| `CoachCockpit-CFP2EMoW.js` | 35,835 B | 35.00 KB | 8,204 B | 8.01 KB | Lazy Route Chunk |
| `MealLogRow-BCo7_3J9.js` | 28,904 B | 28.23 KB | 7,744 B | 7.56 KB | Vendor / Library |
| `SettingsView-C_MIGTN5.js` | 21,473 B | 20.97 KB | 4,535 B | 4.43 KB | Vendor / Library |
| `lucide-react-DgORt80F.js` | 20,035 B | 19.57 KB | 7,373 B | 7.20 KB | Vendor / Library |
| `vendor-BK4PVOmw.js` | 11,547 B | 11.28 KB | 4,265 B | 4.17 KB | Vendor / Library |
| `workoutSessionStore-B2hQ0VLC.js` | 8,767 B | 8.56 KB | 2,464 B | 2.41 KB | Vendor / Library |
| `workoutEngineHelpers-CU3Qk1rk.js` | 7,757 B | 7.58 KB | 2,116 B | 2.07 KB | Vendor / Library |
| `useWorkoutQueries-Dgov4yyT.js` | 3,730 B | 3.64 KB | 1,441 B | 1.41 KB | Vendor / Library |
| `date-Bz-YVRRR.js` | 3,595 B | 3.51 KB | 1,425 B | 1.39 KB | Vendor / Library |
| `index.html` | 1,801 B | 1.76 KB | 780 B | 0.76 KB | HTML Shell |
| `historyGrouping-79j9jPL5.js` | 661 B | 0.65 KB | 392 B | 0.38 KB | Vendor / Library |
| `rolldown-runtime-CbXtAM7H.js` | 589 B | 0.58 KB | 368 B | 0.36 KB | Vendor / Library |
| `useCoach-4T83iR3U.js` | 278 B | 0.27 KB | 224 B | 0.22 KB | Vendor / Library |

### Key Bundle Observations:
1. **React Vendor Chunk:** `react-vendor-Cqic2lDV.js` is **182,129 B** (raw) and **56,673 B** (gzip).
2. **App Entry Chunk:** `index-DRb2By6s.js` is **40,274 B** (raw) and **9,851 B** (gzip).
3. **Initial Route JS:** Sum of eagerly loaded JS bundles is **801,711 B** (raw) and **221,316 B** (gzip).

---

## 3. Route Load & Network Transfer Baseline (Seeded Account)

Measured using the automated Playwright performance project (`perf-trace`) on a simulated mobile device (Pixel 7).
The seeded benchmark account (`bench-athlete@example.com`) holds **550 sets across 50 workouts** and **350 daily nutrition logs**.

| Route | Auth Context | Total Requests | Transferred Bytes | Supabase Query Payload | First Meaningful Content / Load |
|---|---|---|---|---|---|
| `/workout` | Authenticated Athlete (550 sets) | 52 | 11539.64 KB | 68.32 KB (69,958 B) | 1906 ms |
| `/nutrition` | Authenticated Athlete (350 logs) | 75 | 11.97 MB | Full daily timeline logs | 1304 ms (LCP) |
| `/history` | Authenticated Athlete | 60 | 11.61 MB | All historical sets & workouts | 1732 ms (LCP) |
| `/coach` | Authenticated Coach | 59 | 11567.67 KB | Athlete rosters and stats | Ready |

### PostgREST Payload Breakdown for `/workout` First Authenticated Paint:

| Query Target Path | Status | Response Bytes | Predicate / Parameters | Architectural Risk |
|---|---|---|---|---|
| `public.users` | 200 | **370 B** | `?select=id%2Cemail%2Cusername%2Crole%2Ctarget_calories%2Ctar...` | Normal |
| `public.users` | 200 | **370 B** | `?select=id%2Cemail%2Cusername%2Crole%2Ctarget_calories%2Ctar...` | Normal |
| `public.users` | 200 | **370 B** | `?select=id%2Cemail%2Cusername%2Crole%2Ctarget_calories%2Ctar...` | Normal |
| `public.exercises` | 200 | **1,340 B** | `?select=id%2Cname%2Cbody_part%2Cis_master&order=name.asc...` | Normal |
| `public.routine_templates` | 200 | **40,698 B** | `?select=id%2Cuser_id%2Cname%2Cis_master%2Cassigned_to%2Cdays...` | Normal |
| `public.workouts` | 200 | **26,810 B** | `?select=id%2Cdate%2Cname%2Csets%28id%2Cworkout_id%2Creps%2Cw...` | ⚠️ Workout session query |

---

## 4. Historical Lighthouse Mobile Performance Scores (All Six Routes) — commit `3a81eaed`, NOT regenerable here

> **Provenance.** These scores were measured on `2026-09-16T05:56:29.258Z` against commit
> `3a81eaedea47af3845029fafc11d1bf2fa4fe486`. They were previously labelled "Authoritative"; that label was
> wrong twice over — they describe a different commit, and the toolchain that produced them
> (`lighthouse`, `chrome-launcher`, `puppeteer-core`) is not installed in this environment, so they cannot
> be re-measured to check. See section 0. Every figure in this section, including the LCP, TBT, CLS and TTI
> columns and the four criteria verdicts derived from them, carries that caveat.

Audited using Chrome Mobile (Pixel 7 emulation, 412x915) against a production build served via Vite preview.
Throttling: Slow 4G (150ms RTT, 1.6Mbps) + 4x CPU slowdown (simulated).

| Route | Auth Context | Score | LCP | TBT | CLS | TTI | Criteria #4 (≥85) | Criteria #5 (LCP ≤2.5s) | Criteria #6 (TBT ≤200ms) | Criteria #7 (CLS ≤0.05) |
|---|---|---|---|---|---|---|:---:|:---:|:---:|:---:|
| `/workout` | Workout (athlete@example.com) | **93 / 100** | 2.9 s | **40 ms** | 0 | 2.9 s | ✅ PASS | ❌ FAIL | ✅ PASS | ✅ PASS |
| `/nutrition` | Nutrition (athlete@example.com) | **94 / 100** | 2.7 s | **30 ms** | 0 | 2.7 s | ✅ PASS | N/A | ✅ PASS | ✅ PASS |
| `/history` | History (athlete@example.com) | **95 / 100** | 2.7 s | **40 ms** | 0 | 2.7 s | ✅ PASS | N/A | ✅ PASS | ✅ PASS |
| `/coach` | Coach (coach@example.com) | **93 / 100** | 2.9 s | **90 ms** | 0 | 2.9 s | ✅ PASS | N/A | ✅ PASS | ✅ PASS |
| `/exercises` | Exercises (athlete@example.com) | **92 / 100** | 3.1 s | **40 ms** | 0 | 3.1 s | ✅ PASS | N/A | ✅ PASS | ✅ PASS |
| `/settings` | Settings (athlete@example.com) | **96 / 100** | 2.5 s | **60 ms** | 0 | 2.5 s | ✅ PASS | N/A | ✅ PASS | ✅ PASS |

---

## 5. React Profiler & Render Cost Baseline

Measured using React 19 `<Profiler>` instrumenting `WorkoutEngine` during typical athlete set interactions:

| User Interaction | Monitored Scope | Commit Count | Total Actual Duration | Base Duration (Subtree Estimate) | Architectural Root Cause |
|---|---|---|---|---|---|
| **Typing 1 character** ('1' into weight) | Whole `WorkoutEngine` | **1 commit** | **14.64 ms** | 14.34 ms | Monolithic component storing input drafts in root state |
| **Complete Set Entry** (type 185, 8, click commit) | Whole `WorkoutEngine` | **5 commits** | **80.56 ms** | 18.13 ms | Keystroke and mutation state updates cascade through entire view |

---

## 6. Verification & Reproducibility

To regenerate this entire report with authoritative measurements against a fresh build at any time:
```bash
npm run perf:baseline
```

To run without network/CPU throttling (for negative control or baseline comparisons):
```bash
node scripts/measure-baseline.js --no-throttling
```
