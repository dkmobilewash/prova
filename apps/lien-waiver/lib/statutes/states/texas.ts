import type { Edit, FormDefinition, NoticeRule, SlotRef } from "../types";

/**
 * Texas -- Tex. Prop. Code § 53.284(b)-(e), four forms.
 *
 * Source: statutes/raw/tx-53.html, the chapter page on
 * statutes.capitol.texas.gov RENDERED by a headless browser (the site is a
 * JavaScript app; a plain fetch returns an empty shell). Paragraph numbers
 * are into statutes/text/tx-53.txt.
 *
 * Texas sets each form out inside quotation marks: every paragraph of the
 * form opens with a straight double quote and the last one closes with
 * one. Those marks are the statute quoting the form, so they come off --
 * normalization rule "paragraph-quote-mark", one edit per mark, all listed
 * below by `quoteMarks`. The notice in (c)(1) and (e)(1) also carries the
 * statute's own sentence ending, `"; and`, which comes off under
 * "drafting-punctuation".
 */

const SOURCE = "tx-53";

/** One opening-quote edit per paragraph, and the closing quote on the
 * last. Generated rather than typed out so none is missed, and still one
 * listed edit per mark in the generated forms and the attorney packet. */
function quoteMarks(indices: number[], closing: number): Edit[] {
  const edits: Edit[] = indices.map((index) => ({ index, at: "start", text: '"', rule: "paragraph-quote-mark" }));
  edits.push({ index: closing, at: "end", text: '"', rule: "paragraph-quote-mark" });
  return edits;
}

function range(from: number, to: number, skip: number[] = []): number[] {
  const out: number[] = [];
  for (let index = from; index <= to; index += 1) if (!skip.includes(index)) out.push(index);
  return out;
}

const NOTICE: NoticeRule = {
  placement: "top",
  bold: true,
  atLeastLargestType: true,
  minimumPoints: 10,
  authority:
    "Tex. Prop. Code § 53.284(c)(1) and (e)(1): \"contain a notice at the top of the document, printed in bold type at least as large as the largest type used in the document, but not smaller than 10-point type\".",
};

const HEAD: SlotRef[] = [{ slot: "project" }, { slot: "jobNumber" }];
const PROPERTY: SlotRef[] = [{ slot: "owner" }, { slot: "jobLocation" }, { slot: "jobDescription" }];
const FOOT: SlotRef[] = [{ slot: "signedDate" }, { slot: "companyName" }, { slot: "signature" }, { slot: "signerTitle" }];

export const TEXAS: FormDefinition[] = [
  {
    state: "TX",
    form: "CONDITIONAL_PROGRESS",
    sourceId: SOURCE,
    citation: "Tex. Prop. Code § 53.284(b)",
    span: [751, 761],
    titleIndices: [751],
    expectedTitle: "CONDITIONAL WAIVER AND RELEASE ON PROGRESS PAYMENT",
    drafting: [],
    edits: quoteMarks(range(751, 761), 761),
    noticeIndices: [],
    noticeRule: null,
    blankStyle: "underscore",
    slots: [
      ...HEAD,
      { slot: "checkMaker" },
      { slot: "amount" },
      { slot: "payee" },
      ...PROPERTY,
      { slot: "customer" },
      ...FOOT,
    ],
  },
  {
    state: "TX",
    form: "UNCONDITIONAL_PROGRESS",
    sourceId: SOURCE,
    citation: "Tex. Prop. Code § 53.284(c)",
    span: [764, 776],
    titleIndices: [767],
    expectedTitle: "UNCONDITIONAL WAIVER AND RELEASE ON PROGRESS PAYMENT",
    drafting: [{ index: 766, why: 'The statute\'s "(2) below the notice, read:" -- an instruction placing the form under the notice.' }],
    edits: [
      ...quoteMarks(range(764, 776, [766]), 776),
      // Applied in order: the statute's "; and" first, then the quote mark
      // that closed the notice before it.
      { index: 765, at: "end", text: "; and", rule: "drafting-punctuation" },
      { index: 765, at: "end", text: '"', rule: "paragraph-quote-mark" },
    ],
    noticeIndices: [764, 765],
    noticeRule: NOTICE,
    blankStyle: "underscore",
    slots: [...HEAD, { slot: "amount" }, { slot: "customer" }, ...PROPERTY, { slot: "customer" }, ...FOOT],
  },
  {
    state: "TX",
    form: "CONDITIONAL_FINAL",
    sourceId: SOURCE,
    citation: "Tex. Prop. Code § 53.284(d)",
    span: [778, 788],
    titleIndices: [778],
    expectedTitle: "CONDITIONAL WAIVER AND RELEASE ON FINAL PAYMENT",
    drafting: [],
    edits: quoteMarks(range(778, 788), 788),
    noticeIndices: [],
    noticeRule: null,
    blankStyle: "underscore",
    slots: [
      ...HEAD,
      { slot: "checkMaker" },
      { slot: "amount" },
      { slot: "payee" },
      ...PROPERTY,
      { slot: "customer" },
      ...FOOT,
    ],
  },
  {
    state: "TX",
    form: "UNCONDITIONAL_FINAL",
    sourceId: SOURCE,
    citation: "Tex. Prop. Code § 53.284(e)",
    span: [791, 802],
    titleIndices: [794],
    expectedTitle: "UNCONDITIONAL WAIVER AND RELEASE ON FINAL PAYMENT",
    drafting: [{ index: 793, why: 'The statute\'s "(2) below the notice, read:" -- an instruction placing the form under the notice.' }],
    edits: [
      ...quoteMarks(range(791, 802, [793]), 802),
      // Applied in order: the statute's "; and" first, then the quote mark
      // that closed the notice before it.
      { index: 792, at: "end", text: "; and", rule: "drafting-punctuation" },
      { index: 792, at: "end", text: '"', rule: "paragraph-quote-mark" },
    ],
    noticeIndices: [791, 792],
    noticeRule: NOTICE,
    blankStyle: "underscore",
    slots: [...HEAD, { slot: "customer" }, ...PROPERTY, ...FOOT],
  },
];
