# Feature Audit

Every line from the union-specialty-trade-subcontractor feature spec, checked
against what actually exists in the repo — model by model, action by action.

Originally audited 25 Aug 2026. Updated 25 Aug 2026 (same day) to reflect the
GC relationship management, estimating/bidding, and contracts/subcontract-doc
work shipped later that day — the original audit predated all three. Also
corrected a tally bug in the original audit: Sheet 10's header undercounted
"Built" by one item (percent-complete was marked Built in the row but not
counted in the header) — fixed here so every section header matches its own
rows. Updated again 26 Aug 2026 to reflect AIA-style pay applications
(Sheet 10) shipped that day. This file is meant to stay in sync with reality
going forward: update it in the same PR as any work that changes a status,
and check it against [`ONBOARDING.md`](./ONBOARDING.md) section 7 (they
should always tell the same story — section 7 is the prose version, this is
the itemized one).

Sheets 17, 19, 20 and 22 are known stale as of this update — vendors,
equipment, punch lists, and daily field reports have all shipped on `main`
since these were last written, plus a safety incident/toolbox talk feature
in flight. Left as-is here rather than guessed at from the outside; the next
update to touch those sheets should come from whoever actually verified them
against a fresh clone.

**119 items audited — 93 built / 19 partial / 6 missing / 1 descoped**

(Recounted from the rows on merging `main` into this branch, which is the
only thing that settles it — the fourth time this exact conflict shape has
hit this file. Both sides were internally correct and neither number
survived the other's: this branch had 117 / 90 / 19 / 7 / 1 against ITS
rows, `main` had 119 / 90 / 21 / 7 / 1 against ITS. Against the shared
merge base of 117 / 87 / 21 / 8 / 1, this branch moved Sheets 18 and 20 to
fully Built (+3 built, -2 partial, -1 missing) and `main` moved Sheet 15's
cash flow forecast Missing -> Built, added two rows and a Partial to
Sheet 26. Both apply: 87+3+3 = 93 built, 21-2 = 19 partial, 8-1-1 = 6
missing, 1 descoped, and 93 + 19 + 6 + 1 = 119.

Count only rows beneath a `## NN.` sheet header — a naive grep for
`^| Built |` also matches this summary table's own four rows and
overcounts by exactly four, which `main` has done twice. All 26 per-sheet
headers agree with their own rows, 0 mismatches; that is the stronger
check, because a total can hide two errors that cancel and a per-sheet
header cannot.)

| Status | Count |
| --- | --- |
| Built | 93 |
| Partial | 19 |
| Missing | 6 |
| Descoped | 1 |


## 01. Company / Org Setup — 6 built · 0 partial · 0 missing

| Status | Feature | Note |
| --- | --- | --- |
| Built | Company profile with registered legal entity per state (multi-state licensing) | `CompanyLicense` + `LicenseClassificationReference`, seeded for CA/AZ/UT |
| Built | Trade-scope tags per company (multi-select, not single trade) | `CompanyTradeScope` join table, one row per held scope |
| Built | Union affiliation records: CBA(s) by state/local | `UnionLocal`, `CraftClassification`, `CompanyUnionAgreement`, `FringeRateSchedule`, `ApprenticeRatioRule` — with create/edit on `/union-compliance` since 2 Sep. **It was marked Built on the models alone from 24 Aug until then, during which not one of those five rows could be created through the app** — the same defect this sheet already records against the licence row, found the same way: by writing the click-list and discovering the first step was impossible |
| Built | Company's own insurance and bonding records (COI, bond capacity) | `CompanyInsurancePolicy`, `CompanyBond` — UI on `/settings` |
| Built | Multi-location/multi-office support (CA/NV/AZ/CO/UT) | `CompanyLocation`, free-text state — any state works, not just the five listed |
| Built | Self-service export of every company record (data portability) | `lib/export.ts` + `/settings/export` + `/api/export` — 18 tables as CSV each, or all of them as one JSON, owner-only, with row counts shown before download. Column lists are an **allowlist**, so a newly added credential column is absent rather than leaked; `export.test.ts` reads the .prisma files and fails if any field matching a credential pattern reaches a column list. Verified in a browser on 2 Sep: files downloaded, and all six credential field names return zero matches in the JSON. Does NOT cover formatted report exports — the WIP-schedule and AIA-format rows in sheet 15 and sheet 10 are separate and still stand |

## 02. Customer (GC) Relationship Mgmt — 7 built · 0 partial · 0 missing

*Updated from the original audit (was 0 built / 1 partial / 2 missing) — GC
contract terms, bid invitations, and payment reliability shipped same-day.
Updated again 2 Sep 2026: the directory row below was marked Built on the
`Contact` model alone since 25 Aug, during which there was no way to add a
GC before a job existed with them, and no way to remove one entered by
mistake — the exact "looks built, isn't" shape this sheet has caught
against a license row and a union-compliance row already. `createContact`/
`deleteContact` close that; prospect status and account
type/MSA/prequalification are new fields shipped in the same pass. Updated
again 3 Sep 2026: the interaction log shipped, closing the "we have no
record of the relationship, only the paperwork" gap. Updated again 3 Sep
2026 (same day): individual people at an account (`ContactPerson`) shipped,
closing "we track the GC but not who to actually call."*

