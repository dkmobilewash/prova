# Lien waiver tool: research note

Research for the launch states, done 2026-10-08 from the **official legislature
sites only**: no vendor blogs, no secondary summaries. Every quotation below is
from the captured page in `statutes/raw/`, and the forms themselves are in
`docs/attorney-packet.md`, generated from those captures. Anything this note
could not settle is a numbered question in that packet (`lib/statutes/questions.ts`);
nothing ambiguous was decided here.

## How the text was obtained, and why it matters

The rule for this tool is that statutory text is never typed or paraphrased by a
person or a model. So the text was **captured**, not copied:

| State | Official page | How captured | Why |
| --- | --- | --- | --- |
| AZ | <https://www.azleg.gov/ars/33/01008.htm> | direct download, `Capture statutes` workflow | a plain HTML page |
| CA | <https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?lawCode=CIV&division=4.&title=1.&part=6.&chapter=3.&article=> | headless-browser render | leginfo answers **403** to GitHub's runners, with or without a browser user-agent |
| NV | <https://www.leg.state.nv.us/NRS/NRS-108.html> | direct download | a plain HTML page, encoded **windows-1252** |
| TX | <https://statutes.capitol.texas.gov/Docs/PR/htm/PR.53.htm> | headless-browser render | the site is a JavaScript app; a plain request returns an empty shell (250 KB, no statute in it) |
| NM | <https://nmonesource.com/nmos/nmsa/en/4413/1/document.do> | direct download (PDF) | the official NMSA 1978 Chapter 48 document |

An agent container cannot reach any of these hosts (its egress proxy refuses
them), which is why capture runs in a GitHub workflow, or as a rendered page
written straight to disk. Neither path passes the text through anyone's own
writing. Each capture's SHA-256, retrieval time and method are in its `.meta.json`.

**Two silent one-character failures were found while building this, and both
are now guarded:**

- **Nevada's apostrophes disappeared.** Node's `TextDecoder("windows-1252")`, on
  a build without full ICU, decodes as Latin-1: byte `0x92` became the invisible
  control `U+0092` instead of `’`, so "Undersigned’s Customer" read
  "Undersigneds Customer" with nothing on screen to show a character had gone.
  `lib/statutes/html-text.mjs` now decodes windows-1252 from the WHATWG table
  itself, and refuses any control or replacement character in its output.
- **Words overlapped in the PDF.** pdf-lib *measures* text with kerning but
  *draws* without it, so after a heavily kerned bold "PAYMENT." the next word
  began about 4pt early, on top of it. The PDF test caught it by reading
  "PAYMENT.A" back out of the file. Widths are now summed per character.

## Arizona: A.R.S. § 33-1008

- **The forms.** § 33-1008(D)(1)–(4), four forms: conditional/unconditional ×
  progress/final. A waiver "is unenforceable unless it follows substantially the
  following forms" (D).
- **Required fields.** Project, Job No., maker of check, amount, payee (conditional
  forms), owner, job description, the person contracted with, through date
  (progress forms), disputed claims amount (final forms), date, company name,
  signature, title.
- **Notarization.** None. Effective "only if the waiver and release … is signed by
  the claimant or his authorized agent" (A). No notary is mentioned.
- **Who signs.** The claimant or its authorized agent (A).
- **Formatting.** Each unconditional waiver "shall contain" the notice "in type at
  least as large as the largest type otherwise on the document" ((D)(2), (D)(4)).
  It does not say where on the page: question AZ-2.
- **Conditional releases need evidence of payment:** "the claimant's endorsement on
  a single or joint payee check that has been paid by the bank on which it was
  drawn or … written acknowledgment of payment" (A).
- **Plain English.** Progress forms release rights through the date written, and
  say on their face they do "not cover any retention, pending modifications and
  changes or items furnished after that date". Final forms release everything
  "except for disputed claims in the amount of $___".
- **Ambiguities, for the attorney.** The two instruction parentheticals (AZ-1);
  notice placement (AZ-2); small inconsistencies between the published forms
  ("Date:" vs "Dated:") and gendered "he" (AZ-3). All are printed exactly as
  published.

## California: Cal. Civ. Code §§ 8132, 8134, 8136, 8138

- **The forms.** § 8132 conditional progress, § 8134 unconditional progress,
  § 8136 conditional final, § 8138 unconditional final. Each: "shall be null,
  void, and unenforceable unless it is in substantially the following form".
- **The general rule (§ 8124).** A waiver releases the owner, lender or surety only
  if "(a) The waiver and release is in substantially the form provided in this
  article and is signed by the claimant" and, for a conditional release, "(b) …
  there is evidence of payment to the claimant".
- **Required fields.** Name of Claimant, Name of Customer, Job Location, Owner,
  Through Date (progress), Maker of Check / Amount of Check / Check Payable to
  (conditional), the progress payment amount (unconditional progress), the
  exceptions (prior unpaid conditional waivers on § 8132; disputed claims for
  extras on the final forms), Claimant's Signature, Title, Date of Signature.
