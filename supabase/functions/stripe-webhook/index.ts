import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17.7.0";
import {
  getStripeConfig,
  LiveKeyRefusedError,
  createBillingErrorResponse,
  validatePriceMode,
} from "../_shared/stripeConfig.ts";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function shouldKeepAccess(
  charge: Stripe.Charge,
  stripe: Stripe,
): Promise<boolean> {
  // 1. Charge's own metadata
  if (charge.metadata?.keep_access === "true") {
    return true;
  }

  // 2. Refunds of this charge when present in the event
  if (Array.isArray(charge.refunds?.data)) {
    const hasRefundKeepAccess = charge.refunds.data.some(
      (refund: Stripe.Refund) => refund.metadata?.keep_access === "true",
    );
    if (hasRefundKeepAccess) {
      return true;
    }
  }

  // 3. PaymentIntent's metadata: fetch when charge.payment_intent is a string id
  if (charge.payment_intent) {
    if (typeof charge.payment_intent === "string") {
      const paymentIntent = await stripe.paymentIntents.retrieve(charge.payment_intent);
      if (paymentIntent.metadata?.keep_access === "true") {
        return true;
      }
    } else if (typeof charge.payment_intent === "object") {
      const paymentIntent = charge.payment_intent as Stripe.PaymentIntent;
      if (paymentIntent.metadata?.keep_access === "true") {
        return true;
      }
    }
  }

  // 4. Otherwise list refunds via Stripe API GET /v1/refunds?charge=<id>&limit=100
  if (!Array.isArray(charge.refunds?.data) && charge.id) {
    const refundsList = await stripe.refunds.list({
      charge: charge.id,
      limit: 100,
    });
    const hasRefundKeepAccess = refundsList.data?.some(
      (refund: Stripe.Refund) => refund.metadata?.keep_access === "true",
    );
    if (hasRefundKeepAccess) {
      return true;
    }
  }

  return false;
}

async function revokeAccessForCustomer(
  serviceClient: any,
  customerId: string,
): Promise<string | null> {
  const { data: userRow, error: selectError } = await serviceClient
    .from("users")
    .select("id, paid_until")
    .eq("billing_customer_id", customerId)
    .maybeSingle();

  if (selectError) {
    throw new Error(
      `Failed to query user by billing_customer_id: ${selectError.message}`,
    );
  }

  const nowIso = new Date().toISOString();
  let targetPaidUntil = nowIso;
  if (userRow?.paid_until) {
    const currentPaidUntilTs = new Date(userRow.paid_until).getTime();
    if (currentPaidUntilTs < new Date(nowIso).getTime()) {
      targetPaidUntil = userRow.paid_until;
    }
  }

  const { error: updateError } = await serviceClient
    .from("users")
    .update({ paid_until: targetPaidUntil })
    .eq("billing_customer_id", customerId);

  if (updateError) {
    throw new Error(
      `Failed to update paid_until for customer: ${updateError.message}`,
    );
  }

  return userRow?.id || null;
}

function resolvePriceIdFromLine(line: any): string | null {
  if (!line || typeof line !== "object") {
    return null;
  }

  // 1. line.pricing?.price_details?.price (string or object with id)
  const pricingPrice = line.pricing?.price_details?.price;
  if (typeof pricingPrice === "string" && pricingPrice.length > 0) {
    return pricingPrice;
  }
  if (
    pricingPrice &&
    typeof pricingPrice === "object" &&
    typeof pricingPrice.id === "string" &&
    pricingPrice.id.length > 0
  ) {
    return pricingPrice.id;
  }

  // 2. line.price?.id (or string line.price)
  const linePrice = line.price;
  if (typeof linePrice === "string" && linePrice.length > 0) {
    return linePrice;
  }
  if (
    linePrice &&
    typeof linePrice === "object" &&
    typeof linePrice.id === "string" &&
    linePrice.id.length > 0
  ) {
    return linePrice.id;
  }

  return null;
}

