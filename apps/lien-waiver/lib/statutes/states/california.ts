import type { FormDefinition, NoticeRule, SlotRef } from "../types";

/**
 * California -- Cal. Civ. Code §§ 8132, 8134, 8136, 8138.
 *
 * Source: statutes/raw/ca-8120-8138.html, Chapter 3 (Waiver and Release)
 * on leginfo.legislature.ca.gov RENDERED by a headless browser -- leginfo
 * answers 403 to GitHub's runners. Paragraph numbers are into
 * statutes/text/ca-8120-8138.txt.
 *
 * California's blanks are LABELS: "Name of Claimant:" with nothing after
 * it. The fill is written after the label, never in place of any of the
 * statute's characters. Nothing is edited and nothing is left out.
 *
 * Each section requires the waiver to be "in substantially the following
 * form" and § 8124(a) adds "signed by the claimant". The notice sits under
 * each form's title in the statute itself, so it prints where it stands.
 */

const SOURCE = "ca-8120-8138";

/** The notice is the second paragraph of each statutory form, under the
 * title -- so it prints where the statute puts it. California does not say
 * "at the top of the document" the way Texas does. */
const NOTICE: NoticeRule = {
  placement: "statutory-order",
  bold: false,
  atLeastLargestType: false,
  minimumPoints: null,
  authority: "The notice is part of the statutory form text in §§ 8132-8138; no separate type requirement is stated in those sections.",
};

const IDENTIFY: SlotRef[] = [
  { slot: "companyName", label: "Your company name (the claimant)" },
  { slot: "customer" },
  { slot: "jobLocation" },
  { slot: "owner" },
];
const CHECK: SlotRef[] = [{ slot: "checkMaker" }, { slot: "amount" }, { slot: "payee" }];
const SIGN: SlotRef[] = [{ slot: "signature" }, { slot: "signerTitle" }, { slot: "signedDate" }];

export const CALIFORNIA: FormDefinition[] = [
  {
    state: "CA",
    form: "CONDITIONAL_PROGRESS",
    sourceId: SOURCE,
    citation: "Cal. Civ. Code § 8132",
    span: [68, 92],
    titleIndices: [68],
    expectedTitle: "CONDITIONAL WAIVER AND RELEASE ON PROGRESS PAYMENT",
    drafting: [],
    edits: [],
    noticeIndices: [69],
    noticeRule: NOTICE,
    headingIndices: [70, 76, 81, 89],
    blankStyle: "label",
    labelIndices: [71, 72, 73, 74, 75, 78, 79, 80, 86, 87, 90, 91, 92],
    slots: [
      ...IDENTIFY,
      { slot: "throughDate" },
      ...CHECK,
      { slot: "priorWaiverDates" },
      { slot: "priorUnpaidAmounts" },
      ...SIGN,
    ],
  },
  {
    state: "CA",
    form: "UNCONDITIONAL_PROGRESS",
    sourceId: SOURCE,
    citation: "Cal. Civ. Code § 8134",
    span: [96, 114],
    titleIndices: [96],
    expectedTitle: "UNCONDITIONAL WAIVER AND RELEASE ON PROGRESS PAYMENT",
    drafting: [],
    edits: [],
    noticeIndices: [97],
    noticeRule: NOTICE,
    headingIndices: [98, 104, 106, 111],
    blankStyle: "label",
    labelIndices: [99, 100, 101, 102, 103, 105, 112, 113, 114],
    slots: [...IDENTIFY, { slot: "throughDate" }, { slot: "amount" }, ...SIGN],
  },
  {
    state: "CA",
    form: "CONDITIONAL_FINAL",
    sourceId: SOURCE,
    citation: "Cal. Civ. Code § 8136",
    span: [118, 136],
    titleIndices: [118],
    expectedTitle: "CONDITIONAL WAIVER AND RELEASE ON FINAL PAYMENT",
    drafting: [],
    edits: [],
    noticeIndices: [119],
    noticeRule: NOTICE,
    headingIndices: [120, 125, 130, 133],
    blankStyle: "label",
    labelIndices: [121, 122, 123, 124, 127, 128, 129, 132, 134, 135, 136],
    slots: [...IDENTIFY, ...CHECK, { slot: "disputedAmount", label: "Disputed claims for extras" }, ...SIGN],
  },
  {
    state: "CA",
    form: "UNCONDITIONAL_FINAL",
    sourceId: SOURCE,
    citation: "Cal. Civ. Code § 8138",
    span: [140, 155],
    titleIndices: [140],
    expectedTitle: "UNCONDITIONAL WAIVER AND RELEASE ON FINAL PAYMENT",
    drafting: [],
    edits: [],
    noticeIndices: [141],
    noticeRule: NOTICE,
    headingIndices: [142, 147, 149, 152],
    blankStyle: "label",
    labelIndices: [143, 144, 145, 146, 151, 153, 154, 155],
    slots: [...IDENTIFY, { slot: "disputedAmount", label: "Disputed claims for extras" }, ...SIGN],
  },
];
