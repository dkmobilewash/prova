/**
 * Everything this build decided that a construction attorney should decide
 * instead, or confirm. Diego's instruction (2026-10-08): anything uncertain
 * -- form text versus drafting instruction above all -- goes on this list;
 * it is not decided in code.
 *
 * Rendered into docs/attorney-packet.md by generated.test.ts. Each one
 * names what the tool does TODAY, so the attorney is approving or
 * correcting something concrete.
 */
export interface AttorneyQuestion {
  id: string;
  question: string;
  whatTheToolDoesNow: string;
}

export const QUESTIONS: Record<"GENERAL" | "AZ" | "CA" | "NV" | "TX" | "NM", AttorneyQuestion[]> = {
  GENERAL: [
    {
      id: "G-1",
      question: "Do you approve the normalization list (five rules)? Does any removal it allows change the legal effect of any form?",
      whatTheToolDoesNow: "Applies exactly those five rules, each instance enumerated per form below; nothing else differs from the published text.",
    },
    {
      id: "G-2",
      question:
        "The statutes require the form be followed \"substantially\" (AZ, CA, TX) or used as \"the following forms\" (NV). Is printing the published text with the blanks filled in, in our layout and typeface, acceptable in each state?",
      whatTheToolDoesNow: "Prints every word of the form in statutory order, Helvetica, US Letter, fills underlined in place of the blank.",
    },
    {
      id: "G-3",
      question:
        "May a small C-Stream header and footer appear on the PDF, outside the statutory text? Should it be off for any state?",
      whatTheToolDoesNow:
        "Header line above the form and a footer naming the citation, source host and retrieval date. Where the notice must be at the top of the document (Texas), nothing prints above it and the header line moves to the footer. Switchable per state (`brandFrame`).",
    },
    {
      id: "G-4",
      question:
        "Fills: a value replaces the blank; an optional blank left empty prints the statute's own blank for handwriting; where the statute's blank touches the label (Nevada's dot leaders, California's labels) the value is preceded by one space. Acceptable?",
      whatTheToolDoesNow: "As described. The signature blank is never filled; the tool offers no e-signature.",
    },
    {
      id: "G-5",
      question:
        "Our two questions pick the form: \"Which payment is this for?\" (progress/final) and \"Has this payment cleared your bank?\" (not yet = conditional, yes = unconditional). Is that framing accurate in all four states, and does it stay on the right side of giving legal advice?",
      whatTheToolDoesNow:
        "Shows the chosen form's name, citation and a plain-English meaning, plus fixed warnings on every unconditional and every final form.",
    },
    {
      id: "G-6",
      question: "Are the plain-English meanings, warnings and per-state notes (lib/content.ts, reproduced below) accurate, and free of anything that reads as advice?",
      whatTheToolDoesNow: "Shows them on the state page. They are part of each state's review digest.",
    },
    {
      id: "G-7",
      question: "Please review the privacy notice and terms of use (app/privacy/page.tsx, app/terms/page.tsx; rendered at /privacy and /terms).",
      whatTheToolDoesNow: "Drafts written to match what the code does.",
    },
    {
      id: "G-8",
      question:
        "Captions under a blank (\"(maker of check)\", \"(Title)\") print in smaller type than the body. Notices print in bold at the largest size on the page. Any objection?",
      whatTheToolDoesNow: "Captions 7.5pt, body 10pt, title and notice 12pt bold.",
    },
  ],
  AZ: [
    {
      id: "AZ-1",
      question:
        "The parentheticals \"(Each unconditional waiver shall contain the following language, in type at least as large as the largest type otherwise on the document:)\" after forms (D)(2) and (D)(4) are treated as drafting instructions and not printed. Agree?",
      whatTheToolDoesNow: "Omits them and prints the notice they describe in type at least as large as anything else on the page.",
    },
    {
      id: "AZ-2",
      question:
        "Arizona says the unconditional waiver must \"contain\" the notice but not where. Should it print at the top, or after the form where the statute sets it out?",
      whatTheToolDoesNow: "After the form (statutory order).",
    },
    {
      id: "AZ-3",
      question:
        "The published forms differ slightly from each other (\"Date:\" on (D)(1), \"Dated:\" on the rest; the (D)(4) notice split over two paragraphs) and use \"he\"/\"his\". Keep exactly as published?",
      whatTheToolDoesNow: "Keeps every one as published.",
    },
  ],
  CA: [
    {
      id: "CA-1",
      question:
        "California's blanks are labels with nothing after them (\"Name of Claimant:\"). The tool writes the value after the label, and draws a rule (a line, not characters) after an empty one. Acceptable?",
      whatTheToolDoesNow: "As described.",
    },
    {
      id: "CA-2",
      question:
        "§§ 8132–8138 state no type size or placement for the notice beyond its place in the form. Is there any other requirement we should apply?",
      whatTheToolDoesNow: "Prints the notice where the form puts it, under the title, in bold at the largest size on the page.",
    },
    {
      id: "CA-3",
      question:
        "leginfo.legislature.ca.gov refuses scripted downloads, so the page was captured by rendering it in a headless browser. Please compare the form text in this packet against the official site.",
      whatTheToolDoesNow: "Records the capture method, retrieval time and SHA-256 of what was captured.",
    },
  ],
  NV: [
    {
      id: "NV-1",
      question:
        "NRS 108.2457(5) says a waiver is unenforceable \"unless it is in the following forms\" -- no \"substantially\". Does any difference at all (layout, typeface, header/footer, a value replacing a dot leader) put enforceability at risk?",
      whatTheToolDoesNow: "Prints the published words in order with the values in place of the dot leaders.",
    },
    {
      id: "NV-2",
      question: "As AZ-2: should the unconditional notice print at the top, or after the form where the statute sets it out?",
      whatTheToolDoesNow: "After the form (statutory order). The instruction parenthetical before it is omitted, as in AZ-1.",
    },
  ],
  TX: [
    {
      id: "TX-1",
      question:
        "Each form in § 53.284 is set out inside quotation marks, one opening every paragraph, and the (c)(1)/(e)(1) notices end with the statute's own \"; and\". Removing those marks is rules 3 and 4. Agree they are not part of the form?",
      whatTheToolDoesNow: "Removes them; every removal is listed below.",
    },
    {
      id: "TX-2",
      question:
        "Notarization: current § 53.281(b)(2) requires the waiver be \"signed by the claimant or the claimant's authorized agent\" and says nothing about a notary. The history line shows § 53.281 amended by H.B. 2237, effective January 1, 2022; § 53.284 shows no amendment since 2011. We did not retrieve the pre-2022 text. Please confirm notarization is not required, and say whether the page should say anything more.",
      whatTheToolDoesNow: "Says the statute requires a signature and is silent on notarization, and that § 53.281 was amended effective 2022-01-01.",
    },
    {
      id: "TX-3",
      question:
        "In the unconditional progress form, \"...that the signer has on the above referenced project to the following extent:\" is followed by no blank; the next paragraph begins \"This release covers...\". Print as published?",
      whatTheToolDoesNow: "Prints as published.",
    },
    {
      id: "TX-4",
      question:
        "statutes.capitol.texas.gov is a JavaScript application, so the chapter was captured by rendering it in a headless browser. Please compare the form text here against the official site.",
      whatTheToolDoesNow: "Records the capture method, retrieval time and SHA-256.",
    },
  ],
  NM: [
    {
      id: "NM-1",
      question:
        "We found no statutory lien waiver form in NMSA 1978 Chapter 48, Articles 2 and 2A. Please confirm, and say whether anything else (for example § 48-2A-12's residential closing affidavit, which refers to a \"waiver of lien\") should be mentioned on the New Mexico page.",
      whatTheToolDoesNow: "Says there is no statutory form, offers no form, and takes a \"notify me\" sign-up.",
    },
  ],
};