function resolveSubscriptionId(invoice: any, lines: any[]): string | null {
  if (!invoice || typeof invoice !== "object") {
    return null;
  }

  // 1. invoice.parent?.subscription_details?.subscription
  const parentSub = invoice.parent?.subscription_details?.subscription;
  if (typeof parentSub === "string" && parentSub.length > 0) {
    return parentSub;
  }
  if (
    parentSub &&
    typeof parentSub === "object" &&
    typeof parentSub.id === "string" &&
    parentSub.id.length > 0
  ) {
    return parentSub.id;
  }

  // 2. line.parent?.subscription_item_details
  for (const line of lines) {
    const itemDetails = line?.parent?.subscription_item_details;
    if (typeof itemDetails === "string" && itemDetails.startsWith("sub_")) {
      return itemDetails;
    }
    const lineSub = itemDetails?.subscription;
    if (typeof lineSub === "string" && lineSub.length > 0) {
      return lineSub;
    }
    if (
      lineSub &&
      typeof lineSub === "object" &&
      typeof lineSub.id === "string" &&
      lineSub.id.length > 0
    ) {
      return lineSub.id;
    }
  }

  // 3. invoice.subscription
  const invSub = invoice.subscription;
  if (typeof invSub === "string" && invSub.length > 0) {
    return invSub;
  }
  if (
    invSub &&
    typeof invSub === "object" &&
    typeof invSub.id === "string" &&
    invSub.id.length > 0
  ) {
    return invSub.id;
  }

  return null;
}

function collectPaymentTargets(
  inv: any,
  chargeIds: Set<string>,
  paymentIntentIds: Set<string>,
  directCharges: Stripe.Charge[],
): void {
  if (!inv || typeof inv !== "object") {
    return;
  }

  if (typeof inv.charge === "string" && inv.charge.length > 0) {
    chargeIds.add(inv.charge);
  } else if (inv.charge && typeof inv.charge === "object") {
    directCharges.push(inv.charge as Stripe.Charge);
  }

  if (typeof inv.payment_intent === "string" && inv.payment_intent.length > 0) {
    paymentIntentIds.add(inv.payment_intent);
  } else if (inv.payment_intent && typeof inv.payment_intent === "object") {
    const intent = inv.payment_intent;
    if (typeof intent.latest_charge === "string" && intent.latest_charge.length > 0) {
      chargeIds.add(intent.latest_charge);
    } else if (intent.latest_charge && typeof intent.latest_charge === "object") {
      directCharges.push(intent.latest_charge as Stripe.Charge);
    } else if (typeof intent.id === "string" && intent.id.length > 0) {
      paymentIntentIds.add(intent.id);
    }
  }

  if (Array.isArray(inv.payments?.data)) {
    for (const item of inv.payments.data) {
      const paymentItem = item?.payment;
      if (paymentItem && typeof paymentItem === "object") {
        if (paymentItem.type === "payment_intent" || paymentItem.payment_intent) {
          const piTarget = paymentItem.payment_intent;
          if (typeof piTarget === "string" && piTarget.length > 0) {
            paymentIntentIds.add(piTarget);
          } else if (piTarget && typeof piTarget === "object") {
            if (typeof piTarget.latest_charge === "string" && piTarget.latest_charge.length > 0) {
              chargeIds.add(piTarget.latest_charge);
            } else if (piTarget.latest_charge && typeof piTarget.latest_charge === "object") {
              directCharges.push(piTarget.latest_charge as Stripe.Charge);
            } else if (typeof piTarget.id === "string" && piTarget.id.length > 0) {
              paymentIntentIds.add(piTarget.id);
            }
          }
        } else if (paymentItem.type === "charge" || paymentItem.charge) {
          const chTarget = paymentItem.charge;
          if (typeof chTarget === "string" && chTarget.length > 0) {
            chargeIds.add(chTarget);
          } else if (chTarget && typeof chTarget === "object") {
            directCharges.push(chTarget as Stripe.Charge);
          }
        }
      }

      if (typeof item?.charge === "string" && item.charge.length > 0) {
        chargeIds.add(item.charge);
      } else if (item?.charge && typeof item.charge === "object") {
        directCharges.push(item.charge as Stripe.Charge);
      }
    }
  }
}

