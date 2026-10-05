# Testing Strategy

## Orchestration
The primary command to run before raising any major PR is `npm run test:all`. This sequentially executes unit, database, deno, and e2e test suites.

## The 4 Pillars of Testing

### 1. Unit & Components (Vitest + RTL)
- **Command**: `npm test` or `npm run test:watch`
- Focus: Algorithms (Ghost sets), Hooks (`useAuth`), components rendering conditions and form handling.

### 2. Database Integrity (pgTAP)
- **Command**: `npm run test:db`
- Focus: Schema validation, Foreign Key cascades, and critically, Postgres Row Level Security (RLS) security policies and role checks. Always ensure RLS is not bypassing intentionally restricted data.

### 3. Serverless AI (Deno)
- **Command**: `npm run test:deno`
- Focus: Edge Functions logic tracking. Simulates Deno environments to ensure Gemini fallback chains operate and payloads normalize correctly.

### 4. End-to-End Testing (Playwright)
- **Command**: `npm run test:e2e`
- Focus: Full browser integration flows, simulating user interactions from auth to logging workouts.

## Guidelines for Authors
- For new domains, establish Vitest cases for isolated logic.
- Any change to Edge functions must be accompanied by updating `supabase/functions/*/index.test.ts`.
- Supabase changes must include positive/negative access pgTAP tests.
