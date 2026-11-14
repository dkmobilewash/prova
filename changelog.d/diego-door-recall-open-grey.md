### Doors drawn standing open are found, and a door drawn in the existing pen is set aside (Diego)
`diego/door-recall-open-grey`

Two measured changes from route (a) of the doors work, shipped together on Diego's word:
- **Open swings.** The door finder took only swings of 55 to 110 degrees. Topeka draws its closets
  and bedrooms standing open at about 45 degrees with a thin diagonal leaf, and that was the
  largest cause of missed key doors on training (45 of 156). The floor is now 30 degrees. A swing
  under 55 must also look like a door: at least 2.5 ft wide, on a found wall, and with at most
  3 other arc centres within 3 ft of its hinge. Without those three, Macon-Bibb's F04/F05 fixture
  arcs and narrow casework came in.
- **Grey pen** (`existingDoors.ts` route 6, the wall rule's route 3 for doors). A door whose arc
  and leaf are mostly grey is set aside as existing when the sheet's doors are mostly dark: at
  least 60% grey and at most 20% dark on a sheet whose words show existing work, at least 90% grey
  with at least 75% of its doors dark otherwise. A stroke with no colour is black.

Training (labels-snap-20261114T0319, plan comparison where the product pairs, with the leaf fix):
matched key doors 322 -> 383 (67.4% -> 80.1%), false found doors 29 -> 26. The grey route removed
4 false on the 2020-09-24 set's A1.1, 1 on Baker A101 and 6 on UCCS, and set aside 2 UCCS key
doors drawn grey (one inside EXISTING WOMEN'S RESTROOM), which went to audit as likely existing
doors in the key. Per set: 114026 +1 false (TELECOM 126, a key gap in Chrome's Round 24) and
Topeka +2 false (double-leaf closet doors the key does not hold, sent to audit).
Check: `doorWindowSymbols.test.ts` (the 45-degree door; off a wall, too narrow, cluttered;
5 mutations red) and `existingDoors.test.ts` (route 6; 5 mutations red).
