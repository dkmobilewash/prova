import type { FormDefinition, NoticeRule, SlotRef } from "../types";

/**
 * Arizona -- A.R.S. § 33-1008(D), four forms.
 *
 * Source: statutes/raw/az-33-1008.html, fetched from azleg.gov by the
 * Capture statutes workflow. Paragraph numbers are into
 * statutes/text/az-33-1008.txt.
 *
 * Nothing is edited inside any paragraph. Two whole paragraphs are left
 * out, both the statute instructing rather than speaking as the form, and
 * both carried out instead: the notice they describe is printed in type at
 * least as large as anything else on the page.
 */

const SOURCE = "az-33-1008";

/** Arizona says each unconditional waiver must CONTAIN the notice; it does
 * not say where. The statute sets it out after the form, so that is where
 * it prints until the attorney says otherwise (attorney question AZ-2). */
const NOTICE: NoticeRule = {
  placement: "statutory-order",
  bold: false,
  atLeastLargestType: true,
  minimumPoints: null,
  authority:
    "A.R.S. § 33-1008(D)(2) and (4): \"Each unconditional waiver shall contain the following language, in type at least as large as the largest type otherwise on the document\".",
};

const DATE_COMPANY: SlotRef[] = [{ slot: "signedDate" }, { slot: "companyName" }];
const SIGN: SlotRef[] = [{ slot: "signature" }, { slot: "signerTitle" }];
const JOB_DESCRIPTION: SlotRef = {
  slot: "jobDescription",
  label: "Job location / description",
};

export const ARIZONA: FormDefinition[] = [
  {
    state: "AZ",
    form: "CONDITIONAL_PROGRESS",
    sourceId: SOURCE,
    citation: "A.R.S. § 33-1008(D)(1)",
    span: [6, 28],
    titleIndices: [6],
    expectedTitle: "Conditional waiver and release on progress payment",
    drafting: [],
    edits: [],
    noticeIndices: [],
    noticeRule: null,
    blankStyle: "underscore",
    slots: [
      { slot: "project" },
      { slot: "jobNumber" },
      { slot: "checkMaker" },
      { slot: "amount" },
      { slot: "payee" },
      { slot: "owner" },
      JOB_DESCRIPTION,
      { slot: "customer" },
      { slot: "throughDate" },
      ...DATE_COMPANY,
      ...SIGN,
    ],
  },
  {
    state: "AZ",
    form: "UNCONDITIONAL_PROGRESS",
    sourceId: SOURCE,
    citation: "A.R.S. § 33-1008(D)(2)",
    span: [30, 52],
    titleIndices: [30],
    expectedTitle: "Unconditional waiver and release on progress payment",
    drafting: [
      {
        index: 51,
        why: "The statute's instruction that the notice which follows must appear, and in what type. Carried out, not printed.",
      },
    ],
    edits: [],
    noticeIndices: [52],
    noticeRule: NOTICE,
    blankStyle: "underscore",
    slots: [
      { slot: "project" },
      { slot: "jobNumber" },
      { slot: "amount" },
      { slot: "customer" },
      { slot: "owner" },
      JOB_DESCRIPTION,
      { slot: "customer" },
      { slot: "throughDate" },
      ...DATE_COMPANY,
      ...SIGN,
    ],
  },
  {
    state: "AZ",
    form: "CONDITIONAL_FINAL",
    sourceId: SOURCE,
    citation: "A.R.S. § 33-1008(D)(3)",
    span: [54, 72],
    titleIndices: [54],
    expectedTitle: "Conditional waiver and release on final payment",
    drafting: [],
    edits: [],
    noticeIndices: [],
    noticeRule: null,
    blankStyle: "underscore",
    slots: [
      { slot: "project" },
      { slot: "jobNumber" },
      { slot: "checkMaker" },
      { slot: "amount" },
      { slot: "payee" },
      { slot: "owner" },
      JOB_DESCRIPTION,
      { slot: "customer" },
      { slot: "disputedAmount" },
      ...DATE_COMPANY,
      ...SIGN,
    ],
  },
  {
    state: "AZ",
    form: "UNCONDITIONAL_FINAL",
    sourceId: SOURCE,
    citation: "A.R.S. § 33-1008(D)(4)",
    span: [74, 91],
    titleIndices: [74],
    expectedTitle: "Unconditional waiver and release on final payment",
    drafting: [
      {
        index: 89,
        why: "The statute's instruction that the notice which follows must appear, and in what type. Carried out, not printed.",
      },
    ],
    edits: [],
    noticeIndices: [90, 91],
    noticeRule: NOTICE,
    blankStyle: "underscore",
    slots: [
      { slot: "project" },
      { slot: "jobNumber" },
      { slot: "customer" },
      { slot: "owner" },
      JOB_DESCRIPTION,
      { slot: "disputedAmount", label: "Disputed claims for extra work" },
      ...DATE_COMPANY,
      ...SIGN,
    ],
  },
];
