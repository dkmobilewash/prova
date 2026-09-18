### The Ask box becomes a conversation you can read back

A scrollback of everything asked in this sitting, oldest at the top, in its
own scrolled box between the input and the live answer. Older is what you
scroll UP for, and it opens at the bottom — a scrollback that opens at the
top shows the oldest thing first and cuts the one most likely to be wanted
off below the fold.

**This reverses a decision, and the reason is worth keeping rather than
deleting.** `AskPanel`'s header said: *"Deliberately not a chat… a
scrollback of stale answers is a place for a number to be read long after
it stopped being true."* That is correct. It is not an argument against a
scrollback — it is a **specification** for one.

The model half was already handled: `PRIOR_TURNS_RULE` tells it the turns
are not a source of facts. **Nothing was telling the person**, who is the
one who scrolls up, reads "$32,300 overdue", and acts on a figure read on
Tuesday. So every answer except the one on screen is marked:

> Answered 3 minutes ago — the figures were read then. Ask again for what is
> true now. **Ask again**

The mark is on **every** prior answer, not on ones past some age. A
threshold would make a two-minute-old figure look authoritative, which is
the exact reading the original decision guarded against. An earlier
answer's numbers were read when they were read, and an invoice can be paid
in the thirty seconds since. The age tells a person how much to care; the
mark tells them it is a different read.

**The citations ride along, and they are the real remedy.** Not hiding an
old number — leaving the live one one tap away. Every entry keeps its "Read
from Cash flow / Today" links.

**Two modules, not one field.** `turns.ts` is the wire format: six turns,
sent with every request, bounded again on the server, every byte of it
prompt weight. `transcript.ts` is new and never leaves the browser — it
holds twenty entries with timestamps and citations. Keeping them apart means
the scrollback can grow or gain a field without changing one byte of what
is sent or what the server validates.

Stored transcript is browser input like any other, so it is parsed like it:
malformed entries dropped, huge ones capped, an entry with no timestamp
dropped rather than stamped with "now" (which would make an old answer look
fresh — the one failure this feature exists to prevent), and **a citation
whose href is not a relative in-app path is refused**, so a link rendered
from storage cannot leave the app.

**Three defects the click test found, none of which a test would have:**

- **The newest answer rendered twice** — once in the box, once in the live
  block below it. The box now shows what came BEFORE the answer on screen,
  matched on the question rather than on a count, which is what makes the
  other two cases right: after a reload there is no live answer so every
  entry belongs in the box, and while a new question is in flight the last
  entry is the previous one, which also belongs there.
- **The input did not clear on send**, so a follow-up typed into a box still
  holding the last question APPENDED to it — the person sends "which
  invoices are overdue?raise an RFI on that job". Harmless when this was one
  question at a time; a real defect the moment it is a conversation. The
  button's label and disabled state both compared the box to the question in
  flight, which only worked because the box still held it; they ask
  `isAsking` directly now, which is what they meant.
- **The box opened scrolled to the top**, cutting the newest prior exchange
  off below the fold.

14 tests on the new module. Verified live against `ep-icy-hat`, and the
memory chain is what it was for: "how much retainage is being held on us?"
→ "which job is holding the most of it?" resolved **it** and answered "Cedar
Park Elementary — $13,420.00 held by Halvorsen Builders", then "when does
that job come out of warranty?" resolved **that job** two answers back and
correctly refused, naming what it could do instead.
