### The company can finally say who it is (Cyrus)
`cyrus/company-setup`

Until now the name on this app's most consequential documents was a string
sign-up invented and nobody could change. `requireCompanyContext` names a
new company `${your name}'s Company` — or "My Company" when Clerk has no
name — and `prisma.company.update` appeared NOWHERE in `apps/web`. That
generated string printed as the contractor on the **WH-347 certified
payroll form** (a federal form), as the employer on a **union trust-fund
remittance report**, above the signature block a **GC signs** on
`/esign/[token]`, in the sidebar, and on the data-export page. `dbaName`,
`ein`, `hqAddress*`, `phone` and `website` had been on `Company` for weeks
with nothing writing any of them.

The worst of it was a dangling pointer: the remittance sheet printed, in
red, *"Not recorded on the company record. Settings → Company."* — telling
an office manager to go to a page that did not exist, to fix data the
product had no way to capture. `ep-icy-hat` still holds a company called
"Cyrus Oliveras's Company" with a null EIN, which is exactly what a fund
would have received.

**What shipped.** A **Company** section, first on `/settings`, editing all
ten fields. `updateCompanyProfile` in `lib/actions/company.ts` is the first
writer of `Company` this app has had. Refusals are RETURNED and the form
renders them — a thrown Server Action message is a digest in production, so
a thrown validation message is no validation message at all.

**Two guards, in that order, and the order is the decision.** `/settings`
demands MANAGE_COMPLIANCE, and a page guard stops a page rendering, not the
endpoint behind it — `lib/action-capability-guards.test.ts` derived that
requirement from the page's own guard and failed the build the moment this
action existed, which is the check working rather than a nuisance. So the
capability is checked first (the broader fact about the person), then
`ownerRefusal` (about this record specifically: renaming it changes a
federal form). `ownerRefusal` rather than `assertOwner` because this action
promises a legible refusal, and `ownerRefusalCensus.test.ts` fails the build
for that combination.

**The EIN is stored in ONE form: hyphenated, `12-3456789`.** Both forms are
accepted — people copy it off an IRS letter hyphenated and out of payroll as
nine bare digits — because refusing either teaches nothing, while storing
either means two prints of the same month differ. Hyphenated is what the IRS
prints and what a delinquency notice quotes back. A blank legal name is
refused; a website that is not an http(s) address with a real host is
refused (a bare host gets the scheme added rather than a refusal over
nothing); `phone` stays free text, because an extension is part of a real
number.

**The form shows what is MISSING rather than looking empty.** Every input
placeholders "Not recorded", and `companyProfileGaps` puts the document's
own sentence beside the field that fixes it — including a note when the name
still looks like the one sign-up invented, naming where it prints. The gap
list reads `employerAddressLines` from `lib/fringe-remittance-filing.ts`
rather than restating "what counts as a complete address": a second copy of
that rule is how a form comes to call a record complete that the remittance
sheet still refuses to print. It deliberately does NOT flag phone and
website, which print on nothing — a list that names every empty field is a
list people learn to ignore.

**The pointer is now true, and can't quietly stop being true.** The heading
is exactly "Company", and the five instructions were reworded to "An owner
records it at Settings → Company" — the old wording sent a MEMBER to a page
that refuses them outright. `companyPointer.test.ts` fails the build if the
pointer and the heading stop agreeing, and if the form or the action stops
being wired up (this repo's recurring "written, documented, never called"
shape). It asserts the size of what it scanned first, because a walker that
finds nothing passes every check after it.

**Checks.** typecheck 0, lint 0 (no new warnings), full web unit suite 127
files / **2206 tests, 0 failures** — 39 of those new (23 + 12 + 4), plus 2
the capability census derived on its own. `companyProfile.dbtest.ts` 6/6
against real Postgres on `ep-icy-hat-afqau56u` (host asserted before the run;
zero rows left behind, verified after), proving the ten columns are writable,
that "" is stored as SQL NULL rather than as an empty string, and that the
documents' gap list goes from three gaps to none. Build green. No migration.

**Mutations, run by hand.** Storing the EIN unhyphenated: 4 red across both
suites. Deleting the owner guard: 4 red. Renaming the heading to "Company
record": the pointer test red with "so every 'Settings → Company' in this
app is a dangling pointer". All three restored and re-run green. NOT CLICKED
— click-list is in the report.
