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

**108 items audited — 76 built / 14 partial / 17 missing / 1 descoped**

| Status | Count |
| --- | --- |
| Built | 76 |
| Partial | 14 |
| Missing | 17 |
| Descoped | 1 |

## 01. Company / Org Setup — 5 built · 0 partial · 0 missing

| Status | Feature | Note |
| --- | --- | --- |
| Built | Company profile with registered legal entity per state (multi-state licensing) | `CompanyLicense` + `LicenseClassificationReference`, seeded for CA/AZ/UT |
| Built | Trade-scope tags per company (multi-select, not single trade) | `CompanyTradeScope` join table, one row per held scope |
| Built | Union affiliation records: CBA(s) by state/local | `UnionLocal`, `CraftClassification`, `CompanyUnionAgreement`, `FringeRateSchedule` |
| Built | Company's own insurance and bonding records (COI, bond capacity) | `CompanyInsurancePolicy`, `CompanyBond` — UI on `/settings` |
| Built | Multi-location/multi-office support (CA/NV/AZ/CO/UT) | `CompanyLocation`, free-text state — any state works, not just the five listed |

## 02. Customer (GC) Relationship Mgmt — 3 built · 0 partial · 0 missing

*Updated from the original audit (was 0 built / 1 partial / 2 missing) — GC
contract terms, bid invitations, and payment reliability shipped same-day.*

| Status | Feature | Note |
| --- | --- | --- |
| Built | GC/customer directory (contact info, project history, payment history/reliability) | `Contact` has name/email/phone/address, jobs linked, plus `lib/gc-reliability.ts` computing on-time rate and average days-to-pay from invoice/payment history |
| Built | Per-GC contract terms (retainage %, payment terms, standard forms used) | `Contact.defaultRetainagePercent`, `.paymentTermsDays`, `.standardFormsUsed` |
| Built | Bid invitation tracking (which GCs invite this company to bid, on what) | `BidInvitation` model — trade scope, status, due dates, linked to a `Contact` |

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

## 09. Union Fringe & Apprenticeship Compliance — 1 built · 0 partial · 3 missing

| Status | Feature | Note |
| --- | --- | --- |
| Missing | Union fringe/benefit remittance report generation (pension, vacation, H&W, training) | no generator built over `FringeRateSchedule` |
| Missing | Apprentice-to-journeyman ratio tracking per crew/job | not modeled |
| Missing | Apprenticeship program enrollment/hours tracking | not modeled |
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

## 13. Backcharges & Deductions — 0 built · 0 partial · 2 missing

| Status | Feature | Note |
| --- | --- | --- |
| Missing | GC-issued backcharge tracking against a job (damages, cleanup, etc.) | no concept of a backcharge anywhere |
| Missing | Backcharge disputes/resolution status | not modeled |

## 14. Compliance Document Management — 5 built · 1 partial · 0 missing

| Status | Feature | Note |
| --- | --- | --- |
| Built | Certificates of insurance (issued to GCs, received from lower-tier subs) | `ComplianceDocument.type = CERTIFICATE_OF_INSURANCE`, plus `CompanyInsurancePolicy` for the company's own coverage |
| Partial | Lien waivers (conditional/unconditional, progress/final) per pay period | `LIEN_WAIVER` type exists generically — no conditional/unconditional or progress/final sub-typing |
| Built | Certified payroll submissions | type exists, now with AI extraction on upload |
| Built | Union fringe/benefit filings | `UNION_FRINGE_BENEFIT_FILING` type |
| Built | License/registration records per state | `CompanyLicense`, with create/edit/delete on `/settings` — it was marked Built on the model alone from 25 Aug until 29 Aug, during which no licence could be created at all |
| Built | Expiration/renewal alerts across all of the above | `lib/compliance-expiry.ts` ranks COIs, licences, policies and bonds together; surfaced on `/compliance` in full and on the dashboard as the worst three. Still computed at read time, never stored — delivery (email/SMS) is Sheet 26 |

## 15. WIP & Financial Reporting — 3 built · 1 partial · 2 missing

| Status | Feature | Note |
| --- | --- | --- |
| Built | Percent-complete (cost-to-cost method) per line item and per job | `lib/wip.ts` |
| Built | Revenue earned vs. billed (over/under-billing) report | plus an AI narrative layer over it — `generateWipNarrative` |
| Missing | WIP schedule export in surety/CPA-expected format | shown on-screen only, no export |
| Partial | Job profitability report (budget vs. actual vs. forecast margin) | visible per job on `/jobs/[id]`, and every active job's forecast-vs-contract variance now reads as a sentence in the dashboard's Job health section — still no dedicated exportable report |
| Missing | Cash flow forecast (AR aging, retainage receivable, pay app cycles) | not built — the underlying retainage data exists now (Sheet 11), but no forecast report reads it yet |
| Built | Company-wide backlog report across active jobs | `lib/company-financials.ts` sums contract value, blended gross margin, cash collected and retainage held across contracted and in-progress jobs; shown on the metric bar at the bottom of every screen. Derived on read, never stored |

