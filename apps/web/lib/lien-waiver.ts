/**
 * THE LIEN WAIVER GENERATOR, AS DATA.
 *
 * A free tool for commercial specialty-trade subs: fill in your state's
 * statutory lien waiver and get the PDF back. No account. Four states at
 * launch — Arizona, California, Nevada, Texas — and four waiver types.
 *
 * ── THE ONE RULE THIS WHOLE FILE EXISTS TO ENFORCE ──
 *
 * A lien waiver is a STATUTORY form. It is not a template we are free to
 * improve. California says a waiver that is not substantially the prescribed
 * form is "null, void, and unenforceable"; Arizona and Nevada make it
 * unenforceable; Texas alone merely disregards an offending term. So this is
 * a fill-in-the-blanks engine and nothing else: no hold-harmless, no general
 * release, no added covenant, no helpful rewording, ever.
 *
 * NEVADA IS THE STRICTEST AND SETS THE BAR FOR ALL FOUR. NRS 108.2457 says a
 * waiver "must be in the following form" — the word "substantially", which
 * the other three statutes carry, is absent. Nobody has found a case saying
 * whether that means strict or substantial compliance, so it is treated as
 * byte-exact. Design to Nevada and the other three are satisfied.
 *
 * ── WHY `statutoryText` IS NULL EVERYWHERE, AND WHY THAT FAILS CLOSED ──
 *
 * The verbatim text of all sixteen forms and all four statutory notices is
 * NOT YET ESTABLISHED. It could not be: every official source —
 * azleg.gov, leginfo.legislature.ca.gov, leg.state.nv.us,
 * statutes.capitol.texas.gov — and every secondary source is blocked by this
 * environment's egress proxy, measured at 403 on CONNECT. Research
 * established the citations, the compliance standard, the recognised types,
 * the field structure and the notice rules; it did NOT establish the wording.
 *
 * So the wording is `null`, and `lien-waiver.test.ts` refuses to let a form
 * render while it is. That is deliberate: a reconstructed statutory notice is
 * worse than no product, because it would ship on a document a GC relies on
 * and a sub's lien rights hang from. Someone with a browser transcribes these
 * from the statutes and a person checks them against the official text. Until
 * then the tool can be built, tested and clicked, and cannot emit a PDF.
 *
 * Everything else here IS usable: the matrix, the fields, the intake
 * questions and the renderer constraints are what the product is made of.
 */

export const WAIVER_STATES = ["AZ", "CA", "NV", "TX"] as const;
export type WaiverState = (typeof WAIVER_STATES)[number];

export const WAIVER_TYPES = [
  "conditional-progress",
  "unconditional-progress",
  "conditional-final",
  "unconditional-final",
] as const;
export type WaiverType = (typeof WAIVER_TYPES)[number];

/**
 * What each type MEANS to the person choosing, in their words rather than the
 * statute's. Choosing wrong is the expensive mistake this tool exists to
 * prevent — unconditional before the money is in the bank gives up the lien
 * right with nothing received for it — so the picker leads the page.
 */
export const TYPE_GUIDE: Readonly<Record<WaiverType, { name: string; when: string; risk: string }>> = {
  "conditional-progress": {
    name: "Conditional progress",
    when: "You are sending this period's pay application and have not been paid for it yet.",
    risk: "Safe. It only takes effect once the payment actually clears.",
  },
  "unconditional-progress": {
    name: "Unconditional progress",
    when: "The check for this period has cleared your account.",
    risk: "Takes effect the moment you sign. Do not sign it on a promise.",
  },
  "conditional-final": {
    name: "Conditional final",
    when: "This is the last payment on the job and it is not in your hands yet.",
    risk: "Safe, but it is FINAL — list anything still owed under exceptions.",
  },
  "unconditional-final": {
    name: "Unconditional final",
    when: "The last payment has cleared.",
    risk: "Gives up what is left of your lien rights on this job. Nothing to undo it.",
  },
};

/**
 * Per-state statutory facts. Citations and the compliance standard are well
 * attested; see `scratchpad/lien-research.md` for sources and for the
 * nineteen items that are NOT verified.
 */
export type StateRule = {
  readonly name: string;
  readonly cite: string;
  /** "strict" = the statute omits "substantially". Nevada only. */
  readonly compliance: "strict" | "substantial";
  /** What the statute does to a non-conforming waiver. */
  readonly penalty: string;
  /**
   * The statutory notice's minimum type size, as a RENDERER CONSTRAINT rather
   * than a style. Each state pins the notice to the largest type used
   * elsewhere, so a logo or an enlarged heading silently breaks the form —
   * see `noticeIsLargest` below.
   */
  readonly noticeRule: string;
  /** Null where no notarization is required; a sentence where it depends. */
  readonly notarization: string | null;
};