async function resolveChargesForInvoice(
  invoice: any,
  stripe: Stripe,
): Promise<Stripe.Charge[]> {
  const directCharges: Stripe.Charge[] = [];
  const chargeIds = new Set<string>();
  const paymentIntentIds = new Set<string>();

  collectPaymentTargets(invoice, chargeIds, paymentIntentIds, directCharges);

  if (
    directCharges.length === 0 &&
    chargeIds.size === 0 &&
    paymentIntentIds.size === 0 &&
    invoice?.id
  ) {
    const retrievedInvoice = await stripe.invoices.retrieve(invoice.id, {
      expand: ["payments.data.payment.payment_intent"],
    });
    collectPaymentTargets(retrievedInvoice, chargeIds, paymentIntentIds, directCharges);
  }

  for (const intentId of paymentIntentIds) {
    const paymentIntent = await stripe.paymentIntents.retrieve(intentId);
    if (
      typeof paymentIntent.latest_charge === "string" &&
      paymentIntent.latest_charge.length > 0
    ) {
      chargeIds.add(paymentIntent.latest_charge);
    } else if (
      paymentIntent.latest_charge &&
      typeof paymentIntent.latest_charge === "object"
    ) {
      directCharges.push(paymentIntent.latest_charge as Stripe.Charge);
    }
  }

  const resolvedCharges: Stripe.Charge[] = [...directCharges];

  for (const targetChargeId of chargeIds) {
    const alreadyResolved = resolvedCharges.some(
      (existing) => existing.id === targetChargeId,
    );
    if (!alreadyResolved) {
      const fetchedCharge = await stripe.charges.retrieve(targetChargeId);
      resolvedCharges.push(fetchedCharge);
    }
  }

  return resolvedCharges;
}

export type CoachTier = "free" | "pro" | "enterprise";

export interface ResolvedPlanTier {
  plan: "basic" | "pro";
  coach_tier: CoachTier;
}

export function resolvePlanFromLookupKey(lookupKey?: string | null): ResolvedPlanTier | null {
  if (!lookupKey) {
    return null;
  }
  if (lookupKey.startsWith("coach_pro_") || lookupKey === "coach_pro") {
    return { plan: "pro", coach_tier: "enterprise" };
  }
  if (lookupKey === "coach_monthly" || lookupKey === "coach_yearly" || lookupKey === "coach") {
    return { plan: "pro", coach_tier: "pro" };
  }
  if (lookupKey.startsWith("personal_") || lookupKey === "personal") {
    return { plan: "basic", coach_tier: "free" };
  }
  return null;
}

async function resolvePlanAndTierFromLine(
  line: any,
  config: { stripe: Stripe; isLive: boolean; stripePriceBasic: string | null; stripePricePro: string | null },
): Promise<ResolvedPlanTier | null> {
  if (!line || typeof line !== "object") {
    return null;
  }

  // 1. Direct lookup key on line if present
  const directLookupKey =
    line.price?.lookup_key ||
    line.pricing?.price_details?.price?.lookup_key ||
    line.pricing?.price_details?.lookup_key;
  if (directLookupKey) {
    const fromDirect = resolvePlanFromLookupKey(directLookupKey);
    if (fromDirect) {
      if (line.price?.livemode !== undefined && !validatePriceMode(line.price, config.isLive)) {
        return null;
      }
      return fromDirect;
    }
  }

  const priceId = resolvePriceIdFromLine(line);
  if (!priceId) {
    return null;
  }

  // 2. If line has only a price id, retrieve price (GET /v1/prices/{id}) for its lookup_key
  try {
    const priceObj = await config.stripe.prices.retrieve(priceId);
    if (priceObj) {
      if (!validatePriceMode(priceObj, config.isLive)) {
        return null;
      }
      if (priceObj.lookup_key) {
        const fromRetrieved = resolvePlanFromLookupKey(priceObj.lookup_key);
        if (fromRetrieved) {
          return fromRetrieved;
        }
      }
    }
  } catch (_err) {
    // If Stripe price retrieve fails (e.g. mock test environment or network error), proceed to fallback by ID
  }

  // 3. Fallback by ID: STRIPE_PRICE_BASIC -> (basic, free), STRIPE_PRICE_PRO -> (pro, pro)
  if (config.stripePriceBasic && priceId === config.stripePriceBasic) {
    return { plan: "basic", coach_tier: "free" };
  }
  if (config.stripePricePro && priceId === config.stripePricePro) {
    return { plan: "pro", coach_tier: "pro" };
  }

  return null;
}

export interface EntitlementResolutionInput {
  currentPlan?: string | null;
  incomingPlan: "basic" | "pro";
  currentPaidUntil?: string | null;
  incomingPaidUntil?: string | null;
  currentCoachTier?: string | null;
  incomingCoachTier?: string | null;
  isGrandfatherActive: boolean;
}

export interface EntitlementResolutionResult {
  plan: "basic" | "pro";
  paid_until: string | null;
  coach_tier?: string | null;
}

