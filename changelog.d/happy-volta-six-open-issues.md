### Six issues Cyrus filed to Diego's lane, closed together — #351, #352, #353, #311, #305, #258 (Diego)
`claude/happy-volta-g8dg26`

Six open issues, all filed by Cyrus between 12 and 19 Sep, none touched
since. Two are security findings from the 19 Sep audit and were open with
the WWCCA pilot link live, so they went first.

**#351 — the two money deletes had no owner gate, and reconcile could not
see them.** `deletePayment` and `deleteRetainageRelease` asserted
MANAGE_BILLING and nothing else; any billing member could un-record money
without trace. Both now `assertOwner` after the capability check (the same
order `deleteContractDocument` and #392 settled on), and the Billing and
Retainage tabs withhold the Remove control from non-owners, so nobody meets
the refusal as a production digest. The two-step confirm with `describe`
was already there from #176's wave. Same family, same PR: an executed
subcontract on a job that has left ESTIMATE is the evidence
`markJobContracted` accepted, and CLAUDE.md's rule for evidence records is
"close, never delete" — `deleteContractDocument` now refuses it, the
Overview tab shows the sentence instead of the button, and both read the
one function in `lib/billing/contract-document-rules.ts` (outside the
"use server" module on purpose: a string export from one is a build
break). At ESTIMATE the delete stays, because an executed date typed on the
wrong upload should stay cheap to undo. **Not done here:** QuickBooks
reconcile still compares invoices only. Covering payments means pulling
Payment objects from Intuit and a second reconcile table; it is a feature,
not a guard, and it is listed as the remaining half of #351.

**#352 — outbound email and invite capture.** Item 1 (the ungated,
uncapped `sendOutboundEmail`) was closed by Cyrus in #395 before this
started. Item 3, the existence oracle, is closed: `inviteTeamMember` gives
one sentence for "already has an account" and "already invited", so an
owner can no longer learn which kind of known an address is. The residual
is stated in the code — a fresh address still succeeds where those refuse.
**Item 2 is a design decision and is NOT done:** an invite is consumed
silently at first sign-in, so whoever invites an address first captures
that person's account. Showing the person which company they are joining,
with a decline path, needs a moment between Clerk sign-in and the
`companyId`-required `User` row that does not exist today — a schema-level
change, flagged for Diego with a proposal rather than guessed at.

**#353 — model spend and integration secrets.** Items 1 and 2 (unmetered AI
features, the fail-open limiter) moved to Cyrus's lane with AI on 21 Sep;
#465 made the monthly cap fail closed and #468 (open, his) brings the
compliance upload under it. Items 3 and 4 are integrations and are done
here. The generic webhook receiver no longer accepts `SANDBOX` — its
`externalAccountId` is the constant `sandbox-000` for every company, so
"the payload must name a real account" bounded nothing — and writes at
most one WEBHOOK_RECEIVED row per connection per minute (`lib/integrations/
webhook-throttle.ts`, pure, tested at the boundary), so the log table can
no longer be grown at POST speed by anyone holding the URL. QuickBooks
tokens are sealed at rest through `lib/quickbooks-token-storage.ts` — the
same AES-GCM envelope Jobber, Procore, DocuSign and ACC use — on the OAuth
callback, on every refresh, and read back through the one opener. A row
written before this existed is plaintext and still opens; it becomes sealed
on its next refresh. With no `INTEGRATION_TOKEN_KEY` the token is stored as
before and the server log says so once, rather than breaking the live
production connection's next refresh with a digest; `quickBooksSetup`
deliberately does not require the key, and this keeps that promise.
Signature verification for the generic route is still the real fix and
still waits for a provider that has one.

**#311 — QuickBooksMapping wiped the person's choice on a failed save.**
React 19 resets a form before a form *action* runs, unconditionally, so a
refused mapping save emptied the account picker beside the error. The form
is `onSubmit` now, like `LogTimeEntryForm`, and `formActionCensus` scans it
instead of excepting it; the test that pinned the exception now pins its
absence.

**#305 — the hours placeholder read as a value.** `placeholder="8"` sat
where a value sits and an automated click-through reported a silent
payroll failure that was an empty required field. It is `hrs` now. NOT
fixed by defaulting to 8, per the issue: a pre-filled 8 logs eight hours for
anyone who forgets, straight onto a WH-347.

**#258 — ChangeOrders' two one-click destructives.** Remove-a-proposal and
Discard-draft go through `RowActions`/`ConfirmDelete` like every other
delete in the app: the proposal row's cluster is right-pinned so it takes
`pinned="end"`, the discard button is left-aligned so it takes the default,
and the census's `CALLBACK_EXCEPTIONS` is empty for the first time.

**Verified, and not.** typecheck, lint, the unit suite and a full `next
build` locally; the census files that held each exception now scan the
fixed files. Mutations named in the PR. **Nothing clicked** — this
container cannot reach a preview or production. The click-list is in the
PR body. One environmental note for the next agent on this container:
`pnpm install --frozen-lockfile` fails here because `xlsx` is fetched from
`cdn.sheetjs.com`, which the egress proxy denies; the lockfile was NOT
changed, the package was installed locally from npm for verification only.