| Status | Feature | Note |
| --- | --- | --- |
| Built | GC/customer directory (contact info, project history, payment history/reliability) | `Contact` has name/email/phone/address, jobs linked, plus `lib/gc-reliability.ts` computing on-time rate and average days-to-pay from invoice/payment history. `createContact`/`deleteContact` (2 Sep) let a GC be entered before any job exists and removed again if it never goes anywhere — deletion refuses once a job, bid invitation, or logged interaction is on record |
| Built | Per-GC contract terms (retainage %, payment terms, standard forms used) | `Contact.defaultRetainagePercent`, `.paymentTermsDays`, `.standardFormsUsed` |
| Built | Bid invitation tracking (which GCs invite this company to bid, on what) | `BidInvitation` model — trade scope, status, due dates, linked to a `Contact` |
| Built | Bid pipeline per GC (who invites us, what we do with it, whether it becomes work) | `/pipeline`, `lib/bid-pipeline.ts` (derivation + 11 unit tests), `lib/bid-pipeline-query.ts` (assembly + 7 db tests). READ-ONLY over `BidInvitation`, which the estimating lane owns — a status is still changed on `/bids`. Win rate counts decided bids only and is UNCOMPUTED rather than 0% when nothing has been decided; a won-value total that skipped unpriced bids says so on the row |
| Built | Prospect status, account type, and MSA/prequalification tracking | `Contact.status` (PROSPECT/ACTIVE/INACTIVE, backfilled to ACTIVE — every existing row already has a job); `Contact.accountType` (GC/developer/vendor/subcontractor, nullable, no backfill); `.msaExpirationDate`/`.prequalificationExpiresAt`, both nullable with status derived via `lib/compliance-expiry.ts`'s existing renewal ranking, not a second copy of the day-counting |
| Built | Interaction log per contact (calls, emails, site visits, notes, optional follow-up) | `ContactInteraction` (`crm.prisma`) — dated, entered not stamped; follow-up date and follow-up owner are separate from who logged the entry. Not an evidence record (no counter, no locked fields): any team member can log/edit/delete one, same access as bid invitations. A due/overdue follow-up now surfaces in `/alerts` too — see Sheet 26 |
| Built | Individual people at an account (name, title, email/phone, who to actually call) | `ContactPerson` (`crm.prisma`), nested under `Contact`. No stored "last contact" — derived at read time from `ContactInteraction.contactPersonId` (optional, `SET NULL` on delete so removing a person never blocks on their call history). `deleteContact`'s guard extended again to count people as account history |

## 03. Estimating & Bidding — 10 built · 0 partial · 0 missing

*Updated from the original audit (was 2 built / 1 partial / 5 missing) — the
catalog, bid tracking, historical bid database, labor hours, and estimate
versioning all shipped same-day.*

| Status | Feature | Note |
| --- | --- | --- |
| Built | Trade-scope line-item catalogs, reusable per estimate | `LineItemCatalogEntry` — save any line item to the catalog, add from catalog into a new estimate |
| Built | Bid tracking: invited, submitted, won/lost, due dates | `BidInvitation.status` lifecycle + `tradeScope`/`bidAmount` |
| Built | Historical bid database, by project type/GC/trade | `BidInvitation` rows persist regardless of outcome — filterable by trade/status on `/bids` |
| Built | Material takeoff quantities per line item (manual entry v1) | `JobLineItem.quantity` / `.unit` — entered directly or via AI draft |
| Built | Labor hour estimates per line item, by craft classification | `JobLineItem.laborHours` + `.craftClassificationId` |
| Built | Union fringe/burden rate tables applied to labor cost estimates | `lib/estimate-labor-cost.ts` reuses the same `findEffectiveFringeRateSchedule`/`calculateTimeEntryLaborCost` the actuals use, at straight time, priced at the job's planned start date. Read-only hint beside the hours field — never written into `budgetedUnitCost`, and shows nothing rather than a wrong number when no schedule is effective |
| Built | Bulk import of a price list into the catalog | Paste from a spreadsheet or upload a CSV; headers matched loosely so an existing price list needs no renaming. Preview shows what will be added, what is already in the catalog, and every row it couldn't read, before anything is written. Existing entries are never overwritten or duplicated |
| Built | Catalog defaults learn from what jobs actually cost | `JobLineItem.sourceCatalogEntryId` records which template a line came from; `/catalog` reports actual unit cost against the default across every line created from it, flags variance past 15% on 2+ costed lines, and offers a one-click update. Template only — never touches a `JobLineItem`, snapshot or invoice that already exists |
| Built | Estimate versioning as scope changes pre-award | `EstimateVersion` — manual JSON snapshot checkpoint, not automatic |
| Built | Estimate-to-contract conversion (winning bid becomes the SOV) | `markJobContracted` — the same line items become the contract, by design |

## 04. Contracts & Subcontract Documents — 2 built · 1 partial · 0 missing

*Updated from the original audit (was 0 built / 1 partial / 2 missing) —
subcontract agreement storage and versioning shipped same-day.*

| Status | Feature | Note |
| --- | --- | --- |
| Built | Subcontract agreement storage per job (the GC-to-sub contract) | `ContractDocument` — the actual uploaded file, distinct from the JSON snapshot at signing |
| Partial | E-signature on subcontract agreements, change orders, lien waivers | `SignatureRequest` covers the initial contract only, once, at award — not change orders or lien waivers |
| Built | Contract document versioning/amendments | `ContractDocument.versionNumber`, auto-incrementing per job, with an uploader/note per version |

## 05. Job / Project Structure — 2 built · 2 partial · 0 missing

| Status | Feature | Note |
| --- | --- | --- |
| Built | Job = subcontract awarded by a GC (not owner-direct) | the `Contact` on a `Job` functions as the GC in this ICP |
| Partial | Job metadata: GC, project name/address, contract value, dates, jurisdiction | name/dates/derived contract value/location all present; no distinct project address or "substantial completion" date |
| Built | Schedule of values (SOV) as the job's line-item structure | this is exactly what `JobLineItem` is, by design |
| Partial | Job status lifecycle: bid → awarded → active → substantially complete → closed/warranty | today's `JobStatus` is a simpler 4-stage version: ESTIMATE → CONTRACTED → IN_PROGRESS → COMPLETE |

