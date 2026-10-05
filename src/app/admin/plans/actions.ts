"use server";

import { revalidatePath } from "next/cache";

import {
  MAX_AMOUNT,
  PERIOD_PATTERN,
  isReservedPeriod,
  isWholeTaka,
} from "@/app/admin/plans/rules";
import { assertAdmin } from "@/lib/auth";
import { createPlan, findPlan, updatePlan } from "@/lib/db/plans";
import {
  DURATION_UNITS,
  MAX_DURATION_COUNT,
  composeDuration,
  type DurationUnit,
} from "@/lib/duration";
import { hasServiceKey } from "@/lib/supabase/admin";

/**
 * Add a plan, or edit one.
 *
 * Every check the form makes runs again here. A Server Action is a POST
 * endpoint, and rendering the form behind `requireAdmin()` gates the *page*,
 * not the action — `assertAdmin()` exists for exactly that (see lib/auth.ts).
 *
 * This is the second thing the dashboard writes, and the more consequential
 * of the two. A row in `plans` is the rule `resolve_pending_claim()` settles
 * payments against: it approves a claim only when the amount paid is the
 * price of an active plan, and it grants premium for that plan's `duration`.
 * So the validation below is not form hygiene — each rule stops a value that
 * would be accepted by the database and then quietly break a settlement.
 */

export type PlanMode = "create" | "edit";

export type PlanErrorReason =
  | "forbidden"
  | "no-key"
  | "period"
  | "reserved"
  | "amount"
  | "fraction"
  | "duration"
  | "duplicate"
  | "missing"
  | "rejected"
  | "failed";

export type PlanState =
  | { status: "idle" }
  // `detail` is the database's own words, for the same reason the payments
  // action surfaces them: this page is behind requireAdmin(), and the operator
  // reading it is the person who can act on a constraint name.
  | { status: "error"; reason: PlanErrorReason; detail?: string; saves: number }
  | {
      status: "done";
      mode: PlanMode;
      period: string;
      amount: number;
      /** As Postgres stored it, not as it was typed — it normalises intervals. */
      duration: string | null;
      isActive: boolean;
      saves: number;
    };

/**
 * How many writes this action has made, carried on **every** non-idle state.
 *
 * The add form empties its fields by remounting them under a new key, and
 * that key has to advance on a successful add and at no other time. Deriving
 * it from the status alone does not: going from `done` back to `error` is
 * also a change, so the remount would fire on the next *failed* submit and
 * wipe the values the operator was about to correct. A counter only ever goes
 * up, so a failure leaves the fields exactly where they were.
 */
function savesSoFar(prev: PlanState): number {
  return prev.status === "idle" ? 0 : prev.saves;
}

export async function savePlanAction(
  _prev: PlanState,
  formData: FormData,
): Promise<PlanState> {
  const saves = savesSoFar(_prev);
  const fail = (reason: PlanErrorReason, detail?: string): PlanState => ({
    status: "error",
    reason,
    detail,
    saves,
  });

  const gate = await assertAdmin();
  if (!gate.ok) return fail("forbidden");
  if (!hasServiceKey()) return fail("no-key");

  const mode: PlanMode = formData.get("mode") === "edit" ? "edit" : "create";

  const period = String(formData.get("period") ?? "")
    .trim()
    .toLowerCase();
  if (!PERIOD_PATTERN.test(period)) return fail("period");
  if (isReservedPeriod(period)) return fail("reserved");

  const amountRaw = String(formData.get("amount") ?? "").trim();
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    return fail("amount");
  }
  // Whole taka only — the reasoning is on `isWholeTaka`.
  if (!isWholeTaka(amount)) return fail("fraction");

  const count = Number(String(formData.get("duration_count") ?? "").trim());
  const unit = String(formData.get("duration_unit") ?? "") as DurationUnit;
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > MAX_DURATION_COUNT ||
    !DURATION_UNITS.includes(unit)
  ) {
    return fail("duration");
  }
  const duration = composeDuration({ count, unit });

  // An unchecked checkbox submits nothing at all, so absence is false.
  const isActive = formData.get("is_active") === "on";

  const input = { period, amount, duration, isActive };

  // Checked before writing so the operator reads "that period already exists"
  // rather than a constraint error. `createPlan` still handles the unique
  // violation — two operators can be looking at the same empty form.
  if (mode === "create" && (await findPlan(period))) {
    return fail("duplicate");
  }

  const result =
    mode === "create" ? await createPlan(input) : await updatePlan(input);

  if (!result.ok) {
    if (result.reason === "duplicate") {
      return fail("duplicate");
    }
    if (result.reason === "missing") {
      return fail("missing");
    }
    if (result.reason === "rejected") {
      return fail("rejected", result.message);
    }
    // Also to the server log, so a failure is diagnosable from `vercel logs`
    // after the operator has closed the tab.
    console.error("savePlan failed", { mode, period, detail: result.message });
    return fail("failed", result.message);
  }

  // Three pages read `plans`, and all three would otherwise keep showing the
  // old price: this one, the overview's plan strip, and the payments page —
  // where the prices feed the "not an active plan price" warning on the
  // record-a-payment form, so a stale list there would mislead the next
  // write. Revalidated before returning, so the re-rendered table ships in
  // the same roundtrip as the result.
  revalidatePath("/admin/plans");
  revalidatePath("/admin");
  revalidatePath("/admin/payments");

  return {
    status: "done",
    mode,
    period: result.row.period,
    // From the row the database returned, not from what was typed — Postgres
    // normalises an interval on the way in and the operator should see the
    // value that will actually be used.
    amount: Number(result.row.amount ?? amount),
    duration: result.row.duration,
    isActive: Boolean(result.row.is_active),
    saves: saves + 1,
  };
}
