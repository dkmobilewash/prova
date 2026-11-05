### With markup set, the review queue asks for a line's cost and prices it with the markup

The new-job walkthrough v2 found that markup set at signup changed nothing in the bid:
the review queue asked for every line's sale price, the bid was the sum of those prices,
and markup only reaches a bid through the recap's cost. Diego's call (F2, option a):
once a company's own four rates are set — material, labor, overhead, profit — the
queue's price item asks for the line's COST, and its price is worked from it by
`unitPriceFromCost`, the recap's own steps on one line (category markup, escalation,
tax, overhead, profit, bond, contingency), from the job's recap or the company's
defaults. Line prices so made sum to the recap's bid to the cent per unit, the same
rounding Apply makes. A line with no category is asked for one, since the recap marks
up nothing on an uncategorised line; without the four rates the queue still asks for
a price. `priceLineFromCost` leaves the PM's forecast cost alone, as
`setLineBudgetedCost` does.

Starter wall-type parts now carry their cost category (the crew's work LABOR, the rest
MATERIAL), so takeoff lines from a preset arrive categorised.

F3: the markup form leads with those four, marked while any is blank, and puts every
other rate and waste under More, open by itself when one of them holds a value.
`cost-pricing.spec.ts`: 10/10/8/10, two costs, and the lines total goes from $0.00 to
$653.00.
