### A renovation sheet's existing walls, from the review queue, in one step (Diego)
`diego/set-aside-like`

No rule can tell an existing wall from a new one on an unseen renovation sheet, so the manual step
is made short. On a sheet whose words say it shows existing work, with walls in the queue and
nothing set aside yet (and no demolition plan handling it), the queue's FIRST item is "AI101 shows
existing work: 142 walls, 2,076 ft found" with **Set aside all walls drawn like this one**:

- The viewer asks for one existing wall. A click picks it and previews every wall on the sheet
  drawn the same way, with the same rule the server applies to an "exclude like this" exclusion
  (`wallsLikeThese`). On AI101: "14 walls, 578 ft drawn like this one". Nothing moves until Enter.
- **Enter** sets them aside: saved as the sheet's exclusion (the server finds the sheet again with
  it and replaces the walls on the job), and taken off the screen at once. The queue moves on.
- **One Undo** puts them all back. **Esc** cancels; a click on another wall changes the pick.
- It works on the walls stored with the scale (Run takeoff), where the rail's "Exclude like this"
  needed a Find in this browser first.

Presses to clean each sheet, measured by `realplan/setAsideLike.eval.ts`. The labels play the
person: rejected runs stand in for the existing walls; picks are read off the preview; plan
comparison is off.

| Sheet | Before (open + one per wall) | After (button + pick/Enter, rest one by one) | Junk set aside | Real lost |
|---|---|---|---|---|
| Bluetooth AI101 | 113 | 57 (10 picks kept of 11, 35 left) | 1,207 of 1,406 ft | 73 ft |
| E Street A2.1 | 91 | 65 (10 of 10, 44 left) | 772 of 1,057 ft | 12 ft |

Checked by `takeoff-aside-like.local.spec.ts` on Bluetooth AI101 (mutations: no queue item, and
Enter applying nothing, each fail their step) and `setAsideLike.test.ts`.
