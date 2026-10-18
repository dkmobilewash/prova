### The agents can look a bid up, check its estimate, learn from wins and losses, and say what to do next (Cyrus)
`cyrus/ai-research`

Four advisory agents on the AI spine. None of them changes a bid, an estimate
or a line, and none sends anything.

- **Bid research** runs when a bid is logged. From the company's own rows it
  says how many bids this GC has sent, the win rate over decided bids only,
  how fast they pay (the contact page's own `calculatePaymentReliability`, so
  retainage held is not "late"), their backcharges, similar past bids
  (same trade, within 50% of the amount) and the owner/architect from the
  pursuit. A GC with no history gets a finding that SAYS so, cited to the
  contact — never a made-up rate. Then, if the key and the company switch
  allow, one web pass with the project name, GC name and city only; a web
  finding is written only when the search returned pages, and its sources
  are those URLs.
- **Estimate check** runs when a bid is marked submitted. It compares the
  linked job's estimate lines to past ones: lines on ≥60% of similar jobs and
  missing here, unit prices more than 25% from the median of the same line
  (showing n, median, min, max), addenda nobody read or with undecided items,
  and zero-quantity or zero-price lines. Deterministic: no model, no spend.
- **Win/loss**: `recordBidOutcome` writes the reason and the WON/LOST status
  in one transaction, from a form or the new `record_bid_outcome` Ask card.
- **Recommendations**: bid-or-pass per invited bid (each factor named with its
  number), price outliers, retainage the alert list already calls
  collectable, and overdue invoices by the one aging rule. Rows that stop
  qualifying close themselves; ones a person dismissed stay dismissed.

`agentPass` is the one place an agent calls the model, so `AI_AGENTS` left
the gate census's "not built" list. Checks: mutation-tested the 25% band and
the win-rate denominator (both turn the suite red).
