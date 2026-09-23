### The app can finally say a wage determination has gone stale (Cyrus)
`cyrus/compliance-determination-standing`

Until now a prevailing-wage determination on a job was a filing cabinet:
a jurisdiction, maybe a PDF, maybe a link. Nothing anywhere could say
whether the document was still the one that governs the job. A
contractor could be running payroll against an issue that stopped
applying six months ago and no screen would have a word to say about it.

The Compliance tab now carries **Public-works facts** — the site county,
whether the job is public works, the date the awarding body first
advertised it for bid, and the awarding body's name — and under every
determination a one-line **standing**, derived on every read:

- **In force on Aug 10, 2026, when the job was advertised.**
- **Not the determination in force on your bid-advertisement date** —
  with which issue is, and when the boundary fell.
- **Expiration Jun 30, 2026 has passed and this determination carries a
  predetermined increase (\*\*)** — the rate step is on DIR's increase
  sheet.
- **Unchecked** — naming which date was never entered, rather than
  guessing.

Same sentence on `/prevailing-wage` and in Ask's `wage_determinations`
tool, because it is one function (`lib/determination-standing.ts`) and
all three read it. Nothing stores it — the file sits with `lib/emr.ts`
and `lib/coi-standing.ts` for the reason this repo keeps repeating: a
stored flag can disagree with the dates it was derived from.

**The rule is DIR's, applied mechanically to two entered dates, and it
is the one that catches people out.** "The date of the first
advertisement for bids determines which prevailing wage determination is
used" (8 CCR §16000). General determinations are issued 22 February and
22 August and take effect **ten days later**. So a job advertised 10
August 2026 is governed by issue **2026-1** — the OLDER one — and the
2026-2 issue published twelve days earlier is the wrong document, even
though it is newer and it is what a web search hands you first. After
the printed expiration, a single asterisk means the determination holds
for the life of the project and a double asterisk means a predetermined
increase applies. Those three facts are why "stale" is three different
answers here and not one boolean.

**The citations came from web SEARCH, not from fetching the pages** —
`dir.ca.gov` is blocked from the container this was written in, and the
file says so in its own header. A human needs to click those links
before anyone relies on the line in front of a GC. The rule is
implemented exactly as the plan states it; nothing was "improved" from
memory.

**The check:** `lib/determination-standing.test.ts`, 25 tests, including
every boundary day around the ten-day lag — 3 March (wrong issue), 4
March (in force), 22 August (2026-2's issue day, and 2026-1 still
governs for ten more days), 31 August (in force), 1 September (wrong
issue) — and the expiration day itself, which is not yet past. Mutation
tested four ways: setting the effective lag to zero turns seven tests
red including the plan's own Lincoln Middle School example; moving the
effective-day comparison one day fails the 4 March boundary alone;
moving the expiration comparison fails "the expiration day itself is not
yet past" alone; and making the code stop flagging *expiration passed
with no asterisk recorded* fails the one test whose whole point is that
the app names that gap instead of guessing either way.

**No AI, deliberately.** This is phase 1 of per-job compliance research
and there is not a single model call in it. The dates are typed off the
call for bids and off the determination itself. The later phases that do
search the web need something true to attach their findings to, and this
is it — but it earns its place on its own, because today the app cannot
say a determination is stale at all.

**Two smaller things worth naming.** The entered facts live on the
Compliance tab rather than in `updateJobDetails`, which is Diego's file
and was announced as out of scope. And no rate column was added, on
purpose: there is no wage figure anywhere in this change, and the rate
stays on the document where a person reads it.
