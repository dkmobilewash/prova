### Bluebeam Studio: document exchange and markup status, not takeoff quantities (Cyrus)
`cyrus/bluebeam-integration`

**Research first, and the finding changes the shape of what shipped.**
Bluebeam's public API is real — OAuth 2.0 Authorization Code, REST, a
Studio API with Sessions/Files/Markups under `/publicapi/v1/` — confirmed
against `support.bluebeam.com` (the JS-rendered `developers.bluebeam.com`
portal returns an empty shell to every automated fetch). But it exposes
markup STATUS, never markup geometry or takeoff quantities: those live
only in Revu, locally, and never sync to Studio's cloud API. So "drawings
and markups flowing into estimating" — the value case this integration was
asked to chase — is not buildable against this API. What is buildable, and
shipped: push a PDF into a per-job Bluebeam Studio Session, and read back
a file count plus a markup status summary (e.g. "3 files, 12 markups: 9
approved, 3 pending"). Full citations, and an explicit VERIFIED/NOT
INDEPENDENTLY VERIFIED split for the request/response shapes that
Bluebeam's own docs describe only in prose, are in
`packages/integrations/src/bluebeam.ts`'s header comment.

**Access.** Self-serve sandbox with a BBID and a Core/Complete/Max plan;
production approval is a 5-business-day review, or a software-partner NFR
subscription for shipping this to multiple customers — the same shape as
Procore/DocuSign's own app registration, not a harder gate than what
already exists here.

**What shipped**, following the existing integration pattern exactly: OAuth
connect/disconnect on Settings → Integrations (a new `"studio"`
`ProviderImplementation` kind — push-and-limited-pull, unlike `feed`'s
pure pull or `esign`'s single-document lifecycle), tokens encrypted with
the existing `lib/crypto.ts` envelope on `IntegrationConnection` (provider
`BLUEBEAM`) — never plaintext, unlike the open QuickBooks issue #353 — a
new per-job `BluebeamStudioSession` link (same shape as
`ProcoreProjectLink`/`CompanyCamProjectLink`, CASCADE on Job), and five
Server Actions (link a job to a fresh Studio Session, push a local PDF,
refresh the status summary, unlink, disconnect), all `MANAGE_COMPLIANCE` +
owner-gated like every other integration control on that page, all
`ActionResult`, never a throw.

**Deliberately not built.** No webhook receiver — Bluebeam's Subscriptions
API exists but its signature scheme wasn't independently verifiable from
what this session could fetch, and CLAUDE.md already flags one missing
signature check elsewhere; adding a second unverified one would be worse
than a manual Refresh button. No pull of the flattened "Snapshot" PDF back
into C Stream — `JobMedia` only accepts photo/video/audio content types
today, and widening that shared allowlist wasn't in scope for this PR.

**Guards mutation-tested: 6 requested, 6 caught (100%), each restored and
re-confirmed green.** The PDF magic-number check, the 25MB upload cap, the
`BLUEBEAM_REGION` allowlist, the `MANAGE_COMPLIANCE` capability gate, the
owner-only gate, and the pre-signed-S3-URL isolation (no bearer token ever
reaches Bluebeam's upload host) — each broken, confirmed red on exactly
the intended test, restored, confirmed green. `action-capability-guards.
test.ts`'s automatic walk covers the capability gate on all five actions;
`lib/actions/bluebeam.test.ts` adds the owner-gate half that census does
not pin, with a DB tripwire proving the refusal happens before any
`prisma` touch.

Migration `20260919220000_add_bluebeam_studio_session`: additive only —
one enum value, one table, three foreign keys (`Company` RESTRICT, `Job`
CASCADE, `User` SET NULL). `BluebeamStudioSession` added to
`scratch-scope.mjs`'s `HANDLED_MODELS` and both cleanup scripts' `del()`
order, on the `InvoiceCounter`/#227 lesson — a job-owned model is three
edits, not one.

Full `apps/web` suite green (324 files / 5286 tests, +51 new), typecheck,
lint and `./scripts/preflight.sh` all green. dbtest not run locally (no
Postgres in this session; scratch-only per CLAUDE.md). Click-list and the
credentials a human still needs to obtain are in the PR.