export const STATE_RULES: Readonly<Record<WaiverState, StateRule>> = {
  AZ: {
    name: "Arizona",
    cite: "A.R.S. §33-1008",
    compliance: "substantial",
    penalty: "Unenforceable unless it follows substantially the statutory form.",
    noticeRule: "At least as large as the largest type otherwise used on the document.",
    notarization: null,
  },
  CA: {
    name: "California",
    cite: "Cal. Civ. Code §§8132, 8134, 8136, 8138",
    compliance: "substantial",
    penalty: "Null, void, and unenforceable unless it is substantially the statutory form.",
    noticeRule: "At least as large as the largest type otherwise used in the form.",
    notarization: null,
  },
  NV: {
    name: "Nevada",
    cite: "NRS 108.2457",
    compliance: "strict",
    penalty: 'Unenforceable. The statute says the waiver "must be in the following form" — no "substantially".',
    noticeRule: "Not established. Treated as the strictest of the other three until verified.",
    notarization: null,
  },
  TX: {
    name: "Texas",
    cite: "Tex. Prop. Code §53.284",
    compliance: "substantial",
    penalty:
      "Unenforceable unless it substantially complies — but a term that expands or restricts statutory rights is disregarded rather than voiding the whole waiver.",
    noticeRule: "Top of document, bold, at least as large as the largest type elsewhere, and never below 10pt.",
    notarization:
      "Required only if the ORIGINAL (prime) contract was entered before 1 January 2022 — not the date you sign. Ask the sub for the prime contract date.",
  },
};

/**
 * The blanks each form carries.
 *
 * STRUCTURALLY RELIABLE, NOT CHARACTER-VERIFIED — reconstructed from
 * circulating copies and practitioner guides, because the statutes could not
 * be reached. Treat the SET of fields as sound and every LABEL as provisional.
 *
 * NEVADA IS A DIFFERENT DOCUMENT, not the same form with a different header:
 * it keys the release to an invoice or pay-application number rather than a
 * through-date. And CALIFORNIA'S FINAL FORMS CARRY NO THROUGH-DATE AT ALL. A
 * model that put `throughDate` on all sixteen would be wrong in five of them,
 * which is why this is a per-state-per-type list and not one shared shape.
 */
export type FieldKey =
  | "claimant"
  | "customer"
  | "jobLocation"
  | "owner"
  | "throughDate"
  | "payAppNumber"
  | "amount"
  | "exceptions"
  | "makerOfCheck"
  | "checkPayableTo"
  | "signature"
  | "signatureDate";

const PROGRESS_COMMON: readonly FieldKey[] = [
  "claimant",
  "customer",
  "jobLocation",
  "owner",
  "throughDate",
  "amount",
  "exceptions",
  "signature",
  "signatureDate",
];

export const FORM_FIELDS: Readonly<Record<WaiverState, Readonly<Record<WaiverType, readonly FieldKey[]>>>> = {
  AZ: {
    "conditional-progress": PROGRESS_COMMON,
    "unconditional-progress": [...PROGRESS_COMMON, "makerOfCheck", "checkPayableTo"],
    "conditional-final": PROGRESS_COMMON,
    "unconditional-final": [...PROGRESS_COMMON, "makerOfCheck", "checkPayableTo"],
  },
  CA: {
    "conditional-progress": PROGRESS_COMMON,
    "unconditional-progress": [...PROGRESS_COMMON, "makerOfCheck"],
    // No through-date on California's final forms.
    "conditional-final": ["claimant", "customer", "jobLocation", "owner", "amount", "exceptions", "signature", "signatureDate"],
    "unconditional-final": [
      "claimant",
      "customer",
      "jobLocation",
      "owner",
      "amount",
      "exceptions",
      "makerOfCheck",
      "signature",
      "signatureDate",
    ],
  },
  NV: {
    // Keyed to a pay application, not a date. Different document.
    "conditional-progress": ["claimant", "customer", "jobLocation", "payAppNumber", "amount", "exceptions", "signature", "signatureDate"],
    "unconditional-progress": ["claimant", "customer", "jobLocation", "payAppNumber", "amount", "exceptions", "signature", "signatureDate"],
    "conditional-final": ["claimant", "customer", "jobLocation", "amount", "exceptions", "signature", "signatureDate"],
    "unconditional-final": ["claimant", "customer", "jobLocation", "amount", "exceptions", "signature", "signatureDate"],
  },
  TX: {
    "conditional-progress": PROGRESS_COMMON,
    "unconditional-progress": [...PROGRESS_COMMON, "makerOfCheck"],
    "conditional-final": PROGRESS_COMMON,
    "unconditional-final": [...PROGRESS_COMMON, "makerOfCheck"],
  },
};

