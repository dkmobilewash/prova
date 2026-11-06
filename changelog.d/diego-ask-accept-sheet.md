### "Accept all suggestions on A101" from Ask

`accept_sheet_suggestions` is a DIRECT card over #1020's `confirmSheetSuggestions`. It takes every group on the named sheet whose type the drawing gave (a printed tag or the legend), each at the height the review queue would pre-fill. Guesses by thickness stay in the queue. The card lists each group (type, height, feet) and how many it leaves before anything is written. The tap types them and writes their estimate lines.

- **One builder for the button and the card.** The queue's inline group-building moved to `sheetSuggestionGroups` in `lib/takeoff/reviewQueue.ts`, and both `TakeoffReviewQueue`'s Accept all and this card call it. That way the two can't disagree about which groups go in, or at what height.
- **No Undo from Ask, and the card says so.** The queue's Undo keeps the before-snapshot in the page that pressed it. A group typed wrong is retyped in the queue.
- **A HANDOFF wasn't possible without threading `?draft=` through the workspace.** The census only allows a hand-off to a guarded job tab with `?draft=` as its only query. A DIRECT card over an ActionResult action is what the registry allows, and the card is still the confirmation.
- `wallGroupType.*` was a single wildcard exclusion. It's now split by name: `setWallGroupType` and `confirmWallGroup` keep "typed by looking", and `undoSheetSuggestions` has its own reason.
