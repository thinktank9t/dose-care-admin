"use server";

import { revalidatePath } from "next/cache";
import { RedirectType, redirect } from "next/navigation";

import { getSupabaseServerClient } from "@/lib/supabase/server";

export type SignInState =
  | { status: "idle" }
  | { status: "error"; reason: "invalid" | "wrong" | "unknown" };

/**
 * Email + password sign-in.
 *
 * The user row lives in Supabase Auth (created once via the dashboard or
 * `auth.admin.createUser`). The allowlist still runs in `requireAdmin()`
 * after sign-in — a successful sign-in with an email not on
 * `ADMIN_EMAILS` will land on the forbidden card, not the dashboard. The
 * two checks happen at different times for different reasons: Supabase
 * owns "is this credential valid", this app owns "is this person an
 * operator".
 */
export async function signInWithPassword(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { status: "error", reason: "invalid" };
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { status: "error", reason: "invalid" };
  }

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    // Supabase collapses every credential failure ("user not found",
    // "wrong password", "email not confirmed") into the same opaque
    // "Invalid login credentials" — by design, so the form is not an
    // oracle for which addresses have one. We keep the same collapse here.
    return { status: "error", reason: "wrong" };
  }

  const nextParam = formData.get("next");
  const next = typeof nextParam === "string" && nextParam.startsWith("/")
    ? nextParam
    : "/admin";

  redirect(next);
}

/**
 * Sign out, and make the dashboard unreachable by pressing Back.
 *
 * **There is no web API that clears the browser's history.** Nothing can
 * delete the entries behind the current one, so "remove the back stack" is
 * not literally implementable. What is implementable — and what actually
 * matters — is that pressing Back after signing out never *renders* anyone's
 * rows. Three different mechanisms could put the dashboard back on screen,
 * and each needs its own answer:
 *
 *   1. **Next's client Router Cache.** Back inside the app is a `popstate`
 *      handled by the client router, not a page load: it replays the RSC
 *      payload it already has, so the operator would see the full dashboard
 *      with no request reaching the server and no guard running.
 *      `revalidatePath("/", "layout")` is what closes this. Per the
 *      revalidatePath reference, calling it in a Server Function "causes all
 *      previously visited pages to refresh when navigated to again" — which
 *      is normally a caveat and is exactly the behaviour wanted here. The
 *      refetch hits `requireAdmin()`, finds no session, and redirects to
 *      sign-in. `"layout"` on `/` covers every route beneath the root layout
 *      rather than naming the four admin paths and going stale when a fifth
 *      is added.
 *
 *   2. **The history entry the operator is standing on.** A `redirect` in a
 *      Server Action defaults to `push`, which stacks sign-in *on top of* the
 *      page they just left, so one Back press returns to it.
 *      `RedirectType.replace` overwrites that entry instead. It is the only
 *      entry the platform lets us remove, and it is the one most likely to be
 *      pressed Back to.
 *
 *   3. **The browser's back/forward cache**, which restores a whole document
 *      from memory with no request at all — so no guard runs there either.
 *      This one needs nothing from us: Next already answers a dynamic route
 *      with `Cache-Control: private, no-cache, no-store, max-age=0,
 *      must-revalidate` in production, and Chrome refuses to bfcache a
 *      `no-store` response. Verified against `next start`, not assumed — and
 *      worth re-checking if a route here ever stops being dynamic, because
 *      that header is a consequence of being dynamic rather than a policy
 *      anyone set. Note it is **not** what the dev server sends (`no-cache,
 *      must-revalidate`), so this cannot be confirmed with `next dev`.
 *
 * Order matters: `redirect` throws to unwind, so the revalidation has to be
 * queued before it.
 */
export async function signOut(): Promise<void> {
  const supabase = await getSupabaseServerClient();
  // Clears the auth cookies. `setAll` in server.ts can actually write here —
  // a Server Action may set cookies, unlike a Server Component render.
  await supabase.auth.signOut();

  revalidatePath("/", "layout");

  redirect("/sign-in", RedirectType.replace);
}