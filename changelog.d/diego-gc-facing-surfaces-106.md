### Eight defects on the three surfaces a GC actually touches — the only pages with no login at all (Diego)
`diego/gc-facing-surfaces-106` → closes #106, folds in #217

The portal, esign, and contract-document surfaces are the only pages an
anonymous GC ever loads, and #106 found eight things wrong across them.
All eight, in the order the issue listed them:

**1. The portal showed DRAFT and VOID change orders.** No status filter on
`/portal/[token]/jobs/[jobId]`'s `changeOrders` read, so a GC saw the sub's
unsent internal drafts, work withdrawn before asking, and the resulting
numbering gaps — the one surface where the GC saw the sub's unsent internal
state, in an app whose stated rule is every decision is made for the sub.
Filtered to APPROVED only, the same status every other read site already
restricts to (see `ChangeOrderStatus`'s own comment in `jobs.prisma`) — a
change order has touched `JobLineItem` only once approved, so it's the only
one honest to show outside the company.

**2. Neither public token could be revoked or expired — folds in #217.**
`Contact.portalToken` and `SignatureRequest.token` each got a nullable
`revokedAt`; the esign token also gets `expiresAt` (30 days, set at
creation — existing PENDING requests are left alone rather than
retroactively expired). Both pages 404 a revoked/expired token exactly like
one that never existed, never a different error, so a dead link can't be
distinguished from one that never worked. New actions
(`revokeClientPortalAccess`, `revokeSignatureRequest`) plus buttons on
`/contacts/[id]` and `/jobs/[id]`. Revoking is disable-only, not rotation —
`enablePortalAccess` reactivates the SAME link rather than minting a new
one; a genuine "rotate to a new link" is a real but separate feature this
PR didn't build, noted rather than silently dropped. The portal read also
now checks `Contact.status === "INACTIVE"`, which #106 pointed out neither
page read at all.

**3. Deleting a contract document left the PDF public forever.** `del` was
never imported from `@vercel/blob` anywhere in the repo; the row went, the
blob stayed at its public URL. `deleteContractDocument` now calls it —
best-effort, since a storage-API blip must not block removing a document a
person is often deleting BECAUSE it should no longer be public.

**4. Fixed blob pathnames on all four uploads.** Already fixed — `0d82c3b`
gave `putDocument` `addRandomSuffix: true` before this issue was worked, so
nothing to do here beyond re-verifying it (confirmed: all four call sites
route through the one wrapper, which sets it unconditionally).

**5. Contract document versions were `MAX(versionNumber) + 1`**, same shape
as the invoice-number bug #224 just fixed and the exact failure
`ChangeOrderCounter`'s comment warns about. New `ContractDocumentVersionCounter`
model, bumped in the same transaction as the insert, backfilled from
`MAX(versionNumber)` per job so it doesn't collide with existing history.

**6. The signed-contract page contradicted its own banner** — a green
banner saying "this reflects exactly what was agreed to at the time of
signing" sat above a caption claiming "the CURRENT agreed scope and
pricing." `ContractSummary` gained a `frozen` prop (pulled into a pure
`contractSummaryFooterCopy` function so the wording is testable without a
render harness); the esign SIGNED branch is the one caller that passes it.

**7. The signature date had no `timeZone`** — the server's own UTC clock,
so an evening signature west of UTC dated a day late on the one date a
dispute turns on. `/esign` has no `TimeZoneCookie` (it's outside the
signed-in layout), so this reuses `viewerTimeZone()`'s existing geo-IP/UTC
fallback rather than needing a new mechanism. Same fix applied to the
`/jobs/[id]` signed-date and expiry displays, which had the identical gap.

**8. Double-clicking "Sign contract" recorded the signature, then crashed.**
Three parts: `/portal` and `/esign` had no React error boundary of their
own at all (a`components/PublicRouteError.tsx` shared by new
`portal/error.tsx` / `esign/error.tsx`, reusing #221's `isStaleDeployError`
so the three boundaries in this app don't drift into three ideas of "stale
chunk"); the bare `<button>` is now a `SubmitButton`; and `signRequest`'s
check-then-act was replaced with an `updateMany` guarded on
`status: "PENDING"`, so a request already SIGNED returns quietly instead of
throwing "already signed" — which is what made the first click's genuine
success look like a failure.

Fourteen new tests: pure (`access-tokens.test.ts`, `signed-date.test.ts`,
`ContractSummary.test.ts`) plus two `.dbtest.ts` suites against a real
Postgres covering the token revocation/expiry paths, the double-submit
race, the version counter (including the exact "delete v2, re-upload"
collision this replaced), and the blob-delete-on-row-delete behavior with
`@vercel/blob` mocked. Each fix was hand-mutated back to its old behavior
and confirmed the relevant test goes red, then restored.

One honest limit: the finding-1 and finding-2 dbtests exercise the same
query/status the pages use (a shared `CLIENT_VISIBLE_CHANGE_ORDER_STATUS`
constant, in the finding-1 case) rather than rendering the page components
themselves — this repo has no precedent for testing a Next page directly,
so a mutation that deleted the `where` clause from the PAGE'S query
wouldn't be caught by the dbtest alone; the click-list's manual check is
what actually proves the page.
