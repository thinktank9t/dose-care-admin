"use client";

import Link from "next/link";
import { useActionState, useState, type ReactNode } from "react";

import {
  savePlanAction,
  type PlanErrorReason,
  type PlanMode,
  type PlanState,
} from "@/app/admin/plans/actions";
import {
  PERIOD_PATTERN,
  isReservedPeriod,
  isWholeTaka,
} from "@/app/admin/plans/rules";
import { NavLoader } from "@/components/NavLoader";
import { Spinner } from "@/components/Spinner";
import {
  DURATION_UNITS,
  MAX_DURATION_COUNT,
  formatDuration,
  parseDuration,
  type DurationUnit,
} from "@/lib/duration";
import { formatBdt, plural } from "@/lib/format";
import type { PlanRow } from "@/lib/db/types";

/**
 * Add a plan, or edit one.
 *
 * One form, two modes, driven by `?edit=<period>` in the URL — the same shape
 * the payments page uses for its record-a-payment form, and for the same
 * reason: view state lives in the URL, so an operator can link a colleague
 * straight at the row that needs changing, and a refresh does not lose where
 * they were. A modal would have neither property.
 *
 * What the form spends most of its code on is not the three fields. It is
 * telling the operator what the write will do to claims that are already open.
 * A plan row is the rule `resolve_pending_claim()` settles payments against,
 * so raising a price, or switching a plan off, can reject people who have
 * already sent money at the old figure. That consequence is invisible in the
 * database and arrives days later as a support message, so it is stated here,
 * before the button.
 */

const COPY: Record<PlanErrorReason, string> = {
  forbidden: "Your session is no longer an operator session. Sign in again.",
  "no-key": "The service key is missing, so the dashboard cannot write.",
  period:
    "A period is 3–32 characters: lowercase letters, digits and underscores, starting with a letter.",
  reserved:
    "“free” and “unknown” are used internally for users with no plan, so a plan cannot take either name.",
  amount: "Enter the price in taka, as a number greater than zero.",
  fraction: "Prices are whole taka — the dashboard shows no decimals.",
  duration: `Choose how long the plan lasts: 1–${MAX_DURATION_COUNT} days, months or years.`,
  duplicate: "A plan with this period already exists. Edit that one instead.",
  missing: "That plan no longer exists. Reload the page.",
  rejected: "The database refused these values.",
  failed: "Could not save it. Try again in a moment.",
};

const UNIT_LABELS: Record<DurationUnit, string> = {
  day: "days",
  month: "months",
  year: "years",
};

export function PlanForm({
  mode,
  plan,
  plans,
  subscribers,
  claimsByAmount,
}: {
  mode: PlanMode;
  /** The row being edited. Absent in create mode. */
  plan?: PlanRow;
  /** Every plan, for the duplicate-period and duplicate-price warnings. */
  plans: PlanRow[];
  /** People on this plan right now. Only meaningful in edit mode. */
  subscribers: number;
  /** Open claims keyed by the amount they quote. */
  claimsByAmount: Record<string, number>;
}) {
  const [state, action, pending] = useActionState<PlanState, FormData>(
    savePlanAction,
    { status: "idle" },
  );

  // Clearing the form after an add, and re-seeding it when the operator opens
  // a different row — or when the row they just saved comes back with the
  // values Postgres actually stored — are one operation: throw the fields
  // away and mount fresh ones. Keying them does that without a
  // setState-in-effect cascade, which is why every field lives in one
  // component together with the button that reads them.
  //
  // In create mode the key is the action's *save counter*, not its status. A
  // status key would also change going from `done` back to `error`, so the
  // next failed submit would remount and wipe the values the operator was
  // about to correct. The counter only goes up, so it clears the fields after
  // an add and never after a rejection.
  //
  // In edit mode the key is the row's own values, so a successful save
  // remounts against the revalidated row. That matters because Postgres
  // normalises an interval on the way in: "12 months" comes back "1 year",
  // and the form should show the stored truth rather than what was typed.
  const seed =
    mode === "create"
      ? `create:${state.status === "idle" ? 0 : state.saves}`
      : `edit:${plan?.period}:${plan?.amount}:${plan?.duration}:${plan?.is_active}`;

  return (
    <section
      id="plan-form"
      aria-labelledby="plan-form-heading"
      className="card mt-6 p-6"
      data-testid="plan-form"
      data-mode={mode}
      data-plan={mode === "edit" ? plan?.period : undefined}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="plan-form-heading" className="font-heading text-[19px] text-ink">
          {mode === "edit" ? (
            <>
              Edit the <span className="capitalize">{plan?.period}</span> plan
            </>
          ) : (
            "Add a plan"
          )}
        </h2>
        {mode === "edit" ? (
          <Link
            href="/admin/plans#plan-form"
            className="text-small text-accent-ink underline underline-offset-2"
            data-testid="plan-form-cancel"
          >
            Cancel and add a new plan instead
            <NavLoader />
          </Link>
        ) : null}
      </div>

      <p className="mt-1 max-w-[74ch] text-ink-2">
        {mode === "edit"
          ? "Changes apply to the next claim settled, not to past ones. Transactions keep whatever amount they were charged, and premium already granted keeps the dates it was granted for."
          : "A plan is the price a payment has to match and the premium it buys. Until it is switched on, no claim can be approved against it."}
      </p>

      <form action={action} aria-busy={pending} className="mt-5">
        <PlanFields
          key={seed}
          mode={mode}
          plan={plan}
          plans={plans}
          subscribers={subscribers}
          claimsByAmount={claimsByAmount}
          pending={pending}
          status={<Result state={state} />}
        />
      </form>
    </section>
  );
}

