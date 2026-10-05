import "server-only";

import {
  PG,
  REJECTION_CODES,
  describe,
  type DbError,
} from "@/lib/db/error";
import { adminDb } from "@/lib/supabase/admin";
import type { PlanRow } from "@/lib/db/types";

/** Every column the table has. `plans` is narrow enough to read whole. */
const PLAN_COLUMNS = "period,amount,duration,is_active";

export async function listPlans(): Promise<PlanRow[]> {
  const db = adminDb();
  const { data, error } = await db
    .from("plans")
    .select(PLAN_COLUMNS)
    .order("amount", { ascending: true });

  if (error) throw new Error(`listPlans: ${error.message}`);
  return (data ?? []) as PlanRow[];
}

/**
 * How many users are currently on each plan period.
 *
 * `users.plan_period` keeps its value after premium lapses, so an active
 * count has to test the expiry too — otherwise the "monthly" row would
 * include everyone who was ever monthly, which is a different and much
 * larger number than the one an operator reads it as.
 */
export async function countActiveByPeriod(): Promise<Record<string, number>> {
  const db = adminDb();
  const nowIso = new Date().toISOString();

  const { data, error } = await db
    .from("users")
    .select("plan_period")
    .neq("plan", "free")
    .gt("premium_until", nowIso);

  if (error) throw new Error(`countActiveByPeriod: ${error.message}`);

  const out: Record<string, number> = {};
  for (const row of data ?? []) {
    const key = (row as { plan_period: string | null }).plan_period ?? "unknown";
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/**
 * The two writes this dashboard makes to `public.plans`.
 *
 * `plans` is small, hand-maintained and read by more than this app:
 * `resolve_pending_claim()` looks a claimed amount up in it to decide whether
 * a payment buys premium, and uses `duration` to decide for how long. So a
 * row here is not a display record — it is the rule a claim is settled
 * against, and the three things that follow from that shape the API below.
 *
 *   1. **`period` is the primary key and nothing renames it.** `users`
 *      carries the period as plain text in `plan_period`, with no foreign
 *      key to make the database refuse. Renaming "monthly" would therefore
 *      succeed and quietly orphan every subscriber on it — their rows would
 *      point at a period that no longer exists, and `countActiveByPeriod`
 *      would file them under a plan nobody can see. `updatePlan` takes the
 *      period only as a selector; there is no code path that changes it.
 *
 *   2. **Nothing here deletes.** Same reason, in a worse form: a deleted
 *      period leaves subscribers pointing at nothing *and* destroys the
 *      record of what they were charged. Retiring a plan is
 *      `is_active: false`, which stops new claims being approved at that
 *      price and leaves everyone's current premium exactly as it was.
 *
 *   3. **Amounts and durations are not retroactive.** Past transactions keep
 *      whatever amount they were charged and premium already granted keeps
 *      the dates it was granted for. An edit here changes what the *next*
 *      claim is settled against, and only that.
 */

export type PlanWrite = {
  period: string;
  /** Whole taka. The reason it may not have a fractional part is in actions.ts. */
  amount: number;
  /** A Postgres interval literal, already composed by `composeDuration`. */
  duration: string;
  isActive: boolean;
};

export type PlanWriteResult =
  | { ok: true; row: PlanRow }
  /** A plan is already keyed by this period. */
  | { ok: false; reason: "duplicate" }
  /** The period to edit is no longer there — another operator got to it. */
  | { ok: false; reason: "missing" }
  /** The database refused the values: a bad interval, a CHECK we don't know about. */
  | { ok: false; reason: "rejected"; message: string }
  | { ok: false; reason: "failed"; message: string };

/** Map a PostgREST error onto the half of the union that isn't `ok`. */
function failure(error: DbError): Extract<PlanWriteResult, { ok: false }> {
  if (error.code === PG.UNIQUE_VIOLATION) return { ok: false, reason: "duplicate" };
  if (error.code && REJECTION_CODES.includes(error.code)) {
    return { ok: false, reason: "rejected", message: describe(error) };
  }
  return { ok: false, reason: "failed", message: describe(error) };
}

/** One plan, or null. Used to tell "add" from "edit" before writing. */
export async function findPlan(period: string): Promise<PlanRow | null> {
  const db = adminDb();
  const { data, error } = await db
    .from("plans")
    .select(PLAN_COLUMNS)
    .eq("period", period)
    .maybeSingle();

  if (error) throw new Error(`findPlan: ${error.message}`);
  return (data as PlanRow | null) ?? null;
}

/**
 * Add a plan.
 *
 * A duplicate period is reported, never merged: the stored row is the one
 * `resolve_pending_claim()` is settling live claims against, and overwriting
 * it from an "add" form would change a price nobody meant to touch. The
 * action pre-checks with `findPlan` for the operator's benefit; this still
 * has to handle the unique violation, because the two operators this tool has
 * can both be looking at the same empty form.
 */
export async function createPlan(input: PlanWrite): Promise<PlanWriteResult> {
  const db = adminDb();

  const { data, error } = await db
    .from("plans")
    .insert({
      period: input.period,
      amount: input.amount,
      duration: input.duration,
      is_active: input.isActive,
    })
    .select(PLAN_COLUMNS)
    .single();

  if (error) return failure(error);
  return { ok: true, row: data as PlanRow };
}

/**
 * Edit a plan's price, duration and whether it is offered.
 *
 * `period` selects the row and is never in the update body — see note 1
 * above. The returned row is the one the database actually holds, so the
 * caller reports what was written rather than what was typed: Postgres
 * normalises an interval on the way in ("12 months" comes back "1 year"), and
 * an operator is entitled to see the value that will be used.
 */
export async function updatePlan(input: PlanWrite): Promise<PlanWriteResult> {
  const db = adminDb();

  const { data, error } = await db
    .from("plans")
    .update({
      amount: input.amount,
      duration: input.duration,
      is_active: input.isActive,
    })
    .eq("period", input.period)
    .select(PLAN_COLUMNS)
    .maybeSingle();

  if (error) return failure(error);
  // No row matched. The period was gone before the update ran, which for a
  // table with no delete path means it was never there — a hand-edited URL.
  if (!data) return { ok: false, reason: "missing" };

  return { ok: true, row: data as PlanRow };
}
