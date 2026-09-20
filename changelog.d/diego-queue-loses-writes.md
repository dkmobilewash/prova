### The offline queue was losing writes, and the phone had no tests (Diego)
`diego/queue-loses-writes`

A punch item was marked ready on a real phone in Airplane Mode. The screen
said "Pending sync: 1". When the radio came back the write was gone: the
server never received it, no refusal was ever shown, and the item was still
open. That is the exact failure the offline queue exists to prevent, found
on the first real field test of it.

Two races, both reproducible in a second once the code was reachable from a
test at all:

**A flush deleted anything queued while it was running.** `flushQueue` read
the queue, sent what it found, then wrote back `ops.slice(done)` — its own
snapshot minus what it had sent. A tap during a flush landed inside the part
that got overwritten. It is not a rare interleaving either: the screen
flushes on focus, on foreground and after every create, so a flush is
usually in flight exactly when somebody is tapping. Each entry now carries
its own `opId`, and a flush removes only the entries it actually handled
from the queue as it stands at the end, re-read rather than remembered.

**Two flushes ran at once and sent the same write twice.** Production logged
the second as a 500 — `P2002` on `(companyId, clientOperationId)`, the
idempotency key colliding with its own first insert, because the server's
check is a read followed by an insert and both callers passed the read.
Fixed on both sides: the phone runs one flush at a time and a caller
arriving mid-flush rides the one already going, and the create endpoint
reads the row back on a `P2002` instead of throwing. Mutation-tested —
removing the catch turns the concurrent-replay dbtest red.

**The phone had no test runner at all.** That is why a queue whose whole job
is not losing things had never once been asked to prove it. `apps/mobile`
now runs vitest over its pure logic, wired into the same `test` task as
everything else, starting with the two races above and the offline cache
below.

Two smaller things from the same field test, both reported from the site:

**The list said "Nothing outstanding on this job." with no signal**, because
the fetch failed and the screen had nothing else to draw. On a jobsite that
sentence is not a blank page, it is a claim — it reads as "this job is
clear". The screen now keeps the last list it loaded per job, shows it with
"Showing the list from 20 min ago — no connection", and when there is no
cache to fall back on says it cannot load rather than that there is nothing
to do.

**The keyboard covered the fields it was typing into.** The sheet is pinned
to the bottom of the screen, which is right for a thumb and wrong for a
keyboard. It now rides up by the keyboard's height, with its own height cap
shrinking to match. That is every form on the phone, not just this one.