## 06. Job Costing & Cost Coding — 3 built · 2 partial · 0 missing

| Status | Feature | Note |
| --- | --- | --- |
| Built | `budgetedUnitCost` and `currentEstimatedUnitCost` on `JobLineItem` | frozen baseline vs. live PM forecast, exactly as specified |
| Built | `estimatedCostToComplete` (derivable, PM-overridable) | mechanical by default, overridable per line — see `lib/wip.ts` |
| Built | Line-item FK on `CostEntry` so cost rolls up to a specific SOV line | `CostEntry.lineItemId` |
| Partial | Cost categorization: labor, material, equipment, sub/other, by trade tag | `CostCategory` has LABOR/MATERIAL/SUBCONTRACTOR/OTHER plus a `tradeScope` tag — no distinct EQUIPMENT bucket |
| Partial | Job cost roll-up dashboard: budget vs. actual vs. forecast, per line item and per job | built per-job on `/jobs/[id]`; no cross-job/company-wide roll-up view |

## 07. Labor & Time Tracking — 5 built · 0 partial · 1 missing

*Updated — field time entry, craft classification per hour, pay-type
tracking, per diem/travel pay, and dispatch slips shipped 26 Aug 2026.*

| Status | Feature | Note |
| --- | --- | --- |
| Built | Field time entry by employee, job, cost code/SOV line, date | `TimeEntry` — logged per job, optionally tied to a `JobLineItem` |
| Built | Craft classification per hour entered | `TimeEntry.craftClassificationId`, optional, same pattern as `JobLineItem` |
| Built | Straight/overtime/double-time/shift differential tracking | `TimeEntry.payType` — tracks hours by category; does not compute dollar wages (needs a rate-rule engine, still missing) |
| Built | Per diem / travel pay tracking | `TimeEntry.perDiemAmount` / `.travelPayAmount` — flat daily allowances on the same row |
| Built | Union hiring-hall dispatch slip tracking | `DispatchSlip` — hall referral onto a job, optional scanned slip via Vercel Blob |
| Missing | Mobile/field time entry app | the whole app is a single responsive Next.js site — no dedicated field app; deliberately deferred as a separate, larger effort (see `ARCHITECTURE.md`) |

## 08. Certified Payroll & Prevailing Wage — 3 built · 1 partial · 1 missing

*Updated — certified payroll report generation, fringe rate labor
costing, and prevailing wage attachment shipped 26 Aug 2026.*

| Status | Feature | Note |
| --- | --- | --- |
| Built | Certified payroll report generation (federal WH-347 + state equivalents) | `lib/certified-payroll.ts` + `/jobs/[id]/certified-payroll` — a certified-payroll-style summary (hours/craft/wages by employee), not a pixel-exact WH-347/state-formatted export |
| Built | Prevailing wage determination lookup/attachment per job/jurisdiction | `PrevailingWageDetermination` — attached storage (file or link), not a lookup; no licensed prevailing-wage dataset exists to query automatically |
| Built | Fringe benefit rate application per craft/local to labor costs | `lib/labor-cost.ts` — burdened wage cost per `TimeEntry` from the effective `FringeRateSchedule`; never guesses a rate when none applies |
| Missing | Multi-state prevailing wage rule variation support | not built as a rules engine — no real government wage-rate dataset to vary across states with; a job is already jurisdiction-scoped via `operatingLocationId` |
| Partial | Certified payroll document storage/history per job, per pay period | `ComplianceDocument.type = CERTIFIED_PAYROLL` stores/tracks a submission, with AI extraction; not structured strictly by pay period |

## 09. Union Fringe & Apprenticeship Compliance — 4 built · 0 partial · 0 missing

*Updated 1 Sep 2026 — the remittance generator and the daily ratio check
shipped. Both were blocked on there being no time-entry data; `TimeEntry`
landed, and `CraftClassification.tier` supplied the other missing half.*

| Status | Feature | Note |
| --- | --- | --- |
| Built | Union fringe/benefit remittance report generation (pension, vacation, H&W, training) | `lib/fringe-remittance.ts`, on `/union-compliance`, with the setup CRUD that feeds it added 2 Sep — before that the report was correct and unreachable, because nothing in the app could create a local, a classification or a rate. — a month's logged hours rolled up per local, per classification, with the four funds broken out separately because that is how the form is filled in and how the cheques are written. Uses the rate in force on each entry's own date through `findEffectiveFringeRateSchedule`, not a second copy of that lookup. Fringe is paid at the flat per-hour rate regardless of pay type (Davis-Bacon), so overtime does not inflate it. Hours it cannot price — no craft tag, or no schedule effective that day — are counted and named, never valued at $0: under-reporting a trust fund is the expensive direction to be wrong in. Whether the month was filed is derived from a `UNION_FRINGE_BENEFIT_FILING` document covering the WHOLE period |
| Built | Apprentice-to-journeyman ratio tracking per crew/job | `lib/apprentice-ratio.ts` — per job, per union local, **per day**, because that is how the rule is enforced and a monthly average would hide the exact day an inspector asks about. Measured in hours (what `TimeEntry` holds). Hours on a craft with no tier are NEVER counted as journeyman hours: the day reads "can't be judged", so a half-configured company never gets a clean bill of health. Also raises the Sheet 26 alert that was blocked on this existing |
| Built | Apprenticeship program enrollment/hours tracking | `apprenticeship.prisma` (`ApprenticeshipEnrollment`, `ApprenticeshipPeriodRecord`), `lib/apprenticeship.ts`, `lib/apprenticeship-query.ts`, on `/union-compliance` with create/edit/remove for both. The registration side the ratio work could not derive: sponsor, programme number, indenture date, classroom hours, and the sign-off that closes a period. **On-the-job hours are still never stored** — they are summed from `TimeEntry` over the window from the last sign-off to today, so a corrected timesheet moves them. Classroom hours ARE stored, because related instruction happens at a training centre and there is no `TimeEntry` to sum. A period closes on a SIGNATURE, never on an hour count: the sponsor decides, and recording our arithmetic as their decision would invent a fact about someone else's programme. Nothing defaults the hour requirements — blank reads as "not looked up" and is reported unchecked rather than measured against the conventional 2000 |
| Built | Multi-CBA support (a company may run crews under more than one agreement) | `CompanyUnionAgreement` is a list per company, not a single field |

