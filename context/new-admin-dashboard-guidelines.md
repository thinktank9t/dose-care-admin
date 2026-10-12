# Admin Dashboard — UI/UX Guidelines (ocean revamp)

How to build an admin dashboard that looks and behaves like the rest of Dose
Care **after the revamp**. Read
[`payment-new-ui-ux-guidance.md`](./payment-new-ui-ux-guidance.md) first — this
file assumes its tokens, three themes, utilities and state patterns, and only
adds what a dashboard needs on top.

This file **supersedes** [`admin-dashboard-guidelines.md`](./admin-dashboard-guidelines.md),
which documents the old sage, light-only system. Where the two disagree, this
one wins; where this file and `payment-new-ui-ux-guidance.md` disagree, **that
file wins — fix this one.**

**The reference implementation in the repo is
`src/app/[locale]/admin/payments/page.tsx` + `src/components/AdminPaymentActions.tsx`
+ `src/components/StatusPill.tsx`.** Everything below either describes that page
or extends it. Sections marked **NEW** are not in the codebase yet.

> **State of the code, as of this revision.** `src/app/globals.css` is still the
> sage, light-only system (`--accent: #2f7d63`, no `--pending`, no dark block,
> `--radius-card-sm: 16px`, flat-pulse `.skeleton`), and `StatusPill` still maps
> `pending → bg-warn-soft text-warn`. **Do not build a dashboard on top of that.**
> Land steps 1–3 of the revamp (token swap, dark + high-contrast themes, 130%
> text) first; otherwise every value below is wrong at runtime.

---

## 0. What changed from the previous admin guidelines

| | Old admin guidelines | This revision |
|---|---|---|
| Base doc | `ui-ux-guidelines.md` | `payment-new-ui-ux-guidance.md` |
| Accent | sage `#2F7D63` | ocean `#0B5575` / `#5BB8DC` dark |
| Themes | light only, "no dark mode in this project" | light + dark + high-contrast override |
| Pending status | `bg-warn-soft text-warn` (amber warn) | `bg-pending-soft text-pending` — `--warn` is now crimson |
| Chart palette | sage-derived, light only, `--warn`/`--danger` doubling as series | ocean-derived, **two validated palettes** (light + dark), status hues not reused |
| Text size | fixed | must survive the app's 1.3 multiplier → `min-h`, never `h`, on anything with text |
| Skeletons | flat pulse | one 1200ms shimmer sweep per layout |
| Icon stroke | 2 | 1.6 (1.8 inside pills, 2.2 on a filled button) |
| Field radius | 14px | 12px |

Five things to fix in any admin code written against the old file:
`bg-warn-soft` on pending pills, `h-9` / `h-10` on filter pills and in-table
fields, the sage chart tokens, the "no dark mode" assumption in charts, and
`--radius-card-sm: 16px`.

---

## 1. What an admin screen is for here

An operator opens this to **make a judgement and record it**: match a
transaction ID against a bKash statement, then verify or reject. That shapes
everything:

- **The data is the interface.** No decorative hero, no illustration, no welcome
  copy. Title, one line of instruction, filters, table.
- **The instruction line is operational, not marketing.** The existing subtitle
  is *"Match each Transaction ID against the bKash statement before verifying."*
  Keep that register: tell the operator what to check.
- **Exact values must be readable one character at a time** — hence `font-mono`
  plus letter-spacing on IDs. This is the one **[web-only]** type decision the
  app has no counterpart for, and the admin table is its main home.
- **Nothing is irreversible without being obvious**, and a second operator
  acting first must be reported, not silently overwritten (`doneNoop`:
  *"Already processed by someone else."*).
- **An operator works in whichever theme they left the browser in.** A dense
  table is the easiest place to accidentally ship light-only. Build and review
  every admin screen in light *and* dark before calling it done.

---

## 2. Routes and access

```
/[locale]/admin/payments          ← exists; ?status=pending|verified|rejected|all
/[locale]/admin                   ← NEW: overview (KPIs + recent activity)
/[locale]/admin/users             ← NEW
/[locale]/admin/plans             ← NEW
```

Every admin page:

```tsx
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin");
  return { title: t("title"), robots: { index: false, follow: false } };
}
```

Then, in the page body, in this order:

1. `setRequestLocale(rawLocale)`
2. `const session = await getSession()` — falsy → `redirect({ href: "/sign-in?next=%2Fadmin%2F…", locale })`
3. `await isAdminSession(session)` — false → render the **forbidden card**, don't redirect:

