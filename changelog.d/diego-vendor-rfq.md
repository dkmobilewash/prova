### The request for quote actually gets sent

The last of the three sub-tasks the workflow audit found missing. Step 5 asks for
"specific schedule pages and specs packaged into a request for quote"; the app
recorded the **conversation** — when you asked, when you want it back, who
declined, who is overdue — and sent nothing. The two delete confirmations on that
screen said so out loud: *"Nothing is sent to them."*

So an estimator exported the spec section, opened their mail client, found the
supplier's address, attached it, wrote the same sentence they write every time,
sent it, came back and typed the date into C Stream.

Now: **Send the request** on any outstanding row in the levelling table. It
emails the supplier, attaches the spec sections and addenda on that bid, and
stamps `requestedOn` if it was blank.

### `Vendor.email` has existed all along and nothing ever read it

The column is on the model with a form field behind it on `/vendors`, and a grep
for a query selecting it returned **nothing** — `/bids` asked for `{ id, name }`
and `BidLevelling`'s own prop type was `{ id, name }[]`. Every supplier address a
company had typed in was write-only. That is the "written, documented, and never
called" shape pointed at a column.

The two identical inline `{ id, name }[]` declarations are now one named
`LevellingVendor`, because adding an address to one and not the other is exactly
how two lists of one value drift apart.

### It reuses #787's machinery rather than copying it

`deliverEmail` learned attachments for the bid submission and carries the write
ordering that cost this repo a DATA-LOST bug to get right; `bid-submission.ts`
worked out what fits in one message. An RFQ is the same send at lower stakes, so
it is the fourth and last entry point on the same terms — a capability, the same
rate cap, and a recipient read off a row rather than accepted from a caller.

**And it uploads nothing, unlike the bid package.** A package is merged in the
browser so its bytes have to transit the blob store and be deleted afterwards.
The documents an RFQ carries are already stored and permanent, so the server
reads them where they live. No upload, nothing to clean up, no `finally`.

### Four decisions worth stating

**Each document is checked against its own purpose.** `documentUrlProblem` proves
a URL is in our store *and* under a given purpose's folder for this company, so a
spec section checked as an addendum is checked against the wrong folder. The kind
travels with the id and `RFQ_SOURCE_PURPOSE` maps it.

**The form says which documents, never where they are.** Every url and purpose
comes from rows re-read scoped to this bid and company; an id from anywhere else
is refused.

**The size check is on the TOTAL**, which is why it is not the bid package's
check. A package is one attachment the upload ceiling already bounds; an RFQ is
as many documents as somebody ticks, each of which passed its own upload check
months apart. Four legitimate files are one impossible email, and the refusal
names the figure and says to send it in two.

**It is a panel, not a confirm card.** `BidPackageBuilder` makes somebody tick a
box naming the GC because a bid cannot be recalled and arrives against a
deadline. An RFQ is a question to a supplier: the worst case is a second email,
and a named-intent tick on every one of five requests trains people to tick.

**And it asks for the exclusions**, which is the sentence an estimator retypes
every time. `bid-levelling.ts` opens with *"THE POINT IS NOT 'WHO IS CHEAPEST'.
IT IS 'ARE THEY BIDDING THE SAME THING'"* — and it can only name what the
cheapest quote excludes if somebody wrote the exclusions down. Asking for them in
the request is the cheapest possible way to get them.

### The date is stamped, and only here

Every other date on `BidQuote` is entered, because it records something that
happened elsewhere. This one happened in this process a line earlier — the same
argument `deliverEmail` makes for using our own clock on the QUEUED event. It is
written **only when it was blank**: re-sending does not rewrite when the request
was first made, which is the date `requestState` reads "overdue" off.

### Verified

Preflight's four gates green, 708 test files, 11,016 tests, no production schema
touched.

**Twelve mutations, all red on the first run** — a document id from another bid
accepted, the per-document URL check skipped, every document checked as a spec
section, an oversized set sent anyway, re-sending rewriting the original ask, the
date stamped after a failed send, the recipient not read off the vendor, the rate
cap not consulted, a quote naming no recorded vendor sent, the size check
forgetting base64 inflation, documents with no file offered, and the Ask
exclusion naming an action that does not exist.

**All red on the FIRST run, which is the difference from #787.** That one shipped
its first draft with seven mutations green, because `action-capability-guards`
executes an action as a principal refused at the first line and as one who gets
through to fail at the next — so nothing reached the body while every guard
looked covered. This action has the same shape, so it got its own body test
before the mutation run rather than after it.
