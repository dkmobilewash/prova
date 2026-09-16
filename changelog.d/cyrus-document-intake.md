### Drop a folder of GC paperwork in, get a table of proposals out — `/intake` (Cyrus)
`cyrus/document-intake`

Document control is the biggest complaint in every piece of contractor
research we have, and it has always been the same complaint: the paperwork
arrives as an email attachment and it lives in an inbox until somebody
needs it and cannot find it. `/intake` is the tray that ends that. Drop a
folder — or drag one, or multi-select — and every file in it gets a row
with a proposed destination, a confidence chip, and a sentence saying WHY
in words you can disagree with. "Filename contains 'COI'." Never "AI
determined": a reason nobody can check is a reason nobody can overrule.

**The uncertain rows are at the top, and that ordering is the product.** A
tray of eighty files is only worth having if the four the machine is unsure
about are the four you land on. `orderBy: createdAt` gives you upload
order; sorting by the confidence enum gives you HIGH, LOW, MEDIUM
alphabetically — both bury the rows a person is actually needed for.
`sortForReview` puts UNKNOWN first (including a confidently unplaceable
one), then LOW, MEDIUM, HIGH, and breaks ties on the filename so a row
cannot move under the cursor between a glance and a click.

**Nothing is filed until a person confirms, and the words on screen say
so.** The counts read "N ready to file", not "N filed automatically",
because nothing has been filed. An UNKNOWN cannot be filed at all — it is
the absence of a destination, not one — and "Confirm all" skips those rows
and says how many it skipped. Confirming N rows is ONE `prisma.$transaction`
rather than N awaited updates: sixty separate updates can half-succeed, and
the person's only evidence of which half landed would be scrolling the
table.

**The column is headed "Filed as", and that is deliberate rather than
cautious.** This pass records the accepted kind and job on the intake row.
It does NOT create a Submittal, an Rfi or a ComplianceDocument — those
carry identity rules a filename is not evidence for (a submittal number
comes from a counter; an RFI's fields lock on creation; a compliance
document has an expiry somebody has to read off the page). The page says
that in as many words under the table, because a label promising it before
it exists is how a demo becomes a lie.

**Three enforcement points on the upload, not one, for a reason this repo
has already paid for once.** The blob store is ONE store shared by every
tenant, so a URL from it is not evidence of whose file it is. The token
route re-derives the company from the session and refuses to sign a
pathname outside `document-intake/<companyId>/`; the recording action then
checks the returned URL is a blob URL (parsed, not pattern-matched — a
userinfo prefix talks past a substring test), that it is OUR store, and
that it is this company's folder. Same shape as the photo feature's fix,
for a different prefix.

**Two defects this branch found in itself, both green on every check the
repo had.** The dismiss button's `<ConfirmDelete>` was sitting in
`<RowActions>`'s CHILDREN rather than its `destructive` prop. RowActions
renders `{armed ? null : children}` — so arming the dismiss unmounted the
ConfirmDelete along with the button beside it, while the arming state
stayed true in the parent. The row's actions vanished and neither Confirm
nor Cancel could be reached again without a reload; a delete that can
be neither completed nor abandoned is worse than the sibling bug the
census was written to end. Typecheck was happy (children take any
ReactNode), and all three existing census assertions passed, because each
asks whether the file MENTIONS RowActions. `rowActionsCensus.test.ts` now
asks whether each ConfirmDelete is lexically inside a `destructive={`, and
counts what it parsed (39 files, 43 occurrences) against a floor so a
pattern that stops matching fails loudly instead of finding no offenders.

The second: both headline buttons — "Choose a folder" and "Confirm all
N" — shipped `bg-brand text-neutral-900`, copied from a palette note
describing a yellow brand this repo does not have. `brand` is blue-600, a
DARK fill, and a dark label on it measures **3.47:1**, under the 4.5 floor
a button label answers to. `theme-contrast.test.ts` already proved white on
brand clears 5.17:1 — and that assertion was measuring a pairing nothing
was obliged to use. It now scans the markup and requires every `bg-brand`
class string in the app to carry `text-white`, so a token test is tied back
to the buttons it describes.

**`DocumentIntake` is company-scoped with an OPTIONAL job**, which is the
shape of the problem rather than a convenience: half of what arrives in one
of these drops is not about a job at all, and the half that is often does
not say which job until somebody reads it. That makes it `ON DELETE SET
NULL` rather than a blocker of `Job` — so unlike `InvoiceCounter` in #227
it does not refuse a job delete — and it is still in `HANDLED_MODELS` and
in both cleanup scripts' delete order, because those lists answer "what
belongs to the job", not "what would refuse the delete". A comment claiming
it was the first non-blocking entry in `HANDLED_MODELS` was checked rather
than inherited, and was wrong: six others are in the same position, and the
comment now says so.

The classifier itself (`lib/intake/classify.ts`) is being written in
parallel by somebody else. Everything here was built against its published
contract and imports it; what is on this branch is a labelled filename
matcher that never claims HIGH, so the screen's honesty does not depend on
which one is behind it.