## 10. Billing — AIA-Style Pay Applications — 5 built · 0 partial · 0 missing

*Updated — G703 continuation sheet, materials-stored tracking, G702
generation, and payment status all shipped 26 Aug 2026.*

| Status | Feature | Note |
| --- | --- | --- |
| Built | G703 continuation sheet generation from `JobLineItem` | `lib/pay-application.ts` + `/jobs/[id]/pay-applications/[invoiceId]` — a G703-style continuation sheet (scheduled value, previous, this period, materials stored, total to date, %, balance to finish), not a pixel-exact AIA-formatted export |
| Built | Percent-complete per line item feeding "work completed this period" | `lib/wip.ts` — cost-to-cost method, live |
| Built | Materials stored (not yet installed) tracking, separate from work-in-place | `InvoiceLineItem.materialsStoredValue`, its own column on the continuation sheet, not folded into work-in-place |
| Built | Monthly pay application (G702) generation and submission tracking | `submitPayApplication` — an alternate, line-item-driven invoice creation path alongside the existing lump-sum `createInvoice`; the same report page renders the G702 summary block (contract sum to date, retainage, current payment due, balance to finish) |
| Built | Payment status per pay app: submitted, approved, partially paid, paid, disputed | `Invoice.status` (`InvoiceStatus`) — a plain field set directly, not inferred from payment totals, since "approved"/"disputed" have no dollar signal to derive from |

## 11. Retainage — 3 built · 0 partial · 0 missing

*Updated — retainage rate, withheld/released tracking, and release
forecasting shipped 26 Aug 2026.*

| Status | Feature | Note |
| --- | --- | --- |
| Built | Retainage % per job/contract | `Job.retainagePercent`, usually pre-filled from `Contact.defaultRetainagePercent` |
| Built | Retainage withheld vs. released tracking | `Invoice.retainageWithheld` (snapshotted per invoice) and `RetainageRelease` (lump-sum payback); `lib/retainage.ts` computes the outstanding balance |
| Built | Retainage release forecasting tied to substantial completion/closeout | `Job.substantialCompletionDate` plus a computed "expected release around this date" statement — a plain forecast, not a scheduling/notification system; closeout itself still isn't modeled as a `JobStatus` stage (see Sheet 22) |

## 12. Change Orders — 4 built · 0 partial · 0 missing

| Status | Feature | Note |
| --- | --- | --- |
| Built | Change order requests/PCOs as a distinct pre-approval state | `ChangeOrderStatus` (DRAFT → SUBMITTED → APPROVED/REJECTED, plus VOID). A pending CO's content lives in `ChangeOrderProposal` and never touches `JobLineItem`, so contract value, WIP, retainage and pay applications only ever count scope the GC has agreed to |
| Built | Correcting an approved change order | `reopenChangeOrder` unwinds it back to draft while its scope is untouched; once costed or billed, `reviseChangeOrder` raises a linked revision and the original stays approved |
| Built | Change order approval workflow with the GC | `submitChangeOrder` / `approveChangeOrder` / `rejectChangeOrder` / `voidChangeOrder` in `lib/actions/changeOrders.ts`. Sent and decided dates are entered rather than stamped, so a backdated PCO records real turnaround. A rejected CO keeps its proposals as evidence it was priced and refused |
| Built | Approved COs flow into new/modified `JobLineItem` rows and update contract value | `approveChangeOrder` applies every proposal in one transaction and writes the `ChangeOrderLineItemEdit` audit rows; `appliedAt` stops the same CO reaching the budget twice |

## 13. Backcharges & Deductions — 2 built · 0 partial · 0 missing

*Updated — backcharge tracking and the dispute/resolution lifecycle shipped
1 Sep 2026.*

| Status | Feature | Note |
| --- | --- | --- |
| Built | GC-issued backcharge tracking against a job (damages, cleanup, etc.) | `Backcharge` + `BackchargeCounter`, `/backcharges` — numbers issued per job and never reissued, eight categories so "what do cleanup backcharges cost us a year" is answerable, issue/receipt/respond-by dates all ENTERED not stamped. The claimed amount locks the moment we answer, so a savings figure can't be computed against a number nobody claimed |
| Built | Backcharge disputes/resolution status | `BackchargeStatus` RECEIVED → DISPUTED → ACCEPTED / SETTLED / WITHDRAWN, with the objection's own date and grounds. Only a settlement stores a figure: accepting concedes the claim and a withdrawal concedes nothing, both derived from the status in `lib/backcharges.ts`. Past the deadline to object is derived per render, never stored. Deliberately does NOT net against a pay application — see the note on the page and in ARCHITECTURE.md |

## 14. Compliance Document Management — 5 built · 1 partial · 0 missing

