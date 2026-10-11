# Operations & Diagnostic SQL Cookbook

This document is a practical, read-only SQL cookbook for the database owner and operations team. These queries can be executed directly in the Supabase SQL Editor (or via administrative `psql` connections) to inspect system health, subscription distribution, revenue estimates, AI quota consumption, coach roster saturation, and webhook ingestion status.

### Safety & Guardrails
- **Read-Only / Side-Effect Free:** Every query is strictly `SELECT`-only. No data mutations, administrative deletions, or state-altering functions are invoked.
- **Privacy & Anonymity:** Queries avoid logging or displaying personal identifying information (PII) such as email addresses, billing names, or IP addresses. User identification is restricted to internal UUIDs and Stripe customer identifiers.
- **Bounded Result Sets:** Queries that produce lists of records enforce strict row bounds (`LIMIT 50` or `LIMIT 20`) to prevent runaway resource consumption on large production tables.

---

## 1. Paying Users by Tier & Grandfather Status

### Purpose
Provides a census of user distribution across subscription tiers, distinguishing between paying subscribers (active Stripe billing customer ID), grandfathered users (courtesy entitlement grant in `public.billing_grandfather`), trial users, and free accounts.

### Tier Definitions
- **Personal:** User on `plan = 'basic'` with active entitlement (`paid_until > now()`).
- **Coach:** User on `plan = 'pro'` with `coach_tier = 'pro'` and active entitlement (`paid_until > now()`).
- **Coach Pro:** User on `plan = 'pro'` with `coach_tier = 'enterprise'` and active entitlement (`paid_until > now()`).
- **Grandfathered:** Active entitlement granted via `public.billing_grandfather` where `granted_until > now()`.
- **Paying:** Active entitlement with non-null `billing_customer_id` and not grandfathered.
- **Trial:** Unpaid accounts within the trial window (`now() < COALESCE(trial_ends_at, created_at + trial_days)`), using `trial_days` from `public.app_config` (`ai_quota_limits`, defaulting to 14 days), matching `public.ai_plan_for()`.
- **Free:** All other accounts outside the trial period without active paid entitlements.

### Query
```sql
WITH config AS (
  SELECT COALESCE((value->>'trial_days')::integer, 14) AS trial_days
  FROM public.app_config
  WHERE key = 'ai_quota_limits'
),
tiers (tier, sort_order) AS (
  VALUES
    ('Personal', 1),
    ('Coach', 2),
    ('Coach Pro', 3),
    ('Trial', 4),
    ('Free', 5)
),
user_classification AS (
  SELECT
    u.id,
    CASE
      WHEN u.plan = 'basic' AND u.paid_until > now() THEN 'Personal'
      WHEN u.plan = 'pro' AND u.coach_tier = 'enterprise' AND u.paid_until > now() THEN 'Coach Pro'
      WHEN u.plan = 'pro' AND (u.coach_tier = 'pro' OR u.coach_tier IS NULL OR u.coach_tier = 'free') AND u.paid_until > now() THEN 'Coach'
      WHEN now() < COALESCE(u.trial_ends_at, u.created_at + make_interval(days => COALESCE((SELECT trial_days FROM config), 14))) THEN 'Trial'
      ELSE 'Free'
    END AS tier,
    CASE
      WHEN bg.user_id IS NOT NULL AND bg.granted_until > now() THEN 'grandfathered'
      WHEN u.billing_customer_id IS NOT NULL THEN 'paying'
      ELSE 'unpaid'
    END AS billing_status
  FROM public.users u
  LEFT JOIN public.billing_grandfather bg ON bg.user_id = u.id
)
SELECT
  t.tier,
  COUNT(u.id) FILTER (WHERE u.billing_status = 'paying') AS paying_count,
  COUNT(u.id) FILTER (WHERE u.billing_status = 'grandfathered') AS grandfathered_count,
  COUNT(u.id) FILTER (WHERE u.billing_status = 'unpaid') AS unpaid_count,
  COUNT(u.id) AS total_count
FROM tiers t
LEFT JOIN user_classification u ON u.tier = t.tier
GROUP BY t.tier, t.sort_order
ORDER BY t.sort_order;
```

---

## 2. Monthly Recurring Revenue (MRR) Estimate in USD

### Purpose
Calculates an estimated Monthly Recurring Revenue (MRR) range in USD across current paying subscribers.

### Why an Estimate Range is Necessary
- `billing_events` is an immutable, audit-oriented webhook log storing transactional events, but does not track ongoing customer subscription intervals or lifecycle transitions.
- To protect customer privacy and maintain minimal state, the database does not persist payment card details or the exact billing interval (`month` vs `year`) on `public.users` or `public.billing_events`.
- Grandfathered users (rows in `public.billing_grandfather` with `granted_until > now()`) are explicitly excluded because their access is courtesy-granted at zero billing revenue.
- Consequently, MRR is calculated as a range based on published pricing:
  - **Personal:** $2.00/month or $10.00/year ($0.833/month equivalent).
  - **Coach:** $5.00/month or $40.00/year ($3.333/month equivalent).
  - **Coach Pro:** $10.00/month or $80.00/year ($6.667/month equivalent).
  - **Minimum MRR:** Assumes 100% of paying subscribers are on the annual plan.
  - **Maximum MRR:** Assumes 100% of paying subscribers are on the monthly plan.

