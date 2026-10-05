import "server-only";

import { adminDb } from "@/lib/supabase/admin";
import type {
  PendingClaimRow,
  TransactionRow,
  UserRow,
} from "@/lib/db/types";

/**
 * The pending-payments queue: who has paid and is waiting to be let in.
 *
 * The table behind this is `public.pending_claims` — that is the database's
 * name and the column names below are its own. Everything this app *shows*
 * calls them payments, because that is what an operator is looking at: a
 * person who sent money and has not been let in yet.
 *
 * Reads only. Resolving one writes to `pending_claims` (and to `users`, to
 * grant the premium), and this module does not — so the page built on it
 * shows an operator the evidence and stops short of the decision.
 *
 * The one write the payments page does make is not here: it is
 * `recordTransaction` in db/transactions.ts, which back-fills a bKash message
 * the payment app failed to forward. That adds *evidence*, not a settlement,
 * which is why it does not live in this file.
 *
 * Filters are expressed against `resolved_at`, not `status`. `status` is free
 * text owned by whatever writes these rows; `resolved_at` is null until one
 * is settled, which is a structural fact this app can rely on without
 * assuming anyone's vocabulary.
 */
export const PAYMENT_FILTERS = ["pending", "resolved", "all"] as const;
export type PaymentFilter = (typeof PAYMENT_FILTERS)[number];

export const PAYMENTS_PAGE_SIZE = 25;

const CLAIM_COLUMNS =
  "id,user_id,trx_id,amount,status,reason,created_at,resolved_at";

/** The bits of a user a payment row needs to be legible. */
export type PayingUser = Pick<
  UserRow,
  "id" | "name" | "email" | "is_anonymous" | "plan" | "premium_until"
>;

/**
 * A pending payment with the two things an operator has to see beside it:
 * who is asking, and whether money carrying that transaction id actually
 * arrived. `transaction: null` is the finding, not a gap in the data.
 */
export type PendingPayment = {
  claim: PendingClaimRow;
  user: PayingUser | null;
  transaction: TransactionRow | null;
};

export type PendingPaymentsQuery = {
  filter: PaymentFilter;
  dir: "asc" | "desc";
  page: number;
  q?: string;
};

export type PendingPaymentsResult = {
  rows: PendingPayment[];
  total: number;
};

/**
 * One page of pending payments, plus their user and matching transaction.
 *
 * Three queries rather than one PostgREST embed: the embed would have to name
 * the foreign-key relationship, and `transactions` is joined on `trx_id`,
 * which is a plain column match and not a declared relationship at all. Two
 * `in()` lookups against the page's 25 rows are cheap, exact, and do not
 * depend on constraint names staying put.
 */
export async function listPendingPayments(query: PendingPaymentsQuery): Promise<PendingPaymentsResult> {
  const db = adminDb();

  let q = db.from("pending_claims").select(CLAIM_COLUMNS, { count: "exact" });

  switch (query.filter) {
    case "pending":
      q = q.is("resolved_at", null);
      break;
    case "resolved":
      q = q.not("resolved_at", "is", null);
      break;
    case "all":
      break;
  }

  if (query.q) {
    // A transaction id is the thing an operator pastes in from a statement.
    const needle = query.q.replace(/[%,()]/g, "").trim();
    if (needle) q = q.ilike("trx_id", `%${needle}%`);
  }

  const from = (query.page - 1) * PAYMENTS_PAGE_SIZE;

  const { data, error, count } = await q
    .order("created_at", { ascending: query.dir === "asc" })
    .range(from, from + PAYMENTS_PAGE_SIZE - 1);

  if (error) throw new Error(`listPendingPayments: ${error.message}`);

  const claims = (data ?? []) as unknown as PendingClaimRow[];
  if (claims.length === 0) return { rows: [], total: count ?? 0 };

  const userIds = [...new Set(claims.map((c) => c.user_id))];
  const trxIds = [...new Set(claims.map((c) => c.trx_id))];

  const [usersRes, txRes] = await Promise.all([
    db
      .from("users")
      .select("id,name,email,is_anonymous,plan,premium_until")
      .in("id", userIds),
    db
      .from("transactions")
      .select("trx_id,amount,sender,occurred_at,received_at,claimed_by,claimed_at")
      .in("trx_id", trxIds),
  ]);

  if (usersRes.error) throw new Error(`listPendingPayments users: ${usersRes.error.message}`);
  if (txRes.error) throw new Error(`listPendingPayments transactions: ${txRes.error.message}`);

  const byId = new Map(
    ((usersRes.data ?? []) as unknown as PayingUser[]).map((u) => [u.id, u]),
  );
  const byTrx = new Map(
    ((txRes.data ?? []) as unknown as TransactionRow[]).map((t) => [t.trx_id, t]),
  );

  return {
    rows: claims.map((claim) => ({
      claim,
      user: byId.get(claim.user_id) ?? null,
      transaction: byTrx.get(claim.trx_id) ?? null,
    })),
    total: count ?? 0,
  };
}

export type PaymentCounts = Record<PaymentFilter, number>;

/** Counts for the filter pills and the "work to do" tile on the overview. */
export async function countPendingPayments(): Promise<PaymentCounts> {
  const db = adminDb();
  const head = { count: "exact" as const, head: true };

  const [all, pending, resolved] = await Promise.all([
    db.from("pending_claims").select("id", head),
    db.from("pending_claims").select("id", head).is("resolved_at", null),
    db.from("pending_claims").select("id", head).not("resolved_at", "is", null),
  ]);

  const failed = [all, pending, resolved].find((r) => r.error);
  if (failed?.error) throw new Error(`countPendingPayments: ${failed.error.message}`);

  return {
    all: all.count ?? 0,
    pending: pending.count ?? 0,
    resolved: resolved.count ?? 0,
  };
}

/** Just the pending count, for the overview tile. */
export async function countPaymentsAwaitingReview(): Promise<number> {
  const db = adminDb();
  const { count, error } = await db
    .from("pending_claims")
    .select("id", { count: "exact", head: true })
    .is("resolved_at", null);

  if (error) throw new Error(`countPaymentsAwaitingReview: ${error.message}`);
  return count ?? 0;
}

/**
 * Open claims bucketed by the amount they quote.
 *
 * This is what makes a price change on the plans page a visible decision
 * rather than a silent one. `resolve_pending_claim()` approves a claim only
 * when the amount paid is the price of an *active* plan, so editing ৳1338 to
 * ৳1400 — or switching that plan off — turns every open claim still quoting
 * ৳1338 into a NOT_A_PLAN_PRICE rejection. Those people have already sent the
 * money. The plans form reads this to say how many of them there are before
 * the write, not after.
 *
 * Keyed by `String(Number(amount))` because `numeric` arrives as a string
 * from PostgREST and "1338.00" and "1338" are the same price — a map keyed on
 * the raw text would miss every lookup.
 */
export async function countOpenClaimsByAmount(): Promise<Record<string, number>> {
  const db = adminDb();

  const { data, error } = await db
    .from("pending_claims")
    .select("amount")
    .is("resolved_at", null);

  if (error) throw new Error(`countOpenClaimsByAmount: ${error.message}`);

  const out: Record<string, number> = {};
  for (const row of data ?? []) {
    const raw = (row as { amount: number | string | null }).amount;
    if (raw === null) continue;
    const key = String(Number(raw));
    if (key === "NaN") continue;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}
