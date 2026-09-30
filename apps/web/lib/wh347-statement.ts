/**
 * WH-347 PAGE 2 — the Statement of Compliance.
 *
 * Page 1 (lib/wh347.ts) is a grid of numbers this app derives. Page 2 is
 * something else entirely: a CERTIFICATION, signed by a person, under
 * penalty of perjury, carrying its own criminal-prosecution warning. That
 * difference decides every design call in this file, so it is stated first.
 *
 * ────────────────────────────────────────────────────────────────────────
 * THE PROSE IS UNVERIFIED AND SAYS SO. READ THIS BEFORE TRUSTING A WORD OF IT
 * ────────────────────────────────────────────────────────────────────────
 *
 * NOT ONE PARAGRAPH BELOW WAS READ OFF A PRIMARY DOL SOURCE. Outbound HTTPS
 * to `dol.gov` is blocked from the container this was written in, so the text
 * in `WH347_STATEMENT_CITATIONS` is a reproduction from knowledge of the
 * form, not a transcription of it. Every entry carries `verified: false` and
 * a `primaryUrl`, `wh347-statement.test.ts` fails the build if one is flipped
 * to true without a source, and the page renders the unverified ones AS
 * unverified.
 *
 * This is deliberately the same machinery `lib/das-forms.ts` uses for the DAS
 * 140/142 rules, and for the same reason its header gives: a known-unverified
 * sentence that nobody can quietly promote is safer than either a confident
 * lie or an empty page. `WH347_STATEMENT_FOR_COUNSEL` is the list a human
 * takes to a staff attorney, derived from the table rather than written twice.
 *
 * WHY IT PRINTS AT ALL, rather than waiting to be verified. The same call the
 * pay application already makes: `lib/pay-application.ts` prints a
 * G702/G703-STYLE summary and says on the document that it is not the AIA
 * form itself. A contractor who cannot print page 2 retypes it by hand, which
 * is the work this product exists to remove. A contractor who prints it with
 * a sentence telling them to check it against the official form before
 * signing has lost nothing and gained the typing.
 *
 * WHAT THIS MEANS FOR `fileable`, because it is the one thing that could be
 * misread: unverified prose does NOT block. It is disclosed, loudly, in the
 * same place and the same way the pay app discloses its own. What blocks is
 * the FACTS being missing — see `Wh347StatementBlockingField`.
 *
 * ────────────────────────────────────────────────────────────────────────
 * THE FRINGE ELECTION IS ENTERED, NEVER INFERRED
 * ────────────────────────────────────────────────────────────────────────
 *
 * Section 4 asks the contractor to elect ONE of two things: that fringe
 * benefits are paid to approved plans, funds or programs (4(a)), or that they
 * are paid in cash to the worker (4(b)). It is a statement about how the
 * company actually pays, and the app does not know it.
 *
 * `FringeRateSchedule` (labor.prisma) holds four RATE columns — pension,
 * vacation, health and welfare, training — and no column saying where the
 * money goes. It would be easy to infer 4(a) from the existence of the
 * fringe-remittance feature, or from `fringeCreditFor` treating fringes as a
 * credit against the obligation. Both inferences are the app asserting
 * something about a company's payment practice on a document somebody signs
 * under penalty of perjury, off a column that was never asked that question.
 * So it is entered, and until it is entered the form is not fileable.
 *
 * ────────────────────────────────────────────────────────────────────────
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ────────────────────────────────────────────────────────────────────────
 *
 * NO SIGNATURE. There is no `signedAt`, no signature image, and no e-sign
 * flow. The page prints a signature line for wet ink. This app holds an
 * e-signature capability and using it here would mean a row in this database
 * asserting that a named person certified a federal filing — which is a claim
 * about a legal act, and the wrong kind of thing for a checkbox to create.
 * `signatoryName` and `signatoryTitle` are who WILL sign, printed into the
 * NAME AND TITLE box so the person does not hand-letter it. They are not
 * evidence that anybody did.
 *
 * NO DEDUCTION ASSERTIONS. Paragraph (1) states that no deductions were made
 * other than those permissible under the Copeland Act regulations. That is
 * the SIGNER's assertion about their own payroll, not a fact this app can
 * derive from an imported register — the register's columns say what was
 * deducted, never whether each deduction was permissible. Nothing here ticks
 * that on anybody's behalf.
 */