| Status | Feature | Note |
| --- | --- | --- |
| Built | Certificates of insurance (issued to GCs, received from lower-tier subs) | `ComplianceDocument.type = CERTIFICATE_OF_INSURANCE`, plus `CompanyInsurancePolicy` for the company's own coverage |
| Partial | Lien waivers (conditional/unconditional, progress/final) per pay period | `LIEN_WAIVER` type exists generically — no conditional/unconditional or progress/final sub-typing |
| Built | Certified payroll submissions | type exists, now with AI extraction on upload |
| Built | Union fringe/benefit filings | `UNION_FRINGE_BENEFIT_FILING` type |
| Built | License/registration records per state | `CompanyLicense`, with create/edit/delete on `/settings` — it was marked Built on the model alone from 25 Aug until 29 Aug, during which no licence could be created at all |
| Built | Expiration/renewal alerts across all of the above | `lib/compliance-expiry.ts` ranks COIs, licences, policies and bonds together; surfaced on `/compliance` in full and on the dashboard as the worst three. Still computed at read time, never stored — delivery (email/SMS) is Sheet 26 |

## 15. WIP & Financial Reporting — 4 built · 1 partial · 1 missing

*Updated 3 Sep 2026: the Cash flow forecast row below was still marked
Missing while `lib/cash-flow.ts`'s `calculateCashFlowForecast` had already
shipped and was already rendering on `/cash-flow` — this file had simply
drifted behind the code. Found while auditing the nav for NAV-IA-AUDIT.md,
which was looking for exactly this kind of stale entry on Diego's
instruction to check before assuming anything needed building.*

| Status | Feature | Note |
| --- | --- | --- |
| Built | Percent-complete (cost-to-cost method) per line item and per job | `lib/wip.ts` |
| Built | Revenue earned vs. billed (over/under-billing) report | plus an AI narrative layer over it — `generateWipNarrative` |
| Missing | WIP schedule export in surety/CPA-expected format | shown on-screen only, no export |
| Partial | Job profitability report (budget vs. actual vs. forecast margin) | visible per job on `/jobs/[id]`, and every active job's forecast-vs-contract variance now reads as a sentence in the dashboard's Job health section — still no dedicated exportable report |
| Built | Cash flow forecast (AR aging, retainage receivable, pay app cycles) | `lib/cash-flow.ts`'s `calculateCashFlowForecast`, rendered on `/cash-flow` under "Forecast, next N months" — AR aging plus retainage expected by month, reading the retainage data from Sheet 11. Was marked Missing here until this update; the code and the nav entry were both already live |
| Built | Company-wide backlog report across active jobs | `lib/company-financials.ts` sums contract value, blended gross margin, cash collected and retainage held across contracted and in-progress jobs; shown on the metric bar at the bottom of every screen. Derived on read, never stored |

## 16. Submittals, RFIs, Drawings — 3 built · 0 partial · 0 missing

*Updated 3 Sep 2026: all three rows stay Built — none of this code changed
or was removed. What changed is nav-only: `/submittals`, `/rfis` and
`/drawings` were removed from the sidebar and mobile drawer (still live,
still reachable by direct link) on the reasoning in `NAV-IA-AUDIT.md` at
the repo root — a specialty sub receives RFIs and submits submittals TO a
GC rather than running either workflow itself, and a full drawings module
duplicates ground Procore/Fieldwire/Bluebeam already own. This was
proposed against an assumption that these three were unbuilt "coming
soon" placeholders; they were not, which the audit doc verifies and this
file's own Built rows already showed before this update touched anything.*

| Status | Feature | Note |
| --- | --- | --- |
| Built | Shop drawing/submittal tracking and GC approval status | `Submittal` + `SubmittalRevision` + `SubmittalCounter`, `/submittals` — numbers issued per job and never reissued, per-revision sent/due/returned dates, outcome (approved / approved-as-noted / revise-and-resubmit / rejected), current-revision state derived, never stored. Removed from nav 3 Sep 2026 — see `NAV-IA-AUDIT.md` |
| Built | RFI log per job | `Rfi` + `RfiCounter`, `/rfis` — number issued per job and never reissued, sent/due/answered dates, overdue derived, cost/schedule impact flags. Removed from nav 3 Sep 2026 — see `NAV-IA-AUDIT.md` |
| Built | Current drawing set storage/versioning per job | `DrawingSet` + `DrawingRevision`, `/drawings` — one set per discipline per job, issues recorded under the ARCHITECT'S label (no counter: we don't issue these numbers), issued/received dates entered not stamped, current revision and "issued but never received" both derived per render. The set itself is linked, not uploaded — a Server Action body caps around 1MB and real sets are far larger. Removed from nav 3 Sep 2026 — see `NAV-IA-AUDIT.md` |

## 17. Safety & Field Operations — 3 built · 0 partial · 0 missing

*Updated 3 Sep 2026: `/safety` stays Built and unchanged — it's now
rendered `disabled` ("coming soon") in the nav rather than removed, since
a sub does have real safety obligations, unlike the GC-side workflows cut
elsewhere in this pass. Reasoning in `NAV-IA-AUDIT.md`.*

| Status | Feature | Note |
| --- | --- | --- |
| Built | Incident/injury tracking, OSHA 300 log | `SafetyIncident` + `SafetyCaseCounter`, `/safety` — case numbers per company per year, recordable derived from outcome. Nav entry disabled 3 Sep 2026 — see `NAV-IA-AUDIT.md` |
| Built | Toolbox talk / safety meeting logs | `ToolboxTalk`, `/safety` |
| Built | Daily field reports (crew present, work performed, weather, delays) | `DailyFieldReport`, one per job per day enforced by the database. Filed from the job page or from `/field-reports`, which groups every job's reports into Mon–Sun weeks, derives coverage and NAMES the finished weekdays nothing was filed for (never today, never a day still to come, never a weekend), and writes the week out as plain text to hand a GC — missing days included in that text rather than omitted |

## 18. Scheduling & Crew Dispatch — 3 built · 0 partial · 0 missing

