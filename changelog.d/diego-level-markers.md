### Level markers in the forms sets actually print, so more storeys get a floor-to-floor (Diego)
`diego/level-markers`

#1009 read a level as "2nd Floor 763'-8"", the name and its elevation on one line
(Crosslines). Wood-framed sets mark their storeys by the bearing each floor sits on, with
the figure printed under the label and its inches as a separate item. Topeka A3xx:
"T.O. 1st FLOOR SLAB / 100'-0"", "T.O. 2nd BEARING / 109'-1 1/8"", "TRUSS BEARING". The
reader now takes:
- a top-of prefix ("T.O.", "TOP OF");
- a section's own numbering ("1.0 - FIRST FLOOR");
- a trailing SLAB / DECK / EL;
- "<n> BEARING" for storey n, and "TRUSS BEARING" as the roof;
- a figure over or under the label, a figure on the same line still winning.

Built from training sets only. Topeka reads 9'-1 1/8" on the 1st floor and 10'-11 7/8" on
floors 2–3; Crosslines is unchanged; single-storey MHK marks no roof and gets none.

| ROUND 14 key | correct | correct + lenient | wrong | no height |
| --- | --- | --- | --- | --- |
| training, before → after | 30.0% → 30.0% | 32.4% → 32.4% | 0 → 0 | 67.6% → 67.6% |
| held-out, measured once, before → after | 1.3% → 1.3% | 3.1% → 3.1% | 5.9% → 5.9% | 91.0% → 91.0% |

**Held-out reads the right figure and uses none of it.** Hutto's floor-to-floor is now read
as 12.157 ft on A101 (the key says 12.156) and 8'-1 1/8" on A103. No Hutto wall takes it,
because a level's floor-to-floor goes only to types whose legend runs them to the
structure, and Hutto's types aren't read that way. Hutto is held-out, so its legend
wording was not looked at.
