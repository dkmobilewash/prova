/**
 * The shapes the statutory forms are described in.
 *
 * A form is NOT stored as text anywhere in this app. It is described as a
 * span of paragraphs in a captured statute page (statutes/raw), plus an
 * enumerated list of the characters removed from that span and why. The
 * text is then DERIVED -- by lib/statutes/build.ts, checked by
 * generated.test.ts -- so there is no copy of a statute that someone could
 * have typed, and no way for the form to say something the legislature's
 * page does not.
 */

export const STATES = ["AZ", "CA", "NV", "TX"] as const;
export type StateCode = (typeof STATES)[number];

export const FORM_KEYS = [
  "CONDITIONAL_PROGRESS",
  "UNCONDITIONAL_PROGRESS",
  "CONDITIONAL_FINAL",
  "UNCONDITIONAL_FINAL",
] as const;
export type FormKey = (typeof FORM_KEYS)[number];

/** How a statute marks the place a person writes something.
 *  - underscore: a run of underscores (Arizona, Texas);
 *  - dots: a run of periods, a dot leader (Nevada);
 *  - label: a label ending the paragraph with nothing after it (California's
 *    "Name of Claimant:"), so the fill is written after the label. */
export type BlankStyle = "underscore" | "dots" | "label";

/** Which approved normalization rule an edit is an instance of. The list
 * itself, in words, is lib/statutes/normalization.ts. */
export type EditRule = "paragraph-quote-mark" | "drafting-punctuation";

/** Characters removed from the start or end of one paragraph. Never an
 * insertion and never a change in the middle: the only thing an edit can do
 * is delete exactly `text` from one end, and the build refuses one whose
 * `text` is not actually there. */
export interface Edit {
  index: number;
  at: "start" | "end";
  text: string;
  rule: EditRule;
}

/** A whole paragraph inside a form's span that is the statute talking about
 * the form rather than the form itself. */
export interface Drafting {
  index: number;
  why: string;
}

/** A blank, as a form refers to it: which catalog slot fills it, and an
 * optional plain-English label for this form when the catalog's is not
 * right here. */
export interface SlotRef {
  slot: SlotId;
  label?: string;
}

export type SlotId =
  | "project"
  | "jobNumber"
  | "checkMaker"
  | "amount"
  | "payee"
  | "owner"
  | "jobLocation"
  | "jobDescription"
  | "customer"
  | "throughDate"
  | "disputedAmount"
  | "signedDate"
  | "companyName"
  | "signature"
  | "signerTitle"
  | "invoiceNumber"
  | "paymentPeriod"
  | "priorWaiverDates"
  | "priorUnpaidAmounts";

export interface NoticeRule {
  /** Where the notice goes on the page. "top" is what Texas and California
   * prescribe; Arizona and Nevada only say the waiver must "contain" it, so
   * the placement there is OUR choice and is on the attorney's list. */
  placement: "top" | "statutory-order";
  bold: boolean;
  /** "in type at least as large as the largest type otherwise on the
   * document" -- Arizona, Nevada, Texas. */
  atLeastLargestType: boolean;
  /** Texas: "not smaller than 10-point type". */
  minimumPoints: number | null;
  /** The words of the statute that impose the rule, for the packet. */
  authority: string;
}

export interface FormDefinition {
  state: StateCode;
  form: FormKey;
  sourceId: string;
  /** The subsection that prescribes this form. */
  citation: string;
  /** Inclusive paragraph indices into the source's extracted text. */
  span: [number, number];
  /** Paragraphs that are the form's title. */
  titleIndices: number[];
  /** What the title must read once edits are applied -- a tripwire, so a
   * statute page that moved under its indices fails loudly instead of
   * producing a different form. */
  expectedTitle: string;
  drafting: Drafting[];
  edits: Edit[];
  noticeIndices: number[];
  noticeRule: NoticeRule | null;
  /** Section headings inside the form (California's "Identifying
   * Information", "Exceptions", "Signature"). */
  headingIndices?: number[];
  blankStyle: BlankStyle;
  /** For `label` style: the paragraphs that take a fill after them. */
  labelIndices?: number[];
  /** One entry per blank, in document order. The build fails if the count
   * differs from the blanks it finds. */
  slots: SlotRef[];
}

export type ParagraphRole = "title" | "notice" | "heading" | "caption" | "body";

/** A form paragraph as it is shipped: derived, normalized, ready to render. */
export interface FormParagraph {
  /** Index in the source's extracted text, for tracing back. */
  index: number;
  text: string;
  role: ParagraphRole;
  /** California-style: a label whose blank is written after it. */
  label?: boolean;
}

export interface BuiltForm {
  state: StateCode;
  form: FormKey;
  citation: string;
  sourceId: string;
  sourceUrl: string;
  sourceCitation: string;
  retrievedAt: string;
  capturedVia: "fetch" | "headless-render";
  rawSha256: string;
  blankStyle: BlankStyle;
  noticeRule: NoticeRule | null;
  slots: SlotRef[];
  paragraphs: FormParagraph[];
  /** SHA-256 of the paragraphs' text joined with "\n". What an attorney's
   * review is recorded against. */
  textSha256: string;
}