## 16. Submittals, RFIs, Drawings — 3 built · 0 partial · 0 missing

| Status | Feature | Note |
| --- | --- | --- |
| Built | Shop drawing/submittal tracking and GC approval status | `Submittal` + `SubmittalRevision` + `SubmittalCounter`, `/submittals` — numbers issued per job and never reissued, per-revision sent/due/returned dates, outcome (approved / approved-as-noted / revise-and-resubmit / rejected), current-revision state derived, never stored |
| Built | RFI log per job | `Rfi` + `RfiCounter`, `/rfis` — number issued per job and never reissued, sent/due/answered dates, overdue derived, cost/schedule impact flags |
| Built | Current drawing set storage/versioning per job | `DrawingSet` + `DrawingRevision`, `/drawings` — one set per discipline per job, issues recorded under the ARCHITECT'S label (no counter: we don't issue these numbers), issued/received dates entered not stamped, current revision and "issued but never received" both derived per render. The set itself is linked, not uploaded — a Server Action body caps around 1MB and real sets are far larger |

## 17. Safety & Field Operations — 3 built · 0 partial · 0 missing

| Status | Feature | Note |
| --- | --- | --- |
| Built | Incident/injury tracking, OSHA 300 log | `SafetyIncident` + `SafetyCaseCounter`, `/safety` — case numbers per company per year, recordable derived from outcome |
| Built | Toolbox talk / safety meeting logs | `ToolboxTalk`, `/safety` |
| Built | Daily field reports (crew present, work performed, weather, delays) | `DailyFieldReport`, one per job per day enforced by the database. Filed from the job page or from `/field-reports`, which groups every job's reports into Mon–Sun weeks, derives coverage and NAMES the finished weekdays nothing was filed for (never today, never a day still to come, never a weekend), and writes the week out as plain text to hand a GC — missing days included in that text rather than omitted |

## 18. Scheduling & Crew Dispatch — 3 built · 0 partial · 0 missing

| Status | Feature | Note |
| --- | --- | --- |
| Built | Crew assignment across concurrent jobs | `JobAssignment` — assign/unassign a user to a job |
| Built | Multi-job scheduling view (which crews are where, by trade) | `/deployment` — crew-first, one row per person naming every active job they're on and flagging anyone split across more than one, plus the inverse by-job view with crew and equipment together. `/schedule` still answers when jobs run; this answers where everybody is |
| Built | Equipment/scaffolding/lift allocation per job | `EquipmentAssignment` — which piece went to which job, when it left and when it came back, both dates entered not stamped. Shown per job on `/deployment`, with a separate list of gear still recorded as out on a job that isn't running |

## 19. Materials & Vendor Management — 3 built · 0 partial · 0 missing

| Status | Feature | Note |
| --- | --- | --- |
| Built | Vendor/supplier directory per trade | `Vendor`, `/vendors` |
| Built | Material order tracking and delivery status per job | `MaterialOrder` + `MaterialOrderDelivery` + `MaterialOrderCounter`, `/material-orders` — numbers issued per job and never reissued, ordered/promised/delivered dates all entered, partial deliveries as their own rows, late and delivery state derived and never stored. Carries no quantity or unit price by design: that would be a second copy of line-item data (see ARCHITECTURE.md), and material cost already lives on `CostEntry` |
| Built | Vendor pricing history for estimating | `VendorPriceQuote`, `/vendors/pricing` — what a supplier quoted, on a date entered not stamped, with the source (written quote / invoice / price list / verbal) recorded because the four are not equally trustworthy. Current, expired, stale, cheapest and every movement figure are derived per read, never stored. Compared only WITHIN a unit: MSF is never converted to SF, since the factor is the vendor's to state. Carries no job and no line item by design — a quote is reference data for pricing, and job cost has one home, `CostEntry`. Warns when a `LineItemCatalogEntry` default sits under the cheapest live quote in the same unit, and changes nothing |

## 20. Equipment & Tool Tracking — 2 built · 0 partial · 0 missing

| Status | Feature | Note |
| --- | --- | --- |
| Built | Company-owned equipment inventory (scaffolding, lifts, mixers) | `Equipment`, `/equipment` |
| Built | Equipment assignment/utilization per job | `EquipmentAssignment` history — current location and utilisation both derived per read, never stored, so `Equipment.assignedJobId` is no longer consulted by anything. Utilisation is measured over a 90-day window clamped to when the record was created (we have no acquisition date), reads null rather than 0% when that window is empty, and counts distinct days so contradictory records can't push it past 100%. Overlapping stays are refused on write and surfaced on `/deployment`. Pushing equipment cost INTO job costing is deliberately not built — that is job costing's lane |

## 21. Multi-State / Multi-Jurisdiction Support — 1 built · 1 partial · 1 missing