function Result({ state }: { state: PlanState }) {
  if (state.status === "error") {
    return (
      <p role="alert" className="text-[13px] text-danger" data-testid="plan-error">
        {COPY[state.reason]}
        {state.detail ? (
          <span className="mt-1 block font-mono text-[12px] text-ink-3">
            {state.detail}
          </span>
        ) : null}
      </p>
    );
  }

  if (state.status === "done") {
    return (
      <p
        role="status"
        // A saved plan that is switched off is not a tick: nothing can be
        // settled against it, which is a thing an operator who meant to add a
        // live plan must not scroll past.
        className={state.isActive ? "text-[13px] text-accent-ink" : "text-[13px] text-warn"}
        data-testid="plan-done"
      >
        {state.mode === "create" ? "Added " : "Saved "}
        <span className="capitalize">{state.period}</span> at{" "}
        {formatBdt(state.amount)} for {formatDuration(state.duration)}.
        {state.isActive
          ? " Claims at that amount can now be approved against it."
          : " It is not offered, so no claim can be approved against it."}
      </p>
    );
  }

  return null;
}

function PlanFields({
  mode,
  plan,
  plans,
  subscribers,
  claimsByAmount,
  pending,
  status,
}: {
  mode: PlanMode;
  plan?: PlanRow;
  plans: PlanRow[];
  subscribers: number;
  claimsByAmount: Record<string, number>;
  pending: boolean;
  status: ReactNode;
}) {
  const stored = parseDuration(plan?.duration);

  const [period, setPeriod] = useState(plan?.period ?? "");
  const [amount, setAmount] = useState(
    plan?.amount === null || plan?.amount === undefined ? "" : String(plan.amount),
  );
  const [count, setCount] = useState(stored ? String(stored.count) : "1");
  const [unit, setUnit] = useState<DurationUnit>(stored?.unit ?? "month");
  const [isActive, setIsActive] = useState(
    mode === "edit" ? Boolean(plan?.is_active) : true,
  );

  // Every rule the action applies, applied here too. `required` already blocks
  // an empty submit, but a button that cannot work should not look like it
  // can, and a rule enforced only on the server costs a roundtrip to
  // discover. Both still run server-side — the action is a POST endpoint
  // reachable without this UI.
  const periodClean = period.trim().toLowerCase();
  const periodBad = periodClean !== "" && !PERIOD_PATTERN.test(periodClean);
  const periodReserved = isReservedPeriod(periodClean);

  // In create mode this is a block: the insert would fail on the primary key.
  const taken =
    mode === "create" && periodClean !== "" &&
    plans.some((p) => p.period === periodClean);

  const amountNum = Number(amount);
  const amountValid =
    amount.trim() !== "" && Number.isFinite(amountNum) && amountNum > 0;
  const amountBad = amount.trim() !== "" && !amountValid;
  const fractional = amountValid && !isWholeTaka(amountNum);

  const countNum = Number(count);
  const countBad =
    count.trim() !== "" &&
    (!Number.isInteger(countNum) || countNum < 1 || countNum > MAX_DURATION_COUNT);

  const blocked =
    periodClean === "" ||
    periodBad ||
    periodReserved ||
    taken ||
    !amountValid ||
    fractional ||
    count.trim() === "" ||
    countBad;

  // One line naming the specific thing in the way. "Fill in the form" tells an
  // operator nothing they did not already know.
  const blockedBecause = periodBad
    ? "A period is lowercase letters, digits and underscores, 3–32 of them, starting with a letter."
    : periodReserved
      ? "“free” and “unknown” are reserved for users with no plan."
      : taken
        ? `A plan is already keyed ${periodClean}.`
        : amountBad
          ? "The price must be a number greater than zero."
          : fractional
            ? "Prices are whole taka."
            : countBad
              ? `A duration is 1–${MAX_DURATION_COUNT}.`
              : periodClean === ""
                ? "Add the period."
                : count.trim() === ""
                  ? "Add the duration."
                  : null;

  // --- The consequences of this write, for claims that are already open ----

  const storedAmount =
    plan?.amount === null || plan?.amount === undefined ? null : Number(plan.amount);

  // Open claims still quoting the price this edit is moving away from. They
  // were submitted by people who have already sent that exact amount.
  const strandedClaims =
    mode === "edit" && storedAmount !== null && amountValid && amountNum !== storedAmount
      ? (claimsByAmount[String(storedAmount)] ?? 0)
      : 0;

  // Switching a live plan off has the same effect on open claims at its price,
  // without the price moving.
  const deactivating = mode === "edit" && Boolean(plan?.is_active) && !isActive;
  const claimsAtThisPrice =
    storedAmount !== null ? (claimsByAmount[String(storedAmount)] ?? 0) : 0;

  // `resolve_pending_claim()` is given an amount, not a period — a claim
  // quotes what was paid. Two active plans at one price is therefore a
  // genuinely ambiguous instruction about which duration to grant.
  const collision = amountValid
    ? plans.find(
        (p) =>
          p.period !== (mode === "edit" ? plan?.period : periodClean) &&
          p.is_active &&
          p.amount !== null &&
          Number(p.amount) === amountNum,
      )
    : undefined;

  return (
    <>
      <input type="hidden" name="mode" value={mode} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor="plan-period" className="label-micro block">
            Period
          </label>
          {mode === "edit" ? (
            <>
              {/* Not an input. `period` is the primary key and `users`
                  carries it as plain text in `plan_period` with no foreign
                  key, so a rename would succeed and orphan every subscriber
                  on the plan — their rows would point at a period that no
                  longer exists. There is no code path that changes it. */}
              <p className="mt-2 flex h-[52px] items-center font-medium text-ink capitalize">
                {plan?.period}
              </p>
              <input type="hidden" name="period" value={plan?.period ?? ""} />
              <p className="mt-1 text-small text-ink-3">
                Fixed. Subscribers reference the period by name, so renaming it
                would orphan them.
              </p>
            </>
          ) : (
            <>
              <input
                id="plan-period"
                name="period"
                required
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="quarterly"
                className="field mt-2 lowercase"
                data-testid="plan-period"
              />
              {periodBad ? (
                <p className="mt-1 text-small text-danger" data-testid="plan-period-bad">
                  Lowercase letters, digits and underscores, 3–32 of them.
                </p>
              ) : periodReserved ? (
                <p className="mt-1 text-small text-danger" data-testid="plan-period-reserved">
                  Reserved — used for users with no plan.
                </p>
              ) : taken ? (
                <p className="mt-1 text-small text-danger" data-testid="plan-period-taken">
                  Already exists.{" "}
                  <Link
                    href={`/admin/plans?edit=${periodClean}#plan-form`}
                    className="text-accent-ink underline underline-offset-2"
                  >
                    Edit it instead
                    <NavLoader />
                  </Link>
                  .
                </p>
              ) : (
                <p className="mt-1 text-small text-ink-3">
                  Also what <span className="font-mono">users.plan_period</span>{" "}
                  will hold. Cannot be changed later.
                </p>
              )}
            </>
          )}
        </div>

        <div>
          <label htmlFor="plan-amount" className="label-micro block">
            Price (৳)
          </label>
          <input
            id="plan-amount"
            name="amount"
            type="number"
            required
            min="1"
            step="1"
            inputMode="numeric"
            placeholder="500"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="field mt-2"
            data-testid="plan-amount"
          />
          {amountBad ? (
            <p className="mt-1 text-small text-danger" data-testid="plan-amount-bad">
              Must be a number greater than zero.
            </p>
          ) : fractional ? (
            <p className="mt-1 text-small text-danger" data-testid="plan-amount-fraction">
              Whole taka only — the dashboard shows no decimals, so a part-taka
              price would display as a figure the database does not hold.
            </p>
          ) : (
            <p className="mt-1 text-small text-ink-3">
              What a payment has to match, to the taka.
            </p>
          )}
        </div>

        <div>
          <label htmlFor="plan-duration-count" className="label-micro block">
            Premium lasts
          </label>
          {/* The width lives on the wrappers, not on the fields. `.field`
              already sets `width: 100%`, and a `w-20` beside it would be a
              Tailwind conflict settled by stylesheet order rather than by the
              order written here. */}
          <div className="mt-2 flex gap-2">
            <div className="w-24 shrink-0">
              <input
                id="plan-duration-count"
                name="duration_count"
                type="number"
                required
                min="1"
                max={MAX_DURATION_COUNT}
                step="1"
                inputMode="numeric"
                value={count}
                onChange={(e) => setCount(e.target.value)}
                className="field"
                data-testid="plan-duration-count"
              />
            </div>
            <div className="min-w-0 flex-1">
              <select
                name="duration_unit"
                aria-label="Duration unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value as DurationUnit)}
                className="field"
                data-testid="plan-duration-unit"
              >
                {DURATION_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {UNIT_LABELS[u]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {countBad ? (
            <p className="mt-1 text-small text-danger" data-testid="plan-duration-bad">
              Between 1 and {MAX_DURATION_COUNT}.
            </p>
          ) : stored === null && plan?.duration ? (
            // Only reachable for a compound interval set in SQL rather than
            // through this form — "1 year 6 mons 3 days". The form cannot
            // represent it, so it says so instead of silently rounding.
            <p className="mt-1 text-small text-warn" data-testid="plan-duration-unreadable">
              Currently <span className="font-mono">{plan.duration}</span>, which
              this form cannot represent. Saving replaces it.
            </p>
          ) : (
            <p className="mt-1 text-small text-ink-3">
              How long an approved claim grants premium for.
            </p>
          )}
        </div>

        <div>
          <span className="label-micro block">Offered</span>
          <label
            htmlFor="plan-is-active"
            className="mt-2 flex h-[52px] items-center gap-2.5 text-[15px] text-ink"
          >
            <input
              id="plan-is-active"
              name="is_active"
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-5 w-5 rounded accent-accent"
              data-testid="plan-is-active"
            />
            Claims may be approved at this price
          </label>
          <p className="mt-1 text-small text-ink-3">
            Switch off to retire a plan. There is no delete.
          </p>
        </div>
      </div>

      {/* The consequences, stated before the button rather than discovered
          afterwards. Each one is a fact about claims that are open right now. */}
      {strandedClaims > 0 ? (
        <Consequence tone="warn" testId="plan-warn-stranded">
          {plural(strandedClaims, "open claim", "open claims")} quote{" "}
          {formatBdt(storedAmount)} — the price you are changing. A claim is
          approved only at the price of an active plan, so after this save those
          people, who have already sent that amount, can no longer be approved
          against this plan.
        </Consequence>
      ) : null}

      {deactivating ? (
        <Consequence tone="warn" testId="plan-warn-deactivate">
          Retiring this plan stops new claims being approved at{" "}
          {formatBdt(storedAmount)}
          {claimsAtThisPrice > 0
            ? `, including ${plural(claimsAtThisPrice, "claim", "claims")} already open at that amount`
            : ""}
          . It does <span className="font-medium">not</span> end anyone&rsquo;s
          current premium
          {subscribers > 0
            ? ` — the ${plural(subscribers, "subscriber", "subscribers")} on it keep the dates they were granted`
            : ""}
          .
        </Consequence>
      ) : null}

      {collision ? (
        <Consequence tone="warn" testId="plan-warn-collision">
          The <span className="capitalize">{collision.period}</span> plan is
          already offered at {formatBdt(amountNum)}. A claim quotes the amount
          paid, not a period, so two active plans at one price leaves it to{" "}
          <span className="font-mono text-[12px]">resolve_pending_claim()</span>{" "}
          which duration a payment buys.
        </Consequence>
      ) : null}

      {mode === "edit" && subscribers > 0 && !deactivating ? (
        <Consequence tone="neutral" testId="plan-note-subscribers">
          {plural(subscribers, "person is", "people are")} on this plan right
          now. Nothing here touches them: an edit changes what the next claim is
          settled against.
        </Consequence>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || blocked}
          // `disabled` alone is silent to someone who cannot see the greyed
          // button, so say why it is off.
          aria-describedby={blocked ? "plan-submit-blocked" : undefined}
          className="btn btn-primary"
          data-testid="plan-submit"
        >
          {pending ? <Spinner size={15} /> : null}
          {pending
            ? "Saving…"
            : mode === "edit"
              ? "Save changes"
              : "Add plan"}
        </button>

        {blockedBecause ? (
          <p id="plan-submit-blocked" className="text-[13px] text-ink-3">
            {blockedBecause}
          </p>
        ) : null}

        {status}
      </div>
    </>
  );
}

/**
 * A consequence of the pending write. `bg-*-soft` plus the matching ink, the
 * same treatment `StatusPill` uses — never a saturated fill behind text.
 */
function Consequence({
  tone,
  testId,
  children,
}: {
  tone: "warn" | "neutral";
  testId: string;
  children: ReactNode;
}) {
  return (
    <p
      role="status"
      data-testid={testId}
      className={`mt-4 max-w-[80ch] rounded-2xl p-4 text-small ${
        tone === "warn" ? "bg-warn-soft text-warn" : "bg-bg-alt/70 text-ink-2"
      }`}
    >
      {children}
    </p>
  );
}
