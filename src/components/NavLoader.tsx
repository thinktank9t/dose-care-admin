"use client";

import { useLinkStatus } from "next/link";

import { Spinner } from "@/components/Spinner";

/**
 * The loader shown while a filter chip's navigation is in flight.
 *
 * Why this needs to exist at all. Every admin route is dynamic (`ƒ` in the
 * build output), so clicking a chip is a real server roundtrip: the page
 * re-renders and re-queries Supabase — seven requests on the payments page,
 * six on users. But a chip only changes `?status=`, not the route segment, so
 * the segment's `loading.tsx` boundary does **not** re-suspend. React keeps
 * the previous table on screen until the new payload lands, which is correct
 * behaviour and also completely silent: the operator clicks, nothing moves,
 * and the natural next move is to click again.
 *
 * `useLinkStatus` is Next's answer to exactly that case — a dynamic
 * destination whose `loading.js` cannot cover the transition. It reports the
 * pending state of the nearest ancestor `<Link>`, so this stays a real
 * anchor: middle-click, open-in-new-tab and a pre-hydration click all keep
 * working, which a `useTransition` + `router.push()` button would have cost.
 *
 * Two deliberate choices in the markup:
 *
 *   - **`pointer-events-none`.** The overlay is a child of the `<a>`, so
 *     without it every click anywhere on the dimmed screen would re-trigger
 *     the same navigation. It also means the loader never blocks the
 *     operator, which for a ~200ms wait is the right trade — this reports
 *     work, it does not guard it.
 *   - **`fade-in-delayed`.** It starts transparent and fades in after 120ms,
 *     so a navigation that finishes quickly shows nothing at all. A loader
 *     that strobes on every chip click is worse than no loader; see the note
 *     on the utility in globals.css.
 *
 * `position: fixed` is viewport-relative here because nothing between this
 * and the document root establishes a containing block — the one
 * `backdrop-filter` in the app is on `Header`, which is a sibling of the
 * content column, not an ancestor. A `transform` added to any wrapper above
 * `main` would break that, so prefer not to.
 */
export function NavLoader({ label = "Loading…" }: { label?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;

  return (
    // `role="status"` on the wrapper, wording inside it: the Spinner is
    // aria-hidden by design, so the thing that owns the announcement is the
    // text beside it (ui-ux §"States").
    <span
      role="status"
      className="fade-in-delayed pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-bg/70"
      data-testid="nav-loader"
    >
      <span className="card flex items-center gap-3 px-6 py-5">
        <Spinner size={26} className="text-accent" />
        <span className="text-small text-ink-2">{label}</span>
      </span>
    </span>
  );
}