```tsx
<div className="container-page py-14">
  <div className="card max-w-md p-7" data-testid="admin-forbidden">
    <h1 className="text-[1.625rem]">{t("forbiddenTitle")}</h1>
    <p className="mt-3 text-ink-2">{t("forbiddenBody")}</p>
  </div>
</div>
```

4. Only then read data.

`text-[1.625rem]` rather than `text-[26px]`: off-scale heading sizes are the
accepted escape hatch, but they go in `rem` so the 130% text setting still
scales them.

**Theme and contrast are resolved on the server**, from the same cookie the
public site uses, and rendered as `data-theme` / `data-contrast` on `<html>` in
`[locale]/layout.tsx`. The admin layout adds nothing here — it must not do a
client-side theme init of its own, or the dashboard flashes where the marketing
pages don't.

Admin links stay **unlinked from the public header** on purpose (see the comment
in `Header.tsx`) — the routes work, they just aren't advertised. If you add
dashboard navigation, put it inside the dashboard shell, not in the public nav.

---

## 3. Shell **NEW**

The existing admin page uses the plain public shell (`Header` / `main` /
`Footer`) and that is correct for a single table. A multi-page dashboard wants a
sidebar — add it as a nested layout at `src/app/[locale]/admin/layout.tsx` so the
public chrome is untouched.

Rules:

- **Keep the public `Header`.** Same 64px sticky bar, same brand mark, same
  language switcher, same theme/contrast toggles. The dashboard is the same
  product, not a separate app.
- **Drop the public `Footer`** inside `/admin` — it is marketing navigation.
- Sidebar: 240px, `border-r border-line`, `bg-bg-alt/40`, sticky under the
  header (`top-16`), collapses to a horizontally scrolling pill row under `sm`.
- Widen the content: `.container-page` caps at 1040px, which is right for prose
  and wrong for a table. Use `w-full px-[var(--gutter)]` (or add a
  `@utility container-wide { max-width: 1440px }` to `globals.css`) inside the
  admin layout, and keep the 22px gutter so it still lines up with the header.
- **The sidebar has no fixed height and no `overflow: hidden`.** At 130% text
  the nav labels wrap; let the column grow.

```tsx
// src/app/[locale]/admin/layout.tsx
<div className="flex min-h-[calc(100svh-4rem)]">
  <aside className="sticky top-16 hidden w-60 shrink-0 self-start border-r border-line bg-bg-alt/40 py-8 sm:block">
    <nav aria-label={t("menu")} className="space-y-1 px-3">
      {/* NavItem per route */}
    </nav>
  </aside>
  <div className="min-w-0 flex-1">{children}</div>
</div>
```

Sidebar item, active and idle — reuse the filter-pill logic, not a new treatment:

```tsx
<Link
  href={href}
  aria-current={active ? "page" : undefined}
  className={`flex min-h-11 items-center gap-2.5 rounded-full px-4 py-2.5 text-[0.875rem] font-medium transition-colors ${
    active ? "bg-accent-soft text-accent-ink" : "text-ink-2 hover:text-ink"
  }`}
>
```

`min-h-11` (44px), not `h-11`. The active pair is `--accent-soft` +
`--accent-ink`, which is 11.2:1 in light and holds in dark — never
`--accent` + white, which is wrong in dark mode (`--on-accent` is `#04202C`
there, not white).

---

## 4. Page header

```tsx
<div className="container-page py-12">
  <h1>{t("title")}</h1>
  <p className="mt-2 text-ink-2">{t("subtitle")}</p>
```

