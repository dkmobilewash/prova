### Set type keeps the group; a type or height set by mistake is undone or cleared; a not-counted demolition plan offers no Add these

Chrome's re-test on Baker and E Street:

1. **Set type keeps the group in the panel, typed.**
   - It used to leave the list as "Add these" does and come back only on a reload.
   - The row now shows what its walls are on, read off the sheet's own measurements (`typedItemOf`), so a reload agrees.
2. **Undo for type and height sets, in the panel and the review queue, plus Clear type.**
   - Before, a mistake could not be undone: Undo stayed grey and ⌘Z did nothing.
   - Set type, Set height, the queue's Enter on a group and its height answer now push an entry onto the workspace's undo stack. Undo and ⌘Z take it back in place, and in the queue the item comes back on screen.
   - A typed group has "Clear type" (`clearWallGroupType`), which puts its walls back on "Walls — untyped" and is itself undoable.
   - The queue's Enter goes through `confirmSheetSuggestions` for one group, for the token Undo uses. `setWallGroupHeight` returns the height and sides it replaced.
3. **On a demolition plan that isn't counted (E Street A1.1),** no group offers "Add these", and "Not counted: used to set aside existing walls on A2.1" is the first line of the panel.
