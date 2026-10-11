import type { FormDefinition, NoticeRule, SlotRef } from "../types";

/**
 * Nevada -- NRS 108.2457(5)(a)-(d), four forms.
 *
 * Source: statutes/raw/nv-108.html, all of NRS chapter 108 as published on
 * leg.state.nv.us, fetched by the Capture statutes workflow. It is encoded
 * windows-1252; see the note in html-text.mjs about the apostrophe that
 * disappeared before that file decoded it by hand. Paragraph numbers are
 * into statutes/text/nv-108.txt.
 *
 * Nevada is the strictest of the four on form: a waiver "is unenforceable
 * unless it is in the following forms" -- not "substantially". Nothing is
 * edited inside any paragraph; the two instruction paragraphs before the
 * unconditional notices are left out and carried out instead.
 */

const SOURCE = "nv-108";

const NOTICE: NoticeRule = {
  placement: "statutory-order",
  bold: false,
  atLeastLargestType: true,
  minimumPoints: null,
  authority:
    "NRS 108.2457(5)(b) and (d): \"(Each unconditional waiver and release must contain the following language, in type at least as large as the largest type otherwise on the document:)\".",
};

const HEAD: SlotRef[] = [
  { slot: "project", label: "Property name" },
  { slot: "jobLocation", label: "Property location" },
  { slot: "customer" },
  { slot: "invoiceNumber" },
  { slot: "amount" },
];
const FOOT: SlotRef[] = [
  { slot: "signedDate" },
  { slot: "companyName" },
  { slot: "signature" },
  { slot: "signerTitle" },
];

export const NEVADA: FormDefinition[] = [
  {
    state: "NV",
    form: "CONDITIONAL_PROGRESS",
    sourceId: SOURCE,
    citation: "NRS 108.2457(5)(a)",
    span: [741, 754],
    titleIndices: [741, 742],
    expectedTitle: "CONDITIONAL WAIVER AND RELEASE UPON PROGRESS PAYMENT",
    drafting: [],
    edits: [],
    noticeIndices: [],
    noticeRule: null,
    blankStyle: "dots",
    slots: [...HEAD, ...FOOT],
  },
  {
    state: "NV",
    form: "UNCONDITIONAL_PROGRESS",
    sourceId: SOURCE,
    citation: "NRS 108.2457(5)(b)",
    span: [756, 771],
    titleIndices: [756, 757],
    expectedTitle: "UNCONDITIONAL WAIVER AND RELEASE UPON PROGRESS PAYMENT",
    drafting: [
      {
        index: 770,
        why: "The statute's instruction that the notice which follows must appear, and in what type. Carried out, not printed.",
      },
    ],
    edits: [],
    noticeIndices: [771],
    noticeRule: NOTICE,
    blankStyle: "dots",
    slots: [...HEAD, ...FOOT],
  },
  {
    state: "NV",
    form: "CONDITIONAL_FINAL",
    sourceId: SOURCE,
    citation: "NRS 108.2457(5)(c)",
    span: [773, 788],
    titleIndices: [773, 774],
    expectedTitle: "CONDITIONAL WAIVER AND RELEASE UPON FINAL PAYMENT",
    drafting: [],
    edits: [],
    noticeIndices: [],
    noticeRule: null,
    blankStyle: "dots",
    slots: [...HEAD, { slot: "paymentPeriod" }, { slot: "disputedAmount" }, ...FOOT],
  },
  {
    state: "NV",
    form: "UNCONDITIONAL_FINAL",
    sourceId: SOURCE,
    citation: "NRS 108.2457(5)(d)",
    span: [790, 805],
    titleIndices: [790, 791],
    expectedTitle: "UNCONDITIONAL WAIVER AND RELEASE UPON FINAL PAYMENT",
    drafting: [
      {
        index: 804,
        why: "The statute's instruction that the notice which follows must appear, and in what type. Carried out, not printed.",
      },
    ],
    edits: [],
    noticeIndices: [805],
    noticeRule: NOTICE,
    blankStyle: "dots",
    slots: [...HEAD, { slot: "disputedAmount" }, ...FOOT],
  },
];
