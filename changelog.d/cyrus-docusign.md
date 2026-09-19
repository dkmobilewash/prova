### Send a contract or change order through DocuSign, beside C Stream's own signing link (Cyrus)
`cyrus/docusign`

Some GCs will only sign in DocuSign. The DocuSign card on Settings →
Integrations used to be a "Coming soon" placeholder. Now it connects: the
account owner presses Connect and signs in to the company's own DocuSign
account. After that, the job page offers **Send with DocuSign** in three
places: the contract section, each uploaded contract document, and each
submitted change order.

**C Stream's own signing link stays the default.** DocuSign is an option
beside it and replaces nothing. On an install without the DocuSign keys, the
job page shows nothing extra, and the card says "Not set up".

**It plugs into the records that already exist; there's no parallel model.**
When everyone has signed, the signed PDF and DocuSign's certificate of
completion are saved in the job's contracts folder. For the contract, the
signed PDF is also recorded as a new `ContractDocument` version with
`executedSignedDate` set. That's the same executed-subcontract evidence
`markJobContracted` already accepts, so a job signed through DocuSign becomes
billable through the gate that's already there. There's no third route and no
stored flag. A signed change order is NOT approved automatically. Approving
moves the budget and stays a deliberate step, just as the built-in e-sign
doesn't contract a job on its own.

**Evidence rules.** A sent envelope is correspondence. The only way to close
one is an owner-only, two-step **Void** (at DocuSign, with a reason the signer
sees), and nothing deletes it. The browser-test cleanup refuses a job that
carries one (`NEVER_DELETE` in `scratch-scope.mjs`); the demo reset scripts
delete their own seeded jobs wholesale, as they do every evidence record.
Every date comes from DocuSign's own record of the envelope.
The executed date is the calendar day of DocuSign's completion time in the
sender's zone, which is captured when they press Send. So an evening signature
in California isn't recorded as the next day.

**The webhook.** It has its own route, `/api/docusign/connect`. The route
refuses with 503 when no HMAC key is set, and with 401 unless an
`X-DocuSign-Signature-N` header matches (HMAC-SHA256 of the raw body,
base64). After that it matches the envelope by DocuSign's id AND the account
the message names, then re-reads the envelope from DocuSign with that
company's own token. Nothing in the message body is applied. The generic
`/api/integrations/webhooks/[provider]` route no longer accepts DOCUSIGN, so
the unverified door is closed. Without an HMAC key, sending still works, and
status arrives when someone presses Refresh on the envelope.

**Verified against DocuSign's docs on 2026-09-18.** The OAuth hosts
(`account-d` for demo, `account` for production), `/oauth/auth`,
`/oauth/token` with Basic client auth, S256 PKCE, the two-minute code, the
`signature` and `extended` scopes, and userinfo's `accounts[].base_uri`. From
the eSignature API: envelope create, get, the `combined`/`certificate`
downloads, and void. From Connect: the HMAC header and algorithm, and
integrator-managed HMAC for client accounts. Also free-form signing when a
signer has no tabs, and the go-live rules.

**NOT verified, to settle on a demo account:**
- The access-token lifetime. The code uses `expires_in`.
- Whether the old refresh token dies at refresh. The code assumes it does and
  stores with a compare-and-swap.
- Whether an envelope-level `integratorManaged` notification sent with a
  customer's token is signed with OUR HMAC keys. If it isn't, the webhook
  fails closed and Refresh still works.
- Anchor tabs on a converted HTML document.

**Go-live finding.** A "public integration", meaning many customers each
using their own DocuSign account, requires the DocuSign Partner Program and a
paid production account.

**Tests.** 25 with a two-company fake database and a fake DocuSign, 28 pure,
10 on the OAuth routes. 25 guards were mutation-tested, and 24 went red. The
survivor is the Refresh action's own company scope, which duplicates the
scope inside the sync it calls; that inner scope is tested directly.

Migration `20260919120000_add_docusign_envelopes` is additive: one new table
and two enums, with foreign keys only from the new table.