| Status | Feature | Note |
| --- | --- | --- |
| Built | Crew assignment across concurrent jobs | `JobAssignment` — assign/unassign a user to a job |
| Built | Multi-job scheduling view (which crews are where, by trade) | `/deployment` — crew-first, one row per person naming every active job they're on and flagging anyone split across more than one, plus the inverse by-job view with crew and equipment together. `/schedule` still answers when jobs run; this answers where everybody is |
| Built | Equipment/scaffolding/lift allocation per job | `EquipmentAssignment` — which piece went to which job, when it left and when it came back, both dates entered not stamped. Shown per job on `/deployment`, with a separate list of gear still recorded as out on a job that isn't running |

## 19. Materials & Vendor Management — 3 built · 0 partial · 0 missing

*Updated 3 Sep 2026: `/material-orders` stays Built and unchanged — it's
now rendered `disabled` ("coming soon") in the nav rather than removed,
same reasoning as `/safety` above. Reasoning in `NAV-IA-AUDIT.md`.*

| Status | Feature | Note |
| --- | --- | --- |
| Built | Vendor/supplier directory per trade | `Vendor`, `/vendors` |
| Built | Material order tracking and delivery status per job | `MaterialOrder` + `MaterialOrderDelivery` + `MaterialOrderCounter`, `/material-orders` — numbers issued per job and never reissued, ordered/promised/delivered dates all entered, partial deliveries as their own rows, late and delivery state derived and never stored. Carries no quantity or unit price by design: that would be a second copy of line-item data (see ARCHITECTURE.md), and material cost already lives on `CostEntry`. Nav entry disabled 3 Sep 2026 — see `NAV-IA-AUDIT.md` |
| Built | Vendor pricing history for estimating | `VendorPriceQuote`, `/vendors/pricing` — what a supplier quoted, on a date entered not stamped, with the source (written quote / invoice / price list / verbal) recorded because the four are not equally trustworthy. Current, expired, stale, cheapest and every movement figure are derived per read, never stored. Compared only WITHIN a unit: MSF is never converted to SF, since the factor is the vendor's to state. Carries no job and no line item by design — a quote is reference data for pricing, and job cost has one home, `CostEntry`. Warns when a `LineItemCatalogEntry` default sits under the cheapest live quote in the same unit, and changes nothing |

## 20. Equipment & Tool Tracking — 2 built · 0 partial · 0 missing

| Status | Feature | Note |
| --- | --- | --- |
| Built | Company-owned equipment inventory (scaffolding, lifts, mixers) | `Equipment`, `/equipment` |
| Built | Equipment assignment/utilization per job | `EquipmentAssignment` history — current location and utilisation both derived per read, never stored, so `Equipment.assignedJobId` is no longer consulted by anything. Utilisation is measured over a 90-day window clamped to when the record was created (we have no acquisition date), reads null rather than 0% when that window is empty, and counts distinct days so contradictory records can't push it past 100%. Overlapping stays are refused on write and surfaced on `/deployment`. Pushing equipment cost INTO job costing is deliberately not built — that is job costing's lane |

## 21. Multi-State / Multi-Jurisdiction Support — 2 built · 1 partial · 0 missing

*Updated 1 Sep 2026 — prevailing wage RULE SETS shipped. Still no wage-rate
dataset, and there is not going to be one until a licensed source exists;
what shipped is the half that never needed one.*

| Status | Feature | Note |
| --- | --- | --- |
| Built | State-specific prevailing wage rule sets | `PrevailingWageRuleSet`, `/prevailing-wage` — per jurisdiction, effective-dated, with non-overlap enforced by a Postgres exclusion constraint (raw SQL, same as `FringeRateSchedule`; the action catches the untyped P2010 and says it in words). Records daily/weekly/seventh-day overtime and double-time thresholds, filing frequency, due days, form and portal. **Nothing is seeded and nothing is defaulted**: a blank threshold means nobody looked it up, and `lib/prevailing-wage.ts` reports that week as *unchecked* rather than assuming eight — zero is a distinct, meaningful value (premium from the first hour). Applied to real logged hours per employee per week, reporting where the ENTERED pay types and the recorded rules disagree; it never rewrites a `TimeEntry`. Also feeds the certified-payroll alert its jurisdiction's real filing window, replacing a hardcoded 7 days, and the alert says which of the two it used |
| Built | State-specific licensing requirement tracking | `CompanyLicense` + `LicenseClassificationReference` (CA/AZ/UT seeded; NV deliberately left unseeded — no verified source) |
| Partial | Jurisdictional/union-local mapping by project location | the data exists — `Job.operatingLocationId`, `CompanyLocation.state`, `UnionLocal` — but nothing derives one from another yet; flagged as future work in the code itself |

## 22. Closeout & Warranty — 4 built · 0 partial · 0 missing

*Updated 1 Sep 2026 — the closeout package's trip to the GC, and readiness
derived across everything that holds it up, shipped that day. The three
rows below were already Built and are unchanged. Updated again 3 Sep
2026: all four rows stay Built — `/closeout` was removed from the nav
(GC-side workflow, see `NAV-IA-AUDIT.md`), but `/punch-lists` is a
separate route and was not touched, so punch list tracking is still fully
nav-reachable.*

