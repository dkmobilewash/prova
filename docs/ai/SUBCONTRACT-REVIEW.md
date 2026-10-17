# AI subcontract review: Phase 0 design

Status: **design only, no code.** Written 2026-10-17 on `claude/awesome-bell-s4g7b9`, against `main` at `8b82f6e`.
Audience: Diego, who approves each phase before the next one starts.

**What it does.** A sub uploads the GC's subcontract and its exhibits (scope of work, insurance requirements, general conditions). C-Stream then:

- lists the risk clauses, each with a severity, the exact quote, the page and section, a plain-English meaning, and a suggested negotiating position;
- checks the contract's scope and money against our won bid;
- produces a one-page summary.

The person accepts, dismisses, edits or marks each finding as negotiated. Nothing is saved, changed or sent unless they do it.

---

## 1. What already exists and will be reused

| Need | Existing piece | Path | How it is reused |
| --- | --- | --- | --- |
| The contract file | `ContractDocument`: one row per version, a Blob `fileUrl`, numbered by `ContractDocumentVersionCounter` | `packages/db/prisma/schema/billing.prisma`; `uploadContractDocument` in `lib/actions/billing.ts:1181` | A review points at **one `ContractDocument` row**. No second version table. |
| Upload | `uploadDocumentFile(purpose, ownerId, file)` sends the file straight to Blob; `documentUrlProblem` guards the URL; `DOCUMENT_UPLOAD_PURPOSES` lists what may be uploaded | `lib/document-upload-client.ts`, `lib/document-uploads.ts`, `app/api/documents/upload/route.ts` | The agreement uses `contract-document`, as today. Exhibits get **one new purpose**, `subcontract-review-source`: a one-line addition to the purpose table, with the same size limit and type checks. |
| Citation check | `quoteIsInDocument`, `whyNot`, `normaliseForQuoteMatch`, `MIN_QUOTE_LENGTH`. It only maps typographic characters to ASCII; there is no fuzzy matching. | `lib/specs/quoteMatch.ts` (+ test) | Imported as it is. **This is the first time it runs at runtime rather than only in an eval.** A finding whose quote fails it is dropped, and the drop is counted. |
| Reading pattern | Forced tool call; every field required; the reply narrowed rather than cast; `PROMPT_VERSION`; `reportUsage(onUsage, …)`; `new Anthropic(AI_CLIENT_OPTIONS)` | `packages/integrations/src/specs.ts`, `addenda.ts`, `anthropic.ts` | A new `packages/integrations/src/subcontractReview.ts` in exactly that shape. `BidSpecFindingKind`'s LIQUIDATED_DAMAGES / WORKING_HOURS / WAGE_REQUIREMENT are **not** imported: those are spec findings and live in their own enum, guarded by `specFindingKindCensus.test.ts`. The new categories follow the same pattern: a single const list, with its type and the tool-schema enum both derived from it. |
| Action pattern | `readSpecSection`: permission → `documentUrlProblem` → `aiGate` → lease claim → fetch the blob → claim pages → extract → mark failure / write the reading → `revalidatePath` | `lib/actions/specRead.ts` | Copied step for step. |
| Decisions that survive a re-read | `BidAddendumItemDecision`: unique on (parent, normalised key) and upserted, so a re-read does not wipe a decision | `bid-addenda.prisma`, `lib/actions/addendumRead.ts` | Same shape: a decision is keyed on a finding's stable key and is never stored on the reading. |
| Feature switch | `enum AiFeature`, `CompanyAiSettings.disabledFeatures`, `aiGate(companyId, feature)` (fails closed and returns the model), `AI_FEATURES` / `FEATURE_MODEL` / `modelFor` | `ai-settings.prisma`, `lib/ai/settings.ts`, `lib/ai/features.ts`, `packages/integrations/src/models.ts` | New member `SUBCONTRACT_REVIEW`. The settings form iterates `AI_FEATURE_KEYS`, so the toggle shows up without any form change. Six censuses (`aiFeatureEnumParity`, `aiFeatureGateCensus`, `aiSurfaceCensus`, `promptVersionCensus`, `pricingCensus`, `askFeatureLabelCensus`) say where else it must be wired. |
| Metering | `recordAskUsage` with outcome `"proposal"`; `AskAllowancePeriod` claims pages before the call and records failures without refunding them | `lib/ask/usage.ts`, `ask-allowance.prisma`, `lib/ask/specSpend.ts` | A new `contractSpend.ts` modelled on `specSpend.ts`; see §6 for the allowance decision. |
| Per-page text | `openPlanPdf(bytes)` → `pageText(n)` with positioned items, plus `hasTextLayer(page)` | `lib/plan-ingest/planPdf.ts` | **Imported, read-only.** It already has callers outside plan-ingest (`lib/actions/planSheets.ts`, takeoff). Turning items into lines happens in my own module. See risk R1. |
| Long runs inside 60 s | The open page calls `advancePlanIngest` in a loop, one claimed slice at a time | `lib/actions/planIngest.ts` (read only, for the pattern) | The same idea on my own rows: the review page calls `advanceSubcontractReview` once per chunk. No plan-ingest code is reused or changed. |
| Won bid | `BidInvitation.wonJobId` **and** `status === "WON"` (the schema warns that the link alone does not mean the bid was won); `bidTotals(base, lines)` → `awardedTotal` | `estimating.prisma`, `lib/bid-lines.ts:87` | Read through Prisma plus `bidTotals`. None of `lib/estimating/**` is touched. |
| Our side of the deal | `JobProposalClause` (INCLUSION / EXCLUSION / CLARIFICATION / ALTERNATE); `BidLine` (ALTERNATE with `accepted`, ALLOWANCE, UNIT_PRICE); `BidAddendum.acknowledgedOn`; `normaliseReference` | `proposals.prisma`, `bid-lines.prisma`, `bid-compliance.prisma`, `lib/addenda-overlap.ts` | Read only. |
| Retainage | `Contact.defaultRetainagePercent`, `Job.retainagePercent` | `company.prisma:480`, `jobs.prisma:47` | Read only, for the comparison. |
| Job value | Σ quantity × unitPrice over live `JobLineItem` (ARCHITECTURE.md) | `jobs.prisma` | Read only. JobLineItem behaviour is not changed. |
| Print / PDF | Print-styled HTML, `<PrintButton>`, `print:hidden`, then the browser's Save as PDF ("this monorepo has no PDF library and this did not add one") | `app/(app)/jobs/[id]/proposal/page.tsx`, `pay-applications/[invoiceId]/page.tsx`, `components/PrintButton.tsx` | The summary and the rider use the same approach. |
| E-sign | `DocuSignPanel subject="CONTRACT_DOCUMENT"`, `sendWithDocuSign`; every send is started by a person | `components/DocuSignPanel.tsx`, `lib/actions/docusign.ts` | Phase 3: once the rider is attached it is an ordinary ContractDocument version, so the existing panel sends it unchanged. |
| Alerts | Derived and never stored: `AlertKind`, `ALERT_CAPABILITY`, a pure `xxxAlerts()` builder, a push in `loadAlerts`, `PageAlerts` on a job page | `lib/alerts.ts`, `lib/alerts-query.ts`, `components/alertLabels.ts` | Phase 3. These are **Lane 3 files**, so the work is announced first (see §8). |
| Insurance | `CompanyInsurancePolicy.policyType` (GL / WC / AUTO / UMBRELLA_EXCESS); `ComplianceDocument` COI | `compliance.prisma` | Phase 3 checklist rows use the same coverage vocabulary so the COI work can match them later. No broker workflow. |

