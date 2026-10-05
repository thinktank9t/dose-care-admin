import Link from "next/link";
import type { Metadata } from "next";

import { PlanForm } from "@/app/admin/plans/PlanForm";
import { Forbidden, MissingServiceKey } from "@/components/Forbidden";
import { PageHeader } from "@/components/PageHeader";
import { StatusPill } from "@/components/StatusPill";
import { Empty, TableCard, Td, Th, Tr } from "@/components/Table";
import { requireAdmin } from "@/lib/auth";
import { countOpenClaimsByAmount } from "@/lib/db/payments";
import { countActiveByPeriod, listPlans } from "@/lib/db/plans";
import { formatDuration } from "@/lib/duration";
import { hasServiceKey } from "@/lib/supabase/admin";
import { formatBdt, formatCount } from "@/lib/format";
import { strParam } from "@/lib/url";

export const metadata: Metadata = {
  // See the note on the overview: `robots` comes from the root layout.
  title: "Plans — Dose Care Admin",
};

const BASE = "/admin/plans";

export default async function PlansPage({
  searchParams,
}: PageProps<"/admin/plans">) {
  const gate = await requireAdmin("/admin/plans");
  if (!gate.ok) return <Forbidden email={gate.email} />;
  if (!hasServiceKey()) return <MissingServiceKey />;

  const params = await searchParams;
  // Which row the form is editing, if any. In the URL rather than in component
  // state so the view is linkable and survives a refresh — the same reason the
  // payments page carries its record-a-payment prefill there.
  const editing = strParam(params.edit).toLowerCase();

  const [plans, activeByPeriod, claimsByAmount] = await Promise.all([
    listPlans(),
    countActiveByPeriod(),
    // Read for the form, not the table: it is what lets the form say how many
    // people have already paid at a price before that price is changed.
    countOpenClaimsByAmount(),
  ]);

  const target = editing ? plans.find((p) => p.period === editing) : undefined;
  // A period in the URL that matches nothing. The Edit links are built from
  // the rows, so this only happens to a hand-typed URL — but falling back to
  // the add form without a word would look like the link was broken.
  const missing = editing !== "" && target === undefined;

  return (
    <div className="container-wide py-12">
      <PageHeader
        title="Plans"
        subtitle="What the client offers and what it charges. Amounts here are what a claim is settled against, so a mismatch with the bKash statement starts in this table."
        action={
          // Secondary, not primary: the form's own submit is the one
          // `.btn-primary` on this view. This link only scrolls to it, and
          // dropping `?edit=` is what puts it back in add mode.
          <Link href={`${BASE}#plan-form`} className="btn btn-secondary btn-sm">
            Add a plan
          </Link>
        }
      />

      <TableCard
        minWidth={820}
        empty={
          plans.length === 0 ? (
            <Empty>No plan is configured. Add one below.</Empty>
          ) : undefined
        }
      >
        <thead>
          <tr>
            <Th>Period</Th>
            <Th>Price</Th>
            <Th>Duration</Th>
            <Th>Offered</Th>
            <Th align="right">Subscribers now</Th>
            <Th align="right">Edit</Th>
          </tr>
        </thead>
        <tbody>
          {plans.map((plan) => (
            <Tr
              key={plan.period}
              data-testid="plan-row"
              data-plan={plan.period}
              data-editing={plan.period === editing ? "yes" : undefined}
            >
              <Td>
                <span className="font-medium text-ink capitalize">
                  {plan.period}
                </span>
              </Td>
              {/* Money always through formatBdt, Latin digits, no decimals. */}
              <Td>
                <span className="font-heading text-[18px] text-ink">
                  {formatBdt(plan.amount)}
                </span>
              </Td>
              {/* Postgres prints an interval in its own abbreviations — "1 mon"
                  — which is not how an operator reads a subscription length. */}
              <Td className="text-ink-2">{formatDuration(plan.duration)}</Td>
              <Td>
                <StatusPill status={plan.is_active ? "active" : "none"} />
              </Td>
              <Td align="right" className="text-ink">
                {formatCount(activeByPeriod[plan.period] ?? 0)}
              </Td>
              <Td align="right">
                <Link
                  href={`${BASE}?edit=${plan.period}#plan-form`}
                  className="btn btn-secondary btn-sm"
                  data-testid="plan-edit-link"
                >
                  Edit
                </Link>
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableCard>

      {/* Rows are ordered by amount, so a cheaper long plan sorts above a
          dearer short one — the note explains why the table has no stable id
          to order by instead, and what that costs. */}
      <div className="mt-5 max-w-xl rounded-2xl bg-bg-alt/70 p-4">
        <p className="label-micro">Note</p>
        <p className="mt-2 text-small text-ink-2">
          Plan rows are keyed by <span className="font-mono">period</span> and
          have no surrogate id, so a price change edits the row in place — past
          transactions keep whatever amount they were charged, not whatever
          this table says today. For the same reason a period cannot be renamed
          and a plan cannot be deleted: subscribers reference it by name.
          Retiring one is <span className="font-mono">Offered</span> → off.
        </p>
      </div>

      {missing ? (
        <p
          role="status"
          className="mt-6 max-w-[80ch] rounded-2xl bg-warn-soft p-4 text-small text-warn"
          data-testid="plan-edit-missing"
        >
          No plan is keyed <span className="font-mono">{editing}</span>, so
          there is nothing to edit. The add form is below.
        </p>
      ) : null}

      <PlanForm
        mode={target ? "edit" : "create"}
        plan={target}
        plans={plans}
        subscribers={target ? (activeByPeriod[target.period] ?? 0) : 0}
        claimsByAmount={claimsByAmount}
      />
    </div>
  );
}