/** Exactly the citation shape `lib/das-forms.ts` uses. Same fields, same
 * discipline, and deliberately not imported from there: the DAS table is
 * about California apprenticeship regulations and this one is about a federal
 * form, so a shared type would invite a shared table. */
export interface Wh347StatementCitation {
  key: string;
  /** The paragraph as THIS APP reproduces it. Not a transcription. */
  text: string;
  authority: string;
  /** False on every entry today. The test enforces that true requires a
   * primary URL and a human who read it. */
  verified: boolean;
  primaryUrl: string;
  /** What a person has to check on the real form to promote this entry. */
  question: string;
}

/** The form's own source, named once so every citation points at the same
 * place and a moved URL is one edit. */
const WH347_FORM_URL = "https://www.dol.gov/sites/dolgov/files/WHD/legacy/files/wh347.pdf";

export const WH347_STATEMENT_CITATIONS: readonly Wh347StatementCitation[] = [
  {
    key: "opening",
    text:
      "I, (NAME OF SIGNATORY PARTY) (TITLE) do hereby state:",
    authority: "Form WH-347, Statement of Compliance",
    verified: false,
    primaryUrl: WH347_FORM_URL,
    question:
      "Does the current revision still open with this line, and does it ask for anything beyond name and title?",
  },
  {
    key: "paragraph-1",
    text:
      "(1) That I pay or supervise the payment of the persons employed by the contractor or " +
      "subcontractor named above on the building or work described above; that during the payroll " +
      "period stated above all persons employed on said project have been paid the full weekly " +
      "wages earned, that no rebates have been or will be made either directly or indirectly to or " +
      "on behalf of said contractor or subcontractor from the full weekly wages earned by any " +
      "person, and that no deductions have been made either directly or indirectly from the full " +
      "wages earned by any person, other than permissible deductions as defined in Regulations, " +
      "Part 3 (29 CFR Subtitle A), issued by the Secretary of Labor under the Copeland Act, as " +
      "amended, and described below.",
    authority: "Form WH-347, Statement of Compliance ¶(1); 29 CFR Part 3 (Copeland Act)",
    verified: false,
    primaryUrl: WH347_FORM_URL,
    question:
      "Is the wording of the rebates and deductions clause current, and does the form still cite " +
      "Regulations Part 3 (29 CFR Subtitle A) in these words?",
  },
  {
    key: "paragraph-2",
    text:
      "(2) That any payrolls otherwise under this contract required to be submitted for the above " +
      "period are correct and complete; that the wage rates for laborers or mechanics contained " +
      "therein are not less than the applicable wage rates contained in any wage determination " +
      "incorporated into the contract; that the classifications set forth therein for each laborer " +
      "or mechanic conform with the work he or she performed.",
    authority: "Form WH-347, Statement of Compliance ¶(2)",
    verified: false,
    primaryUrl: WH347_FORM_URL,
    question:
      "Is this paragraph unchanged, and does the current revision use 'he or she' or different wording?",
  },
  {
    key: "paragraph-3",
    text:
      "(3) That any apprentices employed in the above period are duly registered in a bona fide " +
      "apprenticeship program registered with a State apprenticeship agency recognized by the " +
      "Bureau of Apprenticeship and Training, United States Department of Labor, or if no such " +
      "recognized agency exists in a State, are registered with the Bureau of Apprenticeship and " +
      "Training, United States Department of Labor.",
    authority: "Form WH-347, Statement of Compliance ¶(3)",
    verified: false,
    primaryUrl: WH347_FORM_URL,
    question:
      "The Bureau of Apprenticeship and Training was renamed the Office of Apprenticeship. Does " +
      "the current form still say Bureau, and is the registering-agency language unchanged?",
  },
  {
    key: "paragraph-4a",
    text:
      "(4)(a) WHERE FRINGE BENEFITS ARE PAID TO APPROVED PLANS, FUNDS, OR PROGRAMS — in addition to " +
      "the basic hourly wage rates paid to each laborer or mechanic listed in the above referenced " +
      "payroll, payments of fringe benefits as listed in the contract have been or will be made to " +
      "appropriate programs for the benefit of such employees, except as noted in section 4(c) below.",
    authority: "Form WH-347, Statement of Compliance ¶4(a)",
    verified: false,
    primaryUrl: WH347_FORM_URL,
    question: "Is the 4(a) heading and body unchanged on the current revision?",
  },
  {
    key: "paragraph-4b",
    text:
      "(4)(b) WHERE FRINGE BENEFITS ARE PAID IN CASH — each laborer or mechanic listed in the above " +
      "referenced payroll has been paid, as indicated on the payroll, an amount not less than the " +
      "sum of the applicable basic hourly wage rate plus the amount of the required fringe benefits " +
      "as listed in the contract, except as noted in section 4(c) below.",
    authority: "Form WH-347, Statement of Compliance ¶4(b)",
    verified: false,
    primaryUrl: WH347_FORM_URL,
    question: "Is the 4(b) heading and body unchanged on the current revision?",
  },
  {
    key: "paragraph-4c",
    text: "(4)(c) EXCEPTIONS",
    authority: "Form WH-347, Statement of Compliance ¶4(c)",
    verified: false,
    primaryUrl: WH347_FORM_URL,
    question:
      "The printed form gives 4(c) two columns, EXCEPTION (CRAFT) and EXPLANATION. Are those still " +
      "the headings, and is there a row limit?",
  },
  {
    key: "falsification-warning",
    text:
      "THE WILLFUL FALSIFICATION OF ANY OF THE ABOVE STATEMENTS MAY SUBJECT THE CONTRACTOR OR " +
      "SUBCONTRACTOR TO CIVIL OR CRIMINAL PROSECUTION. SEE SECTION 1001 OF TITLE 18 AND SECTION " +
      "231 OF TITLE 31 OF THE UNITED STATES CODE.",
    authority: "Form WH-347, Statement of Compliance; 18 U.S.C. 1001, 31 U.S.C. 231",
    verified: false,
    primaryUrl: WH347_FORM_URL,
    question:
      "Are both statutory citations current? 31 U.S.C. 231 was the False Claims Act's old " +
      "codification and the modern section is 3729 — the form may or may not have been updated.",
  },
] as const;