### Query
```sql
WITH paid_users AS (
  SELECT
    u.id,
    CASE
      WHEN u.plan = 'basic' THEN 'Personal'
      WHEN u.plan = 'pro' AND u.coach_tier = 'enterprise' THEN 'Coach Pro'
      ELSE 'Coach'
    END AS tier
  FROM public.users u
  LEFT JOIN public.billing_grandfather bg ON bg.user_id = u.id
  WHERE u.paid_until > now()
    AND u.plan IN ('basic', 'pro')
    AND u.billing_customer_id IS NOT NULL
    AND (bg.user_id IS NULL OR bg.granted_until <= now())
),
tier_pricing (tier, monthly_rate, yearly_monthly_equiv, sort_order) AS (
  VALUES
    ('Personal',  2.00,  10.00 / 12.0, 1),
    ('Coach',     5.00,  40.00 / 12.0, 2),
    ('Coach Pro', 10.00, 80.00 / 12.0, 3)
),
tier_counts AS (
  SELECT
    tp.tier,
    tp.sort_order,
    tp.monthly_rate,
    tp.yearly_monthly_equiv,
    COUNT(pu.id) AS paying_users
  FROM tier_pricing tp
  LEFT JOIN paid_users pu ON pu.tier = tp.tier
  GROUP BY tp.tier, tp.sort_order, tp.monthly_rate, tp.yearly_monthly_equiv
)
SELECT
  COALESCE(tier, 'TOTAL') AS tier,
  SUM(paying_users) AS paying_users,
  ROUND(SUM(paying_users * yearly_monthly_equiv), 2) AS min_mrr_usd,
  ROUND(SUM(paying_users * monthly_rate), 2) AS max_mrr_usd
FROM tier_counts
GROUP BY GROUPING SETS ((tier, sort_order), ())
ORDER BY COALESCE(sort_order, 99);
```

---

## 3. AI Quota & Usage Analytics

### Purpose
Monitors consumption of generative AI parsing credits recorded in `public.ai_usage` (`user_id`, `period_kind`, `period_start`, `count`), broken down by effective user plan tier and highlighting top consuming accounts.

### Schema Notes
- `period_kind` is `'day'` or `'month'`. Daily consumption is recorded on `(user_id, 'day', UTC_DATE)`.
- User plan tier is evaluated using `public.ai_plan_for(user_id)` to reflect active subscriptions, grandfathered access, active coach links, and trial status.

### Query 3A: AI Consumption Today and This Month by Plan
Aggregates consumed AI quota units for today (UTC) and the current calendar month across plan tiers.

```sql
SELECT
  COALESCE(public.ai_plan_for(a.user_id), 'unknown') AS plan,
  COALESCE(SUM(a.count) FILTER (
    WHERE a.period_kind = 'day'
      AND a.period_start = (now() AT TIME ZONE 'UTC')::date
  ), 0) AS uses_today,
  COALESCE(SUM(a.count) FILTER (
    WHERE (a.period_kind = 'day' AND a.period_start >= date_trunc('month', now() AT TIME ZONE 'UTC')::date)
       OR (a.period_kind = 'month' AND a.period_start = date_trunc('month', now() AT TIME ZONE 'UTC')::date)
  ), 0) AS uses_this_month
FROM public.ai_usage a
WHERE a.period_start >= date_trunc('month', now() AT TIME ZONE 'UTC')::date
GROUP BY 1
ORDER BY uses_today DESC, uses_this_month DESC;
```

### Query 3B: Top 20 Users by Daily AI Consumption
Identifies heavy consumers for the current UTC day. To safeguard user privacy, only internal UUIDs and effective plans are listed (no emails).

```sql
SELECT
  a.user_id,
  public.ai_plan_for(a.user_id) AS plan,
  SUM(a.count) AS uses_today
FROM public.ai_usage a
WHERE a.period_kind = 'day'
  AND a.period_start = (now() AT TIME ZONE 'UTC')::date
GROUP BY a.user_id
ORDER BY uses_today DESC
LIMIT 20;
```

---

## 4. Coaches Near Athlete Capacity Limit

### Purpose
Identifies coaches approaching or at their maximum active athlete capacity. Useful for proactively evaluating upgrade opportunities or troubleshooting athlete linking failures (`link_to_coach` rejection).

