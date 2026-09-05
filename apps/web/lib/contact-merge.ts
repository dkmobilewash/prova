/**
 * What happens to the FIELDS when two duplicate contacts are merged.
 *
 * Kept out of the action module (and out of any "use server" file) for two
 * reasons: a "use server" module may only export async functions, and the
 * contact page needs to render the same answer the action will enforce. One
 * function, so the preview and the write can never disagree.
 *
 * The rule, in order of how much it can cost someone:
 *
 *   - Winner has a value, duplicate is blank      -> keep the winner's.
 *   - Winner is blank, duplicate has a value      -> COPY the duplicate's.
 *     This is the whole reason merge is worth building. `createJob` mints a
 *     fresh Contact with nulls every time, so the record carrying the real
 *     retainage percent and payment terms is usually NOT the one with the
 *     jobs on it. Winner-takes-all would throw away the only correct value.
 *   - Both blank                                  -> nothing.
 *   - Both set and equal                          -> nothing.
 *   - Both set and DIFFERENT                      -> a conflict. The caller
 *     must say which one survives. With no answer the merge REFUSES; it does
 *     not pick. A contract term silently replaced by the other copy's is
 *     exactly the kind of wrong nobody notices until a pay app is short.
 *
 * `name` and `status` are deliberately NOT in this list — see the comment on
 * MERGEABLE_FIELDS.
 */

/** The contact columns this module decides. Everything in here is nullable,
 * which is what makes "blank" a meaningful state and the copy rule safe.
 *
 * NOT here, on purpose:
 *   - `name`: the person chose which record to KEEP, and its name is that
 *     record's identity. Offering to rename it during a merge would make
 *     "keep this one" mean something different from what it says.
 *   - `status`: non-nullable with a default, so it is never blank and the
 *     copy rule above can never apply — every merge of a PROSPECT into an
 *     ACTIVE would become a conflict to answer, on a field that is one click
 *     to change on the page you are already standing on. The merged record
 *     keeps the winner's status and the screen says so before you commit.
 *   - `portalToken`: a live bearer credential, never merged. See the action.
 */
export const MERGEABLE_FIELDS = [
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "address", label: "Address" },
  { key: "accountType", label: "Account type" },
  { key: "defaultRetainagePercent", label: "Default retainage %" },
  { key: "paymentTermsDays", label: "Payment terms (days)" },
  { key: "standardFormsUsed", label: "Standard subcontract form" },
  { key: "msaExpirationDate", label: "MSA expires" },
  { key: "prequalificationExpiresAt", label: "Prequalification expires" },
] as const;

export type MergeableFieldKey = (typeof MERGEABLE_FIELDS)[number]["key"];

/** Loose on purpose: Prisma hands back `Decimal` for the money columns and
 * `Date` for the date ones, and this module only ever compares and copies
 * them. Narrowing here would mean importing Prisma's runtime types into a
 * file the client bundle also reaches. */
export type MergeableContact = Record<MergeableFieldKey, unknown>;

export type MergeChoice = "keep" | "duplicate";

/** Which side wins each conflicting field. Absent key = not answered. */
export type MergeChoices = Partial<Record<MergeableFieldKey, MergeChoice>>;

/**
 * A comparable string for one stored value, or null for "blank".
 *
 * Empty string counts as blank: the contact form writes `email || null`, but
 * nothing stops an older row holding `""`, and treating that as a value would
 * invent a conflict between "" and a real address.
 *
 * Dates compare by their ISO form and Decimals by their own `toString` —
 * both sides of any comparison come out of the same column, so the same
 * stored value always normalizes to the same string.
 */
export function normalizeMergeValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  const asString = String(value).trim();
  return asString === "" ? null : asString;
}

export type MergeFieldPlan = {
  key: MergeableFieldKey;
  label: string;
  /** The winner's current value, normalized for display. */
  keep: string | null;
  /** The duplicate's value, normalized for display. */
  duplicate: string | null;
  /** "fill": winner is blank and the duplicate's value gets copied.
   *  "conflict": both set and different. */
  kind: "fill" | "conflict";
  /** For a conflict: which side the caller chose, or null if unanswered. */
  choice: MergeChoice | null;
};

export type MergePlan<TLoser extends MergeableContact = MergeableContact> = {
  /** Blank-on-the-winner fields the duplicate can fill in. Never refused —
   * copying into a blank destroys nothing. */
  fills: MergeFieldPlan[];
  /** Fields set differently on both. */
  conflicts: MergeFieldPlan[];
  /** Conflicts the caller has not answered. Non-empty = the merge refuses. */
  unresolved: MergeFieldPlan[];
  /** The columns to write onto the winner, holding the DUPLICATE's raw
   * values (a Decimal stays a Decimal, a Date stays a Date). Typed from the
   * duplicate row itself, so passing this straight to `contact.update` is
   * checked rather than cast. Empty means the winner's own fields are
   * already correct and only the references move. */
  updates: Partial<Pick<TLoser, MergeableFieldKey>>;
};

/**
 * Works out what a merge would do to the two records' fields.
 *
 * Pure, and given the same two rows it returns the same answer whether it is
 * called by the page drawing the preview or by the action doing the write.
 */
export function planContactMerge<TLoser extends MergeableContact>(
  winner: MergeableContact,
  loser: TLoser,
  choices: MergeChoices = {},
): MergePlan<TLoser> {
  const fills: MergeFieldPlan[] = [];
  const conflicts: MergeFieldPlan[] = [];
  const updates: Partial<Pick<TLoser, MergeableFieldKey>> = {};

  for (const { key, label } of MERGEABLE_FIELDS) {
    const keep = normalizeMergeValue(winner[key]);
    const duplicate = normalizeMergeValue(loser[key]);

    if (duplicate === null) continue; // nothing to bring across
    if (keep === null) {
      fills.push({ key, label, keep, duplicate, kind: "fill", choice: null });
      updates[key] = loser[key];
      continue;
    }
    if (keep === duplicate) continue; // agree already

    const choice = choices[key] ?? null;
    conflicts.push({ key, label, keep, duplicate, kind: "conflict", choice });
    if (choice === "duplicate") updates[key] = loser[key];
  }

  return {
    fills,
    conflicts,
    unresolved: conflicts.filter((c) => c.choice === null),
    updates,
  };
}