/** Every paragraph a human still has to check against the printed form.
 * Derived, so it cannot drift from the table — which is what a second
 * hand-written list would do. */
export const WH347_STATEMENT_FOR_COUNSEL: readonly Wh347StatementCitation[] =
  WH347_STATEMENT_CITATIONS.filter((citation) => !citation.verified);

/** One paragraph by key. Throws on an unknown key rather than returning
 * undefined, because a page rendering nothing where a statutory paragraph
 * should be is the failure this whole file is written against. */
export function wh347StatementCitation(key: string): Wh347StatementCitation {
  const found = WH347_STATEMENT_CITATIONS.find((citation) => citation.key === key);
  if (!found) throw new Error(`wh347StatementCitation: no citation named ${key}`);
  return found;
}

/* ------------------------------------------------------------------ *
 * The facts the contractor supplies
 * ------------------------------------------------------------------ */

/** Section 4's election. Exactly two values, because the form offers two. */
export type Wh347FringeMode = "PAID_TO_PLANS" | "PAID_IN_CASH";

export const WH347_FRINGE_MODE_LABEL: Record<Wh347FringeMode, string> = {
  PAID_TO_PLANS: "Paid to approved plans, funds or programs — section 4(a)",
  PAID_IN_CASH: "Paid in cash with the wage — section 4(b)",
};

/** Which paragraph a given election prints. The form expects the elected
 * one; printing both invites a reader to decide which applies, which is the
 * contractor's statement to make and not theirs. */
export const WH347_FRINGE_MODE_CITATION: Record<Wh347FringeMode, string> = {
  PAID_TO_PLANS: "paragraph-4a",
  PAID_IN_CASH: "paragraph-4b",
};

/** Section 4(c): a craft, and why it is excepted. */
export interface Wh347StatementExceptionInput {
  craftName: string;
  explanation: string;
}

