"use client";

import { useLinkStatus } from "next/link";
import { createPortal } from "react-dom";

import { Spinner } from "@/components/Spinner";

/**
 * The loader shown while a link's navigation is in flight.
 *
 * Why this needs to exist at all. Every admin route is dynamic (`ƒ` in the
 * build output), so clicking a filter chip, or an Edit link on the plans
 * page, is a real server roundtrip: the page re-renders and re-queries
 * Supabase — seven requests on the payments page, six on users, three on
 * plans. But those links change only the query string, not the route segment,
 * so the segment's `loading.tsx` boundary does **not** re-suspend. React keeps
 * the previous content on screen until the new payload lands, which is correct
 * behaviour and also completely silent: the operator clicks, nothing moves,
 * and the natural next move is to click again.
 *
 * `useLinkStatus` is Next's answer to exactly that case — a dynamic
 * destination whose `loading.js` cannot cover the transition. It reports the
 * pending state of the nearest ancestor `<Link>`, so these stay real anchors:
 * middle-click, open-in-new-tab and a pre-hydration click all keep working,
 * which a `useTransition` + `router.push()` button would have cost.
 *
 * **It portals to `document.body`, and that is not optional.** The overlay is
 * `position: fixed`, which is viewport-relative only while no ancestor
 * establishes a containing block — and `transform` does. `.btn:active` sets
 * `transform: translateY(1px)` with a 120ms transition back, so inside a
 * `.btn` link (the plans page's Edit and Add a plan) the overlay would anchor
 * to that small button for the press and the release, which is precisely when
 * it appears, and then snap to the middle of the screen. Rendering through a
 * portal takes the whole question off the table, here and for any wrapper
 * someone transforms later.
 *
 * `pointer-events-none` keeps it from swallowing clicks. The loader reports
 * work; it does not guard it, and for a ~200ms wait blocking the operator
 * would be the wrong trade.
 */
export function NavLoader({ label = "Loading…" }: { label?: string }) {
  const { pending } = useLinkStatus();

  // Also the guard that makes the portal safe: `useLinkStatus` returns
  // `{ pending: false }` during SSR, so `document` is never touched on the
  // server and there is no initial flash of the overlay.
  if (!pending) return null;

  return createPortal(
    // `role="status"` on the wrapper, wording inside it: the Spinner is
    // aria-hidden by design, so the thing that owns the announcement is the
    // text beside it (ui-ux §"States").
    <div
      role="status"
      className="fade-in-delayed pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-bg/70"
      data-testid="nav-loader"
    >
      <div className="card flex items-center gap-3 px-6 py-5">
        <Spinner size={26} className="text-accent" />
        <span className="text-small text-ink-2">{label}</span>
      </div>
    </div>,
    document.body,
  );
}
