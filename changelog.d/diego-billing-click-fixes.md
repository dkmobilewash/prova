### Four fixes from the billing click test (Diego)
`diego/billing-click-fixes`

Chrome clicked the billing list and found these, none visible to the suites.

- **The change order backup printed no markup.** The Estimate tab loaded the bid
  rates only at estimate stage, so a contracted job's backup ran on empty rates
  and ended on a sell below the real price. The rates now load at every stage.
  A backup also now prints only when it ends on the line's real price, so a
  typed price shows none rather than a false one.
- **Committed and Drafted were hidden on the Estimate tab.** They sat in the
  collapsed row body. They are now on the closed row beside Actual.
- **Issuing or closing a PO could take today's date in one click.** The date box
  now has a visible label, starts empty, and holds the button until it is filled.
- **A line with nothing left still offered quotes at $0.00.** It now says all of
  it is on a purchase order and offers none.