/** Exactly what a `Wh347Statement` row holds, all nullable, because a
 * half-filled statement is the ordinary state between opening the form and
 * finishing it — and `blocking` is how that state is reported rather than
 * something to prevent. */
export interface Wh347StatementRecord {
  signatoryName: string | null;
  signatoryTitle: string | null;
  fringeMode: Wh347FringeMode | null;
  remarks: string | null;
  exceptions: readonly Wh347StatementExceptionInput[];
}

export type Wh347StatementBlockingField =
  | "signatoryName"
  | "signatoryTitle"
  | "fringeMode"
  | "exceptionExplanation";

export const WH347_STATEMENT_BLOCKING_REASON: Record<Wh347StatementBlockingField, string> = {
  signatoryName:
    "The NAME AND TITLE box wants the person who signs this. Nobody is recorded, and this app will not guess — it is not the same question as who is logged in.",
  signatoryTitle:
    "The same box wants that person's title. An owner, an office manager and a payroll clerk sign different things.",
  fringeMode:
    "Section 4 asks you to elect whether fringe benefits are paid to approved plans (4(a)) or in cash with the wage (4(b)). C Stream records the fringe RATES and not where the money goes, so this is yours to state.",
  exceptionExplanation:
    "An exception in section 4(c) names a craft and has to say why. A craft with a blank explanation is the box that looks filled in.",
};

/** The order blocking fields are reported in — the order they appear on the
 * page, so the list reads as a walk down the form rather than a set. */
const BLOCKING_ORDER: readonly Wh347StatementBlockingField[] = [
  "fringeMode",
  "exceptionExplanation",
  "signatoryName",
  "signatoryTitle",
];

export interface Wh347StatementInput {
  contractorName: string;
  projectName: string;
  projectLocation: string | null;
  /** From `Wh347PayrollNumber`, via page 1's header. Null until issued. */
  payrollNumber: number | null;
  /** THE SAME two dates page 1 printed. Passed in rather than re-derived:
   * a payroll period computed twice is a payroll period free to disagree
   * with itself across two pages of one filing. */
  periodStart: Date;
  periodEnd: Date;
  statement: Wh347StatementRecord | null;
}

export interface Wh347StatementException {
  craftName: string;
  explanation: string | null;
}

export interface Wh347Statement {
  contractorName: string;
  projectName: string;
  projectLocation: string | null;
  payrollNumber: number | null;
  periodStart: Date;
  periodEnd: Date;
  signatoryName: string | null;
  signatoryTitle: string | null;
  fringeMode: Wh347FringeMode | null;
  /** The paragraph the election prints, or null while unelected. */
  fringeParagraph: Wh347StatementCitation | null;
  remarks: string | null;
  exceptions: readonly Wh347StatementException[];
  blocking: readonly Wh347StatementBlockingField[];
  /** Every fact recorded. NOT "signed", and not "correct" — see the header. */
  complete: boolean;
  /** True while any reproduced paragraph is unverified, which is today and
   * every day until somebody reads the form. Drives the disclosure on the
   * page; deliberately does NOT drive `blocking`. */
  proseUnverified: boolean;
}

/** Blank-but-present counts as absent, the same rule `jobFormLocation` and
 * `committeeDeliverability` follow: a space is what a form field leaves
 * behind, and on a document a federal agency receives a box that LOOKS
 * filled is worse than an empty one. */