---

## 2. How the reading works (and why it does not send the whole PDF like the other readers)

The spec, addendum and quote readers send the whole PDF to the model and accept the page label the model reports. A subcontract cannot work that way, for three reasons:

1. **Citations have to be checked at runtime, not only in an eval.** The hard rule is that a finding without a valid citation is dropped. That needs the exact text the model saw, which a whole-PDF call never gives us.
2. **Page numbers must not come from the model.** We locate each quote ourselves: `quoteIsInDocument` against each page's lines, then against each pair of adjacent pages so a quote crossing a page break is found. **The page is computed by code.** If the model claims a page that disagrees, the claim is ignored. The section reference (e.g. "§4.3") is kept only if that string appears on the page we computed.
3. **Chunking.** A 60–120 page contract plus exhibits will not fit a 60 s function in one call.

The pipeline:

```
for each source PDF (agreement + exhibits):
  openPlanPdf → per page: hasTextLayer?
     yes → lines (y-sorted, joined)          → stored per page
     no  → listed as UNREAD ("scanned page, no text layer")
chunks = consecutive text pages, ≤ ~8 pages / ~30k chars, 1-page overlap
advanceSubcontractReview (one chunk per call, page-driven loop, lease-claimed):
  model gets "=== <source role> · page N ===" blocks + the category list
  forced tool record_subcontract_findings → narrowed
  each finding: verbatim check → page located by code → else DROPPED (counted)
  any number the model reports (LD $/day, notice hours, retainage %, limits)
     must appear as digits inside its own quote → else the number is nulled, finding kept
dedupe across chunk overlap by stable key
```