export function resolveGrandfatherAwareEntitlements(
  input: EntitlementResolutionInput,
): EntitlementResolutionResult {
  const {
    currentPlan,
    incomingPlan,
    currentPaidUntil,
    incomingPaidUntil,
    currentCoachTier,
    incomingCoachTier,
    isGrandfatherActive,
  } = input;

  if (!isGrandfatherActive) {
    return {
      plan: incomingPlan,
      paid_until: incomingPaidUntil || currentPaidUntil || null,
      ...(incomingCoachTier !== undefined ? { coach_tier: incomingCoachTier } : {}),
    };
  }

  // Grandfather grant is active:
  // 1. Keep higher plan ('pro' > 'basic' > 'free')
  const planRank: Record<string, number> = { pro: 2, basic: 1, free: 0 };
  const currentPlanRank = currentPlan ? (planRank[currentPlan] ?? 0) : 0;
  const incomingPlanRank = planRank[incomingPlan] ?? 0;
  const effectivePlan =
    currentPlanRank > incomingPlanRank
      ? (currentPlan as "basic" | "pro")
      : incomingPlan;

  // 2. paid_until = greatest(current paid_until, period end)
  let effectivePaidUntil = incomingPaidUntil || currentPaidUntil || null;
  if (currentPaidUntil && incomingPaidUntil) {
    const currentTs = new Date(currentPaidUntil).getTime();
    const incomingTs = new Date(incomingPaidUntil).getTime();
    if (!isNaN(currentTs) && !isNaN(incomingTs)) {
      effectivePaidUntil = currentTs > incomingTs ? currentPaidUntil : incomingPaidUntil;
    }
  }

  // 3. Extensible coach_tier resolution (enterprise > pro > free) for subsequent tiers PR
  let effectiveCoachTier = incomingCoachTier;
  if (currentCoachTier !== undefined || incomingCoachTier !== undefined) {
    const coachTierRank: Record<string, number> = { enterprise: 2, pro: 1, free: 0 };
    const currentTierRank = currentCoachTier ? (coachTierRank[currentCoachTier] ?? 0) : 0;
    const incomingTierRank = incomingCoachTier ? (coachTierRank[incomingCoachTier] ?? 0) : 0;
    effectiveCoachTier = currentTierRank > incomingTierRank ? currentCoachTier : incomingCoachTier;
  }

  return {
    plan: effectivePlan,
    paid_until: effectivePaidUntil,
    ...(effectiveCoachTier !== undefined ? { coach_tier: effectiveCoachTier } : {}),
  };
}

