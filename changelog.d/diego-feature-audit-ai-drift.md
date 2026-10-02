### Five shipped AI features had no row on the audit sheet, and a dead table was marked Built (Diego) — DOCS-ONLY AUDIT
`diego/feature-audit-ai-drift`

**Flagged docs-only, under the exception Diego granted 2026-09-07.** It corrects
claims that are false or stale, with the evidence and which it is, and there is
no accompanying code change for it to ride along with — the work it describes is
already on `main`.

**The headline is an absence, not a wrong status.** `FEATURE-AUDIT.md` Sheet 23
counted six AI features while `AI_FEATURES` declared nine. `QUOTE_EXTRACT`,
`PLAN_INGESTION`, `ADDENDUM_READ`, `BID_RESEARCH` and `LEAD_SEARCH` each had no
row at all — gated, metered, model-routed, live, and absent from the file
CLAUDE.md calls the source of truth for what is built.

`plumbing.test.ts` was green throughout and correctly so: it checks the header's
arithmetic against its own rows, and it cannot check that a row EXISTS for
something built. That is the gap a person has to cover.

**Why the absence mattered more than a wrong status.** On 2026-10-01 an audit
found `BID_RESEARCH` and `LEAD_SEARCH` had no control on any page — each ran
inside one Ask command, so a contractor paying for them could not find them.
This sheet is where somebody would have looked, and it did not know the features
existed. Five rows added, each naming the call site, the model, the gate, the
control, the eval and the gaps.

**The Anthropic row was false on both counts.** It said "Four call sites, all on
`claude-opus-5`… **Verified 2026-09-16 by audit, three ways that have to
agree**". Re-read today: **nine** call sites across seven files, and
`extractSheetTitleBlock` resolves to `claude-haiku-4-5`, which is the entire
point of `models.ts`.

Every word of that sentence was true on 2026-09-16. Five features shipped after
it. **The citation did not rot — it stayed exactly as convincing as the day it
was written, which is what made this the last row anybody would re-check.** A
dated verification is evidence about a date, not a standing guarantee, and the
more rigorous it sounds the longer it survives being wrong.

**`CompanyTradeScope` was marked Built and the table has been empty in every
account since it shipped.** Verified: there is no `prisma.companyTradeScope` call
anywhere in the repo — no form, no action, no seed. Its only two references
outside the schema are `export.ts`'s CSV allowlist, which therefore promises to
export a company's trade scopes and emits an empty file, and a comment in
`ask/commands/leads.ts` saying it "is empty in every account". Built → **Missing**,
held to the standard the row directly below it already states: marked Built on the
models alone, while not one row could be created through the app. **Third time
this sheet has recorded that defect.** Missing rather than Descoped because there
is no changelog entry, no issue and no "deliberately not built" note, so forgotten
and superseded cannot be told apart from the code.

**Two rows contradicting two other rows on the same sheets**, which is the drift
this file exists to prevent: "no sheet register" on the takeoff row (there is one,
on that same tab — `PlanSheetReview` over `sheetIndex.ts`), "on-screen tracing"
listed as not-yet on the wall-types row while the row twelve lines above describes
#515 shipping it, and "equipment sits under OTHER" on the recap row while Sheet 06
describes `EQUIPMENT` becoming its own `CostCategory` on 2026-09-26.

**Arithmetic re-derived from the rows, not diffed:** 154 items — 132 built / 16
partial / 5 missing / 1 descoped. `plumbing.test.ts` checks all three places it is
stated and agrees.

## `ONBOARDING.md`, because this file's header says they must tell the same story

They were wrong together, in the same direction, about the same six features: "the
three AI features" is now nine, with the registry named rather than a hand count.

**Section 7 was the worse half, and it is the first thing a new engineer reads
about where the product stands.** Eleven of the twelve things it called "not
started at all" have shipped — retainage, WH-347 certified payroll,
prevailing-wage rules, labor time tracking, safety, submittals, RFIs, drawings,
equipment, vendors, punch lists, warranty, notifications — and it also said no
role exists beyond Owner/Member while `permissions.ts` defines `ESTIMATOR`,
`PROJECT_MANAGER` and `ACCOUNTING`. Only real payment processing is still true,
and it is left standing. The built list is not re-enumerated: a prose list of
twelve things is twelve claims with twelve expiry dates kept in a second place,
which is exactly what rotted.

**"There is no automated test suite anywhere" was the most expensive sentence in
the file.** There are 589 test files; `pnpm test` runs over eight thousand unit
tests in about thirty seconds, plus a db suite, a browser journey and four CI
jobs. A new engineer reading that would hand-verify work a thirty-second command
already covers, and would not know a dozen censuses fail the build over the exact
mistakes this repo keeps making.

**AND ONE CLAIM THAT LOOKED STALE AND IS STILL TRUE, which is the half worth
reading.** The same paragraph warns that QuickBooks tokens are stored unencrypted.
The sentence beside it had gone false, so the whole paragraph read stale — and
`QuickBooksConnection.accessToken`/`.refreshToken` really are bare `String`
columns on `billing.prisma`, with open issue #353 naming it. It is kept, and now
says why the neighbouring "credentials are encrypted at rest" is also true: that
is the newer `IntegrationConnection` shelf, and QuickBooks predates it on its own
tables. A stale paragraph is not a stale sentence, and I nearly corrected a live
security warning out of the file.

Checked: `typecheck`, `lint`, **8,487 unit tests over 537 files**, all green.
