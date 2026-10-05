import "server-only";

import { PG, describe } from "@/lib/db/error";
import { adminDb } from "@/lib/supabase/admin";
import type { TransactionRow } from "@/lib/db/types";

/**
 * `public.transactions` — and the one write this dashboard makes.
 *
 * The table is normally filled by the payment app: it reads the bKash SMS on
 * a phone and forwards it here. When that phone is off, out of credit, or the
 * forward silently fails, the money has genuinely arrived and this app cannot
 * see it — every claim quoting that id renders "No payment found", and an
 * operator who can see the payment in their own bKash statement still has no
 * safe way to move the queue.
 *
 * Recording it by hand closes that gap. The insert writes exactly what the
 * SMS would have carried and nothing more: id, amount, sender, when it
 * happened, and the message itself. `claimed_by` and `claimed_at` stay null —
 * those describe a claim being resolved, which is a different decision made by
 * a different system, and filling them here would fake a settlement that never
 * happened.
 *
 * `raw_message` is NOT NULL in the schema and it is the evidence the whole
 * table rests on, so a hand entry has to carry one. It is stamped with who
 * typed it: there is no column distinguishing a forwarded SMS from a typed
 * one, and without the stamp nobody reading this table later could tell the
 * difference between a message the system observed and a claim about one.
 */

/**
 * Prefix marking a row as hand-entered. Greppable on purpose — this is the
 * only way to audit which transactions a person vouched for rather than the
 * payment app observing them.
 */
export const HAND_ENTERED = "[recorded by hand]";

export function handEnteredMessage(text: string, operator: string): string {
  return `${HAND_ENTERED} ${operator} — ${new Date().toISOString()}\n${text}`;
}

const COLUMNS =
  "trx_id,amount,sender,occurred_at,received_at,claimed_by,claimed_at";

export type RecordTransactionInput = {
  trxId: string;
  amount: number;
  sender: string | null;
  /** ISO instant, already resolved from Dhaka wall time by the caller. */
  occurredAt: string | null;
  /** The bKash message, already stamped by `handEnteredMessage`. */
  rawMessage: string;
};

export type RecordTransactionResult =
  | { ok: true; row: TransactionRow }
  | { ok: false; reason: "duplicate" }
  | { ok: false; reason: "failed"; message: string };

/**
 * Insert one transaction.
 *
 * `trx_id` keys the table, so a duplicate is reported rather than merged: the
 * stored row is either a real forwarded SMS or an earlier hand entry, and
 * overwriting it with freshly typed text would destroy the better record of
 * the two. The pre-check in the action is for the message an operator reads;
 * this code still has to handle the unique violation, because the payment app
 * can win the race between that check and this insert.
 */
export async function recordTransaction(
  input: RecordTransactionInput,
): Promise<RecordTransactionResult> {
  const db = adminDb();

  const { data, error } = await db
    .from("transactions")
    .insert({
      trx_id: input.trxId,
      amount: input.amount,
      sender: input.sender,
      occurred_at: input.occurredAt,
      raw_message: input.rawMessage,
      // When *we* learned of it. The app sets this on forward, so a hand
      // entry sets it too — the gap between it and `occurred_at` is how long
      // the message was missing, which is worth being able to see.
      received_at: new Date().toISOString(),
    })
    .select(COLUMNS)
    .single();

  if (error) {
    // Unique violation on the trx_id key.
    if (error.code === PG.UNIQUE_VIOLATION) {
      return { ok: false, reason: "duplicate" };
    }
    return { ok: false, reason: "failed", message: describe(error) };
  }

  return { ok: true, row: data as unknown as TransactionRow };
}

/** Does a payment carrying this id already exist? */
export async function findTransaction(
  trxId: string,
): Promise<TransactionRow | null> {
  const db = adminDb();
  const { data, error } = await db
    .from("transactions")
    .select(COLUMNS)
    .eq("trx_id", trxId)
    .maybeSingle();

  if (error) throw new Error(`findTransaction: ${error.message}`);
  return (data as unknown as TransactionRow | null) ?? null;
}

/**
 * How many still-open claims quote this transaction id.
 *
 * Read straight after a successful insert so the operator is told whether the
 * row they just typed actually joined up with the queue. Zero is the
 * interesting answer: it means the id does not match anything waiting, which
 * is almost always a typo, and saying so immediately is the difference
 * between a visible mistake and a row that quietly matches nothing forever.
 */
export async function countOpenClaimsForTrx(trxId: string): Promise<number> {
  const db = adminDb();
  const { count, error } = await db
    .from("pending_claims")
    .select("id", { count: "exact", head: true })
    .eq("trx_id", trxId)
    .is("resolved_at", null);

  if (error) throw new Error(`countOpenClaimsForTrx: ${error.message}`);
  return count ?? 0;
}
