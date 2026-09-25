### Quantities measured off superseded drawings are named — and never re-measured (Diego)
`diego/takeoff-currency`

An estimator traces a floor plan, gets 1,240 LF of partition, and posts it to
the estimate. Three days later Addendum 3 lands and moves a corridor. **The
1,240 is now a number produced from superseded drawings, and nothing in the app
knows** — the measurement, the line item and the bid all look exactly as they
did.

**This names what is suspect. It never re-measures and never re-scales.**

The obvious feature here is "re-quantify automatically", and it is not buildable
and should not be faked. The app has no PDF comparison, and a corridor shifting
two feet changes a length by an amount only a person looking at both drawings
can know. Anything computed as a *new* quantity would be a guess wearing the
shape of a measurement, printed next to real ones. So the whole output is a list
of what to go and look at, and the strongest thing it ever says is *"this was
measured off Rev 2; Rev 3 has since been issued."*

**Dates and labels, never a relation.** `takeoff.prisma` says `TakeoffPlan`
"must not become" `DrawingSet`/`DrawingRevision` — those are the job's paper
trail, while this is a sheet somebody was emailed with an invitation to bid. A
foreign key would collapse that boundary and would not work anyway: at bid time
the job usually has no drawing set at all. `DrawingRevision` refuses a counter
for the same underlying reason — *"'Rev 3', 'ASI-12', 'Bulletin 5' are the
ARCHITECT'S labels, printed on a title block we don't control."*

So `revisionLabel` and `sheetIssuedOn` are entered text and an entered date,
compared in a pure module against `DrawingRevision.issuedOn` and against
`BidAddendum.issuedOn` for addenda flagged `affectsPricedScope`. The bid side is
reached only through `BidInvitation.wonJobId` — the link a person made — because
names rarely match and one GC sends three invitations per building, so anything
fuzzier would warn about another project's addenda.

**UNKNOWABLE is a first-class answer**, the posture `bid-outcome.ts` takes toward
unfinished jobs. A plan with no issue date cannot be shown to be superseded and
cannot be shown to be current, so it is neither — calling it current is the
dangerous half of that guess. Every pre-existing plan reads that way until
somebody fills the date in, which is the honest default for an additive
migration.

**Two rules that stop it crying wolf**, both mutation-tested:

- **Same-day does not supersede.** A sheet and its own transmittal routinely
  share a date, and a warning that fires on every plan is a warning nobody
  reads.
- **An undated addendum supersedes nothing.** It cannot be placed in time — and
  it is reported separately rather than dropped, because it cannot be said *not*
  to supersede either.

`sheetIssuedOn` is entered and never stamped, and that matters more here than
usual: the whole feature compares this date against what has been issued since,
so a stamped "today" would make every plan permanently current. The form says so
next to the field, because the wrong instinct is to put today's date in.

Three mutations, all caught: judge an undated plan anyway (4 red), make same-day
count as superseded (1 red), let an undated addendum supersede (1 red).

Migration is additive: two nullable columns. `TakeoffPlan` is already in
`EXPORT_OMISSIONS` — these rows are coordinates on a PDF the export does not
contain — so the new columns need no export registration, and the completeness
census confirms it rather than my saying so.