**Scanned pages: listed as unread in Phase 1, not run through OCR.** The existing OCR (`readSheetTextTile`, `SHEET_TEXT`) reads lettering off a tile of a drawing. It is not a prose transcriber. Its transcription is also exactly what the citation check would be measured against, which makes the check circular. So every unread page is named on the review ("Exhibit C, pages 3–5: scanned, not read"), and the summary repeats it. Making scans readable is a decision for later.

**Stable key** = `category` + a hash of the normalised quote. It does three jobs:

- carries a decision over to a re-run on the same version;
- removes duplicates from overlapping chunks;
- drives the version diff.

---

## 3. Data model (new file `packages/db/prisma/schema/subcontract-review.prisma`, all additive)

```prisma
enum SubcontractReviewSourceRole { AGREEMENT  SCOPE_EXHIBIT  INSURANCE_EXHIBIT  GENERAL_CONDITIONS  DRAWINGS_LIST  OTHER_EXHIBIT }
enum SubcontractFindingCategory  { PAYMENT  RETAINAGE  BILLING  LIQUIDATED_DAMAGES  INDEMNITY  DELAY_AND_SCHEDULE
                                   NOTICE  TERMINATION  BACKCHARGE  WARRANTY  INSURANCE  BONDING  LIEN_WAIVER
                                   FLOW_DOWN  DISPUTE  SAFETY_SITE_ADMIN  SCOPE  OTHER }
enum SubcontractFindingSeverity  { HIGH  MEDIUM  LOW }
enum SubcontractFindingDecisionKind { ACCEPTED  DISMISSED  NEGOTIATED }

/// One run against one ContractDocument version. Append-only: a re-run is a new row.
model SubcontractReview {
  id, companyId, jobId (→ Job, RESTRICT), contractDocumentId (→ ContractDocument, CASCADE)
  model String, promptVersion String, startedByUserId String?
  startedAt, completedAt DateTime?, failedAt DateTime?, failureReason String?
  chunkInFlightAt DateTime?        // lease, the readInFlightAt shape
  pagesCharged Int @default(0), pagesRead Int @default(0)
  findingsDropped Int @default(0)  // failed the citation check: shown, never hidden
  sources SubcontractReviewSource[]  findings SubcontractFinding[]
}

/// A file read in a review: the agreement (its ContractDocument's file) or an exhibit.
model SubcontractReviewSource {
  id, reviewId (CASCADE), role SubcontractReviewSourceRole, fileUrl, fileName
  pageCount Int, pageText Json      // string[][] lines per page; null entry = unread
  unreadPages Int[]                 // derivable from pageText, kept as a column for the query
  chunksDone Int @default(0), chunksTotal Int
}

/// What the model found, after validation. Immutable once written.
model SubcontractFinding {
  id, reviewId (CASCADE), sourceId, key String   // category + quote hash
  category, subtype String?        // e.g. PAY_IF_PAID, BROAD_FORM, DUTY_TO_DEFEND
  severity, title, quote, pageStart Int, pageEnd Int, sectionRef String?
  explanation, suggestedPosition, questionForGc String?
  terms Json?                      // validated figures: { ldPerDay, noticeHours, retainagePct, … }
  @@unique([reviewId, key])
}

/// The person's call on a finding, keyed on JOB + key so it carries across re-runs
/// AND across contract versions when the clause is unchanged.
model SubcontractFindingDecision {
  id, companyId, jobId, key, decision SubcontractFindingDecisionKind
  note String?, editedSeverity?, editedExplanation String?, editedPosition String?
  decidedByUserId, decidedAt
  @@unique([jobId, key])
}
```

