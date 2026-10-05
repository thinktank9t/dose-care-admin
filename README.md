# Dose Care — Admin

An internal operator dashboard for Dose Care. Two or three people use it to
answer three questions: **who has paid and is waiting to be let in**, **who is
on premium right now**, and **what the plans cost**.

It is **almost** a read-only view of the production database: it does not
grant premium, edit a user or resolve a payment. The three things it does
write are listed under [What it writes](#what-it-writes).

**Stack:** Next.js 16 (App Router, Turbopack) · React 19 · Tailwind CSS v4 ·
Supabase (Postgres + Auth) · TypeScript.

---

## Quick start

**Prerequisites:** Node 20.9+ (22 LTS recommended) and npm. You also need
access to the Supabase project — the dashboard reads the live database, and
there is no local seed or fixture set.

```bash
npm install
cp .env.example .env.local   # then fill it in — see below
npm run dev                  # http://localhost:3000
```

`/` redirects to `/admin`. If you are not signed in you land on `/sign-in`; if
you are signed in but your address is not on the allowlist you get the
**forbidden card** rather than a redirect, because the route exists and you
are simply not on the list.

---

## Environment variables

Copy `.env.example` to `.env.local` and fill in all four. `.env.local` is
gitignored and must stay that way — it holds a credential that bypasses every
row-level security policy in the database.

| Variable | Where it comes from | Why it is needed |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → Data API | The project endpoint. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API keys → `anon` | Used for **auth only** — signing in, reading the session. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API keys → `service_role` | Every dashboard read. An operator needs *everyone's* rows, which `anon` is not entitled to. **Bypasses RLS — server-only, never import it into a client component.** |
| `ADMIN_EMAILS` | You decide | Comma-separated allowlist of operator addresses. See below. |

If `SUPABASE_SERVICE_ROLE_KEY` is missing or still a placeholder, pages render
a "Database key not configured" card with the fix in it instead of an empty
table.

### `ADMIN_EMAILS` — who is allowed in

Authorization is an **env allowlist**, not a database role. There is no
`admins` table, deliberately: inventing one would put the dashboard's access
control in the same rows the dashboard reads.

```bash
ADMIN_EMAILS=you@example.com,ops@example.com
```

- Compared case-insensitively, whitespace around each entry is trimmed.
- A signed-in address **not** on this list gets the forbidden card.
- Because it is an env var, **changing who can get in requires a redeploy.**
  For a two-operator finance tool that is the feature, not the limitation.

Signing in successfully is not the same as being authorized. Supabase owns
"is this credential valid"; this app owns "is this person an operator", and
those run at different moments for different reasons.

---

## Getting an operator account

**There is no sign-up screen, and passwords are not managed in this codebase.**
Accounts live in Supabase Auth, so you create them there:

1. **Supabase Dashboard → Authentication → Users → Add user**
2. Enter the email and a password, and tick **Auto Confirm User** (without it
   the account cannot sign in until the confirmation email is clicked).
3. Add that same email to `ADMIN_EMAILS` in `.env.local`, then restart
   `npm run dev`. Step 2 without step 3 gets you the forbidden card.

**Forgot a password, or need to rotate one?** Same place — Supabase Dashboard
→ Authentication → Users → the user's ⋯ menu → **Reset password**. Do not look
for this in the app; it is not there.

The sign-in form deliberately gives the same error for a wrong password and an
unknown address, so it cannot be used to discover which addresses have an
account.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on :3000 |
| `npm run build` | Production build (also regenerates typed routes) |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |

> Run `npm run build` after adding or renaming a route. Typed-route helpers
> like `PageProps<"/admin/payments">` are generated into `.next/types`, so
> `npm run typecheck` will report a missing route until a build regenerates
> them.

---

## Routes

| Route | What it is |
|---|---|
| `/` | Redirects to `/admin` — there is no public surface |
| `/admin` | Overview: four tiles, recent sign-ups, upcoming renewals, plans |
| `/admin/payments` | **The work queue.** Pending payments, matched against received bKash transactions |
| `/admin/users` | All users, filterable and searchable, 25 per page |
| `/admin/users/[id]` | One user's full record |
| `/admin/plans` | What the client offers and charges — **and the one place they are edited** |
| `/sign-in` | Email + password |
| `/auth/callback` | Where an emailed link or OAuth redirect lands |

### The payments page

This is the one that matters. A row in `pending_claims` is someone saying *"I
paid, here is the transaction id."* The page puts that claim next to the
`transactions` row carrying the same `trx_id` — the payment the system
actually received — so an operator can see at a glance:

- **No payment found** (red) — nothing arrived with that id. Stop.
- **"৳ 499 — differs"** (amber) — money arrived, but not the amount claimed.
- Matching amount, sender and date — safe to act on.

It opens on **Pending** by default, because it is a queue and the people in it
are waiting. Filters key off `resolved_at` (null until settled) rather than
the free-text `status` column, so they stay correct whatever vocabulary the
writing service uses.

---

## Data it reads

| Table | Used for |
|---|---|
| `users` | Users list and detail, all overview tiles |
| `plans` | Plans page, overview plan strip, and the prices the payments form warns against |
| `pending_claims` | The payments queue |
| `transactions` | Received bKash payments, matched to claims by `trx_id` |

Premium state is **derived, never stored**. `users.plan` is reset to `"free"`
when premium lapses, so a row can read `plan: "free"` with a non-null
`premium_until` in the past — that is a churned subscriber, not a free user,
and the dashboard shows it as its own "Expired" status. The logic lives in
`premiumState()` in `src/lib/db/types.ts`; the equivalent SQL predicates live
beside it in `src/lib/db/users.ts` so the two cannot drift.

### What it writes

Three things. Nothing else in this app writes anything.

| What | Where | Guard |
|---|---|---|
| `users.google_id`, on sign-in only | `/auth/callback` | The verified Google email on the session |
| A row in `transactions` — a bKash payment the payment app never forwarded | `/admin/payments` → *Record a payment by hand* | `assertAdmin()` |
| A row in `plans` — added or edited | `/admin/plans` → *Add a plan* / *Edit* | `assertAdmin()` |

The `google_id` stamp is best-effort and swallowed on failure: a failed write
must not turn a successful sign-in into a failure. The other two are server
actions, and each one re-runs every check its form makes — a Server Action is
a POST endpoint, and rendering a form behind `requireAdmin()` gates the
*page*, not the action.

**Resolving a payment and granting premium still happen elsewhere.** Nothing
here settles a claim. If you add that, it belongs in a server action behind
`assertAdmin()` like the two above.

### Editing plans

A row in `plans` is not a display record — it is the rule a claim is settled
against. `resolve_pending_claim()` approves a payment only when the amount
paid is the price of an *active* plan, and grants premium for that plan's
`duration`. Three consequences, all of them enforced in the code:

- **A period is never renamed.** `period` is the primary key and `users`
  carries it as plain text in `plan_period` with no foreign key, so a rename
  would succeed and orphan every subscriber on the plan. The edit form shows
  the period as fixed text, and `updatePlan` takes it only as a selector.
- **Nothing deletes.** Same problem, plus it would destroy the record of what
  subscribers were charged. Retiring a plan is `is_active: false`, which stops
  new claims being approved at that price and leaves current premium alone.
- **Prices are whole taka.** `amount` is `numeric` and Postgres would take
  ৳332.50, but `formatBdt` renders no decimals — the dashboard would show
  ৳333 while a claim was being compared against ৳332.50.

Because a price is a settlement rule, the form states what the write does to
claims that are **already open** before the button: how many people have
already sent money at the price being changed, what retiring a plan does and
does not do, and whether two active plans would end up sharing one price.
Those counts come from `countOpenClaimsByAmount()`.

`duration` is a Postgres `interval`, which does not round-trip as text —
Postgres stores a normalised month/day triple and prints it back in its own
abbreviations, so `"1 month"` is read back as `"1 mon"` and `"12 months"` as
`"1 year"`. `src/lib/duration.ts` owns both directions, which is why parsing
and rendering live in one file instead of being split between the form and
`format.ts`.

---

## Project layout

```
src/
  app/
    admin/            dashboard shell (header + sidebar) and its routes
    sign-in/          email + password form
    auth/callback/    emailed-link / OAuth landing
    globals.css       the design system — tokens and utilities
  components/         Table, Kpi, Filters, StatusPill, PageHeader, …
  lib/
    auth.ts           requireAdmin() — the gate every admin page opens with
    format.ts         every number, date and amount in the app
    url.ts            query-string builder for filter/sort/search/page links
    user-views.ts     the users view, shared by Overview and Users
    db/               one module per table, all server-only
    supabase/         admin (service role) and server (session) clients
  proxy.ts            session-cookie refresh (Next 16's renamed middleware)
context/              the UI/UX and admin-dashboard specs this app follows
```

---

## Conventions that will trip you up

Read `context/ui-ux-guidelines.md` and `context/admin-dashboard-guidelines.md`
before changing anything visual — `src/app/globals.css` implements them and is
the source of truth for tokens and utilities. The non-obvious ones:

**Auth goes in the page, not the layout.** Every admin page starts with
`await requireAdmin(path)`. A layout guard would not protect a route handler
or server action in the same segment, and a layout cannot render a per-page
forbidden card. The guard belongs where the data is read.

**Base CSS must stay inside `@layer base`.** An element rule written outside a
layer beats *every* Tailwind utility — layer order is settled before
specificity — so an unlayered `h2 { font-size: 26px }` silently voids
`className="label-micro"` on that element. New element defaults go in the
existing `@layer base` block in `globals.css`.

**Don't resolve a Tailwind class conflict by class order.** `class="mt-5 mt-0"`
does not apply `mt-0`; the winner is whichever Tailwind emits later in the
stylesheet. When a component needs an escape hatch, give it a prop — the way
`TableCard` has `flush` instead of accepting `mt-0`.

**View state lives in the URL.** Filters, sort, search and page are all query
params, built with `href(base, params, defaults)` from `src/lib/url.ts`, which
drops anything equal to its default so the resting view has a clean,
bookmarkable URL. Build links with that helper, not by hand, or two pages will
link to the same view by two different URLs.

**Never format a date or amount at the call site.** Everything goes through
`src/lib/format.ts`. Dates are always rendered in **Asia/Dhaka** — the server
may run anywhere, and a payment made at 1am Dhaka must not display as the
previous day. Money renders in Latin digits even though the product is
bilingual, because the operator is matching it against a bKash statement.

**Every admin route needs its own `loading.tsx`**, and there must be **no
`loading.tsx` at the app root** — one there would wrap the sign-in route and
every unmatched path, and streaming a shell commits a `200` before
`notFound()` runs, so unknown paths would stop answering 404.

**Exact values get `font-mono`.** Monospace is a signal, not a style: it means
"a value the operator will compare against something outside the app" —
transaction ids, user ids, env var names.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| "Database key not configured" card | `SUPABASE_SERVICE_ROLE_KEY` missing or still `local-dev-unused`. Restart the dev server after editing `.env.local`. |
| "Not an admin account" card | Signed in, but the address is not in `ADMIN_EMAILS`. Add it and restart. |
| Sign-in rejects a password you just set | The Supabase user was created without **Auto Confirm User**. |
| `typecheck` fails on `PageProps<"/some/route">` | Typed routes are stale. Run `npm run build`. |
| Headings or table headers look wrong after a CSS edit | A rule escaped `@layer base`, or a utility sets `display` on a `<th>`. See the conventions above. |

---

## Notes for AI coding agents

`AGENTS.md` (and `CLAUDE.md`, which includes it) carries the rules for this
repo. The important one: this is Next.js **16**, which renamed `middleware` to
`proxy` and changed enough else that training data is unreliable — read the
relevant guide in `node_modules/next/dist/docs/` before writing code.
