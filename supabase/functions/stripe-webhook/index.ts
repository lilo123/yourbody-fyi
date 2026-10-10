import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17.7.0";
import {
  getStripeConfig,
  LiveKeyRefusedError,
  createBillingErrorResponse,
} from "../_shared/stripeConfig.ts";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const customerId: string | null =
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

  // Handle specific event types
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const sessionCustId =
        typeof session.customer === "string" ? session.customer : session.customer?.id;
      const clientRefId = session.client_reference_id;

      if (clientRefId && sessionCustId) {
        await serviceClient
          .from("users")
          .update({ billing_customer_id: sessionCustId })
          .eq("id", clientRefId);
        resolvedUserId = clientRefId;
      }
      break;
    }

    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const invCustId =
        typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;

      let targetUserId: string | null = null;
      if (invCustId) {
        const { data: userRow } = await serviceClient
          .from("users")
          .select("id")
          .eq("billing_customer_id", invCustId)
          .maybeSingle();
        if (userRow?.id) {
          targetUserId = userRow.id;
        }
      }

      if (!targetUserId) {
        const subUserId =
          (invoice.subscription_details?.metadata as any)?.user_id ||
          (invoice.metadata as any)?.user_id;
        if (subUserId && UUID_REGEX.test(subUserId)) {
          targetUserId = subUserId;
        }
      }

      let plan: "basic" | "pro" | null = null;
      let linePeriodEnd: number | null = null;

      const lines = invoice.lines?.data || [];
      for (const line of lines) {
        const priceId = line.price?.id;
        if (config.stripePriceBasic && priceId === config.stripePriceBasic) {
          plan = "basic";
        } else if (config.stripePricePro && priceId === config.stripePricePro) {
          plan = "pro";
        }
        if (line.period?.end != null) {
          linePeriodEnd = line.period.end;
        }
      }

      if (linePeriodEnd == null && (invoice as any).period_end != null) {
        linePeriodEnd = (invoice as any).period_end;
      }

      if (targetUserId) {
        const updates: Record<string, unknown> = {};
        if (plan) {
          updates.plan = plan;
        }
        if (linePeriodEnd != null) {
          updates.paid_until = new Date(linePeriodEnd * 1000).toISOString();
        }
        if (Object.keys(updates).length > 0) {
          await serviceClient
            .from("users")
            .update(updates)
            .eq("id", targetUserId);
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
      const refundCustId =
        typeof charge.customer === "string" ? charge.customer : charge.customer?.id;

      if (refundCustId) {
        await serviceClient
          .from("users")
          .update({ paid_until: new Date().toISOString() })
          .eq("billing_customer_id", refundCustId);
      }
      break;
    }

    default: {
      // Unknown event types -> 200 {ignored:true}
      await serviceClient
        .from("billing_events")
        .update({
          processed_at: new Date().toISOString(),
          ...(resolvedUserId ? { user_id: resolvedUserId } : {}),
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

  // Set processed_at after success for handled events
  await serviceClient
    .from("billing_events")
    .update({
      processed_at: new Date().toISOString(),
      ...(resolvedUserId ? { user_id: resolvedUserId } : {}),
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