Notes on the model:

- **"Open" is not stored.** It means "no decision row", which is derived. "What changed since the last version" is also never stored: a pure `diffReviews(prev, next)` returns NEW / REMOVED / CHANGED / UNCHANGED.
- **CHANGED** means same category and subtype, but a different quote. That is how "retainage went from 5% to 10%" gets reported as one change rather than a removal plus an addition.
- **Storing `pageText` is a deliberate choice.** It is the evidence the citations were checked against, and it is what lets a diff or a re-check run without a second fetch and parse. It is the contract's own text, held in our database beside the file we already hold. If you would rather not store it, the alternative is re-parsing the blob on every view.
- **Cleanup scripts.** `SubcontractReview` and `SubcontractFindingDecision` are RESTRICT children of `Job`, so they go into `HANDLED_MODELS` and into both cleanup scripts' `del()` order. That is the #224/#227 scar. `scratch-cleanup-order.test.ts` will fail until it is done.
- **New feature enum member.** `ALTER TYPE "AiFeature" ADD VALUE 'SUBCONTRACT_REVIEW'`, in its own migration.
- **Phase 3 models** go in the same file in a later migration: `SubcontractRider`, `SubcontractObligation`, `SubcontractInsuranceRequirement`. They are not created in Phase 1.

---

## 4. Scope check (Phase 2)

**The lookup.** `bid = bidInvitation.findFirst({ companyId, wonJobId: jobId, status: "WON" })`, including its `lines` and `addenda`; the job's `proposalClauses`; and the GC `Contact`. If there is no won bid, the scope check says so in one sentence and the clause review still works.

**Split by who owns the arithmetic** (ARCHITECTURE: the model narrates, code computes):

| Check | Model's job | Code's job |
| --- | --- | --- |
| Contract sum vs bid | Quote the contract-sum clause; report the figure | Verify the digits are in the quote. Compare against `bidTotals().awardedTotal` (base + accepted alternates) and against Σ live JobLineItem. Show all three. Mention undecided alternates (`accepted = null`) by name rather than guessing at them. |
| Retainage | Quote the retainage clause; report the % | Compare with `Job.retainagePercent` and `Contact.defaultRetainagePercent`. |
| Addenda the contract lists | Quote each addendum reference in the contract | `normaliseReference`, then match against `BidAddendum`. Flag a listed addendum that is missing or has `acknowledgedOn = null`. Flag one we acknowledged that the contract omits. |
| Scope we excluded or never priced | Given our EXCLUSION / CLARIFICATION clause texts, quote contract language that puts that work on us, citing the clause id | Verify the quote and that the clause id exists. |
| Our exclusions the contract does not carry | Given each EXCLUSION / CLARIFICATION, say "carried" with a quote, or "not found" | A "not found" finding has **no contract quote**, so its citation is **our own clause, verbatim**, plus "searched pages 1–N of the readable text; M pages unread". **This is the one deliberate stretch of "every finding cites quoted text", and it needs your OK.** Absence cannot be quoted. |

**The one-page summary is pure code over findings and decisions.** It contains:

- top risks: HIGH first, dismissed findings excluded;
- money terms;
- notice windows and deadlines;
- insurance asks;
- scope gaps;
- the `questionForGc` of every open or NEGOTIATED finding;
- unread pages;
- the disclaimer.

No second model call goes into the summary, so nothing new can be invented there. The printable version is `/jobs/[id]/subcontract-review/[reviewId]/summary`, styled like the proposal page.

---

## 5. UI placement

- **The review lives at `apps/web/app/(app)/jobs/[id]/subcontract-review/page.tsx`.** It sits outside `(tabs)`, like `/proposal`, so `jobTabs.ts` is not touched. It shows:
  - a version picker over this job's ContractDocuments;
  - exhibit upload;
  - a **Run review** button, which drives the chunk loop and shows progress ("page 14 of 62");
  - findings grouped by category, HIGH first. Each finding shows a severity word and colour (never colour alone), the quote set in a quote block, the page and section, the explanation and the position, with Accept / Dismiss / Negotiated / Edit note and a two-step undo;
  - a "Changed since version N" band when a previous version has been reviewed;
  - the dropped-findings count and the unread-pages list, both shown, never hidden;
  - the disclaimer.
