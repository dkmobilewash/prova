### E Street 421 pairs in the app: a set's sheets are named with plan comparison on, not only with plan reading (Diego)
`diego/estreet-pairing`

E Street A2.1 showed "No demolition plan is paired" and an empty "Compare
with" list, though the eval paired the set. The cause is one gate. Plan
comparison pairs by the keyless sheet numbers and titles the inventory
records, and the inventory recorded them only with plan-text reading
(PLAN_TEXT_READ) on. A company with plan comparison on and plan reading off
had no names: nothing to pair by, and no sheets for the picker. The eval
forced that switch on, which is why it paired.

- The inventory records the names with either switch on (`sheetNamesOn`,
  renamed from `planTextReadOn`, which no longer described it).
- A set inventoried before then gets its names once, on the takeoff load,
  when plan comparison is on (`ensureSheetNames`). It uses the same keyless
  reader (`keylessSheetName`, extracted from the inventory), with no model,
  filed under the finished inventory run. It never fails the page.

`realplan/eStreetPairing.dbtest.ts` runs on the real drawing (`ESTREET_PDF`):
with no names it pairs nothing; `ensureSheetNames` names the set once; A2.1
then pairs with A1.1 "DEMOLITION - FLOOR PLAN". A fresh inventory with plan
comparison on and plan reading off pairs A2.1 by itself. Taking plan
comparison out of the gate turns it red.
