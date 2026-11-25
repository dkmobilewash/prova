### On a renovation sheet the work area is the first step, and it stays asked until there is one

**Diego's audit order, 2026-11-25.**

**What was wrong.**
- A sheet whose words show existing work, such as (E), DEMO or RENOVATION, asked for a work area only after Find the
  walls, at the bottom of the side panel.
- "Exclude like this" dismissed it. Everything else (the estimate's warning, the review queue) then counted the sheet as
  answered, while the existing walls drawn some other way still rode along.
- The whole-set panel printed one line naming the sheets, offered nothing to do about them, and never cleared.

**What changes.**
- **The sheet opens with one prompt**, read from its stored marks before anything is pressed: "Draw your work area:
  walls outside it won't be counted". Two exits: **Draw work area** (picks the tool) and **Whole sheet is new work**
  (one work area over the page, so nothing is set aside).
- It stays until a work area exists. "Exclude like this" is still a tool, and no longer an answer.
- **The effect, live:** with a work area and found walls, the bar reads "−1,240 ft not in your work area" (the work-area
  clip's own `outsideFeet`). The whole sheet reads "Whole sheet is new work: nothing set aside".
- **The whole set asks the same, per sheet.** Each renovation sheet with walls and no work area gets the prompt on its
  row, with Draw work area (opens that sheet) and Whole sheet is new work. The summary names only the sheets still
  unanswered.
- The review queue's existing-walls step has the same words and exits. "Set aside walls drawn like one" stays there as a
  quieter tool.
- **The estimate's renovation warning and the review queue** now count a sheet as answered by a work area only, the
  same rule as the screen (`workAreaPrompt`).

**Not built:** the second's suggested work area (`diego/suggested-area`) failed its gate on 2026-10-31 and is not on
main. When it lands, its polygon is the pre-drawn shape behind one "Use this work area" press.

**Checks.**
- Tests written first, and red on main (counts in the PR).
- One mutation per rule, each red.
- The local click specs now pin the new words.