- **Entry point:** in the Overview tab's existing "Subcontract agreement" section (`(tabs)/page.tsx`), a **Review before signing** link on each version row. That is a surgical, one-line edit inside the section; it adds no new section and does not touch the Retainage → Field Reports → Pay Apps slots.
- **Disclaimer, written once:** `SUBCONTRACT_REVIEW_DISCLAIMER = "This is not legal advice. Have an attorney review high-risk terms."` in `lib/subcontract-review/disclaimer.ts`, rendered by one `<NotLegalAdvice/>` component on the review, the summary print and the rider print. A census test asserts that each of those three pages renders the component and that the sentence appears exactly once in source.
- **Capability:** viewing and running need `VIEW_JOB_COSTS`, the same as uploading a contract today, plus `aiGate`. Deciding on a finding needs `VIEW_JOB_COSTS`. Both go in `ROUTE_CAPABILITY` (`lib/permissions.ts`, shared, edited surgically).
- **Not in the nav.** It is a job sub-page, so `navItems.tsx` is not touched.

---

## 6. Gate, model and metering

- `SUBCONTRACT_REVIEW` in `AiFeature`, `AI_FEATURES` (`"subcontract-review"`), `AskUsageFeature`, `AI_FEATURE_LABEL` / `DESCRIPTION`, and the pricing census.
- **Default model is Opus.** Same argument as `QUOTE_EXTRACT`: low volume, and a misread costs real money. `ANTHROPIC_MODEL_SUBCONTRACT_REVIEW` and the company override work as for every other feature.
- One `recordAskUsage` per chunk, outcome `"proposal"`, with `jobId` set.
- **Allowance needs your call.**
  - Option A: reuse the shared document allowance (`claimDocumentPages`, 300 pages a month). One 100-page contract package would use a third of a month's quotes and COIs.
  - Option B (**recommended**): a sixth unit, `AskAllowancePeriod.contractPagesUsed` / `failedContractPages` plus `CompanyAiSettings.contractPagesPerMonth` (default 600, not editable by the company, same reasoning as `specPagesPerMonth`). It is additive: three columns with defaults.
  - Under either option, only pages with text are charged, and pages are claimed before each chunk.
