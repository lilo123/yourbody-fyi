# Frontend Documentation

## Tech Stack Overview
- **Framework**: React 19
- **Bundler**: Vite 8
- **Styling**: Tailwind CSS v4
- **State Management**: `@tanstack/react-query` v5 for server state

## Design Decisions

### Optimization & Code Splitting
- **Dynamic Routing**: Implementation of Route Code Splitting strategies using `React.lazy()` and `<Suspense>`.
- **Target Modules**: Specifically used for high-complexity modules like `CoachCockpit` and `HistoryView` to significantly minimize the initial application bundle overhead.

### Styling & Theming
- **Aesthetic**: Cyberpunk dark neon theme.
- **Utility Tools**: Usage of `clsx` and `tailwind-merge` for conditionally merging and overriding Tailwind utility classes smoothly.
- **Icons**: Lucide React.

### Forms & State
- **Form Management**: The frontend relies heavily on `react-hook-form` to marshal complex inputs (like dietary logging, sets/reps).
- **Mutations**: Hooked into `@tanstack/react-query` mutations to update server state optimally and handle loading/error transitions.

## Component Hierarchy & Structure Guidelines
- `src/components/auth/`: Login and authentication flows.
- `src/components/coach/`: Lazy-loaded Coach Cockpit views.
- `src/components/common/`: Shared UI (Headers, Navigations, Buttons).
- `src/components/history/`: Lazy-loaded workout/nutrition logs.
- `src/components/nutrition/`: Meal decomposition and nutrition entry.
- `src/components/workout/`: Ghost set logic and live tracking.
- `src/context/`: Core React contexts (`AuthContext`, `CoachContext`).
- `src/hooks/`: Reusable hooks.
