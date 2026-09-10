### The Ask box bills the client, logs a payment and logs today's hours — phase 3, the first money commands, and a page that shows every card it ever made (Diego)
`claude/prova-ai-task-completion-96pjes`

Three more commands, and the first ones that touch money. "invoice
Riverside for 45,000 for the September progress", "log a 12,500 payment
from Turner against invoice 3 on Riverside, check 4471", "log 8 hours
for Mike on Riverside". All three are T3 — evidence, money — and all
three are DIRECT: `createInvoiceRecord` is the invoice action's body
lifted into `lib/billing/` (the form keeps its throw, the card gets the
sentence), and `logPayment` and `logTimeEntry` already returned their
refusals as sentences since #213.

**No figure on a card came from the model, and this is the phase where
that rule earns its keep.** The amount is the person's own typed digits,
parsed by `lib/ask/numbers.ts` — "$12,500", "12,500.00" and "12500" are
one amount; "12.5k" and "about twelve grand" are not an amount and the
box asks for one. Everything else on a money card is computed by the same
arithmetic the pages use: the balance owing in cents exactly as
`logPayment`'s guard computes it, retainage withheld by the job's own
rate through the same formula the action snapshots, the due date from the
GC's payment terms. So the card cannot disagree with the job page beneath
it, and a payment that would overpay is refused before the card exists,
in the action's own words.

**The invoice counter #224 shipped is what made `draft_invoice`
possible**, and its issuer moved from the "use server" module into
`lib/billing/invoice-number.ts` so the lifted core and the action share
one function rather than two copies of a counter.

**Who is offered what.** ACCOUNTING gets the two money commands and
nothing that touches the field; FIELD gets hours and nothing that touches
money. Both are pinned in `commands.test.ts`. The `billing.*` and
`labor.*` wildcards become per-action exclusions with reasons: pay
applications stay on the job page (a card cannot carry a continuation
sheet), retainage release waits until a card can show the balance it
draws down, and every delete is T5.

**`/settings/assistant`** lists every card the box has ever shown, newest
first — who asked, what was proposed, what became of it, and a link to
the record where one was made. The outcome column is DERIVED per the
rule that derived state is never stored: a row with no outcome is
"waiting for a tap" until its expiry passes and "expired untouched"
after, and a HANDOFF card opened on its page but never saved reads as
"form opened, not saved". Owner-only on top of the settings capability,
because the list carries every member's questions and, now, amounts.

**An Anthropic API failure now logs its status, error type, request id
and model** (`packages/integrations/src/ask.ts`), never the key or the
prompt. Found by clicking: a preview whose Ask box said "The assistant is
unavailable right now" had nothing at all in its runtime log, so a rejected
key, a model the org cannot use and an overloaded API were one
indistinguishable sentence. The screen still shows one sentence; the log
now says which.

**Verified, and how.** Unit tests pin the parsing, the refusals and the
exact FormData each action receives. `ask.dbtest.ts` now runs a payment
and an invoice through the tap against a real Postgres: the invoice takes
the counter's next number, the payment lands, and a second payment for
more than the balance gets the action's own sentence back. Nobody has
clicked it; the list is in the PR body.
