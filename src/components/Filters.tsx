import Link from "next/link";

import { NavLoader } from "@/components/NavLoader";
import { SearchIcon } from "@/components/icons";

/**
 * Every filter is a URL param, so the view is linkable, refresh-safe and
 * server-rendered, and whatever is in the URL scopes *everything* on the
 * page — tiles and table together — so two numbers on one screen can never
 * disagree.
 *
 * Order within the row: status pills, then search, then the count pushed to
 * the end. A date range would go first in that same row, and would have to
 * scope the tiles too; there isn't one yet.
 */
export function FilterRow({
  children,
  label,
  count,
}: {
  children: React.ReactNode;
  label: string;
  count?: string;
}) {
  return (
    <nav
      className="mt-6 flex flex-wrap items-center gap-2"
      aria-label={label}
    >
      {children}
      {count ? (
        <span className="ml-auto self-center text-small text-ink-3">
          {count}
        </span>
      ) : null}
    </nav>
  );
}

export function FilterPill({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`pill h-9 px-4 text-[13px] ${
        active
          ? "bg-accent-soft text-accent-ink"
          : "border border-line bg-surface text-ink-2"
      }`}
    >
      {children}
      {/* Reports the server roundtrip this chip costs. A chip changes only
          `?status=`, not the route segment, so the segment's `loading.tsx`
          never re-suspends and the click would otherwise be silent — see the
          long note on NavLoader. It portals to the body, so it is not a flex
          item here and adds neither width nor a `gap`. */}
      <NavLoader />
    </Link>
  );
}

/**
 * A GET form, so the query ends up in the URL and server-side filtering does
 * the work. Client-side filtering of one page of rows would silently lie:
 * it would search 50 rows and look like it searched 5,000.
 *
 * Hidden inputs carry the other params through, otherwise searching would
 * reset the status filter and the range.
 */
export function SearchForm({
  action,
  defaultValue,
  placeholder,
  hidden = {},
}: {
  action: string;
  defaultValue?: string;
  placeholder: string;
  hidden?: Record<string, string | undefined>;
}) {
  return (
    <form action={action} method="get" className="flex items-center gap-2">
      {Object.entries(hidden).map(([name, value]) =>
        value ? (
          <input key={name} type="hidden" name={name} value={value} />
        ) : null,
      )}
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">
          <SearchIcon size={15} />
        </span>
        <input
          type="search"
          name="q"
          defaultValue={defaultValue}
          placeholder={placeholder}
          aria-label={placeholder}
          className="field h-10 w-[15rem] rounded-xl pl-9 text-[13px]"
          data-testid="admin-search"
        />
      </div>
      <button type="submit" className="btn btn-secondary btn-sm">
        Search
      </button>
    </form>
  );
}

/**
 * Server-side pagination below the card. Prefer a bigger page over infinite
 * scroll: an operator needs a stable, linkable view they can come back to.
 */
export function Pagination({
  page,
  pageSize,
  total,
  hrefFor,
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefFor: (page: number) => string;
}) {
  if (total === 0) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-small text-ink-3" data-testid="page-range">
        {from}–{to} of {total}
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link
            href={hrefFor(page - 1)}
            className="btn btn-secondary btn-sm"
            data-testid="page-prev"
          >
            Previous
          </Link>
        ) : (
          <span className="btn btn-secondary btn-sm" aria-disabled="true">
            Previous
          </span>
        )}
        {page < lastPage ? (
          <Link
            href={hrefFor(page + 1)}
            className="btn btn-secondary btn-sm"
            data-testid="page-next"
          >
            Next
          </Link>
        ) : (
          <span className="btn btn-secondary btn-sm" aria-disabled="true">
            Next
          </span>
        )}
      </div>
    </div>
  );
}