| Status | Feature | Note |
| --- | --- | --- |
| Built | Closeout package submission to the GC, and readiness across what blocks it | `CloseoutSubmission` + `CloseoutSubmissionCounter`, on `/closeout` — attempts numbered per job and never reissued, sent/answered dates entered not stamped, a rejection required to record what was missing. `lib/closeout-readiness.ts` derives whose move it is (not ready / ready to submit / with the GC / sent back / accepted) from the checklist, OPEN PUNCH ITEMS, open callbacks and the latest attempt, and names the retainage each one is holding up via `lib/retainage.ts`. An open punch item blocks closeout whether or not anyone ticked "punch list sign-off" — the checklist is an assertion, the punch rows are what contradict it. `/closeout` removed from nav 3 Sep 2026 — see `NAV-IA-AUDIT.md` |
| Built | Punch list tracking per job | `PunchListItem`, `/punch-lists` — unaffected by the `/closeout` nav removal; still a normal, fully nav-reachable item |
| Built | Final lien waiver and closeout document checklist | `CloseoutItem`, `/closeout` — per-job checklist with a standard set one click away, required vs optional, completion dates entered not stamped, document links. Closeout completeness derived from required items only, never stored; a job with no checklist is deliberately NOT complete. `/closeout` removed from nav 3 Sep 2026 — see `NAV-IA-AUDIT.md` |
| Built | Warranty period tracking and post-completion service requests | `WarrantyPeriod` + `WarrantyServiceRequest`, `/closeout` — start entered separately from `Job.substantialCompletionDate` (the warranty and retainage clocks aren't always the same date), length in months as the contract states it, expiry derived with end-of-month clamping so 31 Aug + 6 months is 28 Feb not 3 Mar. Whether a callback was in warranty is derived from its REPORTED date, so a slow fix can't move the cost. `JobStatus` deliberately untouched — a stored lifecycle stage can disagree with the dates under it. `/closeout` removed from nav 3 Sep 2026 — see `NAV-IA-AUDIT.md` |

## 23. AI Features — 3 built · 1 partial · 1 missing · 1 descoped

| Status | Feature | Note |
| --- | --- | --- |
| Built | WIP over/under-billing variance detection (read-only, per line item/job) | `generateWipNarrative` |
| Partial | Compliance document extraction into structured records with expiration alerts | extraction shipped (`extractComplianceDocument`) — the alerting half doesn't exist yet (see Sheet 26) |
| Built | Draft estimate line items from text, grounded by trade-scope catalogs | `draftEstimateLineItems` now receives this company's `LineItemCatalogEntry` rows and its won `BidInvitation` amounts as reference data, and prefers matching an existing catalog price over inventing one. A matched line is created through the same path as "add from catalog", carrying `sourceCatalogEntryId` and the entry's cost/craft defaults — not just an echoed number |
| Built | Confidence signal on AI-suggested prices | `JobLineItem.priceBasis` distinguishes a matched catalog price from one informed by past bids from a bare general-knowledge guess, each with its own badge. A returned `catalogEntryId` is verified against the entries actually sent before it becomes a foreign key, and a `COMPANY_CATALOG` claim with no verified entry behind it degrades to `GENERAL_KNOWLEDGE` rather than overstating confidence |
| Missing | Plan/drawing takeoff via computer vision | explicitly deferred as a later, larger effort — different modality, different accuracy bar |
| Descoped | Client-facing chatbot | GCs are the customer here, not homeowners — deliberately out of scope for this ICP |

## 24. Integrations — 3 built · 2 partial · 2 missing

| Status | Feature | Note |
| --- | --- | --- |
| Built | Integration framework (the shelf, not the things on it) | `IntegrationConnection` + append-only `IntegrationSyncLog`, a provider registry, an owner-only Settings → Integrations page, encrypted-at-rest credential columns (`lib/crypto.ts`, AES-256-GCM), and a generic inbound webhook route. Proven end to end against a scratch Postgres: 45 migrations applied clean, connect/disconnect verified by row rather than by return value, webhook exercised across all six branches. NO REAL PROVIDER SHIPPED WITH IT — the only thing it connects is a mock called Sandbox, which talks to nothing. QuickBooks predates this and still runs on its own tables |
| Partial | Accounting: QuickBooks, and likely Sage 300 CRE / Foundation | QuickBooks is connected, mapped and syncing one direction — invoices push, the record is read back to confirm what landed, and reconciliation reports where the two disagree. Verified end to end against a sandbox company (#31, #33, #34, #36). Deliberately NOT two-way: Prova does not pull QuickBooks edits back, and does not pretend to. Sage/Foundation not started |
| Missing | Payroll processor integration (for running actual pay) | not started |
| Missing | DocuSign, Procore, myCOI | 0 built. Each has a registry entry so the page can render it, and each renders DISABLED with a "Coming soon" label. A card on a settings page is not an integration |
| Partial | E-signature provider | homegrown token-based e-sign (`SignatureRequest`) covers contract signing only — not a general provider for every doc type |
| Built | Anthropic API (for the AI features above) | three shipped features now call Claude |
| Built | Outbound email from the contractor's own domain, with a delivery log | `OutboundMessage` + `OutboundMessageEvent`, `/messages` — provider-agnostic send, signed delivery webhook that fails closed, events deduplicated by provider id, status derived from the newest event and never stored. Sends as the contractor, not as us: mail from a vendor domain is the deliverability complaint the research report found at every competitor. SMS is in the channel enum and not wired |

## 25. Roles & Permissions — 1 built · 1 partial · 0 missing

*Updated 1 Sep 2026 — job functions shipped. `UserRole` is deliberately
unchanged: it still has two values and still answers only "can this person
administer the account", so every `assertOwner()` in `lib/actions/*` keeps
meaning exactly what it meant.*

| Status | Feature | Note |
| --- | --- | --- |
| Built | Distinct roles: estimator, PM, foreman/field, payroll/compliance admin, owner/exec, accounting | `JobFunction` — a second, orthogonal column to `UserRole` — plus `lib/permissions.ts` mapping each to a capability set, set by the owner on `/team`. NULL is a real value meaning "nobody has said", and grants exactly the access every MEMBER has always had, so no existing row loses anything. An OWNER holds every capability regardless, because an owner locked out by a dropdown has nobody to undo it. Enforced server-side by `requireCapability()` on the page; the nav filter is cosmetic and says so in its own comment |
| Partial | Field-only mobile access vs. office full access | the FIELD tier is enforced everywhere the app shows money. Whole pages refuse it (`/cash-flow`, `/catalog`, `/bids`, `/vendors/pricing`, `/backcharges`, `/compliance`, `/settings`); the company metric bar is withheld from every screen; alerts are filtered by the capability their subject needs and stripped of figures they may not see; `/closeout` hides retainage; and `/jobs/[id]`, `/dashboard` and `/contacts/[id]` now withhold the contract summary, job costing & WIP, invoices, retainage, change orders, estimate line items, receivables, job health and per-job contract value. The dashboard withholds the receivables ROWS, not just the list, since the provider is a client component. **Still Partial for one honest reason: there is no mobile SURFACE.** It is the same responsive site, narrowed — the audit row asks for field-only *mobile* access, and an offline-capable field app with camera capture is a separate build, not a permission |

## 26. Notifications & Alerts — 1 built · 6 partial · 0 missing

*Updated 1 Sep 2026 — the alert engine shipped, and then a sender was
wired to it. Every row below can now be EMAILED, once per thing per stage,
with a ledger that makes a second run silent. They still are not Built, and
the reason is now a narrow one worth stating exactly: **nothing runs
without a person clicking.** The digest goes out from a button on /alerts,
so it reaches somebody who opens the app — which is the same reach the list
already had. The bar this sheet set ("NOT Built until something pushes it")
is met by the sending path and not by the trigger. A scheduled run is the
whole remaining gap, and it is one job away. Updated again 3 Sep 2026: a
seventh row, contact follow-up reminders (CRM lane, Sheet 02) — the same
generic dispatch layer picked it up with no changes of its own, since it
reads only `Alert.severity`/`.key` and knows nothing about individual
kinds.*

| Status | Feature | Note |
| --- | --- | --- |
| Built | In-app alert delivery: one ranked list, acknowledgement, and a count in the chrome | `lib/alerts.ts` (derivation and ranking), `lib/alerts-query.ts` (assembly), `AlertAcknowledgement` (the ONLY stored part — a person deciding they have seen one), `/alerts`, and a bell with a live count in the top bar on every screen. Alerts are never stored: each is derived from the record it is about on every render, so fixing the thing removes it. An alert's key carries the fact that would change it (`RENEWAL:lic_1:2026-11-30`), so a dismissal lapses by itself when the situation moves — no expiry logic. Per-user, not per-company: dismissing on a colleague's behalf is the worse of the two failures. **Not push on its own** — it reaches whoever opens the app. `NotificationDispatch` + `notification-milestones.ts` + `notification-dispatch.ts` add the sending half: one email per person covering what they have not been told, keyed on the alert key PLUS a rung so an unchanged fact goes quiet while a tightening one speaks again. Claimed before the provider call, so a crash cannot resend; a failed send does not retry itself, deliberately |
| Partial | COI/license/bond expiration alerts | now an alert with an identity, a severity comparable against everything else, and a place reachable from every page — through `lib/compliance-expiry.ts`'s existing ranking, not a second expiry rule. Now emailable: a licence fires at its own 60-day horizon, a COI at 30, because the rung reads `severity` rather than a horizon table of the notifier's own — see `notification-milestones.ts`, where getting that wrong dropped the 60-day warning silently. Still nothing that runs unattended |
| Partial | Certified payroll submission deadline reminders | derived: a job carrying a `PrevailingWageDetermination`, a finished week with `TimeEntry` rows, and no `CERTIFIED_PAYROLL` document whose period covers that whole week. Gated on the determination on purpose — certified payroll isn't required on private work, and a job where nobody recorded one raises nothing rather than a guess. Now emailable. Still nothing that runs unattended |
| Partial | Retainage release eligibility alerts | derived from `lib/retainage.ts`'s balance plus the closeout package's state. An ACCEPTED package is an event and reads as collectable; `Job.substantialCompletionDate` is a FORECAST and reads as "worth confirming", never as money owed. Now emailable. Still nothing that runs unattended |
| Partial | Apprentice ratio out-of-compliance alerts | no longer blocked — `lib/apprentice-ratio.ts` finds the days a job ran over, and the alert engine raises them (STANDING, not dated: the day is past and cannot be fixed by acting sooner; what can change is tomorrow's crew). Keyed on the offending dates, so a dismissal lapses the moment another day breaches. Now emailable — as a STANDING notice, which fires once per key rather than climbing a ladder of deadlines it does not have. Still nothing that runs unattended |
| Partial | WIP variance alerts | jobs forecast past contract value now appear in the one alert list alongside everything else, through `jobIsOverBudget` rather than a second threshold, and can be acknowledged. Deliberately a STANDING severity with no date: it is true today and tomorrow, and escalating it with the calendar would invent urgency the data doesn't have — the digest respects that and sends it once per key, never on a ladder. Still nothing that runs unattended |
| Partial | Contact follow-up reminders | `ContactInteraction.followUpOn` (A2) now raises a `CONTACT_FOLLOW_UP` alert through the same engine, gated behind `MANAGE_ESTIMATING`, keyed on the follow-up date so rescheduling it lapses an old dismissal. Horizon fixed at 7 days — the floor `notification-milestones.ts` requires for any kind, not chosen for feel; a lower one would drop its own earlier warning silently, since the "week" rung fires at 7 days regardless of a kind's own horizon. Not scoped to the specific assignee — every other kind here is capability-gated only, and this stays consistent rather than becoming the first per-user-scoped one; the assignee is named in the alert text instead. Now emailable via the existing digest, no changes to the sending layer. Still nothing that runs unattended |
