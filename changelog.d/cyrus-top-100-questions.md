### A hundred questions, and the eight built screens the assistant could not see (Cyrus)
`cyrus/ask-more-tools`

Cyrus asked for "the top 100 projected most asked questions and tasks" with
a guarantee the assistant can execute them all. The guarantee is the part
worth being careful about. **Nobody can promise a model answers a hundred
questions well, and a list of a hundred questions with no check against it
is a wish.** What CAN be made true at build time is the question
underneath — *is there a capability behind each one at all* — and that is
what `lib/ask/eval/top-questions.ts` is.

Every question carries a route, and there are five kinds: one read tool,
one write command, `several` (it needs the composing loop), **`refused`**
(somebody decided, and the decision is in the registry's exclusion list),
or **`gap`** — nothing answers it, with the reason and the tool most likely
to be reached for by mistake. No sixth state and no blank.

## Thirteen had no route. Eight were features we had already built

That split is the finding, and it was not the expected one. They were not
missing features — they were **built screens the assistant could not see**,
which is a far cheaper problem and was invisible until the questions sat
next to the registry. All eight are tools now:

| The question | The tool, and what it refuses to claim |
| --- | --- |
| *is certified payroll in for last week?* | `certified_payroll`. The WH-347 was built and unreachable. It reports whether a week could be **produced** and counts the three things that would come out blank — hours with no rate schedule, workers with no craft, workers with no name — and says **on every row** that filing is not recorded, because nothing in this app records a submission. |
| *did the GC sign the T&M ticket?* | `tm_tickets`. `TmTicket` had no page and no tool at all. `billed` is the string "not recorded", never `false`: nothing links a ticket to a change order or an invoice. |
| *which approved COs haven't been invoiced?* | `unbilled_change_orders`. **This gap was wrong** — the join existed the whole time. Recorded rather than quietly amended: a gap list wrong in that direction stops anybody looking. |
| *are we past the end date?* | `schedule_status`. Dates only. |
| *what's in the Northgate estimate?* | `estimate_detail`. Three commands wrote estimate lines and nothing read them back. |
| *what came in that nobody filed?* | `document_intake`. |
| *what is Mike on an hour?* | `team_roster` — which reports **no rate**, because a person does not have one here. |
| *have we got dispatch on file?* | `dispatch_slips`. |

**Certified payroll is the one that mattered most**, and not because it was
hardest: the form was already built and the certification on it is
criminal, with debarment under 29 CFR 5.12 reaching the owner personally.

## One tool was designed and deliberately NOT built

*"What's in the pipeline we haven't bid?"* looked like a tool over
`SalesLead`. `sales.prisma`'s first line says that model is **Prova's own
CRM**, for selling this product, populated only on the operator company. A
tool over it would have handed every tenant the vendor's sales pipeline. It
stays a gap with a corrected reason.

## The seven that remain are now on the list the model is actually told

A gap does not fail as silence. It fails as a **confident near-miss in the
same voice as a fact** — *"who is on Riverside tomorrow?"* has no answer,
`crew_assignments` is a roster and says so, and it answers in exactly the
right shape, so a foreman reads a list of names as tomorrow's crew.

Six were added to `KNOWN_GAPS` in `tools.ts`, which is **injected into the
system prompt**; the seventh, the payroll-cash question, was already there.
And each census gap now carries a `refusalTopic` that a test requires to
appear in a `KNOWN_GAPS` topic — because a gap recorded only in the census
changes nothing about what the assistant does, and two lists describing the
same holes will drift in exactly the direction that costs something.

## What the checks prove, and what they don't

`top-questions.test.ts` runs in CI and proves there is a capability behind
each question and that the asker can be offered it. It does **not** prove
the model picks it. That is `top-questions.eval.ts`, against the real model.

Every count is typed by a person, never derived from the array it measures.
Without that, a new gap just makes the list longer and a tool retired out
from under a question becomes a gap in silence.

**Fifteen mutations, each red then restored.** Three found real defects
rather than confirming the tests:

- **A worker with no craft was counted under two holes at once**, so
  "10 hours need a rate schedule" silently included hours that need a craft
  tag instead — which undoes the whole reason the three counts are separate.
- **An edits-only change order reported `unbilled: 0`**, which reads as
  "nothing outstanding". It is null now. Found because the mutation that
  deleted the guard against it **passed all thirty tests** — zero
  contributes nothing to a sum, so the filter was doing no work and the
  *row* was the lie.
- **The eval failed two cases and BOTH TIMES THE QUESTION WAS WRONG, NOT
  THE MODEL.** That is the eval earning its keep, and it is the same
  mistake twice: *a question routed to a tool that disclaims it is not
  covered — it is a gap wearing a route.*
  - *"add 5/8 type X to our catalog at 14.20"* → `add_catalog_line`, which
    puts a line on a job **from** the catalog and "does NOT invent an item
    or a price". The model called nothing, correctly. Creating a catalog
    entry is now a `refused`.
  - *"what is Mike on an hour?"* → `team_roster`, whose own description
    says **in capitals** that there is no per-person rate and it does not
    report one. The model read that and called nothing. It is a gap now,
    with `team_roster` named as the near-miss — and its `KNOWN_GAPS` entry
    tells the model to name the crafts he has worked under rather than
    refuse flat, because the classification and its schedule are where the
    number actually lives.

  Eight of eight new tools were then verified against the real model. The
  run was scoped to the changed cases — about 18 calls rather than 200 —
  after the full run twice over emptied the account's credit balance.

## The eval's own headline lied, and that is fixed too

A run that died partway printed **"50/50 passed of 100 cases"**. That reads
as a clean sweep and means half the suite never ran; only the count
assertion failed it. `reportVerdicts` now announces the shortfall FIRST and
refuses to print a ratio against a denominator it did not reach — the cause
that day was an Anthropic credit balance at zero, and the eval cannot tell
that apart from a rate limit or a bad tool schema, because the ask loop
deliberately never yields the API's own message.