async function cancelSubscriptionForChargeOrCustomer(
  charge: Stripe.Charge | null,
  customerId: string | null,
  stripe: Stripe,
): Promise<string | null> {
  let subscriptionId: string | null = null;

  // In Stripe API version 2026-09-30, charge.invoice is removed.
  // We resolve the subscription via charge -> payment_intent -> invoice -> parent.subscription_details.subscription.
  // If the charge was not linked to an invoice (or resolution fails), we fall back to querying the
  // customer's subscriptions for an active/trialing/past_due/unpaid subscription, since the application
  // enforces a strict 1:1 invariant of at most one subscription per user.
  // If no subscription exists, this was a one-off payment and we succeed as a no-op.
  if (charge) {
    let paymentIntentId: string | null = null;
    if (typeof charge.payment_intent === "string" && charge.payment_intent.length > 0) {
      paymentIntentId = charge.payment_intent;
    } else if (charge.payment_intent && typeof charge.payment_intent === "object") {
      paymentIntentId = (charge.payment_intent as any).id || null;
    }

    let invoiceId: string | null = null;
    if (paymentIntentId) {
      try {
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        if (typeof paymentIntent.invoice === "string" && paymentIntent.invoice.length > 0) {
          invoiceId = paymentIntent.invoice;
        } else if (paymentIntent.invoice && typeof paymentIntent.invoice === "object") {
          invoiceId = (paymentIntent.invoice as any).id || null;
        }
      } catch (err: any) {
        const isMissing =
          err?.code === "resource_missing" ||
          err?.statusCode === 404 ||
          err?.raw?.statusCode === 404 ||
          err?.raw?.code === "resource_missing";
        if (!isMissing) {
          throw err;
        }
      }
    }

    if (!invoiceId && (charge as any).invoice) {
      if (typeof (charge as any).invoice === "string") {
        invoiceId = (charge as any).invoice;
      } else if (typeof (charge as any).invoice === "object") {
        invoiceId = (charge as any).invoice.id || null;
      }
    }

    if (invoiceId) {
      try {
        const invoice = await stripe.invoices.retrieve(invoiceId);
        const parentSub = (invoice as any).parent?.subscription_details?.subscription;
        if (typeof parentSub === "string" && parentSub.length > 0) {
          subscriptionId = parentSub;
        } else if (parentSub && typeof parentSub === "object" && typeof parentSub.id === "string") {
          subscriptionId = parentSub.id;
        }

        if (!subscriptionId) {
          const invSub = (invoice as any).subscription;
          if (typeof invSub === "string" && invSub.length > 0) {
            subscriptionId = invSub;
          } else if (invSub && typeof invSub === "object" && typeof invSub.id === "string") {
            subscriptionId = invSub.id;
          }
        }
      } catch (err: any) {
        const isMissing =
          err?.code === "resource_missing" ||
          err?.statusCode === 404 ||
          err?.raw?.statusCode === 404 ||
          err?.raw?.code === "resource_missing";
        if (!isMissing) {
          throw err;
        }
      }
    }
  }

  const resolvedCustomerId =
    customerId ||
    (typeof charge?.customer === "string" ? charge.customer : (charge?.customer as any)?.id) ||
    null;

  if (!subscriptionId && resolvedCustomerId) {
    const subsList = await stripe.subscriptions.list({
      customer: resolvedCustomerId,
      status: "all",
      limit: 10,
    });
    const candidate = subsList.data?.find((s: Stripe.Subscription) =>
      ["active", "trialing", "past_due", "unpaid"].includes(s.status),
    );
    if (candidate?.id) {
      subscriptionId = candidate.id;
    }
  }

  if (!subscriptionId) {
    return null;
  }

  try {
    await stripe.subscriptions.cancel(subscriptionId, {
      prorate: false,
      invoice_now: false,
    });
  } catch (err: any) {
    const isResourceMissing =
      err?.code === "resource_missing" ||
      err?.statusCode === 404 ||
      err?.raw?.statusCode === 404 ||
      err?.raw?.code === "resource_missing";
    const isAlreadyCanceled =
      err?.message?.toLowerCase().includes("already canceled") ||
      err?.raw?.message?.toLowerCase().includes("already canceled");

    if (isResourceMissing || isAlreadyCanceled) {
      return subscriptionId;
    }

    throw err;
  }

  return subscriptionId;
}

export function extractMinimalPayload(event: Stripe.Event): Record<string, unknown> {
  const obj = event.data?.object as any;
  const minimal: Record<string, unknown> = {
    id: obj?.id,
    object: obj?.object,
  };

  if (obj?.amount != null) minimal.amount = obj.amount;
  if (obj?.amount_paid != null) minimal.amount_paid = obj.amount_paid;
  if (obj?.amount_refunded != null) minimal.amount_refunded = obj.amount_refunded;
  if (obj?.currency != null) minimal.currency = obj.currency;
  if (obj?.status != null) minimal.status = obj.status;

  if (obj?.charge != null) {
    minimal.charge = typeof obj.charge === "string" ? obj.charge : obj.charge?.id;
  }

  if (obj?.current_period_end != null) minimal.current_period_end = obj.current_period_end;
  if (obj?.period_end != null) minimal.period_end = obj.period_end;
  if (obj?.lines?.data?.[0]?.period?.end != null) {
    minimal.line_period_end = obj.lines.data[0].period.end;
  }

  if (obj?.customer != null) {
    minimal.customer = typeof obj.customer === "string" ? obj.customer : obj.customer?.id;
  }
  if (obj?.subscription != null) {
    minimal.subscription = typeof obj.subscription === "string" ? obj.subscription : obj.subscription?.id;
  }
  if (obj?.client_reference_id != null) {
    minimal.client_reference_id = obj.client_reference_id;
  }

  return minimal;
}