That's it — no breadcrumb, no avatar row, no action bar. `h1` is Fraunces at
weight **400** (500 under `html[lang="bn"]`, with `letter-spacing: 0`); don't
bold it to make it feel more "dashboard". A page-level action (export, "add
plan") goes on the same line as the `h1`, right-aligned, as a `.btn-sm`:

```tsx
<div className="flex flex-wrap items-start justify-between gap-4">
  <div>
    <h1>…</h1>
    <p className="mt-2 text-ink-2">…</p>
  </div>
  <Link href="…" className="btn btn-secondary btn-sm">…</Link>
</div>
```

`flex-wrap` and `gap-4` are not optional — Bangla titles are longer, and at 130%
text an English title wraps too.

---

## 5. Filters

One row, directly above the content it scopes, and **the filter is in the URL**
(`?status=pending`) so the view is linkable, refresh-safe and server-rendered.
Validate against a literal list and fall back to a default:

```tsx
const FILTERS: AdminFilter[] = ["pending", "verified", "rejected", "all"];
const filter = FILTERS.includes(status as AdminFilter) ? (status as AdminFilter) : "pending";
```

Default to the filter that represents **work to do** (`pending`), not `all`.

Markup — pills, selected one in accent-soft, count pushed to the end:

```tsx
<nav className="mt-6 flex flex-wrap gap-2" aria-label={t("colStatus")}>
  {FILTERS.map((f) => (
    <Link key={f} href={`/admin/payments?status=${f}`}
      aria-current={f === filter ? "page" : undefined}
      className={`pill min-h-9 px-4 text-[0.8125rem] ${
        f === filter ? "bg-accent-soft text-accent-ink"
                     : "border border-line bg-surface text-ink-2"}`}>
      {filterLabel[f]}
    </Link>
  ))}
  <span className="ml-auto self-center text-small text-ink-3">{t("count", { count: rows.length })}</span>
</nav>
```

`min-h-9`, not `h-9` — a fixed-height pill clips its label at 130%.

**Four options stay pills. Two or three mutually exclusive *views* use
`.segmented`** — the control ported from the app's `SegmentedControl`: a
`--bg-alt` track with `p-1` and 12px radius, options 44px tall at 9px radius,
active filled `--accent-soft` with `--accent-ink` at weight 500, inactive
transparent `--ink-2` at 400. A day/week/month toggle above a chart is a
segmented control; the status filter is not.

If you add a date range **NEW**, it goes first in that same row (presets —
today / 7 / 30 / 90 days — before any custom range), it is also a URL param, and
**it scopes every KPI, chart and table on the page** so the numbers can't
disagree. Never give one card its own range.

A search box **NEW** is a `.field min-h-10 rounded-xl text-[0.8125rem]` in the
same row, submitting a `?q=` param — server-side filtering, not client-side
filtering of a page of rows. Note the field keeps 12px+ radius and the
`--accent` focus border plus the 3px `--accent-soft` ring; don't restyle focus
per control.

---

## 6. KPI tiles **NEW**

Four tiles max, in a `.card` grid above the table. The contract:

- **label** — `label-micro`, sentence meaning, no trailing colon. Remember it
  becomes 12px / `letter-spacing 0.6px` and loses `uppercase` under
  `html[lang="bn"]`, and goes to weight 600 under `[data-contrast="high"]`.
  Both are handled by the utility — don't re-implement the label inline.
- **value** — the number, in `font-heading` at `text-[2rem]`–`text-[2.375rem]`.
  (`PriceCards` sets big numbers in Fraunces at `leading-none`; the dashboard
  follows that, not a sans, because the serif *is* this brand's display face.)
  Use the font's default proportional figures here — **not** `tabular-nums`,
  which makes a display-size number look gappy.
- **delta** — optional, signed, against a *named* period ("vs last 7 days").
  Always a glyph **and** the sign, never color alone. `AppIconName` has no
  `chevronUp`, so rotate `chevronDown` rather than inventing a name the app
  set doesn't have.
- **trend** — optional 12-point sparkline, hairline in `--ink-3` with the
  current period in `--accent` (see §7 for the mark specs).

```tsx
<section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-labelledby="kpis">
  <h2 id="kpis" className="sr-only">{t("kpisHeading")}</h2>
  {tiles.map((k) => (
    <article key={k.key} className="card p-5" data-testid={`kpi-${k.key}`}>
      <p className="label-micro">{t(k.key)}</p>
      <p className="mt-2 font-heading text-[2rem] leading-none text-ink">{k.value}</p>
      {k.delta ? (
        <p className={`mt-2 flex items-center gap-1 text-small ${k.good ? "text-accent-ink" : "text-warn"}`}>
          <Icon name="chevronDown" size={14} className={k.up ? "rotate-180" : ""} aria-hidden />
          {k.delta} <span className="text-ink-3">{t("vsPrev")}</span>
        </p>
      ) : null}
    </article>
  ))}
</section>
```

Rules:
- Money through `formatBdt` (`৳ 1,234`, Latin digits in both locales), counts
  through ICU plurals — no raw `toString()`.
- The value goes in `--ink`. **Never `--ink-3`** — it is 2.6:1 and reserved for
  micro labels, placeholders and the `—` stand-in.
- Direction color: good → `text-accent-ink`, bad → `text-warn`. `--warn` is the
  new crimson and reads as urgency, which is the right register for "pending
  count is up". `--danger` stays for destructive controls and blocking states;
  `--pending` stays for the payment status. Don't invent a fifth family for a
  delta.
- A tile is **not a link** unless the whole tile navigates; if it does, make it
  an `<a>` wrapping the card and let the global focus ring apply.
- `0` is a real value. Render `0`, not `—`. Use `—` (`text-ink-3`) only for
  *unknown*.
- One hero figure per view at most. Don't give all four tiles display size.
- `.card` has **no shadow** and an 18px radius. Inner blocks inside a tile
  (a sparkline well, a note) use `--radius-card-sm` = **12px**.

### Operational notices

A dashboard-level alert ("14 payments older than 48h", "plan expiring for N
users") uses the app's banner shell, not a toast and not a bare red box:
tint-filled block at 18px radius, a 40px circular icon chip at `color/14%`,
title at body/600 in the state color, hint at `text-small` in the same color at
85% alpha, trailing `chevronRight` if it navigates, and the **whole block is one
hit target** with one `aria-label` combining title and hint. Severity picks the
family: `--warn` for time-pressure, `--danger` for blocking.

---

## 7. Charts **NEW**

Charts are optional here. A single number belongs in a tile, and a 20-row
comparison belongs in a table — reach for a chart only for **change over time**
(payments per day) or **composition** (plan mix).

### Chart tokens

Add these to `globals.css` alongside the revamp tokens. Both palettes are
derived from the ocean brand hue and **validated with
`dataviz/scripts/validate_palette.js`** against this project's real surfaces —
light on `#FFFFFF` cards *and* the `#F3F6F8` page, dark on `#15232C` cards *and*
the `#0B141A` page. Every slot passes the lightness band, the chroma floor,
adjacent-pair CVD separation, the normal-vision floor and 3:1 contrast in both
modes.

```css
:root {
  /* Categorical — assign in this fixed order, never cycled. */
  --series-1: #0e73a3;  /* ocean (brand hue) */
  --series-2: #c2762a;  /* amber */
  --series-3: #a8336b;  /* magenta */
  --series-4: #2f9e7a;  /* teal-green */
  --series-5: #5c4ba8;  /* violet */
  --series-6: #7a7a1e;  /* olive */

  /* Sequential — one hue, light→dark (heatmaps, density). */
  --seq-100: #dbf1fd; --seq-200: #badff6; --seq-300: #8fc8e9; --seq-400: #61add6;
  --seq-500: #2e8fbd; --seq-600: #066f99; --seq-700: #034b69;

  /* Ordinal — discrete ordered steps (funnel, tiers). Starts darker so the
     lightest step still clears 2:1 on the card (2.22:1). */
  --ord-1: #67b7e2; --ord-2: #3998c7; --ord-3: #087aa7; --ord-4: #005a7d;

  /* Diverging — ocean ↔ amber, neutral --bg-alt midpoint.
     Not green↔red: that pair is unreadable for the most common CVD. */
  --div-neg-3: #126c93; --div-neg-2: #438eb5; --div-neg-1: #7baecb;
  --div-mid:   #e6edf1;
  --div-pos-1: #c69d7b; --div-pos-2: #ae7746; --div-pos-3: #90520a;

  /* Chart chrome — ink-derived, like --line. */
  --grid: rgba(15, 28, 36, 0.07);
  --axis: rgba(15, 28, 36, 0.18);
}

/* Dark is SELECTED, not inverted — its own steps from the same hues,
   validated against #15232c. Mirror the theme plumbing in
   payment-new-ui-ux-guidance.md §2: the system-dark media query, the
   explicit [data-theme="dark"] block, and nothing else. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --series-1: #2579a6; --series-2: #d1780a; --series-3: #ab4a75;
    --series-4: #2fa881; --series-5: #7666ca; --series-6: #8b8b39;

    --seq-100: #0a3245; --seq-200: #054661; --seq-300: #075a7c; --seq-400: #0c6f98;
    --seq-500: #1884b4; --seq-600: #459bc7; --seq-700: #74b6da;

    --ord-1: #0a6084; --ord-2: #1579a5; --ord-3: #3993c0; --ord-4: #68aed4;

    --div-neg-3: #3290be; --div-neg-2: #31789c; --div-neg-1: #32617a;
    --div-mid:   #111e26;
    --div-pos-1: #755234; --div-pos-2: #966335; --div-pos-3: #b6753a;

    --grid: rgba(234, 241, 244, 0.08);
    --axis: rgba(234, 241, 244, 0.20);
  }
}
:root[data-theme="dark"] { /* same block again — explicit user choice */ }
```

Note the sequential anchor **flips in dark**: `--seq-100` is the step nearest the
surface in each mode, so "low value" always means "closest to the background".

Hard rules:
- **Slot order is a safety mechanism, not taste.** Series 1 is always
  `--series-1`. Adding or filtering a series must never repaint the survivors —
  color follows the entity, never its rank.
- **Scatter / bubble / small-multiple forms cap at three series** (slots 1–3).
  Those put every pair on screen at once; slots 1–3 are the set that clears the
  all-pairs separation floor in both modes (worst pair ΔE 10.1 light / 9.5 dark).
  Fold the rest into "Other" or facet. A fourth series in an all-pairs form is a
  chart-form problem, not a palette problem — don't recolor to fix it.
- **Never a dual-axis chart.** Two measures of different scale → two charts, or
  index both to a common base.
- **Sequential is one hue**, light→dark. Never a rainbow, never a hue at a
  diverging midpoint.
- **`--seq-100` through `--seq-400` sit below 3:1** (1.17 / 1.4 / 1.81 / 2.48 on
  a light card) by design — they are heatmap *fills*, so a cell wearing one needs
  a visible value label or the table view. They are never a line, a point or the
  only encoding.
- **Status colors stay reserved.** `--pending` / `--accent` / `--danger` mean
  pending / verified / rejected, and `--warn` means urgency. None of them is
  "series 7" — that is why the categorical ramp above deliberately avoids them,
  unlike the old sage set, which reused `--warn` and `--danger` as slots 3 and 5.
  When a series genuinely *means* a status (a "rejected per day" line), it wears
  the status token and nothing else in that chart does.

### Marks and chrome

Thin marks. 2px lines, ≥8px point markers, 4px rounded bar ends anchored to the
baseline, a 2px `--surface` gap between adjacent or stacked fills, and a 2px
`--surface` ring where marks overlap. Gridlines are hairlines in `--grid`, the
baseline in `--axis`, tick labels in `--ink-2` at `text-[0.8125rem]` with
`font-variant-numeric: tabular-nums` (axis ticks *are* a column, so tabular is
right here — unlike a KPI value).

**Text never wears the series color.** Values, labels and legend text stay in
`--ink` / `--ink-2` / `--ink-3`; identity comes from a colored dot or line-key
*beside* the text.

Charts animate under the same rule as everything else: `transform` and `opacity`
only, 120ms, and nothing loops. Under `prefers-reduced-motion: reduce` the chart
renders in its final state with no draw-on.

### Interaction and accessibility

- Ship hover by default: crosshair + tooltip on line/area, per-mark tooltip on
  bar/dot/cell. Hit targets larger than the mark.
- ≥2 series → a legend is always present; ≤4 series are also directly labeled,
  so identity is never color-alone. A single series needs no legend — the title
  names it.
- Every chart has a table equivalent reachable from the same card (a
  `<details>` holding a real `<table>` is enough) — that is also the relief
  channel the sub-3:1 sequential steps require.
- Wrap the chart in `figure` + `figcaption`, or give the SVG `role="img"` and an
  `aria-label` stating the takeaway, not "chart of payments".
- Under `[data-contrast="high"]` the chart chrome follows `--line` (which
  thickens to 0.4 alpha); the series hues do not change.
- **Re-run the validator after any palette edit**, once per mode:
  ```
  node scripts/validate_palette.js "#0e73a3,#c2762a,#a8336b,#2f9e7a,#5c4ba8,#7a7a1e" --mode light --surface "#ffffff"
  node scripts/validate_palette.js "#2579a6,#d1780a,#ab4a75,#2fa881,#7666ca,#8b8b39" --mode dark  --surface "#15232c"
  ```
  Add `--pairs all` on the first three slots for scatter/bubble/map forms. Don't
  reason about ΔE by hand.

---

## 8. Data table

The canonical spec, as implemented on `/admin/payments`.

### Frame

```tsx
<div className="card mt-5 overflow-x-auto">
  {rows.length === 0 ? (
    <p className="p-6 text-ink-2">{t("empty")}</p>
  ) : (
    <table className="w-full min-w-[860px] border-collapse text-[0.875rem]">
```

- The card clips and scrolls the table; the table declares a `min-w-[…]` so
  columns never crush. **Horizontal scroll is the accepted mobile behaviour for
  a dense admin table** — the card edge makes it discoverable.
- Body text drops to `0.875rem` (one step under body) for density. Don't go
  smaller, and keep it in `rem` so it tracks the text-size setting.
- Empty is not an error: a plain sentence in `--ink-2`, no danger tint, no
  illustration required.

### Header

```tsx
<thead>
  <tr className="border-b border-line bg-bg-alt/60 text-left">
    <Th>{t("colUser")}</Th>
    …
```

with the local helper:

```tsx
function Th({ children }: { children: React.ReactNode }) {
  return <th scope="col" className="label-micro px-4 py-3 font-semibold">{children}</th>;
}
```

`label-micro` on `<th>` is the table-header treatment across the app
(`ComparisonTable` uses the same), and it carries the Bangla and high-contrast
overrides for free. Add `sticky top-16 z-10` to the `thead` cells for long
tables **NEW** — `top-16` because the public header stays.

### Rows and cells

```tsx
<tr className="border-b border-line align-top last:border-b-0"
    data-testid="admin-row" data-trx={p.trx_id}>
  <td className="px-4 py-3">…</td>
```

- `px-4 py-3` everywhere. `align-top`, because a cell may hold three stacked
  lines.
- `border-b border-line last:border-b-0` — no zebra striping, no row hover fill.
  `--line` is a 10% ink alpha in both themes; never a solid grey.
- **No row height.** A row grows; at 130% text every cell is two lines.
- Every row carries a `data-testid` and the natural key as a `data-*` attribute.
- **Identity cells stack**: primary in `font-medium text-ink`, secondary in
  `text-small text-ink-2`, tertiary in `text-small text-ink-3`.
- **Exact values get `font-mono`** (`tracking-wider` for TrxIDs) — the one thing
  on this page the app has no equivalent for, and the reason it exists.
- **Money** via `formatBdt`; **dates** via `formatDateTime(value, locale)` in
  `text-ink-2`, always `Asia/Dhaka`. Never a bare ISO string, never
  `toLocaleString` at a call site.
- **Missing values are `—`**, not blank, not "N/A".
- **Status cell** = `<StatusPill status={…} />`, with the audit trail under it in
  `text-[0.75rem]`: who reviewed it, when, and the note in quotes.
- **Actions column** renders the control only when the row can be acted on;
  otherwise `<span className="text-ink-3">—</span>`.

### The status pill — updated mapping

`StatusPill` currently maps `pending → bg-warn-soft text-warn`. Under the new
palette `--warn` is crimson `#C2334F` and reads *"you missed a dose"*, which is
wrong for "we are checking your payment". Fix it to the pending family and keep
the glyph:

```tsx
const STYLES: Record<PaymentStatus, string> = {
  pending: "bg-pending-soft text-pending",
  verified: "bg-accent-soft text-accent-ink",
  rejected: "bg-danger-soft text-danger",
};
const GLYPH: Record<PaymentStatus, AppIconName> = {
  pending: "clock", verified: "checkCircle", rejected: "alertCircle",
};
```

The glyph is 11px at stroke **1.8** and is not optional — `StatusPill` exists
partly "so the status isn't conveyed by color alone". `--warn` on the web is for
genuine urgency (an expiring subscription, a payment about to lapse), and if you
do use `text-warn` on `bg-warn-soft` it is 4.4:1, so 13px/600 or larger, always
with a leading glyph.

### Sort, pagination, bulk **NEW**

- Sort: `?sort=submitted&dir=desc`, header becomes a `<button>` inside the
  `<th>` with `aria-sort` on the `<th>`. Keep the arrow glyph in `--ink-3` at
  stroke 1.6.
- Pagination: server-side via `?page=`, controls below the card —
  `btn btn-secondary btn-sm` prev/next plus `text-small text-ink-3` range text.
  Prefer increasing the page size over adding infinite scroll; an operator needs
  a stable, linkable view.
- Bulk selection: only if an operator genuinely acts on many rows at once. The
  toolbar appears **above** the table as a `.card p-4` strip with the count and
  the actions; bulk destructive actions need an explicit confirm step, which
  single-row actions do not. The confirm is a card on the page, not a modal —
  the app's bottom sheet has no web counterpart here.

### Mobile alternative **NEW**

For a table with ≤5 meaningful fields, render a card list under `sm` instead of
scrolling — the account page's payment list is the pattern to copy
(`<li className="card p-5">` with the key value and the `StatusPill` on one
`flex-wrap` row, metadata beneath, admin note in a `rounded-xl bg-bg-alt/70`
block at `--radius-card-sm` = 12px). Keep the table from `sm` up, and keep the
single-column, generously-inset feel the app has at 360px.

---

## 9. Row actions and mutations

The `AdminPaymentActions` pattern, which every row-level mutation should follow:

```tsx
"use client";
const [state, action, pending] = useActionState<AdminActionState, FormData>(reviewPayment, { status: "idle" });

<form action={action} className="flex w-56 flex-col gap-2" aria-busy={pending}>
  <input type="hidden" name="paymentId" value={paymentId} />
  <input name="note" maxLength={500} placeholder={t("notePlaceholder")}
         className="field min-h-10 rounded-xl text-[0.8125rem]" data-testid="admin-note" />
  <div className="flex gap-2">
    <button type="submit" name="action" value="verify" disabled={pending}
            className="btn btn-primary btn-sm flex-1" data-testid="admin-verify">
      {pending ? <Spinner size={14} /> : null}
      {pending ? t("working") : t("verify")}
    </button>
    <button type="submit" name="action" value="reject" disabled={pending}
            className="btn btn-danger btn-sm flex-1" data-testid="admin-reject">
      {t("reject")}
    </button>
  </div>
  {message ? <p role="status" className="text-[0.75rem] text-ink-2" data-testid="admin-result">{message}</p> : null}
</form>
```

What matters in it:

1. **A real `<form>` with a server action**, so it works before hydration. One
   form per row; two submit buttons distinguished by `name="action"`.
2. **`pending` drives everything** — `disabled`, `aria-busy`, the spinner, and
   the label swap to `t("working")`. The affirmative button is the one that
   shows progress, and it **keeps its label**: swap the leading icon for the
   spinner, never collapse to a bare spinner.
3. **The note field is `min-h-10`, not `h-10`**, at 12px radius, and it inherits
   the `--accent` focus border plus the 3px `--accent-soft` ring. The full-size
   `.field` is 16px font to dodge iOS zoom-on-focus; the compact in-table
   variant is the documented exception.
4. **The optional note is part of the decision**, placed above the buttons, and
   its placeholder says where it will be seen: *"Note (optional, shown to the
   user)"*. State the audience of free text.
5. **Every outcome has translated copy**, including the ones nobody plans for:
   `doneVerified`, `doneRejected`, `doneNoop` ("Already processed by someone
   else"), `errForbidden`, `errInvalid`, `errUnknown`. Map the union to a string
   in the component; never render a raw error.
6. **The result is inline and `role="status"`** — no toast, no modal. Failures
   get `role="alert"`. There is no toast system in this project; don't add one.
7. **No confirmation dialog for a single reversible row action.** `btn-danger`
   is a soft `--danger-soft` fill with `--danger` text at the *same size* as
   Verify — consequence is signalled through color family, not visual shouting —
   and the audit trail is the safety net. Reserve confirms for bulk and for
   anything that can't be undone.
8. **One `.btn-primary` per view.** In a table that means one per row's action
   group, and no page-level primary button competing with it.

Where an action has no note and no state, a bare submit button is fine
(`signOut` on the account page: `<form action={signOut}><button className="btn btn-secondary btn-sm">`).

---

## 10. Loading

Add `loading.tsx` to **every** admin route:

```tsx
import { PageLoading } from "@/components/PageLoading";
export default function Loading() { return <PageLoading cards={4} />; }
```

`cards` should roughly match the shape below the title — 4 for a table page.
Remember: **no `loading.tsx` at `[locale]`**; one there would wrap the
`[...rest]` catch-all and streaming the shell commits a 200 before `notFound()`
runs, so unknown paths would stop answering 404. The rationale lives in
`PageLoading.tsx` — keep it there.

In-place skeletons follow the revamped shimmer, not the old flat pulse:

- Placeholders are `--bg-alt` fills with a 1px `--line` border at 12px radius,
  shaped with height/width utilities to match the real content, so nothing
  jumps when data lands. A KPI row skeleton is four `.card p-5` blocks with a
  short bar and a tall bar inside; a table skeleton is header + *n* row bars at
  the real row height.
- **One sweep per layout, not per box.** A single container-level overlay,
  1200ms linear, infinite, so every placeholder shimmers in sync. Band:
  transparent → white **35%** light / **8%** dark → transparent at stops
  `10% / 50% / 90%`. The low dark alpha is deliberate; a full-strength sweep
  glares on the dark palette.
- Wrap in `role="status" aria-busy="true"` with a `<Spinner size={15} />` plus a
  wording line in `text-small text-ink-3`. Skeletons themselves are
  `aria-hidden`.
- Under `prefers-reduced-motion: reduce` the sweep stops, skeletons freeze at
  `opacity .8`, and the spinner slows to 2s rather than stopping — it is the
  only proof work is still running.
- A widget that fails must not take the page down. Degrade to a soft-danger
  block with a retry inside that card:
  ```tsx
  <div className="mt-4 rounded-2xl bg-danger-soft px-4 py-4" role="alert">
    <p className="text-small text-danger">{t("widgetError")}</p>
    <button className="btn btn-secondary btn-sm mt-3" onClick={retry}>{t("retry")}</button>
  </div>
  ```

---

## 11. Translations to add

A dashboard is not done until `messages/bn.json` matches `messages/en.json` —
`npm run check:messages` runs in CI. Extend the existing `admin` namespace (or
add a `dashboard` one); match its tone (terse, operational, sentence case):

```
admin.menu, admin.kpisHeading, admin.kpiPendingCount, admin.kpiVerifiedToday,
admin.kpiRevenueBdt, admin.kpiOldestPending, admin.vsPrev, admin.rangeToday,
admin.range7, admin.range30, admin.range90, admin.searchPlaceholder,
admin.sortBy, admin.pageRange, admin.prev, admin.next, admin.selectedCount,
admin.bulkVerify, admin.bulkConfirm, admin.chartTitleDaily, admin.showTable,
admin.widgetError, admin.retry
```

Counts use ICU plurals (`"{count, plural, one {# payment} other {# payments}}"`).
Anything with a number interpolates (`{count}`, `{email}`, `{date}`) — never
string concatenation. Build the layout for Bangla's longer strings:
`whitespace-nowrap` on buttons and nav items, `flex-wrap` on action rows,
`min-w-0` + `truncate` on anything holding a name, `break-all` on raw emails.
The web ships en + bn only; don't widen the set as part of a dashboard.

---

## 12. Ship checklist

- [ ] Revamp steps 1–3 landed first: ocean tokens, dark + high-contrast blocks, `--pending`, 130%-safe layout. No dashboard on the sage palette.
- [ ] `generateMetadata` returns `robots: { index: false, follow: false }`.
- [ ] Unauthenticated → `redirect({ href: "/sign-in?next=…", locale })`; non-admin → forbidden card with `data-testid`.
- [ ] `loading.tsx` present, `cards` matching the page shape; **none at `[locale]`**.
- [ ] Empty, in-place loading, error (with retry) and forbidden states all render.
- [ ] Filters, search, sort, page and date range are all URL params; default filter is "work to do"; the range scopes every tile, chart and table.
- [ ] Table: `min-w-[…]` inside `overflow-x-auto .card`, `label-micro` `<th scope="col">`, `px-4 py-3`, `align-top`, `last:border-b-0`, sticky `thead top-16` if long.
- [ ] `StatusPill`: pending on `bg-pending-soft text-pending`, each status carrying its glyph. No `--warn` for pending.
- [ ] IDs in `font-mono`; money through `formatBdt`; dates through `formatDateTime` (Asia/Dhaka); missing values `—`; `0` rendered as `0`.
- [ ] No readable data in `--ink-3`; no white text on `--accent` (dark `--on-accent` is `#04202C`).
- [ ] No fixed `height` on anything containing text — `min-h` on pills, fields, buttons, nav items, rows.
- [ ] Mutations: real `<form>` + server action, `pending` → `disabled` + `aria-busy` + spinner + "Working…", label kept, every union branch has copy, result inline in `role="status"`.
- [ ] Destructive = `btn-danger` (soft fill, same size as the affirmative); confirm only for bulk/irreversible, and as a card, not a modal.
- [ ] One `.btn-primary` per view. No icon-only primary actions; primary targets ≥48px.
- [ ] Icons: inline SVG, stroke 1.6 (1.8 in pills, 2.2 on a filled button), named after `AppIconName`, `aria-hidden`.
- [ ] Skeletons: `--bg-alt` + `--line` at 12px radius, sized to the real content, **one shimmer sweep per layout**, 8% band in dark.
- [ ] Charts (if any): tokens from §7 in fixed slot order, both modes present and *selected* not inverted, no dual axis, legend for ≥2 series, table fallback, `aria-label` stating the takeaway, validator re-run per mode.
- [ ] Global focus ring intact and not replaced per component; skip link to `#main` still reachable.
- [ ] `data-testid` + `data-*` state hooks on everything the e2e suite drives.
- [ ] Both `messages/en.json` and `messages/bn.json` updated; `npm run check:messages` passes.
- [ ] Playwright matrix covers (mobile 360 + desktop) × (light + dark); high contrast and 130% text get at least one smoke run.
- [ ] Usable at 360px and legible in Bangla (longer strings, `flex-wrap`, `min-w-0 truncate`, `label-micro` not uppercase).
- [ ] `npm run lint && npm run typecheck` clean.
