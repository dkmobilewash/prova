import {
  CAPABILITIES,
  capabilitiesFor,
  type Capability,
  type Principal,
} from "@/lib/permissions";

/**
 * How Ask talks about access.
 *
 * lib/permissions.ts decides WHO may do WHAT; this file only puts words on
 * a refusal so the sentence names the capability rather than shrugging. The
 * capability id is kept in the sentence on purpose: "you do not have
 * billing access" is a complaint, "MANAGE_BILLING" is something the owner
 * can find in Settings and grant.
 */
export const CAPABILITY_LABELS: Record<Capability, string> = {
  VIEW_JOB_COSTS: "job cost and margin",
  VIEW_COMPANY_FINANCIALS: "company-wide money",
  MANAGE_ESTIMATING: "estimating",
  MANAGE_BILLING: "billing",
  MANAGE_COMPLIANCE: "compliance",
  MANAGE_FIELD: "field work",
  MANAGE_JOBS: "job correspondence",
};

export function refusalFor(capability: Capability): string {
  return `That needs ${CAPABILITY_LABELS[capability]} access (${capability}), which your job function does not include. The account owner can grant it.`;
}

/** The capabilities this person does NOT hold. Empty for an owner and for a
 * member with no job function, which is everyone the box has ever served. */
export function withheld(principal: Principal): Capability[] {
  const held = capabilitiesFor(principal);
  return CAPABILITIES.filter((capability) => !held.has(capability));
}

/**
 * The second system block, present only for a narrowed person.
 *
 * The tools and commands they cannot use are simply not offered, so the
 * model has no way to call them — but a model with no tool for a question
 * tends to answer it anyway, from nothing. This tells it why the tool is
 * missing so the answer is "that needs billing access" rather than a
 * guess. Sits after the cache breakpoint because it varies per person.
 */
export function accessContext(principal: Principal): string | undefined {
  const missing = withheld(principal);
  if (missing.length === 0) return undefined;
  const list = missing.map((capability) => `${CAPABILITY_LABELS[capability]} (${capability})`).join(", ");
  return `ACCESS. This person's job function does not include: ${list}. Tools and commands that need those are not offered to you. If they ask for one of those things, say in one sentence that it needs that access and that the account owner can grant it. Do not answer it from another tool, and do not guess.`;
}
