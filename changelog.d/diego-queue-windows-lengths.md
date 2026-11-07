### Window confirms undo on the queue's stack; the panel's groups have the queue's lengths

Chrome's queue re-test on Baker A101. "Confirm 9" on the Windows item could not be
undone: it went on no Undo stack and had no undo. `confirmWindows` now returns
what it wrote, and `undoConfirmWindows` takes the counts back, removes a count
item it made once that item is empty, and offers the sheet's windows again — the
undo is a claim from the browser, so only counts on that job's sheet and items of
that job are touched. "Not a window" is on the stack too; it saves nothing until
Confirm, so its Undo puts the window back in the list.

The panel and the queue listed the same groups at different lengths (5" 46 ft
against 43, 12-1/8" 24 against 18) and a 9-3/4" group only the panel had. The
panel counted runs held on "Walls — to confirm", which the queue asks about on
their own (Held walls). The panel leaves a group's held runs out of its length
now, and a group whose every run is held is not listed as a group to type.
