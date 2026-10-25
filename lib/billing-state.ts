import type Stripe from "stripe";

type PeriodItem = { price?: { id?: string } | null };
type PeriodField = 'current_period_start' | 'current_period_end';
type PlanItem = (items: PeriodItem[]) => PeriodItem | undefined;

// Typed like the removed field, which was also absent at runtime when Stripe omitted it.
function subscriptionPeriod(subscription: object, field: PeriodField, planItem?: PlanItem): number {
  const legacy: unknown = Reflect.get(subscription, field);
  if (typeof legacy === 'number') return legacy;
  const list: unknown = Reflect.get(subscription, 'items');
  const data: unknown = list && typeof list === 'object' ? Reflect.get(list, 'data') : undefined;
  const items = (Array.isArray(data) ? data : []).filter(
    (item): item is PeriodItem => typeof item === 'object' && item !== null,
  );
  const periods = new Set(items.map((item) => Reflect.get(item, field)));
  const chosen = periods.size === 1 ? items[0] : planItem?.(items);
  const value: unknown = chosen ? Reflect.get(chosen, field) : undefined;
  return (typeof value === 'number' ? value : undefined) as number;
}

function getSubscriptionPeriodEnd(subscription: object, planItem?: PlanItem): number {
  return subscriptionPeriod(subscription, 'current_period_end', planItem);
}

export type BillingSnapshot = {
  plan_id: string | null;
  plan_tier: "free" | "pro" | "business";
  subscription_id: string | null;
  subscription_status: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

export function billingSnapshot(
  subscriptions: Stripe.Subscription[],
  prices: { pro?: string; business?: string },
  now = Date.now(),
): BillingSnapshot {
  const tier = (subscription: Stripe.Subscription) => {
    const priceId = subscription.items.data[0]?.price.id;
    return priceId && priceId === prices.business ? "business" :
      priceId && priceId === prices.pro ? "pro" : "free";
  };
  const entitled = subscriptions.filter(subscription =>
    ["active", "trialing"].includes(subscription.status) &&
    (getSubscriptionPeriodEnd(subscription, (items) => items[0])) * 1000 > now && tier(subscription) !== "free",
  );
  // An old canceled subscription must not hide a newer active subscription.
  entitled.sort((a, b) => Number(tier(b) === "business") - Number(tier(a) === "business") || b.created - a.created);
  const subscription = entitled[0] ?? [...subscriptions].sort((a, b) => b.created - a.created)[0];
  const hasAccess = entitled.length > 0;
  const product = subscription?.items.data[0]?.price.product;
  const periodEnd = subscription ? getSubscriptionPeriodEnd(subscription) : undefined;
  return {
    plan_id: hasAccess && product ? (typeof product === "string" ? product : product.id) : null,
    plan_tier: hasAccess ? tier(subscription) : "free",
    subscription_id: subscription?.id ?? null,
    subscription_status: subscription?.status ?? null,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancel_at_period_end: subscription?.cancel_at_period_end ?? false,
  };
}