export async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // Validate Stripe configuration & refuse live keys
  let config;
  try {
    const resolved = getStripeConfig();
    if (!resolved) {
      return createBillingErrorResponse("billing_not_configured");
    }
    config = resolved;
  } catch (err) {
    if (err instanceof LiveKeyRefusedError || (err as any)?.code === "live_keys_refused") {
      return createBillingErrorResponse("live_keys_refused");
    }
    throw err;
  }

  if (!config.stripeWebhookSecret) {
    return createBillingErrorResponse("billing_not_configured");
  }

  // Verify Stripe-Signature header
  const signature = req.headers.get("Stripe-Signature") || req.headers.get("stripe-signature");
  if (!signature) {
    return new Response(
      JSON.stringify({ error: "Invalid signature" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const rawBody = await req.text();
  const cryptoProvider = Stripe.createSubtleCryptoProvider();
  let event: Stripe.Event;

  try {
    event = await config.stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      config.stripeWebhookSecret,
      undefined,
      cryptoProvider,
    );
  } catch (_verifyErr) {
    return new Response(
      JSON.stringify({ error: "Invalid signature" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // Webhook mode check: event.livemode must match key mode (config.isLive)
  if (Boolean(event.livemode) !== config.isLive) {
    console.warn(
      `[stripe-webhook] Event livemode (${event.livemode}) does not match key livemode (${config.isLive}); ignoring event ${event.id}`,
    );
    return new Response(
      JSON.stringify({ ignored: true }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: "Database configuration missing" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  const eventObj = event.data?.object as any;
  let customerId: string | null =
    typeof eventObj?.customer === "string"
      ? eventObj.customer
      : eventObj?.customer?.id || null;

  let potentialUserId: string | null = null;
  if (eventObj?.client_reference_id) {
    potentialUserId = eventObj.client_reference_id;
  } else if (eventObj?.metadata?.user_id) {
    potentialUserId = eventObj.metadata.user_id;
  } else if (eventObj?.subscription_details?.metadata?.user_id) {
    potentialUserId = eventObj.subscription_details.metadata.user_id;
  }

  let resolvedUserId: string | null = null;
  if (potentialUserId && UUID_REGEX.test(potentialUserId)) {
    resolvedUserId = potentialUserId;
  }

  if (!resolvedUserId && customerId) {
    const { data: userByCust } = await serviceClient
      .from("users")
      .select("id")
      .eq("billing_customer_id", customerId)
      .maybeSingle();
    if (userByCust?.id) {
      resolvedUserId = userByCust.id;
    }
  }

  const minimalPayload = extractMinimalPayload(event);

  // Idempotent insertion into billing_events: ON CONFLICT (event_id) DO NOTHING
  const { data: insertedRows, error: insertError } = await serviceClient
    .from("billing_events")
    .upsert(
      {
        event_id: event.id,
        type: event.type,
        customer_id: customerId,
        user_id: resolvedUserId,
        payload: minimalPayload,
      },
      { onConflict: "event_id", ignoreDuplicates: true },
    )
    .select("event_id");

  // If already processed or conflict occurred, return 200 duplicate without side effects
  if (
    insertError?.code === "23505" ||
    insertError?.message?.includes("duplicate") ||
    (!insertError && (!insertedRows || insertedRows.length === 0))
  ) {
    return new Response(
      JSON.stringify({ duplicate: true }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  if (insertError) {
    console.error("[stripe-webhook] Error inserting billing_event:", insertError.message);
    return new Response(
      JSON.stringify({ error: "Failed to record event" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // Handle specific event types inside try-catch to guarantee failure safety on Stripe API lookups
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const sessionCustId =
          typeof session.customer === "string" ? session.customer : session.customer?.id;
        const clientRefId = session.client_reference_id;

        if (clientRefId && sessionCustId) {
          const { error: updateError } = await serviceClient
            .from("users")
            .update({ billing_customer_id: sessionCustId })
            .eq("id", clientRefId);
          if (updateError) {
            throw new Error(
              `Failed to update billing_customer_id for user: ${updateError.message}`,
            );
          }
          resolvedUserId = clientRefId;
        }
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const invCustId =
          typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;

        let targetUserId: string | null = null;
        let currentUserRow: { id: string; plan?: string | null; paid_until?: string | null; coach_tier?: string | null } | null = null;
        if (invCustId) {
          const { data: userRow, error: selectError } = await serviceClient
            .from("users")
            .select("id, plan, paid_until, coach_tier")
            .eq("billing_customer_id", invCustId)
            .maybeSingle();
          if (selectError) {
            throw new Error(
              `Failed to query user by billing_customer_id: ${selectError.message}`,
            );
          }
          if (userRow?.id) {
            targetUserId = userRow.id;
            currentUserRow = userRow;
          }
        }

        if (!targetUserId) {
          const subUserId =
            (invoice.subscription_details?.metadata as any)?.user_id ||
            ((invoice as any).parent?.subscription_details?.metadata as any)?.user_id ||
            (invoice.metadata as any)?.user_id;
          if (subUserId && UUID_REGEX.test(subUserId)) {
            targetUserId = subUserId;
          }
        }

        if (targetUserId && !currentUserRow) {
          const { data: userRow, error: selectError } = await serviceClient
            .from("users")
            .select("id, plan, paid_until, coach_tier")
            .eq("id", targetUserId)
            .maybeSingle();
          if (selectError) {
            throw new Error(
              `Failed to query user by id: ${selectError.message}`,
            );
          }
          if (userRow) {
            currentUserRow = userRow;
          }
        }

        let resolvedPlanTier: ResolvedPlanTier | null = null;
        let linePeriodEnd: number | null = null;

        const lines = invoice.lines?.data || [];
        for (const line of lines) {
          const resolved = await resolvePlanAndTierFromLine(line, config);
          if (resolved) {
            resolvedPlanTier = resolved;
          }
          if (line.period?.end != null) {
            linePeriodEnd = line.period.end;
          }
        }

        // If plan is still unknown, attempt subscription item price resolution
        if (!resolvedPlanTier) {
          const subId = resolveSubscriptionId(invoice, lines);
          if (subId) {
            const subscription = await config.stripe.subscriptions.retrieve(subId);
            const subItems = subscription?.items?.data || [];
            for (const item of subItems) {
              const resolved = await resolvePlanAndTierFromLine(item, config);
              if (resolved) {
                resolvedPlanTier = resolved;
                break;
              }
            }
          }
        }

        if (linePeriodEnd == null && (invoice as any).period_end != null) {
          linePeriodEnd = (invoice as any).period_end;
        }

        // If plan cannot be resolved, leave user unchanged and log warning
        if (!resolvedPlanTier) {
          console.warn(
            `[stripe-webhook] invoice.paid could not resolve plan for invoice ${invoice.id}; leaving user unchanged`,
          );
          if (targetUserId) {
            resolvedUserId = targetUserId;
          }
          break;
        }

        // Prevent re-grant after revocation: check if payment charge is disputed or refunded
        const charges = await resolveChargesForInvoice(invoice, config.stripe);
        let skipGrant = false;
        for (const charge of charges) {
          if (charge.disputed === true) {
            console.warn(
              `[stripe-webhook] Skipping invoice.paid grant for invoice ${invoice.id}: charge ${charge.id} is disputed`,
            );
            skipGrant = true;
            break;
          }

          const isFullRefund =
            typeof charge.amount === "number" &&
            charge.amount > 0 &&
            charge.amount_refunded === charge.amount;

          if (isFullRefund) {
            const keepAccess = await shouldKeepAccess(charge, config.stripe);
            if (!keepAccess) {
              console.warn(
                `[stripe-webhook] Skipping invoice.paid grant for invoice ${invoice.id}: charge ${charge.id} is fully refunded`,
              );
              skipGrant = true;
              break;
            }
          }
        }

        if (skipGrant) {
          if (targetUserId) {
            resolvedUserId = targetUserId;
          }
          break;
        }

        if (targetUserId) {
          // Check grandfather status in public.billing_grandfather (granted_until > now())
          let isGrandfatherActive = false;
          const { data: gfRow, error: gfError } = await serviceClient
            .from("billing_grandfather")
            .select("granted_until")
            .eq("user_id", targetUserId)
            .maybeSingle();

          if (gfError) {
            throw new Error(
              `Failed to query billing_grandfather: ${gfError.message}`,
            );
          }

          if (gfRow?.granted_until) {
            const grantedUntilTs = new Date(gfRow.granted_until).getTime();
            if (!isNaN(grantedUntilTs) && grantedUntilTs > Date.now()) {
              isGrandfatherActive = true;
            }
          }

          const incomingPaidUntilIso =
            linePeriodEnd != null ? new Date(linePeriodEnd * 1000).toISOString() : null;

          const effective = resolveGrandfatherAwareEntitlements({
            currentPlan: currentUserRow?.plan,
            incomingPlan: resolvedPlanTier.plan,
            currentPaidUntil: currentUserRow?.paid_until,
            incomingPaidUntil: incomingPaidUntilIso,
            currentCoachTier: currentUserRow?.coach_tier,
            incomingCoachTier: resolvedPlanTier.coach_tier,
            isGrandfatherActive,
          });

          const updates: Record<string, unknown> = {
            plan: effective.plan,
          };
          if (effective.paid_until != null) {
            updates.paid_until = effective.paid_until;
          }
          if (effective.coach_tier !== undefined) {
            updates.coach_tier = effective.coach_tier;
          }

          const { error: updateError } = await serviceClient
            .from("users")
            .update(updates)
            .eq("id", targetUserId);
          if (updateError) {
            throw new Error(
              `Failed to update plan and paid_until for user: ${updateError.message}`,
            );
          }
          resolvedUserId = targetUserId;
        }
        break;
      }

      case "customer.subscription.deleted": {
        // Leave paid_until as is (access until period end), no plan change
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const refundCustId: string | null =
          typeof charge.customer === "string" ? charge.customer : charge.customer?.id || null;

        const isFullRefund =
          typeof charge.amount === "number" &&
          charge.amount > 0 &&
          charge.amount_refunded === charge.amount;

        if (!isFullRefund) {
          if (charge.amount == null || charge.amount_refunded == null) {
            console.warn(
              "[stripe-webhook] charge.refunded event missing amount or amount_refunded",
            );
          }
          // Partial refund or missing amount -> no access change (event still recorded)
          break;
        }

        // Check keep_access override
        const keepAccess = await shouldKeepAccess(charge, config.stripe);
        if (keepAccess) {
          // Goodwill refund -> do not revoke access
          break;
        }

        if (refundCustId) {
          const revokedUserId = await revokeAccessForCustomer(serviceClient, refundCustId);
          if (revokedUserId) {
            resolvedUserId = revokedUserId;
          }
        }

        // Auto-cancel related subscription
        await cancelSubscriptionForChargeOrCustomer(charge, refundCustId, config.stripe);
        break;
      }

      case "charge.dispute.created": {
        const dispute = event.data.object as Stripe.Dispute;
        let disputeCustId: string | null =
          typeof (dispute as any).customer === "string"
            ? (dispute as any).customer
            : (dispute as any).customer?.id || null;

        let charge: Stripe.Charge | null = null;
        const chargeId =
          typeof dispute.charge === "string"
            ? dispute.charge
            : (dispute.charge as any)?.id;

        if (chargeId) {
          charge = await config.stripe.charges.retrieve(chargeId);
          if (!disputeCustId) {
            disputeCustId =
              typeof charge.customer === "string"
                ? charge.customer
                : charge.customer?.id || null;
          }
        } else if (typeof dispute.charge === "object" && dispute.charge !== null) {
          charge = dispute.charge as Stripe.Charge;
          if (!disputeCustId) {
            disputeCustId =
              typeof charge.customer === "string"
                ? charge.customer
                : charge.customer?.id || null;
          }
        }

        if (disputeCustId) {
          customerId = disputeCustId;
          const revokedUserId = await revokeAccessForCustomer(serviceClient, disputeCustId);
          if (revokedUserId) {
            resolvedUserId = revokedUserId;
          }
        }

        // Auto-cancel related subscription
        await cancelSubscriptionForChargeOrCustomer(charge, disputeCustId, config.stripe);
        break;
      }

      default: {
        // Unknown event types -> 200 {ignored:true}
        await serviceClient
          .from("billing_events")
          .update({
            processed_at: new Date().toISOString(),
            ...(resolvedUserId ? { user_id: resolvedUserId } : {}),
            ...(customerId ? { customer_id: customerId } : {}),
          })
          .eq("event_id", event.id);

        return new Response(
          JSON.stringify({ ignored: true }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
    }
  } catch (err) {
    console.error("[stripe-webhook] Error processing event:", err);
    // Delete uncompleted billing_events entry so Stripe retry can re-process
    await serviceClient
      .from("billing_events")
      .delete()
      .eq("event_id", event.id);

    return new Response(
      JSON.stringify({ error: "Failed to process webhook event" }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // Set processed_at after success for handled events
  await serviceClient
    .from("billing_events")
    .update({
      processed_at: new Date().toISOString(),
      ...(resolvedUserId ? { user_id: resolvedUserId } : {}),
      ...(customerId ? { customer_id: customerId } : {}),
    })
    .eq("event_id", event.id);

  return new Response(
    JSON.stringify({ received: true }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

export default {
  fetch: handler,
};
