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
 */
export async function searchApp(query: string): Promise<ActionResultWith<GlobalSearchResponse>> {
  if (typeof query !== "string") return { ok: false, error: "Search query must be text." };

  const { company, ...user } = await requireCompanyContext();
  const principal: Principal = { role: user.role, jobFunction: user.jobFunction };

  const value = await globalSearch({ companyId: company.id, principal, query });
  return { ok: true, value };
}
