### The licence a listing printed becomes a phone number somebody can ring (Cyrus)
`cyrus/sales-signals`

Every lead the §4104 reader imports arrives uncallable by construction: a listing prints a
licence number and no telephone, and `importSubListing` never writes `phone`
(`601-the-licence-becomes-a-phone-call.md`). CSLB's free master file is keyed on that
licence and carries `BusinessPhone` on 99.9% of its 243,786 rows, and as of yesterday it
is one plain GET (`601-the-file-was-a-plain-get-all-along.md`). This is the slice that
entry named and declined to build at that hour: the reader, and the fill.

**What it does.** One button on `/sales`, "Fill phone numbers", visible to the operator
owner. It streams the file, keeps only the rows whose licence a lead holds, and writes
`SalesLead.phone` — the same column the hand-typed form writes, so the register card's
existing `tel:` link appears with nothing new drawn. Three rules: **never overwrite** a
phone already there; **only a `CLEAR` licence fills** (a suspended or expired match is
counted and left blank — the firm is not a prospect and the number may be stale); and
**a non-200 from CSLB is returned as a sentence with the status and the date**, because
a 403 on a different route was once generalised into "the file cannot be fetched" and
cost this channel a day. The result names every count, including what did NOT fill and
why, so a silent zero cannot pass for "the file has no phones".

**Why it streams, and why it is a button.** 77 MB is nothing on a laptop and a lot
inside a serverless function, so `lib/cslb/masterFile.ts` reads chunks, cuts lines as
they complete (a quoted field with a line break inside stays one row), and holds only the
answer. The page sets `maxDuration = 60`, the same as the repo's other long fetch. It is a
button rather than part of the import because the fetch is somebody else's server behind
a WAF that decides per request: a refusal has to land in front of a person, not inside an
import that quietly came back phoneless.

**The two traps the measurement recorded are both pinned by test.** Good standing is
spelled `CLEAR`, not `ACTIVE`; and the classification column is literally named
`Classifications(s)` with codes in both spellings at once (`C9`, `C-7`), which
`classCodes()` collapses. Columns are found BY NAME from the real header row, and a file
whose header has lost `BusinessPhone` throws naming the column rather than returning
243,786 rows with no phone on any of them.

**The size assertion, because a stream reader has two failure modes.** The test cuts the
fixture file at *every* byte offset and requires the identical row set each time, so a
reader that dropped the line straddling a chunk boundary — one row fewer, every other
assertion green — fails on the first cut that lands mid-line. 12 tests.

**What this does not do, stated so nothing built on it implies otherwise.** No email: CSLB
publishes none, by statute (B&P §27). No line type: nothing in the file says desk line or
mobile, so a number found here is a number a person may click to ring and is not permission
to put it in a dialler. No signal is created — the file is a lookup, not a claim about the
prospect. No schedule: the file is fetched when the button is pressed, and how often it is
refreshed, or who owns that, is still undecided.

Also corrected on the way: the header of `lib/sales-licence.ts` still said "It is not a
URL" in bold with the 403 table under it — the exact sentence the previous entry retracted,
left standing in the module everyone building this would read first.

Per the fixture rule, no row of the real file appears in the repo; the test uses synthetic
names and the licence shapes `sales-licence.ts` already cites.