| Status | Feature | Note |
| --- | --- | --- |
| Missing | State-specific prevailing wage rule sets | not modeled |
| Built | State-specific licensing requirement tracking | `CompanyLicense` + `LicenseClassificationReference` (CA/AZ/UT seeded; NV deliberately left unseeded — no verified source) |
| Partial | Jurisdictional/union-local mapping by project location | the data exists — `Job.operatingLocationId`, `CompanyLocation.state`, `UnionLocal` — but nothing derives one from another yet; flagged as future work in the code itself |

## 22. Closeout & Warranty — 3 built · 0 partial · 0 missing

| Status | Feature | Note |
| --- | --- | --- |
| Built | Punch list tracking per job | `PunchListItem`, `/punch-lists` |
| Built | Final lien waiver and closeout document checklist | `CloseoutItem`, `/closeout` — per-job checklist with a standard set one click away, required vs optional, completion dates entered not stamped, document links. Closeout completeness derived from required items only, never stored; a job with no checklist is deliberately NOT complete |
| Built | Warranty period tracking and post-completion service requests | `WarrantyPeriod` + `WarrantyServiceRequest`, `/closeout` — start entered separately from `Job.substantialCompletionDate` (the warranty and retainage clocks aren't always the same date), length in months as the contract states it, expiry derived with end-of-month clamping so 31 Aug + 6 months is 28 Feb not 3 Mar. Whether a callback was in warranty is derived from its REPORTED date, so a slow fix can't move the cost. `JobStatus` deliberately untouched — a stored lifecycle stage can disagree with the dates under it |

## 23. AI Features — 3 built · 1 partial · 1 missing · 1 descoped

| Status | Feature | Note |
| --- | --- | --- |
| Built | WIP over/under-billing variance detection (read-only, per line item/job) | `generateWipNarrative` |
| Partial | Compliance document extraction into structured records with expiration alerts | extraction shipped (`extractComplianceDocument`) — the alerting half doesn't exist yet (see Sheet 26) |
| Built | Draft estimate line items from text, grounded by trade-scope catalogs | `draftEstimateLineItems` now receives this company's `LineItemCatalogEntry` rows and its won `BidInvitation` amounts as reference data, and prefers matching an existing catalog price over inventing one. A matched line is created through the same path as "add from catalog", carrying `sourceCatalogEntryId` and the entry's cost/craft defaults — not just an echoed number |
| Built | Confidence signal on AI-suggested prices | `JobLineItem.priceBasis` distinguishes a matched catalog price from one informed by past bids from a bare general-knowledge guess, each with its own badge. A returned `catalogEntryId` is verified against the entries actually sent before it becomes a foreign key, and a `COMPANY_CATALOG` claim with no verified entry behind it degrades to `GENERAL_KNOWLEDGE` rather than overstating confidence |
| Missing | Plan/drawing takeoff via computer vision | explicitly deferred as a later, larger effort — different modality, different accuracy bar |
| Descoped | Client-facing chatbot | GCs are the customer here, not homeowners — deliberately out of scope for this ICP |

## 24. Integrations — 1 built · 2 partial · 1 missing

| Status | Feature | Note |
| --- | --- | --- |
| Partial | Accounting: QuickBooks, and likely Sage 300 CRE / Foundation | QuickBooks OAuth connection is built; actual data sync is not; Sage/Foundation not started |
| Missing | Payroll processor integration (for running actual pay) | not started |
| Partial | E-signature provider | homegrown token-based e-sign (`SignatureRequest`) covers contract signing only — not a general provider for every doc type |
| Built | Anthropic API (for the AI features above) | three shipped features now call Claude |

## 25. Roles & Permissions — 0 built · 0 partial · 2 missing

| Status | Feature | Note |
| --- | --- | --- |
| Missing | Distinct roles: estimator, PM, foreman/field, payroll/compliance admin, owner/exec, accounting | today's `UserRole` has exactly two values, OWNER and MEMBER |
| Missing | Field-only mobile access vs. office full access | no access tier below MEMBER, no mobile-specific surface |

## 26. Notifications & Alerts — 0 built · 2 partial · 3 missing

| Status | Feature | Note |
| --- | --- | --- |
| Partial | COI/license/bond expiration alerts | ranked across all four record types, counted in the dashboard's Needs attention tiles and listed in its Compliance card, so it reaches someone who opens the app — still no delivery channel, so it reaches nobody who doesn't. NOT Built until something pushes it |
| Missing | Certified payroll submission deadline reminders | no reminder system exists |
| Missing | Retainage release eligibility alerts | the underlying retainage data exists now (Sheet 11), but no alerting/notification system reads it yet |
| Missing | Apprentice ratio out-of-compliance alerts | blocked on apprentice tracking not existing yet |
| Partial | WIP variance alerts | jobs forecast past contract value are counted in the dashboard's Needs attention tiles and named in Job health on load, rather than only when someone clicks into a job — but nothing notifies anyone who doesn't open the app, so this is surfacing, not alerting |
