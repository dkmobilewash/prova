### Two more things the assistant can look up

`open_submittals` and `certification_expiry`, taking the read surface from
thirteen tools to fifteen. Both are reads — nothing new can be written, and
no command was added.

**`open_submittals` — "what is the GC still sitting on?"** Submittals sent
and not returned, with days outstanding, the date back, and whether it has
passed. The mirror of `open_rfis`, which answers the same question about the
other direction of correspondence.

Its one subtle rule, and the reason it has its own test file: **open is
derived from the LATEST revision, never stored.** A submittal rejected at
revision 1 and re-sent as revision 2 is open again on the new revision, and
the two natural implementations are wrong in opposite directions on that one
row — reading the oldest revision calls it closed on the day it most needs
chasing, and asking "does it have any unreturned revision" calls it open
forever once a revision was superseded without a response date. A submittal
with NO revisions has never been sent; it is a draft, and counting it would
put the sub's own unfinished paperwork on a list titled "what the GC owes
us".

`pastDue` is stated rather than left as two dates for the model to subtract,
because the prompt forbids it to do arithmetic. It is **null, not false**,
when no date back was ever agreed — false would be a claim that it is on
time, which nobody knows.

**`certification_expiry` — "who is going to be turned away at the gate?"**
Cards expired or expiring, worst first, with whose they are.

**A certification with no expiry date is carried, marked undated, and sorted
last.** That is the whole reason this one is not four lines: null is not less
than anything, so any naive `expiresOn <= window` filter drops it, and the
tool then answers "nobody is expiring" while somebody walks onto a site with
an undated card. Undated is a gap in the records, not an emergency — present
enough to chase, never ranked above a card that lapsed yesterday.

The window is the other half. The model sends a string, and an unreadable one
falls back to sixty days rather than returning an empty list, because "no
certification is expiring" is the one wrong answer this tool must never give.
Sixty is the window `/compliance` already uses, so the assistant and the
screen cannot disagree about what "soon" means.

An `OTHER` card is named by whatever was typed into `otherLabel`, and says
"Unnamed certification" when nothing was — never the literal word "Other" as
if that were the name of a card.

**Capabilities follow the page each cites**, which is the rule `tools.ts`
already states: `/submittals` is `MANAGE_JOBS`, `/certifications` is
`MANAGE_FIELD`. The second is worth naming — the question is "who can start
on Monday", which a foreman asks and a compliance manager does not.

**What adding a tool actually costs here, recorded because it is the good
news.** Four separate registries refused the change until each was updated:
the `ToolName` union, the `HANDLERS` map, `toolLabels`, and two test-side
censuses — one asserting every tool's capability matches its citation page,
one asserting every tool has at least one routing eval case. Nothing shipped
half-wired, and none of it needed remembering.

17 new tests. Four mutations watched RED and restored: counting never-sent
drafts as open, reporting `pastDue: false` where no date was agreed, dropping
undated certifications, and returning nothing on an unreadable window.

**Not verified, and not claimed:** neither tool has been asked a real question
through the box. The tests fake the rows, so they prove the rules and not the
Prisma queries that feed them — in particular the `orderBy revisionNumber
desc, take 1` that selects a submittal's latest revision is asserted by
nothing here, because the fixture holds what that query would return.