### Capacity Rules
- Athlete limit is computed via `public.effective_max_athletes(coach_id)`:
  - **Free / Personal:** 3 athletes.
  - **Coach (`pro` + `coach_tier pro`):** 10 athletes.
  - **Coach Pro (`pro` + `coach_tier enterprise`):** 25 athletes.
- This query surfaces coaches who have active athlete links greater than or equal to `limit - 1` (`active_athletes >= athlete_limit - 1`).

### Query
```sql
WITH coach_rosters AS (
  SELECT
    cal.coach_id,
    COUNT(*)::integer AS active_athletes,
    public.effective_max_athletes(cal.coach_id) AS athlete_limit
  FROM public.coach_athlete_links cal
  WHERE cal.status = 'active'
  GROUP BY cal.coach_id
)
SELECT
  cr.coach_id,
  u.plan,
  u.coach_tier,
  cr.active_athletes,
  cr.athlete_limit,
  (cr.athlete_limit - cr.active_athletes) AS remaining_slots
FROM coach_rosters cr
JOIN public.users u ON u.id = cr.coach_id
WHERE cr.active_athletes >= (cr.athlete_limit - 1)
ORDER BY remaining_slots ASC, cr.active_athletes DESC
LIMIT 50;
```

---

## 5. Webhook Ingestion & Stuck Event Diagnostics

### Purpose
Monitors Stripe webhook delivery and health within `public.billing_events`.

### Delivery Lifecycle & Retry Model
- When an event arrives, an idempotent row is inserted into `public.billing_events` with `processed_at IS NULL`.
- If an edge function crashes or errors during event execution, the webhook handler explicitly deletes the uncompleted `billing_events` row (`DELETE FROM billing_events WHERE event_id = ...`) before returning an HTTP error. This allows Stripe to retry delivery without triggering duplicate suppression.
- **Critical Operational Point:** Catastrophic failures where processing failed will not remain as unprocessed rows in `billing_events`. For failed deliveries where Stripe has exhausted retries or is currently retrying, always inspect:
  - **Stripe Dashboard > Developers > Webhooks > [Endpoint URL] > Failed deliveries**
- Rows in `public.billing_events` with `processed_at IS NULL` older than 10 minutes indicate edge function aborts, timeouts, or unhandled termination before cleanup.

### Query 5A: Stale Unprocessed Events (>10 Minutes)
```sql
SELECT
  event_id,
  type,
  user_id,
  customer_id,
  received_at,
  ROUND(EXTRACT(EPOCH FROM (now() - received_at)) / 60, 1) AS age_minutes
FROM public.billing_events
WHERE processed_at IS NULL
  AND received_at < now() - interval '10 minutes'
ORDER BY received_at ASC
LIMIT 50;
```

### Query 5B: Recent Webhook Ingestion Volume by Type (Last 7 Days)
```sql
SELECT
  type,
  COUNT(*) AS total_events,
  COUNT(*) FILTER (WHERE processed_at IS NOT NULL) AS processed,
  COUNT(*) FILTER (WHERE processed_at IS NULL) AS unprocessed,
  MIN(received_at) AS first_received_at,
  MAX(received_at) AS last_received_at
FROM public.billing_events
WHERE received_at >= now() - interval '7 days'
GROUP BY type
ORDER BY total_events DESC;
```

---

## 6. Discrepancy Detection: Billing Customer Without Active Plan

### Purpose
Finds user accounts that possess a Stripe customer identifier (`billing_customer_id IS NOT NULL`) but do not have an active paid plan in `public.users` (`plan IS NULL OR plan = 'free' OR paid_until IS NULL OR paid_until <= now()`).

### Diagnostic Interpretation
1. **Abandoned Checkout (Benign):** `total_billing_events = 0`. The user initiated Stripe Checkout (assigning a customer ID), but closed the tab or cancelled prior to payment completion. No payment occurred.
2. **Missed or Failed Webhook (Actionable):** `total_billing_events > 0` with recent `invoice.paid` events in Stripe Dashboard. The webhook delivery may have failed or timed out. Replay the webhook from the Stripe Dashboard.
3. **Lapsed / Cancelled Subscription (Expected):** User previously had an active subscription, but the billing period elapsed or the subscription was terminated.

### Query
```sql
SELECT
  u.id AS user_id,
  u.billing_customer_id,
  u.plan,
  u.paid_until,
  u.created_at,
  COUNT(be.event_id) AS total_billing_events,
  MAX(be.received_at) AS latest_event_received_at
FROM public.users u
LEFT JOIN public.billing_events be
  ON be.user_id = u.id OR be.customer_id = u.billing_customer_id
WHERE u.billing_customer_id IS NOT NULL
  AND (u.plan IS NULL OR u.plan = 'free' OR u.paid_until IS NULL OR u.paid_until <= now())
GROUP BY u.id, u.billing_customer_id, u.plan, u.paid_until, u.created_at
ORDER BY u.created_at DESC
LIMIT 50;
```
