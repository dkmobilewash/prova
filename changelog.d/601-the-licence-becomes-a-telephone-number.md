### The licence number becomes a telephone number (Cyrus)

`cyrus/sales-signals`

A §4104 listing prints a licence number and no way to ring anybody. This reads
California's CSLB master file and puts the telephone number on the lead, which is the
step that turns the cold-outbound channel from a list of names into a call list.
`601-the-file-was-a-plain-get-all-along.md` established that the file downloads in one
plain GET and named this as the next slice; this is that slice.

**Four pieces, and the pure ones carry the risk.** A streaming CSV reader
(`lib/cslb/csv.ts`), a reader for one row of the master file (`lib/cslb/masterFile.ts`),
the join decision (`lib/cslb/phoneFill.ts`), and an operator task that applies it
(`lib/cslb/phoneFill.task.ts`, run by `pnpm cslb:phone-fill`). The first three are pure —
no prisma, no network, no file system — so every rule below is executed by a test rather
than argued about.

**THE ONE RULE: a number a person typed is never overwritten.** `SalesLead.phone` is
written today only by the hand-typed lead form, so a value in it is somebody's own
knowledge — very possibly the mobile of the estimator they actually speak to, which is
worth more than the office line CSLB has on file. Three independent things enforce it: the
decision checks for an existing number BEFORE it reads the licence, so no path reaches the
writing branch; the write carries the phone it expected to find, so the UPDATE itself
refuses a stale plan; and `phoneFill.dbtest.ts` makes POSTGRES demonstrate that refusal
rather than a mock that was told to say no.

That third one matters because the second is a claim about Prisma and Postgres, not about
this repo. The dbtest creates a lead, plans a fill, has somebody type a number mid-run,
and requires the apply to report it as raced and change nothing.

**TWO SHAPES MEASURED, AND ONE I NEARLY GUESSED WRONG.** Over 621 whole records read from
the head of the live file: `BusinessPhone` has exactly ONE shape, `(916) 555 1234` — a
SPACE where convention puts a hyphen. A scratch file from an earlier session held a
ten-digit run that read exactly like a bare phone number and would have had the parser
expecting `9165551234`; it was a **cookie expiry timestamp in a curl cookie jar**. A
needle already on the page in a different guise, which is the #61 watcher trap, and the
only reason it did not ship is that the column was read by name instead.

The second shape finally has a cause rather than being noise. `Classifications(s)` prints
`C-9` hyphenated and `C35` bare because both are THREE characters: the hyphen pads a
single-digit class. So it is formatting, and `lib/sales-licence.ts` is right that a filter
written `C-35` or `C9` matches nothing in this data and goes green.

**The join key is computed in ONE place.** `licenceKey` already decides what a CSLB
licence number is, and both sides of the join go through it, so a class prefix or a
leading zero on either side cannot turn a real match into a miss. A second copy of that
rule in a script is the #526 failure, and avoiding it is why the runner is TypeScript —
`vitest.task.config.mts` records the four other mechanisms tried first and why each was
worse, including a plain `node scripts/x.ts` that Node 22 can almost run.

**A suspended licence is filled, not hidden.** 5.2% of the file carries some flavour of
suspension — a lapsed bond, a workers' comp gap. Those are real firms with real
telephones, and a bond suspension is a reason to ring somebody rather than to hide them,
so the status travels with the record and the caller decides. CLAUDE.md's entry on the
percentage refusal is the general form.

**It changes nothing until told to.** The first run is a report — how many leads can be
filled, how many already have a number, how many carry no licence, how many are not in the
file, how many are in it with no phone. Five outcomes rather than a boolean, because
"nothing happened" has four unrelated meanings here and only two of them say anything about
CSLB. The report-only path then PROVES it wrote nothing by re-reading the exact rows it
would have touched. `CSLB_APPLY=1` applies.

It is scoped to ONE company through the same resolver `seed-demo.mjs` uses, which refuses
rather than guessing when two companies share a name. The first draft read every lead on
the database, which would have written across tenants.

**VERIFICATION.** 55 unit tests across the three pure modules — 17 for the CSV reader, 19
for the row reader, 19 for the decision — and 4 db tests against a real Postgres carrying
every migration. Mutation-tested, each red naming the offender: a comma
always delimiting, `end()` always flushing, a bare CR terminating a record, the overwrite
guard moved below the lookup, `typed()` not trimming, and the index letting the last row
win. The CSV reader is additionally driven at EVERY ONE of its document's split points and
one character at a time, which is how the `\r`/`\n` straddle was settled.

Then run end to end against a real database and a file on disk: 7 leads, 5 licences looked
up, 3 filled — including a suspended licence and a lead whose stored licence carries a
class prefix — with the typed number and its note (`(707) 555-0000 ask for Mai`) byte-identical
afterwards, and a second apply writing 0.

**One mutation result worth more than the five that behaved.** Moving the overwrite guard
below the lookup left the test literally named *"NEVER overwrites a number a person typed"*
GREEN, because the branch I substituted was doing the work. The property that matters is
not the outcome's NAME but that no lead which had a phone appears in the writes, and that
is now asserted over a cross product with a control requiring the same leads to be
fillable once their phones are removed. A test can be about nothing while wearing exactly
the right title.

**Two things found on the way that are not this feature.** A fixture in
`lib/punch-item-status.dbtest.ts` built its temp table from `SELECT … FROM "PunchListItem"
LIMIT 1` — any row in the database — and then dereferenced `[row]` with no guard, so on a
database where nothing else had written a punch item it failed with "cannot read properties
of undefined". Seen once on the first run against a freshly created scratch database and
not in the four runs since. It makes its own row now and asserts the probe is non-empty.
And four tests in `lib/actions/complianceUploadAllowance.test.ts` hang for exactly 30
seconds each in an agent container: the file mocks allowance, integrations, usage, db,
cache and auth but not `@vercel/blob`, and the host is unreachable here. That file is
byte-identical to `main`, CI runs it green, and it is noted rather than touched.

**NOT DONE, and deliberately.** Nothing downloads the file — a task that fetched 77MB per
run would be rude to a state agency and would fail differently every time their WAF had an
opinion. There is no screen: this is an operator task, and whether a review queue should
show what it found is a product decision. And nothing dials anything. The file carries no
email address, by statute rather than omission, and no line type — nothing says whether a
number is a desk line or a mobile. A key that finds a telephone number is not permission to
dial it.