- **Prompt rules** (from the spec reader's playbook):
  - quote or drop;
  - severity HIGH only when the clause shifts money or liability onto the sub;
  - empty is a valid answer;
  - never judge what our bid priced, because the scope check does that;
  - every figure must appear in its own quote.

---

## 7. Evals and tests

- **Eval set: synthetic, rendered at runtime** with `quotePdf(lines)` (imported, as `specFixtures.ts` does), with the foot marking `Ref: ZZ SYNTHETIC`. No binaries and no real contracts are committed. Cases:
  1. **Planted:** pay-if-paid; $1,500/day LDs passed through from the owner; broad-form indemnity with a duty to defend; a 48-hour delay-notice window; an AI + P&NC + WoS insurance exhibit; 10% retainage, released at final completion; a scope item our fixture bid EXCLUDES.
  2. **A clean, sub-friendly agreement.** It must produce no HIGH findings; this is the precision control.
  3. **A clause split across a page break**, to test the computed page range.
  4. **A scanned page**, which must be listed as unread and never cited.
  5. **Version 2 of case 1** with retainage changed to 5% and the LDs removed, which must come back as CHANGED and REMOVED.
  6. **Plain-language sample text that I write myself**, in the style of A401 / ConsensusDocs 750 but **not copied from them.** AIA and ConsensusDocs documents are copyrighted even where samples are viewable. Paraphrased structure is fine; verbatim text is not.
- **Scoring:**
  - recall over planted clauses;
  - precision: a finding with no planted counterpart on the clean case is an INVENTED finding and fails the run;
  - **citation validity must be 100%**: `whyNot() === null` on every returned quote, measured before the runtime drop, so the eval sees what the model actually did;
  - the count of returned verdicts is asserted equal to the number of cases (the "dead agent counted as refuted" scar).
- **Wiring:** `lib/subcontract-review/subcontractReview.eval.ts`, plus `eval:subcontract-review` scripts in both package.json files and the eval census entry. **Slack says the Anthropic credit balance was empty on 10-14**, so the paid eval may not run until it is topped up. If it cannot run, I will say so rather than report a number.
- **Real contracts** come only from env paths (`REAL_SUBCONTRACT_PDF`), with output under `$TMPDIR` and metadata only printed, the same as `realPlan.eval.ts`. Nothing real is committed.
- **Unit tests (free, run on every push):**
  - page-text → lines;
  - chunk planner (overlap, page boundaries, unread pages excluded);
  - citation validator wrapper: page located by code, cross-page quotes, a number that is not in its quote gets nulled;
  - key stability;
  - `diffReviews`;
  - the scope-check comparisons (contract sum vs awarded total including undecided alternates, retainage, addenda matching, "not found" citing our clause);
  - the summary builder;
  - the disclaimer census;
  - a category census proving the const list and the Prisma enum agree, and that no second list exists.
- **db test:** decisions survive a re-run, and the cleanup order.
- **e2e (one new spec, `subcontract-review.spec.ts`, its own persona):** upload → run → accept / dismiss → summary print → rider draft.
  - CI forces `ANTHROPIC_API_KEY=""`, so the model step cannot run there. The spec will check the **refusal sentence with no key**, and then the review, decisions and summary against a review seeded through a dev-only fixture path. **Choosing that path is open:** a stubbed `@prova/integrations` reader behind `E2E_SUBCONTRACT_FIXTURE=1` read only when `NODE_ENV !== "production"`, or a seed in `seedDatabase.ts`. I lean towards the seed, because it adds no production code path.
  - While developing I run only this spec; I run the full suite once before asking to merge.
- **FEATURE-AUDIT.md:** a new Sheet 04 row ("AI subcontract review", Partial until Phase 3) and a Sheet 23 row, with the header counts updated so `plumbing.test.ts` agrees.

---

## 8. Files I expect to touch

**New:**

- `packages/db/prisma/schema/subcontract-review.prisma`, plus migrations `…_add_subcontract_review_ai_feature` and `…_add_subcontract_review` (later, `…_add_subcontract_review_actions`)
- `packages/integrations/src/subcontractReview.ts` (+ test)
- `apps/web/lib/subcontract-review/`: `pageText.ts`, `chunks.ts`, `citations.ts`, `categories.ts`, `keys.ts`, `diff.ts`, `scopeCheck.ts`, `summary.ts`, `disclaimer.ts`, fixtures, the eval and tests; Phase 3 adds `rider.ts`, `obligations.ts`
- `apps/web/lib/ask/contractSpend.ts`
- `apps/web/lib/actions/subcontractReview.ts`
- `apps/web/app/(app)/jobs/[id]/subcontract-review/page.tsx`, `.../[reviewId]/summary/page.tsx`, and later `.../rider/page.tsx`
- `apps/web/components/SubcontractReview*.tsx`, `NotLegalAdvice.tsx`
- `apps/web/e2e/specs/subcontract-review.spec.ts`
- `changelog.d/claude-awesome-bell-s4g7b9.md`

**Edited surgically (shared):**

- `ai-settings.prisma` (enum member, plus a column under option B), `ask-allowance.prisma` (option B)
- `jobs.prisma` / `billing.prisma` / `company.prisma`: back-relation lines only
- `packages/integrations/src/models.ts`, its barrel, `pricing.ts` if the census asks
- `apps/web/lib/ai/features.ts`, `lib/ask/usage.ts` (feature union)
- `lib/document-uploads.ts` (one purpose)
- `lib/permissions.ts` (ROUTE_CAPABILITY), `lib/actions/index.ts` (barrel)
- `app/(app)/jobs/[id]/(tabs)/page.tsx`: one link inside "Subcontract agreement"
- `packages/db/scripts/scratch-scope.mjs`, `clean-scratch-data.mjs`, `seed-demo.mjs`
- `e2e/lib/personas.ts`, possibly `e2e/lib/seedDatabase.ts`
- `FEATURE-AUDIT.md` (Sheets 04 and 23; Sheet 14 gets a pointer in Phase 3)
- `apps/web/package.json`, root `package.json`: eval script lines

**Phase 3 only, Lane 3 (alerts), and announced in Slack before touching:** `lib/alerts.ts`, `lib/alerts-query.ts`, `components/alertLabels.ts`.

**Confirmed NOT touched:**

- `apps/web/lib/takeoff/**`, `lib/plan-ingest/**` (`planPdf.ts` is imported, not edited), `lib/estimating/**`
- `wall-types`, `takeoff.prisma`, `plan-ingest.prisma`, `wall-types.prisma`
- JobLineItem behaviour, the `/takeoff` routes
- `jobTabs.ts`, `navItems.tsx`, `CHANGELOG.md`

---

## 9. Phase 3 shape, in brief, so the Phase 1 schema does not paint it into a corner

- **Rider.** A deterministic template assembles our EXCLUSIONs and CLARIFICATIONs plus every NEGOTIATED finding's position into an editable draft (`SubcontractRider`: a body as an ordered list of sections, the source finding keys, DRAFT / ATTACHED). The print page gives the browser PDF.
  - "Attach as a new ContractDocument version" needs a **file in Blob**, so the server renders it with `pdf-lib`. `pdf-lib` is already a dependency, though only used inside `lib/estimating` today; my module would import the package, not their code. The server then calls `issueContractDocumentVersion` in a transaction.
  - Sending is the existing DocuSign panel on that version. The person always presses send.
  - **Open question:** attaching makes the rider the job's newest "version", and versions read as "the agreement or amendments". If you would rather keep riders out of the version list, the alternative is a flag on `ContractDocument`, which is a schema change to a Diego-lane table.
- **Obligations → alerts.**
  - A confirmed NOTICE finding becomes a `SubcontractObligation` (window in hours or days, the trigger described, the recipient, the form). A 48-hour notice is a *rule*, not a date, so it surfaces as a **STANDING** alert on the job ("Delay notice: 48 h, written, to the PM") rather than a fake due date.
  - Dated items (a billing cutoff on the 25th, insurance certificates due before mobilisation) become DUE_SOON / OVERDUE through a pure `subcontractObligationAlerts()`.
  - Event-triggered deadlines ("a delay happened, so notice is due in 48 h") need an event source, and none exists. That is out of scope and named as such.
- **Insurance asks.** On confirm, a `SubcontractInsuranceRequirement` row is written: coverage in the `InsurancePolicyType` vocabulary plus OTHER with a label, the limits verified in the quote, endorsements as an enum array (ADDITIONAL_INSURED / PRIMARY_NONCONTRIBUTORY / WAIVER_OF_SUBROGATION), completed-ops years, and the finding key. Rows are only written when a person confirms. Nothing reads them yet.

---

## 10. Risks

- **R1. Coupling to `planPdf.ts`,** which the other session owns. If they change `pageText`'s shape my import breaks at typecheck, which is loud, not silent. The fallback is a 30-line pdfjs wrapper of my own. That would be a second, narrow copy, so I would rather import, and I would tell that session I depend on `openPlanPdf` / `hasTextLayer`.
- **R2. A chunk may not finish within 60 s on Opus with 8k output tokens.** Mitigations: chunks of about 8 pages, a per-call deadline below `maxDuration` that marks the chunk failed rather than dying silently (the #793 lesson), and retry from the page. I will measure the real chunk duration in the eval before fixing the chunk size.
- **R3. pdf.js line assembly on two-column contracts** can interleave the columns. Then quotes fail the verbatim check and get *dropped*, which is safe but can hide clauses. The dropped count is shown for exactly this reason. Two-column layouts are on the eval list.
- **R4. The legal-advice boundary.** Suggested positions are framed as "commonly negotiated: …", never as "you must". The disclaimer appears on every surface. Severity is the model's reading, and the person can edit it.
- **R5. Migration timestamps.** The other session has pushed `20261016210000`, `20261016230000` and `20261017000000` on `diego/takeoff-audit`, which is not yet on main. I will rebase onto main right before generating, choose a timestamp after every migration on any open branch I can see, re-check before pushing, and announce in `#prova-build` before the push (rule 4).
- **R6. Empty Anthropic credit balance** (10-14). The paid eval and any preview click-through of the model step are blocked until it is topped up.
- **R7. e2e cannot exercise the model** (the key is forced empty). The model path is proved by the eval and the free unit tests; e2e proves the UI, the decisions and the exports.

---

## 11. Decisions I need from you before Phase 1

1. Allowance: **B, a new contract-page unit** (recommended), or A, the shared document pages?
2. Storing `pageText` on the source row: OK?
3. "Not found" scope findings citing **our own clause** rather than the contract (§4): OK?
4. Scanned pages listed as unread in v1 rather than OCR'd: OK?
5. e2e fixture: a seed in `seedDatabase.ts` (recommended), or a dev-only stub flag?
6. (Phase 3, can wait) Rider as a normal ContractDocument version, or kept out of the version list?

---

## Status: Phase 1 built (2026-10-17)

Decisions §11 1–5 were taken as recommended. #6 is open until Phase 3.

**Built:** clause extraction, the review screen, decisions, and the version diff.

**Changed from the design while building it:**

- **Page breaks.** A clause crossing a page break failed the citation check whenever a footer sat between its halves, which is every real contract. The cross-page search now sets aside running headers and footers: only the first or last two lines of a page, only a page-number line or a line that repeats at another page's edge, and only at the boundary being joined (`citations.ts`, tested both ways).
- **Category list moved to a dependency-free file.** It now lives in `packages/integrations/src/subcontractCategories.ts`, so the review page's client components do not pull the Anthropic SDK into the browser bundle.
- **Warranty figures.** `warrantyYears` and `warrantyMonths` are separate figures, because "two (2) years" must never become a 24 the quote does not contain.

**Proved, and how:**

- Unit tests: pageText, chunks, citations, findings, run, censuses. Each gate was checked by deliberately breaking it and watching the tests fail.
- `subcontractReview.dbtest.ts`, against real Postgres 16 with a fake reader that always reports the wrong page and invents one quote per chunk. It covers:
  - page located by code;
  - the invented quote dropped and counted;
  - a 10-page contract charged 10 pages, not 11;
  - a decision surviving a re-run;
  - the v1 → v2 diff;
  - the allowance stop;
  - a failed chunk marked on the ledger, then resumed.
- e2e spec `subcontract-review.spec.ts`, run against a seeded review. It has not run locally because Clerk is unreachable from an agent container; CI's `e2e` job is its first run.

**Not proved:**

- The paid eval has never run: there was no `ANTHROPIC_API_KEY` in the container.
- Chunk duration on Opus against the 50-second deadline is unmeasured. That is the eval's `chunk time` line.
- No human has clicked the page.

---

## Status: Phase 2 built (2026-10-17)

**Built:**

- **Section B, the scope check.** `lib/subcontract-review/scopeCheck.ts`, pure and derived on read.
- **Section C, the one-page summary.** `summary.ts`, printed from `/jobs/[id]/subcontract-review/[reviewId]/summary`.

**Changed from §4 while building it:**

- **One model call per chunk, not two.** The scope comparison rides in the same call as the clause review (prompt `.2`), with the job's clauses as refs `C1…` and its priced lines alongside. A second pass would have charged every page twice.
  - The comparisons land in `SubcontractScopeCheck`, one additive table. The clause each check compared against is snapshotted.
  - A ref the model was not given, or a quote not on the page, is dropped and counted.
- **"Not carried" is derived, never returned by the model.** It is an EXCLUSION or CLARIFICATION with no CARRIES check across the whole contract, and only once every chunk has been read. A half-read contract has only not carried it *yet*.
  - A clause the contract *contradicts* is listed once, as the contradiction, never also as "not carried". The seed probe caught it listed twice.
- **Addendum numbers are read by code** from the ADDENDA_LIST finding's quote (`addendaList.ts`), dates removed first, so the model never supplies one.
- **"Never priced" is a prompt to check, not a gap** (`NOT_IN_OUR_PRICED_SCOPE`, LOW). It is shown on the review and left off the printed summary, because the model has not seen the estimate and must not appear to judge it.

**Proved:**

- Unit tests for `scopeCheck`, `addendaList`, `ourSide`, `summary` and the scope-check gate. Three rules were deliberately broken, and each break failed the tests.
- The db test, extended:
  - the contradiction stored with its clause snapshotted;
  - the invented `C99` ref dropped;
  - the not-carried gap derived and decidable;
  - a forged key refused.
- The e2e spec gained steps 5 and 6: the scope section, and the summary page.

**Not proved:** the paid eval has never run. It now also fails on a clause read as carried that is not, and reports whether the planted contradiction is found.
