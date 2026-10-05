/**
 * What a plan row is allowed to say.
 *
 * Shared by the form (which blocks a submit that cannot work) and the action
 * (which enforces it, because a Server Action is a POST endpoint reachable
 * without this UI). Deliberately NOT in actions.ts: a "use server" module may
 * only export async functions, so a constant living there would not compile —
 * the same reason payments/message.ts exists.
 *
 * Both sides importing one definition is the point. A regex copied into the
 * client drifts from the one on the server, and the failure mode is a form
 * that happily submits a value the action then rejects.
 */

/**
 * A lowercase word, as `users.plan_period` already holds — "monthly",
 * "yearly".
 *
 * Callers normalise case before testing rather than accepting both: `period`
 * is the primary key and `users.plan_period` is matched against it as plain
 * text, so "Monthly" and "monthly" would be two plans that look like one,
 * with subscribers split between them by whichever casing was written first.
 */
export const PERIOD_PATTERN = /^[a-z][a-z0-9_]{2,31}$/;

/**
 * Two names a plan cannot take.
 *
 *   "free"    — the sentinel `users.plan` uses for *no* subscription. The
 *               dashboard spends real effort distinguishing a free user from a
 *               lapsed one (see `premiumState`); a plan called free would
 *               reintroduce that confusion in the table meant to settle it.
 *   "unknown" — `countActiveByPeriod` files subscribers whose `plan_period`
 *               is null under this key, so a plan named "unknown" would merge
 *               its own subscriber count with everyone whose plan is missing.
 */
export const RESERVED_PERIODS = ["free", "unknown"] as const;

/** No plan this product sells costs more; a larger figure is a typo. */
export const MAX_AMOUNT = 1_000_000;

export function isReservedPeriod(period: string): boolean {
  return (RESERVED_PERIODS as readonly string[]).includes(period);
}

/**
 * Prices are whole taka.
 *
 * `amount` is `numeric`, so Postgres would take ৳332.50 happily. Two things
 * downstream would not: `formatBdt` renders no decimals, so the dashboard
 * would show ৳333 while the stored price was ৳332.50, and a claim is settled
 * by comparing the amount paid to this one exactly. An operator reconciling
 * that rejection against what the screen told them would be chasing a
 * 50-poisha difference the UI had hidden.
 */
export function isWholeTaka(amount: number): boolean {
  return Number.isInteger(amount);
}
