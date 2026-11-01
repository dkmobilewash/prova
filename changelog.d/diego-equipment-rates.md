### A change order's equipment line can pick a rate (Diego)
`diego/equipment-rates`

Equipment on a T&M change order was typed by hand each time. `/equipment/rates`
now holds what each machine costs per hour, day or week, with start and end dates.
On a draft change order, Add scope can fill the line from a rate: description, unit,
cost and the Equipment cost type. Every box stays editable, the price stays blank,
and the line goes through the bid recap as before. A typed price still wins.

A rate is chosen for the work date of the T&M ticket behind the change order, or
today if there is none. The figure is copied onto the line, so changing a rate
never changes a change order. Rates are by name rather than tied to an `Equipment`
row, because a rented lift has no row. They are costs, not bill rates. Two rates
for one machine and unit cannot overlap. Additive migration
`20261101120000_equipment_rate`.
