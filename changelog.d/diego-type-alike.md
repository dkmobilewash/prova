### One type for the untagged groups drawn alike: after you type one, the rest in one press (Totem Lake: 28 → 18 type presses)
`diego/type-alike`

**Why Totem Lake asked 28 type presses.** With plan reading off, its legend is never read, so the
tags it prints (1, 1A, 2B…) name no type the company has. Every wall group on A2.1 is therefore
untagged: nothing on the drawing names it. Thirteen groups, one per drawn thickness: 2-7/16, 3-3/4,
4-3/4, 5-1/8, 6, 7-5/16, 8-3/16, 8-7/8, 9-3/8, 10-1/16, 10-13/16, 12 and 12-3/8 in. Each took two
presses (pick a type, Enter), 26, plus 2 for the one height it asked.

**Now:** when a person types an untagged group, the queue offers that same type for the other
untagged groups on the sheet drawn like it: the same fill (hatched or plain, as detection split
them) and a thickness within an inch, or 15%, of the one they typed. For example, "W1 on the 2 other
groups drawn like it on A2.1: 9 runs, 113 ft". One press types them all, with one Undo; "Not these"
leaves them. The type is always the person's, never picked for them. A group the drawing suggests
something for, or one whose fill is not known, is never included.

The fill now travels on each stored run (`hatched`), so the queue reads it back. Rows stored before
this have no fill and get no offer, so a hatched group is never mistaken for a plain one.

**Totem Lake walk** (new customer, renovation, no AI), same walk before and after on main
dec86244: **82 → 72 presses**, queue types **28 → 18** (6 typed, 4 alike offers covering 7 groups),
with the same scope and price: W1 833 LF / 16,271 SF, $39,098.73.

Checked by `alikeGroups.test.ts` (which groups are alike, which never are, and fill kept and read
back; red without the change) and `wallProposal.test.ts` (the stored run shape now names `hatched`).
