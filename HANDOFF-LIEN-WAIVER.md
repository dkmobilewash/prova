# Handoff — the lien waiver generator

Paste this whole file into a new chat **that has web access**. It is written
to be self-contained: it names what exists, what is missing, exactly what to
fetch, and where it goes.

---

## What the product is

A **free lien waiver generator for commercial specialty-trade subcontractors**
(metal framing & drywall, lath & plaster, EIFS/stucco). It fills in the
**state's own statutory lien waiver form** and returns a clean PDF in about
three minutes. No account; the user gives an email to download.

**Launch states: Arizona, California, Nevada, Texas.** Four waiver types:
conditional progress, unconditional progress, conditional final, unconditional
final.

Why this and not the drawing-set read it replaced: a waiver is the state's own
form with the blanks filled, so it is right from day one and checkable by the
person signing it. A sub needs one **every month on every job**, and each one
goes to a GC with C Stream's name on it.

---

## THE ONE THING BLOCKING IT — and it needs a browser

**The verbatim text of all 16 forms and all 4 statutory notices is not
established.** Every official source is blocked by the agent container's
egress proxy — measured at **403 on CONNECT**, not guessed:

- `azleg.gov`
- `leginfo.legislature.ca.gov`
- `leg.state.nv.us`
- `statutes.capitol.texas.gov`

…and every secondary source too (Justia, FindLaw, public.law, Levelset, even
Wikipedia). GitHub is the only reachable host, and its code search is scoped
to this repo.

**So the forms were left blank rather than reconstructed.** That is the single
most important decision in this handoff and it should not be reversed: a
paraphrased statutory notice would ship on a legal document a GC relies on and
a subcontractor's lien rights hang from. In California a waiver that is not
substantially the prescribed form is **"null, void, and unenforceable."**

### What to fetch, precisely

For each state × each of the four types — **16 forms** — get:

1. the **verbatim form body**, including every blank and its label, and
2. the **verbatim statutory notice** (the conspicuous warning), and
3. the **formatting requirement** attached to that notice.

| state | statute |
| --- | --- |
| Arizona | A.R.S. §33-1008 — forms at (D)(1)–(4); (A) anti-waiver; (B) informal void; (C) settlement |
| California | Cal. Civ. Code §8132 (cond. progress), §8134 (uncond. progress), §8136 (cond. final), §8138 (uncond. final); plus §8122, §8124, §8126, §8128 |
| Nevada | NRS 108.2457 — forms at (5)(a)–(d); plus NRS 108.2453 |
| Texas | Tex. Prop. Code §53.284 — forms at (b)–(e); plus §53.281, §53.282, §53.283, §53.286 |

**Transcribe, do not summarise.** Character-exact, including capitalisation
and punctuation. Then a person checks each against the official text.

---

## What is already built, on branch `cyrus/lien-waiver`

### `apps/web/lib/lien-waiver.ts` — the spine

- `WAIVER_STATES`, `WAIVER_TYPES`
- `TYPE_GUIDE` — what each type means in the sub's words, and what it costs
- `STATE_RULES` — citation, compliance standard, penalty, notice rule, notarization
- `FORM_FIELDS` — the blanks, per state per type
- `STATUTORY_TEXT` — **all 16 are `null`.** This is where the fetched text goes.
- `renderable(state, type)` — the only gate the PDF path may use. **There is
  deliberately no override flag.**
- `EXCEPTIONS_QUESTIONS` — the structured interview
- `INTAKE_QUESTIONS` — currently the Texas notarization question
- `noticeIsLargest(noticePt, everyOtherPt)` — the renderer constraint

### `apps/web/lib/lien-waiver.test.ts` — 9 tests, all passing

The important one: **nothing may render while its statutory text is null.**
Once text is added, the same test requires both halves present, a minimum
length, and no `TODO`/`PLACEHOLDER`/`lorem`.

---

## Findings that change the design — do not re-derive these

**1. Nevada is the strictest and sets the bar for all four.** NRS 108.2457
says the waiver **"must be in the following form"** — the word
"substantially", which CA, AZ and TX all carry, is absent. No case found
resolving strict vs substantial, so treat it as byte-exact. **Design to
Nevada and the other three are satisfied.**

**2. The penalties differ, and Texas is the outlier the other way.** A term
that expands or restricts statutory rights is **disregarded** in Texas rather
than voiding the waiver. California voids the whole thing.

**3. It is four distinct documents, not one form with four skins.**
Nevada keys the release to an **invoice / pay-application number**, not a
through-date. **California's FINAL forms have no through-date at all.** AZ and
TX follow the older California lineage. A model with `throughDate` on all
sixteen is wrong in five of them.

**4. Texas notarization depends on the ORIGINAL (prime) contract date**, not
the signing date — dropped only for prime contracts entered on or after
**1 January 2022**. A sub signing in 2026 on a 2021-prime job still needs a
notary block. This is an intake question, already in `INTAKE_QUESTIONS`.

**5. The notice type-size rule is a RENDERER constraint, not a style.** CA:
notice ≥ largest type otherwise in the form. AZ: ≥ largest type on the
document. TX: top of document, bold, ≥ largest elsewhere, floor 10pt. NV: not
established. **So no glyph anywhere may exceed the notice** — adding a logo or
enlarging a heading silently breaks three states at once. `noticeIsLargest`
exists for this; wire it into whatever emits the PDF.

**6. The Exceptions block is where the tool earns its keep.** No state
protects a blank one, and California's final forms carve out only "disputed
claims for extras" — much narrower than its progress forms. **A final waiver
signed while retainage is outstanding is the dangerous combination**, and the
word "final" in the title is not protection. Never ship Exceptions as an empty
textarea; ask the structured questions and compose the block.

---

## Still to build

1. Drop the 16 transcribed forms into `STATUTORY_TEXT`.
2. The page — `/lien-waiver`, public, outside `(app)`, registered in
   `apps/web/e2e/lib/publicRoutes.ts` or the public browser suite will not
   walk it.
3. The intake flow: state → type (the picker leads; choosing wrong is the
   expensive mistake) → fields → exceptions interview → email → PDF.
4. The PDF renderer, asserting `noticeIsLargest` before it emits.
5. The email delivery path. `packages/integrations/src/email.ts` already
   exists and needs `RESEND_API_KEY` + `OUTBOUND_EMAIL_FROM`.
6. A census that no form text contains a `TODO` and that every renderable
   form has passed a human check.

## Research file

`scratchpad/lien-research.md` — 726 lines, with sources and an explicit
**19-item NOT VERIFIED section**, 8 of them blocking. Read that section before
trusting any field label: the field *sets* are structurally reliable, the
*labels* are not character-verified.

## Repo conventions that will bite

- Never `git add -A` — explicit paths only.
- `pnpm install` cannot complete in an agent container (the `xlsx` tarball
  host is blocked); `apps/web/node_modules/xlsx` is a local stub and 7 tests
  fail permanently there. That is not your change.
- Run the **full** `pnpm exec vitest run`, not subsets — a brand-fill census
  caught a two-character slip that 90 passing suites missed.
- Announce in Slack `#prova-build` BEFORE pushing an edit to a shared file.
- One file per PR in `changelog.d/`, named after the branch.
