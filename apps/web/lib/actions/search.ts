"use server";

import { requireCompanyContext } from "@/lib/auth";
import type { Principal } from "@/lib/permissions";
import { globalSearch, type GlobalSearchResponse } from "@/lib/search/query";
import type { ActionResultWith } from "./shared";

/**
 * The transport for global search — everything that actually decides what
 * comes back lives in lib/search/query.ts and is unit-tested there without
 * a session. This file's only job is the two things a Server Action must
 * do that a pure function cannot: read who is asking, and never throw.
 *
 * `companyId` and `principal` come ONLY from `requireCompanyContext()`,
 * never from the caller — the same rule `lib/ask/tools.ts`'s file comment
 * states for Ask ("the model never chooses whose data"). A client cannot
 * pass a company id or a role into this action; there is no field for one.
 *
 * Returns `ActionResultWith`, not a bare object and never a throw:
 * production redacts a thrown Server Action message, and a search box that
 * went silent on a redacted digest would look like "no results" — the one
 * response this action must never fake.
 *
 * THAT LAST PARAGRAPH WAS A PROMISE THIS FILE DID NOT KEEP. There was no
 * `try` anywhere in it: `globalSearch` fans out to every provider the
 * caller can reach, and any one of them rejecting — a cold Neon compute
 * timing out on `connection_limit=5`, a bad filter value, an outage —
 * rejected the action. The caller (`SearchLauncher`) awaited it in a
 * `setTimeout` callback with no `catch`, so the rejection went unhandled,
 * `setLoading(false)` never ran, and the panel said "Searching…" until the
 * box was closed. Not slow. Stuck.
 */
export async function searchApp(query: string): Promise<ActionResultWith<GlobalSearchResponse>> {
  if (typeof query !== "string") return { ok: false, error: "Search query must be text." };

  // OUTSIDE the try, deliberately, and `runAction`'s own comment in
  // shared.ts states the rule: this redirects a signed-out caller, and a
  // redirect is a thrown CONTROL SIGNAL. Catching it here would swallow
  // the redirect and answer "search is unavailable" to someone who simply
  // needs to sign in.
  const { company, ...user } = await requireCompanyContext();
  const principal: Principal = { role: user.role, jobFunction: user.jobFunction };

  try {
    const value = await globalSearch({ companyId: company.id, principal, query });
    return { ok: true, value };
  } catch (error) {
    // Logged rather than returned: the thrown message can name a column or
    // a connection string, and production redacts it from the client for
    // that reason. The sentence below is what a person can act on.
    console.error("[search] globalSearch threw", error);
    return { ok: false, error: "Search could not run just now. Try again in a moment." };
  }
}
