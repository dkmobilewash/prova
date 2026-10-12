/**
 * THE APPROVED NORMALIZATION LIST -- the complete set of differences
 * allowed between the legislature's page and the form this tool prints.
 *
 * Approved by Diego 2026-10-08 as a short, explicit list, and shipped in the
 * attorney packet beside the raw and normalized text so the attorney
 * approves the list along with the words. If something needs to be done to a
 * statute's text that is not on this list, the answer is to add it here, in
 * words, and have it reviewed -- not to do it quietly in a form definition.
 *
 * Rules 1 and 2 are applied to every paragraph by lib/statutes/html-text.mjs.
 * Rules 3, 4 and 5 are applied only where a form definition enumerates them,
 * one instance at a time, and the build refuses an instance that does not
 * match the text it claims to remove.
 */
export interface NormalizationRule {
  id: string;
  name: string;
  description: string;
  example: string;
}

export const NORMALIZATION_RULES: NormalizationRule[] = [
  {
    id: "whitespace",
    name: "Whitespace collapse",
    description:
      "Every run of spaces, tabs, line breaks, no-break spaces and typographic spaces (en, em, thin, hair, narrow no-break) inside a paragraph becomes one ordinary space, and the paragraph is trimmed. Paragraph breaks are kept.",
    example:
      'Texas prints two spaces after a sentence ("rights.  It is prohibited"); the form prints one. Nevada puts an en space after every section number.',
  },
  {
    id: "nfc",
    name: "Unicode NFC",
    description:
      "Text is put in Unicode Normalization Form C, so a character that can be encoded two ways is always encoded the same way. No visible character changes.",
    example: "An accented letter stored as letter + combining accent becomes the single precomposed character.",
  },
  {
    id: "paragraph-quote-mark",
    name: "Texas paragraph-opening quotation marks",
    description:
      "Texas Property Code § 53.284 sets out each form inside quotation marks, opening every paragraph with a straight double quote and closing the last one. Those marks are how the statute quotes the form; they are not part of the form. Each one removed is listed in the form's definition.",
    example: '"Project ___ becomes Project ___ ; (Title)" becomes (Title)',
  },
  {
    id: "drafting-punctuation",
    name: "Drafting punctuation joining a form to the statute's own sentence",
    description:
      'Where a statute\'s sentence runs on from the end of a quoted passage of the form, the characters that belong to the statute\'s sentence are removed. Each instance is listed with the exact characters removed.',
    example: 'Texas § 53.284(c)(1) ends the notice with: use a conditional release form."; and -- the "; and is removed.',
  },
  {
    id: "drafting-instruction",
    name: "Drafting instructions",
    description:
      "A whole paragraph inside a form's span that is the statute giving an instruction about the form, rather than text of the form, is not printed. Each one is listed with the reason. The instruction's requirement is carried out instead (for example, the notice it describes is printed in the type it requires).",
    example:
      "Arizona: (Each unconditional waiver shall contain the following language, in type at least as large as the largest type otherwise on the document:)",
  },
];

export const NORMALIZATION_LIST_VERSION = "2026-10-08";