const present = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export function buildWh347Statement(input: Wh347StatementInput): Wh347Statement {
  const record = input.statement;

  const signatoryName = present(record?.signatoryName);
  const signatoryTitle = present(record?.signatoryTitle);
  const fringeMode = record?.fringeMode ?? null;
  const remarks = present(record?.remarks);

  // A craft with no name is not an exception at all — it is an empty row
  // somebody added and left. Dropped rather than reported, because there is
  // nothing for the reader to act on and printing it would put a blank line
  // in section 4(c).
  const exceptions: Wh347StatementException[] = (record?.exceptions ?? [])
    .map((exception) => ({
      craftName: present(exception.craftName),
      explanation: present(exception.explanation),
    }))
    .filter((exception): exception is Wh347StatementException & { craftName: string } =>
      exception.craftName !== null,
    );

  const blocking = new Set<Wh347StatementBlockingField>();
  if (fringeMode === null) blocking.add("fringeMode");
  if (signatoryName === null) blocking.add("signatoryName");
  if (signatoryTitle === null) blocking.add("signatoryTitle");
  // An exception that names a craft and explains nothing. The form's own
  // second column is EXPLANATION, so a row without one is incomplete rather
  // than merely terse.
  if (exceptions.some((exception) => exception.explanation === null)) {
    blocking.add("exceptionExplanation");
  }

  return {
    contractorName: input.contractorName,
    projectName: input.projectName,
    projectLocation: input.projectLocation,
    payrollNumber: input.payrollNumber,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    signatoryName,
    signatoryTitle,
    fringeMode,
    fringeParagraph:
      fringeMode === null ? null : wh347StatementCitation(WH347_FRINGE_MODE_CITATION[fringeMode]),
    remarks,
    exceptions,
    blocking: BLOCKING_ORDER.filter((field) => blocking.has(field)),
    complete: blocking.size === 0,
    proseUnverified: WH347_STATEMENT_FOR_COUNSEL.length > 0,
  };
}

/* ------------------------------------------------------------------ *
 * Reading the form
 * ------------------------------------------------------------------ */

/** The same `Parsed` shape `lib/determination-facts.ts` uses, restated here
 * rather than imported: that module is about prevailing-wage determinations
 * and a shared type between them would be the first step toward a shared
 * parser for two unrelated forms. */
export type ParsedStatement =
  | { ok: true; value: Wh347StatementRecord }
  | { ok: false; error: string };

const FRINGE_MODES: readonly Wh347FringeMode[] = ["PAID_TO_PLANS", "PAID_IN_CASH"];

/**
 * Reads page 2's form.
 *
 * PURE, and separate from the action, for the reason `determination-facts.ts`
 * gives: a Server Action cannot be called from a test and a parser can. Every
 * refusal here is a sentence about something a person just typed.
 *
 * Exception rows arrive as two PARALLEL repeated fields and are paired by
 * INDEX. `getAll` preserves document order for same-named controls, so row n's
 * craft and row n's explanation line up — but only while both lists are the
 * same length, which the form guarantees by rendering the pair together and
 * this function checks rather than assumes. A mismatch means the form was
 * tampered with or a row rendered half, and pairing the wrong explanation to
 * the wrong craft on a federal filing is not something to do quietly.
 */
export function wh347StatementFromForm(formData: FormData): ParsedStatement {
  const rawMode = String(formData.get("fringeMode") ?? "").trim();
  let fringeMode: Wh347FringeMode | null = null;
  if (rawMode) {
    if (!FRINGE_MODES.includes(rawMode as Wh347FringeMode)) {
      return {
        ok: false,
        error:
          "That fringe-benefit election isn't one the form offers. Choose paid to approved plans, or paid in cash.",
      };
    }
    fringeMode = rawMode as Wh347FringeMode;
  }

  const crafts = formData.getAll("exceptionCraft").map((value) => String(value));
  const explanations = formData.getAll("exceptionExplanation").map((value) => String(value));
  if (crafts.length !== explanations.length) {
    return {
      ok: false,
      error: "The exception rows didn't come through in pairs. Reload the page and try again.",
    };
  }

  const exceptions: Wh347StatementExceptionInput[] = [];
  for (let index = 0; index < crafts.length; index += 1) {
    const craftName = crafts[index].trim();
    const explanation = explanations[index].trim();
    // A row where BOTH are blank is a row somebody added and left; dropped,
    // the same way buildWh347Statement drops it. A row with one of the two is
    // kept so the blocking list can name it, rather than being silently
    // discarded and reported as fine.
    if (!craftName && !explanation) continue;
    exceptions.push({ craftName, explanation });
  }

  return {
    ok: true,
    value: {
      signatoryName: String(formData.get("signatoryName") ?? "").trim() || null,
      signatoryTitle: String(formData.get("signatoryTitle") ?? "").trim() || null,
      fringeMode,
      remarks: String(formData.get("remarks") ?? "").trim() || null,
      exceptions,
    },
  };
}
