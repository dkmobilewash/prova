### Settings: every takeoff switch in one list

**Why.** The pilot's first finding (PILOT.md): the takeoff switches live in
two places — "Wall types from the drawings" is an AI feature under Settings →
Assistant and needs company AI on first; the rooms and grey-out switches are
on the Estimating tab — and somebody looking for them all in one list
concludes one is missing, or ticks the feature and reads its "off until your
company turns it on" refusal as a bug.

**What.** A "Takeoff features" section at the top of Settings → Estimating
lists every switch — wall types from the drawings, rooms and ceilings, grey
out, whole-set, scanned sheets — each with one plain sentence, a status
(On / Off / "Switched on, but not working yet — N things needed", each
named / "Not on this build yet"), and a link to where the switch itself
lives. Nothing moved: the existing switches stay in their sections and on the
Assistant page, now with anchors the links land on. Turning "Wall types from
the drawings" on from this list turns company AI on and opts the feature in,
in one save, touching nothing else; turning it off takes only the opt-in
away, because AI is the Ask box too. A missing server model key is named as
the third thing needed and points at Check connection, since no switch can
supply it. Whole-set and scanned-sheets read "Not on this build yet" until
their releases land and wire their switches into `lib/takeoff/features.ts`.

**Check.** `lib/takeoff/features.test.ts` (status rules), the db test
`lib/actions/takeoffFeatures.dbtest.ts` (AI on + opt-in in one save, the
rest untouched; off leaves AI on; non-owner refused). No e2e run.
