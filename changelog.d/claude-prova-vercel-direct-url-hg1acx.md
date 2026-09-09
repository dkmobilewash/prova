### The counter entry went false two hours after it came true (Diego)
`claude/prova-vercel-direct-url-hg1acx`

**Docs-only, and an audit under working agreement 1's exception:** it
corrects a claim that is false as of `c5da778`, with the evidence.

#224 gave invoice numbers a counter. CLAUDE.md's sequence-number entry
still said `InvoiceCounter` did not exist, that `billing.ts` computed
`max(n)+1`, and that the fix had not been made and should go to Diego as
an issue. All three were false within two hours of the merge, and the last
one would have sent the next agent to redo finished work.

**The shape is worth more than the content, and is now written into the
entry.** For a week this file said invoice numbers came from a counter
when they did not, and that sentence stopped anyone looking. It was
corrected to say they did not — and that became the false one the moment
the fix landed. A claim about what the code does NOT have is exactly as
perishable as a claim about what it does; both versions were true when
written.

Also recorded, because #224 established it and it outlives the fix: the
headline the entry led with — "delete invoice 3 of 3 and the next invoice
is 3 again" — described something the product cannot do, since there is no
`deleteInvoice` anywhere in the app and that absence is the evidence-record
rule working. The reachable defect was the concurrency collision the entry
mentioned last and in passing. A vivid failure nobody can reach makes a bug
look urgent for the wrong reason, and the boring one underneath it went
unfixed for a week.

The counter roll-call now carries the two commands that re-derive it —
model count and `tx.*Counter.upsert` call sites, both 8 — because a bare
count is what this file deletes elsewhere for rotting, and a counter model
no action bumps is the "written, documented, never called" shape wearing a
schema.