/**
 * THE VERBATIM STATUTORY TEXT. All sixteen are null and the build keeps them
 * null until a person transcribes them from the statute and checks them.
 *
 * `renderable()` below is the only gate the PDF path may use. There is
 * deliberately no override flag: an escape hatch here is an escape hatch
 * around somebody's lien rights.
 */
export type FormText = { readonly notice: string; readonly body: string };

export const STATUTORY_TEXT: Readonly<Record<WaiverState, Readonly<Record<WaiverType, FormText | null>>>> = {
  AZ: { "conditional-progress": null, "unconditional-progress": null, "conditional-final": null, "unconditional-final": null },
  CA: { "conditional-progress": null, "unconditional-progress": null, "conditional-final": null, "unconditional-final": null },
  NV: { "conditional-progress": null, "unconditional-progress": null, "conditional-final": null, "unconditional-final": null },
  TX: { "conditional-progress": null, "unconditional-progress": null, "conditional-final": null, "unconditional-final": null },
};

/** The only gate the PDF path may consult. Fails closed by construction. */
export function renderable(state: WaiverState, type: WaiverType): boolean {
  return STATUTORY_TEXT[state][type] !== null;
}

/** How many of the sixteen are transcribed. Rendered on the page so the gap
 *  is visible rather than discovered by a sub who wanted a PDF. */
export function transcribedCount(): number {
  return WAIVER_STATES.reduce(
    (n, s) => n + WAIVER_TYPES.filter((t) => STATUTORY_TEXT[s][t] !== null).length,
    0,
  );
}

/**
 * THE EXCEPTIONS INTERVIEW, which is where this tool actually earns its keep.
 *
 * No state protects a blank exceptions block, and California's FINAL forms
 * carve out only "disputed claims for extras" — far narrower than its
 * progress forms. The dangerous combination is a final waiver signed while
 * retainage is still outstanding: the word "final" in the title is not
 * protection, and the sub signs away what they are still owed.
 *
 * So exceptions are never an empty textarea. These are asked, and the answers
 * compose the block.
 */
export const EXCEPTIONS_QUESTIONS: readonly { id: string; ask: string; why: string }[] = [
  {
    id: "retainage",
    ask: "Is any retainage still being held on this job?",
    why: "A final waiver signed with retainage outstanding gives it up. This is the most common way a sub loses money here.",
  },
  {
    id: "pending-change-orders",
    ask: "Are there change orders submitted but not yet approved or paid?",
    why: "Unapproved work is not covered by the amount on the waiver unless it is excepted.",
  },
  {
    id: "disputed-extras",
    ask: "Are you in dispute with the GC over any extras?",
    why: "California's final forms except only disputed claims for extras — if it is not named, it is waived.",
  },
  {
    id: "work-after-through-date",
    ask: "Have you done work after the through-date on this waiver?",
    why: "A waiver reaches everything up to its date. Later work needs to be outside it.",
  },
  {
    id: "unpaid-prior-conditionals",
    ask: "Are there earlier conditional waivers whose payments never arrived?",
    why: "Those amounts are still owed and belong in the exceptions, not assumed to be live.",
  },
];

/** Asked at intake because the answer changes the DOCUMENT, not the advice. */
export const INTAKE_QUESTIONS: readonly { id: string; ask: string; appliesTo: readonly WaiverState[] }[] = [
  {
    id: "tx-prime-contract-date",
    ask: "When was the ORIGINAL (prime) contract for this project signed — before or after 1 January 2022?",
    appliesTo: ["TX"],
  },
];

/**
 * The notice-size rule, as a predicate rather than a comment.
 *
 * Three of the four states pin the statutory notice to the largest type used
 * anywhere else on the document. That makes it a constraint on the whole
 * renderer, not a property of one block: add a logo, enlarge a heading, and
 * the form quietly stops conforming in three states at once. Whatever draws
 * the PDF asserts this before it emits.
 */
export function noticeIsLargest(noticePt: number, everyOtherPt: readonly number[]): boolean {
  if (noticePt < 10) return false; // Texas's floor, applied everywhere.
  return everyOtherPt.every((pt) => pt <= noticePt);
}