- **Notarization.** None. § 8124(a) requires a signature only.
- **Formatting.** The notice is part of each form's text, under its title, in
  capitals as published. §§ 8132–8138 add no type-size rule (question CA-2).
- **Plain English.** The unconditional forms carry their own warning: the document
  "is enforceable against you if you sign it, even if you have not been paid".
  The progress forms list four things they do not affect, including retentions
  and contract rights.
- **Ambiguities.** California's blanks are labels with nothing after them; the
  tool writes values after the label (CA-1). The source was captured by render
  (CA-3).

## Nevada: NRS 108.2457

- **The forms.** NRS 108.2457(5)(a)–(d). Nevada is the strictest of the four on
  form: a waiver "is unenforceable unless it is in the following forms in the
  following circumstances". The statute does not say "substantially" (question NV-1).
- **Required fields.** Property Name, Property Location, Undersigned's Customer,
  Invoice/Payment Application Number, Payment Amount, Payment Period and Amount of
  Disputed Claims (conditional final), Amount of Disputed Claims (unconditional
  final), Dated, company name, By (signature), Its (title).
- **Notarization.** None. "Signed by the lien claimant or the lien claimant's
  authorized agent" (1)(a).
- **Formatting.** The unconditional notice must be "in type at least as large as
  the largest type otherwise on the document" ((5)(b), (d)); placement is not stated
  (NV-2).
- **Plain English, and a protection worth knowing:** if payment is by check or
  draft "and the same fails to clear the bank on which it is drawn for any reason,
  then the waiver and release shall be deemed null, void and of no legal effect
  whatsoever" (5)(e). A conditional waiver binds only once the claimant "receives
  payment of the amount identified" (1)(b).

## Texas: Tex. Prop. Code § 53.284

- **The forms.** § 53.284(b)–(e). A waiver "is unenforceable unless it substantially
  complies with the applicable form" (a). § 53.281(b): effective only if "(1) the
  waiver and release substantially complies with one of the forms prescribed by
  Section 53.284; (2) the waiver and release is signed by the claimant or the
  claimant's authorized agent; and (3) in the case of a conditional release,
  evidence of payment to the claimant exists."
- **Notarization: the change the brief asked us to verify.** The current text
  requires a **signature**; nothing in §§ 53.281–53.284 mentions a notary, and none
  of the four forms has a notary block. The official history line for § 53.281
  reads "Amended by: Acts 2021, 87th Leg., R.S., Ch. 690 (H.B. 2237), Sec. 35, eff.
  January 1, 2022"; § 53.284's history shows only "Added by Acts 2011 … eff.
  January 1, 2012". We did **not** retrieve the pre-2022 wording of § 53.281, so
  "notarization was required before 2022" is not established here. The page says
  only what the current statute says (question TX-2).
- **Required fields.** Project, Job No., maker of check, amount, payee (conditional),
  owner, location, job description, the person contracted with, date, company name,
  signature, title.
- **Formatting.** The unconditional forms must "contain a notice at the top of the
  document, printed in bold type at least as large as the largest type used in the
  document, but not smaller than 10-point type" ((c)(1), (e)(1)). The tool prints
  nothing above that notice.
- **Who may require what.** § 53.283: "A person may not require a claimant or
  potential claimant to execute an unconditional waiver and release for a progress
  payment or final payment amount unless the claimant or potential claimant
  received payment in that amount in good and sufficient funds."
- **Drafting marks.** Every paragraph of each form opens with a quotation mark, and
  the notices end with the statute's own `"; and`. These are removed under
  normalization rules 3 and 4, each one listed in the packet (TX-1).

## New Mexico: no statutory form

NMSA 1978 Chapter 48, Article 2 (Mechanics' and Materialmen's Liens) and Article
2A (the Stop Notice Act, which covers residential properties of four or fewer units) were searched in full in the
official compilation. **Neither prescribes a lien waiver form.** "Waiver of lien"
appears only in passing: § 48-2A-12 (purchase closing) has the original contractor
list subcontractor invoices "accompanied by a waiver of lien" without setting out
its wording, and § 48-2-10 provides that "A contingent payment clause in a
contract shall not be construed as a waiver of the right to file and enforce a
mechanic's or materialman's lien". The "statutory form" sections elsewhere in
Chapter 48 belong to other lien types, such as oil and gas liens.

So the tool offers **no** New Mexico form (inventing or borrowing one would put
words in front of a sub that no statute stands behind), explains why, and takes a
"notify me" sign-up. Question NM-1 asks the attorney to confirm.

## What the tool does not do

It computes no deadline, and says nothing about whether to sign. The rule in
`apps/web/lib/lien-deadlines.ts` stands unchanged. See `changelog.d/` for the
decision that lets this separate tool print statutory wording at all.
